import {
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  type Coordinate,
  type Direction,
  type EntryPlacement,
  type LayoutValidationIssue,
  type PuzzleQualityReport,
} from "./types";

interface LayoutCell {
  syllable: string;
  entries: Set<string>;
  directions: Set<Direction>;
}

export function cellId(coordinate: Coordinate): string {
  return `r${coordinate.row}c${coordinate.column}`;
}

export function coordinateFor(
  placement: Pick<EntryPlacement, "start" | "direction">,
  offset: number,
): Coordinate {
  return {
    row: placement.start.row + (placement.direction === "down" ? offset : 0),
    column:
      placement.start.column + (placement.direction === "across" ? offset : 0),
  };
}

export function isGridSize(value: number): boolean {
  return (
    Number.isInteger(value) && value >= MIN_GRID_SIZE && value <= MAX_GRID_SIZE
  );
}

function coordinateKey(first: Coordinate, second: Coordinate): string {
  return `${cellId(first)}>${cellId(second)}`;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function countConnectedComponents(
  entryIds: readonly string[],
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): number {
  const unseen = new Set(entryIds);
  let count = 0;

  while (unseen.size > 0) {
    count += 1;
    const first = unseen.values().next().value as string;
    const pending = [first];
    unseen.delete(first);

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) {
        continue;
      }
      for (const neighbor of graph.get(current) ?? []) {
        if (unseen.delete(neighbor)) {
          pending.push(neighbor);
        }
      }
    }
  }

  return count;
}

