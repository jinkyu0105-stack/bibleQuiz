import { describe, expect, it } from "vitest";

import { PUZZLE_FIXTURES } from "./fixtures";
import { generatePuzzle } from "./generator";
import { validateLayout } from "./layout";
import { serializePublicPuzzle } from "./serialization";

describe("seed 기반 퍼즐 생성기", () => {
  it.each([
    ["5×5", PUZZLE_FIXTURES.fiveByFive],
    ["8×8", PUZZLE_FIXTURES.eightByEight],
    ["10×10", PUZZLE_FIXTURES.tenByTen],
  ])("%s fixture를 모든 하드 게이트를 통과하도록 생성한다", (_, fixture) => {
    const result = generatePuzzle(fixture);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const independentReport = validateLayout(fixture.gridSize, result.puzzle.entries);
      expect(result.puzzle.report.publishable).toBe(true);
      expect(independentReport.publishable).toBe(true);
      expect(independentReport.connectedComponentCount).toBe(1);
      expect(independentReport.crossingCellCount).toBeGreaterThan(0);
      expect(independentReport.multiCrossingWordCount).toBeGreaterThanOrEqual(
        independentReport.requiredMultiCrossingWordCount,
      );
    }
  });

  it("같은 입력과 seed로 byte-equivalent 결과를 재현한다", () => {
    const first = generatePuzzle(PUZZLE_FIXTURES.fiveByFive);
    const second = generatePuzzle(PUZZLE_FIXTURES.fiveByFive);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("공통 음절이 없는 후보에는 구조화된 실패 이유만 반환한다", () => {
    const result = generatePuzzle({
      gridSize: 5,
      seed: "impossible",
      candidates: [
        { id: "first", displayAnswer: "가나다" },
        { id: "second", displayAnswer: "라마바사" },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      publishable: false,
      reasons: [{ code: "NO_SHARED_SYLLABLE" }],
    });
    expect(result).not.toHaveProperty("puzzle");
  });

  it("공통 음절 그래프가 여러 component이면 고립 후보를 알려 준다", () => {
    const result = generatePuzzle({
      gridSize: 5,
      seed: "disconnected",
      candidates: [
        { id: "first", displayAnswer: "가나다" },
        { id: "second", displayAnswer: "다라마" },
        { id: "isolated", displayAnswer: "바사아" },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      publishable: false,
      reasons: [
        { code: "DISCONNECTED_CANDIDATES", entryIds: ["isolated"] },
      ],
    });
  });

  it.each([4, 11])("지원 범위 밖 %d×%d 설정을 거부한다", (gridSize) => {
    const result = generatePuzzle({
      gridSize,
      seed: "invalid-size",
      candidates: [{ id: "answer", displayAnswer: "가나다" }],
    });

    expect(result).toMatchObject({
      ok: false,
      publishable: false,
      reasons: [{ code: "INVALID_GRID_SIZE" }],
    });
  });

  it("격자보다 긴 답을 발행 결과로 만들지 않는다", () => {
    const result = generatePuzzle({
      gridSize: 5,
      seed: "too-long",
      candidates: [{ id: "long", displayAnswer: "하나님의열심" }],
    });

    expect(result).toMatchObject({
      ok: false,
      publishable: false,
      reasons: [{ code: "WORD_TOO_LONG", entryIds: ["long"] }],
    });
    expect(result).not.toHaveProperty("puzzle");
  });

  it("정상 교차하는 두 단어는 다중 교차 경고와 함께 생성한다", () => {
    const result = generatePuzzle({
      gridSize: 5,
      seed: "low-density",
      candidates: [
        { id: "first", displayAnswer: "가나다" },
        { id: "second", displayAnswer: "라나마" },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      puzzle: { report: { publishable: true, issues: [], warnings: [{ code: "DENSITY_BELOW_THRESHOLD" }] } },
    });
  });

  it("탐색 예산 소진을 불가능 판정과 구분한다", () => {
    const result = generatePuzzle({
      ...PUZZLE_FIXTURES.fiveByFive,
      searchBudget: 1,
    });

    expect(result).toMatchObject({
      ok: false,
      publishable: false,
      reasons: [{ code: "SEARCH_BUDGET_EXCEEDED" }],
    });
  });
});

describe("public/private serialization 경계", () => {
  it("public JSON에 정답 음절·표시형·private solution을 포함하지 않는다", () => {
    const result = generatePuzzle(PUZZLE_FIXTURES.fiveByFive);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const publicGrid = serializePublicPuzzle(result.puzzle);
    const serialized = JSON.stringify(publicGrid);
    const forbiddenKeys = ["solution", "gridAnswer", "displayAnswer", "syllable"];
    for (const forbiddenKey of forbiddenKeys) {
      expect(serialized).not.toContain(`"${forbiddenKey}"`);
    }
    for (const answer of Object.values(result.puzzle.solution.entries)) {
      expect(serialized).not.toContain(answer);
    }
    expect(publicGrid.cells.every((cell) => !("answer" in cell))).toBe(true);
    expect(publicGrid.entries.every((entry) => !("answer" in entry))).toBe(true);
  });
});
