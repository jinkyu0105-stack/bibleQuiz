import { describe, expect, it } from "vitest";

import { PUZZLE_FIXTURES } from "../../shared/puzzle/fixtures";
import { generatePuzzle } from "../../shared/puzzle/generator";
import { serializePublicPuzzle } from "../../shared/puzzle/serialization";
import {
  InvalidScoringSource,
  scoreSubmission,
  type ScoringSource,
} from "../_shared/services/submission-scoring";

function source(): ScoringSource {
  const generated = generatePuzzle(PUZZLE_FIXTURES.fiveByFive);
  if (!generated.ok) throw new Error("Expected publishable scoring fixture");
  const grid = serializePublicPuzzle(generated.puzzle);
  return {
    canonicalCellOrder: grid.cells.map((cell) => cell.id),
    grid,
    solution: generated.puzzle.solution,
  };
}

describe("server-only submission scoring", () => {
  it("counts every crossing once and scores a full answer entirely on the server", () => {
    const scoringSource = source();
    const score = scoreSubmission(scoringSource, scoringSource.solution.cells);

    expect(score).toEqual({
      answers: scoringSource.solution.cells,
      correctCells: scoringSource.canonicalCellOrder.length,
      totalCells: scoringSource.canonicalCellOrder.length,
      correctWords: scoringSource.grid.entries.length,
      totalWords: scoringSource.grid.entries.length,
      scoreBasisPoints: 10_000,
      correctnessMask: "1".repeat(scoringSource.canonicalCellOrder.length),
      isFullyCorrect: true,
    });
    expect(score.totalCells).toBeLessThan(
      scoringSource.grid.entries.reduce((sum, entry) => sum + entry.length, 0),
    );
  });

  it("allows a one-cell partial answer, treats missing cells as wrong and rounds basis points", () => {
    const scoringSource = source();
    const firstId = scoringSource.canonicalCellOrder[0];
    if (firstId === undefined) throw new Error("Expected at least one active cell");

    const score = scoreSubmission(scoringSource, {
      [firstId]: scoringSource.solution.cells[firstId] as string,
    });

    expect(score.answers).toEqual({ [firstId]: scoringSource.solution.cells[firstId] });
    expect(score.correctCells).toBe(1);
    expect(score.correctWords).toBe(0);
    expect(score.scoreBasisPoints).toBe(
      Math.round(10_000 / scoringSource.canonicalCellOrder.length),
    );
    expect(score.correctnessMask).toBe(
      `1${"0".repeat(scoringSource.canonicalCellOrder.length - 1)}`,
    );
    expect(score.isFullyCorrect).toBe(false);
  });

  it("normalizes a decomposed Hangul answer before comparison and storage", () => {
    const scoringSource = source();
    const firstId = scoringSource.canonicalCellOrder[0];
    if (firstId === undefined) throw new Error("Expected at least one active cell");
    const answer = scoringSource.solution.cells[firstId];
    if (answer === undefined) throw new Error("Expected a private solution cell");

    expect(scoreSubmission(scoringSource, { [firstId]: answer.normalize("NFD") }).answers)
      .toEqual({ [firstId]: answer });
  });

  it.each([
    ["EMPTY_SUBMISSION", {}],
    ["INVALID_GRID_SHAPE", { r9c9: "가" }],
    ["INVALID_HANGUL_SYLLABLE", { r0c0: "ㄱ" }],
    ["INVALID_HANGUL_SYLLABLE", { r0c0: "가나" }],
    ["INVALID_HANGUL_SYLLABLE", { r0c0: "" }],
  ])("rejects %s without producing a score", (code, cells) => {
    expect(() => scoreSubmission(source(), cells)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("fails closed when canonical order, public geometry and private solution disagree", () => {
    const scoringSource = source();
    expect(() => scoreSubmission({
      ...scoringSource,
      canonicalCellOrder: scoringSource.canonicalCellOrder.slice(1),
    }, { r0c0: "가" })).toThrowError(InvalidScoringSource);

    const firstEntry = scoringSource.grid.entries[0];
    if (firstEntry === undefined) throw new Error("Expected a private solution entry");
    expect(() => scoreSubmission({
      ...scoringSource,
      solution: {
        ...scoringSource.solution,
        entries: { ...scoringSource.solution.entries, [firstEntry.id]: "가나다" },
      },
    }, { r0c0: "가" })).toThrowError(InvalidScoringSource);
  });
});
