import { afterEach, describe, expect, it, vi } from "vitest";

import { publicResponse } from "../../../tests/fixtures/public-response";
import { readQuizSolution, type SolutionTarget } from "./solution-client";

afterEach(() => vi.unstubAllGlobals());

function target(): SolutionTarget {
  const quiz = publicResponse().data.quiz!;
  return {
    difficulty: quiz.variant.difficulty,
    grid: quiz.variant.grid,
    quizRevision: quiz.variant.revision,
    quizVariantId: quiz.variant.id,
    slug: quiz.slug,
  };
}

function solutionData(current = target()) {
  const cells = Object.fromEntries(current.grid.cells.map((cell) => [cell.id, "가"]));
  return {
    quizVariantId: current.quizVariantId,
    quizRevision: current.quizRevision,
    solution: {
      cells,
      entries: Object.fromEntries(current.grid.entries.map((entry) => [entry.id, "가".repeat(entry.length)])),
    },
  };
}

describe("public solution client", () => {
  it("reads the exact strict solution with same-origin credentials and no cache", async () => {
    const current = target();
    const data = solutionData(current);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data }));
    vi.stubGlobal("fetch", fetcher);

    await expect(readQuizSolution(current)).resolves.toEqual({ ok: true, data });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/quizzes/2026-08-31-test01/child/solution",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "GET",
      }),
    );
  });

  it("rejects variant, revision, geometry, entry, and private-field mismatches", async () => {
    const current = target();
    const valid = solutionData(current);
    const invalid = [
      { ...valid, quizVariantId: "other-variant" },
      { ...valid, quizRevision: 2 },
      { ...valid, solution: { ...valid.solution, cells: { ...valid.solution.cells, r9c9: "가" } } },
      { ...valid, solution: { ...valid.solution, entries: { ...valid.solution.entries, [current.grid.entries[0]!.id]: "나".repeat(current.grid.entries[0]!.length) } } },
      { ...valid, canonicalCellOrder: ["PRIVATE_CANARY"] },
    ];
    for (const data of invalid) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data })));
      const result = await readQuizSolution(current);
      expect(result).toMatchObject({ ok: false, error: { code: "CLIENT_UNAVAILABLE" } });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
    }
  });

  it("keeps only strict public errors and hides arbitrary upstream contents", async () => {
    const current = target();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: {
        code: "SUBMISSION_REQUIRED",
        message: "답안을 제출한 후 정답을 볼 수 있습니다.",
        requestId: "123e4567-e89b-42d3-a456-426614174000",
      },
    }, { status: 403 })));
    await expect(readQuizSolution(current)).resolves.toMatchObject({
      ok: false,
      error: { code: "SUBMISSION_REQUIRED", requestId: "123e4567-e89b-42d3-a456-426614174000" },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("PRIVATE_CANARY", { status: 503 })));
    const malformed = await readQuizSolution(current);
    expect(malformed).toMatchObject({ ok: false, error: { code: "CLIENT_UNAVAILABLE" } });
    expect(JSON.stringify(malformed)).not.toContain("PRIVATE_CANARY");
  });
});
