import { describe, expect, it } from "vitest";

import { createSermonInputStore, type InputEvent } from "../_shared/repositories/sermon-input-store";
import {
  acknowledgeStartPlan,
  claimStartDispatch,
  executeGeneration,
  generationCreatePlan,
  generationDb,
  generationTestHash,
  seedGenerationContext,
  type GenerationContext,
  type GenerationCreatePlan,
} from "./test/generation-storage-fixture";
import {
  humanFailureStatements,
  insertReviewedFinalTicket,
  reviewedFinalTicketStatements,
  seedReviewedHumanContent,
  type ReviewedContentFixture,
} from "./test/human-content-storage-fixture";

type ResultContext = {
  context: GenerationContext;
  input: InputEvent;
  plan: GenerationCreatePlan;
};

type IntentIds = {
  callId: string;
  contentEventId: string;
  payloadSha256: string;
  resultKind: string;
  usageId: string;
};

const now = "2026-09-17T01:00:00.000Z";
const later = "2026-09-17T01:00:01.000Z";
const completed = "2026-09-17T01:00:02.000Z";
const hash = generationTestHash;

function insert(table: string, values: Record<string, string | number | null | ArrayBuffer>) {
  const columns = Object.keys(values);
  return generationDb.prepare(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
  ).bind(...Object.values(values));
}

