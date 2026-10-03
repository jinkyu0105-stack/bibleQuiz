import { generationReadSession, clearGenerationReads } from "../repositories/generation-read-session";
import { draftIsPurged } from "./draft-cleanup";
import { z } from "zod";
import { adminCorrectionGenerationRequestSchema } from "../../../shared/api/admin-generation";
import { createGenerationLifecycleStore } from "../repositories/generation-lifecycle-store";
import { createAiDraftProvider } from "./ai-draft-provider";
import { aiDraftRequestSchema } from "./ai-draft-provider-contract";
import { readCorrectionAuthority } from "./generation-correction-reader";
import { generationAggregateVersion } from "./generation-bridge";
import { lifecycleId, type StepContext, type UsageObservation } from "./generation-lifecycle-contract";
import type { ContextEnvelopeInput } from "./generation-context-codec";
import { createOpenAiDraftTransport, OPENAI_DRAFT_MODEL } from "./openai-draft-transport";
import { estimateOpenAiDraftCost } from "./openai-draft-cost";
import { materializeCorrectionDocument } from "./transcript-correction-document";
import { runIntentGeneration } from "./content-intent-generation";
import { createAiResponseArchive } from "../repositories/ai-response-archive";

export const contentWorkflowParamsSchema = z.strictObject({ dispatchId: lifecycleId });
export type ContentWorkflowParams = z.infer<typeof contentWorkflowParamsSchema>;
export type GenerationUnit = (name: string, run: () => Promise<{ outcome: string }>) => Promise<{ outcome: string }>;
export type GenerationRunOptions = { fetch?: typeof fetch; now?: () => string; timeoutMs?: number; unit?: GenerationUnit | undefined; archiveResponses?: boolean };
export interface ContentGenerationBindings {
  CONTENT_DISPLAY_PREPARATION_ENABLED?: string;
  CONTENT_DISPLAY_PREPARATION_SERMON_IDS?: string;
  DB: D1Database;
  OPENAI_API_KEY?: string;
  /** Deployment/runtime opt-in remains off until paid execution is approved. */
  AI_GENERATION_ENABLED?: string;
  AI_RESPONSE_ARCHIVE_ENABLED?: string;
}
const clock = () => new Date().toISOString();
const lease = (now: string) => new Date(Date.parse(now) + 600_000).toISOString();
export const correctionRequestSchema = adminCorrectionGenerationRequestSchema;
const base = (owner: { jobId: string; sermonId: string; quizSetId: string }, key: string, now: string,
  contextId: string, stepKey: string | null): ContextEnvelopeInput => ({ ...owner, requestKey: key,
  createdAt: now, contextId, kind: stepKey ? "step" : "request", stepKey, waitGeneration: null,
  codec: "generation-context-json-utf8-v1" });

/** One explicit administrator request has one durable ID. Replaying it does
 * not generate a new provider call, even when the dispatch response was lost. */
