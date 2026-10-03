import { and, eq, exists, gt, inArray, lte, sql } from "drizzle-orm";

import type { PrivateSolution } from "../../../shared/puzzle/types";
import type { Database } from "../db/client";
import {
  anonymousSessions,
  auditLogs,
  quizSets,
  quizSolutions,
  quizVariants,
  submissions,
  type NewAnonymousSessionRow,
  type SubmissionAnswers,
} from "../db/schema";
import {
  canonicalCellOrderSchema,
  entryAnswersSchema,
  solutionCellsSchema,
  submissionAnswersSchema,
} from "../db/validation";

export class InvalidStoredSolution extends Error {
  constructor() {
    super("INVALID_STORED_SOLUTION");
  }
}

export class SubmissionSessionUnavailable extends Error {
  constructor() {
    super("SUBMISSION_SESSION_UNAVAILABLE");
  }
}

export interface StoredScoringSolution {
  canonicalCellOrder: readonly string[];
  solution: PrivateSolution;
  solutionSha256: string;
}

export interface VisibleSubmissionWrite {
  id: string;
  quizVariantId: string;
  quizRevision: number;
  sessionHash: string;
  idempotencyKey: string;
  requestHash: string;
  displayName: string;
  comment: string | null;
  answers: SubmissionAnswers;
  correctnessMask: string;
  correctCells: number;
  totalCells: number;
  correctWords: number;
  totalWords: number;
  scoreBasisPoints: number;
  isFullyCorrect: boolean;
  submittedAt: string;
}

interface StoredSubmissionBase {
  id: string;
  quizVariantId: string;
  quizRevision: number;
  sessionHash: string;
  idempotencyKey: string;
  requestHash: string;
  correctnessMask: string;
  correctCells: number;
  totalCells: number;
  correctWords: number;
  totalWords: number;
  scoreBasisPoints: number;
  isFullyCorrect: boolean;
  submittedAt: string;
}

export interface StoredVisibleSubmission extends StoredSubmissionBase {
  displayName: string;
  comment: string | null;
  answers: SubmissionAnswers;
  status: "visible" | "hidden";
  hiddenAt: string | null;
  deletedAt: null;
}

export interface StoredDeletedSubmission extends StoredSubmissionBase {
  displayName: null;
  comment: null;
  answers: null;
  status: "deleted";
  hiddenAt: string | null;
  deletedAt: string;
}

export type StoredSubmission = StoredVisibleSubmission | StoredDeletedSubmission;

export type SaveSubmissionResult =
  | { outcome: "inserted"; submission: StoredVisibleSubmission }
  | { outcome: "replayed"; submission: StoredVisibleSubmission }
  | { outcome: "idempotency_conflict" }
  | { outcome: "already_submitted" }
  | { outcome: "closed" };

export type DeleteOwnSubmissionResult =
  | { outcome: "deleted" | "replayed"; submission: StoredDeletedSubmission }
  | { outcome: "not_found" };

export const SELF_SERVICE_SUBMISSION_DELETION_ACTION = "self_service_delete";

function parseStoredSubmission(
  row: Awaited<ReturnType<typeof findSubmissionRow>>,
): StoredSubmission | undefined {
  if (row === undefined) return undefined;
  const common: StoredSubmissionBase = {
    id: row.id,
    quizVariantId: row.quizVariantId,
    quizRevision: row.quizRevision,
    sessionHash: row.sessionHash,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    correctnessMask: row.correctnessMask,
    correctCells: row.correctCells,
    totalCells: row.totalCells,
    correctWords: row.correctWords,
    totalWords: row.totalWords,
    scoreBasisPoints: row.scoreBasisPoints,
    isFullyCorrect: row.isFullyCorrect,
    submittedAt: row.submittedAt,
  };
  if (row.status === "deleted") {
    if (row.displayName !== null || row.comment !== null || row.answersJson !== null || row.deletedAt === null) {
      throw new Error("Invalid deleted submission content");
    }
    return { ...common, displayName: null, comment: null, answers: null,
      status: "deleted", hiddenAt: row.hiddenAt, deletedAt: row.deletedAt };
  }
  if (row.displayName === null || row.answersJson === null || row.deletedAt !== null) {
    throw new Error("Invalid visible submission content");
  }
  return { ...common, displayName: row.displayName, comment: row.comment,
    answers: submissionAnswersSchema.parse(row.answersJson), status: row.status,
    hiddenAt: row.hiddenAt, deletedAt: null };
}

