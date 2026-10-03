import { z } from "zod";
import { closeQuizSetNowRequestSchema, quizSetIdSchema } from "./admin-finalization";
import { quizSlugSchema } from "./public-quiz";

export const displayMetadataSchema = z.strictObject({
  title: z.string().trim().min(1).max(300).refine(value => !/[\p{Cc}\p{Cs}]/u.test(value)),
  sermonDate: z.iso.date(),
});
export const displayTextRequestSchema = z.strictObject({
  requestKey: z.uuid(), expectedRevision: z.int().nonnegative(),
  before: displayMetadataSchema, after: displayMetadataSchema,
  reason: closeQuizSetNowRequestSchema.shape.reason,
}).refine(value => value.before.title !== value.after.title || value.before.sermonDate !== value.after.sermonDate);
export const publishedMetadataSchema = z.strictObject({
  quizSetId: quizSetIdSchema, slug: quizSlugSchema, status: z.enum(["published", "archived"]),
  revision: z.int().nonnegative(), metadata: displayMetadataSchema,
  publishedAt: z.iso.datetime(), closesAt: z.iso.datetime(),
});
export const publishedMetadataListSchema = z.strictObject({ items: z.array(publishedMetadataSchema) });
export const displayTextHistorySchema = z.strictObject({
  revision: z.int().positive(), before: displayMetadataSchema, after: displayMetadataSchema,
  reason: closeQuizSetNowRequestSchema.shape.reason, createdAt: z.iso.datetime(),
});
export const displayTextViewSchema = z.strictObject({
  quiz: publishedMetadataSchema, history: z.array(displayTextHistorySchema),
});
export const displayTextResultSchema = z.strictObject({
  outcome: z.enum(["changed", "replayed"]), quizSetId: quizSetIdSchema, revision: z.int().positive(),
});
export type DisplayMetadata = z.infer<typeof displayMetadataSchema>;
export type PublishedMetadata = z.infer<typeof publishedMetadataSchema>;
export type DisplayTextView = z.infer<typeof displayTextViewSchema>;