function body(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

async function seedConfirmedInput(context: GenerationContext): Promise<InputEvent> {
  const store = createSermonInputStore(generationDb);
  const sourceId = crypto.randomUUID();
  const confirmationId = crypto.randomUUID();
  const documentSha256 = hash("1");
  const common = {
    sermon_id: context.sermonId,
    source_type: "caption_plain" as const,
    source_id: sourceId,
    document_id: sourceId,
    document_sha256: documentSha256,
    actor_id: hash("2"),
  };
  expect(await store.append({
    ...common,
    version: 1,
    id: sourceId,
    kind: "source",
    confirmation_id: null,
    parent_document_id: null,
    related_id: null,
    created_at: now,
  }, { contractVersion: 1, content: "합성 자막" })).toBe("saved");
  expect(await store.append({
    ...common,
    version: 2,
    id: confirmationId,
    kind: "confirm",
    confirmation_id: confirmationId,
    parent_document_id: sourceId,
    related_id: null,
    created_at: later,
  }, { contractVersion: 1, reviewed: true })).toBe("saved");
  const head = await store.head(context.sermonId);
  if (!head) throw new Error("synthetic input head unavailable");
  return head;
}

async function createRunningResultJob(): Promise<ResultContext> {
  const context = await seedGenerationContext();
  const input = await seedConfirmedInput(context);
  const plan = generationCreatePlan(context);
  const job = plan.steps[0]!;
  job.values[8] = "present";
  job.values[9] = input.version;
  job.values[10] = input.source_id;
  job.values[11] = input.document_id;
  job.values[12] = input.document_sha256;
  job.values[13] = input.confirmation_id;
  await executeGeneration(plan.steps);
  expect((await claimStartDispatch(plan)).meta.changes).toBe(1);
  await executeGeneration(acknowledgeStartPlan(plan));
  return { context, input, plan };
}

function aiReceipt(result: ResultContext, task: string, stepKey: string, ticketId: string | null = null) {
  return insert("generation_step_receipts", {
    generation_job_id: result.plan.jobId,
    step_key: stepKey,
    task,
    effect_class: "ai_provider",
    input_contract_version: 1,
    input_fingerprint: hash("3"),
    input_version: result.input.version,
    source_id: result.input.source_id,
    document_id: result.input.document_id,
    document_sha256: result.input.document_sha256,
    confirmation_id: result.input.confirmation_id,
    metadata_revision: 1,
    binding_id: null,
    ticket_id: ticketId,
    state: "claimed",
    attempt_count: 1,
    claim_token: `claim:${crypto.randomUUID()}`,
    lease_expires_at: "2026-09-17T01:05:00.000Z",
    provider_request_id_opaque: null,
    result_kind: null,
    result_id: null,
    result_version: null,
    result_fingerprint: null,
    error_code: null,
    error_message_safe: null,
    error_fingerprint: null,
    started_at: now,
    updated_at: now,
    completed_at: null,
  });
}

function intentSuccessStatements(
  result: ResultContext,
  options: {
    difficulty?: "child" | "adult" | null;
    eventKind?: "intent_analysis" | "intent_critique" | "summary" | "candidate";
    omit?: "payload" | "chunk" | "seal" | "link";
    staleInput?: boolean;
    task?: "intent_analysis" | "intent_critique" | "summary" | "child_candidates" | "adult_candidates";
    canary?: string;
    failJobCas?: boolean;
  } = {},
): { ids: IntentIds; statements: D1PreparedStatement[]; stepKey: string } {
  const task = options.task ?? "intent_analysis";
  const eventKind = options.eventKind ?? "intent_analysis";
  const difficulty = options.difficulty ?? null;
  const stepKey = `${task}:1`;
  const callId = `call:${crypto.randomUUID()}`;
  const usageId = `usage:${crypto.randomUUID()}`;
  const contentEventId = `content:${crypto.randomUUID()}`;
  const payloadText = JSON.stringify({ contractVersion: 1, canary: options.canary ?? null });
  const payloadBody = body(payloadText);
  const payloadSha256 = hash("4");
  const chunkSha256 = hash("5");
  const inputVersion = options.staleInput ? result.input.version - 1 : result.input.version;
  const resultKind = task === "intent_analysis" ? "intent_analysis_event"
    : task === "intent_critique" ? "intent_critique_event"
      : task === "summary" ? "summary_event"
        : task === "child_candidates" ? "child_candidates_event" : "adult_candidates_event";
  const statements: D1PreparedStatement[] = [
    generationDb.prepare(`UPDATE generation_step_receipts SET state='effect_started',provider_request_id_opaque=?,updated_at=?
      WHERE generation_job_id=? AND step_key=? AND state='claimed' AND attempt_count=1`)
      .bind(hash("6"), later, result.plan.jobId, stepKey),
    insert("ai_provider_calls", {
      id: callId,
      generation_job_id: result.plan.jobId,
      step_key: stepKey,
      attempt_number: 1,
      quiz_set_id: result.context.quizSetId,
      sermon_id: result.context.sermonId,
      task,
      input_fingerprint: hash("3"),
      provider: "openai",
      model: "test-model",
      reasoning_effort: "high",
      state: "effect_started",
      provider_request_id_opaque: hash("6"),
      started_at: later,
      completed_at: null,
    }),
    generationDb.prepare("UPDATE ai_provider_calls SET state='completed',completed_at=? WHERE id=? AND state='effect_started'")
      .bind(completed, callId),
    insert("ai_usage_events", {
      id: usageId,
      provider_call_id: callId,
      generation_job_id: result.plan.jobId,
      step_key: stepKey,
      attempt_number: 1,
      quiz_set_id: result.context.quizSetId,
      sermon_id: result.context.sermonId,
      task,
      provider: "openai",
      model: "test-model",
      input_tokens: 10,
      cached_input_tokens: null,
      reasoning_tokens: 2,
      output_tokens: 5,
      audio_input_tokens: null,
      audio_seconds: null,
      pricing_version: "test-v1",
      estimated_cost_micro_usd: 123,
      usage_source: "provider_reported",
      observed_at: completed,
    }),
    insert("sermon_content_events", {
      sermon_id: result.context.sermonId,
      event_id: contentEventId,
      content_sequence: 1,
      aggregate_version: inputVersion + 1,
      origin: "ai",
      kind: eventKind,
      difficulty,
      generation_job_id: result.plan.jobId,
      step_key: stepKey,
      input_version: inputVersion,
      source_id: result.input.source_id,
      document_id: result.input.document_id,
      document_sha256: result.input.document_sha256,
      confirmation_id: result.input.confirmation_id,
      base_analysis_event_id: eventKind === "intent_critique" ? "missing-analysis" : null,
      analysis_event_id: eventKind === "summary" || eventKind === "candidate" ? "missing-analysis" : null,
      intent_confirmation_event_id: eventKind === "summary" || eventKind === "candidate" ? "missing-confirmation" : null,
      payload_sha256: payloadSha256,
      payload_byte_length: payloadBody.byteLength,
      payload_chunk_count: 1,
      state: "assembling",
      required_state: "sealed",
      created_by_actor_id: null,
      created_at: completed,
    }),
  ];
  if (options.omit !== "payload") statements.push(insert("sermon_content_payloads", {
    sermon_id: result.context.sermonId,
    event_id: contentEventId,
    codec: "content-event-json-utf8-v1",
    chunk_bytes: 65536,
    chunk_count: 1,
    byte_length: payloadBody.byteLength,
    payload_sha256: payloadSha256,
    verified: 0,
  }));
  if (options.omit !== "chunk") statements.push(insert("sermon_content_chunks", {
    sermon_id: result.context.sermonId,
    event_id: contentEventId,
    position: 0,
    byte_length: payloadBody.byteLength,
    chunk_sha256: chunkSha256,
    body: payloadBody,
    verified: 1,
  }));
  statements.push(
    insert("sermon_content_heads", {
      sermon_id: result.context.sermonId,
      event_count: 1,
      last_event_id: contentEventId,
      required_event_count: 1,
      required_event_id: contentEventId,
    }),
    generationDb.prepare("UPDATE sermon_content_payloads SET verified=1 WHERE sermon_id=? AND event_id=? AND verified=0")
      .bind(result.context.sermonId, contentEventId),
  );
  if (options.omit !== "seal") statements.push(
    generationDb.prepare("UPDATE sermon_content_events SET state='sealed' WHERE sermon_id=? AND event_id=? AND state='assembling'")
      .bind(result.context.sermonId, contentEventId),
  );
  if (options.omit !== "link") statements.push(insert("generation_step_result_links", {
    generation_job_id: result.plan.jobId,
    step_key: stepKey,
    task,
    correction_sermon_id: null,
    correction_event_id: null,
    content_sermon_id: result.context.sermonId,
    content_event_id: contentEventId,
    final_audit_result_id: null,
    usage_event_id: usageId,
    result_kind: resultKind,
    result_id: contentEventId,
    result_version: inputVersion + 1,
    result_fingerprint: payloadSha256,
  }));
  statements.push(
    generationDb.prepare(`UPDATE generation_step_receipts SET state='succeeded',claim_token=NULL,lease_expires_at=NULL,
      result_kind=?,result_id=?,result_version=?,result_fingerprint=?,updated_at=?,completed_at=?
      WHERE generation_job_id=? AND step_key=? AND state='effect_started' AND attempt_count=1`)
      .bind(resultKind, contentEventId, inputVersion + 1, payloadSha256, completed, completed, result.plan.jobId, stepKey),
    generationDb.prepare(`UPDATE generation_jobs SET current_step='intent_review',state_version=2,event_count=3,
      required_event_no=3,required_event_state_version=2,updated_at=? WHERE id=? AND status='running'
      AND state_version=1 AND event_count=2${options.failJobCas ? " AND 0" : ""}`)
      .bind(completed, result.plan.jobId),
    insert("generation_job_events", {
      generation_job_id: result.plan.jobId,
      event_no: 3,
      job_state_version: 2,
      attempt_number: 1,
      step_key: stepKey,
      level: "info",
      event_code: "step_succeeded",
      message_safe: "step_succeeded",
      metadata_json_safe: JSON.stringify({ jobId: result.plan.jobId, eventCode: "step_succeeded", stepKey, attempt: 1 }),
      elapsed_ms: 1,
      created_at: completed,
    }),
  );
  return { ids: { callId, contentEventId, payloadSha256, resultKind, usageId }, statements, stepKey };
}

async function resultCounts(result: ResultContext) {
  const tables = [
    "sermon_content_heads", "sermon_content_events", "sermon_content_payloads", "sermon_content_chunks",
    "final_check_tickets", "final_check_ticket_chunks", "ai_final_audit_results", "ai_final_audit_chunks",
    "ai_provider_calls", "ai_usage_events", "generation_step_result_links",
  ];
  const counts = await Promise.all(tables.map(async (table) =>
    (await generationDb.prepare(`SELECT count(*) AS total FROM ${table}`).first<{ total: number }>())?.total ?? -1));
  const receipt = await generationDb.prepare(
    "SELECT state,result_id FROM generation_step_receipts WHERE generation_job_id=? ORDER BY step_key",
  ).bind(result.plan.jobId).all();
  const job = await generationDb.prepare(
    "SELECT state_version,event_count FROM generation_jobs WHERE id=?",
  ).bind(result.plan.jobId).first();
  return { counts, job, receipt: receipt.results };
}

async function seedIntentReceipt(result: ResultContext, task = "intent_analysis", stepKey = `${task}:1`) {
  await generationDb.batch([aiReceipt(result, task, stepKey)]);
  return stepKey;
}

async function insertSealedTicket(result: ResultContext, ticketId = `ticket:${crypto.randomUUID()}`) {
  const reviewed = await seedReviewedHumanContent(generationDb, {
    generationJobId: result.plan.jobId,
    input: result.input,
    sermonId: result.context.sermonId,
  });
  return insertReviewedFinalTicket(generationDb, {
    input: result.input,
    quizSetId: result.context.quizSetId,
    sermonId: result.context.sermonId,
  }, reviewed, ticketId);
}

describe("P5-35 AI result/usage storage structure / isolated D1", () => {
  it("adds eleven empty private tables, deferred seals, task link FK, and reviewed guards", async () => {
    const tables = [
      "ai_final_audit_chunks", "ai_final_audit_results", "ai_provider_calls", "ai_usage_events",
      "final_check_ticket_chunks", "final_check_tickets", "generation_step_result_links",
      "sermon_content_chunks", "sermon_content_events", "sermon_content_heads", "sermon_content_payloads",
    ];
    const rows = (await generationDb.prepare(
      `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN (${tables.map(() => "?").join(",")})
       OR name='generation_ai_receipt_success_guard' ORDER BY type,name`,
    ).bind(...tables).all()).results as Array<Record<string, string>>;
    expect(rows.filter((row) => row.type === "table").map((row) => row.name)).toEqual(tables);
    const p535Triggers = rows.filter((row) => row.type === "trigger"
      && row.name !== "final_check_ticket_current_seal_guard"
      && row.name !== "sermon_content_human_seal_guard");
    expect(p535Triggers).toHaveLength(34);
    expect(rows.find((row) => row.name === "sermon_content_events")?.sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(rows.find((row) => row.name === "final_check_tickets")?.sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(rows.find((row) => row.name === "ai_final_audit_results")?.sql).toContain("DEFERRABLE INITIALLY DEFERRED");
  });

  it.each(["payload", "chunk", "seal"] as const)("P34-01 rolls back the whole result batch when %s is missing", async (omit) => {
    const result = await createRunningResultJob();
    await seedIntentReceipt(result);
    const before = await resultCounts(result);
    await expect(generationDb.batch(intentSuccessStatements(result, { omit }).statements)).rejects.toThrow();
    expect(await resultCounts(result)).toEqual(before);
  });

  it("P34-02 rejects a stale input tuple before persisting result or usage", async () => {
    const result = await createRunningResultJob();
    await seedIntentReceipt(result);
    const before = await resultCounts(result);
    await expect(generationDb.batch(intentSuccessStatements(result, { staleInput: true }).statements)).rejects.toThrow();
    expect(await resultCounts(result)).toEqual(before);
  });

  it.each([
    { task: "intent_critique", kind: "intent_analysis", difficulty: null },
    { task: "summary", kind: "summary", difficulty: null },
    { task: "child_candidates", kind: "candidate", difficulty: "adult" },
  ] as const)("P34-04~06 rejects task/content lineage mismatch for $task", async ({ task, kind, difficulty }) => {
    const result = await createRunningResultJob();
    await seedIntentReceipt(result, task);
    const before = await resultCounts(result);
    await expect(generationDb.batch(intentSuccessStatements(result, {
      task,
      eventKind: kind,
      difficulty,
    }).statements)).rejects.toThrow();
    expect(await resultCounts(result)).toEqual(before);
  });

  it("P34-08 requires one exact task result link and one usage event before AI receipt success", async () => {
    const result = await createRunningResultJob();
    await seedIntentReceipt(result);
    const before = await resultCounts(result);
    await expect(generationDb.batch(intentSuccessStatements(result, { omit: "link" }).statements)).rejects.toThrow();
    expect(await resultCounts(result)).toEqual(before);
  });

  it("P34-09 rolls result, usage, link, receipt, and job event back when the job CAS affects zero rows", async () => {
    const result = await createRunningResultJob();
    await seedIntentReceipt(result);
    const before = await resultCounts(result);
    await expect(generationDb.batch(intentSuccessStatements(result, { failJobCas: true }).statements)).rejects.toThrow();
    expect(await resultCounts(result)).toEqual(before);
  });

  it("stores one sealed intent result with exact provider usage and a task-specific link", async () => {
    const result = await createRunningResultJob();
    await seedIntentReceipt(result);
    const { ids, statements } = intentSuccessStatements(result);
    await generationDb.batch(statements);
    expect(await generationDb.prepare(
      "SELECT task,result_kind,result_id,result_version,result_fingerprint,usage_event_id FROM generation_step_result_links WHERE generation_job_id=?",
    ).bind(result.plan.jobId).first()).toEqual({
      task: "intent_analysis",
      result_kind: ids.resultKind,
      result_id: ids.contentEventId,
      result_version: result.input.version + 1,
      result_fingerprint: ids.payloadSha256,
      usage_event_id: ids.usageId,
    });
    expect(await generationDb.prepare("SELECT state FROM ai_provider_calls WHERE id=?").bind(ids.callId).first()).toEqual({ state: "completed" });
    expect((await generationDb.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect((await generationDb.prepare("PRAGMA quick_check").all()).results).toEqual([{ quick_check: "ok" }]);
  });

  it("P34-12 allows only one usage event for one provider call", async () => {
    const result = await createRunningResultJob();
    const stepKey = await seedIntentReceipt(result);
    const callId = `call:${crypto.randomUUID()}`;
    await generationDb.batch([
      generationDb.prepare("UPDATE generation_step_receipts SET state='effect_started',provider_request_id_opaque=?,updated_at=? WHERE generation_job_id=? AND step_key=? AND state='claimed'")
        .bind(hash("6"), later, result.plan.jobId, stepKey),
      insert("ai_provider_calls", {
        id: callId, generation_job_id: result.plan.jobId, step_key: stepKey, attempt_number: 1,
        quiz_set_id: result.context.quizSetId, sermon_id: result.context.sermonId, task: "intent_analysis",
        input_fingerprint: hash("3"), provider: "openai", model: "test-model", reasoning_effort: null,
        state: "effect_started", provider_request_id_opaque: hash("6"), started_at: later, completed_at: null,
      }),
      generationDb.prepare("UPDATE ai_provider_calls SET state='completed',completed_at=? WHERE id=? AND state='effect_started'")
        .bind(completed, callId),
    ]);
    const usage = (id: string) => insert("ai_usage_events", {
      id, provider_call_id: callId, generation_job_id: result.plan.jobId, step_key: stepKey, attempt_number: 1,
      quiz_set_id: result.context.quizSetId, sermon_id: result.context.sermonId, task: "intent_analysis",
      provider: "openai", model: "test-model", input_tokens: 1, cached_input_tokens: null,
      reasoning_tokens: null, output_tokens: 1, audio_input_tokens: null, audio_seconds: null,
      pricing_version: "test-v1", estimated_cost_micro_usd: 1, usage_source: "provider_reported", observed_at: completed,
    });
    const outcomes = await Promise.allSettled([
      generationDb.batch([usage(`usage:${crypto.randomUUID()}`)]),
      generationDb.batch([usage(`usage:${crypto.randomUUID()}`)]),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect((await generationDb.prepare("SELECT count(*) AS total FROM ai_usage_events WHERE provider_call_id=?")
      .bind(callId).first<{ total: number }>())?.total).toBe(1);
  });

  it("P34-14 rejects a result link whose task or target differs from the receipt", async () => {
    const result = await createRunningResultJob();
    await seedIntentReceipt(result);
    const valid = intentSuccessStatements(result);
    const linkIndex = valid.statements.length - 3;
    valid.statements[linkIndex] = insert("generation_step_result_links", {
      generation_job_id: result.plan.jobId,
      step_key: valid.stepKey,
      task: "adult_candidates",
      correction_sermon_id: null,
      correction_event_id: null,
      content_sermon_id: result.context.sermonId,
      content_event_id: valid.ids.contentEventId,
      final_audit_result_id: null,
      usage_event_id: valid.ids.usageId,
      result_kind: "adult_candidates_event",
      result_id: valid.ids.contentEventId,
      result_version: result.input.version + 1,
      result_fingerprint: valid.ids.payloadSha256,
    });
    const before = await resultCounts(result);
    await expect(generationDb.batch(valid.statements)).rejects.toThrow();
    expect(await resultCounts(result)).toEqual(before);
  });

  it("P34-07 rejects final audit storage when its immutable ticket does not match the receipt", async () => {
    const result = await createRunningResultJob();
    const ticketId = await insertSealedTicket(result);
    const stepKey = "final_audit:1";
    await generationDb.batch([aiReceipt(result, "final_audit", stepKey, ticketId)]);
    const before = await resultCounts(result);
    await expect(generationDb.batch([insert("ai_final_audit_results", {
      id: `audit:${crypto.randomUUID()}`,
      generation_job_id: result.plan.jobId,
      step_key: stepKey,
      final_check_ticket_id: "missing-ticket",
      result_version: 1,
      result_fingerprint: hash("a"),
      payload_sha256: hash("b"),
      payload_byte_length: 2,
      payload_chunk_count: 1,
      advisory_mode: "advisory_only",
      publish_decision: "not_evaluated",
      state: "assembling",
      required_state: "sealed",
      created_at: completed,
    })])).rejects.toThrow();
    expect(await resultCounts(result)).toEqual(before);
  });

  it("P34-03 rejects correction links to a non-proposal input event", async () => {
    const result = await createRunningResultJob();
    const stepKey = "correction:1";
    await generationDb.batch([aiReceipt(result, "correction", stepKey)]);
    const callId = `call:${crypto.randomUUID()}`;
    const usageId = `usage:${crypto.randomUUID()}`;
    await generationDb.batch([
      generationDb.prepare("UPDATE generation_step_receipts SET state='effect_started',provider_request_id_opaque=?,updated_at=? WHERE generation_job_id=? AND step_key=? AND state='claimed'")
        .bind(hash("6"), later, result.plan.jobId, stepKey),
      insert("ai_provider_calls", {
        id: callId, generation_job_id: result.plan.jobId, step_key: stepKey, attempt_number: 1,
        quiz_set_id: result.context.quizSetId, sermon_id: result.context.sermonId, task: "correction",
        input_fingerprint: hash("3"), provider: "openai", model: "test-model", reasoning_effort: null,
        state: "effect_started", provider_request_id_opaque: hash("6"), started_at: later, completed_at: null,
      }),
      generationDb.prepare("UPDATE ai_provider_calls SET state='completed',completed_at=? WHERE id=?").bind(completed, callId),
      insert("ai_usage_events", {
        id: usageId, provider_call_id: callId, generation_job_id: result.plan.jobId, step_key: stepKey, attempt_number: 1,
        quiz_set_id: result.context.quizSetId, sermon_id: result.context.sermonId, task: "correction",
        provider: "openai", model: "test-model", input_tokens: 1, cached_input_tokens: null,
        reasoning_tokens: null, output_tokens: 1, audio_input_tokens: null, audio_seconds: null,
        pricing_version: "test-v1", estimated_cost_micro_usd: 1, usage_source: "provider_reported", observed_at: completed,
      }),
    ]);
    await expect(generationDb.batch([insert("generation_step_result_links", {
      generation_job_id: result.plan.jobId,
      step_key: stepKey,
      task: "correction",
      correction_sermon_id: result.context.sermonId,
      correction_event_id: result.input.source_id,
      content_sermon_id: null,
      content_event_id: null,
      final_audit_result_id: null,
      usage_event_id: usageId,
      result_kind: "correction_proposal",
      result_id: result.input.source_id,
      result_version: result.input.version,
      result_fingerprint: result.input.payload_sha256,
    })])).rejects.toThrow();
    expect((await generationDb.prepare("SELECT count(*) AS total FROM generation_step_result_links WHERE generation_job_id=?")
      .bind(result.plan.jobId).first<{ total: number }>())?.total).toBe(0);
  });

  it("P34-17 keeps a private canary only in private payload chunks", async () => {
    const result = await createRunningResultJob();
    await seedIntentReceipt(result);
    const canary = "PRIVATE_RESULT_CANARY";
    await generationDb.batch(intentSuccessStatements(result, { canary }).statements);
    const publicSafeTables = [
      "generation_jobs", "generation_job_events", "generation_step_receipts", "generation_step_result_links",
      "ai_provider_calls", "ai_usage_events", "sermon_content_events", "sermon_content_payloads", "sermon_content_heads",
    ];
    const serialized = JSON.stringify(await Promise.all(publicSafeTables.map(async (table) =>
      (await generationDb.prepare(`SELECT * FROM ${table}`).all()).results)));
    expect(serialized).not.toContain(canary);
    const chunk = await generationDb.prepare(
      "SELECT body FROM sermon_content_chunks WHERE sermon_id=?",
    ).bind(result.context.sermonId).first<{ body: number[] }>();
    expect(new TextDecoder().decode(Uint8Array.from(chunk?.body ?? []))).toContain(canary);
  });
});

async function reviewedFixture() {
  const result = await createRunningResultJob();
  const reviewed = await seedReviewedHumanContent(generationDb, {
    generationJobId: result.plan.jobId,
    input: result.input,
    sermonId: result.context.sermonId,
  });
  return { result, reviewed };
}

async function contentState(sermonId: string) {
  const events = (await generationDb.prepare(
    "SELECT count(*) AS total FROM sermon_content_events WHERE sermon_id=?",
  ).bind(sermonId).first<{ total: number }>())?.total;
  const head = await generationDb.prepare(
    "SELECT event_count,last_event_id FROM sermon_content_heads WHERE sermon_id=?",
  ).bind(sermonId).first();
  const current = await generationDb.prepare(
    `SELECT event_count,last_event_id,summary_snapshot_event_id,summary_review_event_id,
      child_review_event_id,adult_review_event_id FROM sermon_content_current WHERE sermon_id=?`,
  ).bind(sermonId).first();
  return { current, events, head };
}

function humanBundle(
  result: ResultContext,
  reviewed: ReviewedContentFixture,
  options: Parameters<typeof humanFailureStatements>[3] = {},
) {
  return humanFailureStatements(generationDb, {
    input: result.input,
    sermonId: result.context.sermonId,
  }, reviewed, options);
}

describe("P5-38 human content current/FK and final ticket input guards / isolated D1", () => {
  it("adds exactly three additive tables with the reviewed physical guards", async () => {
    const tables = ["final_check_ticket_inputs", "sermon_content_current", "sermon_content_human_events"];
    const schema = (await generationDb.prepare(
      `SELECT type,name,tbl_name FROM sqlite_schema WHERE tbl_name IN (${tables.map(() => "?").join(",")})
       ORDER BY type,name`,
    ).bind(...tables).all()).results as Array<{ name: string; tbl_name: string; type: string }>;
    expect(schema.filter((row) => row.type === "table").map((row) => row.name)).toEqual(tables);
    expect(schema.filter((row) => row.type === "trigger").map((row) => row.name)).toEqual([
      "final_check_ticket_input_delete_guard",
      "final_check_ticket_input_insert_guard",
      "final_check_ticket_input_update_guard",
      "sermon_content_current_delete_guard",
      "sermon_content_current_insert_guard",
      "sermon_content_current_update_guard",
      "sermon_content_human_delete_guard",
      "sermon_content_human_insert_guard",
      "sermon_content_human_update_guard",
    ]);
  });

  it("P37-01 rejects a human origin event with no detail and rolls the whole projection back", async () => {
    const { result, reviewed } = await reviewedFixture();
    const before = await contentState(result.context.sermonId);
    await expect(generationDb.batch(humanBundle(result, reviewed, { omit: "detail" }).statements)).rejects.toThrow();
    expect(await contentState(result.context.sermonId)).toEqual(before);
  });

  it("P37-01 rejects a reused command key", async () => {
    const { result, reviewed } = await reviewedFixture();
    const existing = await generationDb.prepare(
      "SELECT command_key FROM sermon_content_human_events WHERE sermon_id=? LIMIT 1",
    ).bind(result.context.sermonId).first<{ command_key: string }>();
    if (!existing) throw new Error("review fixture command unavailable");
    const before = await contentState(result.context.sermonId);
    await expect(generationDb.batch(humanBundle(result, reviewed, {
      commandKey: existing.command_key,
    }).statements)).rejects.toThrow();
    expect(await contentState(result.context.sermonId)).toEqual(before);
  });

  it("P37-02 rejects a same-sermon base FK with the wrong kind and preserves current", async () => {
    const { result, reviewed } = await reviewedFixture();
    const before = await contentState(result.context.sermonId);
    await expect(generationDb.batch(humanBundle(result, reviewed, {
      baseSnapshotEventId: reviewed.childPoolEventId,
    }).statements)).rejects.toThrow();
    expect(await contentState(result.context.sermonId)).toEqual(before);
  });

  it.each([
    ["P37-03", "intent_confirm_mismatch"],
    ["P37-04", "summary_review_mismatch"],
    ["P37-05", "candidate_review_mismatch"],
  ] as const)("%s rejects mismatched semantic lineage and leaves no event", async (_id, mode) => {
    const { result, reviewed } = await reviewedFixture();
    const before = await contentState(result.context.sermonId);
    await expect(generationDb.batch(humanBundle(result, reviewed, { mode }).statements)).rejects.toThrow();
    expect(await contentState(result.context.sermonId)).toEqual(before);
  });

  it("P37-06 lets only one command win the same expected head/current", async () => {
    const { result, reviewed } = await reviewedFixture();
    const first = humanBundle(result, reviewed);
    const second = humanBundle(result, reviewed);
    await generationDb.batch(first.statements);
    await expect(generationDb.batch(second.statements)).rejects.toThrow();
    const state = await contentState(result.context.sermonId);
    expect(state.events).toBe(10);
    expect(state.head).toMatchObject({ event_count: 10 });
    expect(state.current).toMatchObject({ event_count: 10, summary_review_event_id: null });
  });

  it.each(["payload", "chunk", "verify", "seal"] as const)(
    "P37-07 rolls the human event bundle back when %s is missing",
    async (omit) => {
      const { result, reviewed } = await reviewedFixture();
      const before = await contentState(result.context.sermonId);
      await expect(generationDb.batch(humanBundle(result, reviewed, { omit }).statements)).rejects.toThrow();
      expect(await contentState(result.context.sermonId)).toEqual(before);
    },
  );

  it.each(["head", "current"] as const)(
    "P37-08 rolls back when the %s projection update is missing",
    async (omit) => {
      const { result, reviewed } = await reviewedFixture();
      const before = await contentState(result.context.sermonId);
      await expect(generationDb.batch(humanBundle(result, reviewed, { omit }).statements)).rejects.toThrow();
      expect(await contentState(result.context.sermonId)).toEqual(before);
    },
  );

  it("P37-09 rejects retaining a stale summary review after an edit", async () => {
    const { result, reviewed } = await reviewedFixture();
    const before = await contentState(result.context.sermonId);
    await expect(generationDb.batch(humanBundle(result, reviewed, {
      keepInvalidReview: true,
    }).statements)).rejects.toThrow();
    expect(await contentState(result.context.sermonId)).toEqual(before);
  });

  it.each([
    ["missing exact input", { omit: "input" }],
    ["swapped child/adult review", { swapChildAdultReview: true }],
  ] as const)("P37-12 rejects a ticket with %s", async (_case, options) => {
    const { result, reviewed } = await reviewedFixture();
    const bundle = reviewedFinalTicketStatements(generationDb, {
      input: result.input,
      quizSetId: result.context.quizSetId,
      sermonId: result.context.sermonId,
    }, reviewed, options);
    await expect(generationDb.batch(bundle.statements)).rejects.toThrow();
    expect(await generationDb.prepare("SELECT id FROM final_check_tickets WHERE id=?")
      .bind(bundle.ticketId).first()).toBeNull();
  });

  it("P37-13 rejects sealing when current changes after ticket capture and rolls both bundles back", async () => {
    const { result, reviewed } = await reviewedFixture();
    const ticket = reviewedFinalTicketStatements(generationDb, {
      input: result.input,
      quizSetId: result.context.quizSetId,
      sermonId: result.context.sermonId,
    }, reviewed, { omit: "seal" });
    const edit = humanBundle(result, reviewed);
    const seal = generationDb.prepare(
      "UPDATE final_check_tickets SET state='sealed' WHERE id=? AND state='assembling'",
    ).bind(ticket.ticketId);
    const before = await contentState(result.context.sermonId);
    await expect(generationDb.batch([...ticket.statements, ...edit.statements, seal])).rejects.toThrow();
    expect(await contentState(result.context.sermonId)).toEqual(before);
    expect(await generationDb.prepare("SELECT id FROM final_check_tickets WHERE id=?")
      .bind(ticket.ticketId).first()).toBeNull();
  });

  it("P37-19 permits only one sealed ticket for one canonical fingerprint", async () => {
    const { result, reviewed } = await reviewedFixture();
    const context = {
      input: result.input,
      quizSetId: result.context.quizSetId,
      sermonId: result.context.sermonId,
    };
    const fingerprint = "3".repeat(64);
    const first = reviewedFinalTicketStatements(generationDb, context, reviewed, { fingerprint });
    const second = reviewedFinalTicketStatements(generationDb, context, reviewed, { fingerprint });
    await generationDb.batch(first.statements);
    await expect(generationDb.batch(second.statements)).rejects.toThrow();
    expect(await generationDb.prepare(
      "SELECT count(*) AS total FROM final_check_tickets WHERE state='sealed' AND ticket_fingerprint=?",
    ).bind(fingerprint).first()).toEqual({ total: 1 });
  });
});
