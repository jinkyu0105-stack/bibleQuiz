// P5-55: apply 0019 and 0020 only to a disposable populated D1; never touch the app DB.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const root = path.resolve(import.meta.dirname, "..");
const mf = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, log: new Log(LogLevel.ERROR), workers: [{
  name: "p555-intent-upgrade", modules: true, script: 'export default { fetch() { return new Response("synthetic"); } };',
  compatibilityDate: "2026-08-25", d1Databases: { DB: "p555-intent-upgrade" },
}] }));
try {
  const db = await mf.getD1Database("DB");
  const stmt = (sql, ...args) => db.prepare(sql).bind(...args);
  const rows = async sql => (await stmt(sql).all()).results;
  const run = async sql => stmt(sql).run();
  const names = (await readdir(path.join(root, "migrations"))).filter(name => /^\d{4}_.*\.sql$/u.test(name)).sort();
  assert.equal(names[18], "0018_phase5_published_content.sql");
  assert.equal(names[19], "0019_phase5_intent_regeneration.sql");
  assert.equal(names[20], "0020_phase5_intent_critique_retry.sql");
  const migration = async name => unstable_splitSqlQuery(await readFile(path.join(root, "migrations", name), "utf8"));
  await run("CREATE TABLE d1_migrations(name TEXT PRIMARY KEY)");
  for (const name of names.slice(0, 19)) await db.batch([...(await migration(name)).map(sql => stmt(sql)), stmt("INSERT INTO d1_migrations(name) VALUES (?)", name)]);
  const fixture = await readFile(path.join(root, "tests/fixtures/published-quiz.sql"), "utf8");
  const seed = fixture.slice(0, fixture.indexOf("INSERT INTO quiz_entries_public (")) + fixture.slice(fixture.indexOf("INSERT INTO site_state ("));
  await db.batch(seed.split(";").map(sql => sql.trim()).filter(Boolean).map(sql => stmt(sql)));
  const schema = () => rows("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name");
  const beforeSchema = await schema();
  const tables = beforeSchema.filter(row => row.type === "table" && row.name !== "d1_migrations").map(row => row.name);
  const capture = async () => (await db.batch(tables.map(table => stmt(`SELECT * FROM ${table} ORDER BY 1`)))).map(result => result.results);
  const before = await capture();
  await db.batch([...(await migration(names[19])).map(sql => stmt(sql)), stmt("INSERT INTO d1_migrations(name) VALUES (?)", names[19])]);
  assert.deepEqual(await capture(), before, "0019 must preserve every existing table value and BLOB");
  const afterSchema = await schema();
  const changed = new Set(["generation_individual_overlap_insert", "generation_individual_overlap_update",
    "lifecycle_finish_current_legacy", "lifecycle_finish_scope_legacy"]);
  let triggerCount = 0;
  for (const prior of beforeSchema.filter(row => row.type === "trigger")) {
    const next = afterSchema.find(row => row.type === "trigger" && row.name === prior.name);
    assert(next, prior.name);
    if (changed.has(prior.name)) assert.notDeepEqual(next, prior);
    else assert.deepEqual(next, prior);
    triggerCount++;
  }
  assert.deepEqual(afterSchema.filter(row => row.type === "table").map(row => row.name), beforeSchema.filter(row => row.type === "table").map(row => row.name));
  assert.deepEqual(await rows("PRAGMA foreign_key_check"), []);
  assert.deepEqual(await rows("PRAGMA quick_check"), [{ quick_check: "ok" }]);
  const before0020 = await capture();
  await db.batch([...(await migration(names[20])).map(sql => stmt(sql)), stmt("INSERT INTO d1_migrations(name) VALUES (?)", names[20])]);
  assert.deepEqual(await capture(), before0020, "0020 must preserve every prior table value and BLOB");
  const after0020 = await schema();
  const replaced0020 = new Set(["lifecycle_stage_advance_legacy", "lifecycle_intent_wait", "lifecycle_finish_scope_legacy"]);
  for (const prior of afterSchema.filter(row => row.type === "trigger")) {
    const next = after0020.find(row => row.type === "trigger" && row.name === prior.name);
    assert(next, prior.name);
    if (replaced0020.has(prior.name)) assert.notDeepEqual(next, prior);
    else assert.deepEqual(next, prior);
  }
  assert.deepEqual(after0020.filter(row => row.type === "table").map(row => row.name).filter(name => name !== "generation_intent_analysis_reuse"),
    afterSchema.filter(row => row.type === "table").map(row => row.name));
  assert.deepEqual(await rows("PRAGMA foreign_key_check"), []);
  assert.deepEqual(await rows("PRAGMA quick_check"), [{ quick_check: "ok" }]);
  console.log(`PASS P5-55 0018→0020 populated preservation: ${tables.length} prior tables, ${triggerCount} prior triggers, reviewed replacements, FK/quick_check clean`);
} finally {
  await mf.dispose();
}
