import { describe, expect, it } from "vitest";

import {
  ownSubmissionDataSchema,
  submissionDeletionDataSchema,
  submissionDeletionRequestSchema,
  submissionRequestSchema,
  submissionResultSchema,
} from "./submission";

const validRequest = {
  revision: 3,
  idempotencyKey: "01924f8e-7b2a-7f1c-8f3a-123456789abc",
  turnstileToken: "test-token",
  name: "은혜",
  comment: "말씀을 다시 생각해 보았어요.",
  consent: true,
  cells: { r0c1: "믿", r0c2: "음" },
} as const;

describe("strict submission API boundary", () => {
  it("accepts sparse written cells and normalizes decomposed Hangul to NFC", () => {
    const request = submissionRequestSchema.parse({
      ...validRequest,
      comment: "",
      cells: { r0c1: "가".normalize("NFD") },
    });

    expect(request.cells).toEqual({ r0c1: "가" });
  });

  it("leaves a completely empty sparse map for the scoring service's stable EMPTY_SUBMISSION error", () => {
    expect(submissionRequestSchema.safeParse({ ...validRequest, cells: {} }).success).toBe(true);
  });

  it("accepts only a strict empty deletion request", () => {
    expect(submissionDeletionRequestSchema.safeParse({}).success).toBe(true);
    expect(submissionDeletionRequestSchema.safeParse({ confirmation: true }).success).toBe(false);
    expect(submissionDeletionRequestSchema.safeParse(null).success).toBe(false);
  });

  it.each([
    ["client score", { ...validRequest, score: 10_000 }],
    ["client rank", { ...validRequest, rank: 1 }],
    ["client correctness", { ...validRequest, correctness: [true, true] }],
    ["missing consent", Object.fromEntries(Object.entries(validRequest).filter(([key]) => key !== "consent"))],
    ["false consent", { ...validRequest, consent: false }],
    ["non-v7 idempotency key", { ...validRequest, idempotencyKey: "550e8400-e29b-41d4-a716-446655440000" }],
    ["oversized Turnstile token", { ...validRequest, turnstileToken: "x".repeat(2_049) }],
    ["inactive-shaped key", { ...validRequest, cells: { admin: "가" } }],
    ["empty cell value", { ...validRequest, cells: { r0c0: "" } }],
    ["incomplete jamo", { ...validRequest, cells: { r0c0: "ㄱ" } }],
  ])("rejects %s", (_label, request) => {
    expect(submissionRequestSchema.safeParse(request).success).toBe(false);
  });

  it("accepts only internally consistent post-save result totals", () => {
    const result = {
      submissionId: "submission-1",
      submittedAt: "2026-09-01T00:00:00.000Z",
      correctCells: 1,
      totalCells: 2,
      correctWords: 0,
      totalWords: 1,
      scoreBasisPoints: 5_000,
      correctnessMask: "10",
      canRevealAnswer: true,
      solution: { cells: { r0c0: "가", r0c1: "나" }, entries: { first: "가나" } },
    } as const;

    expect(submissionResultSchema.safeParse(result).success).toBe(true);
    expect(submissionResultSchema.safeParse({ ...result, correctnessMask: "1" }).success).toBe(false);
    expect(submissionResultSchema.safeParse({ ...result, correctnessMask: "11" }).success).toBe(false);
    expect(submissionResultSchema.safeParse({ ...result, correctCells: 3 }).success).toBe(false);
    expect(submissionResultSchema.safeParse({ ...result, scoreBasisPoints: 4_999 }).success).toBe(false);
    expect(submissionResultSchema.safeParse({ ...result, solution: { ...result.solution, privateHash: "canary" } }).success).toBe(false);
  });

  it("restores only the current session's minimal submitted or deleted state", () => {
    const result = submissionResultSchema.parse({
      submissionId: "submission-1",
      submittedAt: "2026-09-01T00:00:00.000Z",
      correctCells: 1,
      totalCells: 2,
      correctWords: 0,
      totalWords: 1,
      scoreBasisPoints: 5_000,
      correctnessMask: "10",
      canRevealAnswer: true,
      solution: { cells: { r0c0: "가", r0c1: "나" }, entries: { first: "가나" } },
    });
    const submitted = {
      submission: {
        status: "submitted",
        quizVariantId: "variant-1",
        quizRevision: 3,
        answers: { r0c0: "가" },
        result,
      },
    } as const;

    expect(ownSubmissionDataSchema.safeParse({ submission: null }).success).toBe(true);
    expect(ownSubmissionDataSchema.safeParse(submitted).success).toBe(true);
    expect(ownSubmissionDataSchema.safeParse({
      submission: {
        status: "deleted",
        quizVariantId: "variant-1",
        quizRevision: 3,
        deletedAt: "2026-09-02T00:00:00.000Z",
      },
    }).success).toBe(true);
    expect(ownSubmissionDataSchema.safeParse({
      submission: { ...submitted.submission, answers: { r9c9: "가" } },
    }).success).toBe(false);
    expect(ownSubmissionDataSchema.safeParse({
      submission: { ...submitted.submission, displayName: "PRIVATE_CANARY" },
    }).success).toBe(false);
    expect(ownSubmissionDataSchema.safeParse({
      submission: {
        status: "deleted",
        quizVariantId: "variant-1",
        quizRevision: 3,
        deletedAt: "2026-09-02T00:00:00.000Z",
        solution: result.solution,
      },
    }).success).toBe(false);
  });

  it("returns only the minimal deletion tombstone", () => {
    const deleted = {
      submission: {
        status: "deleted",
        quizVariantId: "variant-1",
        quizRevision: 3,
        deletedAt: "2026-09-02T00:00:00.000Z",
      },
    } as const;

    expect(submissionDeletionDataSchema.safeParse(deleted).success).toBe(true);
    expect(submissionDeletionDataSchema.safeParse({
      submission: { ...deleted.submission, answers: { r0c0: "가" } },
    }).success).toBe(false);
    expect(submissionDeletionDataSchema.safeParse({
      submission: { ...deleted.submission, displayName: "PRIVATE_CANARY" },
    }).success).toBe(false);
    expect(submissionDeletionDataSchema.safeParse({ submission: null }).success).toBe(false);
  });
});
