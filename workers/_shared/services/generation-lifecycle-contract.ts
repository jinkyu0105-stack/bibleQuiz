import { candidateReplacementSchema } from "./sermon-candidates-contract";
import { z } from "zod";
import { aiDraftTaskSchema, aiDraftTaskSchemas } from "./ai-draft-provider-contract";
import {
  bridgeContentSchema, bridgeInputSchema, generationAuthoritySnapshotSchema,
  generationFinalCaptureSchema, generationScopeSchema, generationStageSchema, generationWaitSchema,
} from "./generation-bridge-contract";

export const lifecycleId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
export const providerModelSchema = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/u);
export const lifecycleDigest = z.string().regex(/^[0-9a-f]{64}$/u);
export const lifecycleCount = z.int().nonnegative();
export const lifecycleTime = z.iso.datetime();
const id = lifecycleId, digest = lifecycleDigest, count = lifecycleCount;
export const contextReferenceSchema = z.strictObject({ contextId: id, fingerprint: digest });
export const eventReferenceSchema = z.strictObject({ eventNo: z.int().positive(), stateVersion: count });
const artifactReference = z.strictObject({
  sermonId: id, eventId: id, kind: z.enum(["input", "content", "ticket"]), sha256: digest,
  // Optional only for new captures: timed source bytes and working text have
  // different digests even when the source is also the selected document.
  sourceSha256: digest.optional(),
}).refine(r => r.sourceSha256 === undefined || r.kind === "input");
const common = {
  contractVersion: z.literal(2), validatorVersion: z.literal(1), assemblyVersion: z.literal(1),
  references: z.array(artifactReference).max(32).refine((refs) => new Set(refs.map((r) => r.eventId)).size === refs.length),
};
export const requestContextSchema = z.strictObject({
  ...common, kind: z.literal("request"), authority: generationAuthoritySnapshotSchema,
  candidateTarget: candidateReplacementSchema.optional(),
  reuseCurrentContent: z.literal(true).optional(),
  actorDigest: digest, guidance: z.strictObject({ text: z.string().refine((s) => [...s].length <= 8192), sha256: digest }).nullable(),
});
function execution<T extends z.ZodType, K extends string>(task: K, context: T) {
  return z.strictObject({ task: z.literal(task), context });
}
export const stepExecutionSchema = z.discriminatedUnion("task", [
  execution("correction", aiDraftTaskSchemas.correction.context),
  execution("intent_analysis", aiDraftTaskSchemas.intent_analysis.context),
  execution("intent_critique", aiDraftTaskSchemas.intent_critique.context),
  execution("summary", aiDraftTaskSchemas.summary.context),
  execution("child_candidates", aiDraftTaskSchemas.child_candidates.context),
  execution("adult_candidates", aiDraftTaskSchemas.adult_candidates.context),
  execution("final_audit", generationFinalCaptureSchema),
  execution("input_resolve", z.null()), execution("place_child", generationFinalCaptureSchema.nullable()),
  execution("place_adult", generationFinalCaptureSchema.nullable()), execution("final_validate", generationFinalCaptureSchema),
]);
export const stepContextSchema = z.strictObject({
  ...common, kind: z.literal("step"), authority: generationAuthoritySnapshotSchema,
  request: contextReferenceSchema, stepKey: id, execution: stepExecutionSchema,
  predecessor: eventReferenceSchema.extend({ kind: z.enum(["request", "outcome", "wait_consume"]) }),
  command: z.strictObject({ key: id, ordinal: z.int().positive(), waitGeneration: z.int().positive() }).nullable(),
  guidance: contextReferenceSchema.nullable(),
});
export const waitContextSchema = z.strictObject({
  ...common, kind: z.literal("wait"), request: contextReferenceSchema, wait: generationWaitSchema,
  enter: eventReferenceSchema,
  parent: z.strictObject({ waitGeneration: z.int().positive(), commandKey: id, outcome: eventReferenceSchema }).nullable(),
});
export const generationContextSchema = z.discriminatedUnion("kind", [requestContextSchema, stepContextSchema, waitContextSchema]);
export type GenerationContext = z.infer<typeof generationContextSchema>;
export type StepContext = z.infer<typeof stepContextSchema>;
export const generationContextEnvelopeSchema = z.strictObject({
  contextId: id, jobId: id, sermonId: id, quizSetId: id, kind: z.enum(["request", "step", "wait"]),
  requestKey: id, createdAt: lifecycleTime,
  stepKey: id.nullable(), waitGeneration: z.int().positive().nullable(),
  codec: z.literal("generation-context-json-utf8-v1"),
  fingerprint: digest, byteLength: z.int().positive(), chunkCount: z.int().positive(),
  referencedEvents: count,
});
export type ContextEnvelope = z.infer<typeof generationContextEnvelopeSchema>;
export const contextChunkSchema = z.strictObject({
  position: count, byteLength: z.int().positive(), sha256: digest, body: z.instanceof(Uint8Array),
});

