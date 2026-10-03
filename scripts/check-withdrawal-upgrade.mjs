// P5-59/P5-60: 0022→0023 or --edits 0023→0024 preservation using the existing synthetic populated fixture; no app DB/config.
import { createHash } from "node:crypto";
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
  name: "p559-withdrawal", modules: true, script: 'export default { fetch() { return new Response("synthetic"); } };',
  compatibilityDate: "2026-08-25", d1Databases: { DB: "p559-withdrawal" },
}] }));
const problemUpgrade = process.argv.includes("--problem");
const republicationUpgrade = problemUpgrade || process.argv.includes("--republication");
const cleanupUpgrade = republicationUpgrade || process.argv.includes("--cleanup"), editsUpgrade = cleanupUpgrade || process.argv.includes("--edits"), target = problemUpgrade ? 27 : republicationUpgrade ? 26 : cleanupUpgrade ? 25 : editsUpgrade ? 24 : 23;
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
  for (const name of sources.slice(13, target)) await db.batch([...(await migration(name)).map(s => stmt(s)), insert("d1_migrations", { name })]);
  if (editsUpgrade) {
    const [sourceSermon] = await rows("SELECT * FROM sermons WHERE id=?", sermon);
    await insert("sermons", { ...sourceSermon, id: "edit-source-sermon", slug: "2026-09-17-edits1", slug_suffix: "edits1", youtube_video_id: "synthetic-edits", youtube_url: "https://example.invalid/synthetic-edits" }).run();
    await run("INSERT INTO quiz_sets(id,sermon_id,status,created_by,created_at,updated_at,published_at,opens_at,closes_at) VALUES('edit-source',?,'published','synthetic',?,?,?,?, '2026-10-01T00:00:00.000Z')", "edit-source-sermon", now, now, now, now);
    const variants = [];
    for (const difficulty of ["child", "adult"]) {
      const id = `edit-source-${difficulty}`, entry = `${id}-entry`;
      const grid = { size: 5, cells: Array.from({ length: 25 }, (_, i) => ({ row: Math.floor(i / 5), column: i % 5, isBlocked: i > 1, ...(i === 0 ? { acrossNumber: 1 } : {}) })) };
      await run("INSERT INTO quiz_variants(id,quiz_set_id,difficulty,revision,grid_size,public_grid_json,word_count,active_cell_count,intersection_count,validation_report_json,created_at) VALUES(?,'edit-source',?,1,5,?,1,2,0,?,?)", id, difficulty, JSON.stringify(grid), JSON.stringify({ errors: [], warnings: [], generatedAt: now }), now);
      await run("INSERT INTO quiz_entries_public VALUES(?,?,1,'across',0,0,2,'synthetic clue','{}',0)", entry, id);
      await run("INSERT INTO quiz_solutions VALUES(?,?,?,?,?)", id, '["r0c0","r0c1"]', '{"r0c0":"가","r0c1":"나"}', JSON.stringify({ [entry]: "가나" }), hash);
      variants.push({ sourceVariantId: id, sourceRevision: 1, difficulty, grid, entries: [{ id: entry, number: 1, direction: "across", startRow: 0, startCol: 0, length: 2, clue: "synthetic clue", grounding: {}, displayOrder: 0 }], canonicalCellOrder: ["r0c0", "r0c1"], solutionCells: { r0c0: "가", r0c1: "나" }, entryAnswers: { [entry]: "가나" }, solutionSha256: hash });
    }
    const review = { metadata: { title: "synthetic", sermonDate: "2026-09-17" }, slug: "2026-09-17-abcdef", summary: "synthetic", disclosure: "synthetic", churchName: "synthetic", bibleReferenceLabel: "요 3:16", translation: "개역개정", bibleReadingUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE", variants };
    await run("INSERT INTO quiz_withdrawals VALUES('edit-source','synthetic-withdrawal',?,0,2,?,'synthetic',?,?)", now, JSON.stringify(review), actor, now);
  }
  if (cleanupUpgrade) {
    await run("INSERT INTO withdrawal_edit_revisions VALUES('edit-source',1,2,'synthetic-edit',?,?,?,?)", hash,
      JSON.stringify([{ difficulty: "child", entryId: "edit-source-child-entry", clue: "synthetic edited clue" }]), actor, now);
  }
  if (republicationUpgrade) {
    const [sourceSermon] = await rows("SELECT * FROM sermons WHERE id=?", sermon);
    await insert("sermons", { ...sourceSermon, id: "expired-source-sermon", slug: "2026-09-17-expir1", slug_suffix: "expir1", youtube_video_id: "synthetic-expired-edits", youtube_url: "https://example.invalid/synthetic-expired-edits" }).run();
    await run("INSERT INTO quiz_sets(id,sermon_id,status,created_by,created_at,updated_at,published_at,opens_at,closes_at) VALUES('expired-source',?,'published','synthetic',?,?,?,?, '2026-10-01T00:00:00.000Z')", "expired-source-sermon", now, now, now, now);
    const variants = [];
    for (const difficulty of ["child", "adult"]) {
      const id = `expired-source-${difficulty}`, entry = `${id}-entry`;
      const grid = { size: 5, cells: Array.from({ length: 25 }, (_, i) => ({ row: Math.floor(i / 5), column: i % 5, isBlocked: i > 1, ...(i === 0 ? { acrossNumber: 1 } : {}) })) };
      await run("INSERT INTO quiz_variants(id,quiz_set_id,difficulty,revision,grid_size,public_grid_json,word_count,active_cell_count,intersection_count,validation_report_json,created_at) VALUES(?,'expired-source',?,1,5,?,1,2,0,?,?)", id, difficulty, JSON.stringify(grid), JSON.stringify({ errors: [], warnings: [], generatedAt: now }), now);
      await run("INSERT INTO quiz_entries_public VALUES(?,?,1,'across',0,0,2,'synthetic clue','{}',0)", entry, id);
      await run("INSERT INTO quiz_solutions VALUES(?,?,?,?,?)", id, '["r0c0","r0c1"]', '{"r0c0":"가","r0c1":"나"}', JSON.stringify({ [entry]: "가나" }), hash);
      variants.push({ sourceVariantId: id, sourceRevision: 1, difficulty, grid, entries: [{ id: entry, number: 1, direction: "across", startRow: 0, startCol: 0, length: 2, clue: "synthetic clue", grounding: {}, displayOrder: 0 }], canonicalCellOrder: ["r0c0", "r0c1"], solutionCells: { r0c0: "가", r0c1: "나" }, entryAnswers: { [entry]: "가나" }, solutionSha256: hash });
    }
    const review = { metadata: { title: "synthetic", sermonDate: "2026-09-17" }, slug: "2026-09-17-abcdef", summary: "synthetic", disclosure: "synthetic", churchName: "synthetic", bibleReferenceLabel: "요 3:16", translation: "개역개정", bibleReadingUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE", variants };
    await run("INSERT INTO quiz_withdrawals VALUES('expired-source','synthetic-expired-withdrawal',?,0,2,?,'synthetic',?,?)", now, JSON.stringify(review), actor, now);
  }
  if (republicationUpgrade) {
    await run("INSERT INTO withdrawal_edit_revisions VALUES('expired-source',1,2,'synthetic-expired-edit',?,?,?,?)", hash,
      JSON.stringify([{ difficulty: "child", entryId: "expired-source-child-entry", clue: "synthetic edited clue" }]), actor, now);
  }
  if (republicationUpgrade) {
    const [{ edits_json: body }] = await rows("SELECT edits_json FROM withdrawal_edit_revisions WHERE quiz_set_id='expired-source'");
    const bodyHash=createHash("sha256").update(body).digest("hex");
    const due=new Date(Date.parse(now)+7*86400000).toISOString();
    await run("INSERT INTO withdrawal_edit_cleanup VALUES('expired-source',1,?,?,?,?)",now,due,due,JSON.stringify({1:bodyHash}));
  }
  const tables = (await schema()).filter(r => r.type === "table" && r.name !== "d1_migrations").map(r => r.name);
  const capture = async () => (await db.batch(tables.map(t => stmt(`SELECT * FROM ${t} ORDER BY 1`)))).map(r => r.results);
  const before = await capture(), oldTriggers = (await schema()).filter(r => r.type === "trigger");
  assert.equal(sources[target], problemUpgrade ? "0027_phase5_problem_corrections.sql" : republicationUpgrade ? "0026_phase5_quiz_republication.sql" : cleanupUpgrade ? "0025_phase5_withdrawal_edit_cleanup.sql" : editsUpgrade ? "0024_phase5_withdrawal_edits.sql" : "0023_phase5_withdrawals.sql");
  await db.batch([...(await migration(sources[target])).map(s => stmt(s)), insert("d1_migrations", { name: sources[target] })]);
  assert.deepEqual(await capture(), before, "Upgrade must preserve every old cell, BLOB, review, cost and audit row");
  checks += tables.length;
  const next = await schema();
  for (const trigger of oldTriggers) {
    if (problemUpgrade && trigger.name === "published_display_insert_guard") {
      assert.match(next.find(r=>r.type==="trigger" && r.name===trigger.name).sql,/quiz_content_versions/u);checks++;continue;
    }
    if (!problemUpgrade && republicationUpgrade && ["quiz_withdrawals_no_republish","published_quiz_set_transition","published_display_insert_guard","withdrawal_cleanup_insert"].includes(trigger.name)) {
      const guard=next.find(r=>r.type==="trigger" && r.name===trigger.name);
      assert.ok(guard);assert.match(guard.sql,/quiz_republications|quiz_revision_cleanup/u);checks++;continue;
    }
    if (!republicationUpgrade && cleanupUpgrade && trigger.name === "withdrawal_edits_update") {
      const guard = next.find(r => r.type === "trigger" && r.name === trigger.name);
      assert.match(guard.sql, /NEW.edits_json='\[\]'/u); assert.match(guard.sql, /NEW.request_sha256 IS OLD.request_sha256/u); checks++; continue;
    }
    assert.deepEqual(next.find(r => r.type === "trigger" && r.name === trigger.name), trigger);
    checks++;
  }
  assert.deepEqual(await rows(`SELECT * FROM ${problemUpgrade ? "quiz_problem_cases" : republicationUpgrade ? "quiz_revision_sessions" : cleanupUpgrade ? "withdrawal_edit_cleanup" : editsUpgrade ? "withdrawal_edit_revisions" : "quiz_withdrawals"}`), []);
  assert.deepEqual(await rows("PRAGMA foreign_key_check"), []);
  assert.deepEqual(await rows("PRAGMA quick_check"), [{ quick_check: "ok" }]);
  const foreignKeys = await rows(`PRAGMA foreign_key_list(${problemUpgrade ? "quiz_problem_cases" : republicationUpgrade ? "quiz_revision_sessions" : cleanupUpgrade ? "withdrawal_edit_cleanup" : editsUpgrade ? "withdrawal_edit_revisions" : "quiz_withdrawals"})`);
  assert.deepEqual(foreignKeys.map(key => key.table), [republicationUpgrade ? "quiz_sets" : editsUpgrade ? "quiz_withdrawals" : "quiz_sets"]);
  if (republicationUpgrade) for (const table of ["quiz_republications","quiz_revision_drafts","quiz_revision_cleanup"]) { assert.deepEqual(await rows(`SELECT * FROM ${table}`),[]); checks++; }
  checks += 4;
  console.log(`PASS ${problemUpgrade ? "P5-61 0026→0027" : republicationUpgrade ? "P5-60 0025→0026" : cleanupUpgrade ? "P5-60 0024→0025" : editsUpgrade ? "P5-60 0023→0024" : "P5-59 0022→0023"} populated preservation: ${checks} checks; ${tables.length} existing tables byte-preserved; ${problemUpgrade ? "one display guard extended; other triggers retained" : republicationUpgrade ? "four transition/display/expiry guards extended; other triggers retained" : cleanupUpgrade ? "one payload update guard narrowly extended; other triggers retained" : "every existing trigger retained"}; no backfill; FK/quick_check clean`);
} finally {
  await mf.dispose();
}
