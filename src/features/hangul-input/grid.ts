import {
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  type PublicPuzzleGrid,
} from "../../../shared/puzzle/types";
import type { InputCell, InputEntry, InputGrid, InputState } from "./types";

export function coordinateKey(row: number, column: number): string {
  return `${row}:${column}`;
}

/** Internal geometry adapter, not an API schema or a publication validator. */
export function createInputGrid(publicGrid: PublicPuzzleGrid): InputGrid {
  const { gridSize } = publicGrid;
  if (!Number.isInteger(gridSize) || gridSize < MIN_GRID_SIZE || gridSize > MAX_GRID_SIZE) {
    throw new Error("Invalid input grid size");
  }

  const cells = new Map<string, InputCell>();
  const cellAt = new Map<string, string>();
  const entries = new Map<string, InputEntry>();
  for (const cell of publicGrid.cells) {
    const key = coordinateKey(cell.row, cell.column);
    if (
      !cell.id || cells.has(cell.id) || cellAt.has(key) ||
      !Number.isInteger(cell.row) || !Number.isInteger(cell.column) ||
      cell.row < 0 || cell.row >= gridSize || cell.column < 0 || cell.column >= gridSize
    ) {
      throw new Error("Invalid input grid cell");
    }
    // Allowlist only geometry; do not retain the source object or private extras.
    cells.set(cell.id, { id: cell.id, row: cell.row, column: cell.column, entryIds: [] });
    cellAt.set(key, cell.id);
  }

  const sortedEntries = [...publicGrid.entries].sort((a, b) =>
    a.number - b.number || (a.direction === b.direction ? 0 : a.direction === "across" ? -1 : 1) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const entry of sortedEntries) {
    if (
      !entry.id || entries.has(entry.id) ||
      !Number.isInteger(entry.length) || entry.length < 2 || entry.length > gridSize ||
      !Number.isInteger(entry.number) || entry.number < 1 ||
      (entry.direction !== "across" && entry.direction !== "down")
    ) {
      throw new Error("Invalid input grid entry");
    }
    const cellIds: string[] = [];
    for (let index = 0; index < entry.length; index += 1) {
      const key = coordinateKey(
        entry.start.row + (entry.direction === "down" ? index : 0),
        entry.start.column + (entry.direction === "across" ? index : 0),
      );
      const id = cellAt.get(key);
      const cell = id === undefined ? undefined : cells.get(id);
      if (!cell || cell.entryIds.some((entryId) => entries.get(entryId)?.direction === entry.direction)) {
        throw new Error("Invalid input grid entry path");
      }
      cellIds.push(cell.id);
      cells.set(cell.id, { ...cell, entryIds: [...cell.entryIds, entry.id] });
    }
    entries.set(entry.id, { id: entry.id, direction: entry.direction, cellIds });
  }
  if (!entries.size || [...cells.values()].some((cell) => !cell.entryIds.length)) {
    throw new Error("Input grid must have entries covering every active cell");
  }
  return { cells, entries, cellAt, entryOrder: sortedEntries.map((entry) => entry.id) };
}

export function createInputState(grid: InputGrid): InputState {
  const first = grid.entryOrder[0];
  const entry = first === undefined ? undefined : grid.entries.get(first);
  const activeCell = entry?.cellIds[0];
  if (!entry || activeCell === undefined) throw new Error("Input grid is empty");
  return {
    activeCell,
    activeEntry: entry.id,
    direction: entry.direction,
    selectionIndex: 0,
    cellValues: new Map(),
    compositionText: "",
    isComposing: false,
    buffer: { entryId: entry.id, startIndex: 0, value: "", cellCount: 0 },
  };
}