/** Private injected evidence, not a DB read or an assertion of actual persistence. */
export const transitionPointSchema = z.strictObject({
  stateVersion: count, status: generationAuthoritySnapshotSchema.shape.status,
  stage: generationStageSchema.nullable(), waitGeneration: z.int().positive().nullable(),
});
export const transitionEvidenceSchema = z.strictObject({
  jobId: id, eventNo: z.int().positive(), before: transitionPointSchema.nullable(), after: transitionPointSchema,
  reason: z.enum(["job_created", "received", "step_succeeded", "step_rejected", "step_stale", "step_uncertain", "stage_completed", "wait_entered", "review_ready", "needs_revision", "job_stale"]),
  context: contextReferenceSchema, stepKey: id.nullable(), attempt: z.int().positive().nullable(),
  dispatchKey: id.nullable(), commandKey: id.nullable(),
}).refine((e) => e.before === null
  ? e.reason === "job_created" && e.eventNo === 1 && e.after.stateVersion === 0 && e.after.status === "dispatch_pending"
  : e.reason !== "job_created" && Number.isSafeInteger(e.before.stateVersion + 1) && e.after.stateVersion === e.before.stateVersion + 1);
export type TransitionEvidence = z.infer<typeof transitionEvidenceSchema>;

export const dispatchWireSchema = z.strictObject({
  contractVersion: z.literal(1), jobId: id, workflowInstanceId: id,
  dispatchKind: z.enum(["start", "resume_transcript_review", "resume_intent_review", "correction"]),
  dispatchKey: id, jobStateVersion: count, waitGeneration: z.int().positive().nullable(), requestFingerprint: digest,
}).refine((w) => w.dispatchKind === "start" ? w.waitGeneration === null && w.jobStateVersion === 0 : w.waitGeneration !== null);
export const dispatchIdentitySchema = z.strictObject({
  dispatchId: id, sermonId: id, quizSetId: id, requestContractVersion: z.union([z.literal(2), z.literal(3)]), requestScope: generationScopeSchema, wire: dispatchWireSchema,
  payloadFingerprint: digest, request: contextReferenceSchema, context: contextReferenceSchema,
  commandKey: id.nullable(),
}).refine((d) => (d.wire.dispatchKind === "correction") === (d.commandKey !== null) && d.request.fingerprint === d.wire.requestFingerprint);
export type DispatchIdentity = z.infer<typeof dispatchIdentitySchema>;
export const dispatchAttemptSchema = z.strictObject({
  dispatchId: id, attempt: z.int().positive(), claimToken: id,
  state: z.enum(["reserved", "send_started", "uncertain", "legacy_claimed"]),
  leaseExpiresAt: lifecycleTime, sendStartedAt: lifecycleTime.nullable(),
}).refine((a) => a.state === "reserved" || a.state === "legacy_claimed" ? a.sendStartedAt === null : a.sendStartedAt !== null);
export const receiverReceiptSchema = z.strictObject({
  identity: dispatchIdentitySchema, receivedAt: lifecycleTime, evidence: transitionEvidenceSchema,
});
export type ReceiverReceipt = z.infer<typeof receiverReceiptSchema>;
export const receiptReadSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("present"), receipt: receiverReceiptSchema }),
  z.strictObject({ outcome: z.enum(["absent", "partial", "unavailable"]) }),
]);

export const correctionCommandSchema = z.strictObject({
  jobId: id, sermonId: id, quizSetId: id, key: id, ordinal: z.int().positive(), actorDigest: digest,
  waitGeneration: z.int().positive(), enter: eventReferenceSchema, context: contextReferenceSchema,
  expected: generationWaitSchema, state: z.enum(["pending", "running", "succeeded", "rejected", "stale", "uncertain"]),
}).refine((c) => c.jobId === c.expected.jobId && c.sermonId === c.expected.sermonId && c.quizSetId === c.expected.quizSetId &&
  c.waitGeneration === c.expected.generation && c.enter.stateVersion === c.expected.jobStateVersion);
export type CorrectionCommand = z.infer<typeof correctionCommandSchema>;

