import { readEditableWithdrawal, mergeWithdrawalEdits, assertWithdrawalEditTargets } from "./withdrawal-edits";
import { z } from "zod";
import { quizSetIdSchema } from "../../../shared/api/admin-finalization";
import { withdrawalPreviewRequestSchema, withdrawalPreviewSchema } from "../../../shared/api/admin-withdrawal-preview";
import { type WithdrawalView } from "../../../shared/api/admin-withdraw";
import { publicPuzzleGridSchema } from "../../../shared/api/public-quiz";
import { validateAndNormalizeAnswer } from "../../../shared/puzzle/hangul";
import { cellId, coordinateFor, validateLayout } from "../../../shared/puzzle/layout";
import { publicGridSchema } from "../db/validation";
import { validateScoringSource } from "./submission-scoring";

type Edits = z.infer<typeof withdrawalPreviewRequestSchema>["edits"];

export function checkWithdrawalVariant(source: WithdrawalView["review"]["variants"][number], edits: Edits) {
  const stored = publicGridSchema.parse(source.grid);
  if (stored.cells.length !== stored.size ** 2 || new Set(stored.cells.map(cellId)).size !== stored.cells.length ||
    stored.cells.some(cell => cell.row >= stored.size || cell.column >= stored.size ||
      cell.isBlocked && (cell.acrossNumber !== undefined || cell.downNumber !== undefined))) throw new Error("INVALID_STORED_GRID");
  const originalGrid = publicPuzzleGridSchema.parse({
    gridSize: stored.size,
    cells: stored.cells.filter(cell => !cell.isBlocked).map(cell => {
      for (const direction of ["across", "down"] as const) {
        const entry = source.entries.find(item => item.startRow === cell.row && item.startCol === cell.column && item.direction === direction);
        if (entry?.number !== (direction === "across" ? cell.acrossNumber : cell.downNumber)) throw new Error("INVALID_STORED_GRID");
      }
      const number = cell.acrossNumber ?? cell.downNumber;
      return { id: cellId(cell), row: cell.row, column: cell.column, ...(number === undefined ? {} : { number }) };
    }),
    entries: source.entries.map(entry => ({ id: entry.id, number: entry.number, direction: entry.direction,
      start: { row: entry.startRow, column: entry.startCol }, length: entry.length, clue: entry.clue })),
  });
  validateScoringSource({ grid: originalGrid, solution: { cells: source.solutionCells, entries: source.entryAnswers }, canonicalCellOrder: source.canonicalCellOrder });
  const issues: string[] = [];
  const entries = source.entries.flatMap(entry => {
    const edit = edits.find(item => item.difficulty === source.difficulty && item.entryId === entry.id);
    const checked = validateAndNormalizeAnswer({ id: entry.id, displayAnswer: edit?.answer ?? source.entryAnswers[entry.id]!, clue: edit?.clue ?? entry.clue }, stored.size);
    if (!checked.ok) { issues.push(...checked.issues.map(issue => issue.code)); return []; }
    // This legacy coordinate preview never moves words; the revision editor selects new layouts explicitly.
    if (checked.value.syllables.length !== entry.length) issues.push("REPLACEMENT_LAYOUT_REQUIRED");
    return [{ entryId: entry.id, gridAnswer: checked.value.gridAnswer, clue: checked.value.clue!,
      start: { row: entry.startRow, column: entry.startCol }, direction: entry.direction }];
  });
  if (new Set(entries.map(entry => entry.gridAnswer)).size !== entries.length) issues.push("DUPLICATE_ANSWER");
  const report = validateLayout(stored.size, entries);
  issues.push(...report.issues.map(issue => issue.code));
  if (issues.length) return { difficulty: source.difficulty, issues: [...new Set(issues)], preview: null };
  const solution = {
    cells: Object.fromEntries(entries.flatMap(entry => Array.from(entry.gridAnswer, (letter, offset) => [cellId(coordinateFor(entry, offset)), letter]))),
    entries: Object.fromEntries(entries.map(entry => [entry.entryId, entry.gridAnswer])),
  };
  const grid = publicPuzzleGridSchema.parse({ ...originalGrid, entries: originalGrid.entries.map(entry => ({
    ...entry, clue: entries.find(item => item.entryId === entry.id)!.clue,
  })) });
  validateScoringSource({ grid, solution, canonicalCellOrder: source.canonicalCellOrder });
  return { difficulty: source.difficulty, issues, preview: { grid, solution } };
}

/** Permanent withdrawal source plus its saved edits. No old generation draft, provider, write, or publication ticket. */
export async function previewWithdrawalEdits(db: D1Database, id: string, raw: unknown) {
  quizSetIdSchema.parse(id);
  const command = withdrawalPreviewRequestSchema.parse(raw);
  const { source: view, current } = await readEditableWithdrawal(db, id);
  if (view.reviewRevision !== command.expectedReviewRevision || current.editRevision !== command.expectedEditRevision) throw new Error("WITHDRAWAL_PREVIEW_STALE");
  assertWithdrawalEditTargets(view, command.edits);
  const edits = mergeWithdrawalEdits(current.edits, command.edits);
  const variants = view.review.variants.map(variant => checkWithdrawalVariant(variant, edits));
  return withdrawalPreviewSchema.parse({ quizSetId: id, reviewRevision: view.reviewRevision, editRevision: current.editRevision, persisted: false,
    requiresHumanReview: true, codeChecksPassed: variants.every(variant => variant.preview !== null), variants });
}
