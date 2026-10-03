import { z } from "zod";

// Private Worker contracts only. No provider, model, usage, route or public DTO.
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const text = z.string().refine((value) => {
  // eslint-disable-next-line no-control-regex -- Preserve lossless text; reject controls and invisible-only claims.
  return /[^\s\u200B-\u200D\u2060\uFEFF]/u.test(value) && !/[\uD800-\uDFFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
});
export const intentTranscriptBindingSchema = z.strictObject({
  sourceId: id, sourceRevision: z.int().positive(), sourceSha256: sha256,
  revisionId: id, transcriptSha256: sha256,
  checksumFormat: z.literal("sha256:utf8-working-text:v1"),
  confirmationId: id, version: z.int().positive(),
});
const locatedEvidenceSchema = z.strictObject({
  // Half-open UTF-16 offsets in the whole plain text or exact timed segment.
  segmentId: id.nullable(), start: z.number().finite().nonnegative().nullable(),
  duration: z.number().finite().nonnegative().nullable(),
  from: z.int().nonnegative(), to: z.int().nonnegative(), quote: text,
  // Optional for compatibility: saved evidence retains its exact shape.
  locationStatus: z.literal("verified").optional(),
});
export const intentEvidenceSchema = z.union([locatedEvidenceSchema, z.strictObject({
  quote: text, locationStatus: z.literal("unverified"), reason: z.enum(["not_found", "ambiguous"]),
  segmentId: z.null(), start: z.null(), duration: z.null(), from: z.null(), to: z.null(),
})]);
export type IntentEvidence = z.infer<typeof intentEvidenceSchema>;
export const intentClaimSchema = z.discriminatedUnion("origin", [
  z.strictObject({ id, text, origin: z.literal("transcript"), evidence: z.array(intentEvidenceSchema).min(1) }),
  // An uncertainty is explicitly NOT an evidence-backed conclusion.
  z.strictObject({ id, text, origin: z.literal("unresolved"), evidence: z.array(intentEvidenceSchema) }),
  z.strictObject({ id, text, origin: z.literal("admin_context"), evidence: z.tuple([]) }),
]);
export const intentFields = [
  "centralMessage", "purpose", "bibleRelationship", "argumentFlow", "repeatedEmphasis",
  "illustrations", "audienceResponse", "warnings", "uncertainties",
] as const;
export const intentAnalysisSchema = z.strictObject({
  centralMessage: z.array(intentClaimSchema), purpose: z.array(intentClaimSchema),
  bibleRelationship: z.array(intentClaimSchema), argumentFlow: z.array(intentClaimSchema),
  repeatedEmphasis: z.array(intentClaimSchema), illustrations: z.array(intentClaimSchema),
  audienceResponse: z.array(intentClaimSchema), warnings: z.array(intentClaimSchema),
  uncertainties: z.array(intentClaimSchema),
});
const critiqueCheck = z.strictObject({
  assessment: z.enum(["clear", "needs_review"]),
  concerns: z.array(z.strictObject({ field: z.enum(intentFields), claimId: id.nullable(), note: text })),
}).refine((check) => check.assessment === "clear" ? check.concerns.length === 0 : check.concerns.length > 0);
export const intentCritiqueSchema = z.strictObject({
  exaggeratedIntent: critiqueCheck, unsupportedConclusion: critiqueCheck,
  illustrationAsMainClaim: critiqueCheck, reversedMeaning: critiqueCheck,
});
// The command wrapper captures the input version BEFORE external work; provider output
// is only analysis/critique. A future adapter must not replace binding with a fresh head.
export const intentOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("analysis"), binding: intentTranscriptBindingSchema, analysis: intentAnalysisSchema }),
  z.strictObject({ kind: z.literal("critique"), binding: intentTranscriptBindingSchema,
    baseAnalysisId: id, analysis: intentAnalysisSchema, critique: intentCritiqueSchema }),
  z.strictObject({ kind: z.literal("edit"), baseAnalysisId: id, analysis: intentAnalysisSchema }),
  z.strictObject({ kind: z.literal("select"), analysisId: id }),
  z.strictObject({ kind: z.literal("confirm"), analysisId: id }),
]);
export const intentEventSchema = z.strictObject({
  id, version: z.int().positive(), actorId: id, createdAt: z.iso.datetime(), operation: intentOperationSchema,
});
export type IntentBinding = z.infer<typeof intentTranscriptBindingSchema>;
export type IntentAnalysis = z.infer<typeof intentAnalysisSchema>;
export type IntentOperation = z.infer<typeof intentOperationSchema>;
export type IntentEvent = z.infer<typeof intentEventSchema>;
