import { z } from "zod";
import { closeQuizSetNowRequestSchema, quizSetIdSchema } from "./admin-finalization";

const wording = z.string().trim().min(1).max(20000).refine(v => !/[\p{Cc}\p{Cs}]/u.test(v.replaceAll("\n", "").replaceAll("\r", "").replaceAll("\t", "")));
export const wordingTargetSchema = z.strictObject({
  target: z.string().min(1), kind: z.enum(["summary", "clue"]),
  difficulty: z.enum(["child", "adult"]).nullable(), number: z.int().positive().nullable(),
  direction: z.enum(["across", "down"]).nullable(), text: wording,
});
export const wordingRequestSchema = z.strictObject({
  requestKey: z.uuid(), expectedRevision: z.int().nonnegative(), contentRevision: z.int().nonnegative(),
  target: z.string().min(1), before: wording, after: wording,
  assessment: z.literal("non_semantic_typo"), confirmation: z.literal("meaning_and_answer_unchanged"),
  reason: closeQuizSetNowRequestSchema.shape.reason,
}).refine(v => v.before !== v.after && (v.target === "summary" || v.after.length <= 2000));
export const wordingHistorySchema = z.strictObject({
  revision: z.int().positive(), target: z.string(), before: wording, after: wording,
  reason: closeQuizSetNowRequestSchema.shape.reason, createdAt: z.iso.datetime(),
});
export const wordingViewSchema = z.strictObject({
  quizSetId: quizSetIdSchema, revision: z.int().nonnegative(), contentRevision: z.int().nonnegative(),
  blocked: z.boolean(), targets: z.array(wordingTargetSchema), history: z.array(wordingHistorySchema),
});
export type WordingView = z.infer<typeof wordingViewSchema>;
