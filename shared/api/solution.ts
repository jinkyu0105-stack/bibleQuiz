import { z } from "zod";

const cellIdSchema = z.string().regex(/^r[0-9]c[0-9]$/u);
const completeHangulSyllableSchema = z.string().regex(/^[\uAC00-\uD7A3]$/u);

/**
 * Browser-safe official answer shape. Storage-only ordering, checksums, and
 * provenance deliberately do not belong to this contract.
 */
export const revealedSolutionSchema = z.strictObject({
  cells: z.record(cellIdSchema, completeHangulSyllableSchema),
  entries: z.record(z.string().min(1).max(128), z.string().min(1).max(100)),
}).superRefine((solution, context) => {
  const cellCount = Object.keys(solution.cells).length;
  const entryCount = Object.keys(solution.entries).length;
  if (cellCount < 1 || cellCount > 100 || entryCount < 1 || entryCount > 100) {
    context.addIssue({ code: "custom", message: "Invalid revealed solution totals" });
  }
});

export const quizSolutionDataSchema = z.strictObject({
  quizVariantId: z.string().min(1).max(128),
  quizRevision: z.int().positive(),
  solution: revealedSolutionSchema,
});

export type RevealedSolution = z.infer<typeof revealedSolutionSchema>;
export type QuizSolutionData = z.infer<typeof quizSolutionDataSchema>;
