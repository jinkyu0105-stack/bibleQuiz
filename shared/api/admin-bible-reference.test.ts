import { describe, expect, it } from "vitest";

import {
  adminBibleReferenceSuccessSchema,
  adminBibleReferenceValidationFailureSchema,
  bibleReferencePreviewQuerySchema,
  parseBibleReferenceRequestSchema,
} from "./admin-bible-reference";

const normalizedReference = {
  canonicalLabel: "요한복음 3:1–3",
  mode: "reference_only",
  readingPortalUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE",
  reference: {
    bookId: "JHN",
    end: { chapter: 3, verse: 3 },
    start: { chapter: 3, verse: 1 },
  },
  translation: "개역개정",
  verseCount: 3,
} as const;

describe("admin Bible reference API contract", () => {
  it("accepts only a string natural-language input field", () => {
    expect(parseBibleReferenceRequestSchema.parse({ input: "요한복음 3:1-3" }))
      .toEqual({ input: "요한복음 3:1-3" });
    expect(parseBibleReferenceRequestSchema.safeParse({ input: null }).success).toBe(false);
    expect(parseBibleReferenceRequestSchema.safeParse({ input: "요 3:16", text: "private" }).success)
      .toBe(false);
    expect(parseBibleReferenceRequestSchema.safeParse({}).success).toBe(false);
  });

  it("strictly converts an exact selection query to canonical numeric input", () => {
    expect(bibleReferencePreviewQuerySchema.parse({
      book: "JHN",
      chapter: "3",
      verseEnd: "3",
      verseStart: "1",
    })).toEqual({ book: "JHN", chapter: 3, verseEnd: 3, verseStart: 1 });
    expect(bibleReferencePreviewQuerySchema.safeParse({
      book: "요한복음",
      chapter: "3",
      verseEnd: "3",
      verseStart: "1",
    }).success).toBe(false);
    expect(bibleReferencePreviewQuerySchema.safeParse({
      book: "JHN",
      chapter: "03",
      verseEnd: "3",
      verseStart: "1",
    }).success).toBe(false);
    expect(bibleReferencePreviewQuerySchema.safeParse({
      book: "JHN",
      chapter: "3",
      extra: "private",
      verseEnd: "3",
      verseStart: "1",
    }).success).toBe(false);
  });

  it("keeps success and reference-validation failure envelopes strict and body-free", () => {
    expect(adminBibleReferenceSuccessSchema.parse({ data: normalizedReference }))
      .toEqual({ data: normalizedReference });
    expect(adminBibleReferenceSuccessSchema.safeParse({
      data: { ...normalizedReference, text: "성경 본문 비노출" },
    }).success).toBe(false);
    expect(adminBibleReferenceValidationFailureSchema.safeParse({
      error: {
        code: "VERSE_OUT_OF_RANGE",
        message: "절 범위를 확인해 주세요.",
        requestId: "019924d8-f000-7000-8000-000000000001",
      },
    }).success).toBe(true);
    expect(adminBibleReferenceValidationFailureSchema.safeParse({
      error: {
        code: "VERSE_OUT_OF_RANGE",
        message: "절 범위를 확인해 주세요.",
        requestId: "019924d8-f000-7000-8000-000000000001",
        actorEmail: "private@example.com",
      },
    }).success).toBe(false);
  });
});