export async function requestCorrection(db: D1Database, sermonId: string, raw: unknown, actorDigest: string) {
  db = generationReadSession(db);
  const command = correctionRequestSchema.parse(raw);
  const owner = { jobId: command.requestKey, sermonId, quizSetId: command.quizSetId };
  const store = createGenerationLifecycleStore(db);
  const prior = await store.readJob(owner.jobId);
  if (prior.outcome === "present") {
    const saved = await store.readContext(prior.value.request_context_id);
    if (saved.outcome !== "present" || saved.value.context.kind !== "request" ||
      saved.value.context.actorDigest !== actorDigest || prior.value.sermon_id !== sermonId ||
      prior.value.quiz_set_id !== command.quizSetId || prior.value.request_scope !== "transcript_correction" ||
      saved.value.context.authority.input.state !== "present" ||
      saved.value.context.authority.input.version !== command.expectedInputVersion) throw new Error("GENERATION_REQUEST_CONFLICT");
    return { jobId: owner.jobId, dispatchId: `dispatch-${owner.jobId}`, outcome: "replayed" as const };
  }
  if (prior.outcome !== "absent") throw new Error("GENERATION_JOB_UNAVAILABLE");
  const captured = await readCorrectionAuthority(db, owner);
  if (captured.snapshot.input.state !== "present" || captured.snapshot.input.version !== command.expectedInputVersion) {
    throw new Error("GENERATION_AUTHORITY_CHANGED");
  }
  if (command.supersedesJobId) {
    const previous = await store.readJob(command.supersedesJobId);
    const uncertain = await store.readOutcome(command.supersedesJobId, "correction", 1);
    const receipt = await db.prepare("SELECT state,lease_expires_at FROM generation_step_receipts WHERE generation_job_id=? AND step_key='correction'")
      .bind(command.supersedesJobId).first<{ state: string; lease_expires_at: string | null }>();
    const expired = uncertain.outcome === "absent" && receipt && ["claimed", "effect_started"].includes(receipt.state) &&
      receipt.lease_expires_at !== null && receipt.lease_expires_at <= clock();
    if (previous.outcome !== "present" || previous.value.sermon_id !== sermonId ||
      previous.value.quiz_set_id !== command.quizSetId || previous.value.request_scope !== "transcript_correction" ||
      !(uncertain.outcome === "present" && uncertain.value.outcome === "uncertain" || expired)) throw new Error("GENERATION_RETRY_CONFLICT");
    if (previous.value.status !== "stale") {
      const superseded = await store.markStale(previous.value.id, previous.value.state_version, previous.value.request_context_id, clock());
      if (!["saved", "replayed"].includes(superseded.outcome)) throw new Error("GENERATION_RETRY_UNAVAILABLE");
    }
  }
  const now = clock();
  const request = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "request",
    references: captured.references, authority: captured.snapshot, actorDigest, guidance: null };
  const dispatchId = `dispatch-${owner.jobId}`;
  const created = await store.createRequest(request, base(owner, command.requestKey, now, `request-${owner.jobId}`, null),
    owner.jobId, dispatchId);
  if (!["created", "replayed"].includes(created.outcome)) throw new Error("GENERATION_REQUEST_UNAVAILABLE");
  return { jobId: owner.jobId, dispatchId, outcome: created.outcome };
}

export async function sendContentDispatch(db: D1Database, workflow: Pick<Workflow<ContentWorkflowParams>, "create"> & Partial<Pick<Workflow<ContentWorkflowParams>, "get">>, dispatchId: string) {
  db = generationReadSession(db);
  const store = createGenerationLifecycleStore(db), read = await store.readDispatch(dispatchId);
  if (read.outcome !== "present") return { outcome: "unavailable" as const };
  const now = clock(), token = crypto.randomUUID();
  const claim = await store.claimDispatch(dispatchId, token, now, lease(now));
  if (claim.outcome !== "claimed") return { outcome: claim.outcome };
  const reserved = await store.reserveSend(dispatchId, claim.attempt, token, now);
  if (reserved.outcome !== "reserved") return reserved;
  try {
    if (read.value.identity.wire.dispatchKind === "start") {
      await workflow.create({ id: read.value.identity.wire.workflowInstanceId, params: { dispatchId } });
    } else {
      if (!workflow.get) return { outcome: "unavailable" as const };
      await (await workflow.get(read.value.identity.wire.workflowInstanceId)).sendEvent({ type: "content-resume", payload: { dispatchId } });
    }
    // Only the Workflow receiver can acknowledge durable receipt.
    return { outcome: "sent" as const };
  } catch {
    const receipt = await store.readReceiver(dispatchId);
    return { outcome: receipt.outcome === "present" ? "replayed" as const : "uncertain" as const };
  }
}

/** Executes the actual input-only correction path. All durable side effects
 * use the existing lifecycle store. Returned data contains no private text. */
