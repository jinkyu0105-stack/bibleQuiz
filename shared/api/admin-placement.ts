import { z } from "zod";
import { placementOptionsSchema, finalCheckSelectionSchema } from "./placement-options";
import { publicPuzzleGridSchema } from "./public-quiz";
import { revealedSolutionSchema } from "./solution";
const basis = { expectedVersion: z.int().positive(), expectedMetadataRevision: z.int().positive(), expectedSelectionRevision: z.int().positive() };
export const adminPlacementTrialRequestSchema = z.strictObject({ ...basis, difficulty: z.enum(["child", "adult"]), options: placementOptionsSchema });
export const adminPlacementSelectRequestSchema = z.strictObject({ ...basis, requestKey: z.uuid(), selection: finalCheckSelectionSchema });
export const adminPlacementLayoutSchema = z.strictObject({ index: z.int().min(0).max(2), grid: publicPuzzleGridSchema, solution: revealedSolutionSchema,
  wordCount: z.int(), activeCellCount: z.int(), crossingCellCount: z.int(), multiCrossingWordCount: z.int(),
  omitted: z.array(z.string()), excluded: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
  words: z.array(z.strictObject({ id: z.string(), answer: z.string(), phrase: z.string(), crossings: z.int() })) });
export const adminPlacementTrialSchema = z.strictObject({ ...basis, difficulty: z.enum(["child", "adult"]), options: placementOptionsSchema,
  layouts: z.array(adminPlacementLayoutSchema).max(3), searchIncomplete: z.boolean(), reasons: z.array(z.string()) });
export const adminPlacementStateSchema = z.strictObject({ revision: z.int().positive(), metadataRevision: z.int().positive(),
  selection: finalCheckSelectionSchema, selected: z.boolean(), current: z.boolean() });
export type AdminPlacementTrial = z.infer<typeof adminPlacementTrialSchema>;
export type AdminPlacementLayout = z.infer<typeof adminPlacementLayoutSchema>;
