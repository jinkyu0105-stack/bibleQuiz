import { describe, expect, it } from "vitest";

import type { PublicPuzzleGrid } from "../../shared/puzzle/types";
import {
  InvalidModerationPolicy,
  InvalidModerationSource,
  collectSubmittedAnswerStrings,
  inspectModerationValue,
  moderateSubmissionContent,
  normalizeModerationValue,
  normalizeReservedName,
  type ModerationPolicy,
} from "../_shared/services/content-moderation";

const grid: PublicPuzzleGrid = {
  gridSize: 5,
  cells: [
    { id: "r0c0", row: 0, column: 0, number: 1 },
    { id: "r0c1", row: 0, column: 1 },
    { id: "r1c0", row: 1, column: 0 },
  ],
  entries: [
    { id: "across-1", number: 1, direction: "across", start: { row: 0, column: 0 }, length: 2 },
    { id: "down-1", number: 1, direction: "down", start: { row: 0, column: 0 }, length: 2 },
  ],
};

const emptyPolicy: ModerationPolicy = {
  exceptions: [],
  reservedNames: [],
  rules: [],
};

function input(overrides: Partial<Parameters<typeof moderateSubmissionContent>[0]> = {}) {
  return {
    cells: { r0c0: "가" },
    comment: "말씀 감사합니다!",
    grid,
    name: "은혜",
    ...overrides,
  };
}

function rulePolicy(
  pattern: string,
  scope: "all" | "answer" | "comment" | "name" = "all",
  matchMode: "contains" | "exact" = "contains",
): ModerationPolicy {
  return {
    ...emptyPolicy,
    rules: [{
      enabled: true,
      id: "PRIVATE_RULE_ID",
      matchMode,
      normalizedPattern: normalizeModerationValue(pattern),
      scope,
    }],
  };
}

