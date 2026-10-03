import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDatabase } from "../_shared/db/client";
import {
  anonymousSessions,
  auditLogs,
  bibleTranslations,
  moderationActions,
  quizSets,
  quizVariants,
  sermons,
  submissions,
} from "../_shared/db/schema";
import {
  SubmissionModerationInvalidState,
  SubmissionModerationUnavailable,
  createSubmissionModerationService,
} from "../_shared/services/submission-moderation";
import { createSubmissionDeletionRetentionService } from "../_shared/services/submission-deletion-retention";
import { createAccessFixture } from "./test/access-fixture";

const binding = env as Env;
const database = createDatabase(binding.DB);
const createdAt = "2026-09-01T00:00:00.000Z";
const changedAt = "2026-09-03T00:00:00.000Z";

async function seedSubmission(suffix: string) {
  const translationId = `moderation-translation-${suffix}`;
  const sermonId = `moderation-sermon-${suffix}`;
  const quizSetId = `moderation-set-${suffix}`;
  const quizVariantId = `moderation-variant-${suffix}`;
  const submissionId = `moderation-submission-${suffix}`;
  const sessionHash = "a".repeat(64);
  await database.insert(bibleTranslations).values({
    createdAt,
    displayName: "개역개정",
    edition: "reference-only",
    id: translationId,
    mode: "reference_only",
    publisherOrRightsholder: "대한성서공회",
    updatedAt: createdAt,
  });
  await database.insert(sermons).values({
    bibleReferenceJson: [],
    bibleReferenceLabel: "마태복음 5:1-2",
    bibleTranslationId: translationId,
    churchName: "테스트 교회",
    createdAt,
    id: sermonId,
    sermonDate: "2026-09-01",
    sermonTitle: "관리자 제출 관리 시험",
    slugSuffix: suffix.padEnd(6, "0").slice(0, 6),
    updatedAt: createdAt,
    youtubeUrl: `https://example.com/${suffix}`,
    youtubeVideoId: `moderation-${suffix}`,
  });
  await database.insert(quizSets).values({
    closesAt: "2026-09-08T00:00:00.000Z",
    createdAt,
    createdBy: "test-admin",
    id: quizSetId,
    opensAt: "2026-08-31T00:00:00.000Z",
    publishedAt: createdAt,
    sermonId,
    status: "published",
    updatedAt: createdAt,
  });
  await database.insert(quizVariants).values({
    activeCellCount: 2,
    createdAt,
    difficulty: "child",
    gridSize: 5,
    id: quizVariantId,
    intersectionCount: 0,
    publicGridJson: { cells: [], size: 5 },
    quizSetId,
    revision: 1,
    validationReportJson: { errors: [], generatedAt: createdAt, warnings: [] },
    wordCount: 1,
  });
  await database.insert(anonymousSessions).values({
    createdAt,
    expiresAt: "2027-03-01T00:00:00.000Z",
    lastSeenAt: createdAt,
    sessionHash,
  });
  await database.insert(submissions).values({
    answersJson: { r0c0: "가" },
    comment: "공개 코멘트",
    correctCells: 1,
    correctnessMask: "10",
    correctWords: 0,
    displayName: "공개이름",
    id: submissionId,
    idempotencyKey: "01924f8e-7b2a-7f1c-8f3a-123456789abc",
    isFullyCorrect: false,
    quizRevision: 1,
    quizVariantId,
    requestHash: "c".repeat(64),
    scoreBasisPoints: 5_000,
    sessionHash,
    status: "visible",
    submittedAt: "2026-09-01T00:05:00.000Z",
    totalCells: 2,
    totalWords: 1,
  });
  return { quizVariantId, submissionId };
}

function ids(prefix: string, deletion = false) {
  return {
    actionId: `${prefix}-action`,
    auditId: `${prefix}-audit`,
    ...(deletion ? { deletionMarkerAuditId: `${prefix}-marker` } : {}),
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await database.delete(moderationActions);
  await database.delete(submissions);
  await database.delete(anonymousSessions);
  await database.delete(auditLogs);
  await database.delete(quizSets);
  await database.delete(sermons);
  await database.delete(bibleTranslations);
});

