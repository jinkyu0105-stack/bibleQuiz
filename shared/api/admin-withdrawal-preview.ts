import { z } from "zod";
import { quizSetIdSchema } from "./admin-finalization";
import { difficultySchema, publicPuzzleGridSchema } from "./public-quiz";
import { revealedSolutionSchema } from "./solution";

export const withdrawalEditsSchema = z.array(z.strictObject({
  difficulty: difficultySchema, entryId: quizSetIdSchema,
  answer: z.string().optional(), clue: z.string().trim().min(1).max(2000).optional(),
}).refine(edit => edit.answer !== undefined || edit.clue !== undefined))
  .refine(edits => new Set(edits.map(edit => `${edit.difficulty}:${edit.entryId}`)).size === edits.length);
export const withdrawalPreviewRequestSchema = z.strictObject({
  expectedReviewRevision: z.int().positive(), expectedEditRevision: z.int().nonnegative().default(0),
  edits: withdrawalEditsSchema,
}).refine(command => command.edits.length > 0 || command.expectedEditRevision > 0);
export const withdrawalEditSaveRequestSchema = z.strictObject({
  requestKey: z.uuid(), expectedReviewRevision: z.int().positive(), expectedEditRevision: z.int().nonnegative(),
  edits: withdrawalEditsSchema.refine(edits => edits.length > 0),
});
export const withdrawalEditViewSchema = z.strictObject({
  quizSetId: quizSetIdSchema, reviewRevision: z.int().positive(), editRevision: z.int().nonnegative(),
  savedAt: z.iso.datetime().nullable(), edits: withdrawalEditsSchema, requiresHumanReview: z.literal(true),
});
export const withdrawalEditSaveResultSchema = z.strictObject({
  outcome: z.enum(["saved", "replayed"]), revision: withdrawalEditViewSchema,
});

// Private preview only: neither persistence nor a publication authorization.
export const withdrawalPreviewSchema = z.strictObject({
  quizSetId: quizSetIdSchema, reviewRevision: z.int().positive(), editRevision: z.int().nonnegative(),
  persisted: z.literal(false), requiresHumanReview: z.literal(true), codeChecksPassed: z.boolean(),
  variants: z.array(z.strictObject({
    difficulty: difficultySchema, issues: z.array(z.string()),
    preview: z.strictObject({ grid: publicPuzzleGridSchema, solution: revealedSolutionSchema }).nullable(),
  })).length(2),
});
