import { describe, expect, it } from "vitest";

import { practiceCheckDataSchema, practiceCheckRequestSchema } from "./practice";

describe("strict archived practice API boundary", () => {
  it("accepts only an exact revision and sparse NFC Hangul cells", () => {
    expect(practiceCheckRequestSchema.parse({
      revision: 3,
      cells: { r0c0: "가".normalize("NFD") },
    })).toEqual({ revision: 3, cells: { r0c0: "가" } });
    expect(practiceCheckRequestSchema.safeParse({ revision: 3, cells: {} }).success).toBe(true);
  });

  it.each([
    ["name", { revision: 3, cells: { r0c0: "가" }, name: "은혜" }],
    ["comment", { revision: 3, cells: { r0c0: "가" }, comment: "저장하지 않음" }],
    ["consent", { revision: 3, cells: { r0c0: "가" }, consent: true }],
    ["idempotency", { revision: 3, cells: { r0c0: "가" }, idempotencyKey: crypto.randomUUID() }],
    ["turnstile", { revision: 3, cells: { r0c0: "가" }, turnstileToken: "token" }],
    ["score", { revision: 3, cells: { r0c0: "가" }, score: 10_000 }],
    ["inactive-shaped key", { revision: 3, cells: { admin: "가" } }],
    ["empty value", { revision: 3, cells: { r0c0: "" } }],
    ["jamo", { revision: 3, cells: { r0c0: "ㄱ" } }],
  ])("rejects %s", (_label, request) => {
    expect(practiceCheckRequestSchema.safeParse(request).success).toBe(false);
  });

  it("accepts only internally consistent non-persistent scoring data", () => {
    const result = {
      quizVariantId: "variant-1",
      quizRevision: 3,
      correctCells: 1,
      totalCells: 2,
      correctWords: 0,
      totalWords: 1,
      scoreBasisPoints: 5_000,
      correctnessMask: "10",
      solution: { cells: { r0c0: "가", r0c1: "나" }, entries: { entry: "가나" } },
    } as const;
    expect(practiceCheckDataSchema.safeParse(result).success).toBe(true);
    expect(practiceCheckDataSchema.safeParse({ ...result, submissionId: "PRIVATE_CANARY" }).success).toBe(false);
    expect(practiceCheckDataSchema.safeParse({ ...result, submittedAt: "2026-09-03T00:00:00.000Z" }).success).toBe(false);
    expect(practiceCheckDataSchema.safeParse({ ...result, correctnessMask: "11" }).success).toBe(false);
    expect(practiceCheckDataSchema.safeParse({ ...result, scoreBasisPoints: 4_999 }).success).toBe(false);
  });
});