describe("administrator submission moderation / isolated migrated D1", () => {
  it("uses exact transitions, idempotent replay and atomic action/audit writes", async () => {
    const target = await seedSubmission("flow01");
    const service = createSubmissionModerationService(database);
    await expect(service.moderate({
      action: "hide",
      actorEmail: "not-an-email",
      changedAt,
      ids: ids("invalid-actor"),
      reason: "잘못된 관리자",
      submissionId: target.submissionId,
    })).rejects.toBeInstanceOf(SubmissionModerationUnavailable);
    await expect(service.moderate({
      action: "hide",
      actorEmail: "admin@example.com",
      changedAt,
      ids: ids("invalid-reason"),
      reason: "잘못된\n사유",
      submissionId: target.submissionId,
    })).rejects.toBeInstanceOf(SubmissionModerationUnavailable);
    await expect(service.moderate({
      action: "unhide",
      actorEmail: "admin@example.com",
      changedAt,
      ids: ids("invalid-unhide"),
      reason: "처음부터 공개 상태",
      submissionId: target.submissionId,
    })).rejects.toBeInstanceOf(SubmissionModerationInvalidState);

    const hidden = await service.moderate({
      action: "hide",
      actorEmail: "admin@example.com",
      changedAt,
      ids: ids("hide"),
      reason: "공개 내용 검토 필요",
      submissionId: target.submissionId,
    });
    expect(hidden).toEqual({
      outcome: "changed",
      status: "hidden",
      submissionId: target.submissionId,
    });
    await expect(service.moderate({
      action: "hide",
      actorEmail: "admin@example.com",
      changedAt: "2026-09-03T00:01:00.000Z",
      ids: ids("hide-retry"),
      reason: "네트워크 재시도",
      submissionId: target.submissionId,
    })).resolves.toMatchObject({ outcome: "replayed", status: "hidden" });
    expect(await database.select().from(moderationActions)).toHaveLength(1);
    expect(await database.select().from(auditLogs)).toHaveLength(1);

    await service.moderate({
      action: "unhide",
      actorEmail: "admin@example.com",
      changedAt: "2026-09-03T00:02:00.000Z",
      ids: ids("unhide"),
      reason: "검토 결과 공개 가능",
      submissionId: target.submissionId,
    });
    expect(await database.select({
      hiddenAt: submissions.hiddenAt,
      status: submissions.status,
    }).from(submissions)).toEqual([{ hiddenAt: null, status: "visible" }]);

    await database.insert(auditLogs).values({
      action: "collision",
      actorEmail: null,
      actorType: "system",
      createdAt,
      entityId: "collision",
      entityType: "test",
      id: "rollback-audit",
      safeMetadataJson: {},
    });
    await expect(service.moderate({
      action: "hide",
      actorEmail: "admin@example.com",
      changedAt: "2026-09-03T00:03:00.000Z",
      ids: { actionId: "rollback-action", auditId: "rollback-audit" },
      reason: "감사 충돌 rollback",
      submissionId: target.submissionId,
    })).rejects.toBeInstanceOf(SubmissionModerationUnavailable);
    expect(await database.select({ status: submissions.status }).from(submissions))
      .toEqual([{ status: "visible" }]);
    expect(await database.select().from(moderationActions)).toHaveLength(2);

    const races = await Promise.all([
      service.moderate({
        action: "hide",
        actorEmail: "admin@example.com",
        changedAt: "2026-09-03T00:04:00.000Z",
        ids: ids("race-a"),
        reason: "동시 요청 A",
        submissionId: target.submissionId,
      }),
      service.moderate({
        action: "hide",
        actorEmail: "admin@example.com",
        changedAt: "2026-09-03T00:04:00.000Z",
        ids: ids("race-b"),
        reason: "동시 요청 B",
        submissionId: target.submissionId,
      }),
    ]);
    expect(races.map((result) => result.outcome).sort()).toEqual(["changed", "replayed"]);
    expect(await database.select().from(moderationActions)).toHaveLength(3);
  });

  it("authenticates before transport validation and exposes only a minimal delete result", async () => {
    vi.useFakeTimers({ now: new Date(changedAt) });
    const target = await seedSubmission("route1");
    const fixture = await createAccessFixture(new Date(changedAt));
    const certs = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.jwks));
    const endpoint = `https://example.com/api/admin/submissions/${target.submissionId}`;

    const unauthenticated = await exports.default.fetch(new Request(endpoint, {
      body: JSON.stringify({ action: "hide", reason: "인증 우선 검사" }),
      headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      method: "PATCH",
    }));
    expect(unauthenticated.status).toBe(401);
    expect(certs).not.toHaveBeenCalled();

    const headers = {
      "Cf-Access-Jwt-Assertion": fixture.token,
      "Content-Type": "application/json",
      Origin: "https://example.com",
    };
    const invalid = await exports.default.fetch(new Request(endpoint, {
      body: JSON.stringify({ confirmation: "delete", reason: "삭제 확인", extra: true }),
      headers,
      method: "DELETE",
    }));
    expect(invalid.status).toBe(400);
    const wrongMethod = await exports.default.fetch(new Request(endpoint, {
      headers: { "Cf-Access-Jwt-Assertion": fixture.token },
      method: "GET",
    }));
    expect(wrongMethod.status).toBe(405);
    const wrongOrigin = await exports.default.fetch(new Request(endpoint, {
      body: JSON.stringify({ action: "hide", reason: "출처 검사" }),
      headers: { ...headers, Origin: "https://attacker.example" },
      method: "PATCH",
    }));
    expect(wrongOrigin.status).toBe(403);

    const hidden = await exports.default.fetch(new Request(endpoint, {
      body: JSON.stringify({ action: "hide", reason: "공개 내용 확인 중" }),
      headers,
      method: "PATCH",
    }));
    expect(hidden.status).toBe(200);
    await expect(hidden.json()).resolves.toEqual({
      data: {
        outcome: "changed",
        status: "hidden",
        submissionId: target.submissionId,
      },
    });
    const unhidden = await exports.default.fetch(new Request(endpoint, {
      body: JSON.stringify({ action: "unhide", reason: "검토 결과 공개 가능" }),
      headers,
      method: "PATCH",
    }));
    expect(unhidden.status).toBe(200);
    await expect(unhidden.json()).resolves.toMatchObject({
      data: { outcome: "changed", status: "visible" },
    });

    const response = await exports.default.fetch(new Request(endpoint, {
      body: JSON.stringify({ confirmation: "delete", reason: "삭제 요청 처리 완료" }),
      headers,
      method: "DELETE",
    }));
    const raw = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(JSON.parse(raw)).toEqual({
      data: {
        deletedAt: changedAt,
        outcome: "changed",
        status: "deleted",
        submissionId: target.submissionId,
      },
    });
    for (const privateValue of ["admin@example.com", "삭제 요청 처리 완료", "공개이름", "공개 코멘트"]) {
      expect(raw).not.toContain(privateValue);
    }
    expect(await database.select().from(moderationActions)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "hide", actorEmail: "admin@example.com" }),
      expect.objectContaining({ action: "unhide", actorEmail: "admin@example.com" }),
      expect.objectContaining({ action: "delete", actorEmail: "admin@example.com" }),
    ]));
    expect(await database.select().from(auditLogs)).toHaveLength(4);
    const manifest = await createSubmissionDeletionRetentionService(database)
      .buildManifest("2026-09-03T01:00:00.000Z");
    expect(manifest.entries).toEqual([
      expect.objectContaining({
        deletionSource: "access_admin",
        submissionId: target.submissionId,
      }),
    ]);

    const replay = await exports.default.fetch(new Request(endpoint, {
      body: JSON.stringify({ confirmation: "delete", reason: "삭제 재시도" }),
      headers,
      method: "DELETE",
    }));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ data: { outcome: "replayed" } });
    expect(await database.select().from(moderationActions)).toHaveLength(3);

    const marker = manifest.entries[0]!;
    await database.delete(auditLogs).where(eq(auditLogs.id, marker.auditId));
    await database.update(submissions).set({
      answersJson: { r0c0: "가" },
      comment: "과거 backup 코멘트",
      deletedAt: null,
      displayName: "과거backup이름",
      status: "visible",
    }).where(eq(submissions.id, target.submissionId));
    const retention = createSubmissionDeletionRetentionService(database);
    await expect(retention.reapplyManifestBeforePublicReopen(manifest)).resolves.toMatchObject({
      deletedTombstones: 1,
      entries: 1,
    });
    await expect(retention.purgeDeletedTombstones({
      boundary: "privacy_purpose_ended",
      entries: manifest.entries,
      purgedAt: "2026-09-03T02:00:00.000Z",
    })).resolves.toEqual({ alreadyAbsent: 0, purged: 1 });
    expect(await database.select().from(submissions)).toHaveLength(0);
    expect(await database.select().from(moderationActions)).toHaveLength(0);
    expect(await database.select().from(auditLogs).where(eq(auditLogs.actorType, "access_admin")))
      .toHaveLength(0);
    vi.useRealTimers();
  });
});
