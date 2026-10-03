import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

export const digest = value => createHash("sha256").update(value).digest("hex");
const bindValue = value => value instanceof ArrayBuffer ? new Uint8Array(value) : value;

/** Local, stopped trial DB only. SAVEPOINT keeps D1 batches inside the caller's
 * migration+recovery transaction. Never opens or creates a remote database. */
export function localRecoveryD1(filename, readOnly = true) {
  const native = new DatabaseSync(filename, { readOnly, enableForeignKeyConstraints: true });
  native.exec("PRAGMA busy_timeout=1000");
  let sequence = 0;
  const prepare = (sql, values = []) => {
    const args = values.map(bindValue);
    const statement = () => native.prepare(sql);
    const total = () => native.prepare("SELECT total_changes() n").get().n;
    const wrapped = { bind: (...v) => prepare(sql, v),
      async first(column) { const row = statement().get(...args); return row ? column ? row[column] : row : null; },
      async all() { const before = total(), results = statement().all(...args);
        return { success: true, results, meta: { changes: total() === before ? 0 : native.prepare("SELECT changes() n").get().n } }; },
      async run() { const r = statement().run(...args); return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      async raw() { const s = statement(); s.setReturnArrays(true); return s.all(...args); } };
    return wrapped;
  };
  return { native, db: { prepare, async batch(statements) {
    assert.ok(!readOnly, "READ_ONLY_DATABASE");
    const savepoint = `recovery_batch_${++sequence}`;
    native.exec(`SAVEPOINT ${savepoint}`);
    try { const results = []; for (const s of statements) results.push(await s.all()); native.exec(`RELEASE ${savepoint}`); return results; }
    catch (error) { native.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`); throw error; }
  } }, close: () => native.close() };
}

/** Logical snapshot includes schema, blobs and all rows, including migration
 * history. Stable across SQLite checkpointing; no transcript enters a report. */
export function databaseFingerprint(native, ignoredTables = [], ignoredTriggers = []) {
  const schema = native.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .filter(s => !ignoredTables.includes(s.tbl_name) && !(s.type === "trigger" && ignoredTriggers.includes(s.name)));
  const rows = schema.filter(s => s.type === "table").map(s => {
    const name = '"' + s.name.replaceAll('"', '""') + '"';
    return [s.name, native.prepare(`SELECT * FROM ${name}`).all().map(row => JSON.stringify(row,
      (_key, value) => value instanceof Uint8Array ? { sqliteBlob: Buffer.from(value).toString("base64") } : value)).sort()];
  });
  return digest(JSON.stringify({ schema, rows }));
}
