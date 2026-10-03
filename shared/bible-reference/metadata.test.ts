import { describe, expect, it } from "vitest";

import {
  BIBLE_BOOKS,
  findBibleBookByKoreanName,
  getBibleBook,
  getVerseCount,
  normalizeBibleBookKey,
} from "./metadata";
import { BIBLE_BOOK_IDS } from "./types";

describe("성경 66권 metadata", () => {
  it("개신교 정경 66권과 1,189장의 순서·범위를 완전하게 가진다", () => {
    expect(BIBLE_BOOKS).toHaveLength(66);
    expect(BIBLE_BOOKS.map((book) => book.bookId)).toEqual(BIBLE_BOOK_IDS);
    expect(BIBLE_BOOKS.map((book) => book.canonicalOrder)).toEqual(
      Array.from({ length: 66 }, (_, index) => index + 1),
    );
    expect(BIBLE_BOOKS.filter((book) => book.testament === "old")).toHaveLength(39);
    expect(BIBLE_BOOKS.filter((book) => book.testament === "new")).toHaveLength(27);
    expect(BIBLE_BOOKS.reduce((sum, book) => sum + book.chapterCount, 0)).toBe(1189);

    for (const book of BIBLE_BOOKS) {
      expect(book.chapterCount).toBe(book.verseCounts.length);
      expect(book.verseCounts.every(Number.isInteger)).toBe(true);
      expect(book.verseCounts.every((count) => count > 0)).toBe(true);
    }
  });

  it("정식명과 허용 약어가 정규화 뒤에도 서로 충돌하지 않는다", () => {
    const keys = BIBLE_BOOKS.flatMap((book) =>
      [book.canonicalKoreanName, ...book.aliases].map(normalizeBibleBookKey),
    );

    expect(new Set(keys).size).toBe(keys.length);
    for (const book of BIBLE_BOOKS) {
      expect(findBibleBookByKoreanName(book.canonicalKoreanName)?.bookId).toBe(book.bookId);
      for (const alias of book.aliases) {
        expect(findBibleBookByKoreanName(alias)?.bookId).toBe(book.bookId);
      }
    }
  });

  it("모호하기 쉬운 한국어 약어를 명시적으로 구분한다", () => {
    expect(findBibleBookByKoreanName("요")?.bookId).toBe("JHN");
    expect(findBibleBookByKoreanName("요일")?.bookId).toBe("1JN");
    expect(findBibleBookByKoreanName("요이")?.bookId).toBe("2JN");
    expect(findBibleBookByKoreanName("요삼")?.bookId).toBe("3JN");
    expect(findBibleBookByKoreanName("욥")?.bookId).toBe("JOB");
    expect(findBibleBookByKoreanName("욜")?.bookId).toBe("JOL");
    expect(findBibleBookByKoreanName("욘")?.bookId).toBe("JON");
  });

  it("장별 마지막 절 metadata의 대표 경계를 반환한다", () => {
    expect(getBibleBook("GEN")).toMatchObject({
      canonicalKoreanName: "창세기",
      chapterCount: 50,
    });
    expect(getBibleBook("PSA").chapterCount).toBe(150);
    expect(getVerseCount("PSA", 119)).toBe(176);
    expect(getVerseCount("JHN", 3)).toBe(36);
    expect(getVerseCount("3JN", 1)).toBe(15);
    expect(getVerseCount("REV", 22)).toBe(21);
    expect(getVerseCount("REV", 23)).toBeUndefined();
  });
});
