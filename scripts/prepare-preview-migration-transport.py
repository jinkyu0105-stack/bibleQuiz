"""Prepare SQL for D1's REST splitter; never edit migrations or contact D1.

P5-71 observed REST code 7500 on valid trigger CASE/END expressions. Explicit
CASE parentheses and comment removal avoid that parser ambiguity. SQLite's
parser, rather than a semicolon regex, determines each statement boundary.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3

TOKENS = re.compile(
    r"--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/|'(?:''|[^'])*'|"
    r'"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:\]\]|[^\]])*\]|\bCASE\b|\bEND\b',
    re.IGNORECASE,
)


def transport_statement(sql):
    depth = 0

    def replace(match):
        nonlocal depth
        token = match.group()
        if token.startswith(("--", "/*")):
            return "\n"
        if token.upper() == "CASE":
            depth += 1
            return "(" + token
        if token.upper() == "END" and depth:
            depth -= 1
            return token + ")"
        return token

    value = TOKENS.sub(replace, sql)
    if depth:
        raise ValueError("Unbalanced CASE expression")
    return value.strip()


def split_statements(sql):
    buffer = ""
    for char in sql:
        buffer += char
        if char == ";" and sqlite3.complete_statement(buffer):
            yield buffer.strip()
            buffer = ""
    if transport_statement(buffer):
        raise ValueError("Incomplete trailing SQL")


def prepare(path):
    source = path.read_bytes()
    batch = [{"sql": transport_statement(part)}
             for part in split_statements(source.decode("utf-8"))]
    batch.append({"sql": "INSERT INTO d1_migrations(name) VALUES (?)", "params": [path.name]})
    return {"name": path.name, "sha256": hashlib.sha256(source).hexdigest(), "batch": batch,
            "transportSha256": hashlib.sha256(json.dumps(batch, ensure_ascii=False,
                                                          separators=(",", ":")).encode()).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--first", type=int, choices=range(7, 35), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    migrations = sorted((Path(__file__).resolve().parent.parent / "migrations").glob("*.sql"))
    selected = [p for p in migrations if args.first <= int(p.name[:4]) <= 34]
    assert [int(p.name[:4]) for p in selected] == list(range(args.first, 35))
    output = [prepare(p) for p in selected]
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as file:
        json.dump(output, file, ensure_ascii=False, indent=2)
    print(json.dumps({"prepared": len(output), "remoteExecution": False, "sourceFilesModified": 0}))
