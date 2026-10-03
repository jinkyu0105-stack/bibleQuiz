// Local-only upgrade rehearsal. No account, real data, or developer DB is used.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const wrangler = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
const temp = await mkdtemp(path.join(tmpdir(), "biblequiz-migration-rehearsal-"));
const database = "biblequiz-migration-rehearsal";
const configPath = path.join(temp, "wrangler.json");
const migrationDir = path.join(temp, "migrations");
const foundationTables = ["bible_translations", "quiz_sets", "quiz_variants", "sermon_transcripts", "sermons", "site_state"];
const newTables = ["quiz_entries_public", "anonymous_sessions", "quiz_solutions", "submissions", "moderation_exceptions", "moderation_terms", "reserved_names", "leaderboard_snapshot_entries", "leaderboard_snapshots", "audit_logs", "moderation_actions", "sermon_metadata_drafts"];
const historyTables = ["heads", "commits", "records", "references", "payloads", "chunks"].map((name) => `sermon_history_${name}`);
const inputTables = ["events", "chunks", "heads"].map((name) => `sermon_input_${name}`);
const generationTables = ["generation_jobs", "generation_job_events", "generation_step_receipts", "generation_job_dispatches"];
const resultTables = [
  "ai_final_audit_chunks", "ai_final_audit_results", "ai_provider_calls", "ai_usage_events",
  "final_check_ticket_chunks", "final_check_tickets", "generation_step_result_links",
  "sermon_content_chunks", "sermon_content_events", "sermon_content_heads", "sermon_content_payloads",
];
const humanTables = ["final_check_ticket_inputs", "sermon_content_current", "sermon_content_human_events"];
const historySql = "SELECT name FROM d1_migrations ORDER BY id";
const schemaSql = "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name";

