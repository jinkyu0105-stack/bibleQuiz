import { validateAndNormalizeAnswer } from "./hangul";
import { cellId, coordinateFor, isGridSize, validateLayout } from "./layout";
import {
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  type Direction,
  type EntryPlacement,
  type NormalizedPuzzleCandidate,
  type PrivatePuzzle,
  type PrivatePuzzleEntry,
  type PuzzleFailureReason,
  type PuzzleGenerationOptions,
  type PuzzleGenerationResult,
  type PuzzleQualityReport,
} from "./types";

const DEFAULT_SEARCH_BUDGET = 300_000;
const STRUCTURAL_ISSUES = new Set([
  "INVALID_GRID_SIZE",
  "OUT_OF_BOUNDS",
  "LETTER_CONFLICT",
  "SAME_DIRECTION_OVERLAP",
  "UNINTENDED_ADJACENCY",
  "DUPLICATE_PLACEMENT",
]);

interface OccupiedCell {
  syllable: string;
  directions: Set<Direction>;
}

interface CompleteLayout {
  placements: readonly EntryPlacement[];
  report: PuzzleQualityReport;
  tieBreaker: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function placementSignature(placements: readonly EntryPlacement[]): string {
  return [...placements]
    .sort((left, right) => compareText(left.entryId, right.entryId))
    .map(
      (placement) =>
        `${placement.entryId}:${placement.start.row}:${placement.start.column}:${placement.direction}`,
    )
    .join("|");
}

function boundingArea(placements: readonly EntryPlacement[]): number {
  if (placements.length === 0) {
    return 0;
  }
  const coordinates = placements.flatMap((placement) =>
    Array.from(placement.gridAnswer, (_, offset) => coordinateFor(placement, offset)),
  );
  const rows = coordinates.map((coordinate) => coordinate.row);
  const columns = coordinates.map((coordinate) => coordinate.column);
  return (
    (Math.max(...rows) - Math.min(...rows) + 1) *
    (Math.max(...columns) - Math.min(...columns) + 1)
  );
}

function symmetryPenalty(
  gridSize: number,
  report: PuzzleQualityReport,
): number {
  const bounds = report.boundingBox;
  if (bounds === null) {
    return Number.POSITIVE_INFINITY;
  }
  return (
    Math.abs(bounds.top - (gridSize - 1 - bounds.bottom)) +
    Math.abs(bounds.left - (gridSize - 1 - bounds.right))
  );
}

function isBetterLayout(
  candidate: CompleteLayout,
  current: CompleteLayout | undefined,
  gridSize: number,
): boolean {
  if (current === undefined) {
    return true;
  }
  if (candidate.report.publishable !== current.report.publishable) {
    return candidate.report.publishable;
  }
  if (candidate.report.crossingCellCount !== current.report.crossingCellCount) {
    return candidate.report.crossingCellCount > current.report.crossingCellCount;
  }
  if (
    candidate.report.multiCrossingWordCount !==
    current.report.multiCrossingWordCount
  ) {
    return (
      candidate.report.multiCrossingWordCount >
      current.report.multiCrossingWordCount
    );
  }
  const candidateArea = candidate.report.boundingBox?.area ?? Number.POSITIVE_INFINITY;
  const currentArea = current.report.boundingBox?.area ?? Number.POSITIVE_INFINITY;
  if (candidateArea !== currentArea) {
    return candidateArea < currentArea;
  }
  const candidateSymmetry = symmetryPenalty(gridSize, candidate.report);
  const currentSymmetry = symmetryPenalty(gridSize, current.report);
  if (candidateSymmetry !== currentSymmetry) {
    return candidateSymmetry < currentSymmetry;
  }
  return candidate.tieBreaker < current.tieBreaker;
}

function isProvablyOptimal(
  gridSize: number,
  layout: CompleteLayout,
): boolean {
  if (!layout.report.publishable) {
    return false;
  }
  const acrossLengths = layout.placements
    .filter((placement) => placement.direction === "across")
    .map((placement) => Array.from(placement.gridAnswer).length);
  const downLengths = layout.placements
    .filter((placement) => placement.direction === "down")
    .map((placement) => Array.from(placement.gridAnswer).length);
  if (acrossLengths.length === 0 || downLengths.length === 0) {
    return false;
  }
  const minimumWidth = Math.max(...acrossLengths);
  const minimumHeight = Math.max(...downLengths);
  const minimumArea = minimumWidth * minimumHeight;
  const minimumSymmetryPenalty =
    (gridSize - minimumHeight) % 2 + (gridSize - minimumWidth) % 2;

  return (
    layout.report.crossingCellCount ===
      layout.report.theoreticalCrossingMaximum &&
    layout.report.multiCrossingWordCount === layout.report.wordCount &&
    layout.report.boundingBox?.area === minimumArea &&
    symmetryPenalty(gridSize, layout.report) === minimumSymmetryPenalty
  );
}

function buildOccupiedCells(
  placements: readonly EntryPlacement[],
): Map<string, OccupiedCell> {
  const cells = new Map<string, OccupiedCell>();
  for (const placement of placements) {
    for (const [offset, syllable] of Array.from(placement.gridAnswer).entries()) {
      const key = cellId(coordinateFor(placement, offset));
      const current = cells.get(key);
      if (current === undefined) {
        cells.set(key, {
          syllable,
          directions: new Set([placement.direction]),
        });
      } else {
        current.directions.add(placement.direction);
      }
    }
  }
  return cells;
}

function hasOnlyValidStructure(
  gridSize: number,
  placements: readonly EntryPlacement[],
): boolean {
  return !validateLayout(gridSize, placements).issues.some((issue) =>
    STRUCTURAL_ISSUES.has(issue.code),
  );
}

function firstPlacements(
  gridSize: number,
  candidate: NormalizedPuzzleCandidate,
): EntryPlacement[] {
  const placements: EntryPlacement[] = [];
  const length = candidate.syllables.length;
  for (const direction of ["across", "down"] as const) {
    const rowLimit = direction === "down" ? gridSize - length : gridSize - 1;
    const columnLimit = direction === "across" ? gridSize - length : gridSize - 1;
    for (let row = 0; row <= rowLimit; row += 1) {
      for (let column = 0; column <= columnLimit; column += 1) {
        placements.push({
          entryId: candidate.id,
          gridAnswer: candidate.gridAnswer,
          start: { row, column },
          direction,
        });
      }
    }
  }
  return placements;
}

function crossingCountAdded(
  placement: EntryPlacement,
  occupiedCells: ReadonlyMap<string, OccupiedCell>,
): number {
  return Array.from(placement.gridAnswer).filter((_, offset) =>
    occupiedCells.has(cellId(coordinateFor(placement, offset))),
  ).length;
}

function nextPlacements(
  gridSize: number,
  candidate: NormalizedPuzzleCandidate,
  existingPlacements: readonly EntryPlacement[],
): EntryPlacement[] {
  const occupiedCells = buildOccupiedCells(existingPlacements);
  const placementKeys = new Set<string>();
  const placements: EntryPlacement[] = [];

  for (const [occupiedKey, occupied] of occupiedCells) {
    const match = /^r(\d+)c(\d+)$/u.exec(occupiedKey);
    if (match === null) {
      continue;
    }
    const occupiedRow = Number(match[1]);
    const occupiedColumn = Number(match[2]);
    for (const [offset, syllable] of candidate.syllables.entries()) {
      if (syllable !== occupied.syllable) {
        continue;
      }
      for (const direction of ["across", "down"] as const) {
        const oppositeDirection = direction === "across" ? "down" : "across";
        if (!occupied.directions.has(oppositeDirection) || occupied.directions.has(direction)) {
          continue;
        }
        const start = {
          row: occupiedRow - (direction === "down" ? offset : 0),
          column: occupiedColumn - (direction === "across" ? offset : 0),
        };
        const placementKey = `${start.row}:${start.column}:${direction}`;
        if (placementKeys.has(placementKey)) {
          continue;
        }
        placementKeys.add(placementKey);
        const placement: EntryPlacement = {
          entryId: candidate.id,
          gridAnswer: candidate.gridAnswer,
          start,
          direction,
        };
        if (
          hasOnlyValidStructure(gridSize, [...existingPlacements, placement]) &&
          crossingCountAdded(placement, occupiedCells) > 0
        ) {
          placements.push(placement);
        }
      }
    }
  }

  return placements;
}

function sharedSyllableCount(
  left: NormalizedPuzzleCandidate,
  right: NormalizedPuzzleCandidate,
): number {
  const rightSyllables = new Set(right.syllables);
  return new Set(left.syllables.filter((syllable) => rightSyllables.has(syllable)))
    .size;
}

export function candidateGraphComponents(
  candidates: readonly NormalizedPuzzleCandidate[],
): readonly (readonly string[])[] {
  const graph = new Map<string, Set<string>>(
    candidates.map((candidate) => [candidate.id, new Set()]),
  );
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex];
    if (left === undefined) {
      continue;
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < candidates.length;
      rightIndex += 1
    ) {
      const right = candidates[rightIndex];
      if (right !== undefined && sharedSyllableCount(left, right) > 0) {
        graph.get(left.id)?.add(right.id);
        graph.get(right.id)?.add(left.id);
      }
    }
  }

  const unseen = new Set(candidates.map((candidate) => candidate.id));
  const components: string[][] = [];
  while (unseen.size > 0) {
    const first = unseen.values().next().value as string;
    const component: string[] = [];
    const pending = [first];
    unseen.delete(first);
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) {
        continue;
      }
      component.push(current);
      for (const neighbor of graph.get(current) ?? []) {
        if (unseen.delete(neighbor)) {
          pending.push(neighbor);
        }
      }
    }
    components.push(component.sort(compareText));
  }
  return components;
}