describe("deterministic public-content moderation", () => {
  it("normalizes safe display values and allows sermon-context words", () => {
    expect(moderateSubmissionContent(input({
      comment: "  목사님 말씀의 죄, 심판, 죽음을 다시 생각했습니다.  ",
      name: "  은혜  ",
    }), emptyPolicy)).toEqual({
      ok: true,
      value: {
        comment: "목사님 말씀의 죄, 심판, 죽음을 다시 생각했습니다.",
        name: "은혜",
      },
    });
    expect(moderateSubmissionContent(input({ comment: "   " }), emptyPolicy))
      .toMatchObject({ ok: true, value: { comment: null } });
  });

  it("rejects malformed names and comments before term matching", () => {
    for (const name of ["은", "은  혜", "은혜!", "은혜\n관리자", "은혜🙂"]) {
      expect(moderateSubmissionContent(input({ name }), emptyPolicy)).toEqual({
        ok: false,
        error: { code: "INVALID_NAME", field: "name" },
      });
    }
    for (const comment of ["줄바꿈\n금지", "<b>태그</b>", "별표*금지", "이모지🙂"]) {
      expect(moderateSubmissionContent(input({ comment }), emptyPolicy)).toEqual({
        ok: false,
        error: { code: "INVALID_COMMENT", field: "comment" },
      });
    }
  });

  it("blocks baseline and explicit reserved names by exact normalized value only", () => {
    expect(moderateSubmissionContent(input({ name: "관 리 자" }), emptyPolicy)).toEqual({
      ok: false,
      error: { code: "NAME_RESERVED", field: "name" },
    });
    const policy: ModerationPolicy = {
      ...emptyPolicy,
      reservedNames: [{
        enabled: true,
        id: "person-alias-1",
        normalizedValue: normalizeReservedName("홍길동 목사"),
      }],
    };
    expect(moderateSubmissionContent(input({ name: "홍길동 목사" }), policy))
      .toMatchObject({ ok: false, error: { code: "NAME_RESERVED" } });
    expect(moderateSubmissionContent(input({ name: "홍길동" }), policy)).toMatchObject({ ok: true });
    expect(moderateSubmissionContent(input({ comment: "관리자님 감사합니다" }), policy)).toMatchObject({ ok: true });
  });

  it("blocks contact information and excessive repetition without echoing the input", () => {
    for (const comment of [
      "연락은 test@example.com",
      "전화 010-1234-5678",
      "https://example.com",
      "example.com에서 만나요",
      "전화 010.1234.5678",
      "감사합니다!!!!!!!!",
      "가 가 가 가 가 가 가 가",
    ]) {
      const result = moderateSubmissionContent(input({ comment }), emptyPolicy);
      expect(result).toEqual({
        ok: false,
        error: { code: "CONTENT_BLOCKED", field: "comment" },
      });
      expect(JSON.stringify(result)).not.toContain(comment);
    }
  });

  it("matches NFKC, separator and repeated-character evasions while honoring exact exceptions", () => {
    const policy = rulePolicy("금지어", "comment");
    expect(moderateSubmissionContent(input({ comment: "금 지...어" }), policy))
      .toMatchObject({ ok: false, error: { code: "CONTENT_BLOCKED", field: "comment" } });
    expect(moderateSubmissionContent(input({ comment: "금지지지지어" }), policy))
      .toMatchObject({ ok: false, error: { code: "CONTENT_BLOCKED", field: "comment" } });

    const exceptionPolicy: ModerationPolicy = {
      ...policy,
      exceptions: [{
        enabled: true,
        id: "exact-exception-1",
        normalizedValue: normalizeModerationValue("좋은 금지어"),
        scope: "comment",
      }],
    };
    expect(moderateSubmissionContent(input({ comment: "좋은 금지어" }), exceptionPolicy))
      .toMatchObject({ ok: true });
    expect(moderateSubmissionContent(input({ comment: "아주 좋은 금지어" }), exceptionPolicy))
      .toMatchObject({ ok: false, error: { code: "CONTENT_BLOCKED" } });
  });

  it("checks entry, row and column answer segments without returning rule evidence publicly", () => {
    const cells = { r0c0: "가", r0c1: "나", r1c0: "다" };
    expect(collectSubmittedAnswerStrings(grid, cells)).toEqual(expect.arrayContaining(["가나", "가다"]));

    const policy = rulePolicy("가나", "answer", "exact");
    const result = moderateSubmissionContent(input({ cells }), policy);
    expect(result).toEqual({
      ok: false,
      error: { code: "CONTENT_BLOCKED", field: "cells" },
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_RULE_ID");
    expect(JSON.stringify(result)).not.toContain("가나");

    expect(inspectModerationValue("answer", "가나", policy)).toEqual({
      blocked: true,
      matchedRuleId: "PRIVATE_RULE_ID",
      normalizedValue: "가나",
    });
  });

  it("fails closed for malformed or duplicate policy records", () => {
    const invalid: ModerationPolicy = {
      ...emptyPolicy,
      rules: [
        { enabled: true, id: "duplicate", matchMode: "exact", normalizedPattern: "금지어", scope: "name" },
        { enabled: true, id: "duplicate", matchMode: "contains", normalizedPattern: "금지어", scope: "comment" },
      ],
    };
    expect(() => moderateSubmissionContent(input(), invalid)).toThrowError(InvalidModerationPolicy);
  });

  it("fails closed for corrupt grid geometry and unvalidated cell input", () => {
    expect(() => collectSubmittedAnswerStrings({
      ...grid,
      cells: [{ id: "r0c1", row: 0, column: 0 }],
    }, { r0c1: "가" })).toThrowError(InvalidModerationSource);
    expect(() => collectSubmittedAnswerStrings(grid, {
      r0c0: "ㄱ",
    })).toThrowError(InvalidModerationSource);
    expect(() => collectSubmittedAnswerStrings({
      ...grid,
      entries: [{
        ...grid.entries[0]!,
        direction: "diagonal" as "across",
      }],
    }, { r0c0: "가" })).toThrowError(InvalidModerationSource);
    expect(() => collectSubmittedAnswerStrings({
      ...grid,
      gridSize: Number.NaN,
    }, { r0c0: "가" })).toThrowError(InvalidModerationSource);
  });
});
