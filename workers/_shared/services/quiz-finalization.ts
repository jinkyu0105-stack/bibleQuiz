import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";

import type { Difficulty } from "../../../shared/api/public-quiz";
import type { Database } from "../db/client";
import {
  auditLogs,
  leaderboardSnapshotEntries,
  leaderboardSnapshots,
  quizSets,
  quizVariants,
  sermons,
  submissions,
} from "../db/schema";
import {
  createParticipationBoardRepository,
} from "../repositories/participation-board-repository";
import { createPublicQuizRepository } from "../repositories/public-quiz-repository";
import { createSubmissionRepository } from "../repositories/submission-repository";

export class QuizFinalizationNotDue extends Error {
  constructor() {
    super("QUIZ_FINALIZATION_NOT_DUE");
  }
}

export class QuizFinalizationUnavailable extends Error {
  constructor() {
    super("QUIZ_FINALIZATION_UNAVAILABLE");
  }
}

export class QuizFinalizationNotFound extends QuizFinalizationUnavailable {
  constructor() {
    super();
    this.message = "QUIZ_FINALIZATION_NOT_FOUND";
  }
}

export class QuizFinalizationInvalidState extends QuizFinalizationUnavailable {
  constructor() {
    super();
    this.message = "QUIZ_FINALIZATION_INVALID_STATE";
  }
}

interface FinalizationVariant {
  difficulty: Difficulty;
  id: string;
  revision: number;
  winnerCount: number;
}

export interface QuizFinalizationSnapshot {
  quizVariantId: string;
  winnerCount: number;
  winnerSubmissionIds: readonly string[];
}

export interface QuizFinalizationResult {
  archivedAt: string;
  outcome: "finalized" | "replayed";
  quizSetId: string;
  snapshots: readonly QuizFinalizationSnapshot[];
}

export interface QuizFinalizationOptions {
  snapshotId?: (quizVariantId: string) => string;
  /** Internal transaction guard for a confirmed deadline change. */
  beforeCloseNow?: readonly BatchItem<"sqlite">[];
}

export interface QuizCloseNowInput {
  actorEmail: string;
  auditId: string;
  reason: string;
}

const quizCloseNowInputSchema = z.object({
  actorEmail: z.string().email().max(320),
  auditId: z.string().min(1).max(128),
  reason: z.string()
    .trim()
    .min(2)
    .max(500)
    .refine((value) => [...value].every((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint > 31 && codePoint !== 127;
    })),
}).strict();

const expectedDifficulties = ["adult", "child"] satisfies Difficulty[];

async function readQuizSet(database: Database, quizSetId: string) {
  const [row] = await database.select({
    archivedAt: quizSets.archivedAt,
    closesAt: quizSets.closesAt,
    id: quizSets.id,
    opensAt: quizSets.opensAt,
    slug: sermons.slug,
    status: quizSets.status,
  }).from(quizSets)
    .innerJoin(sermons, eq(sermons.id, quizSets.sermonId))
    .where(eq(quizSets.id, quizSetId));
  return row;
}

async function readFinalizationVariants(
  database: Database,
  quizSetId: string,
): Promise<FinalizationVariant[]> {
  const rows = await database.select({
    difficulty: quizVariants.difficulty,
    id: quizVariants.id,
    lifecycleStatus: quizVariants.lifecycleStatus,
    resultsStatus: quizVariants.resultsStatus,
    revision: quizVariants.revision,
    winnerCount: quizVariants.winnerCount,
  }).from(quizVariants)
    .where(eq(quizVariants.quizSetId, quizSetId))
    .orderBy(asc(quizVariants.difficulty), asc(quizVariants.id));
  const active = rows.filter((row) => row.lifecycleStatus === "active");
  if (
    active.length !== expectedDifficulties.length ||
    active.some((row) => row.resultsStatus !== "valid") ||
    active.map((row) => row.difficulty).sort().some(
      (difficulty, index) => difficulty !== expectedDifficulties[index],
    )
  ) {
    throw new QuizFinalizationUnavailable();
  }
  return active.map(({ difficulty, id, revision, winnerCount }) => ({
    difficulty,
    id,
    revision,
    winnerCount,
  }));
}

