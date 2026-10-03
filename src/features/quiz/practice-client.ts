import { z } from "zod";

import {
  practiceCheckDataSchema,
  practiceCheckRequestSchema,
  type PracticeCheckData,
  type PracticeCheckRequest,
} from "../../../shared/api/practice";
import type { Difficulty } from "../../../shared/api/public-quiz";
import type { PublicPuzzleGrid } from "../../../shared/puzzle/types";
import { matchesRevealedSolution } from "./solution-client";

const PRACTICE_TIMEOUT_MS = 15_000;
const responseSchema = z.strictObject({ data: practiceCheckDataSchema });
const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1).max(128),
    field: z.literal("cells").optional(),
    message: z.string().min(1).max(500),
    requestId: z.uuid(),
  }),
});

export interface PracticeCheckTarget {
  difficulty: Difficulty;
  grid: PublicPuzzleGrid;
  quizRevision: number;
  quizVariantId: string;
  slug: string;
}

export interface PracticeClientError {
  code: string;
  field?: "cells";
  message: string;
  requestId?: string;
}

export type PracticeClientResult =
  | { ok: true; data: PracticeCheckData }
  | { ok: false; error: PracticeClientError };

function unavailable(message: string): PracticeClientResult {
  return { ok: false, error: { code: "CLIENT_UNAVAILABLE", message } };
}

async function publicError(response: Response): Promise<PracticeClientResult> {
  try {
    const parsed = errorSchema.safeParse(await response.json());
    if (parsed.success) {
      return {
        ok: false,
        error: {
          code: parsed.data.error.code,
          message: parsed.data.error.message,
          requestId: parsed.data.error.requestId,
          ...(parsed.data.error.field === undefined ? {} : { field: parsed.data.error.field }),
        },
      };
    }
  } catch {
    // Arbitrary upstream contents are replaced at this browser boundary.
  }
  return unavailable("답안을 채점하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

function entryCellIds(grid: PublicPuzzleGrid, entryId: string): string[] | null {
  const entry = grid.entries.find((candidate) => candidate.id === entryId);
  if (entry === undefined) return null;
  const cellAt = new Map(grid.cells.map((cell) => [`${cell.row}:${cell.column}`, cell.id]));
  const ids: string[] = [];
  for (let offset = 0; offset < entry.length; offset += 1) {
    const row = entry.start.row + (entry.direction === "down" ? offset : 0);
    const column = entry.start.column + (entry.direction === "across" ? offset : 0);
    const cellId = cellAt.get(`${row}:${column}`);
    if (cellId === undefined) return null;
    ids.push(cellId);
  }
  return ids;
}

function matchesAnswers(
  data: PracticeCheckData,
  request: PracticeCheckRequest,
  grid: PublicPuzzleGrid,
): boolean {
  const correctCells = grid.cells.filter((cell) => request.cells[cell.id] === data.solution.cells[cell.id]).length;
  const correctWords = grid.entries.filter((entry) => {
    const ids = entryCellIds(grid, entry.id);
    return ids !== null && ids.every((cellId) => request.cells[cellId] === data.solution.cells[cellId]);
  }).length;
  return data.totalCells === grid.cells.length &&
    data.totalWords === grid.entries.length &&
    data.correctCells === correctCells &&
    data.correctWords === correctWords &&
    data.scoreBasisPoints === Math.round((correctCells / grid.cells.length) * 10_000);
}

export async function checkPracticeAnswers(
  target: PracticeCheckTarget,
  cells: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<PracticeClientResult> {
  const request = practiceCheckRequestSchema.safeParse({
    revision: target.quizRevision,
    cells,
  });
  if (!request.success || Object.keys(request.data.cells).length === 0) {
    return unavailable("한 칸 이상 입력한 뒤 채점해 주세요.");
  }
  try {
    const requestSignal = signal === undefined
      ? AbortSignal.timeout(PRACTICE_TIMEOUT_MS)
      : AbortSignal.any([signal, AbortSignal.timeout(PRACTICE_TIMEOUT_MS)]);
    const response = await fetch(
      `/api/quizzes/${encodeURIComponent(target.slug)}/${target.difficulty}/practice/check`,
      {
        body: JSON.stringify(request.data),
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "POST",
        signal: requestSignal,
      },
    );
    if (!response.ok) return publicError(response);
    const parsed = responseSchema.safeParse(await response.json());
    if (
      !parsed.success ||
      parsed.data.data.quizVariantId !== target.quizVariantId ||
      parsed.data.data.quizRevision !== target.quizRevision ||
      !matchesRevealedSolution(parsed.data.data.solution, target.grid) ||
      !matchesAnswers(parsed.data.data, request.data, target.grid)
    ) {
      return unavailable("채점 결과를 확인하지 못했습니다. 같은 답안으로 다시 시도해 주세요.");
    }
    return { ok: true, data: parsed.data.data };
  } catch {
    return unavailable("채점 결과를 받지 못했습니다. 연결을 확인하고 다시 시도해 주세요.");
  }
}
