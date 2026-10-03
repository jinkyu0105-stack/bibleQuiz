import { z } from "zod";
export const placementOptionsSchema = z.strictObject({
  // Explicit permitted sizes/counts: a fixed 5x5 request never silently grows.
  gridSizes: z.array(z.int().min(5).max(10)).min(1).max(6).refine((v) => new Set(v).size === v.length),
  targetWordCounts: z.array(z.int().min(1).max(100)).min(1).max(100).refine((v) => new Set(v).size === v.length),
  seed: z.string().min(1).max(128),
  maxTrials: z.int().min(1).max(256).default(64),
  searchBudgetPerTrial: z.int().min(1).max(300_000).default(10_000),
}).refine((v) => v.maxTrials * v.searchBudgetPerTrial <= 3_000_000);

const selection = z.strictObject({ options: placementOptionsSchema, index: z.int().min(0).max(2) });
export const finalCheckSelectionSchema = z.strictObject({ child: selection, adult: selection });
