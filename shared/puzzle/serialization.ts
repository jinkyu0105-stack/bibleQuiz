import { cellId } from "./layout";
import type {
  PrivatePuzzle,
  PublicPuzzleCell,
  PublicPuzzleEntry,
  PublicPuzzleGrid,
} from "./types";

export function serializePublicPuzzle(puzzle: PrivatePuzzle): PublicPuzzleGrid {
  const numberByCell = new Map(
    puzzle.entries.map((entry) => [cellId(entry.start), entry.number]),
  );
  const cells: PublicPuzzleCell[] = Object.keys(puzzle.solution.cells)
    .map((id) => {
      const match = /^r(\d+)c(\d+)$/u.exec(id);
      if (match === null) {
        throw new Error(`Invalid private solution cell ID: ${id}`);
      }
      const cell: PublicPuzzleCell = {
        id,
        row: Number(match[1]),
        column: Number(match[2]),
      };
      const number = numberByCell.get(id);
      if (number !== undefined) {
        cell.number = number;
      }
      return cell;
    })
    .sort((left, right) => left.row - right.row || left.column - right.column);

  const entries: PublicPuzzleEntry[] = puzzle.entries.map((entry) => {
    const publicEntry: PublicPuzzleEntry = {
      id: entry.entryId,
      number: entry.number,
      direction: entry.direction,
      start: { ...entry.start },
      length: entry.length,
    };
    if (entry.clue !== undefined) {
      publicEntry.clue = entry.clue;
    }
    return publicEntry;
  });

  return {
    gridSize: puzzle.gridSize,
    cells,
    entries,
  };
}
