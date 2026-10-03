import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const assessment = z.enum(["not_checked", "confirmed", "needs_review"]);
export const intentQualityCriteriaSchema = z.strictObject({
  centralTheme: assessment,
  illustrationDistinction: assessment,
  audienceApplication: assessment,
  unsupportedConclusion: assessment,
  repeatedEmphasis: assessment,
});
export const contentQualityRequestSchema = z.strictObject({
  requestKey: z.uuid(),
  expectedVersion: z.int().positive(),
  targetSnapshotId: id,
  scope: z.enum(["intent", "summary", "child", "adult"]),
  status: z.enum(["good", "edited_then_use", "regenerate"]),
  criteria: z.union([intentQualityCriteriaSchema, z.strictObject({})]),
  adminNote: z.string().max(2000).refine(value =>
    // eslint-disable-next-line no-control-regex -- Private human notes may contain newlines, not controls or broken UTF-16.
    !/[\uD800-\uDFFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)).nullable(),
});
export const contentQualityReviewSchema = contentQualityRequestSchema.pick({
  targetSnapshotId: true, scope: true, status: true, criteria: true, adminNote: true,
}).extend({ revision: z.int().positive(), createdAt: z.iso.datetime(), editedRevisionId: id.nullable() });
export const contentQualityDataSchema = z.strictObject({ outcome: z.enum(["saved", "replayed"]), review: contentQualityReviewSchema });
export type ContentQualityRequest = z.infer<typeof contentQualityRequestSchema>;
export type ContentQualityReview = z.infer<typeof contentQualityReviewSchema>;