function normalizeCandidates(
  options: PuzzleGenerationOptions,
):
  | { ok: true; candidates: readonly NormalizedPuzzleCandidate[] }
  | { ok: false; reasons: readonly PuzzleFailureReason[] } {
  const reasons: PuzzleFailureReason[] = [];
  const normalized: NormalizedPuzzleCandidate[] = [];
  const seenIds = new Set<string>();
  const seenAnswers = new Map<string, string>();

  for (const candidate of options.candidates) {
    if (seenIds.has(candidate.id)) {
      reasons.push({
        code: "DUPLICATE_ID",
        entryIds: [candidate.id],
        message: "정답 후보 ID는 서로 달라야 합니다.",
      });
      continue;
    }
    seenIds.add(candidate.id);
    const result = validateAndNormalizeAnswer(candidate, options.gridSize);
    if (!result.ok) {
      const tooLong = result.issues.find((issue) => issue.code === "WORD_TOO_LONG");
      reasons.push({
        code: tooLong === undefined ? "INVALID_ANSWER" : "WORD_TOO_LONG",
        entryIds: [candidate.id],
        details: { issueCodes: result.issues.map((issue) => issue.code) },
        message:
          tooLong === undefined
            ? "정답 후보가 한글 정규화·형식 규칙을 통과하지 못했습니다."
            : "정답 후보가 선택한 격자 한 변보다 깁니다.",
      });
      continue;
    }
    const duplicateId = seenAnswers.get(result.value.gridAnswer);
    if (duplicateId !== undefined) {
      reasons.push({
        code: "DUPLICATE_ANSWER",
        entryIds: [duplicateId, candidate.id],
        message: "공백 제거 후 같은 격자형 정답은 중복 사용할 수 없습니다.",
      });
      continue;
    }
    seenAnswers.set(result.value.gridAnswer, candidate.id);
    normalized.push(result.value);
  }

  return reasons.length > 0
    ? { ok: false, reasons }
    : { ok: true, candidates: normalized };
}

