// P5-52: dedicated 0015→0016 preservation using the existing synthetic populated fixture; no app DB/config.
import assert from "node:assert/strict";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { unstable_splitSqlQuery } from "wrangler";
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const root = path.resolve(import.meta.dirname, "..");
const mf = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, log: new Log(LogLevel.ERROR), workers: [{
  name: "p552-placement", modules: true, script: 'export default { fetch() { return new Response("synthetic"); } };',
  compatibilityDate: "2026-08-25", d1Databases: { DB: "p552-placement" },
}] }));
const hash = "a".repeat(64), actor = "b".repeat(64), now = "2026-09-17T01:00:00.000Z";
let checks = 0;
try {
  const db = await mf.getD1Database("DB");
  const stmt = (sql, ...args) => db.prepare(sql).bind(...args);
  const rows = async (sql, ...args) => (await stmt(sql, ...args).all()).results;
  const run = async (sql, ...args) => stmt(sql, ...args).run();
  const insert = (table, value) => stmt(`INSERT INTO ${table} (${Object.keys(value).join(",")}) VALUES (${Object.keys(value).map(() => "?").join(",")})`, ...Object.values(value));
  const sources = (await readdir(path.join(root, "migrations"))).filter(n => /^\d{4}_.*\.sql$/u.test(n)).sort();
  const migration = async name => unstable_splitSqlQuery(await readFile(path.join(root, "migrations", name), "utf8"));
  await run("CREATE TABLE d1_migrations(name TEXT PRIMARY KEY)");
  for (const name of sources.slice(0, 13)) await db.batch([...(await migration(name)).map(s => stmt(s)), insert("d1_migrations", { name })]);
  const fixture = await readFile(path.join(root, "tests/fixtures/published-quiz.sql"), "utf8");
  const seed = fixture.slice(0, fixture.indexOf("INSERT INTO quiz_entries_public (")) + fixture.slice(fixture.indexOf("INSERT INTO site_state ("));
  await db.batch(seed.split(";").map(s => s.trim()).filter(Boolean).map(s => stmt(s)));
  const [{ id: sermon }] = await rows("SELECT id FROM sermons"), [{ id: quiz }] = await rows("SELECT id FROM quiz_sets");
  await run("INSERT INTO sermon_metadata_drafts VALUES (?,1,1,'SYNTHETIC_ONLY','2026-09-17','{}')", sermon);
  for (const [version, id, kind] of [[1, "legacy_source", "source"], [2, "legacy_confirm", "confirm"]]) {
    await db.batch([
      insert("sermon_input_events", { sermon_id: sermon, version, id, kind, source_type: "caption_plain",
        source_id: "legacy_source", document_id: "legacy_source", confirmation_id: kind === "confirm" ? id : null,
        parent_document_id: kind === "confirm" ? "legacy_source" : null, related_id: null, document_sha256: hash,
        payload_sha256: hash, chunk_count: 1, byte_length: 2, actor_id: actor, created_at: now, state: "pending", required_state: "sealed" }),
      insert("sermon_input_chunks", { sermon_id: sermon, event_id: id, position: 0, body: "{}" }),
      version === 1 ? insert("sermon_input_heads", { sermon_id: sermon, version }) : stmt("UPDATE sermon_input_heads SET version=? WHERE sermon_id=?", version, sermon),
      stmt("UPDATE sermon_input_events SET state='sealed' WHERE sermon_id=? AND id=?", sermon, id),
    ]);
  }
  const input = { version: 2, source_id: "legacy_source", document_id: "legacy_source", document_sha256: hash, confirmation_id: "legacy_confirm" };
  const job = { id: "populated", sermon_id: sermon, quiz_set_id: quiz, request_scope: "full", request_contract_version: 1,
    request_key: "populated", request_fingerprint: hash, workflow_instance_id: "populated", start_input_state: "present",
    start_input_version: 2, start_source_id: input.source_id, start_document_id: input.document_id, start_document_sha256: hash,
    start_confirmation_id: input.confirmation_id, start_metadata_revision: 1, settings_revision: null, selection_revision: null,
    status: "dispatch_pending", current_step: "dispatch", state_version: 0, event_count: 1, wait_kind: null, wait_generation: 0,
    wait_input_fingerprint: null, error_code: null, error_message_safe: null, error_fingerprint: null,
    created_by_actor_id: actor, created_at: now, updated_at: now, completed_at: null, required_event_no: 1, required_event_state_version: 0 };
  const event = (no, code) => ({ generation_job_id: "populated", event_no: no, job_state_version: no - 1,
    attempt_number: 1, step_key: null, level: "info", event_code: code, message_safe: code, metadata_json_safe: null, elapsed_ms: null, created_at: now });
  await db.batch([insert("generation_jobs", job), insert("generation_job_dispatches", {
    id: "populated_start", generation_job_id: "populated", dispatch_no: 1, kind: "start", dispatch_key: "populated_start",
    workflow_instance_id: "populated", job_state_version: 0, wait_generation: null, payload_fingerprint: hash, state: "pending",
    attempt_count: 0, claim_token: null, lease_expires_at: null, error_code: null, error_message_safe: null,
    error_fingerprint: null, created_at: now, last_attempted_at: null, acknowledged_at: null,
  }), insert("generation_job_events", event(1, "job_created"))]);
  await run("UPDATE generation_job_dispatches SET state='claimed',attempt_count=1,claim_token='legacy_claim',lease_expires_at='2026-09-17T03:00:00.000Z' WHERE id='populated_start'");
  await db.batch([
    stmt("UPDATE generation_job_dispatches SET state='acknowledged',claim_token=NULL,lease_expires_at=NULL,acknowledged_at=? WHERE id='populated_start'", now),
    stmt("UPDATE generation_jobs SET status='running',state_version=1,event_count=2,required_event_no=2,required_event_state_version=1 WHERE id='populated'"),
    insert("generation_job_events", event(2, "dispatch_acknowledged")),
  ]);
  // Reuse the existing SQL-only fixture, stripped by the pinned Node 24 runtime.
  // The sole import is resolved locally; there are no adapters or provider calls.
  const fixturePath = path.join(root, "workers/app/test/human-content-storage-fixture.ts");
  const fixtureCode = stripTypeScriptTypes((await readFile(fixturePath, "utf8")).replace(
    '"../../_shared/storage/sha256"', JSON.stringify(pathToFileURL(path.join(root, "workers/_shared/storage/sha256.ts")).href)));
  const { seedReviewedHumanContent, insertReviewedFinalTicket } = await import("data:text/javascript;base64," + Buffer.from(fixtureCode).toString("base64"));
  const reviewed = await seedReviewedHumanContent(db, { generationJobId: "populated", input, sermonId: sermon });
  await insertReviewedFinalTicket(db, { input, quizSetId: quiz, sermonId: sermon }, reviewed, "legacy_ticket");
  const schema = () => rows("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name");
  // Resolve only this disposable fixture with valid v1 transitions, preserving all rows.
  const [{ step_key: analysisKey }] = await rows("SELECT step_key FROM generation_step_receipts WHERE task='intent_analysis'");
  const [{ step_key: summaryKey }] = await rows("SELECT step_key FROM generation_step_receipts WHERE task='summary'");
  await run("UPDATE generation_step_receipts SET state='terminal_failed',claim_token=NULL,lease_expires_at=NULL WHERE step_key NOT IN (?,?)", analysisKey, summaryKey);
  const call = (id, task, key) => ({ id, generation_job_id: "populated", step_key: key, attempt_number: 1,
    quiz_set_id: quiz, sermon_id: sermon, task, input_fingerprint: actor, provider: "synthetic", model: "synthetic",
    reasoning_effort: null, state: "effect_started", provider_request_id_opaque: null,
    started_at: "2026-09-17T03:00:00.000Z", completed_at: null });
  await db.batch([
    stmt("UPDATE generation_step_receipts SET state='effect_started' WHERE step_key IN (?,?)", analysisKey, summaryKey),
    insert("ai_provider_calls", call("legacy_completed_call", "intent_analysis", analysisKey)),
    insert("ai_provider_calls", call("legacy_uncertain_call", "summary", summaryKey)),
    stmt("UPDATE ai_provider_calls SET state='completed',completed_at='2026-09-17T03:01:00.000Z' WHERE id='legacy_completed_call'"),
    stmt("UPDATE ai_provider_calls SET state='uncertain',completed_at='2026-09-17T03:01:00.000Z' WHERE id='legacy_uncertain_call'"),
    insert("ai_usage_events", { id: "legacy_usage", provider_call_id: "legacy_completed_call", generation_job_id: "populated",
      step_key: analysisKey, attempt_number: 1, quiz_set_id: quiz, sermon_id: sermon, task: "intent_analysis",
      provider: "synthetic", model: "synthetic", input_tokens: 12, cached_input_tokens: null, reasoning_tokens: null,
      output_tokens: 4, audio_input_tokens: null, audio_seconds: null, pricing_version: "synthetic_v1",
      estimated_cost_micro_usd: 7, usage_source: "provider_partial", observed_at: "2026-09-17T03:01:00.000Z" }),
    insert("generation_step_result_links", { generation_job_id: "populated", step_key: analysisKey, task: "intent_analysis",
      correction_sermon_id: null, correction_event_id: null, content_sermon_id: sermon, content_event_id: reviewed.analysisEventId,
      final_audit_result_id: null, usage_event_id: "legacy_usage", result_kind: "intent_analysis_event",
      result_id: reviewed.analysisEventId, result_version: 3, result_fingerprint: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a" }),
    stmt("UPDATE generation_step_receipts SET state='succeeded',claim_token=NULL,lease_expires_at=NULL,result_kind='intent_analysis_event',result_id=?,result_version=3,result_fingerprint=?,completed_at='2026-09-17T03:01:00.000Z' WHERE step_key=?", reviewed.analysisEventId, "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a", analysisKey),
    stmt("UPDATE generation_step_receipts SET state='uncertain',claim_token=NULL,lease_expires_at=NULL WHERE step_key=?", summaryKey),
  ]);
  assert.deepEqual(await rows("PRAGMA foreign_key_check"), []);
  for (const name of sources.slice(13, 16)) await db.batch([...(await migration(name)).map(s => stmt(s)), insert("d1_migrations", { name })]);
  const tables = (await schema()).filter(r => r.type === "table" && r.name !== "d1_migrations").map(r => r.name);
  const capture = async () => (await db.batch(tables.map(t => stmt(`SELECT * FROM ${t} ORDER BY 1`)))).map(r => r.results);
  const before = await capture(), oldTriggers = (await schema()).filter(r => r.type === "trigger");
  assert.equal(sources[16], "0016_phase5_placement_selections.sql");
  await db.batch([...(await migration(sources[16])).map(s => stmt(s)), insert("d1_migrations", { name: sources[16] })]);
  assert.deepEqual(await capture(), before, "0016 must preserve every old cell, blob, review, cost and audit row");
  checks += tables.length;
  const replaced = new Set();
  const next = await schema();
  for (const trigger of oldTriggers) {
    const actual = next.find(r => r.type === "trigger" && r.name === trigger.name);
    assert(actual, trigger.name);
    if (!replaced.has(trigger.name)) assert.deepEqual(actual, trigger);
    checks++;
  }
  assert.deepEqual(await rows("SELECT * FROM generation_placement_selections"), []);
  assert.deepEqual(await rows("PRAGMA foreign_key_check"), []);
  assert.deepEqual(await rows("PRAGMA quick_check"), [{ quick_check: "ok" }]);
  checks += 3;
  console.log(`PASS P5-52 0015→0016 populated preservation: ${checks} checks; ${tables.length} existing tables byte-preserved; all old triggers retained; no backfill; FK/quick_check clean`);
} finally {
  await mf.dispose();
}
