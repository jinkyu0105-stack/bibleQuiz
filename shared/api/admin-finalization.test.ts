import { describe, expect, it } from "vitest";

import {
  closeQuizSetNowDataSchema,
  closeQuizSetNowRequestSchema,
  quizSetIdSchema,
} from "./admin-finalization";

describe("admin finalization API contract", () => {
  it("accepts only an explicit close-now confirmation and a bounded reason", () => {
    expect(closeQuizSetNowRequestSchema.parse({
      confirmation: "close_now",
      reason: "  운영자 확인 후 조기 마감  ",
    })).toEqual({ confirmation: "close_now", reason: "운영자 확인 후 조기 마감" });
    expect(closeQuizSetNowRequestSchema.safeParse({ confirmation: true, reason: "조기 마감" }).success).toBe(false);
    expect(closeQuizSetNowRequestSchema.safeParse({ confirmation: "close_now", reason: "x\n" }).success).toBe(false);
    expect(closeQuizSetNowRequestSchema.safeParse({ confirmation: "close_now", reason: "조기 마감", actorEmail: "private@example.com" }).success).toBe(false);
  });

  it("keeps identifiers and finalization results minimal and relationally valid", () => {
    const data = {
      quizSetId: "quiz-set-1",
      archivedAt: "2026-09-03T00:00:00.000Z",
      outcome: "finalized",
      snapshots: [
        { quizVariantId: "adult-1", winnerCount: 3, winnerSubmissionCount: 2 },
        { quizVariantId: "child-1", winnerCount: 3, winnerSubmissionCount: 1 },
      ],
    };
    expect(closeQuizSetNowDataSchema.parse(data)).toEqual(data);
    expect(closeQuizSetNowDataSchema.safeParse({ ...data, actorEmail: "private@example.com" }).success).toBe(false);
    expect(closeQuizSetNowDataSchema.safeParse({ ...data, snapshots: [data.snapshots[0], data.snapshots[0]] }).success).toBe(false);
    expect(closeQuizSetNowDataSchema.safeParse({ ...data, snapshots: [{ ...data.snapshots[0], winnerSubmissionCount: 4 }, data.snapshots[1]] }).success).toBe(false);
  });

  it("rejects ambiguous or path-like set identifiers", () => {
    expect(quizSetIdSchema.safeParse("quiz_set-123").success).toBe(true);
    expect(quizSetIdSchema.safeParse("../quiz").success).toBe(false);
    expect(quizSetIdSchema.safeParse("").success).toBe(false);
  });
});
