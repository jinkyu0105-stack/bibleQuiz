import importlib.util
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location("transport", Path(__file__).with_name("prepare-preview-migration-transport.py"))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


class TransportTests(unittest.TestCase):
    def test_comments_quotes_nested_case_and_trigger_boundaries(self):
        sql = """CREATE TABLE example(value TEXT);
        -- D1's comment must not hide the following CASE.
        CREATE TRIGGER guard BEFORE INSERT ON example BEGIN
          SELECT CASE WHEN NEW.value='bad' THEN RAISE(ABORT,'CASE; END') END;
          SELECT CASE WHEN 1 THEN CASE WHEN 1 THEN 'D1''s CASE' END END;
        END;
        INSERT INTO example VALUES ('CASE; END');"""
        parts = list(transport.split_statements(sql))
        self.assertEqual(len(parts), 3)
        databases = [sqlite3.connect(":memory:") for _ in range(2)]
        databases[0].executescript(sql)
        for part in parts:
            databases[1].execute(transport.transport_statement(part))
        for db in databases:
            self.assertEqual(db.execute("SELECT * FROM example").fetchall(), [("CASE; END",)])
            with self.assertRaisesRegex(sqlite3.IntegrityError, "CASE; END"):
                db.execute("INSERT INTO example VALUES ('bad')")
            db.close()

    def test_full_schema_has_identical_objects_and_columns(self):
        original, prepared = (sqlite3.connect(":memory:") for _ in range(2))
        paths = sorted((Path(__file__).resolve().parent.parent / "migrations").glob("*.sql"))
        for path in paths:
            original.executescript(path.read_text())
            for part in transport.split_statements(path.read_text()):
                prepared.execute(transport.transport_statement(part))
        query = "SELECT type,name,tbl_name FROM sqlite_schema ORDER BY type,name"
        self.assertEqual(original.execute(query).fetchall(), prepared.execute(query).fetchall())
        for (table,) in original.execute("SELECT name FROM sqlite_schema WHERE type='table'"):
            self.assertEqual(original.execute(f'PRAGMA table_info("{table}")').fetchall(),
                             prepared.execute(f'PRAGMA table_info("{table}")').fetchall())
            self.assertEqual(original.execute(f'PRAGMA foreign_key_list("{table}")').fetchall(),
                             prepared.execute(f'PRAGMA foreign_key_list("{table}")').fetchall())
        self.assertEqual(prepared.execute("PRAGMA foreign_key_check").fetchall(), [])
        original.close()
        prepared.close()


if __name__ == "__main__":
    unittest.main()
