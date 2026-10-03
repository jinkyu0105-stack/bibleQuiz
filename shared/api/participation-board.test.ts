import { describe, expect, it } from "vitest";

import { participationBoardDataSchema } from "./participation-board";

const participant = {
  submissionOrder: 1,
  displayName: "은혜",
  submittedAt: "2026-09-02T00:00:00.000Z",
  comment: "감사합니다",
  answers: { r0c0: "가" },
  correctCellIds: ["r0c0"],
  isFullyCorrect: true,
  isMine: true,
} as const;

describe("participation board public contract", () => {
  it("accepts a minimal ordered board and archived rank gaps", () => {
    expect(participationBoardDataSchema.safeParse({
      winnerCount: 3,
      participants: [
        participant,
        {
          ...participant,
          submissionOrder: 2,
          displayName: "사랑",
          submittedAt: "2026-09-02T00:01:00.000Z",
          comment: null,
          isMine: false,
        },
      ],
      winners: [
        { rank: 1, submissionOrder: 1 },
        { rank: 3, submissionOrder: 2 },
      ],
    }).success).toBe(true);
  });

  it("rejects private extras, invalid text and non-canonical answers", () => {
    for (const changed of [
      { ...participant, sessionHash: "PRIVATE_CANARY" },
      { ...participant, displayName: " 관리자 " },
      { ...participant, comment: "줄바꿈\n금지" },
      { ...participant, comment: "<script>" },
      { ...participant, answers: {} },
      { ...participant, answers: { r0c0: "가" } },
      { ...participant, correctCellIds: ["r0c1"] },
      { ...participant, correctCellIds: ["r0c0", "r0c0"] },
      { ...participant, correctCellIds: [] },
    ]) {
      expect(participationBoardDataSchema.safeParse({
        winnerCount: 3,
        participants: [changed],
        winners: [],
      }).success).toBe(false);
    }
  });

  it("rejects broken participant and winner relationships", () => {
    const incomplete = { ...participant, isFullyCorrect: false };
    for (const board of [
      { winnerCount: 3, participants: [{ ...participant, submissionOrder: 2 }], winners: [] },
      { winnerCount: 3, participants: [participant, { ...participant, submissionOrder: 2 }], winners: [] },
      { winnerCount: 3, participants: [incomplete], winners: [{ rank: 1, submissionOrder: 1 }] },
      { winnerCount: 2, participants: [participant], winners: [{ rank: 3, submissionOrder: 1 }] },
      { winnerCount: 3, participants: [participant], winners: [
        { rank: 2, submissionOrder: 1 },
        { rank: 1, submissionOrder: 1 },
      ] },
    ]) {
      expect(participationBoardDataSchema.safeParse(board).success).toBe(false);
    }
  });
});
