import { afterEach, describe, expect, it, vi } from "vitest";

import { participationBoardDataSchema } from "../../../shared/api/participation-board";
import { readParticipationBoard } from "./participation-board-client";

afterEach(() => vi.unstubAllGlobals());

const board = participationBoardDataSchema.parse({
  winnerCount: 3,
  participants: [{
    submissionOrder: 1,
    displayName: "은혜",
    submittedAt: "2026-09-02T00:00:00.000Z",
    comment: "감사합니다",
    answers: { r0c0: "가", r0c1: "나" },
    correctCellIds: ["r0c0"],
    isFullyCorrect: false,
    isMine: true,
  }],
  winners: [],
});

describe("participation board browser client", () => {
  it("reads a strict same-origin no-store board", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: board }));
    vi.stubGlobal("fetch", fetcher);

    await expect(readParticipationBoard({
      slug: "2026-09-02-board1",
      difficulty: "child",
    })).resolves.toEqual({ ok: true, data: board });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/quizzes/2026-09-02-board1/child/board",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
  });

  it("keeps only validated public errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: {
        code: "SUBMISSION_REQUIRED",
        message: "답안을 제출한 후 참여 현황을 볼 수 있습니다.",
        requestId: "123e4567-e89b-42d3-a456-426614174000",
      },
    }, { status: 403 })));

    await expect(readParticipationBoard({
      slug: "2026-09-02-board1",
      difficulty: "child",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "SUBMISSION_REQUIRED", requestId: expect.any(String) },
    });
  });

  it("rejects private extras and malformed upstream text without exposing them", async () => {
    for (const response of [
      Response.json({
        data: {
          ...board,
          participants: [{ ...board.participants[0], sessionHash: "PRIVATE_CANARY" }],
        },
      }),
      new Response("PRIVATE_CANARY", { status: 503 }),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const result = await readParticipationBoard({
        slug: "2026-09-02-board1",
        difficulty: "child",
      });
      expect(result).toMatchObject({ ok: false, error: { code: "CLIENT_UNAVAILABLE" } });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
    }
  });
});
