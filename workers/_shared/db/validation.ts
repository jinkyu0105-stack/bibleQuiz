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
