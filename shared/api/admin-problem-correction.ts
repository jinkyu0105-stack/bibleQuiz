import { z } from "zod";
import { revisionCommandSchema, revisionViewSchema } from "./admin-quiz-revision";
import { difficultySchema } from "./public-quiz";
const reason = z.string().trim().min(2).max(500).refine(s => [...s].every(c => c.codePointAt(0)!>31 && c.codePointAt(0)!==127));
export const problemStartSchema = z.strictObject({ action:z.literal("start"),requestKey:z.uuid(),expectedCycle:z.int().nonnegative(),
  expectedVariants:z.strictObject({child:z.string().min(1).max(128),adult:z.string().min(1).max(128)}),
  levels:z.array(difficultySchema).min(1).max(2).refine(v => new Set(v).size===v.length), reason,notice:reason,
});
export const problemCancelSchema = z.strictObject({ action:z.literal("cancel"),requestKey:z.uuid(),sessionId:z.uuid(),expectedRevision:z.int().positive(),reason,
  confirmation:z.literal("not_an_error_resume") });
export const problemCommandSchema = z.union([problemStartSchema,problemCancelSchema,...revisionCommandSchema.options.slice(1)]);
export const problemViewSchema = z.strictObject({ editor:revisionViewSchema.nullable(),cycle:z.int().nonnegative(),
  status:z.enum(["ready","editing","published","cancelled","expired"]),closesAt:z.iso.datetime(),
  notice:z.string().nullable(),levels:z.array(difficultySchema),
  variants:z.strictObject({child:z.string(),adult:z.string()}),
  impact:z.array(z.strictObject({difficulty:difficultySchema,variantId:z.string(),revision:z.int(),visible:z.int(),hidden:z.int(),deleted:z.int(),winners:z.int()})),
  nonRanked:z.boolean(),
});
export type ProblemView = z.infer<typeof problemViewSchema>;
export const problemRecordsSchema=z.strictObject({items:z.array(z.strictObject({caseId:z.uuid(),createdAt:z.iso.datetime(),notice:z.string(),reason:z.string(),
 outcome:z.enum(["pending","publish","cancel"]),source:revisionViewSchema.shape.body.unwrap()}))});
