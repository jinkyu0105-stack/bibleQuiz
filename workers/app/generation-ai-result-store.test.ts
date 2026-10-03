import { describe, expect, it } from "vitest";

import {
  createGenerationAiResultStore,
  type AiGenerationDomainResult,
  type AiGenerationProviderCall,
  type AiGenerationUsage,
} from "../_shared/repositories/generation-ai-result-store";
import { createGenerationRuntimeStore, type ClaimGenerationStepCommand } from "../_shared/repositories/generation-runtime-store";
import { createSermonInputStore, type InputEvent } from "../_shared/repositories/sermon-input-store";
import {
  runAiGenerationStep,
  type AiGenerationStepTransport,
  type AiGenerationStepTransportResult,
} from "../_shared/services/generation-runtime";
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
import { insertReviewedFinalTicket, seedReviewedHumanContent } from "./test/human-content-storage-fixture";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";

const t0 = "2026-09-17T02:00:00.000Z";
const t1 = "2026-09-17T02:00:01.000Z";
const t2 = "2026-09-17T02:00:02.000Z";
const lease = "2026-09-17T02:10:00.000Z";
const hash = generationTestHash;

type Running = {
  context: GenerationContext;
  input: InputEvent;
  plan: GenerationCreatePlan;
};

async function confirmedInput(context: GenerationContext, validSource = false): Promise<InputEvent> {
  const store = createSermonInputStore(generationDb);
  const sourceId = crypto.randomUUID();
  const confirmationId = crypto.randomUUID();
  const preparedSource = validSource ? await prepareManualTranscriptSource({ sourceMode: "manual_paste",
    manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript",
    rawTranscriptText: "TEST_ONLY_ORIGINAL" }) : null;
  if (preparedSource?.outcome === "failed") throw new Error("Synthetic source invalid");
  const documentSha256 = preparedSource?.outcome === "validated" ? preparedSource.source.rawTranscriptSha256 : hash("a");
  const common = {
    sermon_id: context.sermonId,
    source_type: "caption_plain" as const,
    source_id: sourceId,
    document_id: sourceId,
    document_sha256: documentSha256,
    actor_id: hash("b"),
  };
  expect(await store.append({
    ...common,
    version: 1,
    id: sourceId,
    kind: "source",
    confirmation_id: null,
    parent_document_id: null,
    related_id: null,
    created_at: t0,
  }, preparedSource?.outcome === "validated" ? preparedSource.source : { contractVersion: 1, content: "합성 입력" })).toBe("saved");
  expect(await store.append({
    ...common,
    version: 2,
    id: confirmationId,
    kind: "confirm",
    confirmation_id: confirmationId,
    parent_document_id: sourceId,
    related_id: null,
    created_at: t1,
  }, { contractVersion: 1, reviewed: true })).toBe("saved");
  const head = await store.head(context.sermonId);
  if (!head) throw new Error("missing synthetic input");
  return head;
}

