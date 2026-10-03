import { describe, expect, it } from "vitest";

import { quizSolutionDataSchema, revealedSolutionSchema } from "./solution";

const solution = {
  cells: { r0c0: "믿", r0c1: "음" },
  entries: { "entry-across-1": "믿음" },
};

describe("revealed solution API contract", () => {
  it("accepts only the minimal public answer fields", () => {
    expect(quizSolutionDataSchema.parse({
      quizVariantId: "variant-child-1",
      quizRevision: 2,
      solution,
    })).toEqual({
      quizVariantId: "variant-child-1",
      quizRevision: 2,
      solution,
    });

    expect(quizSolutionDataSchema.safeParse({
      quizVariantId: "variant-child-1",
      quizRevision: 2,
      solution,
      canonicalCellOrder: ["r0c0", "r0c1"],
    }).success).toBe(false);
    expect(quizSolutionDataSchema.safeParse({
      quizVariantId: "variant-child-1",
      quizRevision: 2,
      solution: { ...solution, solutionSha256: "a".repeat(64) },
    }).success).toBe(false);
  });

  it("rejects empty, oversized, non-Hangul, and extra solution data", () => {
    expect(revealedSolutionSchema.safeParse({ cells: {}, entries: {} }).success).toBe(false);
    expect(revealedSolutionSchema.safeParse({
      cells: { r0c0: "a" },
      entries: { "entry-across-1": "a" },
    }).success).toBe(false);
    expect(revealedSolutionSchema.safeParse({
      ...solution,
      checksum: "private",
    }).success).toBe(false);
    expect(revealedSolutionSchema.safeParse({
      cells: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`r${index}c0`, "가"])),
      entries: solution.entries,
    }).success).toBe(false);
  });
});
