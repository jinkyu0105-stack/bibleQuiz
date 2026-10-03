import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";

import {
  adminModerationReasonSchema,
  adminSubmissionIdSchema,
} from "../../../shared/api/admin-submission-moderation";
import type { Database } from "../db/client";
import {
  auditLogs,
  moderationActions,
  submissions,
  type AuditSafeMetadata,
} from "../db/schema";

export const ADMIN_SUBMISSION_HIDE_ACTION = "admin_submission_hide";
export const ADMIN_SUBMISSION_UNHIDE_ACTION = "admin_submission_unhide";
export const ADMIN_SUBMISSION_DELETE_ACTION = "admin_submission_delete";
export const ADMIN_SUBMISSION_DELETION_MARKER_ACTION = "admin_submission_deletion_marker";

const moderationActionSchema = z.enum(["hide", "unhide", "delete"]);
const idSchema = z.string().min(1).max(128);
const actorEmailSchema = z.string().email().max(320);

export class SubmissionModerationNotFound extends Error {
  constructor() {
    super("SUBMISSION_MODERATION_NOT_FOUND");
  }
}

export class SubmissionModerationInvalidState extends Error {
  constructor() {
    super("SUBMISSION_MODERATION_INVALID_STATE");
  }
}

export class SubmissionModerationUnavailable extends Error {
  constructor() {
    super("SUBMISSION_MODERATION_UNAVAILABLE");
  }
}

export interface SubmissionModerationIds {
  actionId: string;
  auditId: string;
  deletionMarkerAuditId?: string;
}

export interface SubmissionModerationResult {
  deletedAt?: string;
  outcome: "changed" | "replayed";
  status: "deleted" | "hidden" | "visible";
  submissionId: string;
}

const actionConfig = {
  hide: {
    auditAction: ADMIN_SUBMISSION_HIDE_ACTION,
    desiredStatus: "hidden",
    expectedStatus: "visible",
  },
  unhide: {
    auditAction: ADMIN_SUBMISSION_UNHIDE_ACTION,
    desiredStatus: "visible",
    expectedStatus: "hidden",
  },
  delete: {
    auditAction: ADMIN_SUBMISSION_DELETE_ACTION,
    desiredStatus: "deleted",
    expectedStatus: ["visible", "hidden"],
  },
} as const;

async function readTarget(database: Database, submissionId: string) {
  const [row] = await database.select({
    deletedAt: submissions.deletedAt,
    id: submissions.id,
    quizRevision: submissions.quizRevision,
    quizVariantId: submissions.quizVariantId,
    status: submissions.status,
  }).from(submissions).where(eq(submissions.id, submissionId));
  return row;
}

async function readMatchingAction(
  database: Database,
  submissionId: string,
  action: "delete" | "hide" | "unhide",
) {
  const [row] = await database.select({
    action: moderationActions.action,
    createdAt: moderationActions.createdAt,
    id: moderationActions.id,
    submissionId: moderationActions.submissionId,
  }).from(moderationActions)
    .where(and(
      eq(moderationActions.submissionId, submissionId),
      eq(moderationActions.action, action),
    ))
    .orderBy(desc(moderationActions.createdAt), desc(moderationActions.id))
    .limit(1);
  return row;
}

async function readAction(database: Database, actionId: string) {
  const [row] = await database.select({
    action: moderationActions.action,
    createdAt: moderationActions.createdAt,
    id: moderationActions.id,
    submissionId: moderationActions.submissionId,
  }).from(moderationActions).where(eq(moderationActions.id, actionId));
  return row;
}

function safeMetadata(input: {
  action: "hide" | "unhide" | "delete";
  changedAt: string;
  previousStatus: "hidden" | "visible";
  quizRevision: number;
  quizVariantId: string;
  reason: string;
}): AuditSafeMetadata {
  return {
    ...(input.action === "delete"
      ? { deletedAt: input.changedAt }
      : { changedAt: input.changedAt }),
    previousStatus: input.previousStatus,
    quizRevision: input.quizRevision,
    quizVariantId: input.quizVariantId,
    reason: input.reason,
  };
}

function deletionMarkerMetadata(input: {
  changedAt: string;
  quizRevision: number;
  quizVariantId: string;
}): AuditSafeMetadata {
  return {
    deletedAt: input.changedAt,
    quizRevision: input.quizRevision,
    quizVariantId: input.quizVariantId,
  };
}

function replayResult(
  row: NonNullable<Awaited<ReturnType<typeof readTarget>>>,
): SubmissionModerationResult {
  return {
    ...(row.status === "deleted" && row.deletedAt !== null
      ? { deletedAt: row.deletedAt }
      : {}),
    outcome: "replayed",
    status: row.status,
    submissionId: row.id,
  };
}