export function validateLayout(
  gridSize: number,
  entries: readonly EntryPlacement[],
): PuzzleQualityReport {
  const issues: LayoutValidationIssue[] = [];
  const warnings: LayoutValidationIssue[] = [];
  const cells = new Map<string, LayoutCell>();
  const validCoordinates: Coordinate[] = [];
  const consecutivePairs = new Set<string>();
  const graph = new Map<string, Set<string>>();
  const placementSignatures = new Map<string, string>();

  if (!isGridSize(gridSize)) {
    issues.push({
      code: "INVALID_GRID_SIZE",
      message: `${MIN_GRID_SIZE}×${MIN_GRID_SIZE}부터 ${MAX_GRID_SIZE}×${MAX_GRID_SIZE}까지만 지원합니다.`,
    });
  }
  if (entries.length === 0) {
    issues.push({
      code: "EMPTY_ENTRY_SET",
      message: "배치를 검사하려면 한 개 이상의 정답이 필요합니다.",
    });
  }

  for (const entry of entries) {
    graph.set(entry.entryId, new Set());
    const signature = `${entry.start.row}:${entry.start.column}:${entry.direction}:${entry.gridAnswer.length}`;
    const duplicateEntryId = placementSignatures.get(signature);
    if (duplicateEntryId !== undefined) {
      issues.push({
        code: "DUPLICATE_PLACEMENT",
        entryIds: [duplicateEntryId, entry.entryId],
        message: "두 정답이 같은 시작점·방향·길이를 사용합니다.",
      });
    } else {
      placementSignatures.set(signature, entry.entryId);
    }

    const syllables = Array.from(entry.gridAnswer);
    for (const [offset, syllable] of syllables.entries()) {
      const coordinate = coordinateFor(entry, offset);
      const inBounds =
        coordinate.row >= 0 &&
        coordinate.row < gridSize &&
        coordinate.column >= 0 &&
        coordinate.column < gridSize;
      if (!inBounds) {
        issues.push({
          code: "OUT_OF_BOUNDS",
          entryIds: [entry.entryId],
          cell: coordinate,
          message: "정답이 선택한 격자 경계를 벗어납니다.",
        });
        continue;
      }

      validCoordinates.push(coordinate);
      const key = cellId(coordinate);
      const current = cells.get(key);
      if (current === undefined) {
        cells.set(key, {
          syllable,
          entries: new Set([entry.entryId]),
          directions: new Set([entry.direction]),
        });
      } else {
        if (current.syllable !== syllable) {
          issues.push({
            code: "LETTER_CONFLICT",
            entryIds: [...current.entries, entry.entryId],
            cell: coordinate,
            message: "같은 셀에 서로 다른 음절이 놓였습니다.",
          });
        }
        if (current.directions.has(entry.direction)) {
          issues.push({
            code: "SAME_DIRECTION_OVERLAP",
            entryIds: [...current.entries, entry.entryId],
            cell: coordinate,
            message: "같은 방향의 정답끼리는 셀을 겹칠 수 없습니다.",
          });
        }
        current.entries.add(entry.entryId);
        current.directions.add(entry.direction);
      }

      if (offset > 0) {
        consecutivePairs.add(
          coordinateKey(coordinateFor(entry, offset - 1), coordinate),
        );
      }
    }
  }

  for (const [key] of cells) {
    const match = /^r(-?\d+)c(-?\d+)$/u.exec(key);
    if (match === null) {
      continue;
    }
    const row = Number(match[1]);
    const column = Number(match[2]);
    const coordinate = { row, column };
    for (const neighbor of [
      { row, column: column + 1 },
      { row: row + 1, column },
    ]) {
      if (
        cells.has(cellId(neighbor)) &&
        !consecutivePairs.has(coordinateKey(coordinate, neighbor))
      ) {
        issues.push({
          code: "UNINTENDED_ADJACENCY",
          cell: coordinate,
          message: "교차나 같은 정답의 연속 셀이 아닌 글자끼리 맞닿았습니다.",
        });
      }
    }
  }

  const crossingCountByEntry = new Map<string, number>(
    entries.map((entry) => [entry.entryId, 0]),
  );
  let crossingCellCount = 0;
  for (const cell of cells.values()) {
    if (cell.directions.size !== 2 || cell.entries.size < 2) {
      continue;
    }
    crossingCellCount += 1;
    const cellEntryIds = [...cell.entries];
    for (const entryId of cellEntryIds) {
      crossingCountByEntry.set(
        entryId,
        (crossingCountByEntry.get(entryId) ?? 0) + 1,
      );
      for (const otherEntryId of cellEntryIds) {
        if (entryId !== otherEntryId) {
          graph.get(entryId)?.add(otherEntryId);
        }
      }
    }
  }

  const entryIds = entries.map((entry) => entry.entryId);
  const connectedComponentCount = countConnectedComponents(entryIds, graph);
  if (entries.length > 0 && connectedComponentCount !== 1) {
    issues.push({
      code: "DISCONNECTED",
      entryIds: entryIds.filter((entryId) => (graph.get(entryId)?.size ?? 0) === 0),
      message: "모든 정답이 하나의 교차 그래프로 연결되어야 합니다.",
    });
  }

  const wordsWithoutCrossing = entryIds.filter(
    (entryId) => (crossingCountByEntry.get(entryId) ?? 0) === 0,
  );
  if (wordsWithoutCrossing.length > 0) {
    issues.push({
      code: "WORD_WITHOUT_CROSSING",
      entryIds: wordsWithoutCrossing,
      message: "모든 정답은 최소 한 번 실제로 교차해야 합니다.",
    });
  }

  const multiCrossingWordCount = entryIds.filter(
    (entryId) => (crossingCountByEntry.get(entryId) ?? 0) >= 2,
  ).length;
  const requiredMultiCrossingWordCount = Math.ceil((entries.length * 2) / 3);
  if (multiCrossingWordCount < requiredMultiCrossingWordCount) {
    warnings.push({
      code: "DENSITY_BELOW_THRESHOLD",
      entryIds: entryIds.filter(
        (entryId) => (crossingCountByEntry.get(entryId) ?? 0) < 2,
      ),
      message: `두 번 이상 교차하는 답이 ${multiCrossingWordCount}개로 권장 ${requiredMultiCrossingWordCount}개보다 적습니다. 발행은 가능합니다.`,
    });
  }

  const acrossWordCount = entries.filter(
    (entry) => entry.direction === "across",
  ).length;
  const downWordCount = entries.length - acrossWordCount;
  const theoreticalCrossingMaximum = acrossWordCount * downWordCount;
  const activeCellCount = cells.size;

  let boundingBox: PuzzleQualityReport["boundingBox"] = null;
  if (validCoordinates.length > 0) {
    const rows = validCoordinates.map((coordinate) => coordinate.row);
    const columns = validCoordinates.map((coordinate) => coordinate.column);
    const top = Math.min(...rows);
    const left = Math.min(...columns);
    const bottom = Math.max(...rows);
    const right = Math.max(...columns);
    boundingBox = {
      top,
      left,
      bottom,
      right,
      area: (bottom - top + 1) * (right - left + 1),
    };
  }

  return {
    publishable: issues.length === 0,
    gridSize,
    wordCount: entries.length,
    acrossWordCount,
    downWordCount,
    activeCellCount,
    crossingCellCount,
    crossingCellDensity:
      activeCellCount === 0 ? 0 : roundMetric(crossingCellCount / activeCellCount),
    theoreticalCrossingMaximum,
    theoreticalCrossingDensity:
      theoreticalCrossingMaximum === 0
        ? 0
        : roundMetric(crossingCellCount / theoreticalCrossingMaximum),
    multiCrossingWordCount,
    requiredMultiCrossingWordCount,
    boundingBox,
    fillDensity:
      boundingBox === null ? 0 : roundMetric(activeCellCount / boundingBox.area),
    connectedComponentCount,
    words: entries.map((entry) => ({
      entryId: entry.entryId,
      length: Array.from(entry.gridAnswer).length,
      crossingCount: crossingCountByEntry.get(entry.entryId) ?? 0,
      connected: (graph.get(entry.entryId)?.size ?? 0) > 0,
    })),
    issues,
    warnings,
  };
}
