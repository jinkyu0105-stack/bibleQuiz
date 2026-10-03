import { z } from "zod";
import { closeQuizSetNowRequestSchema, quizSetIdSchema } from "./admin-finalization";
import { displayMetadataSchema } from "./admin-display-text";
import { quizSlugSchema } from "./public-quiz";

export const withdrawRequestSchema = z.strictObject({
  requestKey: z.uuid(), expectedPublishedAt: z.iso.datetime(), expectedDisplayRevision: z.int().nonnegative(),
  reason: closeQuizSetNowRequestSchema.shape.reason, confirmation: z.literal("withdraw"),
});
// This private editing starting point is never part of a public quiz DTO.
export const withdrawalReviewSchema = z.strictObject({
  metadata: displayMetadataSchema, slug: quizSlugSchema, summary: z.string(), disclosure: z.string(),
  churchName: z.string(), bibleReferenceLabel: z.string(), translation: z.string(), bibleReadingUrl: z.url(),
  variants: z.array(z.strictObject({
    sourceVariantId: quizSetIdSchema, sourceRevision: z.int().positive(), difficulty: z.enum(["child", "adult"]),
    grid: z.json(), entries: z.array(z.strictObject({
      id: quizSetIdSchema, number: z.int().positive(), direction: z.enum(["across", "down"]),
      startRow: z.int().nonnegative(), startCol: z.int().nonnegative(), length: z.int().positive(),
      clue: z.string(), grounding: z.json(), displayOrder: z.int().nonnegative(),
    })), canonicalCellOrder: z.array(z.string()),
    solutionCells: z.record(z.string(), z.string()), entryAnswers: z.record(z.string(), z.string()),
    solutionSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })).length(2).refine(items => new Set(items.map(v => v.difficulty)).size === 2),
});
export const withdrawalViewSchema = z.strictObject({
  quizSetId: quizSetIdSchema, reviewRevision: z.int().positive(), withdrawnAt: z.iso.datetime(),
  reason: closeQuizSetNowRequestSchema.shape.reason, review: withdrawalReviewSchema,
});
export const withdrawalListSchema = z.strictObject({ items: z.array(z.strictObject({
  quizSetId: quizSetIdSchema, title: z.string(), withdrawnAt: z.iso.datetime(), reviewRevision: z.int().positive(),
})) });
export const withdrawResultSchema = z.strictObject({
  outcome: z.enum(["withdrawn", "replayed"]), quizSetId: quizSetIdSchema, reviewRevision: z.int().positive(),
  withdrawnAt: z.iso.datetime(),
});
export type WithdrawalView = z.infer<typeof withdrawalViewSchema>;
