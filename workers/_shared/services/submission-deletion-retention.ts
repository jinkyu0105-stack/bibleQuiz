import {
  and,
  asc,
  eq,
  isNull,
  notExists,
  or,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";

import type { Database } from "../db/client";
import {
  anonymousSessions,
  auditLogs,
  leaderboardSnapshotEntries,
  moderationActions,
  submissions,
  type AuditSafeMetadata,
} from "../db/schema";
import {
  SELF_SERVICE_SUBMISSION_DELETION_ACTION,
} from "../repositories/submission-repository";
import {
  ADMIN_SUBMISSION_DELETION_MARKER_ACTION,
} from "./submission-moderation";

const manifestEntrySchema = z.object({
  auditId: z.string().min(1).max(128),
  deletionSource: z.enum(["access_admin", "self_service"]),
  deletedAt: z.iso.datetime(),
  quizRevision: z.number().int().positive(),
  quizVariantId: z.string().min(1).max(128),
  submissionId: z.string().min(1).max(128),
}).strict();

export const submissionDeletionManifestSchema = z.object({
  entries: z.array(manifestEntrySchema),
  generatedAt: z.iso.datetime(),
  version: z.literal(1),
}).strict().superRefine((manifest, context) => {
  const auditIds = new Set<string>();
  const submissionIds = new Set<string>();
  for (const [index, entry] of manifest.entries.entries()) {
    if (auditIds.has(entry.auditId)) {
      context.addIssue({
        code: "custom",
        message: "Duplicate deletion audit ID",
        path: ["entries", index, "auditId"],
      });
    }
    if (submissionIds.has(entry.submissionId)) {
      context.addIssue({
        code: "custom",
        message: "Duplicate deleted submission ID",
        path: ["entries", index, "submissionId"],
      });
    }
    auditIds.add(entry.auditId);
    submissionIds.add(entry.submissionId);
  }
});

export const finalSubmissionPurgeBoundarySchema = z.enum([
  "archive_disposal",
  "privacy_purpose_ended",
  "site_shutdown",
]);

const deletionAuditMetadataSchema = z.object({
  deletedAt: z.iso.datetime(),
  quizRevision: z.number().int().positive(),
  quizVariantId: z.string().min(1).max(128),
}).strict();

const purgeAuditMetadataSchema = deletionAuditMetadataSchema.extend({
  boundary: finalSubmissionPurgeBoundarySchema,
  deletionAuditId: z.string().min(1).max(128),
}).strict();

export type SubmissionDeletionManifest = z.infer<typeof submissionDeletionManifestSchema>;
export type SubmissionDeletionManifestEntry = z.infer<typeof manifestEntrySchema>;
export type FinalSubmissionPurgeBoundary = z.infer<typeof finalSubmissionPurgeBoundarySchema>;

export interface SubmissionDeletionManifestVerification {
  absentSubmissions: number;
  deletedTombstones: number;
  entries: number;
}

export interface FinalSubmissionPurgeResult {
  alreadyAbsent: number;
  purged: number;
}

export class SubmissionDeletionRetentionUnavailable extends Error {
  constructor() {
    super("SUBMISSION_DELETION_RETENTION_UNAVAILABLE");
  }
}

const PURGE_AUDIT_ACTION = "deleted_tombstone_purge";
const textEncoder = new TextEncoder();

function deletionMetadata(entry: SubmissionDeletionManifestEntry): AuditSafeMetadata {
  return {
    deletedAt: entry.deletedAt,
    quizRevision: entry.quizRevision,
    quizVariantId: entry.quizVariantId,
  };
}

function purgeMetadata(
  entry: SubmissionDeletionManifestEntry,
  boundary: FinalSubmissionPurgeBoundary,
): AuditSafeMetadata {
  return {
    boundary,
    deletedAt: entry.deletedAt,
    deletionAuditId: entry.auditId,
    quizRevision: entry.quizRevision,
    quizVariantId: entry.quizVariantId,
  };
}

function metadataMatches(
  value: unknown,
  expected: SubmissionDeletionManifestEntry,
): boolean {
  const parsed = deletionAuditMetadataSchema.safeParse(value);
  return parsed.success &&
    parsed.data.deletedAt === expected.deletedAt &&
    parsed.data.quizRevision === expected.quizRevision &&
    parsed.data.quizVariantId === expected.quizVariantId;
}

async function deterministicPurgeAuditId(auditId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`biblequiz:submission-purge:${auditId}`),
  );
  return `purge-${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("")}`;
}