export const usageObservationSchema = z.strictObject({
  contractVersion: z.literal(2), callId: id, usageId: id, jobId: id, sermonId: id, quizSetId: id,
  stepKey: id, attempt: z.int().positive(), task: aiDraftTaskSchema, context: contextReferenceSchema,
  inputFingerprint: digest, provider: z.string().min(1).max(64), model: providerModelSchema,
  reasoningEffort: z.string().min(1).max(32).nullable(), providerRequestIdOpaque: digest.nullable(),
  inputTokens: count.nullable(), cachedInputTokens: count.nullable(), reasoningTokens: count.nullable(),
  outputTokens: count.nullable(), audioInputTokens: count.nullable(), audioSeconds: count.nullable(),
  pricingVersion: id, estimatedCostMicroUsd: count, usageSource: z.enum(["provider_reported", "provider_partial"]),
  startedAt: lifecycleTime, observedAt: lifecycleTime,
}).refine((u) => [u.inputTokens, u.cachedInputTokens, u.reasoningTokens, u.outputTokens, u.audioInputTokens, u.audioSeconds].some((v) => v !== null) &&
  Date.parse(u.observedAt) >= Date.parse(u.startedAt));
export type UsageObservation = z.infer<typeof usageObservationSchema>;
export const outcomeIdentitySchema = z.strictObject({
  jobId: id, sermonId: id, quizSetId: id, stepKey: id, task: z.enum([
    "correction", "intent_analysis", "intent_critique", "summary", "child_candidates", "adult_candidates", "final_audit", "input_resolve", "place_child", "place_adult", "final_validate",
  ]), attempt: z.int().positive(), inputFingerprint: digest, context: contextReferenceSchema,
  event: eventReferenceSchema,
});
export const historicalOutcomeSchema = z.strictObject({
  identity: outcomeIdentitySchema, outcome: z.enum(["success", "rejected", "stale", "uncertain"]),
  reason: z.enum(["none", "domain_invalid", "authority_changed", "usage_unknown"]),
  before: z.strictObject({ input: bridgeInputSchema, content: bridgeContentSchema }),
  after: z.strictObject({ input: bridgeInputSchema, content: bridgeContentSchema }),
  result: z.strictObject({ kind: z.enum(["correction", "content", "final_audit", "source", "ticket", "pure"]), id, version: z.int().positive(), fingerprint: digest }).nullable(),
  callId: id.nullable(), usage: usageObservationSchema.nullable(), evidence: transitionEvidenceSchema,
});
export type HistoricalOutcome = z.infer<typeof historicalOutcomeSchema>;
export const historicalReadSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("present"), value: historicalOutcomeSchema,
    artifact: z.enum(["verified", "missing", "mismatch", "not_applicable"]),
    receipt: z.enum(["verified", "missing", "mismatch"]), callAndUsage: z.enum(["verified", "missing", "mismatch", "not_applicable"]) }),
  z.strictObject({ outcome: z.enum(["absent", "partial", "unavailable"]) }),
]);
export type LifecycleDecision = { outcome: "eligible" | "replayed" | "busy" | "stale" | "conflict" | "corrupt" | "unavailable" | "uncertain" | "not_ready" };

/** Logical stages retain stable receipt keys; wait/pure transitions also need
 * their own evidence. This is a mapping contract, not a storage adapter change. */
export const GENERATION_STAGE_STORAGE = {
  input_resolve: { stepKey: "input_resolve", receiptTask: "fetch_transcript", evidence: "stage_completed" },
  correction: { stepKey: "correction", receiptTask: "correction", evidence: "step_succeeded" },
  transcript_review: { stepKey: null, receiptTask: null, evidence: "received" },
  intent_analysis: { stepKey: "intent_analysis", receiptTask: "intent_analysis", evidence: "step_succeeded" },
  intent_critique: { stepKey: "intent_critique", receiptTask: "intent_critique", evidence: "step_succeeded" },
  intent_review: { stepKey: null, receiptTask: null, evidence: "received" },
  summary: { stepKey: "summary", receiptTask: "summary", evidence: "step_succeeded" },
  child_candidates: { stepKey: "child_candidates", receiptTask: "child_candidates", evidence: "step_succeeded" },
  adult_candidates: { stepKey: "adult_candidates", receiptTask: "adult_candidates", evidence: "step_succeeded" },
  content_review: { stepKey: null, receiptTask: null, evidence: "stage_completed" },
  place_child: { stepKey: "place_child", receiptTask: "place_grid", evidence: "stage_completed" },
  place_adult: { stepKey: "place_adult", receiptTask: "place_grid", evidence: "stage_completed" },
  final_validate: { stepKey: "final_validate", receiptTask: "validate", evidence: "stage_completed" },
  final_audit: { stepKey: "final_audit", receiptTask: "final_audit", evidence: "step_succeeded" },
  finish: { stepKey: null, receiptTask: null, evidence: "review_ready" },
} as const;
