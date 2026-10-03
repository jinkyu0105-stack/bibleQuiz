import { z } from "zod";

import { revealedSolutionSchema } from "./solution";

const cellIdSchema = z.string().regex(/^r[0-9]c[0-9]$/u);
const completeHangulSyllableSchema = z
  .string()
  .transform((value) => value.normalize("NFC"))
  .pipe(z.string().regex(/^[\uAC00-\uD7A3]$/u));
const writtenCellsSchema = z
  .record(cellIdSchema, completeHangulSyllableSchema)
  .refine((cells) => Object.keys(cells).length <= 100);

/**
 * Browser-safe submission boundary. Name and comment moderation is deliberately
 * server-owned; these limits only bound the JSON before that policy runs.
 */
export const submissionRequestSchema = z.strictObject({
  revision: z.int().positive(),
  idempotencyKey: z.uuidv7(),
  turnstileToken: z.string().min(1).max(2_048),
  name: z.string().min(1).max(128),
  comment: z.string().max(512),
  consent: z.literal(true),
  cells: writtenCellsSchema,
});

export const submissionDeletionRequestSchema = z.strictObject({});

export const submissionResultSchema = z.strictObject({
  submissionId: z.string().min(1).max(128),
  submittedAt: z.iso.datetime(),
  correctCells: z.int().nonnegative(),
  totalCells: z.int().positive().max(100),
  correctWords: z.int().nonnegative(),
  totalWords: z.int().positive().max(100),
  scoreBasisPoints: z.int().min(0).max(10_000),
  correctnessMask: z.string().regex(/^[01]{1,100}$/u),
  canRevealAnswer: z.literal(true),
  solution: revealedSolutionSchema,
}).superRefine((result, context) => {
  if (
    result.correctCells > result.totalCells ||
    result.correctWords > result.totalWords ||
    result.correctnessMask.length !== result.totalCells ||
    Array.from(result.correctnessMask).filter((value) => value === "1").length !== result.correctCells ||
    result.scoreBasisPoints !== Math.round((result.correctCells / result.totalCells) * 10_000) ||
    Object.keys(result.solution.cells).length !== result.totalCells ||
    Object.keys(result.solution.entries).length !== result.totalWords
  ) {
    context.addIssue({ code: "custom", message: "Invalid submission result totals" });
  }
});

const submittedAnswersSchema = writtenCellsSchema.refine(
  (cells) => Object.keys(cells).length > 0,
  { message: "A stored submission must contain at least one answer" },
);

const ownedStoredSubmissionSchema = z.strictObject({
  status: z.literal("submitted"),
  quizVariantId: z.string().min(1).max(128),
  quizRevision: z.int().positive(),
  answers: submittedAnswersSchema,
  result: submissionResultSchema,
}).superRefine((submission, context) => {
  const solutionCellIds = new Set(Object.keys(submission.result.solution.cells));
  if (Object.keys(submission.answers).some((cellId) => !solutionCellIds.has(cellId))) {
    context.addIssue({ code: "custom", message: "Stored answers must belong to the revealed solution" });
  }
});

const ownedDeletedSubmissionSchema = z.strictObject({
  status: z.literal("deleted"),
  quizVariantId: z.string().min(1).max(128),
  quizRevision: z.int().positive(),
  deletedAt: z.iso.datetime(),
});

export const submissionDeletionDataSchema = z.strictObject({
  submission: ownedDeletedSubmissionSchema,
});

/**
 * Browser-safe result for an exact quiz variant and the current anonymous
 * session. Deleted submissions deliberately contain neither answers nor a
 * solution, while missing/unknown sessions are represented by null.
 */
export const ownSubmissionSchema = z.discriminatedUnion("status", [
  ownedStoredSubmissionSchema,
  ownedDeletedSubmissionSchema,
]);

export const ownSubmissionDataSchema = z.strictObject({
  submission: ownSubmissionSchema.nullable(),
});

export type SubmissionRequest = z.infer<typeof submissionRequestSchema>;
export type SubmissionResult = z.infer<typeof submissionResultSchema>;
export type SubmissionDeletionData = z.infer<typeof submissionDeletionDataSchema>;
export type OwnSubmission = z.infer<typeof ownSubmissionSchema>;
export type OwnSubmissionData = z.infer<typeof ownSubmissionDataSchema>;
