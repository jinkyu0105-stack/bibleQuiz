import { describe, expect, it } from "vitest";

import {
  deleteSubmissionAsAdminRequestSchema,
  deletedSubmissionAsAdminDataSchema,
  moderateSubmissionRequestSchema,
  moderatedSubmissionDataSchema,
} from "./admin-submission-moderation";

describe("administrator submission moderation contract", () => {
  it("accepts only strict hide and unhide requests with a safe reason", () => {
    expect(moderateSubmissionRequestSchema.parse({
      action: "hide",
      reason: "  공개 부적합 표현 확인  ",
    })).toEqual({ action: "hide", reason: "공개 부적합 표현 확인" });
    expect(moderateSubmissionRequestSchema.safeParse({
      action: "unhide",
      reason: "복구\n사유",
    }).success).toBe(false);
    expect(moderateSubmissionRequestSchema.safeParse({
      action: "delete",
      reason: "삭제 시도",
    }).success).toBe(false);
    expect(moderateSubmissionRequestSchema.safeParse({
      action: "hide",
      reason: "숨김",
      actorEmail: "attacker@example.com",
    }).success).toBe(false);
  });

  it("requires an explicit strict delete confirmation", () => {
    expect(deleteSubmissionAsAdminRequestSchema.parse({
      confirmation: "delete",
      reason: "삭제 요청 확인 완료",
    })).toEqual({ confirmation: "delete", reason: "삭제 요청 확인 완료" });
    expect(deleteSubmissionAsAdminRequestSchema.safeParse({
      confirmation: "yes",
      reason: "삭제 요청 확인 완료",
    }).success).toBe(false);
    expect(deleteSubmissionAsAdminRequestSchema.safeParse({
      confirmation: "delete",
      reason: "삭제 요청 확인 완료",
      submissionId: "private-target",
    }).success).toBe(false);
  });

  it("keeps success responses minimal and rejects private extras", () => {
    expect(moderatedSubmissionDataSchema.parse({
      outcome: "changed",
      status: "hidden",
      submissionId: "submission-1",
    })).toEqual({ outcome: "changed", status: "hidden", submissionId: "submission-1" });
    expect(deletedSubmissionAsAdminDataSchema.safeParse({
      deletedAt: "2026-09-03T00:00:00.000Z",
      outcome: "changed",
      status: "deleted",
      submissionId: "submission-1",
      displayName: "비공개 이름",
    }).success).toBe(false);
  });
});
