import { z } from "zod";

import { difficultySchema } from "../../../shared/api/public-quiz";

import { intentEvidenceSchema } from "./sermon-intent-contract";
import { summaryBindingSchema } from "./sermon-summary-contract";

// Worker-only candidates. No answers, provenance or human records are public DTOs.
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const text = z.string().refine((value) => {
  // eslint-disable-next-line no-control-regex -- Preserve text; reject lossy UTF-16, controls and invisible-only input.
  return /[^\s\u200B-\u200D\u2060\uFEFF]/u.test(value) && !/[\uD800-\uDFFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
});
export const candidateReplacementSchema = z.strictObject({ basePoolId: id, candidateId: id });
export const candidateDifficultySchema = difficultySchema;
export const candidateBindingSchema = summaryBindingSchema;
export const sermonCandidateSchema = z.strictObject({
  id, displayAnswer: text, gridAnswer: text, clue: text,
  phraseDescription: text, selectionReason: text, sermonImportance: text, difficultyReason: text,
  grounding: z.discriminatedUnion("origin", [
    z.strictObject({ origin: z.literal("transcript"), intentClaimIds: z.array(id).min(1), evidence: z.array(intentEvidenceSchema).min(1) }),
    // Human edits only. A note never pretends to be a quotation or timestamp.
    z.strictObject({ origin: z.literal("admin_context"), note: text }),
  ]),
});
export const sermonCandidateDraftSchema = z.strictObject({ candidates: z.array(sermonCandidateSchema).min(1) });
export const candidateStatusSchema = z.enum(["use", "locked", "excluded"]);
// Capture binding and difficulty on the server before generation; a provider returns only draft.
export const candidateOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("generate"), difficulty: candidateDifficultySchema, binding: candidateBindingSchema, draft: sermonCandidateDraftSchema, replacement: candidateReplacementSchema.optional() }),
  z.strictObject({ kind: z.literal("edit"), difficulty: candidateDifficultySchema, binding: candidateBindingSchema, basePoolId: id, draft: sermonCandidateDraftSchema }),
  z.strictObject({ kind: z.literal("set_status"), difficulty: candidateDifficultySchema, poolId: id, candidateId: id, status: candidateStatusSchema }),
  z.strictObject({ kind: z.literal("select"), difficulty: candidateDifficultySchema, poolId: id }),
  z.strictObject({ kind: z.literal("restore"), difficulty: candidateDifficultySchema, poolId: id }),
  z.strictObject({ kind: z.literal("review"), difficulty: candidateDifficultySchema, poolId: id }),
]);
export const candidateEventSchema = z.strictObject({
  id, version: z.int().positive(), actorId: id, createdAt: z.iso.datetime(), operation: candidateOperationSchema,
});
// Deliberately no candidate IDs, answer lengths, private metadata, status or geometry.
export const publicCandidateCluesSchema = z.strictObject({
  difficulty: candidateDifficultySchema, clues: z.array(z.strictObject({ clue: text })),
});
export type CandidateDifficulty = z.infer<typeof candidateDifficultySchema>;
export type CandidateBinding = z.infer<typeof candidateBindingSchema>;
export type SermonCandidateDraft = z.infer<typeof sermonCandidateDraftSchema>;
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;
export type CandidateOperation = z.infer<typeof candidateOperationSchema>;
export type CandidateEvent = z.infer<typeof candidateEventSchema>;
export type PublicCandidateClues = z.infer<typeof publicCandidateCluesSchema>;
