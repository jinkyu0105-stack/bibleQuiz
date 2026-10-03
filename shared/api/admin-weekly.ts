import { z } from "zod";
import { adminSubmissionIdSchema, adminModerationReasonSchema } from "./admin-submission-moderation";
const id = adminSubmissionIdSchema;
const time = z.iso.datetime();
export const weeklyQuizSchema = z.strictObject({
  quizSetId: id, sermonId: id, title: z.string(), sermonDate: z.string(), slug: z.string().nullable(),
  status: z.enum(["draft", "needs_revision", "review_ready", "published", "archived"]),
  submissionStatus: z.enum(["open", "paused", "closed"]), closesAt: time.nullable(), updatedAt: time,
  featured: z.boolean(), withdrawn: z.boolean().default(false), expired: z.boolean(), stage: z.string().nullable(), jobStatus: z.string().nullable(),
  childWinnerCount: z.int().min(1).max(10).default(3), adultWinnerCount: z.int().min(1).max(10).default(3),
  childVisibleCount: z.int().nonnegative().default(0), adultVisibleCount: z.int().nonnegative().default(0),
  visibleCount: z.int().nonnegative(), totalCount: z.int().nonnegative(),
});
export const weeklyDashboardSchema = z.strictObject({ items: z.array(weeklyQuizSchema), unansweredCount: z.int().nonnegative() });
export type WeeklyQuiz = z.infer<typeof weeklyQuizSchema>;
export const submissionListSchema = z.strictObject({ items: z.array(z.strictObject({
  id, difficulty: z.enum(["child", "adult"]), revision: z.int().positive(), status: z.enum(["visible", "hidden", "deleted"]),
  displayName: z.string().nullable(), comment: z.string().nullable(), submittedAt: time,
  scorePercent: z.number(), answers: z.record(z.string(), z.string()).nullable(),
  actions: z.array(z.strictObject({ action: z.string(), reason: z.string(), createdAt: time })),
})) });
export const winnerSettingsSchema = z.strictObject({ child: z.int().min(1).max(10), adult: z.int().min(1).max(10), editable: z.boolean(), revision: z.string() });
export const winnerSettingsRequestSchema = z.strictObject({ child: z.int().min(1).max(10), adult: z.int().min(1).max(10), expectedRevision: z.string(), reason: adminModerationReasonSchema });
const text = z.string().trim().min(1).max(200).refine(v => !/[\p{Cc}\p{Cf}]/u.test(v));
export const policyCreateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("reserved"), label: text, aliases: z.array(text).min(1).max(50) }),
  z.strictObject({ kind: z.literal("term"), value: text, scope: z.enum(["name", "comment", "answer", "all"]), matchMode: z.enum(["exact", "contains"]) }),
  z.strictObject({ kind: z.literal("exception"), value: text, scope: z.enum(["name", "comment", "answer"]), reason: adminModerationReasonSchema, acknowledged: z.literal(true) }),
]);
export const policyPatchSchema = z.strictObject({ enabled: z.boolean(), expectedUpdatedAt: time, value: text.optional(), reason: adminModerationReasonSchema });
export const policyListSchema = z.strictObject({ items: z.array(z.strictObject({
  id, kind: z.enum(["reserved", "term", "exception"]), groupId: id.nullable(), label: z.string(), value: z.string(),
  scope: z.string(), matchMode: z.string(), enabled: z.boolean(), updatedAt: time,
})) });
export const policyTestSchema = z.strictObject({ value: z.string().max(1000), scope: z.enum(["name", "comment", "answer"]) });
export const policyTestResultSchema = z.strictObject({ normalizedValue: z.string(), blocked: z.boolean(), matchedRuleId: z.string().nullable() });