async function findSubmissionRow(
  database: Database,
  quizVariantId: string,
  sessionHash: string,
) {
  const [row] = await database.select({
    id: submissions.id,
    quizVariantId: submissions.quizVariantId,
    quizRevision: submissions.quizRevision,
    sessionHash: submissions.sessionHash,
    idempotencyKey: submissions.idempotencyKey,
    requestHash: submissions.requestHash,
    displayName: submissions.displayName,
    comment: submissions.comment,
    answersJson: submissions.answersJson,
    correctnessMask: submissions.correctnessMask,
    correctCells: submissions.correctCells,
    totalCells: submissions.totalCells,
    correctWords: submissions.correctWords,
    totalWords: submissions.totalWords,
    scoreBasisPoints: submissions.scoreBasisPoints,
    isFullyCorrect: submissions.isFullyCorrect,
    status: submissions.status,
    submittedAt: submissions.submittedAt,
    hiddenAt: submissions.hiddenAt,
    deletedAt: submissions.deletedAt,
  }).from(submissions).where(and(
    eq(submissions.quizVariantId, quizVariantId),
    eq(submissions.sessionHash, sessionHash),
  ));
  return row;
}

function classifyExisting(
  existing: StoredSubmission,
  submission: VisibleSubmissionWrite,
): SaveSubmissionResult {
  if (existing.status === "deleted" || existing.idempotencyKey !== submission.idempotencyKey) {
    return { outcome: "already_submitted" };
  }
  if (existing.requestHash !== submission.requestHash) {
    return { outcome: "idempotency_conflict" };
  }
  return { outcome: "replayed", submission: existing };
}

