import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  participationBoardDataSchema,
  type ParticipationBoardData,
  type ParticipationBoardParticipant,
} from "../../../shared/api/participation-board";
import type { PrivateSolution, PublicPuzzleGrid } from "../../../shared/puzzle/types";
import type { Database } from "../db/client";
import {
  leaderboardSnapshotEntries,
  leaderboardSnapshots,
  quizVariants,
  submissions,
} from "../db/schema";
import { submissionAnswersSchema } from "../db/validation";
import { scoreSubmission, type SubmissionScore } from "../services/submission-scoring";

export class ParticipationBoardUnavailable extends Error {
  constructor() {
    super("PARTICIPATION_BOARD_UNAVAILABLE");
  }
}

export interface ParticipationBoardReadInput {
  currentSessionHash?: string;
  grid: PublicPuzzleGrid;
  quizRevision: number;
  quizStatus: "archived" | "published";
  quizVariantId: string;
  scoringSource?: {
    canonicalCellOrder: readonly string[];
    solution: PrivateSolution;
  };
}

function storedScoreMatches(
  row: {
    answers: Readonly<Record<string, string>>;
    correctCells: number;
    correctnessMask: string;
    correctWords: number;
    isFullyCorrect: boolean;
    quizRevision: number;
    scoreBasisPoints: number;
    totalCells: number;
    totalWords: number;
  },
  score: SubmissionScore,
): boolean {
  const storedAnswers = Object.entries(row.answers)
    .sort(([left], [right]) => left.localeCompare(right));
  const rescoredAnswers = Object.entries(score.answers)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(storedAnswers) === JSON.stringify(rescoredAnswers) &&
    row.correctnessMask === score.correctnessMask &&
    row.correctCells === score.correctCells &&
    row.totalCells === score.totalCells &&
    row.correctWords === score.correctWords &&
    row.totalWords === score.totalWords &&
    row.scoreBasisPoints === score.scoreBasisPoints &&
    row.isFullyCorrect === score.isFullyCorrect;
}

