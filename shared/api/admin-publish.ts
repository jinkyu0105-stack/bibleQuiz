import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
export const adminPublishRequestSchema = z.strictObject({
  requestKey: z.uuid(), jobId: id, expectedVersion: z.int().positive(),
  expectedMetadataRevision: z.int().positive(), expectedSelectionRevision: z.int().positive(),
  confirmation: z.literal("publish"),
});
export const adminPublishDataSchema = z.strictObject({
  outcome: z.enum(["published", "replayed"]), quizSetId: id,
  slug: z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$/u),
  publishedAt: z.iso.datetime(), closesAt: z.iso.datetime(),
});
