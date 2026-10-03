import {
  findBibleBookByKoreanName,
  getBibleBook,
  getVerseCount,
} from "./metadata";
import {
  bibleBookIdSchema,
  canonicalBibleReferenceSchema,
  normalizedBibleReferenceSchema,
  type BibleBookId,
  type BibleReferenceError,
  type BibleReferenceResult,
  type BibleReferenceSelectionInput,
  type NormalizedBibleReference,
} from "./types";

const MAX_INPUT_LENGTH = 120;
const RANGE_SEPARATOR = "[-~–—]";
const COLON_REFERENCE = new RegExp(
  `^(.+?)(\\d+)\\s*:\\s*(\\d+)(?:\\s*${RANGE_SEPARATOR}\\s*(\\d+))?$`,
  "u",
);
const KOREAN_REFERENCE = new RegExp(
  `^(.+?)(\\d+)\\s*장\\s*(\\d+)\\s*절(?:\\s*${RANGE_SEPARATOR}\\s*(\\d+)\\s*절?)?$`,
  "u",
);
const CROSS_CHAPTER_COLON_REFERENCE = new RegExp(
  `^(.+?)(\\d+)\\s*:\\s*(\\d+)\\s*${RANGE_SEPARATOR}\\s*(\\d+)\\s*:\\s*(\\d+)$`,
  "u",
);
const CROSS_CHAPTER_KOREAN_REFERENCE = new RegExp(
  `^(.+?)(\\d+)\\s*장\\s*(\\d+)\\s*절\\s*${RANGE_SEPARATOR}\\s*(\\d+)\\s*장\\s*(\\d+)\\s*절$`,
  "u",
);

export const BIBLE_TRANSLATION = "개역개정" as const;
export const BIBLE_TEXT_MODE = "reference_only" as const;
export const BIBLE_READING_PORTAL_URL =
  "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE" as const;

function failure(error: BibleReferenceError): BibleReferenceResult {
  return { error, ok: false };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function createNormalizedReference(
  bookId: BibleBookId,
  chapter: number,
  verseStart: number,
  verseEnd: number,
): NormalizedBibleReference {
  const book = getBibleBook(bookId);
  const reference = canonicalBibleReferenceSchema.parse({
    bookId,
    end: { chapter, verse: verseEnd },
    start: { chapter, verse: verseStart },
  });
  const range = verseStart === verseEnd ? `${verseStart}` : `${verseStart}–${verseEnd}`;

  return normalizedBibleReferenceSchema.parse({
    canonicalLabel: `${book.canonicalKoreanName} ${chapter}:${range}`,
    mode: BIBLE_TEXT_MODE,
    readingPortalUrl: BIBLE_READING_PORTAL_URL,
    reference,
    translation: BIBLE_TRANSLATION,
    verseCount: verseEnd - verseStart + 1,
  });
}

export function createBibleReference(
  input: BibleReferenceSelectionInput,
): BibleReferenceResult {
  const bookIdResult = bibleBookIdSchema.safeParse(input.bookId);
  if (!bookIdResult.success) {
    return failure({
      code: "UNKNOWN_BOOK",
      message: "등록된 성경 66권 중 한 권을 선택해 주세요.",
    });
  }

  const bookId = bookIdResult.data;
  const book = getBibleBook(bookId);
  if (!isPositiveInteger(input.chapter) || input.chapter > book.chapterCount) {
    return failure({
      bookId,
      code: "CHAPTER_OUT_OF_RANGE",
      maximum: book.chapterCount,
      message: `${book.canonicalKoreanName}은(는) 1장부터 ${book.chapterCount}장까지 있습니다.`,
      minimum: 1,
      ...(typeof input.chapter === "number" ? { chapter: input.chapter } : {}),
    });
  }

  const chapter = input.chapter;
  const maximumVerse = getVerseCount(bookId, chapter);
  if (maximumVerse === undefined) {
    throw new Error("검증된 장에 절 metadata가 없습니다.");
  }

  if (!isPositiveInteger(input.verseStart) || input.verseStart > maximumVerse) {
    return failure({
      bookId,
      chapter,
      code: "VERSE_OUT_OF_RANGE",
      maximum: maximumVerse,
      message: `${book.canonicalKoreanName} ${chapter}장은 1절부터 ${maximumVerse}절까지 있습니다.`,
      minimum: 1,
      ...(typeof input.verseStart === "number" ? { verse: input.verseStart } : {}),
    });
  }

  if (!isPositiveInteger(input.verseEnd) || input.verseEnd > maximumVerse) {
    return failure({
      bookId,
      chapter,
      code: "VERSE_OUT_OF_RANGE",
      maximum: maximumVerse,
      message: `${book.canonicalKoreanName} ${chapter}장은 1절부터 ${maximumVerse}절까지 있습니다.`,
      minimum: 1,
      ...(typeof input.verseEnd === "number" ? { verse: input.verseEnd } : {}),
    });
  }

  if (input.verseEnd < input.verseStart) {
    return failure({
      bookId,
      chapter,
      code: "RANGE_REVERSED",
      message: "마지막 절은 시작 절보다 앞설 수 없습니다.",
    });
  }

  return {
    ok: true,
    value: createNormalizedReference(
      bookId,
      chapter,
      input.verseStart,
      input.verseEnd,
    ),
  };
}

function normalizeInput(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function unknownBook(): BibleReferenceResult {
  return failure({
    code: "UNKNOWN_BOOK",
    message: "성경 책 이름이나 허용된 약어를 확인해 주세요.",
  });
}

export function parseBibleReference(input: unknown): BibleReferenceResult {
  if (typeof input !== "string") {
    return failure({
      code: "INVALID_FORMAT",
      message: "성경 장절을 문자열로 입력해 주세요.",
    });
  }

  const normalizedInput = normalizeInput(input);
  if (normalizedInput.length === 0) {
    return failure({
      code: "EMPTY_INPUT",
      message: "성경 장절을 입력해 주세요.",
    });
  }
  if (normalizedInput.length > MAX_INPUT_LENGTH) {
    return failure({
      code: "INPUT_TOO_LONG",
      maximum: MAX_INPUT_LENGTH,
      message: `성경 장절 입력은 ${MAX_INPUT_LENGTH}자를 넘을 수 없습니다.`,
    });
  }

  const crossChapterMatch =
    normalizedInput.match(CROSS_CHAPTER_COLON_REFERENCE) ??
    normalizedInput.match(CROSS_CHAPTER_KOREAN_REFERENCE);
  if (crossChapterMatch !== null) {
    const book = findBibleBookByKoreanName(crossChapterMatch[1] ?? "");
    if (book === undefined) {
      return unknownBook();
    }
    return failure({
      bookId: book.bookId,
      code: "CROSS_CHAPTER_UNSUPPORTED",
      message: "v1에서는 같은 장 안의 연속 절 범위만 입력할 수 있습니다.",
    });
  }

  const match =
    normalizedInput.match(COLON_REFERENCE) ??
    normalizedInput.match(KOREAN_REFERENCE);
  if (match === null) {
    return failure({
      code: "INVALID_FORMAT",
      message: "예: 요한복음 3:1-3 또는 요 3장 1절-3절 형식으로 입력해 주세요.",
    });
  }

  const book = findBibleBookByKoreanName(match[1] ?? "");
  if (book === undefined) {
    return unknownBook();
  }

  const chapter = Number(match[2]);
  const verseStart = Number(match[3]);
  const verseEnd = match[4] === undefined ? verseStart : Number(match[4]);
  return createBibleReference({
    bookId: book.bookId,
    chapter,
    verseEnd,
    verseStart,
  });
}
