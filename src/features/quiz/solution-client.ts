import { z } from "zod";

import {
  quizSolutionDataSchema,
  type QuizSolutionData,
  type RevealedSolution,
} from "../../../shared/api/solution";
import type { Difficulty } from "../../../shared/api/public-quiz";
import type { PublicPuzzleGrid } from "../../../shared/puzzle/types";

const SOLUTION_TIMEOUT_MS = 15_000;
const solutionResponseSchema = z.strictObject({ data: quizSolutionDataSchema });
const solutionErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(500),
    requestId: z.uuid(),
  }),
});

export interface SolutionClientError {
  code: string;
  message: string;
  requestId?: string;
}

export interface SolutionTarget {
  difficulty: Difficulty;
  grid: PublicPuzzleGrid;
  quizRevision: number;
  quizVariantId: string;
  slug: string;
}

export type SolutionClientResult =
  | { ok: true; data: QuizSolutionData }
  | { ok: false; error: SolutionClientError };

function unavailable(message: string): SolutionClientResult {
  return { ok: false, error: { code: "CLIENT_UNAVAILABLE", message } };
}

async function publicError(response: Response): Promise<SolutionClientResult> {
  try {
    const parsed = solutionErrorResponseSchema.safeParse(await response.json());
    if (parsed.success) {
      return {
        ok: false,
        error: {
          code: parsed.data.error.code,
          message: parsed.data.error.message,
          requestId: parsed.data.error.requestId,
        },
      };
    }
  } catch {
    // Arbitrary upstream text is replaced at this browser boundary.
  }
  return unavailable("정답을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

export function matchesRevealedSolution(solution: RevealedSolution, grid: PublicPuzzleGrid): boolean {
  const solutionCellIds = Object.keys(solution.cells).sort();
  const publicCellIds = grid.cells.map((cell) => cell.id).sort();
  const solutionEntryIds = Object.keys(solution.entries).sort();
  const publicEntryIds = grid.entries.map((entry) => entry.id).sort();
  if (
    solutionCellIds.length !== publicCellIds.length ||
    solutionEntryIds.length !== publicEntryIds.length ||
    solutionCellIds.some((cellId, index) => cellId !== publicCellIds[index]) ||
    solutionEntryIds.some((entryId, index) => entryId !== publicEntryIds[index])
  ) {
    return false;
  }

  const cellAt = new Map(grid.cells.map((cell) => [`${cell.row}:${cell.column}`, cell.id]));
  return grid.entries.every((entry) => {
    let answer = "";
    for (let offset = 0; offset < entry.length; offset += 1) {
      const row = entry.start.row + (entry.direction === "down" ? offset : 0);
      const column = entry.start.column + (entry.direction === "across" ? offset : 0);
      const cellId = cellAt.get(`${row}:${column}`);
      const syllable = cellId === undefined ? undefined : solution.cells[cellId];
      if (syllable === undefined) return false;
      answer += syllable;
    }
    return solution.entries[entry.id] === answer;
  });
}

export async function readQuizSolution(
  target: SolutionTarget,
  signal?: AbortSignal,
): Promise<SolutionClientResult> {
  try {
    const requestSignal = signal === undefined
      ? AbortSignal.timeout(SOLUTION_TIMEOUT_MS)
      : AbortSignal.any([signal, AbortSignal.timeout(SOLUTION_TIMEOUT_MS)]);
    const response = await fetch(
      `/api/quizzes/${encodeURIComponent(target.slug)}/${target.difficulty}/solution`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "GET",
        signal: requestSignal,
      },
    );
    if (!response.ok) return publicError(response);
    const parsed = solutionResponseSchema.safeParse(await response.json());
    if (
      !parsed.success ||
      parsed.data.data.quizVariantId !== target.quizVariantId ||
      parsed.data.data.quizRevision !== target.quizRevision ||
      !matchesRevealedSolution(parsed.data.data.solution, target.grid)
    ) {
      return unavailable("정답 응답을 확인하지 못했습니다.");
    }
    return { ok: true, data: parsed.data.data };
  } catch {
    return unavailable("정답을 불러오지 못했습니다. 연결을 확인해 주세요.");
  }
}
