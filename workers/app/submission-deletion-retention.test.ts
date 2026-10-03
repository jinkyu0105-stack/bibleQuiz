import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "../_shared/db/client";
import {
  anonymousSessions,
  auditLogs,
  bibleTranslations,
  leaderboardSnapshotEntries,
  leaderboardSnapshots,
  quizSets,
  quizVariants,
  sermons,
  submissions,
} from "../_shared/db/schema";
import {
  createSubmissionRepository,
  type VisibleSubmissionWrite,
} from "../_shared/repositories/submission-repository";
import {
  SubmissionDeletionRetentionUnavailable,
  createSubmissionDeletionRetentionService,
  type SubmissionDeletionManifestEntry,
} from "../_shared/services/submission-deletion-retention";

const binding = env as Env;
const database = createDatabase(binding.DB);
const createdAt = "2026-09-01T00:00:00.000Z";
const deletedAt = "2026-09-02T00:00:00.000Z";
const generatedAt = "2026-09-03T00:00:00.000Z";

function visibleSubmission(
  suffix: string,
  quizVariantId: string,
  sessionHash: string,
): VisibleSubmissionWrite {
  return {
    answers: { r0c0: "가" },
    comment: `삭제 대상 코멘트 ${suffix}`,
    correctCells: 1,
    correctnessMask: "10",
    correctWords: 0,
    displayName: `이름${suffix}`,
    id: `retention-submission-${suffix}`,
    idempotencyKey: "01924f8e-7b2a-7f1c-8f3a-123456789abc",
    isFullyCorrect: false,
    quizRevision: 1,
    quizVariantId,
    requestHash: "c".repeat(64),
    scoreBasisPoints: 5_000,
    sessionHash,
    submittedAt: "2026-09-01T00:05:00.000Z",
    totalCells: 2,
    totalWords: 1,
  };
}

async function seedDeletedSubmission(suffix: string, hashCharacter: string) {
  const translationId = `retention-translation-${suffix}`;
  const sermonId = `retention-sermon-${suffix}`;
  const quizSetId = `retention-set-${suffix}`;
  const quizVariantId = `retention-variant-${suffix}`;
  const sessionHash = hashCharacter.repeat(64);
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
    sermonTitle: "삭제 보존 테스트",
    slugSuffix: suffix,
    updatedAt: createdAt,
    youtubeUrl: `https://example.com/${suffix}`,
    youtubeVideoId: suffix,
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

  const repository = createSubmissionRepository(database);
  await repository.createSession({
    createdAt,
    expiresAt: "2027-03-01T00:00:00.000Z",
    lastSeenAt: createdAt,
    sessionHash,
  });
  const submission = visibleSubmission(suffix, quizVariantId, sessionHash);
  await repository.saveSubmission(submission, submission.submittedAt);
  const auditId = `retention-delete-audit-${suffix}`;
  await repository.deleteOwnSubmission(
    quizVariantId,
    1,
    sessionHash,
    deletedAt,
    auditId,
  );
  return { auditId, quizVariantId, sessionHash, submission };
}

async function restoreVisibleSubmission(
  submission: VisibleSubmissionWrite,
): Promise<void> {
  await database.update(submissions).set({
    answersJson: submission.answers,
    comment: submission.comment,
    deletedAt: null,
    displayName: submission.displayName,
    hiddenAt: null,
    status: "visible",
  }).where(eq(submissions.id, submission.id));
}

beforeEach(async () => {
  await database.delete(leaderboardSnapshotEntries);
  await database.delete(leaderboardSnapshots);
  await database.delete(submissions);
  await database.delete(anonymousSessions);
  await database.delete(auditLogs);
  await database.delete(quizSets);
  await database.delete(sermons);
  await database.delete(bibleTranslations);
});

