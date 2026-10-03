import { domainPreparedSchema, type DomainPrepared } from "../services/generation-domain-contract";
import { canonicalDomainJson, type DomainResourceBudget } from "../services/generation-domain-codec";
import { isPreparedDomain } from "../services/generation-domain";
import { isReadIntentResult } from "../services/generation-domain-reader";
import { fingerprintLifecycleValue, sameLifecycleValue } from "../services/generation-context-codec";
import type { StepContext } from "../services/generation-lifecycle-contract";

/** Existing content storage envelope. These are implementation protection
 * values, not a new product quota or evidence of measured heap/CPU usage. */
export const DOMAIN_STORAGE_BUDGET: DomainResourceBudget = { maxPayloadBytes: 67_108_864,
  chunkBytes: 65_536, maxChunks: 1024, maxReferences: 32, maxTargets: 10,
  maxDepth: 32, maxNodes: 1_000_000, maxDecodedBytes: 134_217_728, maxBatchStatements: 4096 };

export function domainTask(prepared: DomainPrepared) {
  const op = prepared.operation;
  if (op.family === "intent") return op.operation.kind === "analysis" ? "intent_analysis" : op.operation.kind === "critique" ? "intent_critique" : null;
  if (op.family === "summary") return op.operation.kind === "generate" ? "summary" : null;
  if (op.family === "candidate") return op.operation.kind === "generate" ? `${op.operation.difficulty}_candidates` as const : null;
  return null;
}
export function persistedDomain(raw: unknown): DomainPrepared | null {
  const parsed = domainPreparedSchema.safeParse(raw);
  return parsed.success && parsed.data.origin === "ai" && parsed.data.materializedSnapshot !== null ? parsed.data : null;
}
export function domainStorageJson(raw: unknown) {
  return canonicalDomainJson(raw, DOMAIN_STORAGE_BUDGET);
}
export function domainLineage(p: DomainPrepared) {
  const after = p.after.state === "present" ? p.after : null, s = p.materializedSnapshot;
  const op = p.operation.operation;
  return { sermon_id: p.owner.sermonId, event_id: p.event.id, family: p.operation.family,
    root_analysis_event_id: s?.kind === "intent" ? s.provenance.rootAnalysisId : p.operation.family === "intent" ? after?.intent?.rootAnalysisId ?? null : null,
    critique_event_id: s?.kind === "intent" ? s.value.critiqueId : p.operation.family === "intent" ? after?.intent?.critique?.id ?? null : null,
    target_snapshot_event_id: "analysisId" in op ? op.analysisId : "summaryId" in op ? op.summaryId : "poolId" in op ? op.poolId : null };
}
/** A persisted-looking object is not a write permit. Only the validator's
 * invocation handle with this exact sealed step context can authorize storage. */
export async function assertPreparedDomain(raw: unknown, c: StepContext, contextId: string, resultId: string) {
  if (!isPreparedDomain(raw) || !isReadIntentResult(raw) || raw.origin !== "ai" || raw.event.id !== resultId || domainTask(raw) !== c.execution.task ||
    !raw.materializedSnapshot || raw.materializedSnapshot.value.id !== resultId ||
    !sameLifecycleValue(raw.owner, { jobId: c.authority.jobId, sermonId: c.authority.sermonId, quizSetId: c.authority.quizSetId }) ||
    !sameLifecycleValue(raw.expectedInput, c.authority.input) || !sameLifecycleValue(raw.before, c.authority.content) ||
    raw.context.contextId !== contextId || raw.context.fingerprint !== await fingerprintLifecycleValue(c)) throw new Error("DOMAIN_STORAGE_INVALID");
  const op = raw.operation.operation;
  if (!("binding" in op) || !("context" in c.execution) || !c.execution.context || !("binding" in c.execution.context) ||
    !sameLifecycleValue(op.binding, c.execution.context.binding) ||
    (c.execution.task === "intent_critique" && (!("baseAnalysisId" in op) ||
      op.baseAnalysisId !== c.execution.context.baseAnalysisId))) throw new Error("DOMAIN_STORAGE_INVALID");
  if (c.execution.task === "child_candidates" || c.execution.task === "adult_candidates") {
    if (!sameLifecycleValue("replacement" in op ? op.replacement ?? null : null, c.execution.context.target ?? null))
      throw new Error("DOMAIN_STORAGE_INVALID");
  }
  return raw;
}
