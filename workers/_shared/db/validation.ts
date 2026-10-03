import { z } from "zod";

export const bibleReferenceSchema = z.object({
  book: z.string().trim().min(1).max(40),
  chapter: z.int().positive(),
  verseEnd: z.int().positive(),
  verseStart: z.int().positive(),
});

export const bibleReferencesSchema = z
  .array(
    bibleReferenceSchema.refine(
      (reference) => reference.verseEnd >= reference.verseStart,
      { message: "마지막 절은 시작 절보다 앞설 수 없습니다." },
    ),
  )
  .min(1);

export const publicGridSchema = z.object({
  cells: z.array(
    z.object({
      acrossNumber: z.int().positive().optional(),
      column: z.int().nonnegative(),
      downNumber: z.int().positive().optional(),
      isBlocked: z.boolean(),
      row: z.int().nonnegative(),
    }),
  ),
  size: z.int().min(5).max(10),
});

export const validationReportSchema = z.object({
  errors: z.array(z.string()),
  generatedAt: z.iso.datetime(),
  warnings: z.array(z.string()),
});

const cellIdSchema = z.string().regex(/^r[0-9]c[0-9]$/u);
const completeHangulSyllableSchema = z.string().regex(/^[\uAC00-\uD7A3]$/u);

export const canonicalCellOrderSchema = z
  .array(cellIdSchema)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length);

export const solutionCellsSchema = z.record(
  cellIdSchema,
  completeHangulSyllableSchema,
);

export const entryAnswersSchema = z.record(
  z.string().min(1).max(128),
  z.string().min(1).max(100),
);

export const submissionAnswersSchema = z
  .record(cellIdSchema, completeHangulSyllableSchema)
  .refine((answers) => Object.keys(answers).length <= 100);
