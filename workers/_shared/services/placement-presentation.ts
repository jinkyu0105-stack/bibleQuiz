import { adminPlacementLayoutSchema } from "../../../shared/api/admin-placement";
import type { PoolLayout } from "../../../shared/puzzle/pool-search";
import { serializePublicPuzzle } from "../../../shared/puzzle/serialization";
export function presentPlacement(layout: PoolLayout, index: number, candidates: readonly { id: string; displayAnswer: string; phrase: string }[]) {
  const candidate = (id: string) => { const value = candidates.find(c => c.id === id); if (!value) throw new Error("PLACEMENT_INVALID"); return value; };
  return adminPlacementLayoutSchema.parse({ index, grid: serializePublicPuzzle(layout.puzzle), solution: layout.puzzle.solution,
    wordCount: layout.puzzle.report.wordCount, activeCellCount: layout.puzzle.report.activeCellCount,
    crossingCellCount: layout.puzzle.report.crossingCellCount, multiCrossingWordCount: layout.puzzle.report.multiCrossingWordCount,
    warnings: (layout.puzzle.report.warnings ?? []).map(warning => warning.message),
    omitted: layout.omittedCandidateIds.map(id => candidate(id).displayAnswer), excluded: layout.excludedCandidateIds.map(id => candidate(id).displayAnswer),
    words: layout.puzzle.report.words.map(word => ({ id: word.entryId, answer: candidate(word.entryId).displayAnswer,
      phrase: candidate(word.entryId).phrase, crossings: word.crossingCount })) });
}