export async function runContentGeneration(bindings: ContentGenerationBindings, params: ContentWorkflowParams,
  instanceId: string, options: GenerationRunOptions = {}): Promise<{ outcome: string; jobId?: string; proposalId?: string }> {
  bindings = { ...bindings, DB: generationReadSession(bindings.DB) };
  if (bindings.AI_GENERATION_ENABLED !== "true" || !bindings.OPENAI_API_KEY) return { outcome: "disabled" as const };
  const time = options.now ?? clock;
  const store = createGenerationLifecycleStore(bindings.DB);
  const dispatch = await store.readDispatch(contentWorkflowParamsSchema.parse(params).dispatchId);
  if (dispatch.outcome === "present" && await draftIsPurged(bindings.DB, dispatch.value.job.sermon_id)) return { outcome: "expired" as const };
  if (dispatch.outcome !== "present") return { outcome: "unavailable" as const };
  const { job, identity } = dispatch.value;
  if (["intent", "full", "summary", "child", "adult"].includes(job.request_scope)) return runIntentGeneration(bindings, params, instanceId, options);
  // Existing v2 full/audit jobs must never be silently continued with v3 rules.
  if (job.request_scope !== "transcript_correction") return { outcome: "not_ready" as const };
  if (options.unit) return options.unit("task-correction", () => runContentGeneration(bindings, params, instanceId, { ...options, unit: undefined }));
  const request = await store.readContext(job.request_context_id);
  if (request.outcome !== "present" || request.value.context.kind !== "request") return { outcome: "unavailable" as const };
  const owner = { jobId: job.id, sermonId: job.sermon_id, quizSetId: job.quiz_set_id };
  if (instanceId !== job.workflow_instance_id) return { outcome: "conflict" as const };
  if (job.status === "review_ready") return { outcome: "replayed" as const };
  if (["failed", "stale", "needs_revision"].includes(job.status)) return { outcome: job.status };
  const prior = await store.readOutcome(job.id, "correction", 1);
  if (prior.outcome === "present") {
    if (prior.value.outcome !== "success") return { outcome: prior.value.outcome };
    const current = await readCorrectionAuthority(bindings.DB, owner);
    return store.finish(current.snapshot, time());
  }
  if (prior.outcome !== "absent") return { outcome: "unavailable" as const };
  let captured;
  try { captured = await readCorrectionAuthority(bindings.DB, owner, request.value.context.authority); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== "GENERATION_AUTHORITY_CHANGED") return { outcome: "unavailable" as const };
    const saved = await store.markStale(job.id, job.state_version, job.request_context_id, time());
    return { outcome: ["saved", "replayed"].includes(saved.outcome) ? "stale" as const : saved.outcome };
  }
  const received = await store.receive(identity.dispatchId, identity.wire, instanceId, captured.snapshot, time());
  if (!["received", "replayed"].includes(received.outcome)) return received;
  try { captured = await readCorrectionAuthority(bindings.DB, owner, request.value.context.authority); }
  catch { return { outcome: "unavailable" as const }; }
  const input = captured.snapshot.input;
  if (input.state !== "present") return { outcome: "not_ready" as const };
  const execution = aiDraftRequestSchema.parse({ task: "correction", context: { sermonId: owner.sermonId,
    expectedVersion: generationAggregateVersion(captured.snapshot), sourceId: input.sourceId, sourceSha256: input.sourceSha256,
    baseRevisionId: input.documentId, baseTranscriptSha256: input.documentSha256 }, input: { transcript: captured.transcript } });
  if (execution.task !== "correction") throw new Error("GENERATION_TASK_INVALID");
  const contextId = `step-${job.id}`, stepKey = "correction";
  // Stable context creation time permits an identical replay after interruption.
  const contextBase = base(owner, job.request_key, request.value.encoded.envelope.createdAt, contextId, stepKey);
  const context: StepContext = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "step",
    references: captured.references, authority: captured.snapshot,
    request: { contextId: job.request_context_id, fingerprint: job.request_fingerprint }, stepKey,
    execution: { task: execution.task, context: execution.context },
    predecessor: { kind: "request", eventNo: captured.snapshot.jobStateVersion + 1, stateVersion: captured.snapshot.jobStateVersion },
    command: null, guidance: null };
  const token = crypto.randomUUID(), startedAt = time();
  const claim = await store.claimStep(context, contextBase, token, startedAt, lease(startedAt));
  if (claim.outcome !== "claimed") return { outcome: claim.outcome };
  const sealed = await store.readContext(contextId);
  if (sealed.outcome !== "present") return { outcome: "unavailable" as const };
  const callId = `call-${job.id}`, ref = { contextId, fingerprint: sealed.value.encoded.envelope.fingerprint };
  const start = await store.startProviderCall(job.id, stepKey, claim.attempt, token, {
    id: callId, provider: "openai", model: OPENAI_DRAFT_MODEL, reasoningEffort: "high", providerRequestIdOpaque: null,
  }, startedAt);
  if (start.outcome !== "started") return { outcome: "uncertain" as const };
  let usage: UsageObservation | null = null;
  const transport = createOpenAiDraftTransport({ apiKey: bindings.OPENAI_API_KEY,
    ...(options.archiveResponses ? { archive: createAiResponseArchive(bindings.DB, callId) } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    diagnose: diagnostic => console.warn(JSON.stringify({
      code: "OPENAI_DRAFT_DIAGNOSTIC", callId, ...diagnostic,
    })),
    observe: async observation => {
      clearGenerationReads(bindings.DB);
      const observed: UsageObservation = { contractVersion: 2, callId, usageId: `usage-${job.id}`,
        ...owner, stepKey, attempt: claim.attempt, task: "correction", context: ref, inputFingerprint: ref.fingerprint,
        provider: "openai", model: OPENAI_DRAFT_MODEL, reasoningEffort: "high", providerRequestIdOpaque: null,
        ...estimateOpenAiDraftCost(observation), audioInputTokens: null, audioSeconds: null, startedAt, observedAt: time() };
      const saved = await store.observeUsage(observed);
      if (!["saved", "replayed"].includes(saved.outcome)) throw new Error("GENERATION_USAGE_UNCERTAIN");
      usage = observed;
      // A timeout may have already committed an uncertain outcome while an
      // abort-insensitive transport was finishing. Preserve and settle it late.
      const priorOutcome = await store.readOutcome(job.id, stepKey, claim.attempt);
      if (priorOutcome.outcome === "present" && priorOutcome.value.outcome !== "success") {
        await store.settleLateUsage(observed, time());
      }
    },
  });
  clearGenerationReads(bindings.DB);
  const generated = await createAiDraftProvider(transport, { timeoutMs: options.timeoutMs ?? 540_000 }).generate(execution);
  clearGenerationReads(bindings.DB);
  const document = generated.outcome === "structured_output" && generated.result.task === "correction"
    ? materializeCorrectionDocument(captured.transcript, generated.result.content) : null;
  let current = true;
  try { await readCorrectionAuthority(bindings.DB, owner, captured.snapshot); }
  catch { current = false; }
  const outcome = !current ? "stale" : !usage ? "uncertain" : document ? "success" : "rejected";
  const command = { jobId: job.id, stepKey, attempt: claim.attempt, token, now: time(), outcome, callId, usage,
    result: outcome === "success" ? { id: `proposal-${job.id}`, actorDigest: request.value.context.actorDigest,
      payload: { kind: "correction_document_v1", sourceId: input.sourceId, sourceSha256: input.sourceSha256,
        baseDocumentId: input.documentId, baseDocumentSha256: input.documentSha256, content: document } } : null } as const;
  let committed;
  try { committed = await store.commitOutcome(command); }
  catch { return { outcome: "uncertain" as const }; }
  if (!["saved", "replayed"].includes(committed.outcome) || outcome !== "success") return { outcome: outcome === "success" ? committed.outcome : outcome };
  const after = await readCorrectionAuthority(bindings.DB, owner);
  const finished = await store.finish(after.snapshot, time());
  return { outcome: finished.outcome, jobId: job.id, proposalId: `proposal-${job.id}` };
}
