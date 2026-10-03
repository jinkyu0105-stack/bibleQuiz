// P5-44: disposable, in-memory D1 only. No Wrangler config, credentials, network,
// persistent developer DB, production writer, or provider is used.
import assert from "node:assert/strict";
import { unstable_splitSqlQuery } from "wrangler";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const root = path.resolve(import.meta.dirname, "..");
const mf = new Miniflare(convertV4MiniflareOptions({
  host: "127.0.0.1", port: 0, log: new Log(LogLevel.ERROR),
  workers: [{ name: "p544-disposable", modules: true,
    script: 'export default { fetch() { return new Response("synthetic only"); } };',
    compatibilityDate: "2026-08-25", d1Databases: { DB: "p544-disposable" } }],
}));
const hash = "a".repeat(64), actor = "b".repeat(64), now = "2026-09-18T00:00:00.000Z";
let checks = 0;
try {
  const db = await mf.getD1Database("DB");
  const rows = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  const run = async (sql, ...args) => db.prepare(sql).bind(...args).run();
  const stmt = (sql, ...args) => db.prepare(sql).bind(...args);
  const insert = (table, value) => stmt(`INSERT INTO ${table} (${Object.keys(value).join(",")}) VALUES (${Object.keys(value).map(() => "?").join(",")})`, ...Object.values(value));
  const sources = (await readdir(path.join(root, "migrations"))).filter(n => /^\d{4}_.*\.sql$/.test(n)).sort();
  assert.equal(sources.at(-1), "0014_phase5_full_validation_finish.sql");
  const apply = async (name, suffix = []) => {
    if ((await rows("SELECT name FROM d1_migrations WHERE name=?", name)).length) return;
    const sql = await readFile(path.join(root, "migrations", name), "utf8");
    await db.batch([...unstable_splitSqlQuery(sql).map(s => stmt(s)),
      ...suffix, stmt("INSERT INTO d1_migrations(name) VALUES (?)", name)]);
  };
  await run("CREATE TABLE d1_migrations(name TEXT PRIMARY KEY)");
  for (const name of sources.slice(0, 13)) await apply(name);
  const schema = () => rows("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name");
  const legacyTables = (await schema()).filter(r => r.type === "table" && r.name !== "d1_migrations").map(r => r.name);
  assert.equal(legacyTables.length, 45);
  const allRows = async () => Promise.all(legacyTables.map(t => rows(`SELECT * FROM ${t} ORDER BY 1,2`)));
  const fixture = await readFile(path.join(root, "tests/fixtures/published-quiz.sql"), "utf8");
  const seed = fixture.slice(0, fixture.indexOf("INSERT INTO quiz_entries_public (")) + fixture.slice(fixture.indexOf("INSERT INTO site_state ("));
  // Fixture contains plain insert statements, no trigger bodies.
  await db.batch(seed.split(";").map(s => s.trim()).filter(Boolean).map(s => stmt(s)));
  const [{ id: sermon }] = await rows("SELECT id FROM sermons");
  const [{ id: quiz }] = await rows("SELECT id FROM quiz_sets");
  await run("INSERT INTO sermon_metadata_drafts VALUES (?,1,1,'SYNTHETIC_ONLY','2026-09-18','{}')", sermon);
  function job(id, version = 1) {
    return { id, sermon_id: sermon, quiz_set_id: quiz, request_scope: "full", request_contract_version: version,
      request_key: id, request_fingerprint: hash, workflow_instance_id: id, start_input_state: "absent",
      start_input_version: null, start_source_id: null, start_document_id: null, start_document_sha256: null,
      start_confirmation_id: null, start_metadata_revision: 1, settings_revision: null, selection_revision: null,
      status: "dispatch_pending", current_step: "dispatch", state_version: 0, event_count: 1,
      wait_kind: null, wait_generation: 0, wait_input_fingerprint: null, error_code: null, error_message_safe: null,
      error_fingerprint: null, created_by_actor_id: actor, created_at: now, updated_at: now, completed_at: null,
      required_event_no: 1, required_event_state_version: 0 };
  }
  function dispatch(id, version = 1) {
    return { id: id + "_dispatch", generation_job_id: id, dispatch_no: 1, kind: "start", dispatch_key: id + "_dispatch",
      workflow_instance_id: id, job_state_version: 0, wait_generation: null, payload_fingerprint: hash,
      state: "pending", attempt_count: 0, claim_token: null, lease_expires_at: null, error_code: null,
      error_message_safe: null, error_fingerprint: null, created_at: now, last_attempted_at: null, acknowledged_at: null,
      ...(version === 2 ? { context_id: id + "_context", command_ordinal: null, required_attempt: null, receiver_dispatch_id: null } : {}) };
  }
  function event(id, no = 1, code = "job_created", step = null) {
    return { generation_job_id: id, event_no: no, job_state_version: no - 1, attempt_number: 1, step_key: step,
      level: "info", event_code: code, message_safe: code, metadata_json_safe: null, elapsed_ms: null, created_at: now };
  }
  await db.batch([insert("generation_jobs", job("legacy")), insert("generation_job_dispatches", dispatch("legacy")), insert("generation_job_events", event("legacy"))]);
  // Keep a referenced terminal legacy job without editing any stored request.
  await db.batch([
    stmt("UPDATE generation_jobs SET status='stale',state_version=1,event_count=2,required_event_no=2,required_event_state_version=1,completed_at=? WHERE id='legacy'", now),
    insert("generation_job_events", event("legacy", 2, "job_stale")),
  ]);
  const before = await allRows(), beforeSchema = await schema();
  const beforeFks = await Promise.all(legacyTables.map(t => rows(`PRAGMA foreign_key_list(${t})`)));
  // Entire migration rolls back even after every DDL/guard and deferral reset.
  await assert.rejects(apply(sources[13], [stmt("INSERT INTO p544_missing_table VALUES(1)")]));
  assert.deepEqual(await schema(), beforeSchema);
  assert.deepEqual(await allRows(), before);
  checks++;
  await apply(sources[13]);
  const after = await allRows();
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].length, before[i].length);
    for (let j = 0; j < before[i].length; j++) {
      for (const [key, value] of Object.entries(before[i][j])) assert.deepEqual(after[i][j][key], value);
    }
  }
  const afterSchema = await schema();
  const changedTables = new Set(["generation_jobs", "generation_job_events", "generation_job_dispatches", "generation_step_receipts", "ai_provider_calls"]);
  const changedTriggers = new Set(["generation_dispatch_insert_guard", "generation_dispatch_update_guard", "generation_receipt_update_guard", "ai_provider_call_update_guard"]);
  const normalizedSql = sql => sql.replace(/["`]/gu, "").replace(/\s+/gu, " ").trim().toLowerCase();
  for (const prior of beforeSchema) {
    if (prior.name === "d1_migrations") continue;
    const current = afterSchema.find(item => item.name === prior.name && item.type === prior.type);
    assert.ok(current, `Preserve schema object ${prior.name}`);
    if ((prior.type === "table" && changedTables.has(prior.name)) || changedTriggers.has(prior.name)) continue;
    const expectedSql = prior.name === "generation_job_update_guard"
      ? prior.sql.replace("OLD.status = 'awaiting_transcript_review' AND NEW.status IN ('running','failed','stale')",
        "OLD.status = 'awaiting_transcript_review' AND NEW.status IN ('running','awaiting_transcript_review','failed','stale')")
      : prior.sql;
    assert.equal(normalizedSql(current.sql), normalizedSql(expectedSql), `Preserve ${prior.type} ${prior.name}`);
  }
  const fkShape = ({ table, from, to, on_update, on_delete, match }) => ({ table, from, to, on_update, on_delete, match });
  for (let i = 0; i < legacyTables.length; i++) {
    const current = (await rows(`PRAGMA foreign_key_list(${legacyTables[i]})`)).map(fkShape);
    for (const old of beforeFks[i].map(fkShape)) assert.ok(current.some(item => JSON.stringify(item) === JSON.stringify(old)), `Preserve FK ${legacyTables[i]}.${old.from}`);
  }
  checks++;
  const addedTables = afterSchema.filter(r => r.type === "table" && !legacyTables.includes(r.name) && r.name !== "d1_migrations");
  assert.equal(addedTables.length, 12);
  for (const { name } of addedTables) assert.deepEqual(await rows(`SELECT * FROM ${name}`), []);
  assert.deepEqual(await rows("PRAGMA foreign_key_check"), []);
  assert.deepEqual(await rows("PRAGMA quick_check"), [{ quick_check: "ok" }]);
  checks++;
  await apply(sources[13]);
  assert.deepEqual(await schema(), afterSchema);
  assert.deepEqual(await allRows(), after);
  checks++;
  await assert.rejects(run("UPDATE generation_jobs SET status='running',state_version=2,event_count=3,required_event_no=3,required_event_state_version=2 WHERE id='legacy'"));
  await assert.rejects(run("UPDATE generation_job_dispatches SET state='claimed',attempt_count=1,claim_token='old',lease_expires_at=? WHERE id='legacy_dispatch'", now));
  await assert.rejects(db.batch([insert("generation_jobs", job("new_legacy")), insert("generation_job_dispatches", dispatch("new_legacy")), insert("generation_job_events", event("new_legacy"))]));
  assert.deepEqual(await allRows(), after);
  checks++;
  // SQL structure fixtures are not validated domain contexts; SHA/payload
  // semantic validation belongs to the already-tested codec and future writer.
  let inputProjection = {};
  let contentProjection = {};
  function context(id, kind = "request", contextId = id + "_context") {
    return { id: contextId, job_id: id, sermon_id: sermon, quiz_set_id: quiz, kind,
      contract_version: 2, validator_version: 1, assembly_version: 1,
      codec: "generation-context-json-utf8-v1", fingerprint: hash, byte_length: 2,
      chunk_count: 1, reference_count: 0, state: "assembling", required_state: "sealed", created_at: now,
      input_state: "absent", input_version: null, source_id: null, document_id: null,
      document_sha256: null, confirmation_id: null, content_count: 0, last_content_event_id: null,
      analysis_event_id: null, critique_event_id: null, intent_confirmation_event_id: null,
      summary_event_id: null, summary_review_event_id: null, child_event_id: null,
      child_review_event_id: null, adult_event_id: null, adult_review_event_id: null,
      metadata_revision: 1, settings_revision: null, selection_revision: null, ticket_id: null, ticket_fingerprint: null, ...inputProjection, ...contentProjection };
  }
  function evidence(id, values = {}) {
    return { job_id: id, event_no: 1, before_version: null, after_version: 0, before_status: null,
      after_status: "dispatch_pending", before_stage: null, after_stage: "dispatch", before_wait: null,
      after_wait: null, reason: "job_created", context_id: id + "_context", fingerprint: hash,
      step_key: null, attempt: null, dispatch_id: null, command_ordinal: null, ...values };
  }
  function creation(id, mutate = x => x, scope = "full") {
    const c = mutate(context(id));
    return [
      ["job", insert("generation_jobs", { ...job(id, 2), request_scope: scope, start_input_state: c.input_state,
        start_input_version: c.input_version, start_source_id: c.source_id, start_document_id: c.document_id,
        start_document_sha256: c.document_sha256, start_confirmation_id: c.confirmation_id, request_context_id: id + "_context", evidence_event_no: 1, active_wait_generation: null })],
      ["context", insert("generation_contexts", c)],
      ["chunk", insert("generation_context_chunks", { context_id: id + "_context", position: 0, byte_length: 2, sha256: hash, body: new TextEncoder().encode("{}"), verified: 1 })],
      ["link", insert("generation_request_contexts", { job_id: id, context_id: id + "_context", fingerprint: hash })],
      ["seal", stmt("UPDATE generation_contexts SET state='sealed' WHERE id=?", id + "_context")],
      ["dispatch", insert("generation_job_dispatches", dispatch(id, 2))],
      ["evidence", insert("generation_transition_evidence", evidence(id))],
      ["event", insert("generation_job_events", event(id))],
    ];
  }
  for (const missing of ["context", "chunk", "link", "seal", "dispatch", "evidence", "event"]) {
    const id = "missing_" + missing;
    await assert.rejects(db.batch(creation(id).filter(([label]) => label !== missing).map(([, statement]) => statement)));
    assert.deepEqual(await rows("SELECT id FROM generation_jobs WHERE id=?", id), []);
    assert.deepEqual(await rows("SELECT id FROM generation_contexts WHERE job_id=?", id), []);
    checks++;
  }
  for (const override of [{ byte_length: 65537 }, { chunk_count: 2 }, { reference_count: 33 }, { kind: "wait" }, { source_id: "missing" }]) {
    await assert.rejects(db.batch(creation("invalid_context", c => ({ ...c, ...override })).map(([, statement]) => statement)));
    assert.deepEqual(await rows("SELECT id FROM generation_jobs WHERE id='invalid_context'"), []);
    checks++;
  }
  await db.batch(creation("v2").map(([, statement]) => statement));
  checks++;
  for (const sql of [
    "UPDATE generation_contexts SET fingerprint='" + actor + "' WHERE id='v2_context'",
    "DELETE FROM generation_context_chunks WHERE context_id='v2_context'",
    "INSERT OR REPLACE INTO generation_request_contexts SELECT * FROM generation_request_contexts WHERE job_id='v2'",
    "UPDATE generation_jobs SET status='running',state_version=1,event_count=2,required_event_no=2,required_event_state_version=1,evidence_event_no=2 WHERE id='v2'",
  ]) { await assert.rejects(run(sql)); checks++; }
  const lease1 = "2026-09-18T00:01:00.000Z", lease2 = "2026-09-18T00:02:00.000Z";
  function claim(attempt, token, reserved, lease) {
    return [
      stmt("UPDATE generation_job_dispatches SET state='claimed',attempt_count=?,required_attempt=?,claim_token=?,lease_expires_at=?,last_attempted_at=? WHERE id='v2_dispatch' AND attempt_count=?", attempt, attempt, token, lease, reserved, attempt - 1),
      insert("generation_dispatch_attempts", { dispatch_id: "v2_dispatch", attempt, claim_token: token, lease_expires_at: lease,
        state: "reserved", reserved_at: reserved, send_started_at: null, ended_at: null }),
    ];
  }
  await assert.rejects(db.batch(claim(1, "first", now, lease1).slice(0, 1)));
  assert.equal((await rows("SELECT attempt_count FROM generation_job_dispatches WHERE id='v2_dispatch'"))[0].attempt_count, 0);
  await db.batch(claim(1, "first", now, lease1));
  await assert.rejects(db.batch(claim(2, "second", lease1, lease2)));
  await db.batch([
    stmt("UPDATE generation_dispatch_attempts SET state='expired',ended_at=? WHERE dispatch_id='v2_dispatch' AND attempt=1", lease1),
    ...claim(2, "second", lease1, lease2),
  ]);
  await assert.rejects(run("UPDATE generation_dispatch_attempts SET state='send_started',send_started_at=? WHERE dispatch_id='v2_dispatch' AND attempt=1", lease1));
  await run("UPDATE generation_dispatch_attempts SET state='send_started',send_started_at=? WHERE dispatch_id='v2_dispatch' AND attempt=2", lease1);
  await assert.rejects(run("UPDATE generation_job_dispatches SET state='retryable_failed',claim_token=NULL,lease_expires_at=NULL WHERE id='v2_dispatch'"));
  checks += 5;
  const receipt = { dispatch_id: "v2_dispatch", job_id: "v2", workflow_instance_id: "v2", request_context_id: "v2_context",
    request_fingerprint: hash, payload_fingerprint: hash, context_id: "v2_context", wait_generation: null,
    command_ordinal: null, event_no: 2, state_version: 1, received_at: lease1 };
  function receive(overrides = {}, id = "v2", stage = "input_resolve") {
    return [
      ["evidence", insert("generation_transition_evidence", evidence(id, { event_no: 2, before_version: 0, after_version: 1,
        before_status: "dispatch_pending", after_status: "running", before_stage: "dispatch", after_stage: stage,
        reason: "received", attempt: id === "v2" ? 2 : 1, dispatch_id: id + "_dispatch" }))],
      ["receipt", insert("generation_dispatch_receipts", { ...receipt, dispatch_id: id + "_dispatch", job_id: id,
        workflow_instance_id: id, request_context_id: id + "_context", context_id: id + "_context", ...overrides })],
      ["ack", stmt("UPDATE generation_job_dispatches SET state='acknowledged',receiver_dispatch_id=id,claim_token=NULL,lease_expires_at=NULL,acknowledged_at=? WHERE id=?", lease1, id + "_dispatch")],
      ["job", stmt("UPDATE generation_jobs SET status='running',current_step=?,state_version=1,event_count=2,required_event_no=2,required_event_state_version=1,evidence_event_no=2 WHERE id=? AND state_version=0", stage, id)],
      ["event", insert("generation_job_events", { ...event(id, 2, "received"), attempt_number: id === "v2" ? 2 : 1 })],
    ];
  }
  for (const missing of ["evidence", "receipt", "ack", "job", "event"]) {
    await assert.rejects(db.batch(receive().filter(([label]) => label !== missing).map(([, statement]) => statement)));
    assert.deepEqual(await rows("SELECT * FROM generation_dispatch_receipts"), []);
    assert.equal((await rows("SELECT status FROM generation_jobs WHERE id='v2'"))[0].status, "dispatch_pending");
    checks++;
  }
  for (const override of [{ workflow_instance_id: "wrong" }, { request_fingerprint: actor }, { payload_fingerprint: actor }, { wait_generation: 1 }]) {
    await assert.rejects(db.batch(receive(override).map(([, statement]) => statement)));
    checks++;
  }
  await db.batch(receive().map(([, statement]) => statement));
  assert.equal((await rows("SELECT status FROM generation_jobs WHERE id='v2'"))[0].status, "running");
  assert.deepEqual(await rows("PRAGMA foreign_key_check"), []);
  checks++;
  function stepClaim(id, key, task, effect = "pure", options = {}) {
    const ctx = { ...context(id, "step", options.contextId ?? id + "_step_context"), ...options.context };
    return [
      ["context", insert("generation_contexts", ctx)],
      ["receipt", insert("generation_step_receipts", { generation_job_id: id, step_key: key, task, effect_class: effect,
        input_contract_version: 2, input_fingerprint: hash, input_version: ctx.input_version, source_id: ctx.source_id,
        document_id: ctx.document_id, document_sha256: ctx.document_sha256, confirmation_id: ctx.confirmation_id,
        metadata_revision: 1, binding_id: null, ticket_id: null, state: "claimed", attempt_count: 1,
        claim_token: "step_token", lease_expires_at: lease2, provider_request_id_opaque: null, result_kind: null,
        result_id: null, result_version: null, result_fingerprint: null, error_code: null, error_message_safe: null,
        error_fingerprint: null, started_at: now, updated_at: now, completed_at: null,
        context_id: ctx.id, outcome_attempt: null })],
      ["link", insert("generation_step_contexts", { job_id: id, step_key: key, context_id: ctx.id, request_context_id: id + "_context",
        task, input_fingerprint: hash, predecessor_event_no: 2, predecessor_state_version: 1, predecessor_kind: "request", command_ordinal: null, ...options.link })],
      ["chunk", insert("generation_context_chunks", { context_id: ctx.id, position: 0, byte_length: 2, sha256: hash,
        body: new TextEncoder().encode("{}"), verified: 1 })],
      ["seal", stmt("UPDATE generation_contexts SET state='sealed' WHERE id=?", ctx.id)],
    ];
  }
  for (const missing of ["context", "receipt", "link", "chunk", "seal"]) {
    await assert.rejects(db.batch(stepClaim("v2", "input_resolve", "fetch_transcript").filter(([label]) => label !== missing).map(([, s]) => s)));
    assert.deepEqual(await rows("SELECT * FROM generation_step_receipts WHERE generation_job_id='v2'"), []);
    checks++;
  }
  await db.batch(stepClaim("v2", "input_resolve", "fetch_transcript").map(([, s]) => s));
  await assert.rejects(db.batch(stepClaim("v2", "summary", "summary").map(([, s]) => s)));
  checks += 2;
  function failedStep(id, key, task, outcome = "stale", callId = null) {
    const reason = outcome === "uncertain" ? "usage_unknown" : "authority_changed";
    const code = "step_" + outcome;
    return [
      ["evidence", insert("generation_transition_evidence", evidence(id, { event_no: 3, before_version: 1, after_version: 2,
        before_status: "running", after_status: "stale", before_stage: key, after_stage: key, reason: code,
        context_id: id + "_step_context", step_key: key, attempt: 1 }))],
      ["outcome", insert("generation_step_outcomes", { job_id: id, step_key: key, attempt: 1, context_id: id + "_step_context",
        input_fingerprint: hash, task, outcome, reason, event_no: 3, state_version: 2, call_id: callId,
        usage_event_id: null, result_step_key: null, before_input_version: inputProjection.input_version ?? null,
        after_input_version: inputProjection.input_version ?? null, before_content_count: 0, after_content_count: 0 })],
      ["receipt", stmt("UPDATE generation_step_receipts SET state=?,outcome_attempt=1,claim_token=NULL,lease_expires_at=NULL,completed_at=? WHERE generation_job_id=? AND step_key=?", outcome, lease1, id, key)],
      ["job", stmt("UPDATE generation_jobs SET status='stale',state_version=2,event_count=3,required_event_no=3,required_event_state_version=2,evidence_event_no=3,completed_at=? WHERE id=? AND state_version=1", lease1, id)],
      ["event", insert("generation_job_events", event(id, 3, code, key))],
    ];
  }
  for (const missing of ["evidence", "outcome", "receipt", "job", "event"]) {
    await assert.rejects(db.batch(failedStep("v2", "input_resolve", "fetch_transcript").filter(([label]) => label !== missing).map(([, s]) => s)));
    assert.deepEqual(await rows("SELECT * FROM generation_step_outcomes WHERE job_id='v2'"), []);
    checks++;
  }
  await db.batch(failedStep("v2", "input_resolve", "fetch_transcript").map(([, s]) => s));
  checks++;
  // Add a sealed synthetic source and confirmation for the AI storage fixture.
  for (const [version, id, kind] of [[1, "source", "source"], [2, "confirmation", "confirm"]]) {
    await db.batch([
      insert("sermon_input_events", { sermon_id: sermon, version, id, kind, source_type: "caption_plain", source_id: "source",
        document_id: "source", confirmation_id: version === 2 ? "confirmation" : null, parent_document_id: version === 2 ? "source" : null,
        related_id: null, document_sha256: hash, payload_sha256: hash, chunk_count: 1, byte_length: 2,
        actor_id: actor, created_at: now, state: "pending", required_state: "sealed" }),
      insert("sermon_input_chunks", { sermon_id: sermon, event_id: id, position: 0, body: "{}" }),
      version === 1 ? insert("sermon_input_heads", { sermon_id: sermon, version }) : stmt("UPDATE sermon_input_heads SET version=2 WHERE sermon_id=?", sermon),
      stmt("UPDATE sermon_input_events SET state='sealed' WHERE sermon_id=? AND id=?", sermon, id),
    ]);
  }
  inputProjection = { input_state: "present", input_version: 2, source_id: "source", document_id: "source", document_sha256: hash, confirmation_id: "confirmation" };
  await db.batch(creation("late", x => x, "summary").map(([, s]) => s));
  await db.batch([
    stmt("UPDATE generation_job_dispatches SET state='claimed',attempt_count=1,required_attempt=1,claim_token='late_token',lease_expires_at=?,last_attempted_at=? WHERE id='late_dispatch'", lease2, now),
    insert("generation_dispatch_attempts", { dispatch_id: "late_dispatch", attempt: 1, claim_token: "late_token", lease_expires_at: lease2, state: "reserved", reserved_at: now, send_started_at: null, ended_at: null }),
  ]);
  await run("UPDATE generation_dispatch_attempts SET state='send_started',send_started_at=? WHERE dispatch_id='late_dispatch'", now);
  await db.batch(receive({}, "late", "summary").map(([, s]) => s));
  await db.batch(stepClaim("late", "summary", "summary", "ai_provider").map(([, s]) => s));
  await db.batch([
    stmt("UPDATE generation_step_receipts SET state='effect_started' WHERE generation_job_id='late'"),
    insert("ai_provider_calls", { id: "late_call", generation_job_id: "late", step_key: "summary", attempt_number: 1,
      quiz_set_id: quiz, sermon_id: sermon, task: "summary", input_fingerprint: hash, provider: "synthetic",
      model: "synthetic", reasoning_effort: null, state: "effect_started", provider_request_id_opaque: null, started_at: now, completed_at: null, settlement_call_id: null }),
  ]);
  await db.batch([stmt("UPDATE ai_provider_calls SET state='uncertain',completed_at=? WHERE id='late_call'", lease1), ...failedStep("late", "summary", "summary", "uncertain", "late_call").map(([, s]) => s)]);
  const terminal = await rows("SELECT * FROM generation_jobs WHERE id='late'");
  const terminalReceipt = await rows("SELECT * FROM generation_step_receipts WHERE generation_job_id='late'");
  const terminalOutcome = await rows("SELECT * FROM generation_step_outcomes WHERE job_id='late'");
  const observation = { call_id: "late_call", usage_event_id: "late_usage", job_id: "late", sermon_id: sermon, quiz_set_id: quiz,
    step_key: "summary", attempt: 1, context_id: "late_step_context", input_fingerprint: hash, task: "summary", provider: "synthetic",
    model: "synthetic", reasoning_effort: null, provider_request_id_opaque: null, input_tokens: 12, cached_input_tokens: null,
    reasoning_tokens: null, output_tokens: 4, audio_input_tokens: null, audio_seconds: null, pricing_version: "synthetic_v1",
    estimated_cost_micro_usd: 7, usage_source: "provider_partial", started_at: now, observed_at: lease1, fingerprint: hash };
  await db.batch([insert("ai_usage_observations", observation)]);
  await assert.rejects(db.batch([insert("ai_usage_observations", { ...observation, input_tokens: 13 })]));
  const usage = { id: "late_usage", provider_call_id: "late_call", generation_job_id: "late", step_key: "summary", attempt_number: 1,
    quiz_set_id: quiz, sermon_id: sermon, task: "summary", provider: "synthetic", model: "synthetic", input_tokens: 12,
    cached_input_tokens: null, reasoning_tokens: null, output_tokens: 4, audio_input_tokens: null, audio_seconds: null,
    pricing_version: "synthetic_v1", estimated_cost_micro_usd: 7, usage_source: "provider_partial", observed_at: lease1 };
  function settlement(override = {}) {
    return [
      ["call", stmt("UPDATE ai_provider_calls SET state='completed',completed_at=?,settlement_call_id=id WHERE id='late_call'", lease2)],
      ["usage", insert("ai_usage_events", { ...usage, ...override })],
      ["settlement", insert("ai_usage_settlements", { call_id: "late_call", usage_event_id: "late_usage", job_id: "late", step_key: "summary", attempt: 1, fingerprint: hash, settled_at: lease2 })],
    ];
  }
  for (const missing of ["call", "usage", "settlement"]) {
    await assert.rejects(db.batch(settlement().filter(([label]) => label !== missing).map(([, s]) => s)));
    assert.deepEqual(await rows("SELECT * FROM ai_usage_events WHERE provider_call_id='late_call'"), []);
    assert.equal((await rows("SELECT state FROM ai_provider_calls WHERE id='late_call'"))[0].state, "uncertain");
    checks++;
  }
  for (const override of [{ input_tokens: 13 }, { cached_input_tokens: 0 }, { estimated_cost_micro_usd: 8 }, { pricing_version: "wrong" }, { observed_at: lease2 }, { usage_source: "provider_reported" }]) {
    await assert.rejects(db.batch(settlement(override).map(([, s]) => s)));
    checks++;
  }
  await db.batch(settlement().map(([, s]) => s));
  assert.deepEqual(await rows("SELECT * FROM generation_jobs WHERE id='late'"), terminal);
  assert.deepEqual(await rows("SELECT * FROM generation_step_receipts WHERE generation_job_id='late'"), terminalReceipt);
  assert.deepEqual(await rows("SELECT * FROM generation_step_outcomes WHERE job_id='late'"), terminalOutcome);
  assert.deepEqual(await rows("SELECT * FROM generation_step_result_links WHERE generation_job_id='late'"), []);
  assert.equal((await rows("SELECT sum(estimated_cost_micro_usd) AS cost FROM ai_usage_events WHERE generation_job_id='late'"))[0].cost, 7);
  await assert.rejects(db.batch(settlement().map(([, s]) => s)));
  assert.deepEqual(await rows("PRAGMA foreign_key_check"), []);
  checks += 4;
  // P5-44b: physical wait/registration bundles only. These {} context payloads
  // do not certify domain/G03 progression or actual Workflow/command execution.
  const completeTables = (await schema()).filter(r => r.type === "table" && r.name !== "d1_migrations").map(r => r.name);
  // A single read batch gives every failure comparison one consistent snapshot.
  const completeRows = async () => (await db.batch(completeTables.map(t => stmt(`SELECT * FROM ${t} ORDER BY 1,2`)))).map(r => r.results);
  async function rejectBundle(bundle, label, expectedError) {
    const before = await completeRows();
    await assert.rejects(db.batch(bundle.map(([, s]) => s)), expectedError, label);
    assert.deepEqual(await completeRows(), before, label + " must roll back every row");
    checks++;
    if (checks % 50 === 0) console.log(`P5-44 progress: ${checks} checked bundles`);
  }
  async function startPhysicalJob(id, scope = "full", stage = "input_resolve") {
    await db.batch(creation(id, x => x, scope).map(([, s]) => s));
    await db.batch([
      stmt("UPDATE generation_job_dispatches SET state='claimed',attempt_count=1,required_attempt=1,claim_token='wait_token',lease_expires_at=?,last_attempted_at=? WHERE id=?", lease2, now, id + "_dispatch"),
      insert("generation_dispatch_attempts", { dispatch_id: id + "_dispatch", attempt: 1, claim_token: "wait_token", lease_expires_at: lease2, state: "reserved", reserved_at: now, send_started_at: null, ended_at: null }),
    ]);
    await run("UPDATE generation_dispatch_attempts SET state='send_started',send_started_at=? WHERE dispatch_id=?", now, id + "_dispatch");
    await db.batch(receive({}, id, stage).map(([, s]) => s));
  }
  function enterWait(id, { kind = "transcript_review", stage = "input_resolve", link = {}, proof = {}, fingerprint = hash } = {}) {
    const c = context(id, "wait", id + "_wait_context");
    const status = "awaiting_" + kind;
    return [
      ["context", insert("generation_contexts", c)],
      ["chunk", insert("generation_context_chunks", { context_id: c.id, position: 0, byte_length: 2, sha256: hash, body: new TextEncoder().encode("{}"), verified: 1 })],
      ["evidence", insert("generation_transition_evidence", evidence(id, { event_no: 3, before_version: 1, after_version: 2,
        before_status: "running", after_status: status, before_stage: stage, after_stage: kind, after_wait: 1,
        reason: "wait_entered", context_id: c.id, ...proof }))],
      ["link", insert("generation_wait_contexts", { job_id: id, wait_generation: 1, context_id: c.id,
        request_context_id: id + "_context", kind, enter_event_no: 3, enter_state_version: 2,
        parent_wait_generation: null, command_ordinal: null, parent_step_key: null, parent_attempt: null, ...link })],
      ["seal", stmt("UPDATE generation_contexts SET state='sealed' WHERE id=?", c.id)],
      ["job", stmt("UPDATE generation_jobs SET status=?,current_step=?,state_version=2,event_count=3,required_event_no=3,required_event_state_version=2,evidence_event_no=3,wait_kind=?,wait_generation=1,active_wait_generation=1,wait_input_fingerprint=? WHERE id=? AND state_version=1", status, kind, kind, fingerprint, id)],
      ["event", insert("generation_job_events", event(id, 3, "wait_entered"))],
    ];
  }
  function registerCorrection(id, { suffix = "", ordinal = 1, key = "correct_once", contextValues = {}, commandValues = {}, dispatchValues = {} } = {}) {
    const c = { ...context(id, "step", id + "_correction_context" + suffix), ...contextValues };
    return [
      ["context", insert("generation_contexts", c)],
      ["command", insert("generation_control_commands", { job_id: id, ordinal, command_key: key,
        wait_generation: 1, context_id: c.id, actor_digest: actor, fingerprint: hash, state: "pending",
        step_key: "correction_" + ordinal, outcome_attempt: null, created_at: now, ...commandValues })],
      ["chunk", insert("generation_context_chunks", { context_id: c.id, position: 0, byte_length: 2, sha256: hash, body: new TextEncoder().encode("{}"), verified: 1 })],
      ["dispatch", insert("generation_job_dispatches", { ...dispatch(id, 2), id: id + "_correction_dispatch" + suffix,
        dispatch_no: 2, kind: "correction", dispatch_key: id + "_correction_dispatch" + suffix,
        job_state_version: 2, wait_generation: 1, context_id: c.id, command_ordinal: ordinal, ...dispatchValues })],
      ["seal", stmt("UPDATE generation_contexts SET state='sealed' WHERE id=?", c.id)],
    ];
  }
  async function closePhysicalJob(id) {
    const [j] = await rows("SELECT * FROM generation_jobs WHERE id=?", id);
    await db.batch([
      insert("generation_transition_evidence", evidence(id, { event_no: j.event_count + 1, before_version: j.state_version,
        after_version: j.state_version + 1, before_status: j.status, after_status: "stale", before_stage: j.current_step,
        after_stage: j.current_step, before_wait: j.active_wait_generation, reason: "job_stale" })),
      stmt("UPDATE generation_control_commands SET state='stale' WHERE job_id=? AND state='pending'", id),
      stmt("UPDATE generation_job_dispatches SET state='stale',claim_token=NULL,lease_expires_at=NULL WHERE generation_job_id=? AND state IN ('pending','claimed','retryable_failed','uncertain')", id),
      stmt("UPDATE generation_jobs SET status='stale',state_version=state_version+1,event_count=event_count+1,required_event_no=event_count+1,required_event_state_version=state_version+1,evidence_event_no=event_count+1,wait_kind=NULL,active_wait_generation=NULL,wait_input_fingerprint=NULL,completed_at=? WHERE id=?", now, id),
      insert("generation_job_events", event(id, j.event_count + 1, "job_stale")),
    ]);
  }
  await startPhysicalJob("wait_full");
  for (const missing of ["context", "chunk", "evidence", "link", "seal", "job", "event"]) {
    await rejectBundle(enterWait("wait_full").filter(([label]) => label !== missing), "wait missing " + missing);
  }
  for (const zero of ["seal", "job"]) {
    await rejectBundle(enterWait("wait_full").map(([label, s]) => [label, label === zero
      ? stmt("UPDATE generation_jobs SET status='running' WHERE 0") : s]), "wait zero-row " + zero);
  }
  for (const bad of [{ link: { enter_state_version: 9 } }, { link: { request_context_id: "late_context" } },
    { proof: { context_id: "wait_full_context" } }, { fingerprint: actor }]) {
    await rejectBundle(enterWait("wait_full", bad), "wait identity mismatch");
  }
  await db.batch(enterWait("wait_full").map(([, s]) => s));
  const waitingJob = await rows("SELECT * FROM generation_jobs WHERE id='wait_full'");
  checks++;
  for (const missing of ["context", "command", "chunk", "dispatch", "seal"]) {
    await rejectBundle(registerCorrection("wait_full").filter(([label]) => label !== missing), "registration missing " + missing);
  }
  await rejectBundle(registerCorrection("wait_full").map(([label, s]) => [label, label === "seal"
    ? stmt("UPDATE generation_contexts SET state='sealed' WHERE 0") : s]), "registration zero-row seal");
  for (const bad of [{ ordinal: 2 }, { commandValues: { wait_generation: 2 } }, { commandValues: { state: "running" } },
    { contextValues: { confirmation_id: null } }, { contextValues: { input_version: 1 } },
    { contextValues: { document_sha256: actor } }, { contextValues: { selection_revision: "changed" } },
    { dispatchValues: { job_state_version: 1 } }, { dispatchValues: { wait_generation: 2 } }]) {
    await rejectBundle(registerCorrection("wait_full", bad), "registration identity mismatch");
  }
  await db.batch(registerCorrection("wait_full").map(([, s]) => s));
  assert.deepEqual(await rows("SELECT * FROM generation_jobs WHERE id='wait_full'"), waitingJob);
  assert.equal((await rows("SELECT state FROM generation_control_commands WHERE job_id='wait_full'"))[0].state, "pending");
  assert.equal((await rows("SELECT count(*) AS n FROM generation_job_dispatches WHERE generation_job_id='wait_full' AND kind='correction'"))[0].n, 1);
  checks++;
  for (const bad of [{ suffix: "_dup" }, { suffix: "_key", ordinal: 2 }, { suffix: "_second", ordinal: 2, key: "another" }]) {
    await rejectBundle(registerCorrection("wait_full", bad), "duplicate key/ordinal or second pending command");
  }
  await rejectBundle([["duplicate dispatch", insert("generation_job_dispatches", {
    ...(await rows("SELECT * FROM generation_job_dispatches WHERE id='wait_full_correction_dispatch'"))[0],
    id: "duplicate_correction_dispatch", dispatch_key: "duplicate_correction_dispatch", dispatch_no: 3,
  })]], "one correction outbox per command");
  for (const sql of ["UPDATE generation_wait_contexts SET kind='intent_review' WHERE job_id='wait_full'",
    "DELETE FROM generation_wait_contexts WHERE job_id='wait_full'",
    "UPDATE generation_control_commands SET command_key='changed' WHERE job_id='wait_full'"]) {
    await rejectBundle([["mutation", stmt(sql)]], "immutable wait/command identity");
  }
  await closePhysicalJob("wait_full");
  await startPhysicalJob("wait_summary", "summary", "summary");
  await rejectBundle(enterWait("wait_summary", { stage: "summary" }), "scope cannot enter transcript wait");
  await rejectBundle(registerCorrection("wait_summary"), "scope cannot register correction");
  await closePhysicalJob("wait_summary");
  await startPhysicalJob("wait_intent", "intent", "transcript_review");
  await db.batch(enterWait("wait_intent", { kind: "transcript_review", stage: "transcript_review" }).map(([, s]) => s));
  await rejectBundle(registerCorrection("wait_intent"), "intent wait cannot register correction");
  await closePhysicalJob("wait_intent");
  // P5-44c: D1 batch serialization and exact wait consumption, no transport.
  function resumeDispatch(id, overrides = {}) {
    return insert("generation_job_dispatches", { ...dispatch(id, 2), id: id + "_resume_dispatch",
      dispatch_no: 2, kind: "resume_transcript_review", dispatch_key: id + "_resume_dispatch",
      job_state_version: 2, wait_generation: 1, context_id: id + "_wait_context", ...overrides });
  }
  async function prepareSend(dispatchId, uncertain = false) {
    await db.batch([
      stmt("UPDATE generation_job_dispatches SET state='claimed',attempt_count=1,required_attempt=1,claim_token='consume_token',lease_expires_at=?,last_attempted_at=? WHERE id=?", lease2, now, dispatchId),
      insert("generation_dispatch_attempts", { dispatch_id: dispatchId, attempt: 1, claim_token: "consume_token",
        lease_expires_at: lease2, state: "reserved", reserved_at: now, send_started_at: null, ended_at: null }),
    ]);
    await run("UPDATE generation_dispatch_attempts SET state='send_started',send_started_at=? WHERE dispatch_id=?", now, dispatchId);
    if (uncertain) await run("UPDATE generation_job_dispatches SET state='uncertain',claim_token=NULL,lease_expires_at=NULL WHERE id=?", dispatchId);
  }
  function consumeWait(id, correction, { receiver = {}, proof = {} } = {}) {
    const dispatchId = id + (correction ? "_correction_dispatch" : "_resume_dispatch");
    const contextId = id + (correction ? "_correction_context" : "_wait_context");
    const stage = correction ? "correction_1" : "intent_analysis";
    return [
      ["evidence", insert("generation_transition_evidence", evidence(id, { event_no: 4, before_version: 2, after_version: 3,
        before_status: "awaiting_transcript_review", after_status: "running", before_stage: "transcript_review",
        after_stage: stage, before_wait: 1, after_wait: null, reason: "received", context_id: contextId,
        attempt: 1, dispatch_id: dispatchId, command_ordinal: correction ? 1 : null, ...proof }))],
      ["receiver", insert("generation_dispatch_receipts", { dispatch_id: dispatchId, job_id: id, workflow_instance_id: id,
        request_context_id: id + "_context", request_fingerprint: hash, payload_fingerprint: hash, context_id: contextId,
        wait_generation: 1, command_ordinal: correction ? 1 : null, event_no: 4, state_version: 3, received_at: now, ...receiver })],
      ["ack", stmt("UPDATE generation_job_dispatches SET state='acknowledged',receiver_dispatch_id=id,claim_token=NULL,lease_expires_at=NULL,acknowledged_at=? WHERE id=?", now, dispatchId)],
      ...(correction ? [
        ["command", stmt("UPDATE generation_control_commands SET state='running' WHERE job_id=? AND ordinal=1 AND state='pending'", id)],
        ["old_resume", stmt("UPDATE generation_job_dispatches SET state='stale',claim_token=NULL,lease_expires_at=NULL WHERE generation_job_id=? AND kind='resume_transcript_review' AND wait_generation=1 AND state IN ('pending','claimed','retryable_failed','uncertain')", id)],
      ] : []),
      ["job", stmt("UPDATE generation_jobs SET status='running',current_step=?,state_version=3,event_count=4,required_event_no=4,required_event_state_version=3,evidence_event_no=4,wait_kind=NULL,active_wait_generation=NULL,wait_input_fingerprint=NULL WHERE id=? AND state_version=2 AND active_wait_generation=1", stage, id)],
      ["event", insert("generation_job_events", event(id, 4, "received"))],
    ];
  }
  async function startWaiting(id) {
    await startPhysicalJob(id);
    await db.batch(enterWait(id).map(([, s]) => s));
  }
  await startWaiting("consume_correction");
  for (const bad of [{ context_id: "wait_full_wait_context" }, { wait_generation: 2 }, { job_state_version: 1 }]) {
    await rejectBundle([["dispatch", resumeDispatch("consume_correction", bad)]], "resume exact active wait");
  }
  await db.batch([resumeDispatch("consume_correction")]);
  await prepareSend("consume_correction_resume_dispatch", true);
  await db.batch(registerCorrection("consume_correction", { dispatchValues: { dispatch_no: 3 } }).map(([, s]) => s));
  await prepareSend("consume_correction_correction_dispatch");
  await rejectBundle(consumeWait("consume_correction", false), "pending correction blocks resume");
  for (const missing of ["evidence", "receiver", "ack", "command", "old_resume", "job", "event"]) {
    await rejectBundle(consumeWait("consume_correction", true).filter(([label]) => label !== missing), "consume missing " + missing);
  }
  for (const zero of ["ack", "command", "old_resume", "job"]) {
    await rejectBundle(consumeWait("consume_correction", true).map(([label, s]) => [label, label === zero
      ? stmt("UPDATE generation_jobs SET status='running' WHERE 0") : s]), "consume zero-row " + zero);
  }
  for (const bad of [{ receiver: { wait_generation: 2 } }, { receiver: { command_ordinal: 2 } },
    { receiver: { context_id: "consume_correction_wait_context" } }, { proof: { command_ordinal: null } },
    { proof: { after_wait: 1 } }, { proof: { attempt: 2 } }, { proof: { after_stage: "intent_analysis" } }]) {
    await rejectBundle(consumeWait("consume_correction", true, bad), "consume identity mismatch");
  }
  await rejectBundle([["metadata change", stmt("UPDATE sermon_metadata_drafts SET metadata_revision=2 WHERE sermon_id=?", sermon)],
    ...consumeWait("consume_correction", true)], "correction rechecks current metadata", /lifecycle_wait_receiver/);
  await rejectBundle([
    ["input", insert("sermon_input_events", { sermon_id: sermon, version: 3, id: "new_confirmation", kind: "confirm",
      source_type: "caption_plain", source_id: "source", document_id: "source", confirmation_id: "new_confirmation",
      parent_document_id: "source", related_id: null, document_sha256: hash, payload_sha256: hash, chunk_count: 1,
      byte_length: 2, actor_id: actor, created_at: now, state: "pending", required_state: "sealed" })],
    ["chunk", insert("sermon_input_chunks", { sermon_id: sermon, event_id: "new_confirmation", position: 0, body: "{}" })],
    ["head", stmt("UPDATE sermon_input_heads SET version=3 WHERE sermon_id=?", sermon)],
    ["seal", stmt("UPDATE sermon_input_events SET state='sealed' WHERE sermon_id=? AND id='new_confirmation'", sermon)],
    ...consumeWait("consume_correction", true),
  ], "correction rechecks current input after registration", /lifecycle_wait_receiver/);
  await rejectBundle([["stale alone", stmt("UPDATE generation_job_dispatches SET state='stale' WHERE id='consume_correction_resume_dispatch'")]], "old resume cannot be retired alone");
  const providerRowsBeforeConsume = await rows("SELECT * FROM ai_provider_calls ORDER BY id");
  const competing = await Promise.allSettled([
    db.batch(consumeWait("consume_correction", false).map(([, s]) => s)),
    db.batch(consumeWait("consume_correction", true).map(([, s]) => s)),
  ]);
  assert.equal(competing[0].status, "rejected");
  assert.equal(competing[1].status, "fulfilled");
  assert.deepEqual(await rows("SELECT status,current_step,state_version,active_wait_generation FROM generation_jobs WHERE id='consume_correction'"),
    [{ status: "running", current_step: "correction_1", state_version: 3, active_wait_generation: null }]);
  assert.equal((await rows("SELECT state FROM generation_control_commands WHERE job_id='consume_correction'"))[0].state, "running");
  assert.equal((await rows("SELECT state FROM generation_job_dispatches WHERE id='consume_correction_resume_dispatch'"))[0].state, "stale");
  assert.equal((await rows("SELECT count(*) AS n FROM generation_dispatch_receipts WHERE job_id='consume_correction' AND wait_generation=1"))[0].n, 1);
  assert.deepEqual(await rows("SELECT * FROM ai_provider_calls ORDER BY id"), providerRowsBeforeConsume);
  checks++;
  await rejectBundle(consumeWait("consume_correction", false), "late resume has no effects");
  await rejectBundle(consumeWait("consume_correction", true), "duplicate correction consumption has no effects");
  // P5-44d: claim the already-sealed command context; never reconstruct it.
  const correctionJob = "consume_correction", correctionContext = correctionJob + "_correction_context";
  const newWaitHash = "c".repeat(64);
  function correctionClaim(link = {}, receiptValues = {}) {
    return [
      ["receipt", insert("generation_step_receipts", { generation_job_id: correctionJob, step_key: "correction_1",
        task: "correction", effect_class: "ai_provider", input_contract_version: 2, input_fingerprint: hash,
        input_version: 2, source_id: "source", document_id: "source", document_sha256: hash, confirmation_id: "confirmation",
        metadata_revision: 1, binding_id: null, ticket_id: null, state: "claimed", attempt_count: 1,
        claim_token: "correction_token", lease_expires_at: lease2, provider_request_id_opaque: null,
        result_kind: null, result_id: null, result_version: null, result_fingerprint: null, error_code: null,
        error_message_safe: null, error_fingerprint: null, started_at: now, updated_at: now, completed_at: null,
        context_id: correctionContext, outcome_attempt: null, ...receiptValues })],
      ["link", insert("generation_step_contexts", { job_id: correctionJob, step_key: "correction_1",
        context_id: correctionContext, request_context_id: correctionJob + "_context", task: "correction",
        input_fingerprint: hash, predecessor_event_no: 4, predecessor_state_version: 3,
        predecessor_kind: "wait_consume", command_ordinal: 1, ...link })],
    ];
  }
  const originalCommandContext = await rows("SELECT * FROM generation_contexts WHERE id=?", correctionContext);
  for (const missing of ["receipt", "link"]) {
    await rejectBundle(correctionClaim().filter(([label]) => label !== missing), "correction claim missing " + missing);
  }
  for (const bad of [{ command_ordinal: null }, { command_ordinal: 2 }, { predecessor_kind: "request" },
    { predecessor_event_no: 2, predecessor_state_version: 1 }, { request_context_id: "wait_full_context" },
    { context_id: "wait_full_correction_context" }]) {
    await rejectBundle(correctionClaim(bad), "correction claim must use original command and receipt");
  }
  for (const bad of [{ attempt_count: 2 }, { context_id: "consume_correction_wait_context" }]) {
    await rejectBundle(correctionClaim({}, bad), "correction first receipt identity");
  }
  await rejectBundle([["metadata", stmt("UPDATE sermon_metadata_drafts SET metadata_revision=2 WHERE sermon_id=?", sermon)],
    ...correctionClaim()], "authority changed after consume", /lifecycle_correction_step/);
  await db.batch(correctionClaim().map(([, s]) => s));
  assert.deepEqual(await rows("SELECT * FROM generation_contexts WHERE id=?", correctionContext), originalCommandContext);
  checks++;
  await db.batch([
    stmt("UPDATE generation_step_receipts SET state='effect_started' WHERE generation_job_id=? AND step_key='correction_1' AND claim_token='correction_token' AND attempt_count=1", correctionJob),
    insert("ai_provider_calls", { id: "correction_call", generation_job_id: correctionJob, step_key: "correction_1",
      attempt_number: 1, quiz_set_id: quiz, sermon_id: sermon, task: "correction", input_fingerprint: hash,
      provider: "synthetic", model: "synthetic", reasoning_effort: null, state: "effect_started",
      provider_request_id_opaque: null, started_at: now, completed_at: null, settlement_call_id: null }),
  ]);
  // Observed cost survives a failed result batch and is never guessed as zero.
  await db.batch([insert("ai_usage_observations", { ...observation, call_id: "correction_call",
    usage_event_id: "correction_usage", job_id: correctionJob, step_key: "correction_1",
    task: "correction", context_id: correctionContext })]);
  function correctionResult({ proposal = {}, result = {}, proof = {}, outcome = {}, wait = {}, parent = {}, cost = {},
    settlementValues = {}, claimToken = "correction_token", commandAttempt = 1, jobWaitHash = newWaitHash } = {}) {
    const wc = { ...context(correctionJob, "wait", correctionJob + "_wait2_context"),
      input_version: 3, fingerprint: newWaitHash, ...wait };
    return [
      ["proposal", insert("sermon_input_events", { sermon_id: sermon, version: 3, id: "correction_proposal",
        kind: "proposal", source_type: "caption_plain", source_id: "source", document_id: "source",
        confirmation_id: "confirmation", parent_document_id: "source", related_id: null, document_sha256: hash,
        payload_sha256: hash, chunk_count: 1, byte_length: 2, actor_id: actor, created_at: now,
        state: "pending", required_state: "sealed", ...proposal })],
      ["proposal_chunk", insert("sermon_input_chunks", { sermon_id: sermon, event_id: "correction_proposal", position: 0, body: "{}" })],
      ["input_head", stmt("UPDATE sermon_input_heads SET version=3 WHERE sermon_id=? AND version=2", sermon)],
      ["proposal_seal", stmt("UPDATE sermon_input_events SET state='sealed' WHERE sermon_id=? AND id='correction_proposal'", sermon)],
      ["call", stmt("UPDATE ai_provider_calls SET state='completed',completed_at=?,settlement_call_id=id WHERE id='correction_call' AND state='effect_started'", lease2)],
      ["usage", insert("ai_usage_events", { ...usage, id: "correction_usage", provider_call_id: "correction_call",
        generation_job_id: correctionJob, step_key: "correction_1", task: "correction", ...cost })],
      ["result", insert("generation_step_result_links", { generation_job_id: correctionJob, step_key: "correction_1",
        task: "correction", correction_sermon_id: sermon, correction_event_id: "correction_proposal",
        content_sermon_id: null, content_event_id: null, final_audit_result_id: null, usage_event_id: "correction_usage",
        result_kind: "correction_proposal", result_id: "correction_proposal", result_version: 3, result_fingerprint: hash, ...result })],
      ["evidence", insert("generation_transition_evidence", evidence(correctionJob, { event_no: 5, before_version: 3,
        after_version: 4, before_status: "running", after_status: "awaiting_transcript_review", before_stage: "correction_1",
        after_stage: "transcript_review", after_wait: 2, reason: "step_succeeded", context_id: correctionContext,
        step_key: "correction_1", attempt: 1, command_ordinal: 1, ...proof }))],
      ["outcome", insert("generation_step_outcomes", { job_id: correctionJob, step_key: "correction_1", attempt: 1,
        context_id: correctionContext, input_fingerprint: hash, task: "correction", outcome: "success", reason: "none",
        event_no: 5, state_version: 4, call_id: "correction_call", usage_event_id: "correction_usage",
        result_step_key: "correction_1", before_input_version: 2, after_input_version: 3,
        before_content_count: 0, after_content_count: 0, ...outcome })],
      ["receipt", stmt("UPDATE generation_step_receipts SET state='succeeded',outcome_attempt=1,claim_token=NULL,lease_expires_at=NULL,result_kind='correction_proposal',result_id='correction_proposal',result_version=3,result_fingerprint=?,completed_at=? WHERE generation_job_id=? AND step_key='correction_1' AND state='effect_started' AND claim_token=? AND attempt_count=1", hash, lease2, correctionJob, claimToken)],
      ["settlement", insert("ai_usage_settlements", { call_id: "correction_call", usage_event_id: "correction_usage",
        job_id: correctionJob, step_key: "correction_1", attempt: 1, fingerprint: hash, settled_at: lease2, ...settlementValues })],
      ["command", stmt("UPDATE generation_control_commands SET state='succeeded',outcome_attempt=? WHERE job_id=? AND ordinal=1 AND state='running'", commandAttempt, correctionJob)],
      ["wait_context", insert("generation_contexts", wc)],
      ["wait_chunk", insert("generation_context_chunks", { context_id: wc.id, position: 0, byte_length: 2,
        sha256: hash, body: new TextEncoder().encode("{}"), verified: 1 })],
      ["wait_link", insert("generation_wait_contexts", { job_id: correctionJob, wait_generation: 2,
        context_id: wc.id, request_context_id: correctionJob + "_context", kind: "transcript_review",
        enter_event_no: 5, enter_state_version: 4, parent_wait_generation: 1, command_ordinal: 1,
        parent_step_key: "correction_1", parent_attempt: 1, ...parent })],
      ["wait_seal", stmt("UPDATE generation_contexts SET state='sealed' WHERE id=?", wc.id)],
      ["job", stmt("UPDATE generation_jobs SET status='awaiting_transcript_review',current_step='transcript_review',state_version=4,event_count=5,required_event_no=5,required_event_state_version=4,evidence_event_no=5,wait_kind='transcript_review',wait_generation=2,active_wait_generation=2,wait_input_fingerprint=? WHERE id=? AND state_version=3 AND current_step='correction_1'", jobWaitHash, correctionJob)],
      ["event", insert("generation_job_events", event(correctionJob, 5, "step_succeeded", "correction_1"))],
    ];
  }
  for (const [missing] of correctionResult()) {
    await rejectBundle(correctionResult().filter(([label]) => label !== missing), "correction result missing " + missing, missing === "settlement" ? /lifecycle_correction_wait/ : undefined);
  }
  for (const zero of ["input_head", "proposal_seal", "call", "receipt", "command", "wait_seal", "job"]) {
    await rejectBundle(correctionResult().map(([label, s]) => [label, label === zero
      ? stmt("UPDATE generation_jobs SET status='running' WHERE 0") : s]), "correction zero-row " + zero);
  }
  for (const bad of [
    { claimToken: "expired_token" }, { commandAttempt: 2 }, { proof: { command_ordinal: null } },
    { proof: { command_ordinal: 2 } }, { proof: { context_id: "consume_correction_wait_context" } },
    { proof: { attempt: 2 } }, { outcome: { attempt: 2 } }, { outcome: { context_id: "late_step_context" } },
    { outcome: { before_input_version: 1 } }, { outcome: { after_input_version: 2 } },
    { outcome: { after_content_count: 1 } }, { outcome: { call_id: "late_call" } },
    { result: { correction_event_id: "confirmation" } }, { result: { usage_event_id: "late_usage" } },
    { result: { result_fingerprint: actor } }, { proposal: { confirmation_id: null } },
    { cost: { cached_input_tokens: 0 } }, { cost: { estimated_cost_micro_usd: 0 } },
    { settlementValues: { attempt: 2 } }, { settlementValues: { fingerprint: actor } },
    { parent: { parent_wait_generation: null, command_ordinal: null, parent_step_key: null, parent_attempt: null } },
    { parent: { parent_wait_generation: 2 } }, { parent: { command_ordinal: 2 } },
    { parent: { parent_step_key: "summary" } }, { parent: { parent_attempt: 2 } },
    { parent: { enter_event_no: 4, enter_state_version: 3 } },
    { wait: { confirmation_id: null } }, { wait: { input_version: 2 } },
    { wait: { settings_revision: 1 } }, { wait: { selection_revision: 1 } },
    { jobWaitHash: hash },
  ]) await rejectBundle(correctionResult(bad), "correction result identity mismatch " + JSON.stringify(bad));
  // An internally consistent success without a new wait is still forbidden.
  await rejectBundle(correctionResult({ proof: { after_status: "running", after_stage: "correction_1", after_wait: null } })
    .filter(([label]) => !label.startsWith("wait_"))
    .map(([label, s]) => [label, label === "job"
      ? stmt("UPDATE generation_jobs SET state_version=4,event_count=5,required_event_no=5,required_event_state_version=4,evidence_event_no=5 WHERE id=?", correctionJob) : s]),
  "correction success cannot omit re-wait", /lifecycle_correction_outcome/);
  await db.batch(correctionResult().map(([, s]) => s));
  assert.deepEqual(await rows("SELECT status,state_version,event_count,wait_generation,active_wait_generation FROM generation_jobs WHERE id=?", correctionJob),
    [{ status: "awaiting_transcript_review", state_version: 4, event_count: 5, wait_generation: 2, active_wait_generation: 2 }]);
  assert.deepEqual(await rows("SELECT state,outcome_attempt FROM generation_control_commands WHERE job_id=?", correctionJob),
    [{ state: "succeeded", outcome_attempt: 1 }]);
  assert.deepEqual(await rows("SELECT * FROM generation_contexts WHERE id=?", correctionContext), originalCommandContext);
  assert.equal((await rows("SELECT sum(estimated_cost_micro_usd) AS cost FROM ai_usage_events WHERE generation_job_id=?", correctionJob))[0].cost, 7);
  checks++;
  // Read the immutable successful bundle by its own outcome/event, even after
  // a later job transition. This is SQL evidence, not a production replay port.
  async function ownCorrection() {
    const queries = [
      ["SELECT * FROM generation_contexts WHERE job_id=? ORDER BY id", correctionJob],
      ["SELECT * FROM generation_context_chunks WHERE context_id IN (SELECT id FROM generation_contexts WHERE job_id=?) ORDER BY context_id,position", correctionJob],
      ["SELECT * FROM generation_step_contexts WHERE job_id=?", correctionJob],
      ["SELECT * FROM generation_step_receipts WHERE generation_job_id=?", correctionJob],
      ["SELECT * FROM generation_control_commands WHERE job_id=?", correctionJob],
      ["SELECT * FROM generation_step_outcomes WHERE job_id=?", correctionJob],
      ["SELECT * FROM generation_step_result_links WHERE generation_job_id=?", correctionJob],
      ["SELECT * FROM generation_wait_contexts WHERE job_id=? ORDER BY wait_generation", correctionJob],
      ["SELECT * FROM ai_provider_calls WHERE generation_job_id=?", correctionJob],
      ["SELECT * FROM ai_usage_observations WHERE job_id=?", correctionJob],
      ["SELECT * FROM ai_usage_events WHERE generation_job_id=?", correctionJob],
      ["SELECT * FROM ai_usage_settlements WHERE job_id=?", correctionJob],
      ["SELECT e.* FROM generation_job_events e JOIN generation_step_outcomes o ON o.job_id=e.generation_job_id AND o.event_no=e.event_no AND o.state_version=e.job_state_version WHERE o.job_id=? AND o.step_key='correction_1' AND o.attempt=1", correctionJob],
      ["SELECT e.* FROM generation_transition_evidence e JOIN generation_step_outcomes o ON o.job_id=e.job_id AND o.event_no=e.event_no AND o.state_version=e.after_version WHERE o.job_id=? AND o.step_key='correction_1' AND o.attempt=1", correctionJob],
      ["SELECT * FROM sermon_input_events WHERE sermon_id=? AND id='correction_proposal'", sermon],
      ["SELECT * FROM sermon_input_chunks WHERE sermon_id=? AND event_id='correction_proposal' ORDER BY position", sermon],
    ];
    const bundle = await Promise.all(queries.map(([sql, ...args]) => rows(sql, ...args)));
    assert.ok(bundle.every(part => part.length > 0), "every own bundle component exists");
    assert.equal(bundle[12][0].event_no, 5);
    assert.equal(bundle[13][0].context_id, correctionContext);
    return bundle;
  }
  const successfulCorrection = await ownCorrection();
  await rejectBundle(correctionResult(), "lost response replay must not duplicate result/cost");
  await rejectBundle(correctionClaim(), "successful step cannot be claimed again");
  inputProjection = { ...inputProjection, input_version: 3 };
  await closePhysicalJob("consume_correction");
  assert.equal((await rows("SELECT event_count FROM generation_jobs WHERE id=?", correctionJob))[0].event_count, 6);
  assert.deepEqual(await ownCorrection(), successfulCorrection);
  await rejectBundle(correctionResult(), "historical response replay cannot borrow latest event");
  checks++;

  await startWaiting("consume_resume");
  await db.batch([resumeDispatch("consume_resume")]);
  await prepareSend("consume_resume_resume_dispatch");
  await db.batch(consumeWait("consume_resume", false).map(([, s]) => s));
  assert.equal((await rows("SELECT current_step FROM generation_jobs WHERE id='consume_resume'"))[0].current_step, "intent_analysis");
  checks++;
  await rejectBundle(registerCorrection("consume_resume", { dispatchValues: { dispatch_no: 3 } }), "resume won before correction registration");
  await rejectBundle(consumeWait("consume_resume", true), "late correction cannot consume resumed wait");
  await closePhysicalJob("consume_resume");
  await startWaiting("register_race");
  await db.batch([resumeDispatch("register_race")]);
  await prepareSend("register_race_resume_dispatch");
  const registrationRace = await Promise.allSettled([
    db.batch(registerCorrection("register_race", { dispatchValues: { dispatch_no: 3 } }).map(([, s]) => s)),
    db.batch(consumeWait("register_race", false).map(([, s]) => s)),
  ]);
  assert.equal(registrationRace.filter(r => r.status === "fulfilled").length, 1);
  const [raceJob] = await rows("SELECT status,state_version FROM generation_jobs WHERE id='register_race'");
  const raceCommands = await rows("SELECT state FROM generation_control_commands WHERE job_id='register_race'");
  if (registrationRace[0].status === "fulfilled") {
    assert.deepEqual(raceJob, { status: "awaiting_transcript_review", state_version: 2 });
    assert.deepEqual(raceCommands, [{ state: "pending" }]);
    assert.deepEqual(await rows("SELECT * FROM generation_dispatch_receipts WHERE job_id='register_race' AND wait_generation=1"), []);
  } else {
    assert.deepEqual(raceJob, { status: "running", state_version: 3 });
    assert.deepEqual(raceCommands, []);
  }
  checks++;
  await closePhysicalJob("register_race");
  // Pre-effect rejection has command/wait evidence, never a fabricated step result.
  function appendConfirmation(id, version) {
    return [
      ["input", insert("sermon_input_events", { sermon_id: sermon, version, id, kind: "confirm", source_type: "caption_plain",
        source_id: "source", document_id: "source", confirmation_id: id, parent_document_id: "source", related_id: null,
        document_sha256: hash, payload_sha256: hash, chunk_count: 1, byte_length: 2, actor_id: actor,
        created_at: now, state: "pending", required_state: "sealed" })],
      ["chunk", insert("sermon_input_chunks", { sermon_id: sermon, event_id: id, position: 0, body: "{}" })],
      ["head", stmt("UPDATE sermon_input_heads SET version=? WHERE sermon_id=? AND version=?", version, sermon, version - 1)],
      ["seal", stmt("UPDATE sermon_input_events SET state='sealed' WHERE sermon_id=? AND id=?", sermon, id)],
    ];
  }
  function declineAndRewait(id, consumed, { wait = {}, parent = {}, proof = {} } = {}) {
    const eventNo = consumed ? 5 : 4;
    const next = { ...context(id, "wait", id + "_rewait_context"), fingerprint: newWaitHash, ...wait };
    return [
      ["context", insert("generation_contexts", next)],
      ["chunk", insert("generation_context_chunks", { context_id: next.id, position: 0, byte_length: 2,
        sha256: hash, body: new TextEncoder().encode("{}"), verified: 1 })],
      ["evidence", insert("generation_transition_evidence", evidence(id, { event_no: eventNo, before_version: eventNo - 2,
        after_version: eventNo - 1, before_status: consumed ? "running" : "awaiting_transcript_review",
        after_status: "awaiting_transcript_review", before_stage: consumed ? "correction_1" : "transcript_review",
        after_stage: "transcript_review", before_wait: consumed ? null : 1, after_wait: 2, reason: "wait_entered",
        context_id: next.id, fingerprint: newWaitHash, command_ordinal: 1, ...proof }))],
      ["command", stmt("UPDATE generation_control_commands SET state='rejected' WHERE job_id=? AND ordinal=1 AND state=? AND outcome_attempt IS NULL", id, consumed ? "running" : "pending")],
      ["retire", stmt("UPDATE generation_job_dispatches SET state='stale',claim_token=NULL,lease_expires_at=NULL WHERE generation_job_id=? AND wait_generation=1 AND state IN ('pending','claimed','retryable_failed','uncertain')", id)],
      ["link", insert("generation_wait_contexts", { job_id: id, wait_generation: 2, context_id: next.id,
        request_context_id: id + "_context", kind: "transcript_review", enter_event_no: eventNo,
        enter_state_version: eventNo - 1, parent_wait_generation: 1, command_ordinal: 1,
        parent_step_key: null, parent_attempt: null, ...parent })],
      ["seal", stmt("UPDATE generation_contexts SET state='sealed' WHERE id=?", next.id)],
      ["job", stmt("UPDATE generation_jobs SET status='awaiting_transcript_review',current_step='transcript_review',state_version=?,event_count=?,required_event_no=?,required_event_state_version=?,evidence_event_no=?,wait_kind='transcript_review',wait_generation=2,active_wait_generation=2,wait_input_fingerprint=? WHERE id=? AND state_version=?", eventNo - 1, eventNo, eventNo, eventNo - 1, eventNo, newWaitHash, id, eventNo - 2)],
      ["event", insert("generation_job_events", event(id, eventNo, "wait_entered"))],
    ];
  }
  for (const consumed of [false, true]) {
    const id = consumed ? "decline_running" : "decline_pending";
    await startWaiting(id);
    await db.batch([resumeDispatch(id)]);
    await db.batch(registerCorrection(id, { dispatchValues: { dispatch_no: 3 } }).map(([, s]) => s));
    if (consumed) {
      await prepareSend(id + "_correction_dispatch");
      await db.batch(consumeWait(id, true).map(([, s]) => s));
    }
    const original = await rows("SELECT * FROM generation_contexts WHERE id=?", id + "_correction_context");
    await rejectBundle(declineAndRewait(id, consumed), "unchanged input does not justify rejection", /lifecycle_command_rewait/);
    const version = inputProjection.input_version + 1, confirmation = id + "_confirmation";
    await db.batch(appendConfirmation(confirmation, version).map(([, s]) => s));
    inputProjection = { ...inputProjection, input_version: version, confirmation_id: confirmation };
    for (const missing of ["context", "chunk", "evidence", "command", ...(consumed ? [] : ["retire"]), "link", "seal", "job", "event"]) {
      await rejectBundle(declineAndRewait(id, consumed).filter(([label]) => label !== missing), "decline missing " + missing);
    }
    for (const zero of ["command", "seal", "job"]) {
      await rejectBundle(declineAndRewait(id, consumed).map(([label, s]) => [label, label === zero
        ? stmt("UPDATE generation_jobs SET status='running' WHERE 0") : s]), "decline zero-row " + zero);
    }
    for (const bad of [{ parent: { command_ordinal: null, parent_wait_generation: null } },
      { parent: { command_ordinal: 2 } }, { parent: { parent_step_key: "correction_1", parent_attempt: 1 } },
      { proof: { command_ordinal: null } }, { proof: { after_wait: 3 } },
      { wait: { confirmation_id: null } }, { wait: { settings_revision: 1 } }, { wait: { selection_revision: 1 } }]) {
      await rejectBundle(declineAndRewait(id, consumed, bad), "decline exact lineage " + JSON.stringify(bad));
    }
    await db.batch(declineAndRewait(id, consumed).map(([, s]) => s));
    assert.deepEqual(await rows("SELECT state,outcome_attempt FROM generation_control_commands WHERE job_id=?", id),
      [{ state: "rejected", outcome_attempt: null }]);
    assert.deepEqual(await rows("SELECT * FROM generation_contexts WHERE id=?", id + "_correction_context"), original);
    for (const [table, key] of [["generation_step_receipts", "generation_job_id"], ["generation_step_outcomes", "job_id"],
      ["ai_provider_calls", "generation_job_id"], ["ai_usage_events", "generation_job_id"]]) {
      assert.deepEqual(await rows(`SELECT * FROM ${table} WHERE ${key}=?`, id), []);
    }
    checks++;
    await rejectBundle(declineAndRewait(id, consumed), "duplicate rejection leaves new wait intact");
    await rejectBundle(consumeWait(id, false), "old resume cannot consume replacement wait");
    await closePhysicalJob(id);
  }
  function physicalFailure(id, key, task, kind, { callId = null, known = false, attempt = 1, proof = {}, outcome = {} } = {}) {
    const code = "step_" + kind, status = kind === "rejected" ? "failed" : "stale";
    return [
      ...(known ? [
        ["call", stmt("UPDATE ai_provider_calls SET state='completed',completed_at=?,settlement_call_id=id WHERE id=? AND state='effect_started'", lease2, callId)],
        ["usage", insert("ai_usage_events", { ...usage, id: id + "_usage", provider_call_id: callId,
          generation_job_id: id, step_key: key, task })],
      ] : []),
      ["evidence", insert("generation_transition_evidence", evidence(id, { event_no: 3, before_version: 1, after_version: 2,
        before_status: "running", after_status: status, before_stage: key, after_stage: key, reason: code,
        context_id: id + "_step_context", step_key: key, attempt, ...proof }))],
      ["outcome", insert("generation_step_outcomes", { job_id: id, step_key: key, attempt,
        context_id: id + "_step_context", input_fingerprint: hash, task, outcome: kind,
        reason: kind === "rejected" ? "domain_invalid" : "authority_changed", event_no: 3, state_version: 2,
        call_id: callId, usage_event_id: known ? id + "_usage" : null, result_step_key: null,
        before_input_version: inputProjection.input_version, after_input_version: inputProjection.input_version,
        before_content_count: 0, after_content_count: 0, ...outcome })],
      ["receipt", stmt("UPDATE generation_step_receipts SET state=?,outcome_attempt=?,claim_token=NULL,lease_expires_at=NULL,completed_at=? WHERE generation_job_id=? AND step_key=? AND attempt_count=?", kind === "rejected" ? "terminal_failed" : "stale", attempt, lease2, id, key, attempt)],
      ...(known ? [["settlement", insert("ai_usage_settlements", { call_id: callId, usage_event_id: id + "_usage",
        job_id: id, step_key: key, attempt, fingerprint: hash, settled_at: lease2 })]] : []),
      ["job", stmt("UPDATE generation_jobs SET status=?,state_version=2,event_count=3,required_event_no=3,required_event_state_version=2,evidence_event_no=3,completed_at=? WHERE id=? AND state_version=1", status, lease2, id)],
      ["event", insert("generation_job_events", { ...event(id, 3, code, key), attempt_number: attempt })],
    ];
  }
  await startPhysicalJob("pure_retry");
  await db.batch(stepClaim("pure_retry", "input_resolve", "fetch_transcript").map(([, s]) => s));
  function retryClaim(token, updated = lease1) {
    return stmt("UPDATE generation_step_receipts SET state='claimed',attempt_count=2,claim_token=?,lease_expires_at=?,updated_at=? WHERE generation_job_id='pure_retry' AND step_key='input_resolve' AND attempt_count=1", token, lease2, updated);
  }
  await rejectBundle([["claim", retryClaim("too_early")]], "live pure lease cannot be reclaimed");
  await run("UPDATE generation_step_receipts SET state='retryable_failed',claim_token=NULL,lease_expires_at=NULL WHERE generation_job_id='pure_retry'");
  const retries = await Promise.all([db.batch([retryClaim("retry_a")]), db.batch([retryClaim("retry_b")])]);
  assert.deepEqual(retries.map(r => r[0].meta.changes).sort(), [0, 1]);
  assert.equal((await rows("SELECT attempt_count FROM generation_step_receipts WHERE generation_job_id='pure_retry'"))[0].attempt_count, 2);
  checks++;
  await rejectBundle(physicalFailure("pure_retry", "input_resolve", "fetch_transcript", "stale"), "old attempt cannot close new pure claim");
  await db.batch(physicalFailure("pure_retry", "input_resolve", "fetch_transcript", "stale", { attempt: 2 }).map(([, s]) => s));
  checks++;
  await startPhysicalJob("pure_expired");
  await db.batch(stepClaim("pure_expired", "input_resolve", "fetch_transcript").map(([, s]) => s));
  await run("UPDATE generation_step_receipts SET state='claimed',attempt_count=2,claim_token='renewed',updated_at=?,lease_expires_at='2026-09-18T00:03:00.000Z' WHERE generation_job_id='pure_expired' AND attempt_count=1", lease2);
  assert.equal((await run("UPDATE generation_step_receipts SET state='effect_started' WHERE generation_job_id='pure_expired' AND claim_token='step_token'")).meta.changes, 0);
  await rejectBundle(physicalFailure("pure_expired", "input_resolve", "fetch_transcript", "stale"), "expired attempt cannot commit");
  await db.batch(physicalFailure("pure_expired", "input_resolve", "fetch_transcript", "stale", { attempt: 2 }).map(([, s]) => s));
  checks++;
  await startPhysicalJob("source_no_retry");
  await db.batch(stepClaim("source_no_retry", "input_resolve", "fetch_transcript", "source_network").map(([, s]) => s));
  await rejectBundle([["retry", stmt("UPDATE generation_step_receipts SET state='retryable_failed',claim_token=NULL,lease_expires_at=NULL WHERE generation_job_id='source_no_retry'")]], "network effect cannot blindly retry");
  await db.batch(physicalFailure("source_no_retry", "input_resolve", "fetch_transcript", "stale").map(([, s]) => s));
  checks++;
  // AI claims may close before any effect; they may never be blindly retried.
  await startPhysicalJob("ai_pre_effect", "transcript_correction", "correction");
  await db.batch(stepClaim("ai_pre_effect", "correction", "correction", "ai_provider").map(([, s]) => s));
  await rejectBundle([["retry", stmt("UPDATE generation_step_receipts SET state='retryable_failed',claim_token=NULL,lease_expires_at=NULL WHERE generation_job_id='ai_pre_effect'")]], "AI retry remains closed");
  await db.batch(physicalFailure("ai_pre_effect", "correction", "correction", "stale").map(([, s]) => s));
  assert.deepEqual(await rows("SELECT * FROM ai_provider_calls WHERE generation_job_id='ai_pre_effect'"), []);
  checks++;
  for (const kind of ["stale", "rejected"]) {
    const id = "known_" + kind, key = "summary", task = "summary", callId = id + "_call";
    await startPhysicalJob(id, "summary", key);
    await db.batch(stepClaim(id, key, task, "ai_provider").map(([, s]) => s));
    await db.batch([
      stmt("UPDATE generation_step_receipts SET state='effect_started' WHERE generation_job_id=?", id),
      insert("ai_provider_calls", { id: callId, generation_job_id: id, step_key: key, attempt_number: 1,
        quiz_set_id: quiz, sermon_id: sermon, task, input_fingerprint: hash, provider: "synthetic", model: "synthetic",
        reasoning_effort: null, state: "effect_started", provider_request_id_opaque: null, started_at: now,
        completed_at: null, settlement_call_id: null }),
    ]);
    await db.batch([insert("ai_usage_observations", { ...observation, call_id: callId, usage_event_id: id + "_usage",
      job_id: id, step_key: key, task, context_id: id + "_step_context" })]);
    const options = { callId, known: true };
    for (const [missing] of physicalFailure(id, key, task, kind, options)) {
      await rejectBundle(physicalFailure(id, key, task, kind, options).filter(([label]) => label !== missing), "known failure missing " + missing);
    }
    for (const bad of [{ outcome: { usage_event_id: null } }, { outcome: { call_id: null } },
      { outcome: { reason: "usage_unknown" } }, { outcome: { attempt: 2 } },
      { proof: { after_status: "running" } }, { proof: { command_ordinal: 1 } }]) {
      await rejectBundle(physicalFailure(id, key, task, kind, { ...options, ...bad }), "known failure exact observation/outcome");
    }
    await db.batch(physicalFailure(id, key, task, kind, options).map(([, s]) => s));
    assert.deepEqual(await rows("SELECT * FROM generation_step_result_links WHERE generation_job_id=?", id), []);
    assert.deepEqual(await rows("SELECT count(*) AS n,sum(estimated_cost_micro_usd) AS cost FROM ai_usage_events WHERE generation_job_id=?", id), [{ n: 1, cost: 7 }]);
    checks++;
    await rejectBundle(physicalFailure(id, key, task, kind, options), "failure replay cannot double settle or reopen job");
  }
  // Scope progression and successful content bundles exercise the common guards
  // with physical synthetic artifacts. Domain payload validation stays in G03.
  async function transition(id, nextStage, reason = "stage_completed", contextId, status = "running", proof = {}) {
    const [j] = await rows("SELECT * FROM generation_jobs WHERE id=?", id);
    return [
      ["evidence", insert("generation_transition_evidence", evidence(id, { event_no: j.event_count + 1,
        before_version: j.state_version, after_version: j.state_version + 1, before_status: j.status, after_status: status,
        before_stage: j.current_step, after_stage: nextStage, before_wait: j.active_wait_generation,
        context_id: contextId ?? id + "_context", reason, ...proof }))],
      ["job", stmt("UPDATE generation_jobs SET status=?,current_step=?,state_version=state_version+1,event_count=event_count+1,required_event_no=event_count+1,required_event_state_version=state_version+1,evidence_event_no=event_count+1,completed_at=? WHERE id=? AND state_version=?", status, nextStage, status === "running" ? null : lease2, id, j.state_version)],
      ["event", insert("generation_job_events", event(id, j.event_count + 1, reason))],
    ];
  }
  for (const [scope, stage] of [["full", "input_resolve"], ["intent", "transcript_review"],
    ["summary", "summary"], ["child", "child_candidates"], ["adult", "adult_candidates"],
    ["transcript_correction", "correction"], ["final_audit", "content_review"]]) {
    const id = "no_prefix_" + scope;
    await startPhysicalJob(id, scope, stage);
    await rejectBundle(await transition(id, "finish", "review_ready", undefined, "review_ready"), scope + " cannot finish without own prefix");
    await rejectBundle(await transition(id, "finish"), scope + " cannot forge a stage-completed shortcut");
    await rejectBundle(await transition(id, "content_review", "needs_revision", undefined, "needs_revision"), "G03 hard-gate proof unavailable");
    await closePhysicalJob(id);
  }
  await assert.rejects(startPhysicalJob("unsupported_single", "single_entry", "input_resolve"), /lifecycle_receiver_stage/u);
  await closePhysicalJob("unsupported_single");
  checks++;
  const contentColumns = { analysis_event_id: "selected_analysis_event_id", critique_event_id: "intent_critique_event_id",
    intent_confirmation_event_id: "intent_confirmation_event_id", summary_event_id: "summary_snapshot_event_id",
    summary_review_event_id: "summary_review_event_id", child_event_id: "child_pool_event_id",
    child_review_event_id: "child_review_event_id", adult_event_id: "adult_pool_event_id", adult_review_event_id: "adult_review_event_id" };
  function currentValue(count, id, projection) {
    return { sermon_id: sermon, event_count: count, last_event_id: id,
      ...Object.fromEntries(Object.entries(contentColumns).map(([a, b]) => [b, projection[a] ?? null])),
      required_event_count: count, required_event_id: id };
  }
  async function beginContentStep(id, task) {
    const [j] = await rows("SELECT * FROM generation_jobs WHERE id=?", id);
    const options = { contextId: id + "_" + task + "_context", link: { predecessor_event_no: j.event_count,
      predecessor_state_version: j.state_version, predecessor_kind: j.event_count === 2 ? "request" : "outcome" } };
    // Each changed projection must be tied to the real current row at seal.
    for (const bad of [{ confirmation_id: null }, { settings_revision: 1 }, { selection_revision: 1 },
      { analysis_event_id: "missing" }, { summary_review_event_id: "missing" }, { quiz_set_id: "missing" }]) {
      await rejectBundle(stepClaim(id, task, task, "ai_provider", { ...options, context: bad }), "step projection cannot be substituted");
    }
    for (const link of [{ request_context_id: "late_context" }, { predecessor_event_no: 1 }, { task: "fetch_transcript" }, { command_ordinal: 1 }]) {
      await rejectBundle(stepClaim(id, task, task, "ai_provider", { ...options, link: { ...options.link, ...link } }), "step predecessor/task ownership");
    }
    await db.batch(stepClaim(id, task, task, "ai_provider", options).map(([, s]) => s));
    await rejectBundle([
      ["metadata", stmt("UPDATE sermon_metadata_drafts SET metadata_revision=2 WHERE sermon_id=?", sermon)],
      ["effect", stmt("UPDATE generation_step_receipts SET state='effect_started' WHERE generation_job_id=? AND step_key=?", id, task)],
    ], "authority change after claim blocks effect", /lifecycle_effect_current/u);
    await db.batch([
      stmt("UPDATE generation_step_receipts SET state='effect_started' WHERE generation_job_id=? AND step_key=?", id, task),
      insert("ai_provider_calls", { id: id + "_" + task + "_call", generation_job_id: id, step_key: task, attempt_number: 1,
        quiz_set_id: quiz, sermon_id: sermon, task, input_fingerprint: hash, provider: "synthetic", model: "synthetic",
        reasoning_effort: null, state: "effect_started", provider_request_id_opaque: null, started_at: now, completed_at: null, settlement_call_id: null }),
      insert("ai_usage_observations", { ...observation, call_id: id + "_" + task + "_call", usage_event_id: id + "_" + task + "_usage",
        job_id: id, step_key: task, task, context_id: options.contextId }),
    ]);
    return options.contextId;
  }
  async function contentSuccess(id, task, contextId, overrides = {}) {
    const [j] = await rows("SELECT * FROM generation_jobs WHERE id=?", id);
    const count = (contentProjection.content_count ?? 0) + 1, contentId = id + "_" + task + "_result";
    const kind = task.endsWith("_candidates") ? "candidate" : task;
    const difficulty = task === "child_candidates" ? "child" : task === "adult_candidates" ? "adult" : null;
    const resultKind = task + "_event", resultVersion = inputProjection.input_version + count;
    const callId = id + "_" + task + "_call", usageId = id + "_" + task + "_usage";
    const nextProjection = { ...contentProjection, content_count: count, last_content_event_id: contentId,
      [task === "intent_analysis" ? "analysis_event_id" : task === "intent_critique" ? "critique_event_id" : difficulty ? difficulty + "_event_id" : "summary_event_id"]: contentId };
    const current = currentValue(count, contentId, nextProjection);
    const statements = [
      ["content", insert("sermon_content_events", { sermon_id: sermon, event_id: contentId, content_sequence: count,
        aggregate_version: resultVersion, origin: "ai", kind, difficulty, generation_job_id: id, step_key: task,
        input_version: inputProjection.input_version, source_id: inputProjection.source_id, document_id: inputProjection.document_id,
        document_sha256: hash, confirmation_id: inputProjection.confirmation_id,
        base_analysis_event_id: task === "intent_critique" ? contentProjection.analysis_event_id : null,
        analysis_event_id: ["summary", "candidate"].includes(kind) ? contentProjection.analysis_event_id : null,
        intent_confirmation_event_id: ["summary", "candidate"].includes(kind) ? contentProjection.intent_confirmation_event_id : null,
        payload_sha256: hash, payload_byte_length: 2, payload_chunk_count: 1, state: "assembling", required_state: "sealed",
        created_by_actor_id: null, created_at: now })],
      ["payload", insert("sermon_content_payloads", { sermon_id: sermon, event_id: contentId, codec: "content-event-json-utf8-v1", chunk_bytes: 65536,
        chunk_count: 1, byte_length: 2, payload_sha256: hash, verified: 0 })],
      ["chunk", insert("sermon_content_chunks", { sermon_id: sermon, event_id: contentId, position: 0, byte_length: 2, chunk_sha256: hash, body: new TextEncoder().encode("{}"), verified: 1 })],
      ["head", count === 1 ? insert("sermon_content_heads", { sermon_id: sermon, event_count: count, last_event_id: contentId, required_event_count: count, required_event_id: contentId })
        : stmt("UPDATE sermon_content_heads SET event_count=?,last_event_id=?,required_event_count=?,required_event_id=? WHERE sermon_id=? AND event_count=?", count, contentId, count, contentId, sermon, count - 1)],
      ...(count === 1 ? [] : [["current", stmt(`UPDATE sermon_content_current SET ${Object.keys(current).filter(k => k !== "sermon_id").map(k => k + "=?").join(",")} WHERE sermon_id=? AND event_count=?`, ...Object.entries(current).filter(([k]) => k !== "sermon_id").map(([, v]) => v), sermon, count - 1)]]),
      ["verified", stmt("UPDATE sermon_content_payloads SET verified=1 WHERE sermon_id=? AND event_id=?", sermon, contentId)],
      ["seal", stmt("UPDATE sermon_content_events SET state='sealed' WHERE sermon_id=? AND event_id=?", sermon, contentId)],
      ...(count === 1 ? [["current", insert("sermon_content_current", current)]] : []),
      ["call", stmt("UPDATE ai_provider_calls SET state='completed',completed_at=?,settlement_call_id=id WHERE id=?", lease2, callId)],
      ["usage", insert("ai_usage_events", { ...usage, id: usageId, provider_call_id: callId, generation_job_id: id, step_key: task, task })],
      ["result", insert("generation_step_result_links", { generation_job_id: id, step_key: task, task,
        correction_sermon_id: null, correction_event_id: null, content_sermon_id: sermon, content_event_id: contentId,
        final_audit_result_id: null, usage_event_id: usageId, result_kind: resultKind, result_id: contentId, result_version: resultVersion, result_fingerprint: hash })],
      ["evidence", insert("generation_transition_evidence", evidence(id, { event_no: j.event_count + 1, before_version: j.state_version,
        after_version: j.state_version + 1, before_status: "running", after_status: "running", before_stage: task, after_stage: task,
        reason: "step_succeeded", context_id: contextId, step_key: task, attempt: 1, ...overrides.proof }))],
      ["outcome", insert("generation_step_outcomes", { job_id: id, step_key: task, attempt: 1, context_id: contextId,
        input_fingerprint: hash, task, outcome: "success", reason: "none", event_no: j.event_count + 1,
        state_version: j.state_version + 1, call_id: callId, usage_event_id: usageId, result_step_key: task,
        before_input_version: inputProjection.input_version, after_input_version: inputProjection.input_version,
        before_content_count: count - 1, after_content_count: count, ...overrides.outcome })],
      ["receipt", stmt("UPDATE generation_step_receipts SET state='succeeded',outcome_attempt=1,claim_token=NULL,lease_expires_at=NULL,result_kind=?,result_id=?,result_version=?,result_fingerprint=?,completed_at=? WHERE generation_job_id=? AND step_key=? AND claim_token='step_token'", resultKind, contentId, resultVersion, hash, lease2, id, task)],
      ["settlement", insert("ai_usage_settlements", { call_id: callId, usage_event_id: usageId, job_id: id, step_key: task, attempt: 1, fingerprint: hash, settled_at: lease2 })],
      ["job", stmt("UPDATE generation_jobs SET state_version=state_version+1,event_count=event_count+1,required_event_no=event_count+1,required_event_state_version=state_version+1,evidence_event_no=event_count+1 WHERE id=? AND state_version=?", id, j.state_version)],
      ["event", insert("generation_job_events", event(id, j.event_count + 1, "step_succeeded", task))],
    ];
    return { statements, nextProjection };
  }
  async function completeContentStep(id, task, contextId) {
    const good = await contentSuccess(id, task, contextId);
    for (const [missing] of good.statements) await rejectBundle(good.statements.filter(([label]) => label !== missing), task + " success missing " + missing);
    for (const bad of [{ outcome: { usage_event_id: null } }, { proof: { after_stage: "finish" } }, { outcome: { task: "correction" } }]) {
      await rejectBundle((await contentSuccess(id, task, contextId, bad)).statements, task + " success identity");
    }
    await db.batch(good.statements.map(([, s]) => s));
    contentProjection = good.nextProjection;
    checks++;
  }
  await startPhysicalJob("content_intent", "intent", "transcript_review");
  await db.batch((await transition("content_intent", "intent_analysis")).map(([, s]) => s));
  const analysisContext = await beginContentStep("content_intent", "intent_analysis");
  await completeContentStep("content_intent", "intent_analysis", analysisContext);
  await rejectBundle(await transition("content_intent", "finish", "review_ready", analysisContext, "review_ready"), "analysis alone cannot finish intent");
  await db.batch((await transition("content_intent", "intent_critique", "stage_completed", analysisContext)).map(([, s]) => s));
  const critiqueContext = await beginContentStep("content_intent", "intent_critique");
  await completeContentStep("content_intent", "intent_critique", critiqueContext);
  await rejectBundle(await transition("content_intent", "finish", "review_ready", critiqueContext, "review_ready"), "critique without human wait consumption cannot finish intent");
  // Existing SQL-only human fixture supplies a real sealed confirmation relation.
  const fixturePath = path.join(root, "workers/app/test/human-content-storage-fixture.ts");
  const { stripTypeScriptTypes } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const fixtureCode = stripTypeScriptTypes((await readFile(fixturePath, "utf8"))
    .replace('"../../_shared/storage/sha256"', JSON.stringify(pathToFileURL(path.join(root, "workers/_shared/storage/sha256.ts")).href))
    .replace("async function appendHumanReview(", "export async function appendHumanReview("));
  const { appendHumanReview } = await import("data:text/javascript;base64," + Buffer.from(fixtureCode).toString("base64"));
  await appendHumanReview(db, { sermonId: sermon, eventId: "physical_intent_confirmation", eventCount: 3,
    input: { version: inputProjection.input_version, source_id: inputProjection.source_id, document_id: inputProjection.document_id,
      document_sha256: hash, confirmation_id: inputProjection.confirmation_id }, kind: "intent_confirmation", operation: "intent_confirm",
    difficulty: null, analysisEventId: contentProjection.analysis_event_id, critiqueEventId: contentProjection.critique_event_id,
    intentConfirmationEventId: null, targetEventId: contentProjection.analysis_event_id,
    current: { analysisEventId: contentProjection.analysis_event_id, critiqueEventId: contentProjection.critique_event_id,
      intentConfirmationEventId: "physical_intent_confirmation" } });
  contentProjection = { ...contentProjection, content_count: 3, last_content_event_id: "physical_intent_confirmation", intent_confirmation_event_id: "physical_intent_confirmation" };
  const intentId = "content_intent", intentWaitContext = intentId + "_intent_wait_context";
  const [beforeIntentWait] = await rows("SELECT * FROM generation_jobs WHERE id=?", intentId);
  const intentWaitNo = beforeIntentWait.event_count + 1, intentWaitVersion = beforeIntentWait.state_version + 1;
  const intentWait = [
    ["context", insert("generation_contexts", context(intentId, "wait", intentWaitContext))],
    ["chunk", insert("generation_context_chunks", { context_id: intentWaitContext, position: 0, byte_length: 2,
      sha256: hash, body: new TextEncoder().encode("{}"), verified: 1 })],
    ["evidence", insert("generation_transition_evidence", evidence(intentId, { event_no: intentWaitNo,
      before_version: beforeIntentWait.state_version, after_version: intentWaitVersion,
      before_status: "running", after_status: "awaiting_intent_review", before_stage: "intent_critique", after_stage: "intent_review",
      after_wait: 1, reason: "wait_entered", context_id: intentWaitContext }))],
    ["link", insert("generation_wait_contexts", { job_id: intentId, wait_generation: 1, context_id: intentWaitContext,
      request_context_id: intentId + "_context", kind: "intent_review", enter_event_no: intentWaitNo,
      enter_state_version: intentWaitVersion, parent_wait_generation: null, command_ordinal: null, parent_step_key: null, parent_attempt: null })],
    ["seal", stmt("UPDATE generation_contexts SET state='sealed' WHERE id=?", intentWaitContext)],
    ["job", stmt("UPDATE generation_jobs SET status='awaiting_intent_review',current_step='intent_review',state_version=?,event_count=?,required_event_no=?,required_event_state_version=?,evidence_event_no=?,wait_kind='intent_review',wait_generation=1,active_wait_generation=1,wait_input_fingerprint=? WHERE id=? AND state_version=?",
      intentWaitVersion, intentWaitNo, intentWaitNo, intentWaitVersion, intentWaitNo, hash, intentId, beforeIntentWait.state_version)],
    ["event", insert("generation_job_events", event(intentId, intentWaitNo, "wait_entered"))],
  ];
  for (const [missing] of intentWait) await rejectBundle(intentWait.filter(([label]) => label !== missing), "intent wait missing " + missing);
  await db.batch(intentWait.map(([, s]) => s));
  const intentDispatch = intentId + "_resume_intent";
  await db.batch([resumeDispatch(intentId, { id: intentDispatch, dispatch_key: intentDispatch, kind: "resume_intent_review",
    job_state_version: intentWaitVersion, context_id: intentWaitContext })]);
  await prepareSend(intentDispatch);
  const intentConsumeNo = intentWaitNo + 1, intentConsumeVersion = intentWaitVersion + 1;
  function intentConsume(stage = "finish") {
    return [
      ["evidence", insert("generation_transition_evidence", evidence(intentId, { event_no: intentConsumeNo,
        before_version: intentWaitVersion, after_version: intentConsumeVersion, before_status: "awaiting_intent_review",
        after_status: "running", before_stage: "intent_review", after_stage: stage, before_wait: 1,
        reason: "received", context_id: intentWaitContext, attempt: 1, dispatch_id: intentDispatch }))],
      ["receiver", insert("generation_dispatch_receipts", { dispatch_id: intentDispatch, job_id: intentId,
        workflow_instance_id: intentId, request_context_id: intentId + "_context", request_fingerprint: hash,
        payload_fingerprint: hash, context_id: intentWaitContext, wait_generation: 1, command_ordinal: null,
        event_no: intentConsumeNo, state_version: intentConsumeVersion, received_at: now })],
      ["ack", stmt("UPDATE generation_job_dispatches SET state='acknowledged',receiver_dispatch_id=id,claim_token=NULL,lease_expires_at=NULL,acknowledged_at=? WHERE id=?", now, intentDispatch)],
      ["job", stmt("UPDATE generation_jobs SET status='running',current_step=?,state_version=?,event_count=?,required_event_no=?,required_event_state_version=?,evidence_event_no=?,wait_kind=NULL,active_wait_generation=NULL,wait_input_fingerprint=NULL WHERE id=? AND state_version=? AND active_wait_generation=1", stage,
        intentConsumeVersion, intentConsumeNo, intentConsumeNo, intentConsumeVersion, intentConsumeNo, intentId, intentWaitVersion)],
      ["event", insert("generation_job_events", event(intentId, intentConsumeNo, "received"))],
    ];
  }
  await rejectBundle(intentConsume("summary"), "intent resume cannot start summary");
  for (const [missing] of intentConsume()) await rejectBundle(intentConsume().filter(([label]) => label !== missing), "intent consume missing " + missing);
  await db.batch(intentConsume().map(([, s]) => s));
  const intentFinish = await transition(intentId, "finish", "review_ready", intentWaitContext, "review_ready");
  for (const [missing] of intentFinish) await rejectBundle(intentFinish.filter(([label]) => label !== missing), "intent finish missing " + missing);
  await db.batch(intentFinish.map(([, s]) => s));
  assert.equal((await rows("SELECT status FROM generation_jobs WHERE id=?", intentId))[0].status, "review_ready");
  checks++;
  const completedContent = [];
  for (const [scope, task] of [["summary", "summary"], ["child", "child_candidates"], ["adult", "adult_candidates"]]) {
    const id = "content_" + scope;
    await startPhysicalJob(id, scope, task);
    const contextId = await beginContentStep(id, task);
    await completeContentStep(id, task, contextId);
    const finish = await transition(id, "finish", "review_ready", contextId, "review_ready");
    for (const [missing] of finish) await rejectBundle(finish.filter(([label]) => label !== missing), scope + " finish missing " + missing);
    await rejectBundle(finish.map(([label, s]) => [label, label === "job" ? stmt("UPDATE generation_jobs SET status='review_ready' WHERE id='missing'") : s]), "finish CAS zero rolls back");
    await rejectBundle([["metadata", stmt("UPDATE sermon_metadata_drafts SET metadata_revision=2 WHERE sermon_id=?", sermon)], ...finish], "finish authority CAS", /lifecycle_finish_current/u);
    await db.batch(finish.map(([, s]) => s));
    const own = await rows("SELECT * FROM generation_step_outcomes WHERE job_id=?", id);
    completedContent.push({ id, own });
    assert.equal((await rows("SELECT status FROM generation_jobs WHERE id=?", id))[0].status, "review_ready");
    await rejectBundle(finish, "terminal finish cannot repeat writes");
    checks++;
  }
  for (const { id, own } of completedContent) assert.deepEqual(await rows("SELECT * FROM generation_step_outcomes WHERE job_id=?", id), own);
  // A standalone correction has its own success/finish; only a full-job command
  // must return to a transcript wait in the same result batch.
  const standalone = "standalone_correction", standaloneContext = standalone + "_correction_context";
  await startPhysicalJob(standalone, "transcript_correction", "correction");
  await beginContentStep(standalone, "correction");
  const nextInput = inputProjection.input_version + 1, proposalId = "standalone_proposal";
  const standaloneResult = [
    ["proposal", insert("sermon_input_events", { sermon_id: sermon, version: nextInput, id: proposalId, kind: "proposal",
      source_type: "caption_plain", source_id: "source", document_id: "source", confirmation_id: inputProjection.confirmation_id,
      parent_document_id: "source", related_id: null, document_sha256: hash, payload_sha256: hash, chunk_count: 1,
      byte_length: 2, actor_id: actor, created_at: now, state: "pending", required_state: "sealed" })],
    ["chunk", insert("sermon_input_chunks", { sermon_id: sermon, event_id: proposalId, position: 0, body: "{}" })],
    ["head", stmt("UPDATE sermon_input_heads SET version=? WHERE sermon_id=? AND version=?", nextInput, sermon, inputProjection.input_version)],
    ["seal", stmt("UPDATE sermon_input_events SET state='sealed' WHERE sermon_id=? AND id=?", sermon, proposalId)],
    ["call", stmt("UPDATE ai_provider_calls SET state='completed',completed_at=?,settlement_call_id=id WHERE id=?", lease2, standalone + "_correction_call")],
    ["usage", insert("ai_usage_events", { ...usage, id: standalone + "_correction_usage", provider_call_id: standalone + "_correction_call",
      generation_job_id: standalone, step_key: "correction", task: "correction" })],
    ["result", insert("generation_step_result_links", { generation_job_id: standalone, step_key: "correction", task: "correction",
      correction_sermon_id: sermon, correction_event_id: proposalId, content_sermon_id: null, content_event_id: null,
      final_audit_result_id: null, usage_event_id: standalone + "_correction_usage", result_kind: "correction_proposal",
      result_id: proposalId, result_version: nextInput, result_fingerprint: hash })],
    ["evidence", insert("generation_transition_evidence", evidence(standalone, { event_no: 3, before_version: 1, after_version: 2,
      before_status: "running", after_status: "running", before_stage: "correction", after_stage: "correction", reason: "step_succeeded",
      context_id: standaloneContext, step_key: "correction", attempt: 1 }))],
    ["outcome", insert("generation_step_outcomes", { job_id: standalone, step_key: "correction", attempt: 1, context_id: standaloneContext,
      input_fingerprint: hash, task: "correction", outcome: "success", reason: "none", event_no: 3, state_version: 2,
      call_id: standalone + "_correction_call", usage_event_id: standalone + "_correction_usage", result_step_key: "correction",
      before_input_version: inputProjection.input_version, after_input_version: nextInput,
      before_content_count: contentProjection.content_count, after_content_count: contentProjection.content_count })],
    ["receipt", stmt("UPDATE generation_step_receipts SET state='succeeded',outcome_attempt=1,claim_token=NULL,lease_expires_at=NULL,result_kind='correction_proposal',result_id=?,result_version=?,result_fingerprint=?,completed_at=? WHERE generation_job_id=? AND step_key='correction'", proposalId, nextInput, hash, lease2, standalone)],
    ["settlement", insert("ai_usage_settlements", { call_id: standalone + "_correction_call", usage_event_id: standalone + "_correction_usage",
      job_id: standalone, step_key: "correction", attempt: 1, fingerprint: hash, settled_at: lease2 })],
    ["job", stmt("UPDATE generation_jobs SET state_version=2,event_count=3,required_event_no=3,required_event_state_version=2,evidence_event_no=3 WHERE id=? AND state_version=1", standalone)],
    ["event", insert("generation_job_events", event(standalone, 3, "step_succeeded", "correction"))],
  ];
  for (const [missing] of standaloneResult) await rejectBundle(standaloneResult.filter(([label]) => label !== missing), "standalone correction missing " + missing);
  await db.batch(standaloneResult.map(([, s]) => s));
  inputProjection = { ...inputProjection, input_version: nextInput };
  await db.batch((await transition(standalone, "finish", "review_ready", standaloneContext, "review_ready")).map(([, s]) => s));
  assert.deepEqual(await rows("SELECT * FROM generation_wait_contexts WHERE job_id=?", standalone), []);
  assert.equal((await rows("SELECT status FROM generation_jobs WHERE id=?", standalone))[0].status, "review_ready");
  checks++;
  for (const [version, sourceType] of [[7, "sermon_manuscript"], [8, "sermon_summary"]]) {
    const id = "readonly_" + version;
    await db.batch([
      insert("sermon_input_events", { sermon_id: sermon, version, id, kind: "source", source_type: sourceType,
        source_id: id, document_id: id, confirmation_id: null, parent_document_id: null, related_id: null,
        document_sha256: hash, payload_sha256: hash, chunk_count: 1, byte_length: 2, actor_id: actor,
        created_at: now, state: "pending", required_state: "sealed" }),
      insert("sermon_input_chunks", { sermon_id: sermon, event_id: id, position: 0, body: "{}" }),
      stmt("UPDATE sermon_input_heads SET version=? WHERE sermon_id=?", version, sermon),
      stmt("UPDATE sermon_input_events SET state='sealed' WHERE sermon_id=? AND id=?", sermon, id),
    ]);
    inputProjection = { input_state: "present", input_version: version, source_id: id, document_id: id, document_sha256: hash, confirmation_id: null };
    await startPhysicalJob(id);
    await db.batch(enterWait(id).map(([, s]) => s));
    await rejectBundle(registerCorrection(id), sourceType + " correction is read-only");
    await closePhysicalJob(id);
  }
  assert.equal((await rows("SELECT version FROM sermon_input_heads WHERE sermon_id=?", sermon))[0].version, 8);
  assert.deepEqual(await ownCorrection(), successfulCorrection);
  assert.deepEqual(await rows("SELECT count(*) AS n,sum(estimated_cost_micro_usd) AS cost FROM ai_usage_events WHERE generation_job_id=?", correctionJob),
    [{ n: 1, cost: 7 }]);
  checks++;
  assert.deepEqual(await rows("PRAGMA foreign_key_check"), []);
  assert.deepEqual(await rows("PRAGMA quick_check"), [{ quick_check: "ok" }]);
  checks++;
  const tableNames = (await rows("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name")).map(row => row.name);
  const triggerNames = (await rows("SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name")).map(row => row.name);
  const beforeFullFinish = await Promise.all(tableNames.map(name => rows(`SELECT * FROM ${name} ORDER BY 1`)));
  await apply("0014_phase5_full_validation_finish.sql");
  const afterFullFinish = await Promise.all(tableNames.map(name => rows(`SELECT * FROM ${name} ORDER BY 1`)));
  assert.deepEqual(afterFullFinish, beforeFullFinish, "0014 must preserve all preexisting rows including audit and usage");
  const nextTriggers = new Set((await rows("SELECT name FROM sqlite_schema WHERE type='trigger'")).map(row => row.name));
  const replaced = new Set(["lifecycle_stage_advance", "lifecycle_finish_current", "lifecycle_finish_proofs", "lifecycle_finish_scope"]);
  for (const name of triggerNames) assert(nextTriggers.has(replaced.has(name) ? `${name}_legacy` : name), `missing preserved trigger ${name}`);
  assert.deepEqual(await rows("SELECT * FROM generation_full_v3_requests"), []);
  assert.deepEqual(await rows("SELECT * FROM generation_final_validation_proofs"), []);
  assert.deepEqual(await rows("PRAGMA foreign_key_check"), []);
  assert.deepEqual(await rows("PRAGMA quick_check"), [{ quick_check: "ok" }]);
  checks += 4;
  console.log(`PASS P5-44/P5-50: ${checks} DB checks; ${tableNames.length} populated/empty tables and ${triggerNames.length} triggers preserved through 0014; FK/quick_check clean`);
} finally {
  await mf.dispose();
}
