// Rehearse the observed Preview boundary (0006 -> 0034) in disposable local D1.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unstable_splitSqlQuery } from "wrangler";
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const mf = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, log: new Log(LogLevel.ERROR), workers: [{
  name: "p571-upgrade", modules: true, script: 'export default { fetch() { return new Response("synthetic"); } };',
  compatibilityDate: "2026-08-25", d1Databases: { DB: "p571-upgrade" },
}] }));
try {
  const db = await mf.getD1Database("DB");
  const names = (await readdir(new URL("../migrations/", import.meta.url))).filter(n => /^\d{4}_.*\.sql$/u.test(n)).sort();
  assert.deepEqual(names.map(n => Number(n.slice(0, 4))), Array.from({ length: 37 }, (_, i) => i));
  const manifest = [];
  async function apply(name, fail = false) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    const statements = unstable_splitSqlQuery(sql).map(s => db.prepare(s));
    if (fail) statements.push(db.prepare("INSERT INTO p571_missing_table VALUES (1)"));
    await db.batch(statements);
    if (!fail) manifest.push({ name, sha256: createHash("sha256").update(sql).digest("hex") });
  }
  for (const name of names.slice(0, 7)) await apply(name);
  const seed = await readFile(new URL("../tests/fixtures/published-quiz.sql", import.meta.url), "utf8");
  await db.batch(unstable_splitSqlQuery(seed).map(s => db.prepare(s)));
  const tables = (await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r => r.name);
  const snapshot = async () => (await db.batch(tables.map(t => db.prepare(`SELECT * FROM "${t}" ORDER BY 1`)))).map(r => r.results);
  const before = await snapshot();
  // An error at the end of a file must roll back that file and preserve old rows.
  await assert.rejects(apply(names[7], true));
  assert.deepEqual(await snapshot(), before);
  assert.equal((await db.prepare("SELECT name FROM sqlite_schema WHERE name='sermon_metadata_drafts'").all()).results.length, 0);
  for (const name of names.slice(7)) {
    await apply(name);
    assert.deepEqual(await snapshot(), before, `Existing rows changed by ${name}`);
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, [], name);
  }
  assert.deepEqual((await db.prepare("PRAGMA quick_check").all()).results, [{ quick_check: "ok" }]);
  console.log(JSON.stringify({ code: "P571_UPGRADE_REHEARSAL", from: "0006", through: "0036", migrations: 30,
    oldTablesPreserved: tables.length, oldRowsPreserved: before.reduce((n, rows) => n + rows.length, 0),
    injectedFailureRolledBack: true, foreignKeyErrors: 0, quickCheck: "ok", manifest: manifest.slice(7) }));
} finally { await mf.dispose(); }
