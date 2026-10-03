import { describe, expect, it } from "vitest";

import {
  BIBLE_READING_PORTAL_URL,
  createBibleReference,
  parseBibleReference,
} from "./parser";
import { normalizedBibleReferenceSchema } from "./types";

const johnThreeOneToThree = {
  canonicalLabel: "요한복음 3:1–3",
  mode: "reference_only",
  readingPortalUrl: BIBLE_READING_PORTAL_URL,
  reference: {
    bookId: "JHN",
    end: { chapter: 3, verse: 3 },
    start: { chapter: 3, verse: 1 },
  },
  translation: "개역개정",
  verseCount: 3,
} as const;

function expectFailureCode(
  result: ReturnType<typeof parseBibleReference>,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
}

describe("결정적 자연어 성경 장절 parser", () => {
  it.each([
    "요한복음 3:1~3",
    "요한복음 3:1-3",
    "요한복음 3:1–3",
    "요한복음 3장 1절-3절",
    "요 3장 1절 ~ 3절",
    "  요한 복음  ３：１～３  ",
  ])("%s를 같은 정규형으로 만든다", (input) => {
    expect(parseBibleReference(input)).toEqual({
      ok: true,
      value: johnThreeOneToThree,
    });
  });

  it("한 절 입력은 범위 끝과 절 수를 결정적으로 채운다", () => {
    expect(parseBibleReference("요 3:16")).toEqual({
      ok: true,
      value: {
        canonicalLabel: "요한복음 3:16",
        mode: "reference_only",
        readingPortalUrl: BIBLE_READING_PORTAL_URL,
        reference: {
          bookId: "JHN",
          end: { chapter: 3, verse: 16 },
          start: { chapter: 3, verse: 16 },
        },
        translation: "개역개정",
        verseCount: 1,
      },
    });
  });

  it("선택 UI 입력과 자연어 입력이 같은 정규형을 만든다", () => {
    expect(createBibleReference({
      bookId: "JHN",
      chapter: 3,
      verseEnd: 3,
      verseStart: 1,
    })).toEqual(parseBibleReference("요한복음 3:1~3"));
  });

  it.each([
    ["", "EMPTY_INPUT"],
    ["   ", "EMPTY_INPUT"],
    ["성경아님 1:1", "UNKNOWN_BOOK"],
    ["요한복음", "INVALID_FORMAT"],
    ["요한복음 3장", "INVALID_FORMAT"],
    ["요한복음 0:1", "CHAPTER_OUT_OF_RANGE"],
    ["요한복음 22:1", "CHAPTER_OUT_OF_RANGE"],
    ["요한복음 3:0", "VERSE_OUT_OF_RANGE"],
    ["요한복음 3:37", "VERSE_OUT_OF_RANGE"],
    ["요한복음 3:4-2", "RANGE_REVERSED"],
    ["요한복음 3:16-4:2", "CROSS_CHAPTER_UNSUPPORTED"],
    ["요한복음 3장 16절-4장 2절", "CROSS_CHAPTER_UNSUPPORTED"],
  ])("%s를 %s로 거부한다", (input, code) => {
    expectFailureCode(parseBibleReference(input), code);
  });

  it("문자열이 아니거나 과도하게 긴 입력을 안정 오류로 거부한다", () => {
    expectFailureCode(parseBibleReference(null), "INVALID_FORMAT");
    expectFailureCode(parseBibleReference(`요${"가".repeat(121)} 3:16`), "INPUT_TOO_LONG");
  });

  it("선택 UI 값도 책·장·절·범위 오류를 같은 코드로 거부한다", () => {
    const cases = [
      [{ bookId: "BAD", chapter: 1, verseStart: 1, verseEnd: 1 }, "UNKNOWN_BOOK"],
      [{ bookId: "JHN", chapter: 22, verseStart: 1, verseEnd: 1 }, "CHAPTER_OUT_OF_RANGE"],
      [{ bookId: "JHN", chapter: 3, verseStart: 37, verseEnd: 37 }, "VERSE_OUT_OF_RANGE"],
      [{ bookId: "JHN", chapter: 3, verseStart: 3, verseEnd: 1 }, "RANGE_REVERSED"],
    ] as const;

    for (const [input, code] of cases) {
      const result = createBibleReference(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
      }
    }
  });

  it("공개 정규형은 본문이나 임의 추가 필드를 허용하지 않는다", () => {
    expect(normalizedBibleReferenceSchema.safeParse(johnThreeOneToThree).success).toBe(true);
    expect(normalizedBibleReferenceSchema.safeParse({
      ...johnThreeOneToThree,
      text: "본문이 들어오면 안 됨",
    }).success).toBe(false);
  });
});
