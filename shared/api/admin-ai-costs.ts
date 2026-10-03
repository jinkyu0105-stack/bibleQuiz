import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const amount = z.int().nonnegative();
const optionalCount = amount.nullable();

export const adminAiCostCallSchema = z.strictObject({
  callId: z.string().min(1).max(128),
  jobId: z.string().min(1).max(128),
  purpose: z.enum(["correction", "intent_analysis", "intent_critique", "summary", "child_candidates", "adult_candidates", "final_audit"]),
  scope: z.enum(["full", "transcript_correction", "intent", "summary", "child", "adult", "single_entry", "final_audit"]),
  singleEntry: z.boolean(),
  provider: z.string().min(1),
  model: z.string().min(1),
  startedAt: z.iso.datetime(),
  observedAt: z.iso.datetime().nullable(),
  state: z.enum(["effect_started", "completed", "uncertain"]),
  inputVersion: amount.nullable(),
  metadataRevision: amount,
  attemptNumber: amount,
  inputTokens: optionalCount,
  cachedInputTokens: optionalCount,
  reasoningTokens: optionalCount,
  outputTokens: optionalCount,
  audioInputTokens: optionalCount,
  audioSeconds: optionalCount,
  pricingVersion: z.string().min(1).nullable(),
  estimatedCostMicroUsd: amount.nullable(),
  usageSource: z.enum(["provider_reported", "provider_partial"]).nullable(),
});

export const adminAiCostsSchema = z.strictObject({
  quizSetId: id,
  knownCostMicroUsd: amount,
  unknownCalls: amount,
  totalCalls: amount,
  models: z.array(z.strictObject({
    provider: z.string().min(1),
    model: z.string().min(1),
    knownCostMicroUsd: amount,
    unknownCalls: amount,
    totalCalls: amount,
  })),
  calls: z.array(adminAiCostCallSchema),
});

export type AdminAiCosts = z.infer<typeof adminAiCostsSchema>;
