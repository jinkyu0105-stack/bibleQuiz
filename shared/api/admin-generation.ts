import { z } from "zod";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
export const adminGenerationAvailabilitySchema = z.strictObject({ enabled: z.boolean(), quizSetId: id.nullable(), latestJobId: id.nullable() });
export const adminCorrectionGenerationRequestSchema = z.strictObject({ requestKey: z.string().uuid(),
  quizSetId: id, expectedInputVersion: z.int().positive(), supersedesJobId: z.string().uuid().optional() });
export const adminGenerationStartDataSchema = z.strictObject({ jobId: id,
  dispatch: z.enum(["sent", "replayed", "uncertain", "busy", "unavailable", "not_ready", "conflict", "stale", "corrupt"]),
});
export const adminGenerationStatusDataSchema = z.strictObject({ jobId: id, status: z.string(), stage: z.string(),
  proposalId: id.nullable(), usage: z.array(z.strictObject({ model: z.string(), inputTokens: z.int().nonnegative().nullable(),
    outputTokens: z.int().nonnegative().nullable(), reasoningTokens: z.int().nonnegative().nullable(),
    cachedInputTokens: z.int().nonnegative().nullable(), estimatedCostMicroUsd: z.int().nonnegative(), pricingVersion: z.string() })),
  costStatus: z.enum(["observed", "unknown", "not_started"]),
});
export type AdminGenerationStatus = z.infer<typeof adminGenerationStatusDataSchema>;
