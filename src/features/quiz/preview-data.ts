import type { PublicPuzzleGrid } from "../../../shared/puzzle/types";

export type Difficulty = "child" | "adult";

// DEV-only public geometry. Never import a generator or an answer-bearing fixture here.
export function previewQuiz(difficulty: Difficulty, size?: number) {
  const gridSize = size ?? (difficulty === "child" ? 5 : 8);
  const length = gridSize % 2 === 0 ? gridSize - 1 : gridSize;
  const cells: PublicPuzzleGrid["cells"][number][] = [];
  const entries: PublicPuzzleGrid["entries"][number][] = [];
  let number = 0;
  for (let row = 0; row < length; row += 1) {
    for (let column = 0; column < length; column += 1) {
      if (row % 2 !== 0 && column % 2 !== 0) continue;
      const startsAcross = column === 0 && row % 2 === 0;
      const startsDown = row === 0 && column % 2 === 0;
      if (startsAcross || startsDown) number += 1;
      cells.push({ id: `r${row}c${column}`, row, column, ...(startsAcross || startsDown ? { number } : {}) });
      for (const direction of ["across", "down"] as const) {
        if (!(direction === "across" ? startsAcross : startsDown)) continue;
        entries.push({
          id: `${direction}-${number}`, number, direction, start: { row, column }, length,
          clue: `${direction === "across" ? "가로" : "세로"}로 ${length}칸을 입력해 보세요. 이 단서는 입력 시험용입니다.`,
        });
      }
    }
  }
  return {
    quizId: `preview-${difficulty}-${gridSize}`,
    variantRevision: 1,
    difficulty,
    grid: { gridSize, cells, entries } satisfies PublicPuzzleGrid,
  };
}

export type PreviewQuiz = ReturnType<typeof previewQuiz>;
