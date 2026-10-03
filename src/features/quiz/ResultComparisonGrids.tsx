import type { CSSProperties } from "react";

import type { RevealedSolution } from "../../../shared/api/solution";
import type { PublicPuzzleGrid } from "../../../shared/puzzle/types";
import styles from "./quiz.module.css";

type ComparisonKind = "answer" | "solution";

function ComparisonGrid({
  answers,
  grid,
  kind,
  solution,
}: {
  answers: Readonly<Record<string, string>>;
  grid: PublicPuzzleGrid;
  kind: ComparisonKind;
  solution: RevealedSolution;
}) {
  const title = kind === "answer" ? "내가 제출한 답" : "정답";
  const cells = new Map(grid.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
  const gridStyle = { "--comparison-grid-size": grid.gridSize } as CSSProperties;

  return <figure className={styles.comparisonFigure}>
    <figcaption>{title}</figcaption>
    <div
      className={styles.comparisonGrid}
      data-grid-kind={kind}
      data-testid={`result-${kind}-grid`}
      role="grid"
      aria-label={`${title} 격자`}
      aria-rowcount={grid.gridSize}
      aria-colcount={grid.gridSize}
      style={gridStyle}
    >
      {Array.from({ length: grid.gridSize }, (_, row) => <div role="row" className={styles.comparisonRow} key={row}>
        {Array.from({ length: grid.gridSize }, (_, column) => {
          const cell = cells.get(`${row}:${column}`);
          if (!cell) return <div
            className={styles.comparisonBlockedCell}
            role="gridcell"
            aria-disabled="true"
            aria-label={`${row + 1}행 ${column + 1}열, 막힌 칸`}
            key={column}
          />;

          const answer = answers[cell.id];
          const correctAnswer = solution.cells[cell.id] ?? "";
          const result = answer === correctAnswer ? "correct" : answer === undefined ? "blank" : "incorrect";
          const value = kind === "answer" ? answer : correctAnswer;
          const label = kind === "answer"
            ? `${row + 1}행 ${column + 1}열, 내 답 ${answer ?? "빈칸"}, 정답 ${correctAnswer}, ${result === "correct" ? "맞음" : result === "incorrect" ? "틀림" : "미작성"}`
            : `${row + 1}행 ${column + 1}열, 정답 ${correctAnswer}`;
          return <div
            className={styles.comparisonCell}
            data-comparison-cell={cell.id}
            data-result={kind === "answer" ? result : undefined}
            role="gridcell"
            aria-label={label}
            key={column}
          >
            {cell.number !== undefined && <small aria-hidden="true">{cell.number}</small>}
            <span aria-hidden="true">{value ?? ""}</span>
            {kind === "answer" && <span className={styles.comparisonMarker} aria-hidden="true">
              {result === "correct" ? "✓" : result === "incorrect" ? "×" : ""}
            </span>}
          </div>;
        })}
      </div>)}
    </div>
  </figure>;
}

export function ResultComparisonGrids({
  answers,
  grid,
  solution,
}: {
  answers: Readonly<Record<string, string>>;
  grid: PublicPuzzleGrid;
  solution: RevealedSolution;
}) {
  return <section className={styles.comparisonSection} aria-label="내 답과 정답 비교">
    <ComparisonGrid answers={answers} grid={grid} kind="answer" solution={solution} />
    <ComparisonGrid answers={answers} grid={grid} kind="solution" solution={solution} />
  </section>;
}
