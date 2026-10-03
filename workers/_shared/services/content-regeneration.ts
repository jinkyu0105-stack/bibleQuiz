import { adminRegenerationRequestSchema } from "../../../shared/api/admin-content-generation";
import { createGenerationLifecycleStore } from "../repositories/generation-lifecycle-store";
import { generationAggregateVersion } from "./generation-bridge";
import { sameLifecycleValue } from "./generation-context-codec";
import { sameTranscript } from "./sermon-intent";
import { domainCurrentEligibility, domainTranscriptBinding } from "./generation-domain";
import { readIntentDomain } from "./generation-domain-reader";

/** A separate v2 job preserves the full job, its selections and all prior costs. */
export async function requestContentRegeneration(db: D1Database, sermonId: string, raw: unknown, actorDigest: string) {
  const command = adminRegenerationRequestSchema.parse(raw);
  const owner = { jobId: command.requestKey, sermonId, quizSetId: command.quizSetId };
  const store = createGenerationLifecycleStore(db), prior = await store.readJob(owner.jobId);
  const dispatchId = `dispatch-${owner.jobId}`;
  if (command.retryCritiqueOnly && (command.scope !== "intent" || !command.supersedesJobId)) throw new Error("GENERATION_RETRY_CONFLICT");
  if (prior.outcome === "present") {
    const reuse = await db.prepare("SELECT source_job_id FROM generation_intent_analysis_reuse WHERE job_id=?").bind(owner.jobId).first<{ source_job_id: string }>();
    if ((reuse?.source_job_id ?? null) !== (command.retryCritiqueOnly ? command.supersedesJobId : null)) throw new Error("GENERATION_REQUEST_CONFLICT");
    const saved = await store.readContext(prior.value.request_context_id);
    if (prior.value.execution_contract_version !== 2 || prior.value.request_scope !== command.scope ||
      prior.value.sermon_id !== sermonId || prior.value.quiz_set_id !== command.quizSetId || saved.outcome !== "present" ||
      saved.value.context.kind !== "request" || !sameLifecycleValue(saved.value.context.candidateTarget ?? null, command.target ?? null) || saved.value.context.actorDigest !== actorDigest ||
      generationAggregateVersion(saved.value.context.authority) !== command.expectedVersion) throw new Error("GENERATION_REQUEST_CONFLICT");
    return { jobId: owner.jobId, dispatchId, outcome: "replayed" as const };
  }
  if (prior.outcome !== "absent") throw new Error("GENERATION_JOB_UNAVAILABLE");
  const captured = await readIntentDomain(db, owner, { scope: command.scope });
  const a = captured.basis.authority;
  if (generationAggregateVersion(a) !== command.expectedVersion) throw new Error("GENERATION_AUTHORITY_CHANGED");
  if (!domainCurrentEligibility(captured.basis).intent) throw new Error("GENERATION_DOMAIN_NOT_READY");
  if (command.target) {
    const c = a.content, scope = command.scope;
    const base = captured.basis.snapshots.find(s => s.value.id === command.target!.basePoolId);
    if ((scope !== "child" && scope !== "adult") || c.state !== "present" || c[scope]?.id !== command.target.basePoolId ||
      base?.kind !== "candidate" || base.value.difficulty !== scope || !base.value.draft.candidates.some(v => v.id === command.target!.candidateId) ||
      a.input.state !== "present" || !sameTranscript(base.value.binding.transcript, domainTranscriptBinding(a.input, command.expectedVersion)) ||
      base.value.binding.analysisId !== c.intent?.selectedId || base.value.binding.intentConfirmationId !== c.intent?.confirmation?.id)
      throw new Error("GENERATION_TARGET_CHANGED");
  }
  let analysisReuse: { sourceJobId: string; analysisEventId: string } | undefined;
  if (command.supersedesJobId) {
    const previous = await store.readJob(command.supersedesJobId);
    const steps = command.scope === "intent" ? ["intent_analysis", "intent_critique"] :
      [command.scope === "summary" ? "summary" : `${command.scope}_candidates`];
    const receipts = await db.prepare(`SELECT step_key,state,lease_expires_at FROM generation_step_receipts
      WHERE generation_job_id=? ORDER BY started_at DESC,step_key DESC`).bind(command.supersedesJobId)
      .all<{ step_key: string; state: string; lease_expires_at: string | null }>();
    const receipt = command.retryCritiqueOnly ? receipts.results.find(row => row.step_key === "intent_critique") :
      receipts.results.find(row => steps.includes(row.step_key));
    const outcome = receipt ? await store.readOutcome(command.supersedesJobId, receipt.step_key, 1) : { outcome: "absent" as const };
    const now = new Date().toISOString();
    const expired = outcome.outcome === "absent" && receipt && ["claimed", "effect_started"].includes(receipt.state) &&
      receipt.lease_expires_at !== null && receipt.lease_expires_at <= now;
    const retryable = outcome.outcome === "present" && ["uncertain", "rejected"].includes(outcome.value.outcome) || expired;
    if (previous.outcome !== "present" || previous.value.execution_contract_version !== 2 || previous.value.sermon_id !== sermonId ||
      previous.value.quiz_set_id !== command.quizSetId || previous.value.request_scope !== command.scope ||
      !(command.retryCritiqueOnly ? retryable : outcome.outcome === "present" && outcome.value.outcome === "uncertain" || expired))
      throw new Error("GENERATION_RETRY_CONFLICT");
    if (command.retryCritiqueOnly) {
      const analysis = await store.readOutcome(command.supersedesJobId, "intent_analysis", 1);
      if (analysis.outcome !== "present" || analysis.value.outcome !== "success" || !analysis.value.result?.id)
        throw new Error("GENERATION_RETRY_CONFLICT");
      const source = await readIntentDomain(db, owner, { targets: [analysis.value.result.id] });
      const snapshot = source.basis.snapshots.find(row => row.kind === "intent" && row.value.id === analysis.value.result?.id);
      if (!snapshot || snapshot.kind !== "intent" || snapshot.value.kind !== "analysis" ||
        a.input.state !== "present" || snapshot.value.binding.version > command.expectedVersion ||
        !sameTranscript(snapshot.value.binding, domainTranscriptBinding(a.input, snapshot.value.binding.version)))
        throw new Error("GENERATION_RETRY_CONFLICT");
      analysisReuse = { sourceJobId: command.supersedesJobId, analysisEventId: analysis.value.result.id };
    }
    if (!["stale", "failed", "review_ready", "needs_revision"].includes(previous.value.status)) {
      const stale = await store.markStale(previous.value.id, previous.value.state_version, previous.value.request_context_id, now);
      if (!["saved", "replayed"].includes(stale.outcome)) throw new Error("GENERATION_RETRY_UNAVAILABLE");
    }
  }
  const created = await store.createRequest({ contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "request",
    references: captured.references, authority: a, actorDigest, guidance: null, ...(command.target ? { candidateTarget: command.target } : {}) },
  { ...owner, requestKey: command.requestKey, createdAt: new Date().toISOString(), contextId: `request-${owner.jobId}`,
    kind: "request", stepKey: null, waitGeneration: null, codec: "generation-context-json-utf8-v1" }, owner.jobId, dispatchId, undefined, analysisReuse);
  if (!["created", "replayed"].includes(created.outcome)) throw new Error("GENERATION_REQUEST_UNAVAILABLE");
  return { jobId: owner.jobId, dispatchId, outcome: created.outcome };
}

