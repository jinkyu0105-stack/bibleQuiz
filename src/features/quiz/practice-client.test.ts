import { afterEach, describe, expect, it, vi } from "vitest";

import { publicResponse } from "../../../tests/fixtures/public-response";
import { checkPracticeAnswers, type PracticeCheckTarget } from "./practice-client";

afterEach(() => vi.unstubAllGlobals());

function target(): PracticeCheckTarget {
  const quiz = publicResponse().data.quiz!;
  return {
    difficulty: quiz.variant.difficulty,
    grid: quiz.variant.grid,
    quizRevision: quiz.variant.revision,
    quizVariantId: quiz.variant.id,
    slug: quiz.slug,
  };
}

function data(current = target(), cells: Readonly<Record<string, string>> = { r0c0: "가" }) {
  const solutionCells = Object.fromEntries(current.grid.cells.map((cell) => [cell.id, "가"]));
  const correctCells = current.grid.cells.filter((cell) => cells[cell.id] === "가").length;
  const correctWords = current.grid.entries.filter((entry) => {
    const ids = Array.from({ length: entry.length }, (_, offset) => {
      const row = entry.start.row + (entry.direction === "down" ? offset : 0);
      const column = entry.start.column + (entry.direction === "across" ? offset : 0);
      return `r${row}c${column}`;
    });
    return ids.every((id) => cells[id] === "가");
  }).length;
  return {
    quizVariantId: current.quizVariantId,
    quizRevision: current.quizRevision,
    correctCells,
    totalCells: current.grid.cells.length,
    correctWords,
    totalWords: current.grid.entries.length,
    scoreBasisPoints: Math.round((correctCells / current.grid.cells.length) * 10_000),
    correctnessMask: `${"1".repeat(correctCells)}${"0".repeat(current.grid.cells.length - correctCells)}`,
    solution: {
      cells: solutionCells,
      entries: Object.fromEntries(current.grid.entries.map((entry) => [entry.id, "가".repeat(entry.length)])),
    },
  };
}

describe("archived practice client", () => {
  it("posts only revision and sparse cells with same-origin credentials and no cache", async () => {
    const current = target();
    const answers = { r0c0: "가" };
    const result = data(current, answers);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: result }));
    vi.stubGlobal("fetch", fetcher);

    await expect(checkPracticeAnswers(current, answers)).resolves.toEqual({ ok: true, data: result });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/quizzes/2026-08-31-test01/child/practice/check",
      expect.objectContaining({
        body: JSON.stringify({ revision: 1, cells: answers }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "POST",
      }),
    );
  });

  it("rejects empty input and mismatched target, geometry, score, answer, or private fields", async () => {
    const current = target();
    await expect(checkPracticeAnswers(current, {})).resolves.toMatchObject({
      ok: false,
      error: { code: "CLIENT_UNAVAILABLE" },
    });

    const valid = data(current);
    const invalid = [
      { ...valid, quizVariantId: "other" },
      { ...valid, quizRevision: 2 },
      { ...valid, correctCells: 2, scoreBasisPoints: Math.round(20_000 / current.grid.cells.length), correctnessMask: `11${"0".repeat(current.grid.cells.length - 2)}` },
      { ...valid, solution: { ...valid.solution, cells: { ...valid.solution.cells, r9c9: "가" } } },
      { ...valid, sessionHash: "PRIVATE_CANARY" },
    ];
    for (const responseData of invalid) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: responseData })));
      const result = await checkPracticeAnswers(current, { r0c0: "가" });
      expect(result).toMatchObject({ ok: false, error: { code: "CLIENT_UNAVAILABLE" } });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
    }
  });

  it("keeps strict public errors and hides arbitrary upstream contents", async () => {
    const current = target();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: {
        code: "PRACTICE_CHECK_UNAVAILABLE",
        message: "답안을 채점하지 못했습니다.",
        requestId: "123e4567-e89b-42d3-a456-426614174000",
      },
    }, { status: 503 })));
    await expect(checkPracticeAnswers(current, { r0c0: "가" })).resolves.toMatchObject({
      ok: false,
      error: { code: "PRACTICE_CHECK_UNAVAILABLE", requestId: "123e4567-e89b-42d3-a456-426614174000" },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("PRIVATE_CANARY", { status: 503 })));
    const malformed = await checkPracticeAnswers(current, { r0c0: "가" });
    expect(malformed).toMatchObject({ ok: false, error: { code: "CLIENT_UNAVAILABLE" } });
    expect(JSON.stringify(malformed)).not.toContain("PRIVATE_CANARY");
  });
});
