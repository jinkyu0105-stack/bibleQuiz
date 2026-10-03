import { z } from "zod";
import { closeQuizSetNowRequestSchema, quizSetIdSchema } from "./admin-finalization";

export const deadlineProposalSchema = z.object({
  closesAt: z.iso.datetime().transform(value => new Date(value).toISOString()),
  reason: closeQuizSetNowRequestSchema.shape.reason,
}).strict();
export const deadlineCommitSchema = deadlineProposalSchema.extend({
  requestKey: z.uuid(),
  confirmationToken: z.string().min(1).max(12000),
  confirmation: z.enum(["change_deadline", "close_now"]),
}).strict();
const impactSchema = z.object({
  total: z.number().int().nonnegative(), visible: z.number().int().nonnegative(),
  hidden: z.number().int().nonnegative(), deleted: z.number().int().nonnegative(),
}).strict();
export const deadlineViewSchema = z.object({
  quizSetId: quizSetIdSchema, closesAt: z.iso.datetime(), closesAtKst: z.string(),
  changeable: z.boolean(), paused: z.boolean(), remainingSeconds: z.number().int().nonnegative(),
  impact: impactSchema,
  history: z.array(z.object({ before: z.iso.datetime(), requested: z.iso.datetime(), after: z.iso.datetime(),
    reason: z.string(), createdAt: z.iso.datetime(), immediate: z.boolean() }).strict()),
}).strict();
export const deadlinePreviewSchema = z.object({
  quizSetId: quizSetIdSchema, previousClosesAt: z.iso.datetime(), previousKst: z.string(),
  requestedClosesAt: z.iso.datetime(), requestedKst: z.string(),
  remainingSeconds: z.number().int().nonnegative(), newRemainingSeconds: z.number().int().nonnegative(),
  immediate: z.boolean(), paused: z.boolean(), impact: impactSchema, confirmationToken: z.string(),
}).strict();
export const deadlineResultSchema = z.object({
  quizSetId: quizSetIdSchema, closesAt: z.iso.datetime(), archived: z.boolean(), outcome: z.enum(["changed", "replayed"]),
}).strict();
export type DeadlineView = z.infer<typeof deadlineViewSchema>;
export type DeadlinePreview = z.infer<typeof deadlinePreviewSchema>;
