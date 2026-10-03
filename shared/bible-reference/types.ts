import { z } from "zod";

export const BIBLE_BOOK_IDS = [
  "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA",
  "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO",
  "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO",
  "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL", "MAT",
  "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP",
  "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE",
  "2PE", "1JN", "2JN", "3JN", "JUD", "REV",
] as const;

export const bibleBookIdSchema = z.enum(BIBLE_BOOK_IDS);
export type BibleBookId = z.infer<typeof bibleBookIdSchema>;

export const bibleReferencePointSchema = z.object({
  chapter: z.int().positive(),
  verse: z.int().positive(),
}).strict();

export const canonicalBibleReferenceSchema = z.object({
  bookId: bibleBookIdSchema,
  end: bibleReferencePointSchema,
  start: bibleReferencePointSchema,
}).strict().refine(
  ({ end, start }) => end.chapter === start.chapter,
  { message: "v1 성경 장절은 같은 장 안의 연속 범위여야 합니다." },
).refine(
  ({ end, start }) => end.verse >= start.verse,
  { message: "마지막 절은 시작 절보다 앞설 수 없습니다." },
);

export type CanonicalBibleReference = z.infer<typeof canonicalBibleReferenceSchema>;

export const normalizedBibleReferenceSchema = z.object({
  canonicalLabel: z.string().min(1).max(80),
  mode: z.literal("reference_only"),
  readingPortalUrl: z.literal(
    "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE",
  ),
  reference: canonicalBibleReferenceSchema,
  translation: z.literal("개역개정"),
  verseCount: z.int().positive(),
}).strict();

export type NormalizedBibleReference = z.infer<typeof normalizedBibleReferenceSchema>;

export const BIBLE_REFERENCE_ERROR_CODES = [
  "EMPTY_INPUT",
  "INPUT_TOO_LONG",
  "INVALID_FORMAT",
  "UNKNOWN_BOOK",
  "CHAPTER_OUT_OF_RANGE",
  "VERSE_OUT_OF_RANGE",
  "RANGE_REVERSED",
  "CROSS_CHAPTER_UNSUPPORTED",
] as const;

export const bibleReferenceErrorCodeSchema = z.enum(BIBLE_REFERENCE_ERROR_CODES);
export type BibleReferenceErrorCode = z.infer<typeof bibleReferenceErrorCodeSchema>;

export interface BibleReferenceError {
  code: BibleReferenceErrorCode;
  message: string;
  bookId?: BibleBookId;
  chapter?: number;
  verse?: number;
  maximum?: number;
  minimum?: number;
}

export type BibleReferenceResult =
  | { ok: true; value: NormalizedBibleReference }
  | { ok: false; error: BibleReferenceError };

export interface BibleReferenceSelectionInput {
  bookId: unknown;
  chapter: unknown;
  verseEnd: unknown;
  verseStart: unknown;
}
