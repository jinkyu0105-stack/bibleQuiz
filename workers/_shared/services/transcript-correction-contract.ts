import { string, strictObject, number, int, enum as zEnum, array, iso, type z } from "zod";

// Private structured proposal data, never an AI provider or a public response.
const id = string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const sha256 = string().regex(/^[0-9a-f]{64}$/u);
export const correctionItemSchema = strictObject({
  id,
  // Half-open UTF-16 offsets within the base segment, or the whole plain text.
  segmentId: id.nullable(), start: number().finite().nonnegative().nullable(),
  duration: number().finite().nonnegative().nullable(),
  from: int().nonnegative(), to: int().nonnegative(),
  originalText: string().max(20_000), proposedText: string().max(20_000),
  changeType: zEnum(["recognition", "spacing", "spelling", "punctuation", "terminology", "repetition"]),
  reason: string().min(1).max(500), confidence: number().min(0).max(1),
  riskFlags: array(zEnum(["biblical_term", "number", "negation", "deletion", "needs_review"])).max(5),
  contextBefore: string().max(120), contextAfter: string().max(120),
});
export const correctionProposalInputSchema = strictObject({
  sourceId: id, sourceSha256: sha256, baseRevisionId: id, baseTranscriptSha256: sha256,
  items: array(correctionItemSchema).min(1).max(1000),
});
export const correctionProposalSchema = correctionProposalInputSchema.extend({
  id, registeredVersion: int().positive(), registeredBy: id, registeredAt: iso.datetime(),
});
export const correctionDecisionsSchema = array(strictObject({
  itemId: id, decision: zEnum(["accepted", "rejected"]),
})).min(1).max(1000);
export const correctionDecisionRecordSchema = strictObject({
  id, proposalId: id, version: int().positive(), decisions: correctionDecisionsSchema,
  decidedBy: id, decidedAt: iso.datetime(),
});
export const mergedCorrectionSchema = strictObject({ proposalId: id, decisionVersion: int().positive() });
export type CorrectionProposal = z.infer<typeof correctionProposalSchema>;
export type CorrectionItem = z.infer<typeof correctionItemSchema>;
