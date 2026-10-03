// Generate immutable synthetic-fixture schema input, never contact a database.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
const output = process.argv[2];
assert(output && path.isAbsolute(output), "New absolute output directory required");
await mkdir(output);
const root = path.resolve(import.meta.dirname, "..");
const names = (await readdir(path.join(root, "migrations"))).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
assert.equal(names.length, 10);
assert.equal(names.at(-1), "0009_sermon_input_selected_storage.sql");
const sources = await Promise.all(names.map((name) => readFile(path.join(root, "migrations", name), "utf8")));
await writeFile(path.join(output, "schema.sql"), sources.join("\n"), { flag: "wx" });
await writeFile(path.join(output, "schema-inputs.json"), JSON.stringify(names.map((name, i) => ({ name, sha256: createHash("sha256").update(sources[i]).digest("hex") })), null, 2), { flag: "wx" });
console.log(JSON.stringify({ migrations: names.length, last: names.at(-1), mode: "synthetic schema replay, not migration-ledger completion" }));