function run(args, expectFailure = false) {
  const child = spawnSync(process.execPath, [wrangler, "d1", ...args,
    "--local", "--config", configPath, "--persist-to", path.join(temp, "state")], {
    cwd: temp,
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(temp, "wrangler.log") },
    encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  if (expectFailure) {
    assert.notEqual(child.status, 0, "Injected migration failure must fail");
    assert.match(child.stdout + child.stderr, /rehearsal_missing_table/);
  } else {
    assert.equal(child.status, 0, child.stdout + child.stderr);
  }
  return child.stdout;
}

function query(sql) {
  const result = JSON.parse(run(["execute", database, "--command", sql, "--json"]));
  assert.ok(result.every((item) => item.success));
  return result.map((item) => item.results);
}

function apply(expectFailure = false) {
  run(["migrations", "apply", database], expectFailure);
}

function foundationRows() {
  return query(foundationTables.map((table) => `SELECT * FROM "${table}" ORDER BY 1;`).join("\n"));
}

try {
  await mkdir(migrationDir);
  await writeFile(configPath, JSON.stringify({
    name: database, compatibility_date: "2026-09-01",
    d1_databases: [{ binding: "DB", database_name: database, database_id: randomUUID(), migrations_dir: "migrations" }],
  }));
  const allNames = (await readdir(path.join(root, "migrations"))).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  assert.equal(allNames.at(-1), "0013_phase5_generation_lifecycle.sql", "Review lifecycle rehearsal for new migrations");
  // Preserve the historical 0000→0012 checks, then run the v2 upgrade and guards.
  const names = allNames.filter((name) => name < "0013");
  assert.deepEqual(names.map((name) => name.slice(0, 4)), ["0000", "0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012"], "Review the rehearsal when migration scope changes");
  const sources = await Promise.all(names.map((name) => readFile(path.join(root, "migrations", name), "utf8")));
  await writeFile(path.join(migrationDir, names[0]), sources[0]);
  apply();

  // Reuse only the six foundation-table inserts from the existing synthetic fixture.
  const fixture = await readFile(path.join(root, "tests/fixtures/published-quiz.sql"), "utf8");
  const newTableStart = fixture.indexOf("INSERT INTO quiz_entries_public (");
  const siteStateStart = fixture.indexOf("INSERT INTO site_state (");
  assert.ok(newTableStart > 0 && siteStateStart > newTableStart);
  const seed = fixture.slice(0, newTableStart) + fixture.slice(siteStateStart);
  assert.equal((seed.match(/INSERT INTO /g) ?? []).length, 6);
  const seedPath = path.join(temp, "synthetic-foundation.sql");
  await writeFile(seedPath, seed);
  run(["execute", database, "--file", seedPath, "--json"]);
  const before = foundationRows();
  assert.ok(before.every((rows) => rows.length === 1));
  const [schemaBefore] = query(schemaSql);

  for (let index = 1; index <= 7; index++) {
    await writeFile(path.join(migrationDir, names[index]), sources[index]);
  }
  // Fail at the END of 0002: 0001 must remain, 0002 must roll back,
  // later migrations must not run, and the failed file must not enter history.
  await writeFile(path.join(migrationDir, names[2]), sources[2] + "\nINSERT INTO rehearsal_missing_table VALUES (1);\n");
  apply(true);
  assert.deepEqual(query(historySql)[0].map((row) => row.name), names.slice(0, 2));
  const [schemaAfterFailure] = query(schemaSql);
  assert.deepEqual(schemaAfterFailure.filter((row) => row.type === "table").map((row) => row.name).sort(), [...foundationTables, "d1_migrations", "quiz_entries_public"].sort());
  assert.deepEqual(foundationRows(), before);
  console.log("PASS: failed 0002 rolled back; 0001 retained; 0003–0007 not applied; foundation rows preserved");

  await writeFile(path.join(migrationDir, names[2]), sources[2]);
  apply();
  assert.deepEqual(query(historySql)[0].map((row) => row.name), names.slice(0, 8));
  assert.deepEqual(foundationRows(), before);
  const [schemaAfter] = query(schemaSql);
  assert.deepEqual(schemaAfter.filter((row) => foundationTables.includes(row.tbl_name)), schemaBefore.filter((row) => foundationTables.includes(row.tbl_name)));
  assert.deepEqual(schemaAfter.filter((row) => row.type === "table").map((row) => row.name).sort(), [...foundationTables, ...newTables, "d1_migrations"].sort());
  const counts = query(newTables.map((table) => `SELECT count(*) AS total FROM "${table}";`).join("\n"));
  assert.ok(counts.every(([row]) => row.total === 0), "No real or synthetic policy rows introduced by migrations");
  assert.deepEqual(query("PRAGMA foreign_key_check;")[0], []);
  assert.deepEqual(query("PRAGMA quick_check;")[0], [{ quick_check: "ok" }]);
  console.log("PASS: resumed 0002–0007; 12 empty tables added; all six foundation rows/schema preserved; FK/quick_check clean");

  // Stop at 0007 and retain a private metadata row before adding the six history tables.
  query("INSERT INTO sermon_metadata_drafts SELECT id, 1, 7, 'TEST_ONLY_METADATA', '2026-09-10', '{}' FROM sermons;");
  const existingTables = [...foundationTables, ...newTables];
  const existingRows = query(existingTables.map((table) => `SELECT * FROM "${table}" ORDER BY 1;`).join("\n"));
  const beforeHistorySchema = query(schemaSql)[0];
  await writeFile(path.join(migrationDir, names[8]), sources[8]);
  apply();
  assert.deepEqual(query(historySql)[0].map((row) => row.name), names.slice(0, 9));
  assert.deepEqual(query(existingTables.map((table) => `SELECT * FROM "${table}" ORDER BY 1;`).join("\n")), existingRows);
  const afterHistorySchema = query(schemaSql)[0];
  assert.deepEqual(afterHistorySchema.filter((row) => existingTables.includes(row.tbl_name)), beforeHistorySchema.filter((row) => existingTables.includes(row.tbl_name)));
  assert.ok(query(historyTables.map((table) => `SELECT count(*) AS total FROM "${table}";`).join("\n")).every(([row]) => row.total === 0));
  assert.equal(afterHistorySchema.filter((row) => row.type === "trigger" && historyTables.includes(row.tbl_name)).length, 20);
  assert.deepEqual(query("PRAGMA foreign_key_check;")[0], []);
  assert.deepEqual(query("PRAGMA quick_check;")[0], [{ quick_check: "ok" }]);
  console.log("PASS: 0007→0008 preserves all 18 existing tables/rows including private metadata; six empty history tables and 20 guards; FK/quick_check clean");

  const beforeInputTables = [...existingTables, ...historyTables];
  const beforeInputRows = query(beforeInputTables.map((table) => `SELECT * FROM "${table}" ORDER BY 1;`).join("\n"));
  await writeFile(path.join(migrationDir, names[9]), sources[9]);
  apply();
  assert.deepEqual(query(historySql)[0].map((row) => row.name), names.slice(0, 10));
  assert.deepEqual(query(beforeInputTables.map((table) => `SELECT * FROM "${table}" ORDER BY 1;`).join("\n")), beforeInputRows);
  const afterInputSchema = query(schemaSql)[0];
  assert.deepEqual(afterInputSchema.filter((row) => beforeInputTables.includes(row.tbl_name) && row.name !== "input_legacy_exclusive"), afterHistorySchema.filter((row) => beforeInputTables.includes(row.tbl_name)));
  assert.ok(query(inputTables.map((table) => `SELECT count(*) AS total FROM ${table};`).join("\n")).every(([row]) => row.total === 0));
  assert.deepEqual(query("PRAGMA foreign_key_check;")[0], []);
  assert.deepEqual(query("PRAGMA quick_check;")[0], [{ quick_check: "ok" }]);
  console.log("PASS: 0008→0009 preserves all 24 previous tables/rows; three empty private input tables; exclusive-path guard added; FK/quick_check clean");

  const beforeGenerationTables = [...beforeInputTables, ...inputTables];
  const beforeGenerationRows = query(beforeGenerationTables.map((table) => `SELECT * FROM "${table}" ORDER BY 1;`).join("\n"));
  await writeFile(path.join(migrationDir, names[10]), sources[10]);
  apply();
  assert.deepEqual(query(historySql)[0].map((row) => row.name), names.slice(0, 11));
  assert.deepEqual(query(beforeGenerationTables.map((table) => `SELECT * FROM "${table}" ORDER BY 1;`).join("\n")), beforeGenerationRows);
  const afterGenerationSchema = query(schemaSql)[0];
  assert.deepEqual(afterGenerationSchema.filter((row) => beforeGenerationTables.includes(row.tbl_name)), afterInputSchema.filter((row) => beforeGenerationTables.includes(row.tbl_name)));
  assert.ok(query(generationTables.map((table) => `SELECT count(*) AS total FROM ${table};`).join("\n")).every(([row]) => row.total === 0));
  assert.equal(afterGenerationSchema.filter((row) => row.type === "trigger" && generationTables.includes(row.tbl_name)).length, 12);
  assert.match(afterGenerationSchema.find((row) => row.type === "index" && row.name === "generation_jobs_one_active_quiz_set_uidx").sql, /WHERE/i);
  assert.match(afterGenerationSchema.find((row) => row.type === "table" && row.name === "generation_jobs").sql, /DEFERRABLE INITIALLY DEFERRED/i);
  assert.deepEqual(query("PRAGMA foreign_key_check;")[0], []);
  assert.deepEqual(query("PRAGMA quick_check;")[0], [{ quick_check: "ok" }]);
  console.log("PASS: 0009→0010 preserves all 27 previous tables/rows; four empty generation tables, partial active index, deferred required-event FK, and 12 guards; FK/quick_check clean");

  const beforeResultTables = [...beforeGenerationTables, ...generationTables];
  assert.equal(beforeResultTables.length, 31);
  const beforeResultRows = query(beforeResultTables.map((table) => `SELECT * FROM "${table}" ORDER BY 1;`).join("\n"));
  const beforeResultSchema = query(schemaSql)[0];
  await writeFile(path.join(migrationDir, names[11]), sources[11]);
  apply();
  assert.deepEqual(query(historySql)[0].map((row) => row.name), names.slice(0, 12));
  assert.deepEqual(query(beforeResultTables.map((table) => `SELECT * FROM "${table}" ORDER BY 1;`).join("\n")), beforeResultRows);
  const afterResultSchema = query(schemaSql)[0];
  assert.deepEqual(
    afterResultSchema.filter((row) => beforeResultTables.includes(row.tbl_name) && row.name !== "generation_ai_receipt_success_guard"),
    beforeResultSchema.filter((row) => beforeResultTables.includes(row.tbl_name)),
  );
  assert.ok(query(resultTables.map((table) => `SELECT count(*) AS total FROM "${table}";`).join("\n")).every(([row]) => row.total === 0));
  assert.equal(afterResultSchema.filter((row) => row.type === "trigger" &&
    (resultTables.includes(row.tbl_name) || row.name === "generation_ai_receipt_success_guard")).length, 34);
  for (const table of ["sermon_content_events", "final_check_tickets", "ai_final_audit_results"]) {
    assert.match(afterResultSchema.find((row) => row.type === "table" && row.name === table).sql, /DEFERRABLE INITIALLY DEFERRED/i);
  }
  assert.deepEqual(query("PRAGMA foreign_key_check;")[0], []);
  assert.deepEqual(query("PRAGMA quick_check;")[0], [{ quick_check: "ok" }]);
  console.log("PASS: 0010→0011 preserves all 31 previous tables/rows; eleven empty result/usage tables, three deferred seals, task link guard, and 34 reviewed guards; FK/quick_check clean");

  const beforeHumanTables = [...beforeResultTables, ...resultTables];
  assert.equal(beforeHumanTables.length, 42);
  const beforeHumanRows = query(beforeHumanTables.map((table) => `SELECT * FROM "${table}" ORDER BY 1;`).join("\n"));
  await writeFile(path.join(migrationDir, names[12]), sources[12]);
  apply();
  assert.deepEqual(query(historySql)[0].map((row) => row.name), names);
  assert.deepEqual(query(beforeHumanTables.map((table) => `SELECT * FROM "${table}" ORDER BY 1;`).join("\n")), beforeHumanRows);
  const afterHumanSchema = query(schemaSql)[0];
  const replacedOrAddedOldGuards = new Set([
    "final_check_ticket_current_seal_guard",
    "sermon_content_event_insert_guard",
    "sermon_content_human_seal_guard",
  ]);
  assert.deepEqual(
    afterHumanSchema.filter((row) => beforeHumanTables.includes(row.tbl_name) && !replacedOrAddedOldGuards.has(row.name)),
    afterResultSchema.filter((row) => beforeHumanTables.includes(row.tbl_name) && !replacedOrAddedOldGuards.has(row.name)),
  );
  assert.ok(query(humanTables.map((table) => `SELECT count(*) AS total FROM "${table}";`).join("\n"))
    .every(([row]) => row.total === 0));
  const humanGuardNames = [
    "final_check_ticket_current_seal_guard", "final_check_ticket_input_delete_guard",
    "final_check_ticket_input_insert_guard", "final_check_ticket_input_update_guard",
    "sermon_content_current_delete_guard", "sermon_content_current_insert_guard",
    "sermon_content_current_update_guard", "sermon_content_human_delete_guard",
    "sermon_content_human_insert_guard", "sermon_content_human_seal_guard",
    "sermon_content_human_update_guard",
  ];
  assert.deepEqual(
    afterHumanSchema.filter((row) => row.type === "trigger" && humanGuardNames.includes(row.name))
      .map((row) => row.name).sort(),
    humanGuardNames.sort(),
  );
  assert.deepEqual(query("PRAGMA foreign_key_check;")[0], []);
  assert.deepEqual(query("PRAGMA quick_check;")[0], [{ quick_check: "ok" }]);
  console.log("PASS: 0011→0012 preserves all 42 previous tables/rows; three empty human-current/final-input tables and 11 reviewed guards; FK/quick_check clean");

  const [historyBeforeRepeat] = query("SELECT * FROM d1_migrations ORDER BY id;");
  apply();
  assert.deepEqual(query("SELECT * FROM d1_migrations ORDER BY id;")[0], historyBeforeRepeat);
  assert.deepEqual(query(schemaSql)[0], afterHumanSchema);
  assert.deepEqual(foundationRows(), before);
  console.log("PASS: repeat apply is a no-op including migration history");
  for (let index = 0; index < names.length; index++) {
    console.log(`${createHash("sha256").update(sources[index]).digest("hex")}  ${names[index]}`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}

await import("./check-generation-lifecycle-upgrade.mjs");

await import("./check-generation-populated-upgrade.mjs");