export function createSubmissionRepository(database: Database) {
  const findActiveSession = async (sessionHash: string, now: string) => {
    const [session] = await database.select({
      createdAt: anonymousSessions.createdAt,
      expiresAt: anonymousSessions.expiresAt,
      lastSeenAt: anonymousSessions.lastSeenAt,
      sessionHash: anonymousSessions.sessionHash,
    }).from(anonymousSessions).where(and(
      eq(anonymousSessions.sessionHash, sessionHash),
      lte(anonymousSessions.createdAt, now),
      gt(anonymousSessions.expiresAt, now),
    ));
    return session;
  };

  return {
    async createSession(session: NewAnonymousSessionRow): Promise<void> {
      await database.insert(anonymousSessions).values(session);
    },

    findActiveSession,

    async findSubmission(
      quizVariantId: string,
      sessionHash: string,
    ): Promise<StoredSubmission | undefined> {
      return parseStoredSubmission(
        await findSubmissionRow(database, quizVariantId, sessionHash),
      );
    },

    async touchActiveSession(sessionHash: string, now: string): Promise<void> {
      await database.update(anonymousSessions).set({ lastSeenAt: now }).where(and(
        eq(anonymousSessions.sessionHash, sessionHash),
        lte(anonymousSessions.lastSeenAt, now),
        gt(anonymousSessions.expiresAt, now),
      ));
    },

    async deleteOwnSubmission(
      quizVariantId: string,
      quizRevision: number,
      sessionHash: string,
      deletedAt: string,
      auditId: string,
    ): Promise<DeleteOwnSubmissionResult> {
      const activeSession = await findActiveSession(sessionHash, deletedAt);
      if (activeSession === undefined) throw new SubmissionSessionUnavailable();

      const existing = parseStoredSubmission(
        await findSubmissionRow(database, quizVariantId, sessionHash),
      );
      if (existing === undefined) return { outcome: "not_found" };
      if (existing.quizRevision !== quizRevision) {
        throw new Error("Stored submission revision mismatch");
      }
      if (existing.status === "deleted") {
        return { outcome: "replayed", submission: existing };
      }

      await database.batch([
        database.update(anonymousSessions).set({ lastSeenAt: deletedAt }).where(and(
          eq(anonymousSessions.sessionHash, sessionHash),
          lte(anonymousSessions.lastSeenAt, deletedAt),
          gt(anonymousSessions.expiresAt, deletedAt),
        )),
        database.insert(auditLogs).select(sql`
          select
            ${auditId}, 'submission', ${existing.id},
            ${SELF_SERVICE_SUBMISSION_DELETION_ACTION}, 'self_service', null,
            ${JSON.stringify({
              deletedAt,
              quizRevision,
              quizVariantId,
            })},
            ${deletedAt}
          from ${submissions}
          where ${submissions.id} = ${existing.id}
            and ${submissions.quizVariantId} = ${quizVariantId}
            and ${submissions.quizRevision} = ${quizRevision}
            and ${submissions.sessionHash} = ${sessionHash}
            and ${inArray(submissions.status, ["visible", "hidden"])}
        `),
        database.update(submissions).set({
          displayName: null,
          comment: null,
          answersJson: null,
          status: "deleted",
          deletedAt,
        }).where(and(
          eq(submissions.quizVariantId, quizVariantId),
          eq(submissions.quizRevision, quizRevision),
          eq(submissions.sessionHash, sessionHash),
          inArray(submissions.status, ["visible", "hidden"]),
        )),
      ] as const);

      const deleted = parseStoredSubmission(
        await findSubmissionRow(database, quizVariantId, sessionHash),
      );
      if (deleted?.status !== "deleted" || deleted.quizRevision !== quizRevision) {
        throw new Error("Submission deletion did not produce a tombstone");
      }
      return {
        outcome: deleted.deletedAt === deletedAt ? "deleted" : "replayed",
        submission: deleted,
      };
    },

    async findScoringSolution(quizVariantId: string): Promise<StoredScoringSolution | undefined> {
      const [row] = await database.select({
        canonicalCellOrder: quizSolutions.canonicalCellOrderJson,
        cells: quizSolutions.solutionCellsJson,
        entries: quizSolutions.entryAnswersJson,
        solutionSha256: quizSolutions.solutionSha256,
      }).from(quizSolutions).where(eq(quizSolutions.quizVariantId, quizVariantId));
      if (row === undefined) return undefined;
      try {
        const canonicalCellOrder = canonicalCellOrderSchema.parse(row.canonicalCellOrder);
        const cells = solutionCellsSchema.parse(row.cells);
        const entries = entryAnswersSchema.parse(row.entries);
        const canonicalSet = new Set(canonicalCellOrder);
        if (
          Object.keys(cells).length !== canonicalCellOrder.length ||
          Object.keys(cells).some((id) => !canonicalSet.has(id)) ||
          Object.keys(entries).length === 0
        ) {
          throw new InvalidStoredSolution();
        }
        return {
          canonicalCellOrder,
          solution: { cells, entries },
          solutionSha256: row.solutionSha256,
        };
      } catch {
        throw new InvalidStoredSolution();
      }
    },

    async saveSubmission(
      submission: VisibleSubmissionWrite,
      lastSeenAt: string,
    ): Promise<SaveSubmissionResult> {
      const answers = submissionAnswersSchema.parse(submission.answers);
      const existing = parseStoredSubmission(
        await findSubmissionRow(database, submission.quizVariantId, submission.sessionHash),
      );
      if (existing !== undefined) return classifyExisting(existing, submission);

      const activeSession = await findActiveSession(submission.sessionHash, lastSeenAt);
      if (activeSession === undefined) throw new SubmissionSessionUnavailable();

      const acceptingVariant = database.select({ id: quizVariants.id })
        .from(quizVariants)
        .innerJoin(quizSets, eq(quizSets.id, quizVariants.quizSetId))
        .where(and(
          eq(quizVariants.id, submission.quizVariantId),
          eq(quizVariants.revision, submission.quizRevision),
          eq(quizVariants.lifecycleStatus, "active"),
          eq(quizVariants.resultsStatus, "valid"),
          eq(quizSets.status, "published"),
          eq(quizSets.submissionState, "open"),
          lte(quizSets.opensAt, lastSeenAt),
          gt(quizSets.closesAt, lastSeenAt),
        ));

      try {
        await database.batch([
          database.update(anonymousSessions).set({ lastSeenAt }).where(and(
            eq(anonymousSessions.sessionHash, submission.sessionHash),
            lte(anonymousSessions.lastSeenAt, lastSeenAt),
            gt(anonymousSessions.expiresAt, lastSeenAt),
            exists(acceptingVariant),
          )),
          database.insert(submissions).select(sql`
            select
              ${submission.id}, ${submission.quizVariantId}, ${submission.quizRevision},
              ${submission.sessionHash}, ${submission.idempotencyKey}, ${submission.requestHash},
              ${submission.displayName}, ${submission.comment}, ${JSON.stringify(answers)},
              ${submission.correctnessMask}, ${submission.correctCells}, ${submission.totalCells},
              ${submission.correctWords}, ${submission.totalWords}, ${submission.scoreBasisPoints},
              ${submission.isFullyCorrect ? 1 : 0}, 'visible', ${submission.submittedAt}, null, null
            from ${quizVariants}
            inner join ${quizSets} on ${quizSets.id} = ${quizVariants.quizSetId}
            where ${quizVariants.id} = ${submission.quizVariantId}
              and ${quizVariants.revision} = ${submission.quizRevision}
              and ${quizVariants.lifecycleStatus} = 'active'
              and ${quizVariants.resultsStatus} = 'valid'
              and ${quizSets.status} = 'published'
              and ${quizSets.submissionState} = 'open'
              and ${quizSets.opensAt} <= ${lastSeenAt}
              and ${quizSets.closesAt} > ${lastSeenAt}
          `),
        ] as const);
      } catch (error) {
        const concurrent = parseStoredSubmission(
          await findSubmissionRow(database, submission.quizVariantId, submission.sessionHash),
        );
        if (concurrent !== undefined) return classifyExisting(concurrent, submission);
        throw error;
      }

      const inserted = parseStoredSubmission(
        await findSubmissionRow(database, submission.quizVariantId, submission.sessionHash),
      );
      if (inserted === undefined) return { outcome: "closed" };
      if (inserted.status !== "visible") {
        throw new Error("Inserted submission is no longer visible");
      }

      return {
        outcome: "inserted",
        submission: inserted,
      };
    },
  };
}
