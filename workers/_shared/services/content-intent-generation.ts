import { readTogether, generationReadSession, clearGenerationReads } from "../repositories/generation-read-session";
import { contentValidationDiagnostic } from "./content-generation-diagnostic";
import { assertContentQualityUsable, readLatestContentQuality } from "./content-quality-review";
import { z } from "zod";
import { finalCheckSelectionSchema } from "./final-check-contract";
import { createGenerationLifecycleStore } from "../repositories/generation-lifecycle-store";
import { readCurrentArchivedIntentRecovery, readCurrentArchivedCritiqueRecovery } from "../repositories/archived-intent-recovery-store";
import { createAiResponseArchive } from "../repositories/ai-response-archive";
import { readIntentDomain, prepareReadIntentResult } from "./generation-domain-reader";
import { domainTranscriptBinding } from "./generation-domain";
import { generationAggregateVersion } from "./generation-bridge";
import { aiDraftRequestSchema } from "./ai-draft-provider-contract";
import { createAiDraftProvider } from "./ai-draft-provider";
import { createOpenAiDraftTransport, OPENAI_DRAFT_MODEL } from "./openai-draft-transport";
import { estimateOpenAiDraftCost } from "./openai-draft-cost";
import { sameLifecycleValue } from "./generation-context-codec";
import { lifecycleId, stepExecutionSchema, type StepContext, type UsageObservation, type GenerationContext } from "./generation-lifecycle-contract";
import type { ContentGenerationBindings, ContentWorkflowParams, GenerationRunOptions } from "./content-generation";
export const fullGenerationRequestSchema = z.strictObject({ requestKey: z.uuid(), quizSetId: lifecycleId, expectedVersion: z.int().positive(),
  selection: finalCheckSelectionSchema, supersedesJobId: lifecycleId.optional(), recoveredAnalysisId: lifecycleId.optional(), recoveredCritiqueId: lifecycleId.optional(),
  reuseCurrentContent: z.literal(true).optional() })
  .refine(r => (!r.recoveredAnalysisId || !r.supersedesJobId) && (!r.recoveredCritiqueId || !!r.recoveredAnalysisId) &&
    (!r.reuseCurrentContent || !r.supersedesJobId && !r.recoveredAnalysisId && !r.recoveredCritiqueId));
const requestSchema = z.strictObject({ requestKey: z.uuid(), quizSetId: lifecycleId, expectedVersion: z.int().positive() });
const clock = () => new Date().toISOString();
const lease = (now: string) => new Date(Date.parse(now) + 600_000).toISOString();

/** Private initial-intent compatibility entry; the admin entry uses full v3. */
export async function requestIntent(db: D1Database, sermonId: string, raw: unknown, actorDigest: string) {
  const command = requestSchema.parse(raw), owner = { jobId: command.requestKey, sermonId, quizSetId: command.quizSetId };
  const store = createGenerationLifecycleStore(db), prior = await store.readJob(owner.jobId);
  const dispatchId = `dispatch-${owner.jobId}`;
  if (prior.outcome === "present") {
    const saved = await store.readContext(prior.value.request_context_id);
    if (prior.value.execution_contract_version !== 2 || prior.value.request_scope !== "intent" ||
      prior.value.sermon_id !== sermonId || prior.value.quiz_set_id !== command.quizSetId || saved.outcome !== "present" ||
      saved.value.context.kind !== "request" || saved.value.context.actorDigest !== actorDigest ||
      generationAggregateVersion(saved.value.context.authority) !== command.expectedVersion) throw new Error("GENERATION_REQUEST_CONFLICT");
    return { jobId: owner.jobId, dispatchId, outcome: "replayed" as const };
  }
  if (prior.outcome !== "absent") throw new Error("GENERATION_JOB_UNAVAILABLE");
  const captured = await readIntentDomain(db, owner), authority = captured.basis.authority;
  if (generationAggregateVersion(authority) !== command.expectedVersion) throw new Error("GENERATION_AUTHORITY_CHANGED");
  // Regeneration must first gain the SQL bridge for selecting a comparison
  // snapshot; an existing selected result is never replaced implicitly.
  if (authority.content.state !== "absent") throw new Error("GENERATION_DOMAIN_NOT_READY");
  const request = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "request",
    references: captured.references, authority, actorDigest, guidance: null };
  const created = await store.createRequest(request, { ...owner, requestKey: command.requestKey, createdAt: clock(),
    contextId: `request-${owner.jobId}`, kind: "request", stepKey: null, waitGeneration: null,
    codec: "generation-context-json-utf8-v1" }, owner.jobId, dispatchId);
  if (!["created", "replayed"].includes(created.outcome)) throw new Error("GENERATION_REQUEST_UNAVAILABLE");
  return { jobId: owner.jobId, dispatchId, outcome: created.outcome };
}