describe("Phase 4 deletion manifest, restore gate and final purge", () => {
  it("builds a PII-free manifest and reapplies deletion before public reopening", async () => {
    const seeded = await seedDeletedSubmission("restore", "5");
    const service = createSubmissionDeletionRetentionService(database);
    const manifest = await service.buildManifest(generatedAt);
    expect(manifest.entries).toEqual([{
      auditId: seeded.auditId,
      deletionSource: "self_service",
      deletedAt,
      quizRevision: 1,
      quizVariantId: seeded.quizVariantId,
      submissionId: seeded.submission.id,
    }]);
    const serialized = JSON.stringify(manifest);
    for (const privateValue of [
      seeded.sessionHash,
      seeded.submission.displayName,
      seeded.submission.comment!,
      seeded.submission.idempotencyKey,
      seeded.submission.requestHash,
      "answersJson",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }

    await database.delete(auditLogs).where(eq(auditLogs.id, seeded.auditId));
    await restoreVisibleSubmission(seeded.submission);
    await database.insert(leaderboardSnapshots).values({
      finalizedAt: deletedAt,
      id: "retention-snapshot-restore",
      quizVariantId: seeded.quizVariantId,
      winnerCount: 3,
    });
    await database.insert(leaderboardSnapshotEntries).values({
      rank: 1,
      snapshotId: "retention-snapshot-restore",
      submissionId: seeded.submission.id,
    });

    await expect(service.reapplyManifestBeforePublicReopen(manifest)).resolves.toEqual({
      absentSubmissions: 0,
      deletedTombstones: 1,
      entries: 1,
    });
    expect(await database.select().from(submissions)).toEqual([
      expect.objectContaining({
        answersJson: null,
        comment: null,
        deletedAt,
        displayName: null,
        status: "deleted",
      }),
    ]);
    expect(await database.select().from(leaderboardSnapshotEntries)).toHaveLength(0);
    expect(await database.select().from(auditLogs)).toEqual([
      expect.objectContaining({
        actorEmail: null,
        actorType: "self_service",
        id: seeded.auditId,
      }),
    ]);
  });

  it("fails closed on a mismatched restore target before changing its personal data", async () => {
    const seeded = await seedDeletedSubmission("restore-mismatch", "6");
    const service = createSubmissionDeletionRetentionService(database);
    const manifest = await service.buildManifest(generatedAt);
    await restoreVisibleSubmission(seeded.submission);
    const wrongManifest = {
      ...manifest,
      entries: manifest.entries.map((entry) => ({
        ...entry,
        quizVariantId: "different-variant",
      })),
    };

    await expect(service.reapplyManifestBeforePublicReopen(wrongManifest))
      .rejects.toBeInstanceOf(SubmissionDeletionRetentionUnavailable);
    expect(await database.select().from(submissions)).toEqual([
      expect.objectContaining({
        answersJson: seeded.submission.answers,
        comment: seeded.submission.comment,
        displayName: seeded.submission.displayName,
        status: "visible",
      }),
    ]);
  });

  it("purges only explicit tombstones at a terminal boundary and remains restore-safe", async () => {
    const target = await seedDeletedSubmission("purge-target", "7");
    const untouched = await seedDeletedSubmission("purge-untouched", "8");
    const service = createSubmissionDeletionRetentionService(database);
    const manifest = await service.buildManifest(generatedAt);
    const targetEntry = manifest.entries.find((entry) =>
      entry.submissionId === target.submission.id
    ) as SubmissionDeletionManifestEntry;
    await database.insert(leaderboardSnapshots).values({
      finalizedAt: deletedAt,
      id: "retention-snapshot-purge",
      quizVariantId: target.quizVariantId,
      winnerCount: 3,
    });
    await database.insert(leaderboardSnapshotEntries).values({
      rank: 1,
      snapshotId: "retention-snapshot-purge",
      submissionId: target.submission.id,
    });

    await expect(service.purgeDeletedTombstones({
      boundary: "archive_disposal",
      entries: [targetEntry],
      purgedAt: generatedAt,
    })).resolves.toEqual({ alreadyAbsent: 0, purged: 1 });
    expect(await database.select().from(submissions)).toEqual([
      expect.objectContaining({ id: untouched.submission.id, status: "deleted" }),
    ]);
    expect(await database.select().from(anonymousSessions)).toEqual([
      expect.objectContaining({ sessionHash: untouched.sessionHash }),
    ]);
    expect(await database.select().from(leaderboardSnapshotEntries)).toHaveLength(0);
    expect(await database.select().from(auditLogs)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: target.auditId, actorType: "self_service" }),
      expect.objectContaining({ id: untouched.auditId, actorType: "self_service" }),
      expect.objectContaining({
        action: "deleted_tombstone_purge",
        actorEmail: null,
        actorType: "system",
        entityId: target.submission.id,
        safeMetadataJson: {
          boundary: "archive_disposal",
          deletedAt,
          deletionAuditId: target.auditId,
          quizRevision: 1,
          quizVariantId: target.quizVariantId,
        },
      }),
    ]));
    await expect(service.verifyManifestApplied(manifest)).resolves.toEqual({
      absentSubmissions: 1,
      deletedTombstones: 1,
      entries: 2,
    });

    await database.insert(anonymousSessions).values({
      createdAt,
      expiresAt: "2027-03-01T00:00:00.000Z",
      lastSeenAt: target.submission.submittedAt,
      sessionHash: target.sessionHash,
    });
    await database.insert(submissions).values({
      ...target.submission,
      answersJson: target.submission.answers,
      isFullyCorrect: target.submission.isFullyCorrect,
      status: "visible",
    });
    await database.insert(leaderboardSnapshotEntries).values({
      rank: 1,
      snapshotId: "retention-snapshot-purge",
      submissionId: target.submission.id,
    });

    await expect(service.reapplyManifestBeforePublicReopen(manifest)).resolves.toEqual({
      absentSubmissions: 0,
      deletedTombstones: 2,
      entries: 2,
    });
    const [restoredTarget] = await database.select().from(submissions)
      .where(eq(submissions.id, target.submission.id));
    expect(restoredTarget).toMatchObject({
      answersJson: null,
      comment: null,
      deletedAt,
      displayName: null,
      status: "deleted",
    });
    expect(await database.select().from(leaderboardSnapshotEntries)).toHaveLength(0);
  });
});