export function createParticipationBoardRepository(database: Database) {
  return {
    async read(input: ParticipationBoardReadInput): Promise<ParticipationBoardData> {
      const [variant] = await database.select({
        lifecycleStatus: quizVariants.lifecycleStatus,
        resultsStatus: quizVariants.resultsStatus,
        revision: quizVariants.revision,
        winnerCount: quizVariants.winnerCount,
      }).from(quizVariants).where(eq(quizVariants.id, input.quizVariantId));
      if (
        variant === undefined ||
        variant.lifecycleStatus !== "active" ||
        variant.revision !== input.quizRevision ||
        (input.quizStatus === "published" && variant.resultsStatus !== "valid") ||
        (input.quizStatus === "archived" &&
          variant.resultsStatus !== "valid" &&
          variant.resultsStatus !== "non_ranked_correction")
      ) {
        throw new ParticipationBoardUnavailable();
      }

      if (variant.resultsStatus === "non_ranked_correction") {
        const [unexpectedSubmission] = await database.select({ id: submissions.id })
          .from(submissions)
          .where(eq(submissions.quizVariantId, input.quizVariantId))
          .limit(1);
        if (unexpectedSubmission !== undefined) throw new ParticipationBoardUnavailable();
        return participationBoardDataSchema.parse({
          winnerCount: variant.winnerCount,
          participants: [],
          winners: [],
        });
      }

      const scoringSource = input.scoringSource;
      if (scoringSource === undefined) {
        throw new ParticipationBoardUnavailable();
      }

      const rows = await database.select({
        id: submissions.id,
        quizRevision: submissions.quizRevision,
        sessionHash: submissions.sessionHash,
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
        submittedAt: submissions.submittedAt,
      }).from(submissions).where(and(
        eq(submissions.quizVariantId, input.quizVariantId),
        eq(submissions.status, "visible"),
      )).orderBy(asc(submissions.submittedAt), asc(submissions.id));

      const participantBySubmissionId = new Map<string, ParticipationBoardParticipant>();
      const participants = rows.map((row, index) => {
        if (
          row.displayName === null ||
          row.answersJson === null ||
          !z.iso.datetime().safeParse(row.submittedAt).success
        ) {
          throw new ParticipationBoardUnavailable();
        }
        if (row.quizRevision !== input.quizRevision) {
          throw new ParticipationBoardUnavailable();
        }
        let answers: Readonly<Record<string, string>>;
        let score: SubmissionScore;
        try {
          answers = submissionAnswersSchema.parse(row.answersJson);
          score = scoreSubmission({
            canonicalCellOrder: scoringSource.canonicalCellOrder,
            grid: input.grid,
            solution: scoringSource.solution,
          }, answers);
        } catch {
          throw new ParticipationBoardUnavailable();
        }
        if (!storedScoreMatches({ ...row, answers }, score)) {
          throw new ParticipationBoardUnavailable();
        }
        const correctCellIds = scoringSource.canonicalCellOrder.filter(
          (_cellId, index) => score.correctnessMask[index] === "1",
        );
        const participant = {
          submissionOrder: index + 1,
          displayName: row.displayName,
          submittedAt: row.submittedAt,
          comment: row.comment,
          answers,
          correctCellIds,
          isFullyCorrect: row.isFullyCorrect,
          isMine: input.currentSessionHash !== undefined &&
            row.sessionHash === input.currentSessionHash,
        } satisfies ParticipationBoardParticipant;
        participantBySubmissionId.set(row.id, participant);
        return participant;
      });

      const winners = input.quizStatus === "published"
        ? rows
          .filter((row) => row.isFullyCorrect)
          .slice(0, variant.winnerCount)
          .map((row, index) => ({
            rank: index + 1,
            submissionOrder: participantBySubmissionId.get(row.id)!.submissionOrder,
          }))
        : await readArchivedWinners(
          database,
          input.quizVariantId,
          variant.winnerCount,
          participantBySubmissionId,
        );

      return participationBoardDataSchema.parse({
        winnerCount: variant.winnerCount,
        participants,
        winners,
      });
    },
  };
}

async function readArchivedWinners(
  database: Database,
  quizVariantId: string,
  winnerCount: number,
  participantBySubmissionId: ReadonlyMap<string, ParticipationBoardParticipant>,
) {
  const [snapshot] = await database.select({
    id: leaderboardSnapshots.id,
    finalizedAt: leaderboardSnapshots.finalizedAt,
    winnerCount: leaderboardSnapshots.winnerCount,
  }).from(leaderboardSnapshots).where(
    eq(leaderboardSnapshots.quizVariantId, quizVariantId),
  );
  if (
    snapshot === undefined ||
    snapshot.winnerCount !== winnerCount ||
    !z.iso.datetime().safeParse(snapshot.finalizedAt).success
  ) {
    throw new ParticipationBoardUnavailable();
  }

  const entries = await database.select({
    rank: leaderboardSnapshotEntries.rank,
    submissionId: leaderboardSnapshotEntries.submissionId,
    quizVariantId: submissions.quizVariantId,
    isFullyCorrect: submissions.isFullyCorrect,
  }).from(leaderboardSnapshotEntries)
    .innerJoin(submissions, eq(submissions.id, leaderboardSnapshotEntries.submissionId))
    .where(eq(leaderboardSnapshotEntries.snapshotId, snapshot.id))
    .orderBy(asc(leaderboardSnapshotEntries.rank));
  if (
    entries.length > winnerCount ||
    entries.some((entry, index) =>
      entry.rank !== index + 1 ||
      entry.rank > winnerCount ||
      entry.quizVariantId !== quizVariantId ||
      !entry.isFullyCorrect
    )
  ) {
    throw new ParticipationBoardUnavailable();
  }

  return entries.flatMap((entry) => {
    const participant = participantBySubmissionId.get(entry.submissionId);
    return participant === undefined
      ? []
      : [{ rank: entry.rank, submissionOrder: participant.submissionOrder }];
  });
}
