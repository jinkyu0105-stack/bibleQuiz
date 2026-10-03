import {
  isCompleteHangulSyllable,
  toGridAnswer,
} from "../../../shared/puzzle/hangul";
import type { PrivateSolution, PublicPuzzleGrid } from "../../../shared/puzzle/types";

export type SubmissionValidationCode =
  | "EMPTY_SUBMISSION"
  | "INVALID_GRID_SHAPE"
  | "INVALID_HANGUL_SYLLABLE";

export class InvalidSubmission extends Error {
  constructor(readonly code: SubmissionValidationCode) {
    super(code);
  }
}

export class InvalidScoringSource extends Error {
  constructor() {
    super("INVALID_SCORING_SOURCE");
  }
}

export interface ScoringSource {
  canonicalCellOrder: readonly string[];
  grid: PublicPuzzleGrid;
  solution: PrivateSolution;
}

export interface SubmissionScore {
  answers: Readonly<Record<string, string>>;
  correctCells: number;
  totalCells: number;
  correctWords: number;
  totalWords: number;
  scoreBasisPoints: number;
  correctnessMask: string;
  isFullyCorrect: boolean;
}

function entryCellIds(
  entry: PublicPuzzleGrid["entries"][number],
): string[] {
  return Array.from({ length: entry.length }, (_, offset) => {
    const row = entry.start.row + (entry.direction === "down" ? offset : 0);
    const column = entry.start.column + (entry.direction === "across" ? offset : 0);
    return `r${row}c${column}`;
  });
}

export function validateScoringSource(source: ScoringSource): void {
  const canonical = source.canonicalCellOrder;
  const canonicalSet = new Set(canonical);
  const gridCellIds = source.grid.cells.map((cell) => cell.id);
  const solutionCellIds = Object.keys(source.solution.cells);
  const gridEntryIds = source.grid.entries.map((entry) => entry.id);
  const solutionEntryIds = Object.keys(source.solution.entries);

  if (
    canonical.length === 0 ||
    canonical.length > 100 ||
    canonicalSet.size !== canonical.length ||
    gridCellIds.length !== canonical.length ||
    solutionCellIds.length !== canonical.length ||
    gridEntryIds.length === 0 ||
    gridEntryIds.length > 100 ||
    new Set(gridCellIds).size !== gridCellIds.length ||
    new Set(gridEntryIds).size !== gridEntryIds.length ||
    gridCellIds.some((id) => !canonicalSet.has(id)) ||
    solutionCellIds.some((id) => !canonicalSet.has(id)) ||
    solutionEntryIds.length !== gridEntryIds.length ||
    solutionEntryIds.some((id) => !gridEntryIds.includes(id))
  ) {
    throw new InvalidScoringSource();
  }

  for (const id of canonical) {
    const answer = source.solution.cells[id];
    if (answer === undefined || !isCompleteHangulSyllable(answer)) {
      throw new InvalidScoringSource();
    }
  }
  for (const entry of source.grid.entries) {
    const answer = source.solution.entries[entry.id];
    const cells = entryCellIds(entry);
    if (
      answer === undefined ||
      answer.length === 0 ||
      cells.some((id) => !canonicalSet.has(id)) ||
      toGridAnswer(answer) !== cells.map((id) => source.solution.cells[id]).join("")
    ) {
      throw new InvalidScoringSource();
    }
  }
}

export function scoreSubmission(
  source: ScoringSource,
  submittedCells: Readonly<Record<string, string>>,
): SubmissionScore {
  validateScoringSource(source);
  const activeCells = new Set(source.canonicalCellOrder);
  const written = Object.entries(submittedCells);

  if (written.some(([id]) => !activeCells.has(id))) {
    throw new InvalidSubmission("INVALID_GRID_SHAPE");
  }
  if (written.length === 0) {
    throw new InvalidSubmission("EMPTY_SUBMISSION");
  }

  const normalized = new Map<string, string>();
  for (const [id, rawValue] of written) {
    if (typeof rawValue !== "string") {
      throw new InvalidSubmission("INVALID_HANGUL_SYLLABLE");
    }
    const value = rawValue.normalize("NFC");
    if (!isCompleteHangulSyllable(value)) {
      throw new InvalidSubmission("INVALID_HANGUL_SYLLABLE");
    }
    normalized.set(id, value);
  }

  const answers = Object.fromEntries(
    source.canonicalCellOrder.flatMap((id) => {
      const answer = normalized.get(id);
      return answer === undefined ? [] : [[id, answer]];
    }),
  );
  const correctness = source.canonicalCellOrder.map(
    (id) => normalized.get(id) === source.solution.cells[id],
  );
  const correctCells = correctness.filter(Boolean).length;
  const totalCells = source.canonicalCellOrder.length;
  const correctWords = source.grid.entries.filter((entry) =>
    entryCellIds(entry).every(
      (id) => normalized.get(id) === source.solution.cells[id],
    ),
  ).length;

  return {
    answers,
    correctCells,
    totalCells,
    correctWords,
    totalWords: source.grid.entries.length,
    scoreBasisPoints: Math.round((correctCells / totalCells) * 10_000),
    correctnessMask: correctness.map((isCorrect) => (isCorrect ? "1" : "0")).join(""),
    isFullyCorrect: correctCells === totalCells,
  };
}
