import { z } from "zod";
import { bridgeInputSchema, bridgeContentSchema, generationAuthoritySnapshotSchema } from "./generation-bridge-contract";
import { lifecycleId as id, lifecycleDigest as digest, contextReferenceSchema } from "./generation-lifecycle-contract";
import { intentAnalysisSchema, intentCritiqueSchema, intentTranscriptBindingSchema, intentOperationSchema } from "./sermon-intent-contract";
import { summaryBindingSchema, sermonSummaryDraftSchema, summaryOperationSchema } from "./sermon-summary-contract";
import { candidateOperationSchema, candidateStatusSchema, sermonCandidateDraftSchema } from "./sermon-candidates-contract";
import { correctionProposalInputSchema } from "./transcript-correction-contract";
import { correctionDocumentProposalSchema } from "./transcript-correction-document";
import { transcriptContentSchema } from "./transcript-input-contract";

export const domainInputSchema = bridgeInputSchema.options[1];
/** Version 2 references identify ONE event with separate digest roles. This does
 * not change or backfill the existing version 1/2 context bytes. */
export const domainReferenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("input"), sermonId: id, eventId: id, eventVersion: z.int().positive(), payloadSha256: digest,
    sourceSha256: digest.nullable(), documentSha256: digest.nullable() }),
  z.strictObject({ kind: z.enum(["content", "ticket"]), sermonId: id, eventId: id, eventVersion: z.int().positive(), payloadSha256: digest,
    // Stored envelope and its materialized snapshot have distinct digest roles.
    snapshotSha256: digest.optional() }),
]);
export const domainReferencesSchema = z.strictObject({
  referenceVersion: z.literal(2), references: z.array(domainReferenceSchema).max(32),
}).refine(v => new Set(v.references.map(r => r.eventId)).size === v.references.length);
export const intentSnapshotSchema = z.strictObject({
  id, kind: z.enum(["analysis", "critique", "edit"]), binding: intentTranscriptBindingSchema,
  analysis: intentAnalysisSchema, critiqueId: id.nullable(), evidenceReviewIds: z.array(id),
});
export const summarySnapshotSchema = z.strictObject({
  id, kind: z.enum(["generate", "edit", "restore"]), binding: summaryBindingSchema, draft: sermonSummaryDraftSchema,
  restoredFromSummaryId: id.nullable(), evidenceReviewIds: z.array(id),
});
export const candidateSnapshotSchema = z.strictObject({
  id, kind: z.enum(["generate", "edit", "restore", "set_status"]), difficulty: z.enum(["child", "adult"]),
  binding: summaryBindingSchema, draft: sermonCandidateDraftSchema, statuses: z.record(id, candidateStatusSchema),
  restoredFromPoolId: id.nullable(), evidenceReviewIds: z.array(id),
});
const provenance = z.strictObject({
  version: z.literal(1), input: domainInputSchema, generationVersion: z.int().positive(),
  payloadSha256: digest, rootAnalysisId: id.nullable(),
});
export const domainSnapshotSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("intent"), value: intentSnapshotSchema, operation: intentOperationSchema, critique: intentCritiqueSchema.nullable(), provenance }),
  z.strictObject({ kind: z.literal("summary"), value: summarySnapshotSchema, operation: summaryOperationSchema, provenance }),
  z.strictObject({ kind: z.literal("candidate"), value: candidateSnapshotSchema, operation: candidateOperationSchema, provenance }),
]);
/** Explicit injected historical selection witnesses, NOT evidence of persisted
 * FK/CAS or a replacement for the future private reader. */
export const domainBasisSchema = z.strictObject({
  basisVersion: z.literal(1), purpose: z.enum(["current", "historical"]),
  sourceRevisionMode: z.literal("sealed_event_version"),
  authority: generationAuthoritySnapshotSchema, context: contextReferenceSchema,
  references: domainReferencesSchema,
  targetIds: z.array(id).max(10),
  documents: z.array(z.strictObject({ input: domainInputSchema, content: transcriptContentSchema })).max(32),
  snapshots: z.array(domainSnapshotSchema).max(32),
  humanRecords: z.array(z.strictObject({ id, kind: z.enum(["confirmation", "review"]), targetId: id,
    intentConfirmationId: id.nullable(), actorDigest: digest, createdAt: z.iso.datetime() })).max(32),
  intentSelections: z.array(z.strictObject({ atVersion: z.int().positive(), selectedId: id, confirmationId: id })).max(32),
}).refine(b => new Set(b.targetIds).size === b.targetIds.length &&
  new Set(b.snapshots.map(s => s.value.id)).size === b.snapshots.length &&
    new Set(b.documents.map(d => `${d.input.version}:${d.input.documentId}:${d.input.confirmationId}`)).size === b.documents.length &&
  new Set(b.intentSelections.map(s => s.atVersion)).size === b.intentSelections.length);
export type DomainBasis = z.infer<typeof domainBasisSchema>;
export type DomainSnapshot = z.infer<typeof domainSnapshotSchema>;
export const domainOperationSchema = z.discriminatedUnion("family", [
  z.strictObject({ family: z.literal("correction"), operation: z.union([
    correctionProposalInputSchema.omit({ baseRevisionId: true, baseTranscriptSha256: true }).extend({ baseDocumentId: id, baseDocumentSha256: digest }),
    correctionDocumentProposalSchema,
  ]) }),
  z.strictObject({ family: z.literal("intent"), operation: intentOperationSchema }),
  z.strictObject({ family: z.literal("summary"), operation: summaryOperationSchema }),
  z.strictObject({ family: z.literal("candidate"), operation: candidateOperationSchema }),
]);
export const domainEventIdentitySchema = z.strictObject({ id, actorDigest: digest, createdAt: z.iso.datetime() });
export const domainPreparedSchema = z.strictObject({
  operationVersion: z.literal(1), validatorVersion: z.literal(1),
  owner: z.strictObject({ jobId: id, sermonId: id, quizSetId: id }), context: contextReferenceSchema,
  origin: z.enum(["ai", "human"]), event: domainEventIdentitySchema,
  expectedInput: domainInputSchema, before: bridgeContentSchema, after: bridgeContentSchema,
  operation: domainOperationSchema, materializedSnapshot: domainSnapshotSchema.nullable(),
});
export type DomainPrepared = z.infer<typeof domainPreparedSchema>;

/** The digest covers operation, immutable materialization and provenance, excluding only itself. */
export function domainSnapshotPayload(snapshot: DomainSnapshot) {
  const { payloadSha256: _digest, ...provenance } = snapshot.provenance;
  void _digest;
  return { ...snapshot, provenance };
}