export async function requestFullGeneration(db: D1Database, sermonId: string, raw: unknown, actorDigest: string) {
  db = generationReadSession(db);
  const command = fullGenerationRequestSchema.parse(raw), owner = { jobId: command.requestKey, sermonId, quizSetId: command.quizSetId };
  const store = createGenerationLifecycleStore(db), prior = await store.readJob(owner.jobId), dispatchId = `dispatch-${owner.jobId}`;
  if (prior.outcome === "present") {
    const saved = await store.readContext(prior.value.request_context_id);
    const reuse = await db.prepare("SELECT analysis_event_id FROM generation_intent_analysis_reuse WHERE job_id=?")
      .bind(owner.jobId).first<{ analysis_event_id: string }>();
    if (prior.value.execution_contract_version !== 3 || prior.value.request_scope !== "full" || prior.value.sermon_id !== sermonId ||
      prior.value.quiz_set_id !== command.quizSetId || saved.outcome !== "present" || saved.value.context.kind !== "request" ||
      saved.value.context.actorDigest !== actorDigest || generationAggregateVersion(saved.value.context.authority) !== command.expectedVersion ||
      saved.value.context.reuseCurrentContent !== command.reuseCurrentContent ||
      saved.value.context.authority.selection.state !== "present" || !sameLifecycleValue(saved.value.context.authority.selection.value, command.selection) ||
      (reuse?.analysis_event_id ?? null) !== (command.recoveredAnalysisId ?? null) ||
      (reuse && saved.value.context.authority.content.state === "present" ? saved.value.context.authority.content.availableCritique?.id ?? null : null) !== (command.recoveredCritiqueId ?? null)) throw new Error("GENERATION_REQUEST_CONFLICT");
    return { jobId: owner.jobId, dispatchId, outcome: "replayed" as const };
  }
  if (prior.outcome !== "absent") throw new Error("GENERATION_JOB_UNAVAILABLE");
  // Settings belong to this immutable request; revision 1 is never reused as a mutable global setting.
  const captured = await readIntentDomain(db, owner, { scope: "full", selection: { state: "present", settingsRevision: 1, selectionRevision: 1, value: command.selection } });
  if (generationAggregateVersion(captured.basis.authority) !== command.expectedVersion) throw new Error("GENERATION_AUTHORITY_CHANGED");
  if (command.reuseCurrentContent) {
    const { input, content } = captured.basis.authority;
    if (input.state !== "present" || !input.confirmationId || content.state !== "present" ||
      !content.intent?.confirmation || !content.summary || !content.child || !content.adult) throw new Error("GENERATION_DOMAIN_NOT_READY");
  }
  let analysisReuse: { sourceJobId: string; analysisEventId: string } | undefined;
  if (command.recoveredAnalysisId) {
    // readIntentDomain has verified the sealed recovery payload and original rejected/settled call.
    const recovery = await readCurrentArchivedIntentRecovery(db, captured.basis);
    if (!recovery || recovery.event_id !== command.recoveredAnalysisId) throw new Error("GENERATION_RECOVERY_CONFLICT");
    const critique = await readCurrentArchivedCritiqueRecovery(db, captured.basis);
    if ((critique?.event_id ?? null) !== (command.recoveredCritiqueId ?? null)) throw new Error("GENERATION_RECOVERY_CONFLICT");
    analysisReuse = { sourceJobId: recovery.source_job_id, analysisEventId: recovery.event_id };
  }
  if (command.supersedesJobId) {
    const previous = await store.readJob(command.supersedesJobId);
    const receipt = await db.prepare("SELECT step_key,state,lease_expires_at FROM generation_step_receipts WHERE generation_job_id=? AND state IN ('claimed','effect_started','uncertain') ORDER BY started_at DESC,step_key DESC LIMIT 1")
      .bind(command.supersedesJobId).first<{ step_key: string; state: string; lease_expires_at: string | null }>();
    const outcome = receipt ? await store.readOutcome(command.supersedesJobId, receipt.step_key, 1) : null;
    const uncertain = outcome?.outcome === "present" && outcome.value.outcome === "uncertain";
    const expired = outcome?.outcome === "absent" && receipt?.lease_expires_at != null && receipt.lease_expires_at <= clock();
    const intent = captured.basis.authority.content.state === "present" ? captured.basis.authority.content.intent : null;
    const quality = intent ? await readLatestContentQuality(db, sermonId, [intent.selectedId]) : {};
    const reviewedRestart = previous.outcome === "present" && previous.value.status === "awaiting_intent_review" &&
      previous.value.current_step === "intent_review" && !!intent && quality[intent.selectedId]?.status === "regenerate" && !receipt;
    if (previous.outcome !== "present" || previous.value.sermon_id !== sermonId || previous.value.quiz_set_id !== command.quizSetId ||
      previous.value.execution_contract_version !== 3 || previous.value.request_scope !== "full" || !(uncertain || expired || reviewedRestart)) throw new Error("GENERATION_RETRY_CONFLICT");
    if (previous.value.status !== "stale") {
      const superseded = await store.markStale(previous.value.id, previous.value.state_version, previous.value.request_context_id, clock());
      if (!["saved", "replayed"].includes(superseded.outcome)) throw new Error("GENERATION_RETRY_UNAVAILABLE");
    }
  }
  const request = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "request", references: captured.references,
    authority: captured.basis.authority, actorDigest, guidance: null, ...(command.reuseCurrentContent ? { reuseCurrentContent: true } : {}) };
  const created = await store.createRequest(request, { ...owner, requestKey: command.requestKey, createdAt: clock(), contextId: `request-${owner.jobId}`,
    kind: "request", stepKey: null, waitGeneration: null, codec: "generation-context-json-utf8-v1" }, owner.jobId, dispatchId, undefined, analysisReuse);
  if (!["created", "replayed"].includes(created.outcome)) throw new Error("GENERATION_REQUEST_UNAVAILABLE");
  return { jobId: owner.jobId, dispatchId, outcome: created.outcome };
}