export function createSubmissionModerationService(database: Database) {
  return {
    async moderate(input: {
      action: "hide" | "unhide" | "delete";
      actorEmail: string;
      changedAt: string;
      ids: SubmissionModerationIds;
      reason: string;
      submissionId: string;
    }): Promise<SubmissionModerationResult> {
      const parsed = z.object({
        action: moderationActionSchema,
        actorEmail: actorEmailSchema,
        changedAt: z.iso.datetime(),
        ids: z.object({
          actionId: idSchema,
          auditId: idSchema,
          deletionMarkerAuditId: idSchema.optional(),
        }).strict(),
        reason: adminModerationReasonSchema,
        submissionId: adminSubmissionIdSchema,
      }).strict().safeParse(input);
      if (!parsed.success) throw new SubmissionModerationUnavailable();
      if (
        parsed.data.action === "delete" &&
        parsed.data.ids.deletionMarkerAuditId === undefined
      ) {
        throw new SubmissionModerationUnavailable();
      }

      const target = await readTarget(database, parsed.data.submissionId);
      if (target === undefined) throw new SubmissionModerationNotFound();
      const config = actionConfig[parsed.data.action];
      const matchingAction = await readMatchingAction(database, target.id, parsed.data.action);
      if (target.status === config.desiredStatus) {
        if (matchingAction === undefined) {
          throw new SubmissionModerationInvalidState();
        }
        return replayResult(target);
      }
      const expectedStatuses = Array.isArray(config.expectedStatus)
        ? config.expectedStatus
        : [config.expectedStatus];
      if (!expectedStatuses.includes(target.status as "hidden" | "visible")) {
        throw new SubmissionModerationInvalidState();
      }

      const metadata = safeMetadata({
        action: parsed.data.action,
        changedAt: parsed.data.changedAt,
        previousStatus: target.status as "hidden" | "visible",
        quizRevision: target.quizRevision,
        quizVariantId: target.quizVariantId,
        reason: parsed.data.reason,
      });
      const statusCondition = parsed.data.action === "delete"
        ? inArray(submissions.status, ["visible", "hidden"])
        : eq(submissions.status, config.expectedStatus as "hidden" | "visible");
      const statements: BatchItem<"sqlite">[] = [
        database.insert(moderationActions).select(sql`
          select
            ${parsed.data.ids.actionId}, ${target.id}, ${parsed.data.action},
            ${parsed.data.actorEmail}, ${parsed.data.reason}, ${parsed.data.changedAt}
          from ${submissions}
          where ${submissions.id} = ${target.id}
            and ${submissions.quizVariantId} = ${target.quizVariantId}
            and ${submissions.quizRevision} = ${target.quizRevision}
            and ${statusCondition}
        `),
        database.insert(auditLogs).select(sql`
          select
            ${parsed.data.ids.auditId}, 'submission', ${target.id},
            ${config.auditAction}, 'access_admin', ${parsed.data.actorEmail},
            ${JSON.stringify(metadata)}, ${parsed.data.changedAt}
          from ${submissions}
          where ${submissions.id} = ${target.id}
            and ${submissions.quizVariantId} = ${target.quizVariantId}
            and ${submissions.quizRevision} = ${target.quizRevision}
            and ${statusCondition}
        `),
      ];
      if (parsed.data.action === "delete") {
        statements.push(database.insert(auditLogs).select(sql`
          select
            ${parsed.data.ids.deletionMarkerAuditId!}, 'submission', ${target.id},
            ${ADMIN_SUBMISSION_DELETION_MARKER_ACTION}, 'system', null,
            ${JSON.stringify(deletionMarkerMetadata({
              changedAt: parsed.data.changedAt,
              quizRevision: target.quizRevision,
              quizVariantId: target.quizVariantId,
            }))}, ${parsed.data.changedAt}
          from ${submissions}
          where ${submissions.id} = ${target.id}
            and ${submissions.quizVariantId} = ${target.quizVariantId}
            and ${submissions.quizRevision} = ${target.quizRevision}
            and ${statusCondition}
        `));
      }
      statements.push(database.update(submissions).set(
        parsed.data.action === "hide"
          ? { hiddenAt: parsed.data.changedAt, status: "hidden" }
          : parsed.data.action === "unhide"
            ? { hiddenAt: null, status: "visible" }
            : {
                answersJson: null,
                comment: null,
                deletedAt: parsed.data.changedAt,
                displayName: null,
                status: "deleted",
              },
      ).where(and(
        eq(submissions.id, target.id),
        eq(submissions.quizVariantId, target.quizVariantId),
        eq(submissions.quizRevision, target.quizRevision),
        statusCondition,
      )));

      try {
        await database.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
      } catch {
        throw new SubmissionModerationUnavailable();
      }

      const changed = await readTarget(database, target.id);
      const insertedAction = await readAction(database, parsed.data.ids.actionId);
      const changedMatchingAction = insertedAction ?? await readMatchingAction(
        database,
        target.id,
        parsed.data.action,
      );
      if (
        changed === undefined ||
        changed.status !== config.desiredStatus ||
        changedMatchingAction?.action !== parsed.data.action ||
        changedMatchingAction.submissionId !== target.id
      ) {
        throw new SubmissionModerationInvalidState();
      }
      if (changed.status === "deleted" && changed.deletedAt === null) {
        throw new SubmissionModerationUnavailable();
      }
      return {
        ...(changed.status === "deleted" ? { deletedAt: changed.deletedAt! } : {}),
        outcome: insertedAction === undefined ? "replayed" : "changed",
        status: changed.status,
        submissionId: changed.id,
      };
    },
  };
}
