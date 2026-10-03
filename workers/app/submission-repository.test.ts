import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDatabase } from "../_shared/db/client";
import {
  auditLogs,
  bibleTranslations,
  quizSets,
  quizSolutions,
  quizVariants,
  sermons,
  submissions,
} from "../_shared/db/schema";
import {
  InvalidStoredSolution,
  SELF_SERVICE_SUBMISSION_DELETION_ACTION,
  SubmissionSessionUnavailable,
  createSubmissionRepository,
  type VisibleSubmissionWrite,
} from "../_shared/repositories/submission-repository";

const binding = env as Env;
const database = createDatabase(binding.DB);
const repository = createSubmissionRepository(database);
const createdAt = "2026-09-01T00:00:00.000Z";

async function seedVariant(suffix: string) {
  const translationId = `translation-${suffix}`;
  const sermonId = `sermon-${suffix}`;
  const setId = `set-${suffix}`;
  const variantId = `variant-${suffix}`;
  await database.insert(bibleTranslations).values({
    id: translationId,
    displayName: "개역개정",
    edition: "reference-only",
    publisherOrRightsholder: "대한성서공회",
    mode: "reference_only",
    createdAt,
    updatedAt: createdAt,
  });
  await database.insert(sermons).values({
    id: sermonId,
    slugSuffix: suffix,
    churchName: "테스트 교회",
    youtubeUrl: `https://example.com/${suffix}`,
    youtubeVideoId: suffix,
    sermonTitle: "제출 저장 테스트",
    sermonDate: "2026-09-01",
    bibleTranslationId: translationId,
    bibleReferenceJson: [],
    bibleReferenceLabel: "마태복음 5:1-2",
    createdAt,
    updatedAt: createdAt,
  });
  await database.insert(quizSets).values({
    id: setId,
    sermonId,
    status: "published",
    createdBy: "test-admin",
    publishedAt: createdAt,
    opensAt: "2026-08-31T00:00:00.000Z",
    closesAt: "2026-09-08T00:00:00.000Z",
    createdAt,
    updatedAt: createdAt,
  });
  await database.insert(quizVariants).values({
    id: variantId,
    quizSetId: setId,
    difficulty: "child",
    revision: 1,
    gridSize: 5,
    publicGridJson: { size: 5, cells: [] },
    wordCount: 1,
    activeCellCount: 2,
    intersectionCount: 0,
    validationReportJson: { errors: [], warnings: [], generatedAt: createdAt },
    createdAt,
  });
  return variantId;
}

async function seedSolution(variantId: string) {
  await database.insert(quizSolutions).values({
    quizVariantId: variantId,
    canonicalCellOrderJson: ["r0c0", "r0c1"],
    solutionCellsJson: { r0c0: "가", r0c1: "나" },
    entryAnswersJson: { "entry-1": "가나" },
    solutionSha256: "a".repeat(64),
  });
}

function visibleSubmission(
  quizVariantId: string,
  sessionHash: string,
  overrides: Partial<VisibleSubmissionWrite> = {},
): VisibleSubmissionWrite {
  return {
    id: `submission-${quizVariantId}`,
    quizVariantId,
    quizRevision: 1,
    sessionHash,
    idempotencyKey: "01924f8e-7b2a-7f1c-8f3a-123456789abc",
    requestHash: "c".repeat(64),
    displayName: "은혜",
    comment: null,
    answers: { r0c0: "가" },
    correctnessMask: "10",
    correctCells: 1,
    totalCells: 2,
    correctWords: 0,
    totalWords: 1,
    scoreBasisPoints: 5_000,
    isFullyCorrect: false,
    submittedAt: "2026-09-01T00:05:00.000Z",
    ...overrides,
  };
}