async function runningJob(validSource = false): Promise<Running> {
  const context = await seedGenerationContext();
  const input = await confirmedInput(context, validSource);
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

function claim(running: Running, task: ClaimGenerationStepCommand["task"], stepKey: string, ticketId: string | null = null) {
  return {
    jobId: running.plan.jobId,
    stepKey,
    task,
    effectClass: "ai_provider" as const,
    inputFingerprint: hash("c"),
    inputVersion: running.input.version,
    sourceId: running.input.source_id,
    documentId: running.input.document_id,
    documentSha256: running.input.document_sha256,
    confirmationId: running.input.confirmation_id,
    metadataRevision: 1,
    bindingId: null,
    ticketId,
    claimToken: `claim:${crypto.randomUUID()}`,
    leaseExpiresAt: lease,
    now: t1,
  } satisfies ClaimGenerationStepCommand;
}

function providerCall(): AiGenerationProviderCall {
  return {
    id: `call:${crypto.randomUUID()}`,
    provider: "synthetic",
    model: "synthetic-model",
    reasoningEffort: "high",
    providerRequestIdOpaque: hash("d"),
  };
}

function usage(): AiGenerationUsage {
  return {
    id: `usage:${crypto.randomUUID()}`,
    inputTokens: 11,
    cachedInputTokens: null,
    reasoningTokens: 3,
    outputTokens: 7,
    audioInputTokens: null,
    audioSeconds: null,
    pricingVersion: "synthetic-v1",
    estimatedCostMicroUsd: 19,
    usageSource: "provider_reported",
    observedAt: t2,
  };
}

class SyntheticAiTransport implements AiGenerationStepTransport {
  calls = 0;

  constructor(readonly response: AiGenerationStepTransportResult) {}

  async invoke(): Promise<AiGenerationStepTransportResult> {
    this.calls++;
    return structuredClone(this.response);
  }
}

async function run(
  running: Running,
  task: ClaimGenerationStepCommand["task"],
  result: AiGenerationDomainResult,
  options: {
    call?: AiGenerationProviderCall;
    database?: D1Database;
    stepKey?: string;
    ticketId?: string | null;
    transport?: SyntheticAiTransport;
  } = {},
) {
  const stepKey = options.stepKey ?? `${task}:${crypto.randomUUID()}`;
  const transport = options.transport ?? new SyntheticAiTransport({ outcome: "completed", result, usage: usage() });
  const runtime = createGenerationRuntimeStore(generationDb);
  const aiStore = createGenerationAiResultStore(options.database ?? generationDb);
  const outcome = await runAiGenerationStep(runtime, aiStore, transport, {
    claim: claim(running, task, stepKey, options.ticketId ?? null),
    call: options.call ?? providerCall(),
    nextStep: "review",
    effectStartedAt: t1,
    completedAt: t2,
  });
  return { aiStore, outcome, stepKey, transport };
}

async function sealedTicket(running: Running): Promise<string> {
  const reviewed = await seedReviewedHumanContent(generationDb, {
    generationJobId: running.plan.jobId,
    input: running.input,
    sermonId: running.context.sermonId,
  });
  return insertReviewedFinalTicket(generationDb, {
    input: running.input,
    quizSetId: running.context.quizSetId,
    sermonId: running.context.sermonId,
  }, reviewed);
}

function loseSecondBatch(database: D1Database): D1Database {
  let count = 0;
  return new Proxy(database, {
    get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        count++;
        const result = await target.batch(statements);
        if (count === 2) throw new Error("PRIVATE_COMMITTED_RESPONSE_CANARY");
        return result;
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("P5-36 generation AI result store / isolated D1", () => {
  it("stores a document proposal with observed usage and keeps the current document unchanged", async () => {
    const running = await runningJob(true);
    const eventId = crypto.randomUUID();
    const payload = { kind: "correction_document_v1", sourceId: running.input.source_id,
      sourceSha256: running.input.document_sha256, baseDocumentId: running.input.document_id,
      baseDocumentSha256: running.input.document_sha256,
      content: { format: "plain_text", text: "TEST_ONLY_CORRECTED" } };
    const { outcome, aiStore, stepKey } = await run(running, "correction", {
      type: "correction", eventId, actorId: hash("f"), payload,
    }, { database: loseSecondBatch(generationDb) });
    expect(outcome.outcome).toBe("replayed");
    expect(await aiStore.probeSucceeded(running.plan.jobId, stepKey)).toBe("exact");
    const inputStore = createSermonInputStore(generationDb);
    const proposed = await inputStore.event(running.context.sermonId, eventId);
    expect(proposed).toMatchObject({ kind: "proposal", document_id: running.input.document_id,
      confirmation_id: running.input.confirmation_id });
    if (!proposed) throw new Error("Missing synthetic proposal");
    expect(await inputStore.payload(proposed)).toEqual(payload);
    expect((await inputStore.head(running.context.sermonId))?.document_id).toBe(running.input.document_id);
    expect((await generationDb.prepare("SELECT estimated_cost_micro_usd AS cost FROM ai_usage_events WHERE generation_job_id=?")
      .bind(running.plan.jobId).first<{ cost: number }>())?.cost).toBe(19);
  });
  it("rejects old item-shaped output for a new correction call without inventing a proposal", async () => {
    const running = await runningJob();
    const eventId = crypto.randomUUID();
    await expect(run(running, "correction", {
      type: "correction",
      eventId,
      actorId: hash("f"),
      payload: { contractVersion: 1, proposals: [{ before: "가", after: "나" }] },
    })).rejects.toThrow("GENERATION_AI_INVALID");
    expect(await generationDb.prepare("SELECT id FROM sermon_input_events WHERE sermon_id=? AND id=?")
      .bind(running.context.sermonId, eventId).first()).toBeNull();
    expect((await generationDb.prepare("SELECT count(*) AS total FROM ai_usage_events WHERE generation_job_id=?")
      .bind(running.plan.jobId).first<{ total: number }>())?.total).toBe(0);
  });

  it("commits a content result with exact payload hashes and replays the same step without a second call", async () => {
    const running = await runningJob();
    const eventId = `content:${crypto.randomUUID()}`;
    const stepKey = `intent_analysis:${crypto.randomUUID()}`;
    const domainResult: AiGenerationDomainResult = {
      type: "content", eventId, expectedContentEventCount: 0, kind: "intent_analysis", difficulty: null,
      baseAnalysisEventId: null, analysisEventId: null, intentConfirmationEventId: null,
      payload: { contractVersion: 1, privateCanary: "PRIVATE_AI_RESULT" },
    };
    const firstTransport = new SyntheticAiTransport({
      outcome: "completed",
      result: domainResult,
      usage: usage(),
    });
    const first = await run(running, "intent_analysis", domainResult, { stepKey, transport: firstTransport });
    expect(first.outcome.outcome).toBe("succeeded");
    const secondTransport = new SyntheticAiTransport({ outcome: "response_lost" });
    const second = await run(running, "intent_analysis", domainResult, {
      stepKey,
      transport: secondTransport,
    });
    expect(second.outcome.outcome).toBe("replayed");
    expect(firstTransport.calls).toBe(1);
    expect(secondTransport.calls).toBe(0);
    expect((await generationDb.prepare("SELECT count(*) AS total FROM ai_usage_events WHERE generation_job_id=?")
      .bind(running.plan.jobId).first<{ total: number }>())?.total).toBe(1);
  });

  it("commits a warning-only final audit against its immutable ticket", async () => {
    const running = await runningJob();
    const ticketId = await sealedTicket(running);
    const resultId = `audit:${crypto.randomUUID()}`;
    const result = await run(running, "final_audit", {
      type: "final_audit",
      resultId,
      finalCheckTicketId: ticketId,
      payload: { contractVersion: 1, warnings: [] },
    }, { ticketId });
    expect(result.outcome.outcome).toBe("succeeded");
    expect(await generationDb.prepare(`SELECT advisory_mode,publish_decision,state FROM ai_final_audit_results WHERE id=?`)
      .bind(resultId).first()).toEqual({
      advisory_mode: "advisory_only",
      publish_decision: "not_evaluated",
      state: "sealed",
    });
    expect(await result.aiStore.probeSucceeded(running.plan.jobId, result.stepKey)).toBe("exact");
  });

  it("P34-10 resolves a committed success response loss from the exact whole bundle", async () => {
    const running = await runningJob();
    const result = await run(running, "intent_analysis", {
      type: "content",
      eventId: `content:${crypto.randomUUID()}`,
      expectedContentEventCount: 0,
      kind: "intent_analysis",
      difficulty: null,
      baseAnalysisEventId: null,
      analysisEventId: null,
      intentConfirmationEventId: null,
      payload: { contractVersion: 1, value: "response lost" },
    }, { database: loseSecondBatch(generationDb) });
    expect(result.outcome.outcome).toBe("replayed");
    expect(await result.aiStore.probeSucceeded(running.plan.jobId, result.stepKey)).toBe("exact");
  });

  it("P34-11 classifies a call-only partial bundle and a failed read as non-success", async () => {
    const running = await runningJob();
    const runtime = createGenerationRuntimeStore(generationDb);
    const aiStore = createGenerationAiResultStore(generationDb);
    const stepKey = `summary:${crypto.randomUUID()}`;
    const claimed = await runtime.claimStep(claim(running, "summary", stepKey));
    expect(claimed.outcome).toBe("claimed");
    if (claimed.outcome !== "claimed") throw new Error("unreachable");
    await aiStore.startProviderCall({
      jobId: running.plan.jobId,
      stepKey,
      task: "summary",
      inputFingerprint: claimed.receipt.input_fingerprint,
      expectedAttempt: 1,
      claimToken: claimed.receipt.claim_token!,
      call: providerCall(),
      startedAt: t1,
    });
    expect(await aiStore.probeSucceeded(running.plan.jobId, stepKey)).toBe("mismatch");
    const unavailable = createGenerationAiResultStore(new Proxy(generationDb, {
      get(target, key) {
        if (key === "prepare") return () => { throw new Error("PRIVATE_PROBE_CANARY"); };
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }));
    expect(await unavailable.probeSucceeded(running.plan.jobId, stepKey)).toBe("unavailable");
  });

  it("P34-15 records provider usage and a safe failure without a result link", async () => {
    const running = await runningJob();
    const transport = new SyntheticAiTransport({ outcome: "rejected_with_usage", usage: usage() });
    const result = await run(running, "intent_analysis", {
      type: "content",
      eventId: `unused:${crypto.randomUUID()}`,
      expectedContentEventCount: 0,
      kind: "intent_analysis",
      difficulty: null,
      baseAnalysisEventId: null,
      analysisEventId: null,
      intentConfirmationEventId: null,
      payload: { unused: true },
    }, { transport });
    expect(result.outcome.outcome).toBe("terminal");
    expect((await generationDb.prepare("SELECT count(*) AS total FROM ai_usage_events WHERE generation_job_id=?")
      .bind(running.plan.jobId).first<{ total: number }>())?.total).toBe(1);
    expect((await generationDb.prepare("SELECT count(*) AS total FROM generation_step_result_links WHERE generation_job_id=?")
      .bind(running.plan.jobId).first<{ total: number }>())?.total).toBe(0);
    expect(await generationDb.prepare("SELECT state,error_code FROM generation_step_receipts WHERE generation_job_id=?")
      .bind(running.plan.jobId).first()).toEqual({ state: "terminal_failed", error_code: "GENERATION_DOMAIN_REJECTED" });
  });

  it("P34-16 keeps unknown usage uncertain, creates no zero event, and never calls again", async () => {
    const running = await runningJob();
    const stepKey = `summary:${crypto.randomUUID()}`;
    const transport = new SyntheticAiTransport({ outcome: "response_lost" });
    const domainResult: AiGenerationDomainResult = {
      type: "content",
      eventId: `unused:${crypto.randomUUID()}`,
      expectedContentEventCount: 0,
      kind: "summary",
      difficulty: null,
      baseAnalysisEventId: null,
      analysisEventId: "analysis",
      intentConfirmationEventId: "confirmation",
      payload: { unused: true },
    };
    const first = await run(running, "summary", domainResult, { stepKey, transport });
    expect(first.outcome.outcome).toBe("uncertain");
    const second = await run(running, "summary", domainResult, { stepKey, transport });
    expect(second.outcome.outcome).toBe("uncertain");
    expect(transport.calls).toBe(1);
    expect((await generationDb.prepare("SELECT count(*) AS total FROM ai_usage_events WHERE generation_job_id=?")
      .bind(running.plan.jobId).first<{ total: number }>())?.total).toBe(0);
    expect(await generationDb.prepare("SELECT state FROM ai_provider_calls WHERE generation_job_id=?")
      .bind(running.plan.jobId).first()).toEqual({ state: "uncertain" });
    expect(await generationDb.prepare("SELECT state FROM generation_step_receipts WHERE generation_job_id=?")
      .bind(running.plan.jobId).first()).toEqual({ state: "uncertain" });
  });
});
