import { z } from "zod";

import {
  participationBoardDataSchema,
  type ParticipationBoardData,
} from "../../../shared/api/participation-board";
import type { Difficulty } from "../../../shared/api/public-quiz";

const BOARD_TIMEOUT_MS = 15_000;
const boardResponseSchema = z.strictObject({ data: participationBoardDataSchema });
const boardErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(500),
    requestId: z.uuid(),
  }),
});

export interface ParticipationBoardClientError {
  code: string;
  message: string;
  requestId?: string;
}

export type ParticipationBoardClientResult =
  | { ok: true; data: ParticipationBoardData }
  | { ok: false; error: ParticipationBoardClientError };

export interface ParticipationBoardTarget {
  difficulty: Difficulty;
  slug: string;
}

function unavailable(message: string): ParticipationBoardClientResult {
  return { ok: false, error: { code: "CLIENT_UNAVAILABLE", message } };
}

async function publicError(response: Response): Promise<ParticipationBoardClientResult> {
  try {
    const parsed = boardErrorResponseSchema.safeParse(await response.json());
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
    // Arbitrary upstream text is replaced at the strict browser boundary.
  }
  return unavailable("참여 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

export async function readParticipationBoard(
  target: ParticipationBoardTarget,
  signal?: AbortSignal,
): Promise<ParticipationBoardClientResult> {
  try {
    const requestSignal = signal === undefined
      ? AbortSignal.timeout(BOARD_TIMEOUT_MS)
      : AbortSignal.any([signal, AbortSignal.timeout(BOARD_TIMEOUT_MS)]);
    const response = await fetch(
      `/api/quizzes/${encodeURIComponent(target.slug)}/${target.difficulty}/board`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "GET",
        signal: requestSignal,
      },
    );
    if (!response.ok) return publicError(response);
    const parsed = boardResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { ok: true, data: parsed.data.data }
      : unavailable("참여 현황 응답을 확인하지 못했습니다.");
  } catch {
    return unavailable("참여 현황을 불러오지 못했습니다. 연결을 확인해 주세요.");
  }
}
