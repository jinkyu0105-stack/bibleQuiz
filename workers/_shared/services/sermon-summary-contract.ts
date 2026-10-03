import { z } from "zod";

import { intentEvidenceSchema, intentTranscriptBindingSchema } from "./sermon-intent-contract";

// Private structured draft. Only the explicitly projected text/disclosure can leave the server.
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const text = z.string().refine((value) => {
  // eslint-disable-next-line no-control-regex -- Reject lossy UTF-16 and invisible-only paragraphs without rewriting input.
  return /[^\s\u200B-\u200D\u2060\uFEFF]/u.test(value) && !/[\uD800-\uDFFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
});
export const summaryBindingSchema = z.strictObject({
  transcript: intentTranscriptBindingSchema,
  analysisId: id, intentConfirmationId: id,
});
export const sermonSummaryDraftSchema = z.strictObject({
  paragraphs: z.array(z.strictObject({
    id, text, intentClaimIds: z.array(id).min(1), evidence: z.array(intentEvidenceSchema).min(1),
  })).min(1),
});
// Capture binding before generation; a future provider returns ONLY the draft, never this wrapper.
export const summaryOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("generate"), binding: summaryBindingSchema, draft: sermonSummaryDraftSchema }),
  z.strictObject({ kind: z.literal("edit"), binding: summaryBindingSchema, baseSummaryId: id, draft: sermonSummaryDraftSchema }),
  z.strictObject({ kind: z.literal("select"), summaryId: id }),
  z.strictObject({ kind: z.literal("restore"), summaryId: id }),
  z.strictObject({ kind: z.literal("review"), summaryId: id }),
]);
export const summaryEventSchema = z.strictObject({
  id, version: z.int().positive(), actorId: id, createdAt: z.iso.datetime(), operation: summaryOperationSchema,
});
export type SummaryBinding = z.infer<typeof summaryBindingSchema>;
export type SermonSummaryDraft = z.infer<typeof sermonSummaryDraftSchema>;
export type SummaryOperation = z.infer<typeof summaryOperationSchema>;
export type SummaryEvent = z.infer<typeof summaryEventSchema>;
