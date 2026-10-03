import { z } from "zod";

import { revealedSolutionSchema } from "./solution";

const cellIdSchema = z.string().regex(/^r[0-9]c[0-9]$/u);
const completeHangulSyllableSchema = z
  .string()
  .transform((value) => value.normalize("NFC"))
  .pipe(z.string().regex(/^[\uAC00-\uD7A3]$/u));

export const practiceCheckRequestSchema = z.strictObject({
  revision: z.int().positive(),
  cells: z
    .record(cellIdSchema, completeHangulSyllableSchema)
    .refine((cells) => Object.keys(cells).length <= 100),
});

export const practiceCheckDataSchema = z.strictObject({
  quizVariantId: z.string().min(1).max(128),
  quizRevision: z.int().positive(),
  correctCells: z.int().nonnegative(),
  totalCells: z.int().positive().max(100),
  correctWords: z.int().nonnegative(),
  totalWords: z.int().positive().max(100),
  scoreBasisPoints: z.int().min(0).max(10_000),
  correctnessMask: z.string().regex(/^[01]{1,100}$/u),
  solution: revealedSolutionSchema,
}).superRefine((result, context) => {
  if (
    result.correctCells > result.totalCells ||
    result.correctWords > result.totalWords ||
    result.correctnessMask.length !== result.totalCells ||
    Array.from(result.correctnessMask).filter((value) => value === "1").length !== result.correctCells ||
    result.scoreBasisPoints !== Math.round((result.correctCells / result.totalCells) * 10_000) ||
    Object.keys(result.solution.cells).length !== result.totalCells ||
    Object.keys(result.solution.entries).length !== result.totalWords
  ) {
    context.addIssue({ code: "custom", message: "Invalid practice result totals" });
  }
});

export type PracticeCheckRequest = z.infer<typeof practiceCheckRequestSchema>;
export type PracticeCheckData = z.infer<typeof practiceCheckDataSchema>;
