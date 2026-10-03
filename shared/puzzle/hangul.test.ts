import { describe, expect, it } from "vitest";

import {
  isCompleteHangulSyllable,
  normalizeDisplayAnswer,
  toGridAnswer,
  validateAndNormalizeAnswer,
} from "./hangul";

describe("한글 정답 정규화", () => {
  it("표시형은 NFC와 단어 사이 공백을 보존하고 격자형은 공백만 제거한다", () => {
    const decomposed = "  하나님의\t 열심  ";

    expect(normalizeDisplayAnswer(decomposed)).toBe("하나님의 열심");
    expect(toGridAnswer(decomposed)).toBe("하나님의열심");
  });

  it("완성형 한글 한 음절만 인정한다", () => {
    expect(isCompleteHangulSyllable("가")).toBe(true);
    expect(isCompleteHangulSyllable("힣")).toBe(true);

    for (const invalid of ["ㄱ", "ㅏ", "A", "1", "漢", "🙂", "가나", ""]) {
      expect(isCompleteHangulSyllable(invalid)).toBe(false);
    }
  });
});

describe("한글 정답 validator", () => {
  it("표시형과 격자형을 정규화한 후보로 반환한다", () => {
    expect(
      validateAndNormalizeAnswer(
        {
          id: "answer-1",
          displayAnswer: "하나님의 열심",
          gridAnswer: "하나님의열심",
          clue: "설교에서 강조한 표현",
        },
        6,
      ),
    ).toEqual({
      ok: true,
      value: {
        id: "answer-1",
        displayAnswer: "하나님의 열심",
        gridAnswer: "하나님의열심",
        syllables: ["하", "나", "님", "의", "열", "심"],
        clue: "설교에서 강조한 표현",
      },
    });
  });

  it("조사처럼 보이는 끝 음절을 의미 규칙으로 탈락시키지 않는다", () => {
    const result = validateAndNormalizeAnswer(
      { id: "answer-2", displayAnswer: "하나님의" },
      5,
    );

    expect(result.ok).toBe(true);
  });

  it.each([
    ["독립 자모", "믿ㅇ", "INVALID_HANGUL_SYLLABLE"],
    ["영문", "믿음A", "INVALID_HANGUL_SYLLABLE"],
    ["숫자", "믿음1", "INVALID_HANGUL_SYLLABLE"],
    ["기호", "믿음!", "INVALID_HANGUL_SYLLABLE"],
    ["이모지", "믿음🙂", "INVALID_HANGUL_SYLLABLE"],
    ["한 음절", "믿", "WORD_TOO_SHORT"],
    ["격자보다 긴 답", "하나님의열심", "WORD_TOO_LONG"],
  ])("%s 입력을 구조화된 오류로 거부한다", (_, answer, expectedCode) => {
    const result = validateAndNormalizeAnswer(
      { id: "invalid", displayAnswer: answer },
      5,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain(expectedCode);
    }
  });

  it("공백 제거 규칙과 다른 별도 격자형 답을 거부한다", () => {
    const result = validateAndNormalizeAnswer(
      {
        id: "mismatch",
        displayAnswer: "하나님의 열심",
        gridAnswer: "하나님열심",
      },
      6,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain(
        "GRID_ANSWER_MISMATCH",
      );
    }
  });
});
