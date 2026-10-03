import { z } from "zod";

export const quizSetIdSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);

export const closeQuizSetNowRequestSchema = z.object({
  confirmation: z.literal("close_now"),
  reason: z.string()
    .trim()
    .min(2)
    .max(500)
    .refine((value) => [...value].every((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint > 31 && codePoint !== 127;
    })),
}).strict();

const closeQuizSetSnapshotSchema = z.object({
  quizVariantId: z.string().min(1).max(128),
  winnerCount: z.number().int().min(1).max(10),
  winnerSubmissionCount: z.number().int().min(0).max(10),
}).strict().refine(
  (snapshot) => snapshot.winnerSubmissionCount <= snapshot.winnerCount,
  { message: "winnerSubmissionCount cannot exceed winnerCount" },
);

export const closeQuizSetNowDataSchema = z.object({
  quizSetId: quizSetIdSchema,
  archivedAt: z.iso.datetime(),
  outcome: z.enum(["finalized", "replayed"]),
  snapshots: z.array(closeQuizSetSnapshotSchema).length(2),
}).strict().superRefine((value, context) => {
  if (new Set(value.snapshots.map((snapshot) => snapshot.quizVariantId)).size !== 2) {
    context.addIssue({
      code: "custom",
      message: "snapshot variants must be unique",
      path: ["snapshots"],
    });
  }
});

export type CloseQuizSetNowRequest = z.infer<typeof closeQuizSetNowRequestSchema>;
export type CloseQuizSetNowData = z.infer<typeof closeQuizSetNowDataSchema>;
