export const MIN_GRID_SIZE = 5;
export const MAX_GRID_SIZE = 10;

export type Direction = "across" | "down";

export interface Coordinate {
  row: number;
  column: number;
}

export interface PuzzleCandidateInput {
  id: string;
  displayAnswer: string;
  gridAnswer?: string;
  clue?: string;
}

export interface NormalizedPuzzleCandidate {
  id: string;
  displayAnswer: string;
  gridAnswer: string;
  syllables: readonly string[];
  clue?: string;
}

export type AnswerValidationIssueCode =
  | "EMPTY_ANSWER"
  | "INVALID_HANGUL_SYLLABLE"
  | "WORD_TOO_SHORT"
  | "WORD_TOO_LONG"
  | "GRID_ANSWER_MISMATCH";

export interface AnswerValidationIssue {
  code: AnswerValidationIssueCode;
  message: string;
  field: "displayAnswer" | "gridAnswer";
  value: string;
  index?: number;
  maximum?: number;
  minimum?: number;
}

export type AnswerValidationResult =
  | { ok: true; value: NormalizedPuzzleCandidate }
  | { ok: false; issues: readonly AnswerValidationIssue[] };

export interface EntryPlacement {
  entryId: string;
  gridAnswer: string;
  start: Coordinate;
  direction: Direction;
}

export interface NumberedEntryPlacement extends EntryPlacement {
  number: number;
  length: number;
  crossings: readonly Coordinate[];
}

export interface PrivatePuzzleEntry extends NumberedEntryPlacement {
  displayAnswer: string;
  clue?: string;
}

export interface PrivateSolution {
  cells: Readonly<Record<string, string>>;
  entries: Readonly<Record<string, string>>;
}

export interface PublicPuzzleCell {
  id: string;
  row: number;
  column: number;
  number?: number;
}

export interface PublicPuzzleEntry {
  id: string;
  number: number;
  direction: Direction;
  start: Coordinate;
  length: number;
  clue?: string;
}

export interface PublicPuzzleGrid {
  gridSize: number;
  cells: readonly PublicPuzzleCell[];
  entries: readonly PublicPuzzleEntry[];
}

export interface WordQualityReport {
  entryId: string;
  length: number;
  crossingCount: number;
  connected: boolean;
}

export interface PuzzleQualityReport {
  publishable: boolean;
  gridSize: number;
  wordCount: number;
  acrossWordCount: number;
  downWordCount: number;
  activeCellCount: number;
  crossingCellCount: number;
  crossingCellDensity: number;
  theoreticalCrossingMaximum: number;
  theoreticalCrossingDensity: number;
  multiCrossingWordCount: number;
  requiredMultiCrossingWordCount: number;
  boundingBox: {
    top: number;
    left: number;
    bottom: number;
    right: number;
    area: number;
  } | null;
  fillDensity: number;
  connectedComponentCount: number;
  words: readonly WordQualityReport[];
  issues: readonly LayoutValidationIssue[];
  warnings?: readonly LayoutValidationIssue[];
}

export interface PrivatePuzzle {
  gridSize: number;
  seed: string;
  entries: readonly PrivatePuzzleEntry[];
  solution: PrivateSolution;
  report: PuzzleQualityReport;
}

export type LayoutValidationIssueCode =
  | "INVALID_GRID_SIZE"
  | "EMPTY_ENTRY_SET"
  | "OUT_OF_BOUNDS"
  | "LETTER_CONFLICT"
  | "SAME_DIRECTION_OVERLAP"
  | "UNINTENDED_ADJACENCY"
  | "DUPLICATE_PLACEMENT"
  | "DISCONNECTED"
  | "WORD_WITHOUT_CROSSING"
  | "DENSITY_BELOW_THRESHOLD";

export interface LayoutValidationIssue {
  code: LayoutValidationIssueCode;
  message: string;
  entryIds?: readonly string[];
  cell?: Coordinate;
}

export type PuzzleFailureCode =
  | "INVALID_GRID_SIZE"
  | "INVALID_ANSWER"
  | "DUPLICATE_ID"
  | "DUPLICATE_ANSWER"
  | "WORD_TOO_LONG"
  | "NO_SHARED_SYLLABLE"
  | "DISCONNECTED_CANDIDATES"
  | "GRID_TOO_SMALL"
  | "DENSITY_BELOW_THRESHOLD"
  | "PLACEMENT_NOT_FOUND"
  | "SEARCH_BUDGET_EXCEEDED";

export interface PuzzleFailureReason {
  code: PuzzleFailureCode;
  message: string;
  entryIds?: readonly string[];
  details?: Readonly<Record<string, number | string | readonly string[]>>;
}

export interface PuzzleGenerationOptions {
  gridSize: number;
  seed: string | number;
  candidates: readonly PuzzleCandidateInput[];
  searchBudget?: number;
}

export interface PuzzleGenerationSuccess {
  ok: true;
  puzzle: PrivatePuzzle;
}

export interface PuzzleGenerationFailure {
  ok: false;
  publishable: false;
  reasons: readonly PuzzleFailureReason[];
  bestReport?: PuzzleQualityReport;
}

export type PuzzleGenerationResult =
  | PuzzleGenerationSuccess
  | PuzzleGenerationFailure;
