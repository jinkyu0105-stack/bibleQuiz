import type { PuzzleCandidateInput, PuzzleGenerationOptions } from "./types";

export interface PuzzleFixture extends PuzzleGenerationOptions {
  name: string;
}

function fixtureSyllable(index: number): string {
  return String.fromCodePoint(0xac00 + index);
}

function createLatticeFixture(
  name: string,
  gridSize: 5 | 8 | 10,
  lineLength: 5 | 7 | 9,
  seed: string,
  syllableOffset: number,
): PuzzleFixture {
  const matrix = Array.from({ length: lineLength }, (_, row) =>
    Array.from({ length: lineLength }, (_, column) =>
      fixtureSyllable(syllableOffset + row * lineLength + column),
    ),
  );
  const lineIndexes = Array.from(
    { length: Math.ceil(lineLength / 2) },
    (_, index) => index * 2,
  );
  const candidates: PuzzleCandidateInput[] = [];

  for (const row of lineIndexes) {
    candidates.push({
      id: `${name}-가로-${row}`,
      displayAnswer: matrix[row]?.join("") ?? "",
      clue: `${gridSize}×${gridSize} 결정성 검사용 가로 fixture ${row}`,
    });
  }
  for (const column of lineIndexes) {
    candidates.push({
      id: `${name}-세로-${column}`,
      displayAnswer: matrix.map((row) => row[column]).join(""),
      clue: `${gridSize}×${gridSize} 결정성 검사용 세로 fixture ${column}`,
    });
  }

  return {
    name,
    gridSize,
    seed,
    candidates,
    searchBudget: 300_000,
  };
}

export const PUZZLE_FIXTURES = {
  fiveByFive: createLatticeFixture("오오", 5, 5, "fixture-5x5-v1", 0),
  eightByEight: createLatticeFixture("팔팔", 8, 7, "fixture-8x8-v1", 100),
  tenByTen: createLatticeFixture("십십", 10, 9, "fixture-10x10-v1", 300),
} as const satisfies Readonly<Record<string, PuzzleFixture>>;