/** Explicitly leave a comparison while retaining the selected intent from request time. */
export async function discardIntentRegeneration(db: D1Database, owner: { jobId: string; sermonId: string; quizSetId: string }) {
  const store = createGenerationLifecycleStore(db), saved = await store.readJob(owner.jobId);
  if (saved.outcome !== "present" || saved.value.sermon_id !== owner.sermonId || saved.value.quiz_set_id !== owner.quizSetId ||
    saved.value.request_scope !== "intent" || saved.value.execution_contract_version !== 2) throw new Error("GENERATION_JOB_UNAVAILABLE");
  if (saved.value.status === "stale") return { outcome: "replayed" as const };
  if (saved.value.status !== "awaiting_intent_review") throw new Error("GENERATION_DISCARD_CONFLICT");
  const request = await store.readContext(saved.value.request_context_id);
  if (request.outcome !== "present" || request.value.context.kind !== "request") throw new Error("GENERATION_JOB_UNAVAILABLE");
  const current = await readIntentDomain(db, owner);
  const before = request.value.context.authority, after = current.basis.authority;
  if (before.content.state !== "present" || after.content.state !== "present" ||
    before.input.state !== "present" || after.input.state !== "present" ||
    before.content.intent?.selectedId !== after.content.intent?.selectedId ||
    before.content.intent?.confirmation?.id !== after.content.intent?.confirmation?.id ||
    !sameTranscript(domainTranscriptBinding(before.input, generationAggregateVersion(before)!),
      domainTranscriptBinding(after.input, generationAggregateVersion(after)!))) throw new Error("GENERATION_DISCARD_CONFLICT");
  const outcome = await store.markStale(owner.jobId, saved.value.state_version, saved.value.request_context_id, new Date().toISOString());
  if (!["saved", "replayed"].includes(outcome.outcome)) throw new Error("GENERATION_DISCARD_CONFLICT");
  return outcome;
}
