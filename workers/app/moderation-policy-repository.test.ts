import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createDatabase } from "../_shared/db/client";
import {
  moderationExceptions,
  moderationTerms,
  reservedNames,
} from "../_shared/db/schema";
import {
  InvalidStoredModerationPolicy,
  createModerationPolicyRepository,
} from "../_shared/repositories/moderation-policy-repository";
import {
  inspectModerationValue,
  inspectReservedName,
  normalizeModerationValue,
  normalizeReservedName,
} from "../_shared/services/content-moderation";

const binding = env as Env;
const database = createDatabase(binding.DB);
const repository = createModerationPolicyRepository(database);
const now = "2026-09-01T00:00:00.000Z";

describe("moderation policy D1 repository", () => {
  it("loads one deterministic active snapshot without admin metadata", async () => {
    await database.insert(reservedNames).values([
      {
        id: "reserved-b",
        protectedGroupId: "synthetic-person-group",
        displayLabel: "합성 담당자 별칭",
        normalizedValue: normalizeReservedName("합성 담당자"),
        category: "alias",
        enabled: true,
        createdBy: "test-admin",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "reserved-disabled",
        displayLabel: "비활성 합성 이름",
        normalizedValue: normalizeReservedName("비활성 합성 이름"),
        category: "person",
        enabled: false,
        createdBy: "test-admin",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await database.insert(moderationTerms).values([
      {
        id: "term-b",
        scope: "all",
        normalizedPattern: normalizeModerationValue("합성 차단 표현"),
        matchMode: "contains",
        enabled: true,
        createdBy: "test-admin",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "term-disabled",
        scope: "comment",
        normalizedPattern: normalizeModerationValue("비활성 표현"),
        matchMode: "exact",
        enabled: false,
        createdBy: "test-admin",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await database.insert(moderationExceptions).values({
      id: "exception-a",
      scope: "comment",
      normalizedValue: normalizeModerationValue("허용된 합성 차단 표현"),
      reason: "합성 회귀용 exact 예외",
      enabled: true,
      createdBy: "test-admin",
      createdAt: now,
      updatedAt: now,
    });

    const policy = await repository.loadActivePolicy();

    expect(policy).toEqual({
      exceptions: [{
        enabled: true,
        id: "exception-a",
        normalizedValue: "허용된합성차단표현",
        scope: "comment",
      }],
      reservedNames: [{
        enabled: true,
        id: "reserved-b",
        normalizedValue: "합성담당자",
      }],
      rules: [{
        enabled: true,
        id: "term-b",
        matchMode: "contains",
        normalizedPattern: "합성차단표현",
        scope: "all",
      }],
    });
    expect(inspectReservedName("합성 담당자", policy).blocked).toBe(true);
    expect(inspectModerationValue("answer", "합성차단표현", policy).blocked).toBe(true);
    expect(inspectModerationValue("comment", "허용된 합성 차단 표현", policy).blocked).toBe(false);
    expect(JSON.stringify(policy)).not.toContain("test-admin");
    expect(JSON.stringify(policy)).not.toContain("합성 회귀용 exact 예외");
    expect(JSON.stringify(policy)).not.toContain("합성 담당자 별칭");
  });

  it("enforces enum, value, uniqueness, boolean and timestamp constraints", async () => {
    const insertTerm = `INSERT INTO moderation_terms (
      id, scope, normalized_pattern, match_mode, enabled, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    await binding.DB.prepare(insertTerm).bind(
      "valid-term",
      "comment",
      "합성표현",
      "exact",
      1,
      "test-admin",
      now,
      now,
    ).run();

    for (const values of [
      ["invalid-scope", "invalid", "다른표현", "exact", 1, "test-admin", now, now],
      ["invalid-mode", "comment", "다른표현", "fuzzy", 1, "test-admin", now, now],
      ["invalid-enabled", "comment", "다른표현", "exact", 2, "test-admin", now, now],
      ["invalid-time", "comment", "다른표현", "exact", 1, "test-admin", now, "2026-08-31T00:00:00.000Z"],
      ["duplicate-term", "comment", "합성표현", "exact", 1, "test-admin", now, now],
    ] as const) {
      await expect(binding.DB.prepare(insertTerm).bind(...values).run()).rejects.toThrow();
    }

    await expect(binding.DB.prepare(`INSERT INTO moderation_exceptions (
      id, scope, normalized_value, reason, enabled, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("invalid-exception", "comment", "합성예외", " ", 1, "test-admin", now, now)
      .run()).rejects.toThrow();
  });

  it("fails closed when stored normalized data bypasses the canonical write boundary", async () => {
    await database.insert(moderationTerms).values({
      id: "noncanonical-term",
      scope: "comment",
      normalizedPattern: "합성 비정규 표현",
      matchMode: "contains",
      enabled: true,
      createdBy: "test-admin",
      createdAt: now,
      updatedAt: now,
    });

    await expect(repository.loadActivePolicy()).rejects.toThrowError(
      InvalidStoredModerationPolicy,
    );
  });
});
