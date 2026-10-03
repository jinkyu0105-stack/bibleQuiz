import { adminAiCostsSchema } from "../../../shared/api/admin-ai-costs";
import { quizSetIdSchema } from "../../../shared/api/admin-finalization";
import { createGenerationLifecycleStore } from "../repositories/generation-lifecycle-store";

export class AdminAiCostsNotFound extends Error {}

interface CostRow {
  callId: string;
  jobId: string;
  purpose: string;
  scope: string;
  requestContextId: string | null;
  provider: string;
  model: string;
  startedAt: string;
  observedAt: string | null;
  state: string;
  inputVersion: number | null;
  metadataRevision: number;
  attemptNumber: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  outputTokens: number | null;
  audioInputTokens: number | null;
  audioSeconds: number | null;
  pricingVersion: string | null;
  estimatedCostMicroUsd: number | null;
  usageSource: string | null;
}

/** Observations are the current ledger; legacy usage events cover older calls only. */
export async function readAdminAiCosts(db: D1Database, rawQuizSetId: string) {
  const quizSetId = quizSetIdSchema.parse(rawQuizSetId);
  const quiz = await db.prepare("SELECT id FROM quiz_sets WHERE id=?").bind(quizSetId).first();
  if (!quiz) throw new AdminAiCostsNotFound();
  const result = await db.prepare(`SELECT c.id callId,c.generation_job_id jobId,c.task purpose,j.request_scope scope,j.request_context_id requestContextId,
      c.provider,c.model,c.started_at startedAt,CASE WHEN u.call_id IS NOT NULL THEN u.observed_at ELSE old.observed_at END observedAt,
      c.state,j.start_input_version inputVersion,j.start_metadata_revision metadataRevision,c.attempt_number attemptNumber,
      CASE WHEN u.call_id IS NOT NULL THEN u.input_tokens ELSE old.input_tokens END inputTokens,
      CASE WHEN u.call_id IS NOT NULL THEN u.cached_input_tokens ELSE old.cached_input_tokens END cachedInputTokens,
      CASE WHEN u.call_id IS NOT NULL THEN u.reasoning_tokens ELSE old.reasoning_tokens END reasoningTokens,
      CASE WHEN u.call_id IS NOT NULL THEN u.output_tokens ELSE old.output_tokens END outputTokens,
      CASE WHEN u.call_id IS NOT NULL THEN u.audio_input_tokens ELSE old.audio_input_tokens END audioInputTokens,
      CASE WHEN u.call_id IS NOT NULL THEN u.audio_seconds ELSE old.audio_seconds END audioSeconds,
      CASE WHEN u.call_id IS NOT NULL THEN u.pricing_version ELSE old.pricing_version END pricingVersion,
      CASE WHEN u.call_id IS NOT NULL THEN u.estimated_cost_micro_usd ELSE old.estimated_cost_micro_usd END estimatedCostMicroUsd,
      CASE WHEN u.call_id IS NOT NULL THEN u.usage_source ELSE old.usage_source END usageSource
    FROM ai_provider_calls c
    JOIN generation_jobs j ON j.id=c.generation_job_id AND j.quiz_set_id=c.quiz_set_id
    LEFT JOIN ai_usage_observations u ON u.call_id=c.id
    LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id
    WHERE c.quiz_set_id=? ORDER BY c.started_at DESC,c.id DESC`).bind(quizSetId).all<CostRow>();
  const singleEntryJobs = new Set<string>();
  const checkedJobs = new Set<string>();
  const lifecycle = createGenerationLifecycleStore(db);
  for (const row of result.results) {
    if ((row.scope !== "child" && row.scope !== "adult") || checkedJobs.has(row.jobId) || !row.requestContextId) continue;
    checkedJobs.add(row.jobId);
    const request = await lifecycle.readContext(row.requestContextId);
    if (request.outcome === "present" && request.value.context.kind === "request" && request.value.context.candidateTarget) {
      singleEntryJobs.add(row.jobId);
    }
  }
  const calls = result.results.map(row => adminAiCostsSchema.shape.calls.element.parse({
    callId: row.callId, jobId: row.jobId, purpose: row.purpose, scope: row.scope,
    singleEntry: singleEntryJobs.has(row.jobId), provider: row.provider, model: row.model,
    startedAt: row.startedAt, observedAt: row.observedAt, state: row.state,
    inputVersion: row.inputVersion, metadataRevision: row.metadataRevision, attemptNumber: row.attemptNumber,
    inputTokens: row.inputTokens, cachedInputTokens: row.cachedInputTokens,
    reasoningTokens: row.reasoningTokens, outputTokens: row.outputTokens,
    audioInputTokens: row.audioInputTokens, audioSeconds: row.audioSeconds,
    pricingVersion: row.pricingVersion, estimatedCostMicroUsd: row.estimatedCostMicroUsd,
    usageSource: row.usageSource,
  }));
  const groups = new Map<string, { provider: string; model: string; knownCostMicroUsd: number; unknownCalls: number; totalCalls: number }>();
  let knownCostMicroUsd = 0;
  let unknownCalls = 0;
  for (const call of calls) {
    const key = JSON.stringify([call.provider, call.model]);
    const group = groups.get(key) ?? { provider: call.provider, model: call.model, knownCostMicroUsd: 0, unknownCalls: 0, totalCalls: 0 };
    group.totalCalls++;
    if (call.estimatedCostMicroUsd === null) { group.unknownCalls++; unknownCalls++; }
    else { group.knownCostMicroUsd += call.estimatedCostMicroUsd; knownCostMicroUsd += call.estimatedCostMicroUsd; }
    groups.set(key, group);
  }
  return adminAiCostsSchema.parse({ quizSetId, knownCostMicroUsd, unknownCalls, totalCalls: calls.length,
    models: [...groups.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)), calls });
}