async function validateStoredResults(
  database: Database,
  slug: string,
  variants: readonly FinalizationVariant[],
  quizStatus: "archived" | "published",
  now: Date,
): Promise<void> {
  const publicRepository = createPublicQuizRepository(database);
  const submissionRepository = createSubmissionRepository(database);
  const boardRepository = createParticipationBoardRepository(database);
  for (const variant of variants) {
    const quiz = (await publicRepository.read({ slug }, variant.difficulty, now)).quiz;
    if (
      quiz === null ||
      quiz.status !== quizStatus ||
      quiz.variant.id !== variant.id ||
      quiz.variant.revision !== variant.revision
    ) {
      throw new QuizFinalizationUnavailable();
    }
    const solution = await submissionRepository.findScoringSolution(variant.id);
    if (solution === undefined) throw new QuizFinalizationUnavailable();
    await boardRepository.read({
      grid: quiz.variant.grid,
      quizRevision: variant.revision,
      quizStatus,
      quizVariantId: variant.id,
      scoringSource: {
        canonicalCellOrder: solution.canonicalCellOrder,
        solution: solution.solution,
      },
    });
  }
}

async function readAndValidateSnapshots(
  database: Database,
  archivedAt: string,
  closesAt: string,
  variants: readonly FinalizationVariant[],
): Promise<QuizFinalizationSnapshot[]> {
  const rows = await database.select({
    finalizedAt: leaderboardSnapshots.finalizedAt,
    quizVariantId: leaderboardSnapshots.quizVariantId,
    rank: leaderboardSnapshotEntries.rank,
    snapshotId: leaderboardSnapshots.id,
    submissionId: leaderboardSnapshotEntries.submissionId,
    submissionQuizVariantId: submissions.quizVariantId,
    submissionQuizRevision: submissions.quizRevision,
    winnerCount: leaderboardSnapshots.winnerCount,
  }).from(leaderboardSnapshots)
    .leftJoin(
      leaderboardSnapshotEntries,
      eq(leaderboardSnapshotEntries.snapshotId, leaderboardSnapshots.id),
    )
    .leftJoin(submissions, eq(submissions.id, leaderboardSnapshotEntries.submissionId))
    .where(inArray(leaderboardSnapshots.quizVariantId, variants.map((variant) => variant.id)))
    .orderBy(asc(leaderboardSnapshots.quizVariantId), asc(leaderboardSnapshotEntries.rank));

  return variants.map((variant) => {
    const snapshotRows = rows.filter((row) => row.quizVariantId === variant.id);
    const first = snapshotRows[0];
    if (
      first === undefined ||
      first.winnerCount !== variant.winnerCount ||
      first.finalizedAt !== archivedAt ||
      !z.iso.datetime().safeParse(first.finalizedAt).success ||
      Date.parse(first.finalizedAt) < Date.parse(closesAt) ||
      snapshotRows.some((row) =>
        row.snapshotId !== first.snapshotId ||
        row.winnerCount !== variant.winnerCount ||
        row.finalizedAt !== first.finalizedAt
      )
    ) {
      throw new QuizFinalizationUnavailable();
    }
    const entryRows = snapshotRows.filter(
      (row): row is typeof row & { rank: number; submissionId: string } =>
        row.rank !== null && row.submissionId !== null,
    );
    if (
      entryRows.length > variant.winnerCount ||
      entryRows.some((row, index) =>
        row.rank !== index + 1 ||
        row.submissionQuizVariantId !== variant.id ||
        row.submissionQuizRevision !== variant.revision
      )
    ) {
      throw new QuizFinalizationUnavailable();
    }
    return {
      quizVariantId: variant.id,
      winnerCount: variant.winnerCount,
      winnerSubmissionIds: entryRows.map((row) => row.submissionId),
    };
  });
}

async function readArchivedFinalization(
  database: Database,
  set: NonNullable<Awaited<ReturnType<typeof readQuizSet>>>,
  variants: readonly FinalizationVariant[],
  now: Date,
): Promise<QuizFinalizationResult> {
  if (
    set.status !== "archived" ||
    set.slug === null ||
    set.closesAt === null ||
    set.archivedAt === null ||
    !z.iso.datetime().safeParse(set.closesAt).success ||
    !z.iso.datetime().safeParse(set.archivedAt).success
  ) {
    throw new QuizFinalizationUnavailable();
  }
  await validateStoredResults(database, set.slug, variants, "archived", now);
  return {
    archivedAt: set.archivedAt,
    outcome: "replayed",
    quizSetId: set.id,
    snapshots: await readAndValidateSnapshots(
      database,
      set.archivedAt,
      set.closesAt,
      variants,
    ),
  };
}