async function readSubmission(database: Database, submissionId: string) {
  const [row] = await database.select({
    answersJson: submissions.answersJson,
    comment: submissions.comment,
    deletedAt: submissions.deletedAt,
    displayName: submissions.displayName,
    id: submissions.id,
    quizRevision: submissions.quizRevision,
    quizVariantId: submissions.quizVariantId,
    sessionHash: submissions.sessionHash,
    status: submissions.status,
  }).from(submissions).where(eq(submissions.id, submissionId));
  return row;
}

async function readAudit(database: Database, auditId: string) {
  const [row] = await database.select().from(auditLogs).where(eq(auditLogs.id, auditId));
  return row;
}

function assertDeletionAudit(
  audit: Awaited<ReturnType<typeof readAudit>>,
  entry: SubmissionDeletionManifestEntry,
): void {
  const expected = entry.deletionSource === "self_service"
    ? { action: SELF_SERVICE_SUBMISSION_DELETION_ACTION, actorType: "self_service" }
    : { action: ADMIN_SUBMISSION_DELETION_MARKER_ACTION, actorType: "system" };
  if (
    audit === undefined ||
    audit.action !== expected.action ||
    audit.actorEmail !== null ||
    audit.actorType !== expected.actorType ||
    audit.createdAt !== entry.deletedAt ||
    audit.entityId !== entry.submissionId ||
    audit.entityType !== "submission" ||
    !metadataMatches(audit.safeMetadataJson, entry)
  ) {
    throw new SubmissionDeletionRetentionUnavailable();
  }
}

function assertSubmissionIdentity(
  submission: Awaited<ReturnType<typeof readSubmission>>,
  entry: SubmissionDeletionManifestEntry,
): void {
  if (
    submission !== undefined &&
    (
      submission.id !== entry.submissionId ||
      submission.quizRevision !== entry.quizRevision ||
      submission.quizVariantId !== entry.quizVariantId
    )
  ) {
    throw new SubmissionDeletionRetentionUnavailable();
  }
}

function isExactDeletedTombstone(
  submission: NonNullable<Awaited<ReturnType<typeof readSubmission>>>,
  entry: SubmissionDeletionManifestEntry,
): boolean {
  return submission.status === "deleted" &&
    submission.answersJson === null &&
    submission.comment === null &&
    submission.deletedAt === entry.deletedAt &&
    submission.displayName === null;
}

