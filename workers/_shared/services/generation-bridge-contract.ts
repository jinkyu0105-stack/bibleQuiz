import { z } from "zod";
import { aiDraftRequestSchema, aiDraftResultSchema, type AiDraftRequest, type AiDraftResult } from "./ai-draft-provider-contract";
import { finalCheckSelectionSchema, finalCheckTicketSchema } from "./final-check-contract";
import { finalCheckMetadataSnapshotSchema } from "./final-check-metadata-contract";
import { intentTranscriptBindingSchema } from "./sermon-intent-contract";
import { summaryBindingSchema } from "./sermon-summary-contract";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const count = z.int().nonnegative();
export const generationScopeSchema = z.enum([
  "full", "transcript_correction", "intent", "summary", "child", "adult", "single_entry", "final_audit",
]);
export type GenerationScope = z.infer<typeof generationScopeSchema>;
export const generationStageSchema = z.enum([
  "input_resolve", "correction", "transcript_review", "intent_analysis", "intent_critique", "intent_review",
  "summary", "child_candidates", "adult_candidates", "content_review", "place_child", "place_adult",
  "final_validate", "final_audit", "finish",
]);
export type GenerationStage = z.infer<typeof generationStageSchema>;

const inputPresent = z.strictObject({
  state: z.literal("present"), version: z.int().positive(), sourceId: id, sourceRevision: z.int().positive(),
  sourceSha256: digest, documentId: id, documentSha256: digest,
  checksumFormat: z.literal("sha256:utf8-working-text:v1"), confirmationId: id.nullable(),
  sourceKind: z.enum(["caption", "sermon_manuscript", "sermon_summary"]),
  coverage: z.enum(["full", "partial"]),
});
export const bridgeInputSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }), inputPresent,
]);
const review = z.strictObject({ id, targetId: id, intentConfirmationId: id, origin: z.literal("human") });
const selectedContent = z.strictObject({ id, binding: summaryBindingSchema, review: review.nullable() });
const intent = z.strictObject({
  selectedId: id, rootAnalysisId: id, binding: intentTranscriptBindingSchema,
  critique: z.strictObject({ id, rootAnalysisId: id }).nullable(),
  confirmation: z.strictObject({ id, targetId: id, critiqueId: id, origin: z.literal("human") }).nullable(),
});
export const bridgeContentSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({
    state: z.literal("present"), eventCount: z.int().positive(), lastEventId: id,
    // New captures separate the available comparison from the selected snapshot.
    // Optional to preserve every existing sealed context's bytes and meaning.
    availableCritique: z.strictObject({ id, rootAnalysisId: id }).nullable().optional(),
    intent: intent.nullable(), summary: selectedContent.nullable(),
    child: selectedContent.extend({ difficulty: z.literal("child") }).nullable(),
    adult: selectedContent.extend({ difficulty: z.literal("adult") }).nullable(),
  }),
]);
const durableSelection = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unavailable") }),
  z.strictObject({ state: z.literal("present"), settingsRevision: z.int().positive(),
    selectionRevision: z.int().positive(), value: finalCheckSelectionSchema }),
]);
export const generationAuthoritySnapshotSchema = z.strictObject({
  contractVersion: z.literal(1), jobId: id, sermonId: id, quizSetId: id, jobStateVersion: count,
  scope: generationScopeSchema,
  status: z.enum(["queued", "dispatch_pending", "running", "awaiting_transcript_review", "awaiting_intent_review",
    "review_ready", "needs_revision", "stale", "failed"]),
  wait: z.strictObject({ kind: z.enum(["transcript_review", "intent_review"]), generation: z.int().positive() }).nullable(),
  input: bridgeInputSchema, content: bridgeContentSchema, metadata: finalCheckMetadataSnapshotSchema,
  selection: durableSelection,
}).refine((v) => v.metadata.sermonId === v.sermonId && (v.input.state === "present" || v.content.state === "absent") &&
  (v.input.state === "absent" || Number.isSafeInteger(v.input.version + (v.content.state === "present" ? v.content.eventCount : 0))));
