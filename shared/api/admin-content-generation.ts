import { contentQualityReviewSchema } from "./admin-content-quality";
import { adminPlacementStateSchema, adminPlacementLayoutSchema } from "./admin-placement";
import { z } from "zod";
import { quizSlugSchema } from "./public-quiz";
import { intentAnalysisSchema, intentCritiqueSchema, intentTranscriptBindingSchema, intentOperationSchema } from "../../workers/_shared/services/sermon-intent-contract";
import { sermonSummaryDraftSchema, summaryBindingSchema, summaryOperationSchema } from "../../workers/_shared/services/sermon-summary-contract";
import { candidateReplacementSchema, sermonCandidateDraftSchema, candidateOperationSchema, candidateStatusSchema } from "../../workers/_shared/services/sermon-candidates-contract";
import { publicPuzzleGridSchema } from "./public-quiz";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const options = z.strictObject({ gridSizes: z.array(z.int().min(5).max(10)).min(1).max(6), targetWordCounts: z.array(z.int().min(1).max(100)).min(1).max(100),
  seed: z.string().min(1).max(128), maxTrials: z.int().min(1).max(256), searchBudgetPerTrial: z.int().min(1).max(300000) });
const placement = z.strictObject({ options, index: z.int().min(0).max(2) });
export const adminContentRequestSchema = z.strictObject({ requestKey: z.uuid(), quizSetId: id, expectedVersion: z.int().positive(),
  selection: z.strictObject({ child: placement, adult: placement }), supersedesJobId: id.optional(), recoveredAnalysisId: id.optional(), recoveredCritiqueId: id.optional() })
  .refine(r => (!r.recoveredAnalysisId || !r.supersedesJobId) && (!r.recoveredCritiqueId || !!r.recoveredAnalysisId));
export const adminRegenerationRequestSchema = z.strictObject({ requestKey: z.uuid(), quizSetId: id,
  expectedVersion: z.int().positive(), scope: z.enum(["intent", "summary", "child", "adult"]), supersedesJobId: id.optional(), retryCritiqueOnly: z.literal(true).optional(), target: candidateReplacementSchema.optional() })
  .refine(r => !r.target || (r.scope === "child" || r.scope === "adult") && !r.retryCritiqueOnly);
export const adminContentSectionSchema = z.enum(["state", "content", "costs", "activity", "placement"]);
export type AdminContentSection = z.infer<typeof adminContentSectionSchema>;
export const adminContentHistoryQuerySchema = z.strictObject({ before: z.coerce.number().int().positive().optional(), section: adminContentSectionSchema.optional(),
  parts: z.literal("true").optional(), snapshotId: id.optional(), difficulty: z.enum(["child", "adult"]).optional() })
  .refine(q => (!q.snapshotId || q.parts === "true" && q.section === "content") && (!q.difficulty || q.parts === "true" && q.section === "placement"));
export const adminContentCommandSchema = z.strictObject({ requestKey: z.uuid(), expectedVersion: z.int().positive(), operation: z.discriminatedUnion("family", [
  z.strictObject({ family: z.literal("intent"), operation: intentOperationSchema }), z.strictObject({ family: z.literal("summary"), operation: summaryOperationSchema }),
  z.strictObject({ family: z.literal("candidate"), operation: candidateOperationSchema }) ]) });
const slot = z.object({ id, review: z.object({ id }).nullable() }).nullable();
const content = z.discriminatedUnion("state", [z.object({ state: z.literal("absent") }), z.object({ state: z.literal("present"),
  intent: z.object({ selectedId: id, rootAnalysisId: id, confirmation: z.object({ id }).nullable() }).nullable(), summary: slot, child: slot, adult: slot })]);
const snapshots = z.array(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("intent"), value: z.object({ id, kind: z.enum(["analysis", "critique", "edit"]), analysis: intentAnalysisSchema,
    binding: intentTranscriptBindingSchema, critiqueId: id.nullable() }), critique: intentCritiqueSchema.nullable() }),
  z.object({ kind: z.literal("summary"), value: z.object({ id, kind: z.enum(["generate", "edit", "restore"]).default("generate"), draft: sermonSummaryDraftSchema, binding: summaryBindingSchema }) }),
  z.object({ kind: z.literal("candidate"), value: z.object({ id, kind: z.enum(["generate", "edit", "restore", "set_status"]).default("generate"), difficulty: z.enum(["child", "adult"]), draft: sermonCandidateDraftSchema,
    binding: summaryBindingSchema, replacement: candidateReplacementSchema.optional(), statuses: z.record(id, candidateStatusSchema) }) }) ]));
export const adminContentViewSchema = z.strictObject({ enabled: z.boolean(), quizSetId: id.nullable(), jobId: id.nullable(),
  viewRevision: z.string().max(4096).optional(),
  recoveredAnalysisId: id.nullable().optional(), recoveredCritiqueId: id.nullable().optional(),
  version: z.int().nonnegative(), status: z.string(), stage: z.string(), content, snapshots,
  snapshotIds: z.array(id).max(32).optional(),
  layoutPart: z.strictObject({ difficulty: z.enum(["child", "adult"]), layout: adminPlacementLayoutSchema.nullable(),
    preview: z.strictObject({ metadata: z.object({ title: z.string(), date: z.string(), bibleReferenceLabel: z.string(), translation: z.string(), bibleReadingUrl: z.string() }),
      summary: z.object({ text: z.string(), disclosure: z.string() }) }).nullable() }).optional(),
  quality: z.record(id, contentQualityReviewSchema).default({}),
  weekCostMicroUsd: z.int().nonnegative(), weekUnknownCalls: z.int().nonnegative(), jobCostMicroUsd: z.int().nonnegative(), jobUnknownCalls: z.int().nonnegative(),
  publication: z.strictObject({ slug: quizSlugSchema, publishedAt: z.iso.datetime(), closesAt: z.iso.datetime() }).optional(),
  quizCostMicroUsd: z.int().nonnegative().optional(), quizUnknownCalls: z.int().nonnegative().optional(),
  historyCursor: z.int().positive().nullable().default(null),
  regenerations: z.array(z.strictObject({ jobId: id, scope: z.enum(["intent", "summary", "child", "adult"]), status: z.string(),
    target: candidateReplacementSchema.optional(), resultId: id.nullable(), analysisId: id.nullable(), createdAt: z.string(), costMicroUsd: z.int().nonnegative(), unknownCalls: z.int().nonnegative() })).default([]),
  reviewLayouts: z.strictObject({ child: adminPlacementLayoutSchema, adult: adminPlacementLayoutSchema }).nullable().default(null),
  placement: adminPlacementStateSchema.nullable().default(null),
  preview: z.object({ metadata: z.object({ title: z.string(), date: z.string(), bibleReferenceLabel: z.string(), translation: z.string(), bibleReadingUrl: z.string() }),
    summary: z.object({ text: z.string(), disclosure: z.string() }), variants: z.object({ child: publicPuzzleGridSchema, adult: publicPuzzleGridSchema }) }).nullable() });
export type AdminContentView = z.infer<typeof adminContentViewSchema>;
export type AdminContentCommand = z.infer<typeof adminContentCommandSchema>;