function assignNumbersAndBuildPuzzle(
  gridSize: number,
  seed: string,
  candidates: readonly NormalizedPuzzleCandidate[],
  layout: CompleteLayout,
): PrivatePuzzle {
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const startKeys = [...new Set(layout.placements.map((entry) => cellId(entry.start)))]
    .map((key) => {
      const match = /^r(\d+)c(\d+)$/u.exec(key);
      return {
        key,
        row: Number(match?.[1] ?? 0),
        column: Number(match?.[2] ?? 0),
      };
    })
    .sort((left, right) => left.row - right.row || left.column - right.column);
  const numberByStart = new Map(
    startKeys.map((start, index) => [start.key, index + 1]),
  );
  const cellEntries = new Map<string, string[]>();
  const solutionCells = new Map<string, string>();
  for (const placement of layout.placements) {
    for (const [offset, syllable] of Array.from(placement.gridAnswer).entries()) {
      const key = cellId(coordinateFor(placement, offset));
      solutionCells.set(key, syllable);
      const entryIds = cellEntries.get(key) ?? [];
      entryIds.push(placement.entryId);
      cellEntries.set(key, entryIds);
    }
  }

  const entries: PrivatePuzzleEntry[] = layout.placements.map((placement) => {
    const candidate = candidateById.get(placement.entryId);
    if (candidate === undefined) {
      throw new Error(`Missing normalized candidate: ${placement.entryId}`);
    }
    const entry: PrivatePuzzleEntry = {
      ...placement,
      number: numberByStart.get(cellId(placement.start)) ?? 0,
      length: candidate.syllables.length,
      displayAnswer: candidate.displayAnswer,
      crossings: candidate.syllables.flatMap((_, offset) => {
        const coordinate = coordinateFor(placement, offset);
        return (cellEntries.get(cellId(coordinate))?.length ?? 0) > 1
          ? [coordinate]
          : [];
      }),
    };
    if (candidate.clue !== undefined) {
      entry.clue = candidate.clue;
    }
    return entry;
  });
  entries.sort(
    (left, right) =>
      left.number - right.number ||
      (left.direction === right.direction
        ? compareText(left.entryId, right.entryId)
        : left.direction === "across"
          ? -1
          : 1),
  );

  const sortedSolutionCells = Object.fromEntries(
    [...solutionCells].sort(([left], [right]) => compareText(left, right)),
  );
  const solutionEntries = Object.fromEntries(
    [...candidates]
      .sort((left, right) => compareText(left.id, right.id))
      .map((candidate) => [candidate.id, candidate.gridAnswer]),
  );

  return {
    gridSize,
    seed,
    entries,
    solution: { cells: sortedSolutionCells, entries: solutionEntries },
    report: layout.report,
  };
}

