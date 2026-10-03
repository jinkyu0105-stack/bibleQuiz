import { OPENAI_DRAFT_MODEL, openAiUsageSchema, type OpenAiObservation } from "./openai-draft-transport";

// Official model page checked 2026-09-22. Micro-USD per token equals USD per 1M.
export const OPENAI_DRAFT_PRICING_VERSION = "openai-terra-2026-09-22";
export function estimateOpenAiDraftCost(observation: OpenAiObservation) {
  if (observation.model !== OPENAI_DRAFT_MODEL && !observation.model.startsWith(`${OPENAI_DRAFT_MODEL}-`)) {
    throw new Error("AI_PRICING_MODEL_UNKNOWN");
  }
  const usage = openAiUsageSchema.parse(observation.usage);
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const longContext = usage.input_tokens > 272_000;
  const microUsd = Math.ceil((usage.input_tokens - cached) * (longContext ? 4 : 2) +
    cached * (longContext ? 0.4 : 0.2) + usage.output_tokens * (longContext ? 18 : 12));
  if (!Number.isSafeInteger(microUsd)) throw new Error("AI_PRICING_INVALID");
  return { pricingVersion: OPENAI_DRAFT_PRICING_VERSION, estimatedCostMicroUsd: microUsd,
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? null,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? null,
    usageSource: usage.input_tokens_details && usage.output_tokens_details ? "provider_reported" as const : "provider_partial" as const };
}
