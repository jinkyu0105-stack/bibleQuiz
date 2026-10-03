import { describe, expect, it } from "vitest";
import { publicPuzzleGridSchema, quizSlugSchema } from "./public-quiz";
import { previewQuiz } from "../../src/features/quiz/preview-data";
import { generatePuzzle } from "../puzzle/generator";
import { PUZZLE_FIXTURES } from "../puzzle/fixtures";
import { serializePublicPuzzle } from "../puzzle/serialization";

describe("strict public geometry boundary", () => {
  it.each([5, 8, 10])("accepts connected %s geometry", (size) => {
    expect(publicPuzzleGridSchema.safeParse(previewQuiz("child", size).grid).success).toBe(true);
  });
  it("accepts the actual engine's public serialization", () => {
    const result = generatePuzzle(PUZZLE_FIXTURES.fiveByFive);
    expect(result.ok).toBe(true);
    if (result.ok) expect(publicPuzzleGridSchema.safeParse(serializePublicPuzzle(result.puzzle)).success).toBe(true);
  });
  it.each(["solution", "gridAnswer", "displayAnswer", "syllable"])("rejects injected %s at every level", (key) => {
    const grid = previewQuiz("child").grid;
    for (const value of [
      { ...grid, [key]: "PRIVATE_CANARY" },
      { ...grid, cells: grid.cells.map((cell) => ({ ...cell, [key]: "PRIVATE_CANARY" })) },
      { ...grid, entries: grid.entries.map((entry) => ({ ...entry, [key]: "PRIVATE_CANARY" })) },
    ]) expect(publicPuzzleGridSchema.safeParse(value).success).toBe(false);
  });
  it("rejects bounds, duplicate cells, numbering, missing paths and orphan cells", () => {
    const grid = previewQuiz("child").grid;
    for (const value of [
      { ...grid, gridSize: 4 },
      { ...grid, cells: [...grid.cells, grid.cells[0]] },
      { ...grid, cells: grid.cells.slice(1) },
      { ...grid, entries: grid.entries.slice(1) },
      { ...grid, entries: grid.entries.map((entry) => ({ ...entry, number: 99 })) },
      { ...grid, entries: grid.entries.map((entry) => ({ ...entry, length: 10 })) },
    ]) expect(publicPuzzleGridSchema.safeParse(value).success).toBe(false);
  });
  it("accepts a connected pair with real crossing when only recommended density is low", () => {
    expect(publicPuzzleGridSchema.safeParse({ gridSize: 5,
      cells: [{ id: "r0c0", row: 0, column: 0, number: 1 }, { id: "r0c1", row: 0, column: 1 }, { id: "r1c0", row: 1, column: 0 }],
      entries: ["across", "down"].map((direction) => ({ id: direction, number: 1, direction, start: { row: 0, column: 0 }, length: 2, clue: "시험 단서" })),
    }).success).toBe(true);
  });
  it("rejects arbitrary slugs", () => {
    expect(quizSlugSchema.safeParse("2026-08-31-test01").success).toBe(true);
    expect(quizSlugSchema.safeParse("../admin").success).toBe(false);
  });
});
