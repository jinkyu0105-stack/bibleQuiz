import { z } from "zod";

import { finalCheckPublicMetadataSchema } from "./final-check-metadata-contract";
import { intentAnalysisSchema } from "./sermon-intent-contract";
import {
  candidateDifficultySchema,
  sermonCandidateSchema,
} from "./sermon-candidates-contract";
import { sermonSummaryDraftSchema } from "./sermon-summary-contract";
import { transcriptContentSchema } from "./transcript-revision-contract";

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const warningText = z.string().refine((value) => {
  const hasVisibleText = /[^\s\u200B-\u200D\u2060\uFEFF]/u.test(value);
  // eslint-disable-next-line no-control-regex -- Preserve Korean text while rejecting lossy/control output.
  const hasNoLossyControls = !/[\uD800-\uDFFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
  return hasVisibleText && hasNoLossyControls;
});
const uniqueIds = z.array(id).min(1).refine((values) => new Set(values).size === values.length);

export const finalAuditSelectedCandidateSchema = z.strictObject({
  entryId: id,
  candidate: sermonCandidateSchema,
});

function variantSchema(difficulty: "child" | "adult") {
  return z.strictObject({
    difficulty: z.literal(difficulty),
    candidates: z.array(finalAuditSelectedCandidateSchema).min(1),
  }).superRefine((variant, context) => {
    if (new Set(variant.candidates.map((item) => item.entryId)).size !== variant.candidates.length) {
      context.addIssue({ code: "custom", message: "Duplicate selected entry ID", path: ["candidates"] });
    }
    if (new Set(variant.candidates.map((item) => item.candidate.id)).size !== variant.candidates.length) {
      context.addIssue({ code: "custom", message: "Duplicate selected candidate ID", path: ["candidates"] });
    }
  });
}

/**
 * Provider-safe, Worker-only final audit input.
 *
 * It is derived from a current P5-13/P5-14 result. Transcript excerpts remain
 * attached to the P5-09/P5-10/P5-11 evidence objects; aggregate versions,
 * checksums, administrators, costs, solutions and grid coordinates are absent.
 */
export const finalAuditInputSchema = z.strictObject({
  contractVersion: z.literal(1),
  sermonId: id,
  metadata: finalCheckPublicMetadataSchema,
  transcript: transcriptContentSchema,
  intent: z.strictObject({
    analysisId: id,
    confirmationId: id,
    analysis: intentAnalysisSchema,
  }),
  summary: z.strictObject({
    summaryId: id,
    reviewId: id,
    draft: sermonSummaryDraftSchema,
  }),
  variants: z.strictObject({
    child: variantSchema("child"),
    adult: variantSchema("adult"),
  }),
});

export const finalAuditCandidateReferenceSchema = z.strictObject({
  difficulty: candidateDifficultySchema,
  entryId: id,
  candidateId: id,
});
const uniqueCandidateReferences = z.array(finalAuditCandidateReferenceSchema).min(1).refine((references) =>
  new Set(references.map((reference) =>
    `${reference.difficulty}:${reference.entryId}:${reference.candidateId}`)).size === references.length,
);

const warningBase = { id, message: warningText };

/** Pairwise mismatch warnings only: no severity, correction, approval or block signal. */
export const finalAuditWarningSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...warningBase,
    kind: z.literal("intent_summary_mismatch"),
    intentClaimIds: uniqueIds,
    summaryParagraphIds: uniqueIds,
  }),
  z.strictObject({
    ...warningBase,
    kind: z.literal("intent_candidate_mismatch"),
    intentClaimIds: uniqueIds,
    candidateReferences: uniqueCandidateReferences,
  }),
  z.strictObject({
    ...warningBase,
    kind: z.literal("summary_candidate_mismatch"),
    summaryParagraphIds: uniqueIds,
    candidateReferences: uniqueCandidateReferences,
  }),
]);

/** Exact structured output expected from a future provider adapter. */
export const finalAuditOutputSchema = z.strictObject({
  contractVersion: z.literal(1),
  warnings: z.array(finalAuditWarningSchema),
}).superRefine((output, context) => {
  if (new Set(output.warnings.map((warning) => warning.id)).size !== output.warnings.length) {
    context.addIssue({ code: "custom", message: "Duplicate warning ID", path: ["warnings"] });
  }
});

/** Server-owned result. Its literals make the non-blocking meaning explicit. */
export const finalAuditReportSchema = z.strictObject({
  effect: z.literal("advisory_only"),
  publishDecision: z.literal("not_evaluated"),
  warnings: z.array(finalAuditWarningSchema),
});

export type FinalAuditInput = z.infer<typeof finalAuditInputSchema>;
export type FinalAuditOutput = z.infer<typeof finalAuditOutputSchema>;
export type FinalAuditReport = z.infer<typeof finalAuditReportSchema>;