export function createQuizFinalizationService(
  database: Database,
  options: QuizFinalizationOptions = {},
) {
  const snapshotId = options.snapshotId ?? (() => crypto.randomUUID());

  async function finalizeQuizSet(
    quizSetId: string,
    now: Date,
    closeNow?: QuizCloseNowInput,
  ): Promise<QuizFinalizationResult> {
      if (!Number.isFinite(now.getTime())) throw new QuizFinalizationUnavailable();
      const finalizedAt = now.toISOString();
      if (!z.iso.datetime().safeParse(finalizedAt).success) {
        throw new QuizFinalizationUnavailable();
      }
      const parsedCloseNow = closeNow === undefined
        ? undefined
        : quizCloseNowInputSchema.safeParse(closeNow);
      if (parsedCloseNow !== undefined && !parsedCloseNow.success) {
        throw new QuizFinalizationUnavailable();
      }

      try {
        const set = await readQuizSet(database, quizSetId);
        if (set === undefined) throw new QuizFinalizationNotFound();
        if (
          set.slug === null ||
          set.opensAt === null ||
          set.closesAt === null ||
          !z.iso.datetime().safeParse(set.opensAt).success ||
          !z.iso.datetime().safeParse(set.closesAt).success
        ) {
          throw new QuizFinalizationUnavailable();
        }
        const variants = await readFinalizationVariants(database, quizSetId);

        if (set.status === "archived") {
          return readArchivedFinalization(database, set, variants, now);
        }
        if (set.status !== "published") throw new QuizFinalizationInvalidState();
        if (parsedCloseNow === undefined && now.getTime() < Date.parse(set.closesAt)) {
          throw new QuizFinalizationNotDue();
        }

        const preexistingSnapshots = await database.select({ id: leaderboardSnapshots.id })
          .from(leaderboardSnapshots)
          .where(inArray(leaderboardSnapshots.quizVariantId, variants.map((variant) => variant.id)));
        if (preexistingSnapshots.length > 0) throw new QuizFinalizationUnavailable();

        await validateStoredResults(database, set.slug, variants, "published", now);

        const ids = variants.map((variant) => ({
          quizVariantId: variant.id,
          snapshotId: snapshotId(variant.id),
        }));
        if (
          new Set(ids.map((item) => item.snapshotId)).size !== ids.length ||
          ids.some((item) => item.snapshotId.length < 1 || item.snapshotId.length > 128)
        ) {
          throw new QuizFinalizationUnavailable();
        }

        const statements: BatchItem<"sqlite">[] = parsedCloseNow === undefined ? [] : [...(options.beforeCloseNow ?? [])];
        if (parsedCloseNow !== undefined) {
          statements.push(database.update(quizSets).set({
            closesAt: finalizedAt,
            updatedAt: finalizedAt,
          }).where(and(
            eq(quizSets.id, quizSetId),
            eq(quizSets.status, "published"),
            isNull(quizSets.archivedAt),
          )));
        }
        statements.push(...variants.flatMap((variant) => {
          const id = ids.find((item) => item.quizVariantId === variant.id)!.snapshotId;
          return [
            database.insert(leaderboardSnapshots).select(sql`
              select ${id}, ${variant.id}, ${variant.winnerCount}, ${finalizedAt}
              from ${quizVariants}
              inner join ${quizSets} on ${quizSets.id} = ${quizVariants.quizSetId}
              where ${quizSets.id} = ${quizSetId}
                and ${quizSets.status} = 'published'
                and ${quizSets.archivedAt} is null
                and ${quizSets.closesAt} <= ${finalizedAt}
                and ${quizVariants.id} = ${variant.id}
                and ${quizVariants.revision} = ${variant.revision}
                and ${quizVariants.lifecycleStatus} = 'active'
                and ${quizVariants.resultsStatus} = 'valid'
                and not exists (
                  select 1 from ${leaderboardSnapshots}
                  where ${leaderboardSnapshots.quizVariantId} = ${variant.id}
                )
            `),
            database.insert(leaderboardSnapshotEntries).select(sql`
              select
                ${id},
                row_number() over (order by ${submissions.submittedAt}, ${submissions.id}),
                ${submissions.id}
              from ${submissions}
              where ${submissions.quizVariantId} = ${variant.id}
                and ${submissions.quizRevision} = ${variant.revision}
                and ${submissions.status} = 'visible'
                and ${submissions.isFullyCorrect} = 1
                and exists (
                  select 1 from ${leaderboardSnapshots}
                  where ${leaderboardSnapshots.id} = ${id}
                    and ${leaderboardSnapshots.quizVariantId} = ${variant.id}
                )
              order by ${submissions.submittedAt}, ${submissions.id}
              limit ${variant.winnerCount}
            `),
          ];
        }));
        statements.push(
          database.update(quizSets).set({
            archivedAt: finalizedAt,
            status: "archived",
            updatedAt: finalizedAt,
          }).where(and(
            eq(quizSets.id, quizSetId),
            eq(quizSets.status, "published"),
            isNull(quizSets.archivedAt),
            lte(quizSets.closesAt, finalizedAt),
            sql`(
              select count(*) from ${quizVariants}
              where ${quizVariants.quizSetId} = ${quizSetId}
                and ${quizVariants.lifecycleStatus} = 'active'
                and ${quizVariants.resultsStatus} = 'valid'
            ) = ${variants.length}`,
            sql`(
              select count(*) from ${leaderboardSnapshots}
              where ${inArray(
                leaderboardSnapshots.quizVariantId,
                variants.map((variant) => variant.id),
              )}
            ) = ${variants.length}`,
          )),
        );
        if (parsedCloseNow !== undefined) {
          statements.push(database.insert(auditLogs).values({
            action: "close_now",
            actorEmail: parsedCloseNow.data.actorEmail,
            actorType: "access_admin",
            createdAt: finalizedAt,
            entityId: quizSetId,
            entityType: "quiz_set",
            id: parsedCloseNow.data.auditId,
            safeMetadataJson: {
              previousClosesAt: set.closesAt,
              reason: parsedCloseNow.data.reason,
            },
          }));
        }

        await database.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

        const archived = await readQuizSet(database, quizSetId);
        if (
          archived?.status !== "archived" ||
          archived.slug === null ||
          archived.closesAt === null ||
          archived.archivedAt === null ||
          !z.iso.datetime().safeParse(archived.archivedAt).success
        ) {
          throw new QuizFinalizationUnavailable();
        }
        const snapshots = await readAndValidateSnapshots(
          database,
          archived.archivedAt,
          archived.closesAt,
          variants,
        );
        await validateStoredResults(database, archived.slug, variants, "archived", now);
        const generatedIds = new Set(ids.map((item) => item.snapshotId));
        const storedIds = await database.select({ id: leaderboardSnapshots.id })
          .from(leaderboardSnapshots)
          .where(inArray(leaderboardSnapshots.quizVariantId, variants.map((variant) => variant.id)));
        return {
          archivedAt: archived.archivedAt,
          outcome: storedIds.every((item) => generatedIds.has(item.id))
            ? "finalized"
            : "replayed",
          quizSetId,
          snapshots,
        };
      } catch (error) {
        if (error instanceof QuizFinalizationNotDue) throw error;
        const unavailable = error instanceof QuizFinalizationUnavailable
          ? error
          : new QuizFinalizationUnavailable();
        try {
          const current = await readQuizSet(database, quizSetId);
          if (current?.status === "archived") {
            const currentVariants = await readFinalizationVariants(database, quizSetId);
            return await readArchivedFinalization(database, current, currentVariants, now);
          }
        } catch {
          // Keep the stable internal error below. A failed replay validation must
          // never make a damaged archive look successfully finalized.
        }
        throw unavailable;
      }
  }

  return {
    closeQuizSetNow(
      quizSetId: string,
      input: QuizCloseNowInput,
      now = new Date(),
    ): Promise<QuizFinalizationResult> {
      return finalizeQuizSet(quizSetId, now, input);
    },
    finalizeDueQuizSet(quizSetId: string, now = new Date()): Promise<QuizFinalizationResult> {
      return finalizeQuizSet(quizSetId, now);
    },
  };
}
