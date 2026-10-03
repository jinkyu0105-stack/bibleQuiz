import { z } from "zod";

import {
  bibleBookIdSchema,
  bibleReferenceErrorCodeSchema,
  normalizedBibleReferenceSchema,
} from "../bible-reference";

export const parseBibleReferenceRequestSchema = z.object({
  input: z.string(),
}).strict();

const positiveDecimalQuerySchema = z.string()
  .regex(/^[1-9][0-9]{0,2}$/u)
  .transform((value) => Number(value));

export const bibleReferencePreviewQuerySchema = z.object({
  book: bibleBookIdSchema,
  chapter: positiveDecimalQuerySchema,
  verseEnd: positiveDecimalQuerySchema,
  verseStart: positiveDecimalQuerySchema,
}).strict();

export const adminBibleReferenceDataSchema = normalizedBibleReferenceSchema;

export const adminBibleReferenceSuccessSchema = z.object({
  data: adminBibleReferenceDataSchema,
}).strict();

export const adminBibleReferenceValidationFailureSchema = z.object({
  error: z.object({
    code: bibleReferenceErrorCodeSchema,
    message: z.string().min(1).max(500),
    requestId: z.uuid(),
  }).strict(),
}).strict();

export type ParseBibleReferenceRequest = z.infer<typeof parseBibleReferenceRequestSchema>;
export type BibleReferencePreviewQuery = z.infer<typeof bibleReferencePreviewQuerySchema>;