describe("Phase 4 submission storage / isolated migrated D1", () => {
  it("reads private solution columns only through the server repository and rejects corrupt shapes", async () => {
    const variantId = await seedVariant("solution-storage");
    await seedSolution(variantId);

    await expect(repository.findScoringSolution(variantId)).resolves.toEqual({
      canonicalCellOrder: ["r0c0", "r0c1"],
      solution: {
        cells: { r0c0: "가", r0c1: "나" },
        entries: { "entry-1": "가나" },
      },
      solutionSha256: "a".repeat(64),
    });

    await database.update(quizSolutions)
      .set({ canonicalCellOrderJson: ["r0c0"] })
      .where(eq(quizSolutions.quizVariantId, variantId));
    await expect(repository.findScoringSolution(variantId)).rejects.toThrowError(
      InvalidStoredSolution,
    );
  });

  it("enforces session hashes/windows and solution JSON/hash/FK constraints", async () => {
    const variantId = await seedVariant("storage-constraints");
    const insertSession = binding.DB.prepare(
      "INSERT INTO anonymous_sessions VALUES (?, ?, ?, ?)",
    );
    await expect(insertSession.bind(
      "not-a-sha256",
      createdAt,
      createdAt,
      "2027-03-01T00:00:00.000Z",
    ).run()).rejects.toThrow(/CHECK constraint failed/u);
    await expect(insertSession.bind(
      "a".repeat(64),
      createdAt,
      "2027-03-01T00:00:00.000Z",
      "2027-03-01T00:00:00.000Z",
    ).run()).rejects.toThrow(/CHECK constraint failed/u);
    await expect(binding.DB.prepare(
      "INSERT INTO quiz_solutions VALUES (?, ?, ?, ?, ?)",
    ).bind(variantId, "not-json", "{}", "{}", "a".repeat(64)).run())
      .rejects.toThrow(/CHECK constraint failed/u);
    await expect(binding.DB.prepare(
      "INSERT INTO quiz_solutions VALUES (?, ?, ?, ?, ?)",
    ).bind(variantId, "[]", "{}", "{}", "PRIVATE_HASH").run())
      .rejects.toThrow(/CHECK constraint failed/u);
    await expect(binding.DB.prepare(
      "INSERT INTO quiz_solutions VALUES (?, ?, ?, ?, ?)",
    ).bind("missing-variant", "[]", "{}", "{}", "a".repeat(64)).run())
      .rejects.toThrow(/FOREIGN KEY constraint failed/u);
  });

  it("stores once, replays only the same request and preserves deleted tombstones", async () => {
    const variantId = await seedVariant("submission-outcomes");
    const sessionHash = "b".repeat(64);
    await repository.createSession({
      sessionHash,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: "2027-03-01T00:00:00.000Z",
    });
    const submission = visibleSubmission(variantId, sessionHash);

    await expect(repository.saveSubmission(submission, submission.submittedAt))
      .resolves.toMatchObject({ outcome: "inserted", submission });
    await expect(repository.saveSubmission(submission, submission.submittedAt))
      .resolves.toMatchObject({ outcome: "replayed", submission });
    await expect(repository.saveSubmission({
      ...submission,
      requestHash: "d".repeat(64),
    }, submission.submittedAt)).resolves.toEqual({ outcome: "idempotency_conflict" });
    await expect(repository.saveSubmission({
      ...submission,
      idempotencyKey: "01924f8e-7b2a-7f1c-9f3a-123456789abc",
    }, submission.submittedAt)).resolves.toEqual({ outcome: "already_submitted" });

    await database.update(submissions).set({
      status: "deleted",
      displayName: null,
      comment: null,
      answersJson: null,
      deletedAt: "2026-09-02T00:00:00.000Z",
    }).where(eq(submissions.id, submission.id));
    await expect(repository.saveSubmission(submission, submission.submittedAt))
      .resolves.toEqual({ outcome: "already_submitted" });
  });

  it("checks the published acceptance window inside the atomic write batch", async () => {
    const variantId = await seedVariant("submission-close-guard");
    const sessionHash = "7".repeat(64);
    await repository.createSession({
      sessionHash,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: "2027-03-01T00:00:00.000Z",
    });
    const submission = visibleSubmission(variantId, sessionHash, {
      submittedAt: "2026-09-08T00:00:00.000Z",
    });

    await expect(repository.saveSubmission(submission, submission.submittedAt))
      .resolves.toEqual({ outcome: "closed" });
    expect(await database.select().from(submissions)
      .where(eq(submissions.quizVariantId, variantId))).toHaveLength(0);
    await expect(repository.findActiveSession(sessionHash, submission.submittedAt))
      .resolves.toMatchObject({ lastSeenAt: createdAt });
  });

  it("deletes only the exact owned variant, preserves a minimal tombstone and replays safely", async () => {
    const variantId = await seedVariant("own-deletion");
    const otherVariantId = await seedVariant("own-deletion-other");
    const sessionHash = "3".repeat(64);
    await repository.createSession({
      sessionHash,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: "2027-03-01T00:00:00.000Z",
    });
    const submission = visibleSubmission(variantId, sessionHash, {
      comment: "삭제할 코멘트",
    });
    const otherSubmission = visibleSubmission(otherVariantId, sessionHash, {
      id: "submission-own-deletion-other",
    });
    await repository.saveSubmission(submission, submission.submittedAt);
    await repository.saveSubmission(otherSubmission, otherSubmission.submittedAt);
    const hiddenAt = "2026-09-01T00:06:00.000Z";
    await database.update(submissions).set({
      status: "hidden",
      hiddenAt,
    }).where(eq(submissions.id, submission.id));

    const deletedAt = "2026-09-02T00:00:00.000Z";
    const deleted = await repository.deleteOwnSubmission(
      variantId,
      1,
      sessionHash,
      deletedAt,
      "audit-own-deletion",
    );
    expect(deleted).toMatchObject({
      outcome: "deleted",
      submission: {
        status: "deleted",
        displayName: null,
        comment: null,
        answers: null,
        hiddenAt,
        deletedAt,
        correctCells: 1,
        totalCells: 2,
      },
    });

    const [row] = await database.select().from(submissions)
      .where(eq(submissions.id, submission.id));
    expect(row).toMatchObject({
      status: "deleted",
      displayName: null,
      comment: null,
      answersJson: null,
      deletedAt,
    });
    await expect(repository.findSubmission(otherVariantId, sessionHash))
      .resolves.toMatchObject({ status: "visible", displayName: "은혜" });
    await expect(repository.findActiveSession(sessionHash, deletedAt))
      .resolves.toMatchObject({ lastSeenAt: deletedAt });

    const replayed = await repository.deleteOwnSubmission(
      variantId,
      1,
      sessionHash,
      "2026-09-03T00:00:00.000Z",
      "audit-own-deletion-replay",
    );
    expect(replayed).toMatchObject({
      outcome: "replayed",
      submission: { status: "deleted", deletedAt },
    });
    expect(await database.select().from(auditLogs)
      .where(eq(auditLogs.entityId, submission.id))).toEqual([
      expect.objectContaining({
        action: SELF_SERVICE_SUBMISSION_DELETION_ACTION,
        actorEmail: null,
        actorType: "self_service",
        createdAt: deletedAt,
        entityType: "submission",
        id: "audit-own-deletion",
        safeMetadataJson: {
          deletedAt,
          quizRevision: 1,
          quizVariantId: variantId,
        },
      }),
    ]);
    await expect(repository.saveSubmission(submission, "2026-09-03T00:00:00.000Z"))
      .resolves.toEqual({ outcome: "already_submitted" });
  });

  it("rejects expired sessions and keeps score/status/tombstone invariants in D1", async () => {
    const variantId = await seedVariant("submission-checks");
    const sessionHash = "d".repeat(64);
    await repository.createSession({
      sessionHash,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: "2026-09-01T00:04:00.000Z",
    });
    const submission = visibleSubmission(variantId, sessionHash);
    await expect(repository.saveSubmission(submission, submission.submittedAt))
      .rejects.toThrowError(SubmissionSessionUnavailable);

    const activeHash = "e".repeat(64);
    await repository.createSession({
      sessionHash: activeHash,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: "2027-03-01T00:00:00.000Z",
    });
    const activeSubmission = visibleSubmission(variantId, activeHash);
    await repository.saveSubmission(activeSubmission, submission.submittedAt);
    await expect(binding.DB.prepare(
      "UPDATE submissions SET score_basis_points = 4999 WHERE id = ?",
    ).bind(activeSubmission.id).run())
      .rejects.toThrow(/CHECK constraint failed/u);
    await expect(binding.DB.prepare(
      "UPDATE submissions SET correctness_mask = '11' WHERE id = ?",
    ).bind(activeSubmission.id).run())
      .rejects.toThrow(/CHECK constraint failed/u);
    await expect(binding.DB.prepare(
      "UPDATE submissions SET idempotency_key = '550e8400-e29b-41d4-a716-446655440000' WHERE id = ?",
    ).bind(activeSubmission.id).run())
      .rejects.toThrow(/CHECK constraint failed/u);
    await expect(binding.DB.prepare(
      "UPDATE submissions SET status = 'deleted' WHERE id = ?",
    ).bind(activeSubmission.id).run())
      .rejects.toThrow(/CHECK constraint failed/u);
    await expect(binding.DB.prepare(
      "DELETE FROM anonymous_sessions WHERE session_hash = ?",
    ).bind(activeHash).run())
      .rejects.toThrow(/FOREIGN KEY constraint failed/u);
  });

  it("rolls back the privacy deletion and session touch when the audit insert fails", async () => {
    const variantId = await seedVariant("own-deletion-audit-rollback");
    const sessionHash = "4".repeat(64);
    await repository.createSession({
      sessionHash,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: "2027-03-01T00:00:00.000Z",
    });
    const submission = visibleSubmission(variantId, sessionHash, {
      comment: "감사 기록 실패에도 보존",
      id: "submission-own-deletion-audit-rollback",
    });
    await repository.saveSubmission(submission, submission.submittedAt);
    await database.insert(auditLogs).values({
      action: "existing_system_event",
      actorEmail: null,
      actorType: "system",
      createdAt,
      entityId: "another-entity",
      entityType: "test",
      id: "audit-own-deletion-collision",
      safeMetadataJson: {},
    });

    const attemptedAt = "2026-09-02T00:00:00.000Z";
    await expect(repository.deleteOwnSubmission(
      variantId,
      1,
      sessionHash,
      attemptedAt,
      "audit-own-deletion-collision",
    )).rejects.toThrow();

    await expect(repository.findSubmission(variantId, sessionHash)).resolves.toMatchObject({
      answers: { r0c0: "가" },
      comment: "감사 기록 실패에도 보존",
      displayName: "은혜",
      status: "visible",
    });
    await expect(repository.findActiveSession(sessionHash, attemptedAt))
      .resolves.toMatchObject({ lastSeenAt: submission.submittedAt });
    expect(await database.select().from(auditLogs)
      .where(eq(auditLogs.id, "audit-own-deletion-collision"))).toEqual([
      expect.objectContaining({ action: "existing_system_event" }),
    ]);
  });

  it("rolls back the session touch when a batched duplicate insert fails", async () => {
    const variantId = await seedVariant("submission-rollback");
    const sessionHash = "f".repeat(64);
    await repository.createSession({
      sessionHash,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: "2027-03-01T00:00:00.000Z",
    });
    const submission = visibleSubmission(variantId, sessionHash);
    await repository.saveSubmission(submission, submission.submittedAt);

    const failedTouch = "2026-09-01T00:10:00.000Z";
    await expect(binding.DB.batch([
      binding.DB.prepare("UPDATE anonymous_sessions SET last_seen_at = ? WHERE session_hash = ?")
        .bind(failedTouch, sessionHash),
      binding.DB.prepare(
        "INSERT INTO submissions SELECT ?, quiz_variant_id, quiz_revision, session_hash, idempotency_key, request_hash, display_name, comment, answers_json, correctness_mask, correct_cells, total_cells, correct_words, total_words, score_basis_points, is_fully_correct, status, submitted_at, hidden_at, deleted_at FROM submissions WHERE id = ?",
      ).bind("submission-duplicate", submission.id),
    ])).rejects.toThrow(/UNIQUE constraint failed/u);

    const session = await repository.findActiveSession(sessionHash, failedTouch);
    expect(session?.lastSeenAt).toBe(submission.submittedAt);
  });

  it("classifies concurrent same-session writes after the database unique winner commits", async () => {
    const variantId = await seedVariant("submission-concurrent");
    const sessionHash = "1".repeat(64);
    await repository.createSession({
      sessionHash,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: "2027-03-01T00:00:00.000Z",
    });
    const first = visibleSubmission(variantId, sessionHash, {
      id: "concurrent-first",
    });
    const replay = visibleSubmission(variantId, sessionHash, {
      id: "concurrent-replay",
    });
    const outcomes = await Promise.all([
      repository.saveSubmission(first, first.submittedAt),
      repository.saveSubmission(replay, replay.submittedAt),
    ]);
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      "inserted",
      "replayed",
    ]);

    const otherVariantId = await seedVariant("submission-concurrent-distinct");
    const distinctHash = "2".repeat(64);
    await repository.createSession({
      sessionHash: distinctHash,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: "2027-03-01T00:00:00.000Z",
    });
    const distinct = visibleSubmission(otherVariantId, distinctHash);
    const distinctOutcomes = await Promise.all([
      repository.saveSubmission(distinct, distinct.submittedAt),
      repository.saveSubmission({
        ...distinct,
        id: "concurrent-distinct-second",
        idempotencyKey: "01924f8e-7b2a-7f1c-9f3a-123456789abc",
      }, distinct.submittedAt),
    ]);
    expect(distinctOutcomes.map((result) => result.outcome).sort()).toEqual([
      "already_submitted",
      "inserted",
    ]);
  });
});
