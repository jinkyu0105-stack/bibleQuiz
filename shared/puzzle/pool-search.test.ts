import { describe, expect, it } from "vitest";
import { searchCandidatePool, type PoolSearchOptions } from "./pool-search";
import { validateLayout } from "./layout";

const base: PoolSearchOptions = {
  candidates: ["가나다", "라마바", "가사라", "다아바"].map((displayAnswer, i) => ({ id: `c${i}`, displayAnswer, clue: `단서 ${i}`, status: "use" })),
  gridSizes: [5], targetWordCounts: [4], seed: "pool-test", maxTrials: 16, searchBudgetPerTrial: 3000,
};
describe("reviewed pool subset search", () => {
  it("includes locked, omits optional disconnected words and ignores excluded answers", () => {
    const options: PoolSearchOptions = { ...base, candidates: [
      ...base.candidates.map((c, i) => ({ ...c, status: i === 0 ? "locked" as const : c.status })),
      { id: "a-no-crossing", displayAnswer: "허호", status: "use" },
      { id: "excluded", displayAnswer: "DO_NOT_VALIDATE_OR_PLACE", status: "excluded" },
    ] };
    const result = searchCandidatePool(options);
    expect(result.layouts.length).toBeGreaterThan(0);
    for (const layout of result.layouts) {
      expect(layout.puzzle.entries.map((e) => e.entryId)).toContain("c0");
      expect(layout.omittedCandidateIds).toEqual(["a-no-crossing"]);
      expect(layout.excludedCandidateIds).toEqual(["excluded"]);
      expect(validateLayout(5, layout.puzzle.entries).publishable).toBe(true);
    }
    expect(result.attempts.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).toBe(JSON.stringify(searchCandidatePool(options)));
  });
  it("compares actual approved sizes and target counts, preferring the smallest valid grid", () => {
    const result = searchCandidatePool({ ...base, gridSizes: [10, 8, 6, 9, 7, 5], targetWordCounts: [3, 4] });
    expect(new Set(result.attempts.map((a) => a.gridSize))).toEqual(new Set([5, 6, 7, 8, 9, 10]));
    expect(new Set(result.attempts.map((a) => a.targetWordCount))).toEqual(new Set([3, 4]));
    expect(result.layouts[0]?.puzzle.gridSize).toBe(5);
    expect(result.layouts[0]?.puzzle.report.wordCount).toBe(4);
    expect(result.layouts.every((l) => l.targetWordCount === l.puzzle.report.wordCount)).toBe(true);
  });
  it("places a long locked phrase only in an explicitly permitted larger grid", () => {
    const result = searchCandidatePool({ ...base, gridSizes: [5, 6], candidates:
      ["가나다라마바", "사아자차카타", "가하사", "바허타"].map((displayAnswer, i) => ({
        id: `long-${i}`, displayAnswer, status: i === 0 ? "locked" : "use",
      })) });
    expect(result.attempts[0]).toMatchObject({ gridSize: 5, reasons: [{ code: "WORD_TOO_LONG" }] });
    expect(result.layouts[0]?.puzzle.gridSize).toBe(6);
    expect(result.layouts[0]?.puzzle.entries.map((e) => e.entryId)).toContain("long-0");
  });
  it("never drops impossible locks or grows a fixed requested grid", () => {
    const result = searchCandidatePool({ ...base, candidates: [...base.candidates,
      { id: "long", displayAnswer: "가나다라마바", status: "locked" }] });
    expect(result.layouts).toEqual([]);
    expect(result.attempts).toMatchObject([{ gridSize: 5, reasons: [{ code: "WORD_TOO_LONG" }] }]);
    const tooMany = searchCandidatePool({ ...base, targetWordCounts: [3], candidates: base.candidates.map((c) => ({ ...c, status: "locked" })) });
    expect(tooMany.layouts).toEqual([]);
  });
  it("distinguishes incomplete searches from impossible candidate constraints", () => {
    const result = searchCandidatePool({ ...base, maxTrials: 1, searchBudgetPerTrial: 1, gridSizes: [5, 6] });
    expect(result.layouts).toEqual([]);
    expect(result.searchIncomplete).toBe(true);
    expect(result.attempts[0]?.reasons[0]?.code).toBe("SEARCH_BUDGET_EXCEEDED");
    expect(searchCandidatePool({ ...base, candidates: [] }).searchIncomplete).toBe(false);
  });
  it("rejects malformed or unbounded configuration", () => {
    for (const patch of [{ gridSizes: [4] }, { targetWordCounts: [0] }, { maxTrials: 0 },
      { searchBudgetPerTrial: NaN }, { maxTrials: 256, searchBudgetPerTrial: 300_000 }]) {
      expect(() => searchCandidatePool({ ...base, ...patch })).toThrow();
    }
  });
  it("does not exhaust the placement budget on leading disconnected optional words", () => {
    const isolated = ["허호", "누너", "더도", "두드", "머모", "무므", "버보", "부브"]
      .map((displayAnswer, i) => ({ id: `a${i}`, displayAnswer, status: "use" as const }));
    const result = searchCandidatePool({ ...base, maxTrials: 1, candidates: [...isolated, ...base.candidates] });
    expect(result.layouts).toHaveLength(1);
    expect(result.layouts[0]?.omittedCandidateIds).toEqual(isolated.map(c => c.id));
    expect(result.layouts[0]?.puzzle.report.wordCount).toBe(4);
    const locked = searchCandidatePool({ ...base, candidates: [...base.candidates, { ...isolated[0]!, status: "locked" }] });
    expect(locked.layouts).toHaveLength(0);
    expect(locked.searchIncomplete).toBe(false);
  });
});
