import { z } from "zod";

const cellIdSchema = z.string().regex(/^r[0-9]c[0-9]$/u);
const completeHangulSyllableSchema = z.string().refine(
  (value) => value === value.normalize("NFC") && /^[\uAC00-\uD7A3]$/u.test(value),
  { message: "Expected one NFC Hangul syllable" },
);
const participantAnswersSchema = z
  .record(cellIdSchema, completeHangulSyllableSchema)
  .refine((answers) => {
    const count = Object.keys(answers).length;
    return count > 0 && count <= 100;
  });
const displayNameSchema = z.string().min(2).max(12).refine(
  (value) => value === value.normalize("NFC").trim() &&
    /^[가-힣A-Za-z0-9]+(?: [가-힣A-Za-z0-9]+)*$/u.test(value),
  { message: "Invalid public display name" },
);
const commentSchema = z.string().max(80).refine(
  (value) => value.length > 0 && value === value.normalize("NFC").trim() &&
    !/[\p{Cc}\p{Cf}]/u.test(value) &&
    /^[가-힣A-Za-z0-9 .,!?'"():;~…-]+$/u.test(value),
  { message: "Invalid public comment" },
).nullable();

export const participationBoardParticipantSchema = z.strictObject({
  submissionOrder: z.int().positive(),
  displayName: displayNameSchema,
  submittedAt: z.iso.datetime(),
  comment: commentSchema,
  answers: participantAnswersSchema,
  correctCellIds: z.array(cellIdSchema).max(100),
  isFullyCorrect: z.boolean(),
  isMine: z.boolean(),
}).superRefine((participant, context) => {
  const correctCellIds = new Set(participant.correctCellIds);
  if (
    correctCellIds.size !== participant.correctCellIds.length ||
    participant.correctCellIds.some((cellId) => participant.answers[cellId] === undefined) ||
    (participant.isFullyCorrect && correctCellIds.size !== Object.keys(participant.answers).length)
  ) {
    context.addIssue({ code: "custom", message: "Invalid participant correctness" });
  }
});

export const participationBoardWinnerSchema = z.strictObject({
  rank: z.int().min(1).max(10),
  submissionOrder: z.int().positive(),
});

/**
 * Public participation data for one exact variant. Winner rows only reference
 * participants already present in this response, avoiding a second copy of
 * names or answers. Archived ranks may contain gaps after hide/delete.
 */
export const participationBoardDataSchema = z.strictObject({
  winnerCount: z.int().min(1).max(10),
  participants: z.array(participationBoardParticipantSchema).max(500),
  winners: z.array(participationBoardWinnerSchema).max(10),
}).superRefine((board, context) => {
  const mineCount = board.participants.filter((participant) => participant.isMine).length;
  if (mineCount > 1) {
    context.addIssue({ code: "custom", message: "Only one participant can be mine" });
  }

  board.participants.forEach((participant, index) => {
    if (participant.submissionOrder !== index + 1) {
      context.addIssue({ code: "custom", message: "Participant order must be contiguous" });
    }
    const previous = board.participants[index - 1];
    if (previous !== undefined && previous.submittedAt > participant.submittedAt) {
      context.addIssue({ code: "custom", message: "Participants must be time ordered" });
    }
  });

  const ranks = new Set<number>();
  const winnerOrders = new Set<number>();
  board.winners.forEach((winner, index) => {
    if (
      winner.rank > board.winnerCount ||
      ranks.has(winner.rank) ||
      winnerOrders.has(winner.submissionOrder) ||
      (index > 0 && board.winners[index - 1]!.rank >= winner.rank)
    ) {
      context.addIssue({ code: "custom", message: "Invalid winner ordering" });
    }
    ranks.add(winner.rank);
    winnerOrders.add(winner.submissionOrder);
    const participant = board.participants[winner.submissionOrder - 1];
    if (participant === undefined || !participant.isFullyCorrect) {
      context.addIssue({ code: "custom", message: "Winner must reference a fully correct participant" });
    }
  });
});

export type ParticipationBoardParticipant = z.infer<typeof participationBoardParticipantSchema>;
export type ParticipationBoardWinner = z.infer<typeof participationBoardWinnerSchema>;
export type ParticipationBoardData = z.infer<typeof participationBoardDataSchema>;