function failureFromReport(report: PuzzleQualityReport): PuzzleFailureReason[] {
  const densityIssue = report.issues.find(
    (issue) => issue.code === "DENSITY_BELOW_THRESHOLD",
  );
  if (densityIssue !== undefined) {
    const reason: PuzzleFailureReason = {
      code: "DENSITY_BELOW_THRESHOLD",
      details: {
        actual: report.multiCrossingWordCount,
        required: report.requiredMultiCrossingWordCount,
      },
      message: densityIssue.message,
    };
    if (densityIssue.entryIds !== undefined) {
      reason.entryIds = densityIssue.entryIds;
    }
    return [
      reason,
    ];
  }
  return [
    {
      code: "PLACEMENT_NOT_FOUND",
      message: "완성 배치가 발행 하드 게이트를 통과하지 못했습니다.",
    },
  ];
}

export function generatePuzzle(
  options: PuzzleGenerationOptions,
): PuzzleGenerationResult {
  if (!isGridSize(options.gridSize)) {
    return {
      ok: false,
      publishable: false,
      reasons: [
        {
          code: "INVALID_GRID_SIZE",
          details: { minimum: MIN_GRID_SIZE, maximum: MAX_GRID_SIZE },
          message: `${MIN_GRID_SIZE}×${MIN_GRID_SIZE}부터 ${MAX_GRID_SIZE}×${MAX_GRID_SIZE}까지만 생성할 수 있습니다.`,
        },
      ],
    };
  }

  const normalizedResult = normalizeCandidates(options);
  if (!normalizedResult.ok) {
    return { ok: false, publishable: false, reasons: normalizedResult.reasons };
  }
  const candidates = normalizedResult.candidates;
  if (candidates.length === 0) {
    return {
      ok: false,
      publishable: false,
      reasons: [
        {
          code: "PLACEMENT_NOT_FOUND",
          message: "배치할 정답 후보가 없습니다.",
        },
      ],
    };
  }

  const components = candidateGraphComponents(candidates);
  if (components.length > 1) {
    const hasAnyConnection = components.some((component) => component.length > 1);
    return {
      ok: false,
      publishable: false,
      reasons: [
        {
          code: hasAnyConnection ? "DISCONNECTED_CANDIDATES" : "NO_SHARED_SYLLABLE",
          entryIds: components.filter((component) => component.length === 1).flat(),
          details: { components: components.map((component) => component.join(",")) },
          message: hasAnyConnection
            ? "후보의 공통 음절 그래프가 여러 묶음으로 나뉩니다."
            : "후보 사이에 교차할 수 있는 공통 음절이 없습니다.",
        },
      ],
    };
  }

  const seed = String(options.seed);
  const searchBudget = options.searchBudget ?? DEFAULT_SEARCH_BUDGET;
  const sharedCounts = new Map(
    candidates.map((candidate) => [
      candidate.id,
      candidates.reduce(
        (total, other) =>
          total + (other.id === candidate.id ? 0 : sharedSyllableCount(candidate, other)),
        0,
      ),
    ]),
  );
  const orderedCandidates = [...candidates].sort(
    (left, right) =>
      (sharedCounts.get(right.id) ?? 0) - (sharedCounts.get(left.id) ?? 0) ||
      right.syllables.length - left.syllables.length ||
      stableHash(`${seed}|candidate|${left.id}`) -
        stableHash(`${seed}|candidate|${right.id}`) ||
      compareText(left.id, right.id),
  );
  const firstCandidate = orderedCandidates[0];
  if (firstCandidate === undefined) {
    throw new Error("Normalized candidates unexpectedly empty");
  }

  let visitedNodes = 0;
  let budgetExceeded = false;
  let optimalFound = false;
  let bestLayout: CompleteLayout | undefined;

  const search = (
    placements: readonly EntryPlacement[],
    unplaced: readonly NormalizedPuzzleCandidate[],
  ): void => {
    if (visitedNodes >= searchBudget) {
      budgetExceeded = true;
      return;
    }
    visitedNodes += 1;

    if (unplaced.length === 0) {
      const report = validateLayout(options.gridSize, placements);
      const layout: CompleteLayout = {
        placements,
        report,
        tieBreaker: stableHash(`${seed}|layout|${placementSignature(placements)}`),
      };
      if (isBetterLayout(layout, bestLayout, options.gridSize)) {
        bestLayout = layout;
        optimalFound = isProvablyOptimal(options.gridSize, layout);
      }
      return;
    }

    const occupiedCells = buildOccupiedCells(placements);
    const choices = unplaced
      .map((candidate) => ({
        candidate,
        placements: nextPlacements(options.gridSize, candidate, placements),
      }))
      .filter((choice) => choice.placements.length > 0)
      .sort(
        (left, right) =>
          left.placements.length - right.placements.length ||
          (sharedCounts.get(right.candidate.id) ?? 0) -
            (sharedCounts.get(left.candidate.id) ?? 0) ||
          stableHash(`${seed}|choice|${left.candidate.id}|${placements.length}`) -
            stableHash(`${seed}|choice|${right.candidate.id}|${placements.length}`),
      );
    if (choices.length === 0) {
      return;
    }

    for (const choice of choices) {
      const rankedPlacements = choice.placements.sort((left, right) => {
        const leftCrossings = crossingCountAdded(left, occupiedCells);
        const rightCrossings = crossingCountAdded(right, occupiedCells);
        return (
          rightCrossings - leftCrossings ||
          boundingArea([...placements, left]) -
            boundingArea([...placements, right]) ||
          stableHash(
            `${seed}|placement|${left.entryId}|${left.start.row}|${left.start.column}|${left.direction}`,
          ) -
            stableHash(
              `${seed}|placement|${right.entryId}|${right.start.row}|${right.start.column}|${right.direction}`,
            )
        );
      });

      const remaining = unplaced.filter(
        (candidate) => candidate.id !== choice.candidate.id,
      );
      for (const placement of rankedPlacements) {
        search([...placements, placement], remaining);
        if (optimalFound || visitedNodes >= searchBudget) {
          if (!optimalFound && visitedNodes >= searchBudget) {
            budgetExceeded = true;
          }
          return;
        }
      }
    }
  };

  const initialPlacements = firstPlacements(options.gridSize, firstCandidate).sort(
    (left, right) =>
      boundingArea([left]) - boundingArea([right]) ||
      stableHash(
        `${seed}|first|${left.start.row}|${left.start.column}|${left.direction}`,
      ) -
        stableHash(
          `${seed}|first|${right.start.row}|${right.start.column}|${right.direction}`,
        ),
  );
  const remaining = orderedCandidates.filter(
    (candidate) => candidate.id !== firstCandidate.id,
  );
  for (const placement of initialPlacements) {
    search([placement], remaining);
    if (optimalFound || visitedNodes >= searchBudget) {
      if (!optimalFound && visitedNodes >= searchBudget) {
        budgetExceeded = true;
      }
      break;
    }
  }

  if (bestLayout?.report.publishable === true) {
    return {
      ok: true,
      puzzle: assignNumbersAndBuildPuzzle(
        options.gridSize,
        seed,
        candidates,
        bestLayout,
      ),
    };
  }

  if (bestLayout !== undefined && !budgetExceeded) {
    return {
      ok: false,
      publishable: false,
      reasons: failureFromReport(bestLayout.report),
      bestReport: bestLayout.report,
    };
  }

  const failure = {
    ok: false as const,
    publishable: false as const,
    reasons: [
      budgetExceeded
        ? {
            code: "SEARCH_BUDGET_EXCEEDED" as const,
            details: { searchBudget, visitedNodes },
            message: "설정한 탐색 예산 안에서 발행 가능한 배치를 확인하지 못했습니다.",
          }
        : {
            code: "PLACEMENT_NOT_FOUND" as const,
            details: { visitedNodes },
            message: "경계·충돌·인접 규칙을 만족하는 완성 배치를 찾지 못했습니다.",
          },
    ],
  };
  if (bestLayout !== undefined) {
    return { ...failure, bestReport: bestLayout.report };
  }
  return failure;
}