export function createSubmissionDeletionRetentionService(database: Database) {
  const verifyManifestApplied = async (
    input: unknown,
  ): Promise<SubmissionDeletionManifestVerification> => {
    const manifest = submissionDeletionManifestSchema.parse(input);
    let absentSubmissions = 0;
    let deletedTombstones = 0;

    for (const entry of manifest.entries) {
      assertDeletionAudit(await readAudit(database, entry.auditId), entry);
      const submission = await readSubmission(database, entry.submissionId);
      assertSubmissionIdentity(submission, entry);
      if (submission === undefined) {
        absentSubmissions += 1;
      } else if (isExactDeletedTombstone(submission, entry)) {
        deletedTombstones += 1;
      } else {
        throw new SubmissionDeletionRetentionUnavailable();
      }
      const snapshotReferences = await database.select({
        submissionId: leaderboardSnapshotEntries.submissionId,
      }).from(leaderboardSnapshotEntries).where(
        eq(leaderboardSnapshotEntries.submissionId, entry.submissionId),
      );
      if (snapshotReferences.length !== 0) {
        throw new SubmissionDeletionRetentionUnavailable();
      }
    }

    return {
      absentSubmissions,
      deletedTombstones,
      entries: manifest.entries.length,
    };
  };

  return {
    async buildManifest(generatedAt: string): Promise<SubmissionDeletionManifest> {
      if (!z.iso.datetime().safeParse(generatedAt).success) {
        throw new SubmissionDeletionRetentionUnavailable();
      }
      const rows = await database.select().from(auditLogs).where(and(
        isNull(auditLogs.actorEmail),
        eq(auditLogs.entityType, "submission"),
        or(
          and(
            eq(auditLogs.action, SELF_SERVICE_SUBMISSION_DELETION_ACTION),
            eq(auditLogs.actorType, "self_service"),
          ),
          and(
            eq(auditLogs.action, ADMIN_SUBMISSION_DELETION_MARKER_ACTION),
            eq(auditLogs.actorType, "system"),
          ),
        ),
      )).orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));

      try {
        return submissionDeletionManifestSchema.parse({
          entries: rows.map((row) => {
            const metadata = deletionAuditMetadataSchema.parse(row.safeMetadataJson);
            if (row.createdAt !== metadata.deletedAt) {
              throw new SubmissionDeletionRetentionUnavailable();
            }
            return {
              auditId: row.id,
              deletionSource: row.action === SELF_SERVICE_SUBMISSION_DELETION_ACTION
                ? "self_service"
                : "access_admin",
              deletedAt: metadata.deletedAt,
              quizRevision: metadata.quizRevision,
              quizVariantId: metadata.quizVariantId,
              submissionId: row.entityId,
            };
          }),
          generatedAt,
          version: 1,
        });
      } catch {
        throw new SubmissionDeletionRetentionUnavailable();
      }
    },

    async reapplyManifestBeforePublicReopen(
      input: unknown,
    ): Promise<SubmissionDeletionManifestVerification> {
      const manifest = submissionDeletionManifestSchema.parse(input);

      const preflight = [];
      for (const entry of manifest.entries) {
        const audit = await readAudit(database, entry.auditId);
        if (audit !== undefined) assertDeletionAudit(audit, entry);
        const submission = await readSubmission(database, entry.submissionId);
        assertSubmissionIdentity(submission, entry);
        preflight.push({ audit, entry, submission });
      }

      for (const { audit, entry, submission } of preflight) {
        const statements: BatchItem<"sqlite">[] = [];
        if (audit === undefined) {
          statements.push(database.insert(auditLogs).values({
            action: entry.deletionSource === "self_service"
              ? SELF_SERVICE_SUBMISSION_DELETION_ACTION
              : ADMIN_SUBMISSION_DELETION_MARKER_ACTION,
            actorEmail: null,
            actorType: entry.deletionSource === "self_service" ? "self_service" : "system",
            createdAt: entry.deletedAt,
            entityId: entry.submissionId,
            entityType: "submission",
            id: entry.auditId,
            safeMetadataJson: deletionMetadata(entry),
          }));
        }
        if (submission !== undefined) {
          statements.push(database.delete(leaderboardSnapshotEntries).where(
            eq(leaderboardSnapshotEntries.submissionId, entry.submissionId),
          ));
          statements.push(database.update(submissions).set({
            answersJson: null,
            comment: null,
            deletedAt: entry.deletedAt,
            displayName: null,
            status: "deleted",
          }).where(and(
            eq(submissions.id, entry.submissionId),
            eq(submissions.quizVariantId, entry.quizVariantId),
            eq(submissions.quizRevision, entry.quizRevision),
          )));
        }
        if (statements.length !== 0) {
          await database.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
        }
      }

      return verifyManifestApplied(manifest);
    },

    async purgeDeletedTombstones(input: {
      boundary: FinalSubmissionPurgeBoundary;
      entries: readonly SubmissionDeletionManifestEntry[];
      purgedAt: string;
    }): Promise<FinalSubmissionPurgeResult> {
      const parsed = z.object({
        boundary: finalSubmissionPurgeBoundarySchema,
        entries: z.array(manifestEntrySchema).min(1),
        purgedAt: z.iso.datetime(),
      }).strict().parse(input);
      const uniqueManifest = submissionDeletionManifestSchema.parse({
        entries: parsed.entries,
        generatedAt: parsed.purgedAt,
        version: 1,
      });
      const targets = [];
      let alreadyAbsent = 0;

      for (const entry of uniqueManifest.entries) {
        assertDeletionAudit(await readAudit(database, entry.auditId), entry);
        const submission = await readSubmission(database, entry.submissionId);
        assertSubmissionIdentity(submission, entry);
        if (submission === undefined) {
          alreadyAbsent += 1;
          continue;
        }
        if (!isExactDeletedTombstone(submission, entry)) {
          throw new SubmissionDeletionRetentionUnavailable();
        }
        const purgeAuditId = await deterministicPurgeAuditId(entry.auditId);
        if (await readAudit(database, purgeAuditId) !== undefined) {
          throw new SubmissionDeletionRetentionUnavailable();
        }
        targets.push({ entry, purgeAuditId, sessionHash: submission.sessionHash });
      }

      for (const { entry, purgeAuditId, sessionHash } of targets) {
        await database.batch([
          database.insert(auditLogs).values({
            action: PURGE_AUDIT_ACTION,
            actorEmail: null,
            actorType: "system",
            createdAt: parsed.purgedAt,
            entityId: entry.submissionId,
            entityType: "submission",
            id: purgeAuditId,
            safeMetadataJson: purgeMetadata(entry, parsed.boundary),
          }),
          database.delete(leaderboardSnapshotEntries).where(
            eq(leaderboardSnapshotEntries.submissionId, entry.submissionId),
          ),
          database.delete(moderationActions).where(
            eq(moderationActions.submissionId, entry.submissionId),
          ),
          database.delete(auditLogs).where(and(
            eq(auditLogs.entityType, "submission"),
            eq(auditLogs.entityId, entry.submissionId),
            eq(auditLogs.actorType, "access_admin"),
          )),
          database.delete(submissions).where(and(
            eq(submissions.id, entry.submissionId),
            eq(submissions.quizVariantId, entry.quizVariantId),
            eq(submissions.quizRevision, entry.quizRevision),
            eq(submissions.status, "deleted"),
            eq(submissions.deletedAt, entry.deletedAt),
            isNull(submissions.displayName),
            isNull(submissions.comment),
            isNull(submissions.answersJson),
          )),
          database.delete(anonymousSessions).where(and(
            eq(anonymousSessions.sessionHash, sessionHash),
            notExists(database.select({ id: submissions.id }).from(submissions).where(
              eq(submissions.sessionHash, sessionHash),
            )),
          )),
        ] as const);

        if (await readSubmission(database, entry.submissionId) !== undefined) {
          throw new SubmissionDeletionRetentionUnavailable();
        }
        const purgeAudit = await readAudit(database, purgeAuditId);
        const metadata = purgeAuditMetadataSchema.safeParse(purgeAudit?.safeMetadataJson);
        if (
          purgeAudit?.action !== PURGE_AUDIT_ACTION ||
          purgeAudit.actorEmail !== null ||
          purgeAudit.actorType !== "system" ||
          purgeAudit.createdAt !== parsed.purgedAt ||
          purgeAudit.entityId !== entry.submissionId ||
          purgeAudit.entityType !== "submission" ||
          !metadata.success ||
          metadata.data.boundary !== parsed.boundary ||
          metadata.data.deletionAuditId !== entry.auditId ||
          metadata.data.deletedAt !== entry.deletedAt ||
          metadata.data.quizRevision !== entry.quizRevision ||
          metadata.data.quizVariantId !== entry.quizVariantId
        ) {
          throw new SubmissionDeletionRetentionUnavailable();
        }
      }

      return { alreadyAbsent, purged: targets.length };
    },

    verifyManifestApplied,
  };
}
