import { candidateGraphComponents, generatePuzzle } from "./generator";
import { validateAndNormalizeAnswer } from "./hangul";
import { isGridSize } from "./layout";
import type { PrivatePuzzle, PuzzleCandidateInput, PuzzleFailureReason } from "./types";

export interface PoolCandidate extends PuzzleCandidateInput { status: "use" | "locked" | "excluded" }
export interface PoolSearchOptions {
  candidates: readonly PoolCandidate[];
  gridSizes: readonly number[];
  targetWordCounts: readonly number[];
  seed: string;
  maxTrials: number;
  searchBudgetPerTrial: number;
}
export interface PoolSearchAttempt {
  gridSize: number;
  targetWordCount: number;
  candidateIds: readonly string[];
  reasons: readonly PuzzleFailureReason[];
}
export interface PoolLayout {
  targetWordCount: number;
  puzzle: PrivatePuzzle;
  omittedCandidateIds: readonly string[];
  excludedCandidateIds: readonly string[];
}
export interface PoolSearchResult {
  layouts: readonly PoolLayout[];
  attempts: readonly PoolSearchAttempt[];
  searchIncomplete: boolean;
}

// Yield combinations lazily: the trial budget also bounds subset enumeration.
function* combinations<T>(values: readonly T[], count: number, start = 0, prefix: readonly T[] = []): Generator<readonly T[]> {
  if (count === 0) { yield prefix; return; }
  for (let i = start; i <= values.length - count; i++) {
    yield* combinations(values, count - 1, i + 1, [...prefix, values[i]!]);
  }
}
function symmetry(puzzle: PrivatePuzzle) {
  const b = puzzle.report.boundingBox!;
  return Math.abs(b.top - (puzzle.gridSize - 1 - b.bottom)) + Math.abs(b.left - (puzzle.gridSize - 1 - b.right));
}
function compareLayouts(a: PoolLayout, b: PoolLayout) {
  return a.puzzle.gridSize - b.puzzle.gridSize ||
    b.puzzle.report.crossingCellCount - a.puzzle.report.crossingCellCount ||
    b.puzzle.report.multiCrossingWordCount - a.puzzle.report.multiCrossingWordCount ||
    a.puzzle.report.boundingBox!.area - b.puzzle.report.boundingBox!.area ||
    symmetry(a.puzzle) - symmetry(b.puzzle);
}

/** Existing fixed-set solver stays unchanged. Only caller-approved sizes/counts are tried. */
export function searchCandidatePool(options: PoolSearchOptions): PoolSearchResult {
  if (!options.gridSizes.length || !options.targetWordCounts.length ||
    options.gridSizes.some((s) => !isGridSize(s)) || options.targetWordCounts.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 100) ||
    !Number.isSafeInteger(options.maxTrials) || options.maxTrials < 1 || options.maxTrials > 256 ||
    !Number.isSafeInteger(options.searchBudgetPerTrial) || options.searchBudgetPerTrial < 1 || options.searchBudgetPerTrial > 300_000 ||
    options.maxTrials * options.searchBudgetPerTrial > 3_000_000) throw new Error("Invalid pool search options");
  const ids = new Set<string>(), answers = new Set<string>();
  const candidates = options.candidates.filter((c) => c.status !== "excluded").map((c) => {
    const result = validateAndNormalizeAnswer(c, 10);
    if (!result.ok || ids.has(c.id) || answers.has(result.value.gridAnswer) || !["use", "locked"].includes(c.status)) {
      throw new Error("Invalid pool candidates");
    }
    ids.add(c.id); answers.add(result.value.gridAnswer);
    return { ...result.value, status: c.status };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const excludedCandidateIds = options.candidates.filter((c) => c.status === "excluded").map((c) => c.id).sort();
  const locked = candidates.filter((c) => c.status === "locked");
  const attempts: PoolSearchAttempt[] = [], layouts: PoolLayout[] = [];
  const queues: { gridSize: number; targetWordCount: number; subsets: Generator<readonly typeof candidates[number][]> }[] = [];
  for (const gridSize of [...new Set(options.gridSizes)].sort((a, b) => a - b)) {
    for (const targetWordCount of [...new Set(options.targetWordCounts)].sort((a, b) => a - b)) {
      const optional = candidates.filter((c) => c.status === "use" && c.syllables.length <= gridSize);
      const tooLong = locked.filter((c) => c.syllables.length > gridSize);
      if (tooLong.length || locked.length > targetWordCount || locked.length + optional.length < targetWordCount) {
        attempts.push({ gridSize, targetWordCount, candidateIds: locked.map((c) => c.id), reasons: [{
          code: tooLong.length ? "WORD_TOO_LONG" : "PLACEMENT_NOT_FOUND",
          message: tooLong.length ? "잠금 후보가 선택 격자보다 깁니다." : "목표 개수가 잠금·사용 후보 수와 맞지 않습니다.",
          entryIds: locked.map((c) => c.id),
        }] });
      } else {
        // Disconnected components can never form one crossword. Reuse the
        // solver's graph check before spending a bounded placement attempt.
        const components = candidateGraphComponents([...locked, ...optional]);
        const eligible = components.filter(ids => ids.length >= targetWordCount && locked.every(c => ids.includes(c.id)));
        for (const ids of eligible) queues.push({ gridSize, targetWordCount,
          subsets: combinations(optional.filter(c => ids.includes(c.id)), targetWordCount - locked.length) });
        if (!eligible.length) attempts.push({ gridSize, targetWordCount, candidateIds: locked.map(c => c.id),
          reasons: [{ code: "DISCONNECTED_CANDIDATES", message: "연결 가능한 후보가 목표 개수보다 적거나 잠금 후보가 분리되어 있습니다.", entryIds: locked.map(c => c.id) }] });
      }
    }
  }
  let trials = 0, searchIncomplete = false;
  // Round-robin prevents a large small-grid subset space from starving other approved sizes.
  while (queues.length && trials < options.maxTrials) {
    for (let i = 0; i < queues.length && trials < options.maxTrials;) {
      const queue = queues[i]!;
      const next = queue.subsets.next();
      if (next.done) { queues.splice(i, 1); continue; }
      const subset = [...locked, ...next.value];
      const result = generatePuzzle({ gridSize: queue.gridSize, seed: options.seed, candidates: subset,
        searchBudget: options.searchBudgetPerTrial });
      trials++;
      attempts.push({ gridSize: queue.gridSize, targetWordCount: queue.targetWordCount,
        candidateIds: subset.map((c) => c.id), reasons: result.ok ? [] : result.reasons });
      if (result.ok) {
        const placed = new Set(result.puzzle.entries.map((e) => e.entryId));
        layouts.push({ targetWordCount: queue.targetWordCount, puzzle: result.puzzle,
          omittedCandidateIds: candidates.filter((c) => !placed.has(c.id)).map((c) => c.id), excludedCandidateIds });
      } else if (result.reasons.some((r) => r.code === "SEARCH_BUDGET_EXCEEDED")) searchIncomplete = true;
      i++;
    }
  }
  // One lookahead distinguishes a fully exhausted combination space from a budget cutoff.
  if (queues.some((q) => !q.subsets.next().done)) searchIncomplete = true;
  layouts.sort(compareLayouts);
  return { layouts: layouts.slice(0, 3), attempts, searchIncomplete };
}