export type GenerationAuthoritySnapshot = z.infer<typeof generationAuthoritySnapshotSchema>;

/** Read adapters must verify ownership, H0/H1, seals, digests and bounded direct
 * lineage before returning captured. This declaration does not implement a DB reader. */
export const authorityReadSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("captured"), snapshot: generationAuthoritySnapshotSchema }),
  z.strictObject({ outcome: z.enum(["absent", "changed", "corrupt", "unavailable", "limit_exceeded"]) }),
]);
export type GenerationAuthorityRead = z.infer<typeof authorityReadSchema>;
export const authorityQuerySchema = z.strictObject({
  jobId: id, sermonId: id, quizSetId: id,
  targetEventIds: z.array(id).max(10).refine((v) => new Set(v).size === v.length),
  maxBytes: z.int().positive().max(64 * 1024 * 1024),
});
export type GenerationAuthorityQuery = z.infer<typeof authorityQuerySchema>;
export interface GenerationAssemblyAuthorityPort {
  read(query: GenerationAuthorityQuery): Promise<GenerationAuthorityRead>;
}

export const generationBridgeFailureSchema = z.strictObject({
  outcome: z.enum(["not_ready", "stale", "corrupt", "unavailable", "needs_revision"]),
  reason: z.enum(["absent", "read_changed", "storage_corrupt", "storage_unavailable", "limit_exceeded",
    "scope_unsupported", "selection_unavailable", "input_required", "input_read_only", "input_unconfirmed",
    "intent_unconfirmed", "content_review", "lineage_changed", "stage_mismatch", "job_not_running",
    "domain_invalid", "domain_unavailable", "context_mismatch", "capture_changed", "partial_disclosure"]),
});
export type GenerationBridgeFailure = z.infer<typeof generationBridgeFailureSchema>;
export type BridgeDecision = { outcome: "ready" } | GenerationBridgeFailure;

export const generationWaitSchema = z.strictObject({
  contractVersion: z.literal(1), jobId: id, sermonId: id, quizSetId: id,
  kind: z.enum(["transcript_review", "intent_review"]), generation: z.int().positive(),
  jobStateVersion: count, input: inputPresent, content: bridgeContentSchema,
  metadataRevision: z.int().positive(), selection: durableSelection,
  rootAnalysisId: id.nullable(),
}).refine((v) => v.kind === "intent_review" ? v.rootAnalysisId !== null && v.input.confirmationId !== null : v.rootAnalysisId === null);
export type GenerationWait = z.infer<typeof generationWaitSchema>;

/** The bounded request carries actual private context, never a fabricated history.
 * validate is a synchronous, effect-free semantic port. No writer or usage is exposed.
 * Its implementation (all P5-08~16 validators) remains P40-G03 work. */
export type GenerationDomainPair = {
  [T in AiDraftRequest["task"]]: {
    task: T; request: Extract<AiDraftRequest, { task: T }>; result: Extract<AiDraftResult, { task: T }>;
  }
}[AiDraftRequest["task"]];
export interface GenerationDomainValidationPort {
  validate(pair: GenerationDomainPair): { outcome: "valid" | "invalid" | "unavailable" };
}
export const generationDomainEnvelopeSchema = z.strictObject({
  request: aiDraftRequestSchema, result: aiDraftResultSchema,
});

/** Settings/selection revisions are not fields of the legacy domain ticket.
 * Keep them in the assembly capture instead of inventing or losing their ABA guard. */
export const generationFinalCaptureSchema = z.strictObject({
  ticket: finalCheckTicketSchema, settingsRevision: z.int().positive(), selectionRevision: z.int().positive(),
});
export type GenerationFinalCapture = z.infer<typeof generationFinalCaptureSchema>;
