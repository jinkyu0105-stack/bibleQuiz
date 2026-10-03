import { z } from "zod";
import { normalizedBibleReferenceSchema } from "../bible-reference";
import { adminSermonIdSchema } from "./admin-sermon-input";

const title = z.string().trim().min(1).max(300).transform(value => value.normalize("NFC"));
export const draftMetadataFields = {
  title, sermonDate: z.iso.date(), referenceInput: z.string().trim().min(1).max(120),
  confirmed: z.literal(true),
};
export const registerSermonSchema = z.strictObject({ video: z.string().trim().min(1).max(2048), ...draftMetadataFields });
export const saveDraftMetadataSchema = z.strictObject({ expectedRevision: z.int().positive().nullable(), ...draftMetadataFields });
export const draftItemSchema = z.strictObject({
  sermonId: adminSermonIdSchema, quizSetId: adminSermonIdSchema,
  title: z.string(), sermonDate: z.iso.date(), status: z.enum(["draft", "review_ready", "needs_revision"]),
  expired: z.boolean(),
});
export const draftListSchema = z.strictObject({ items: z.array(draftItemSchema) });
export const draftMetadataViewSchema = z.strictObject({
  sermonId: adminSermonIdSchema, quizSetId: adminSermonIdSchema, youtubeUrl: z.string().url(),
  metadataRevision: z.int().positive().nullable(), title: z.string(), sermonDate: z.iso.date(),
  bibleReference: normalizedBibleReferenceSchema.nullable(), referenceLabel: z.string(), slugPreview: z.string(),
});
export const registerSermonResultSchema = z.strictObject({
  outcome: z.enum(["created", "existing"]), sermonId: adminSermonIdSchema,
  destination: z.enum(["draft", "published", "expired"]),
});
export type DraftMetadataView = z.infer<typeof draftMetadataViewSchema>;
export type DraftItem = z.infer<typeof draftItemSchema>;
