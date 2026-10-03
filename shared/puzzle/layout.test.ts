import { describe, expect, it } from "vitest";

import { validateLayout } from "./layout";
import type { EntryPlacement } from "./types";

function issueCodes(
  gridSize: number,
  entries: readonly EntryPlacement[],
): readonly string[] {
  return validateLayout(gridSize, entries).issues.map((issue) => issue.code);
}

describe("퍼즐 배치 하드 게이트", () => {
  it.each([5, 6, 8, 10])("%d×%d 경계 밖 placement를 거부한다", (gridSize) => {
    expect(
      issueCodes(gridSize, [
        {
          entryId: "outside",
          gridAnswer: "가나다",
          start: { row: gridSize - 1, column: gridSize - 2 },
          direction: "across",
        },
      ]),
    ).toContain("OUT_OF_BOUNDS");
  });

  it("교차 음절 충돌과 같은 방향 겹침을 거부한다", () => {
    const conflict: EntryPlacement[] = [
      {
        entryId: "across",
        gridAnswer: "가나다",
        start: { row: 1, column: 0 },
        direction: "across",
      },
      {
        entryId: "down",
        gridAnswer: "라마바",
        start: { row: 1, column: 1 },
        direction: "down",
      },
    ];
    const overlap: EntryPlacement[] = [
      conflict[0] as EntryPlacement,
      {
        entryId: "same-direction",
        gridAnswer: "나다라",
        start: { row: 1, column: 1 },
        direction: "across",
      },
    ];

    expect(issueCodes(5, conflict)).toContain("LETTER_CONFLICT");
    expect(issueCodes(5, overlap)).toContain("SAME_DIRECTION_OVERLAP");
  });

  it("교차가 아닌 옆줄 접촉으로 생기는 문자열을 거부한다", () => {
    expect(
      issueCodes(5, [
        {
          entryId: "top",
          gridAnswer: "가나다",
          start: { row: 1, column: 0 },
          direction: "across",
        },
        {
          entryId: "bottom",
          gridAnswer: "라마바사",
          start: { row: 2, column: 0 },
          direction: "across",
        },
      ]),
    ).toContain("UNINTENDED_ADJACENCY");
  });

  it("고립된 여러 component와 교차 없는 단어를 거부한다", () => {
    const report = validateLayout(5, [
      {
        entryId: "first",
        gridAnswer: "가나다",
        start: { row: 0, column: 0 },
        direction: "across",
      },
      {
        entryId: "second",
        gridAnswer: "라마바사",
        start: { row: 4, column: 1 },
        direction: "across",
      },
    ]);

    expect(report.connectedComponentCount).toBe(2);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["DISCONNECTED", "WORD_WITHOUT_CROSSING"]),
    );
  });

  it("연결과 실제 교차를 통과하면 다중 교차 권장 미달을 경고로 남기고 발행한다", () => {
    const report = validateLayout(5, [
      {
        entryId: "top",
        gridAnswer: "가나다",
        start: { row: 1, column: 0 },
        direction: "across",
      },
      {
        entryId: "bridge",
        gridAnswer: "라나마바",
        start: { row: 0, column: 1 },
        direction: "down",
      },
      {
        entryId: "bottom",
        gridAnswer: "바사아",
        start: { row: 3, column: 1 },
        direction: "across",
      },
    ]);

    expect(report.connectedComponentCount).toBe(1);
    expect(report.multiCrossingWordCount).toBe(1);
    expect(report.requiredMultiCrossingWordCount).toBe(2);
    expect(report.publishable).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.warnings?.map((issue) => issue.code)).toContain(
      "DENSITY_BELOW_THRESHOLD",
    );
  });
});