export async function requestContentResume(db: D1Database, owner: { jobId: string; sermonId: string; quizSetId: string }) {
  db = generationReadSession(db);
  const captured = await readIntentDomain(db, owner);
  const intent = captured.basis.authority.content.state === "present" ? captured.basis.authority.content.intent : null;
  if (captured.basis.authority.wait?.kind === "intent_review" && intent)
    await assertContentQualityUsable(db, owner.sermonId, [intent.selectedId]);
  return createGenerationLifecycleStore(db).ensureResume(owner.jobId, captured.basis.authority,
    `resume-${owner.jobId}-${captured.basis.authority.wait?.generation}`, clock());
}

export async function runIntentGeneration(bindings: ContentGenerationBindings, params: ContentWorkflowParams, instanceId: string,
  options: GenerationRunOptions = {}) {
  bindings = { ...bindings, DB: generationReadSession(bindings.DB) };
  if (bindings.AI_GENERATION_ENABLED !== "true" || !bindings.OPENAI_API_KEY) return { outcome: "disabled" as const };
  const apiKey = bindings.OPENAI_API_KEY;
  const store = createGenerationLifecycleStore(bindings.DB), time = options.now ?? clock;
  const unit = async (name: string, run: () => Promise<{ outcome: string }>) => options.unit
    ? options.unit(name, async () => { clearGenerationReads(bindings.DB); return run(); }) : run();
  const dispatch = await store.readDispatch(params.dispatchId);
  if (dispatch.outcome !== "present") return { outcome: "unavailable" as const };
  const job = dispatch.value.job, owner = { jobId: job.id, sermonId: job.sermon_id, quizSetId: job.quiz_set_id };
  if (job.workflow_instance_id !== instanceId) return { outcome: "conflict" as const };
  const full = job.request_scope === "full", intentOnly = job.request_scope === "intent";
  const partialTask = job.request_scope === "summary" ? "summary" : job.request_scope === "child" ? "child_candidates" : job.request_scope === "adult" ? "adult_candidates" : null;
  if (job.execution_contract_version !== (full ? 3 : 2) || !["intent", "full", "summary", "child", "adult"].includes(job.request_scope)) return { outcome: "not_ready" as const };
  if (["failed", "stale", "needs_revision", "review_ready"].includes(job.status)) return { outcome: job.status };
  const request = await store.readContext(job.request_context_id);
  if (request.outcome !== "present" || request.value.context.kind !== "request") return { outcome: "unavailable" as const };
  const reuse = intentOnly || full ? await bindings.DB.prepare("SELECT source_job_id,analysis_event_id FROM generation_intent_analysis_reuse WHERE job_id=?")
    .bind(job.id).first<{ source_job_id: string; analysis_event_id: string }>() : null;
  const requestContext = request.value.context;
  if (requestContext.reuseCurrentContent) return { outcome: "not_ready" as const };
  const reusedCritiqueId = full && reuse && requestContext.authority.content.state === "present"
    ? requestContext.authority.content.availableCritique?.id ?? null : null;
  const requestRef = { contextId: job.request_context_id, fingerprint: job.request_fingerprint };
  async function capture() {
    const generated = await bindings.DB.prepare("SELECT event_id FROM sermon_content_events WHERE generation_job_id=? AND state='sealed' ORDER BY content_sequence LIMIT 6").bind(owner.jobId).all<{ event_id: string }>();
    const read = await readIntentDomain(bindings.DB, owner, { targets: [...generated.results.map(row => row.event_id), ...(reuse ? [reuse.analysis_event_id] : []), ...(reusedCritiqueId ? [reusedCritiqueId] : [])] });
    if (!sameLifecycleValue(read.basis.authority.input, requestContext.authority.input) ||
      !sameLifecycleValue(read.basis.authority.metadata, requestContext.authority.metadata)) throw new Error("GENERATION_AUTHORITY_CHANGED");
    return read;
  }
  try {
    const receiptUnit = await unit("receive", async () => {
    const captured = await capture();
    if (job.status === "awaiting_intent_review" && dispatch.value.identity.wire.dispatchKind === "start") return { outcome: "awaiting_intent_review" as const };
    const receiver = await store.readReceiver(params.dispatchId);
    if (receiver.outcome === "absent") {
      if (dispatch.value.identity.wire.dispatchKind === "start" && !sameLifecycleValue(captured.basis.authority.content, requestContext.authority.content)) throw new Error("GENERATION_AUTHORITY_CHANGED");
      const received = await store.receive(params.dispatchId, dispatch.value.identity.wire, instanceId, captured.basis.authority, time());
      if (received.outcome !== "received" && received.outcome !== "replayed") return { outcome: received.outcome };
    } else if (receiver.outcome !== "present") return { outcome: "unavailable" as const };
      return { outcome: "continue" };
    });
    if (receiptUnit.outcome !== "continue") return receiptUnit;
    async function waitFor(kind: "transcript_review" | "intent_review") {
      const current = await capture(), a = current.basis.authority, latest = await store.readJob(job.id);
      if (latest.outcome !== "present" || a.input.state !== "present") throw new Error("GENERATION_JOB_UNAVAILABLE");
      const generation = latest.value.wait_generation + 1;
      const waiting: Extract<GenerationContext, { kind: "wait" }> = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1,
        kind: "wait", references: current.references, request: requestRef, enter: { eventNo: latest.value.event_count + 1,
          stateVersion: latest.value.state_version + 1 }, parent: null, wait: { contractVersion: 1, ...owner, kind, generation,
          jobStateVersion: latest.value.state_version + 1, input: a.input, content: a.content, metadataRevision: a.metadata.metadataRevision,
          selection: a.selection, rootAnalysisId: kind === "intent_review" ? (reuse?.analysis_event_id ?? `result-${job.id}-intent_analysis`) : null } };
      const saved = await store.enterWait(waiting, { ...owner, requestKey: job.request_key, createdAt: time(),
        contextId: `wait-${job.id}-${kind}`, kind: "wait", stepKey: null, waitGeneration: generation, codec: "generation-context-json-utf8-v1" });
      if (!["saved", "replayed"].includes(saved.outcome)) throw new Error("GENERATION_WAIT_UNAVAILABLE");
    }
    { const result = await unit("input-stage", async () => {
    const latest = await store.readJob(job.id);
    if (latest.outcome !== "present") { return { outcome: "unavailable" as const }; }
    if (full && latest.value.current_step === "input_resolve") {
      const advanced = await store.advance(job.id, job.request_context_id, "transcript_review", time());
      if (!["saved", "replayed"].includes(advanced.outcome)) return advanced;
    }
      return { outcome: "continue" };
    }); if (result.outcome !== "continue") return result; }
    { const result = await unit("transcript-wait", async () => {
    const latest = await store.readJob(job.id);
    if (full && latest.outcome === "present" && latest.value.current_step === "transcript_review") await waitFor("transcript_review");
      return { outcome: "continue" };
    }); if (result.outcome !== "continue") return result; }
    { const result = await unit("input-resume", async () => {
      const latest = await store.readJob(job.id);
      if (full && latest.outcome === "present" && latest.value.status === "awaiting_transcript_review") {
        const resumed = await requestContentResume(bindings.DB, owner);
        if (!("dispatchId" in resumed)) return resumed;
      }
      return { outcome: "continue" };
    }); if (result.outcome !== "continue") return result; }
    { const result = await unit("input-confirm", async () => {
    const latest = await store.readJob(job.id);
    if (full && latest.outcome === "present" && latest.value.status === "awaiting_transcript_review") {
      // This entry requires a prior human input confirmation. Consume that exact proof, without another provider call.
      const dispatchId = `resume-${job.id}-${latest.value.active_wait_generation}`;
      const token = crypto.randomUUID(), now = time();
      const claimed = await store.claimDispatch(dispatchId, token, now, lease(now));
      if (claimed.outcome === "claimed") await store.reserveSend(dispatchId, claimed.attempt, token, now);
      const d = await store.readDispatch(dispatchId);
      if (d.outcome !== "present") return { outcome: "unavailable" as const };
      const received = await store.receive(dispatchId, d.value.identity.wire, instanceId, (await capture()).basis.authority, time());
      if (!["received", "replayed"].includes(received.outcome)) return received;
    }
      return { outcome: "continue" };
    }); if (result.outcome !== "continue") return result; }
    const resumedIntent = dispatch.value.identity.wire.dispatchKind === "resume_intent_review";
    if (reusedCritiqueId && !resumedIntent) {
      const current = await store.readJob(job.id);
      if (current.outcome !== "present") return { outcome: "unavailable" as const };
      if (current.value.current_step === "intent_analysis") {
        const advanced = await store.advance(job.id, job.request_context_id, "intent_critique", time());
        if (!["saved", "replayed"].includes(advanced.outcome)) return advanced;
      }
    }
    const tasks = partialTask ? [partialTask] as const : resumedIntent ? intentOnly ? [] as const :
      ["summary", "child_candidates", "adult_candidates"] as const : reusedCritiqueId ? [] as const : reuse ? ["intent_critique"] as const : ["intent_analysis", "intent_critique"] as const;
    for (const task of tasks) {
      const stageResult = await unit(`stage-${task}`, async () => {
      const prior = await store.readOutcome(job.id, task, 1);
      if (prior.outcome === "present") {
        if (prior.value.outcome !== "success") return { outcome: prior.value.outcome };
        return { outcome: "continue" };
      }
      if (prior.outcome !== "absent") { return { outcome: "unavailable" as const }; }
      const previousTask = task === "intent_critique" ? "intent_analysis" : task === "child_candidates" ? "summary" : "child_candidates";
      const previousContext = task === "intent_analysis" || reuse && task === "intent_critique" ? job.request_context_id : `step-${job.id}-${previousTask}`;
      const stage = await store.readJob(job.id);
      if (stage.outcome !== "present") return { outcome: "unavailable" as const };
      if (stage.value.current_step !== task) {
        const advanced = await store.advance(job.id, previousContext, task, time());
        if (advanced.outcome !== "saved" && advanced.outcome !== "replayed") return { outcome: advanced.outcome };
      }
        return { outcome: "continue" };
      });
      if (stageResult.outcome !== "continue") return stageResult;
      const taskResult = await unit(`task-${task}`, async () => {
      const [prior, captured] = await readTogether([store.readOutcome(job.id, task, 1), capture()]);
      if (prior.outcome === "present") return { outcome: prior.value.outcome === "success" ? "continue" : prior.value.outcome };
      if (prior.outcome !== "absent") return { outcome: "unavailable" };
      const authority = captured.basis.authority, input = authority.input;
      if (input.state !== "present" || !input.confirmationId) return { outcome: "not_ready" as const };
      const binding = domainTranscriptBinding(input, generationAggregateVersion(authority)!);
      const root = captured.basis.snapshots.find(s => s.kind === "intent" && s.value.id === (reuse?.analysis_event_id ?? `result-${job.id}-intent_analysis`));
      const c = authority.content, selected = c.state === "present" ? captured.basis.snapshots.find(s => s.value.id === c.intent?.selectedId) : null;
      const target = requestContext.candidateTarget;
      const pool = target ? captured.basis.snapshots.find(s => s.value.id === target.basePoolId) : null;
      if (target && ((task !== "child_candidates" && task !== "adult_candidates") || pool?.kind !== "candidate" ||
        c.state !== "present" || c[task === "child_candidates" ? "child" : "adult"]?.id !== target.basePoolId))
        throw new Error("GENERATION_AUTHORITY_CHANGED");
      const replacement = target && pool?.kind === "candidate" ? {
        candidate: pool.value.draft.candidates.find(v => v.id === target.candidateId),
        otherCandidates: pool.value.draft.candidates.filter(v => v.id !== target.candidateId),
      } : undefined;
      const execution = aiDraftRequestSchema.parse(task === "intent_analysis"
        ? { task, context: { sermonId: job.sermon_id, binding }, input: { transcript: captured.transcript } }
        : task === "intent_critique" ? { task, context: { sermonId: job.sermon_id, binding, baseAnalysisId: root?.value.id },
          input: { transcript: captured.transcript, analysis: root?.kind === "intent" ? root.value.analysis : undefined } }
        : { task, context: { sermonId: job.sermon_id, ...(target ? { target } : {}), binding: { transcript: binding, analysisId: selected?.value.id,
          intentConfirmationId: c.state === "present" ? c.intent?.confirmation?.id : null } }, input: { transcript: captured.transcript,
          intent: selected?.kind === "intent" ? selected.value.analysis : undefined, ...(replacement ? { replacement } : {}) } });
      if (execution.task === "correction" || execution.task === "final_audit") throw new Error("GENERATION_TASK_INVALID");
      const contextId = `step-${job.id}-${task}`, context: StepContext = {
        contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "step", references: captured.references, authority,
        request: requestRef, stepKey: task, execution: stepExecutionSchema.parse({ task: execution.task, context: execution.context }),
        predecessor: { kind: partialTask ? "request" : full && (task === "intent_analysis" || task === "summary") ? "wait_consume" : "outcome", eventNo: authority.jobStateVersion + 1,
          stateVersion: authority.jobStateVersion }, command: null, guidance: null };
      const startedAt = time(), token = crypto.randomUUID();
      const claimed = await store.claimStep(context, { ...owner, requestKey: job.request_key, createdAt: request.value.encoded.envelope.createdAt,
        contextId, kind: "step", stepKey: task, waitGeneration: null, codec: "generation-context-json-utf8-v1" }, token, startedAt, lease(startedAt));
      if (claimed.outcome !== "claimed") return { outcome: claimed.outcome };
      const sealed = await store.readContext(contextId);
      if (sealed.outcome !== "present") { return { outcome: "unavailable" as const }; }
      const ref = { contextId, fingerprint: sealed.value.encoded.envelope.fingerprint };
      const callId = `call-${job.id}-${task}`;
      const started = await store.startProviderCall(job.id, task, claimed.attempt, token, {
        id: callId, provider: "openai", model: OPENAI_DRAFT_MODEL, reasoningEffort: "high", providerRequestIdOpaque: null }, startedAt);
      if (started.outcome !== "started") return { outcome: "uncertain" as const };
      let usage: UsageObservation | null = null;
      let providerReturned = false;
      const provider = createAiDraftProvider(createOpenAiDraftTransport({ apiKey, ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.archiveResponses ? { archive: createAiResponseArchive(bindings.DB, callId) } : {}),
        diagnose: diagnostic => console.warn(JSON.stringify({ code: "OPENAI_DRAFT_DIAGNOSTIC", callId, ...diagnostic })),
        observe: async observation => {
          clearGenerationReads(bindings.DB);
          const value: UsageObservation = { contractVersion: 2, ...owner, callId, usageId: `usage-${job.id}-${task}`,
            task, stepKey: task, attempt: claimed.attempt, context: ref, inputFingerprint: ref.fingerprint,
            provider: "openai", model: OPENAI_DRAFT_MODEL, reasoningEffort: "high", providerRequestIdOpaque: null,
            ...estimateOpenAiDraftCost(observation), audioInputTokens: null, audioSeconds: null, startedAt, observedAt: time() };
          const observed = await store.observeUsage(value);
          if (observed.outcome !== "saved" && observed.outcome !== "replayed") throw new Error("GENERATION_USAGE_UNCERTAIN");
          usage = value;
          // Before generate returns, this execution cannot have committed an
          // outcome. Only a timeout's late observer needs the settlement probe.
          if (providerReturned) {
            const previous = await store.readOutcome(job.id, task, claimed.attempt);
            if (previous.outcome === "present" && previous.value.outcome !== "success") await store.settleLateUsage(value, time());
          }
        } }), { timeoutMs: options.timeoutMs ?? 540_000 });
      clearGenerationReads(bindings.DB);
      const generated = await provider.generate(execution);
      providerReturned = true;
      clearGenerationReads(bindings.DB);
      const resultId = `result-${job.id}-${task}`;
      const prepared = generated.outcome === "structured_output" ? await prepareReadIntentResult(captured.basis, ref,
        { request: execution, result: generated.result }, { id: resultId, actorDigest: requestContext.actorDigest, createdAt: startedAt }) : null;
      // Preserve existing outcome/usage semantics; add only non-content diagnostics.
      try {
        const diagnostic = contentValidationDiagnostic(task, generated, prepared?.outcome ?? null, captured.transcript);
        if (diagnostic) console.warn(JSON.stringify({ code: "CONTENT_VALIDATION_DIAGNOSTIC", callId, ...diagnostic }));
      } catch { /* Diagnostics must not change accounting or acceptance. */ }
      let unchanged = true;
      try { await readIntentDomain(bindings.DB, owner, { existing: authority }); } catch { unchanged = false; }
      const outcome = !unchanged ? "stale" : !usage ? "uncertain" : prepared?.outcome === "prepared" ? "success" : "rejected";
      const committed = await store.commitOutcome({ jobId: job.id, stepKey: task, attempt: claimed.attempt, token,
        now: time(), outcome, callId, usage, result: outcome === "success" && prepared?.outcome === "prepared"
          ? { id: resultId, actorDigest: null, payload: prepared.value } : null });
      if (committed.outcome !== "saved" && committed.outcome !== "replayed") return { outcome: "uncertain" as const };
      if (outcome !== "success") return { outcome };
        return { outcome: "continue" };
      });
      if (taskResult.outcome !== "continue") return taskResult;
    }
    if (intentOnly && resumedIntent) {
      const current = await capture();
      return store.finish(current.basis.authority, time());
    }
    if (partialTask) {
      const current = await capture(), outcome = await store.readOutcome(job.id, partialTask, 1);
      // A human may choose/edit content after the result was saved but before job completion.
      // Preserve that result and end the outdated job so it cannot hold the active slot indefinitely.
      if (outcome.outcome !== "present" || outcome.value.outcome !== "success") return { outcome: "unavailable" as const };
      const { input, content } = current.basis.authority;
      if (outcome.value.afterInputVersion !== (input.state === "present" ? input.version : null) ||
        outcome.value.afterContentCount !== (content.state === "present" ? content.eventCount : 0))
        throw new Error("GENERATION_AUTHORITY_CHANGED");
      const finished = await store.finish(current.basis.authority, time());
      if (finished.outcome === "stale" || finished.outcome === "conflict")
        await readIntentDomain(bindings.DB, owner, { existing: current.basis.authority });
      return finished;
    }
    if (resumedIntent) return await unit("content-review", async () => {
      const advanced = await store.advance(job.id, `step-${job.id}-adult_candidates`, "content_review", time());
      return { outcome: ["saved", "replayed"].includes(advanced.outcome) ? "awaiting_content_review" as const : advanced.outcome };
    });
    return await unit("intent-wait", async () => {
      await waitFor("intent_review");
      return { outcome: "awaiting_intent_review" };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "GENERATION_AUTHORITY_CHANGED") {
      const latest = await store.readJob(job.id);
      if (latest.outcome === "present") {
        const stale = await store.markStale(job.id, latest.value.state_version, job.request_context_id, time());
        if (stale.outcome === "saved" || stale.outcome === "replayed") return { outcome: "stale" as const };
      }
    }
    return { outcome: "unavailable" as const };
  }
}
