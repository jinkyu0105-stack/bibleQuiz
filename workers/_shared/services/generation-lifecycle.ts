import { z } from "zod";
import {
  GENERATION_STAGE_STORAGE, correctionCommandSchema, dispatchAttemptSchema, dispatchIdentitySchema, dispatchWireSchema,
  historicalOutcomeSchema, historicalReadSchema, lifecycleCount, lifecycleDigest, lifecycleId, lifecycleTime,
  receiptReadSchema, requestContextSchema, stepContextSchema, waitContextSchema, transitionEvidenceSchema, usageObservationSchema,
  type CorrectionCommand, type DispatchIdentity, type HistoricalOutcome, type LifecycleDecision, type ReceiverReceipt,
} from "./generation-lifecycle-contract";
import {
  authorityReadSchema, generationAuthoritySnapshotSchema, generationFinalCaptureSchema, generationStageSchema,
  generationWaitSchema, type GenerationAuthoritySnapshot,
} from "./generation-bridge-contract";
import { assessFinalCapture, assessGenerationStage, assessGenerationWait, classifyGenerationAuthority, nextGenerationStage } from "./generation-bridge";
import { fingerprintLifecycleValue, sameLifecycleValue as same } from "./generation-context-codec";

const decision = (outcome: LifecycleDecision["outcome"]): LifecycleDecision => ({ outcome });
const terminal = (s: GenerationAuthoritySnapshot) => ["review_ready", "needs_revision", "stale", "failed"].includes(s.status);
const ownerMatches = (d: DispatchIdentity, s: GenerationAuthoritySnapshot) =>
  d.wire.jobId === s.jobId && d.sermonId === s.sermonId && d.quizSetId === s.quizSetId && d.requestScope === s.scope;
function exactReceipt(d: DispatchIdentity, r: ReceiverReceipt): boolean {
  const e = r.evidence, first = nextGenerationStage(d.requestScope, [], d.requestContractVersion);
  return same(d, r.identity) && e.jobId === d.wire.jobId && e.reason === "received" &&
    same(e.context, d.context) && e.dispatchKey === d.wire.dispatchKey && e.commandKey === d.commandKey &&
    e.before?.stateVersion === d.wire.jobStateVersion &&
    e.before.status === (d.wire.dispatchKind === "start" ? "dispatch_pending" : d.wire.dispatchKind === "resume_intent_review" ? "awaiting_intent_review" : "awaiting_transcript_review") &&
    (d.wire.dispatchKind === "correction" ? e.after.stage === "correction" : d.wire.dispatchKind === "resume_transcript_review" ? e.after.stage === "intent_analysis" :
      d.wire.dispatchKind === "resume_intent_review" ? e.after.stage === (d.requestScope === "intent" ? "finish" : "summary") : first.outcome === "next" && e.after.stage === first.stage) && e.after.status === "running" && e.after.waitGeneration === null &&
    e.before.waitGeneration === d.wire.waitGeneration && e.after.stage !== null;
}
async function identityValid(d: DispatchIdentity) {
  return await fingerprintLifecycleValue(d.wire) === d.payloadFingerprint;
}
const recoverySchema = z.strictObject({
  identity: dispatchIdentitySchema, attempt: dispatchAttemptSchema,
  receipt: receiptReadSchema, now: lifecycleTime, jobActive: z.boolean(),
  external: z.enum(["exists", "missing", "unavailable"]),
});
/** No branch authorizes create/send. reclaim_candidate still requires a future
 * atomic expiry+new-attempt CAS. External 404 is never never-sent evidence. */
export async function assessDispatchRecovery(raw: unknown): Promise<LifecycleDecision | { outcome: "reclaim_candidate"; nextAttempt: number }> {
  const parsed = recoverySchema.safeParse(raw);
  if (!parsed.success) return decision("corrupt");
  const { identity: d, attempt: a, receipt: r, now, jobActive } = parsed.data;
  if (!await identityValid(d) || a.dispatchId !== d.dispatchId) return decision("conflict");
  if (r.outcome === "unavailable") return decision("unavailable");
  if (r.outcome === "partial") return decision("uncertain");
  if (r.outcome === "present") return decision(exactReceipt(d, r.receipt) ? "replayed" : "corrupt");
  if (!jobActive) return decision("stale");
  if (a.state !== "reserved") return decision("uncertain");
  if (Date.parse(now) < Date.parse(a.leaseExpiresAt)) return decision("busy");
  if (!Number.isSafeInteger(a.attempt + 1)) return decision("not_ready");
  return { outcome: "reclaim_candidate", nextAttempt: a.attempt + 1 };
}
const sendSchema = z.strictObject({
  current: dispatchAttemptSchema, expected: dispatchAttemptSchema, now: lifecycleTime,
  currentJob: generationAuthoritySnapshotSchema, identity: dispatchIdentitySchema,
});
/** Eligible means a send-marker CAS may be proposed, not that a send happened. */
export async function assessSendReservation(raw: unknown): Promise<LifecycleDecision> {
  const p = sendSchema.safeParse(raw);
  if (!p.success) return decision("corrupt");
  const { current: a, expected, now, currentJob: s, identity: d } = p.data;
  if (!await identityValid(d) || !same(a, expected) || a.dispatchId !== d.dispatchId) return decision("conflict");
  if (a.state !== "reserved") return decision("uncertain");
  if (Date.parse(now) >= Date.parse(a.leaseExpiresAt)) return decision("stale");
  if (!ownerMatches(d, s) || terminal(s) || s.jobStateVersion !== d.wire.jobStateVersion ||
    (s.wait?.generation ?? null) !== d.wire.waitGeneration) return decision("stale");
  if (d.wire.dispatchKind === "start" ? s.status !== "dispatch_pending" :
    d.wire.dispatchKind === "resume_intent_review" ? s.status !== "awaiting_intent_review" : s.status !== "awaiting_transcript_review") return decision("stale");
  return decision("eligible");
}
const receiveSchema = z.strictObject({
  identity: dispatchIdentitySchema, delivered: dispatchWireSchema, runtimeInstanceId: lifecycleId,
  attempt: dispatchAttemptSchema, receipt: receiptReadSchema, authority: authorityReadSchema,
  wait: generationWaitSchema.nullable(), command: correctionCommandSchema.nullable(), openEffect: z.boolean(),
});
export async function assessDispatchReceive(raw: unknown): Promise<LifecycleDecision | { outcome: "eligible"; stage: string; nextStateVersion: number }> {
  const p = receiveSchema.safeParse(raw);
  if (!p.success) return decision("corrupt");
  const { identity: d, delivered, runtimeInstanceId, receipt: r, attempt, command, wait } = p.data;
  if (!await identityValid(d) || !same(delivered, d.wire) || runtimeInstanceId !== d.wire.workflowInstanceId || attempt.dispatchId !== d.dispatchId) return decision("conflict");
  // Historical acknowledgement is replayable after terminal state or instance expiry.
  if (r.outcome === "unavailable") return decision("unavailable");
  if (r.outcome === "partial") return decision("uncertain");
  if (r.outcome === "present") return decision(exactReceipt(d, r.receipt) ? "replayed" : "corrupt");
  if (attempt.state !== "send_started" && attempt.state !== "uncertain") return decision("uncertain");
  const authority = classifyGenerationAuthority(p.data.authority);
  if (authority.outcome !== "captured") return decision(authority.outcome === "needs_revision" ? "not_ready" : authority.outcome);
  const s = authority.snapshot;
  if (!ownerMatches(d, s) || terminal(s) || s.jobStateVersion !== d.wire.jobStateVersion || !Number.isSafeInteger(s.jobStateVersion + 1)) return decision("stale");
  if (p.data.openEffect) return decision("busy");
  let stage: string;
  if (d.wire.dispatchKind === "start") {
    if (s.status !== "dispatch_pending" || s.wait !== null || wait !== null || command !== null) return decision("conflict");
    const next = nextGenerationStage(s.scope, [], d.requestContractVersion);
    if (next.outcome !== "next") return decision("not_ready");
    stage = next.stage;
  } else {
    if ((s.scope !== "full" && s.scope !== "intent") || !wait || wait.generation !== d.wire.waitGeneration) return decision("stale");
    if (d.wire.dispatchKind === "correction") {
      if (!command || command.key !== d.commandKey || !same(wait, command.expected)) return decision("conflict");
      const consumed = assessCorrectionConsume({ command, current: s, openEffect: false });
      if (consumed.outcome !== "eligible") return consumed;
      stage = "correction";
    } else {
      if (command && ["pending", "running", "uncertain"].includes(command.state)) return decision("busy");
      if (d.wire.dispatchKind !== `resume_${wait.kind}`) return decision("conflict");
      const ready = assessGenerationWait(wait, s);
      if (ready.outcome !== "ready") return decision(ready.outcome === "needs_revision" ? "not_ready" : ready.outcome);
      stage = wait.kind === "transcript_review" ? "intent_analysis" : "summary";
      // intent-only jobs finish after the intent review, with no summary generation.
      if (wait.kind === "intent_review" && s.scope === "intent") stage = "finish";
    }
  }
  return { outcome: "eligible", stage, nextStateVersion: s.jobStateVersion + 1 };
}
function correctionCurrent(command: CorrectionCommand, s: GenerationAuthoritySnapshot): LifecycleDecision {
  const wait = command.expected;
  if (s.scope !== "full" || wait.kind !== "transcript_review" || wait.input.sourceKind !== "caption") return decision("not_ready");
  const ready = assessGenerationWait(wait, s);
  if (ready.outcome !== "ready" && !(ready.outcome === "not_ready" && ready.reason === "input_unconfirmed")) {
    return decision(ready.outcome === "needs_revision" ? "not_ready" : ready.outcome);
  }
  return decision(same(wait.input, s.input) && same(wait.content, s.content) ? "eligible" : "stale");
}
const registerSchema = z.strictObject({
  proposed: correctionCommandSchema, existing: correctionCommandSchema.nullable(),
  current: generationAuthoritySnapshotSchema, lastOrdinal: lifecycleCount, openEffect: z.boolean(),
});
export function assessCorrectionRegistration(raw: unknown): LifecycleDecision {
  const p = registerSchema.safeParse(raw);
  if (!p.success) return decision("corrupt");
  const { proposed: c, existing, current, lastOrdinal, openEffect } = p.data;
  if (c.state !== "pending") return decision("conflict");
  if (existing?.key === c.key) {
    const semantic = (v: CorrectionCommand) => ({ ...v, ordinal: 1, state: "pending" });
    return decision(same(semantic(c), semantic(existing)) ? "replayed" : "conflict");
  }
  const eligible = correctionCurrent(c, current);
  if (eligible.outcome !== "eligible") return eligible;
  if (openEffect || (existing && ["pending", "running", "uncertain"].includes(existing.state))) return decision("busy");
  return decision(Number.isSafeInteger(lastOrdinal + 1) && c.ordinal === lastOrdinal + 1 ? "eligible" : "conflict");
}
const consumeSchema = z.strictObject({ command: correctionCommandSchema, current: generationAuthoritySnapshotSchema, openEffect: z.boolean() });
export function assessCorrectionConsume(raw: unknown): LifecycleDecision {
  const p = consumeSchema.safeParse(raw);
  if (!p.success) return decision("corrupt");
  if (p.data.command.state !== "pending") return decision("conflict");
  const ready = correctionCurrent(p.data.command, p.data.current);
  return ready.outcome !== "eligible" ? ready : decision(p.data.openEffect ? "busy" : "eligible");
}

const correctionChangeSchema = z.strictObject({
  command: correctionCommandSchema, current: generationAuthoritySnapshotSchema, effectStarted: z.boolean(),
});
export function assessCorrectionInputChange(raw: unknown): LifecycleDecision | { outcome: "reject_and_rewait_candidate" } {
  const p = correctionChangeSchema.safeParse(raw);
  if (!p.success) return decision("corrupt");
  const { command, current: s, effectStarted } = p.data, w = command.expected;
  if (s.scope !== "full" || w.kind !== "transcript_review" || w.input.sourceKind !== "caption" ||
    !["pending", "running"].includes(command.state) || s.jobId !== command.jobId || s.sermonId !== command.sermonId || s.quizSetId !== command.quizSetId || terminal(s)) return decision("stale");
  if (command.state === "pending" ? s.status !== "awaiting_transcript_review" || s.jobStateVersion !== w.jobStateVersion || s.wait?.generation !== w.generation || effectStarted :
    s.status !== "running" || s.wait !== null || s.jobStateVersion !== w.jobStateVersion + 1) return decision("stale");
  if (same(s.input, w.input) && same(s.content, w.content) && s.metadata.metadataRevision === w.metadataRevision && same(s.selection, w.selection)) return decision("eligible");
  if (effectStarted) return decision("stale");
  const i = s.input;
  if (i.state !== "present" || i.version <= w.input.version || i.sourceId !== w.input.sourceId || i.sourceRevision !== w.input.sourceRevision ||
    i.sourceSha256 !== w.input.sourceSha256 || i.sourceKind !== "caption" || i.coverage !== w.input.coverage ||
    s.metadata.metadataRevision !== w.metadataRevision || !same(s.selection, w.selection) || !same(s.content, w.content)) return decision("stale");
  return { outcome: "reject_and_rewait_candidate" };
}

export function isHistoricalOutcomeConsistent(o: HistoricalOutcome): boolean {
  const i = o.identity, e = o.evidence;
  const reason = { success: "step_succeeded", rejected: "step_rejected", stale: "step_stale", uncertain: "step_uncertain" } as const;
  if (e.jobId !== i.jobId || e.eventNo !== i.event.eventNo || e.after.stateVersion !== i.event.stateVersion ||
    e.stepKey !== i.stepKey || e.attempt !== i.attempt || !same(e.context, i.context) || e.reason !== reason[o.outcome]) return false;
  if (e.before?.status !== "running" || e.before.waitGeneration !== null ||
    (o.outcome === "success" && e.after.status !== "running" && !(i.task === "correction" && e.after.status === "awaiting_transcript_review")) ||
    (o.outcome === "rejected" && e.after.status !== "failed") || (o.outcome === "stale" && e.after.status !== "stale") ||
    (o.outcome === "uncertain" && !["running", "stale"].includes(e.after.status))) return false;
  for (const head of [o.before, o.after]) {
    if (head.input.state === "absent" ? head.content.state !== "absent" :
      !Number.isSafeInteger(head.input.version + (head.content.state === "present" ? head.content.eventCount : 0))) return false;
  }
  if (o.outcome === "success" ? !o.result || o.reason !== "none" : o.result !== null || o.reason !== ({ rejected: "domain_invalid", stale: "authority_changed", uncertain: "usage_unknown" } as const)[o.outcome]) return false;
  const isAi = ["correction", "intent_analysis", "intent_critique", "summary", "child_candidates", "adult_candidates", "final_audit"].includes(i.task);
  if (o.usage) {
    const u = o.usage;
    if (u.callId !== o.callId || u.jobId !== i.jobId || u.sermonId !== i.sermonId || u.quizSetId !== i.quizSetId ||
      u.stepKey !== i.stepKey || u.attempt !== i.attempt || u.task !== i.task || u.inputFingerprint !== i.inputFingerprint || !same(u.context, i.context)) return false;
  }
  if (!isAi && (o.callId !== null || o.usage !== null)) return false;
  if (isAi && o.outcome === "success" && (!o.callId || !o.usage)) return false;
  if (o.outcome === "rejected" && (!o.callId || !o.usage)) return false;
  if (o.outcome === "uncertain" && (!o.callId || o.usage !== null)) return false;
  if (o.result) {
    const kind = i.task === "correction" ? "correction" : i.task === "final_audit" ? "final_audit" :
      i.task === "input_resolve" ? "source" : i.task === "final_validate" ? "ticket" : i.task.startsWith("place_") ? "pure" : "content";
    if (o.result.kind !== kind) return false;
  }
  return true;
}
/** full-value comparison includes null metrics, owner, original capture and own
 * historical event. A present/verified input is a witness supplied by a port. */
export function assessHistoricalOutcome(raw: unknown): LifecycleDecision | { outcome: "committed" | "committed_but_stale" | "failure_replayed" } {
  const p = z.strictObject({ expected: historicalOutcomeSchema, read: historicalReadSchema,
    current: z.enum(["same", "changed", "unavailable", "corrupt"]), effectStarted: z.boolean() }).safeParse(raw);
  if (!p.success || !isHistoricalOutcomeConsistent(p.data.expected)) return decision("corrupt");
  const { expected, read, current, effectStarted } = p.data;
  if (read.outcome === "unavailable") return decision("unavailable");
  if (read.outcome === "partial") return decision("uncertain");
  if (read.outcome === "absent") return decision(effectStarted || expected.callId !== null ? "uncertain" : "not_ready");
  if (read.outcome !== "present") return decision("corrupt");
  if (!isHistoricalOutcomeConsistent(read.value) || !same(expected, read.value) || read.receipt !== "verified" ||
    read.artifact !== (expected.outcome === "success" ? "verified" : "not_applicable") ||
    read.callAndUsage !== (expected.callId ? "verified" : "not_applicable")) return decision("corrupt");
  if (expected.outcome !== "success") return { outcome: "failure_replayed" };
  if (current === "unavailable" || current === "corrupt") return decision(current);
  return { outcome: current === "changed" ? "committed_but_stale" : "committed" };
}
const rewaitSchema = z.strictObject({
  command: correctionCommandSchema, before: generationAuthoritySnapshotSchema,
  after: generationAuthoritySnapshotSchema, nextContext: waitContextSchema,
  outcome: historicalOutcomeSchema,
});
export function assessCorrectionRewait(raw: unknown): LifecycleDecision {
  const p = rewaitSchema.safeParse(raw);
  if (!p.success) return decision("corrupt");
  const { command: c, before: b, after: a, nextContext: next, outcome: o } = p.data, w = next.wait;
  if (next.parent?.commandKey !== c.key || next.parent.waitGeneration !== c.waitGeneration ||
    !same(next.parent.outcome, o.identity.event) || !same(next.enter, o.identity.event) ||
    !isHistoricalOutcomeConsistent(o) || o.outcome !== "success" || o.identity.task !== "correction" || o.identity.stepKey !== `correction_${c.ordinal}` ||
    o.identity.jobId !== c.jobId || o.identity.sermonId !== c.sermonId || o.identity.quizSetId !== c.quizSetId || !same(o.identity.context, c.context) ||
    o.evidence.commandKey !== c.key || o.evidence.after.status !== a.status || o.evidence.after.waitGeneration !== a.wait?.generation ||
    c.state !== "running" || b.status !== "running" || b.wait !== null || b.scope !== "full" || a.scope !== "full" ||
    b.jobId !== c.jobId || a.jobId !== c.jobId || b.sermonId !== c.sermonId || a.sermonId !== c.sermonId || b.quizSetId !== c.quizSetId || a.quizSetId !== c.quizSetId ||
    a.jobStateVersion !== b.jobStateVersion + 1 || o.evidence.before?.stateVersion !== b.jobStateVersion || o.evidence.after.stateVersion !== a.jobStateVersion ||
    !same(o.before, { input: b.input, content: b.content }) || !same(o.after, { input: a.input, content: a.content }) ||
    !same(b.metadata, a.metadata) || !same(b.selection, a.selection) || !same(b.content, a.content) ||
    b.input.state !== "present" || a.input.state !== "present" || !same(b.input, c.expected.input) ||
    a.input.version !== b.input.version + 1 || !same({ ...a.input, version: b.input.version }, b.input) ||
    o.result?.version !== a.input.version || a.status !== "awaiting_transcript_review" ||
    w.generation !== c.waitGeneration + 1 || w.jobStateVersion !== a.jobStateVersion ||
    !same(w.input, a.input) || !same(w.content, a.content) || !same(w.selection, a.selection) || w.metadataRevision !== a.metadata.metadataRevision) return decision("stale");
  const result = assessGenerationWait(w, a);
  return decision(result.outcome === "ready" || (result.outcome === "not_ready" && result.reason === "input_unconfirmed") ? "eligible" : "stale");
}

const observationRead = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("present"), value: usageObservationSchema }),
  z.strictObject({ outcome: z.enum(["absent", "partial", "unavailable"]) }),
]);
export function assessUsageObservation(raw: unknown): LifecycleDecision | { outcome: "append_candidate" | "usage_unknown" } {
  const p = z.strictObject({ expected: usageObservationSchema.nullable(), read: observationRead, effectStarted: z.boolean() }).safeParse(raw);
  if (!p.success) return decision("corrupt");
  const { expected, read, effectStarted } = p.data;
  if (read.outcome === "unavailable") return decision("unavailable");
  if (read.outcome === "partial") return decision("uncertain");
  if (read.outcome === "present") return decision(expected && same(expected, read.value) ? "replayed" : "conflict");
  if (expected) return effectStarted ? { outcome: "append_candidate" } : decision("conflict");
  return effectStarted ? { outcome: "usage_unknown" } : decision("not_ready");
}
const settlementSchema = z.strictObject({ observation: usageObservationSchema,
  originalOutcome: historicalOutcomeSchema, settledAt: lifecycleTime });
export function assessLateUsageSettlement(raw: unknown): LifecycleDecision | { outcome: "append_cost_only_candidate"; mutateTerminal: false; createResult: false } {
  const p = z.strictObject({ expected: settlementSchema,
    read: z.discriminatedUnion("outcome", [z.strictObject({ outcome: z.literal("present"), value: settlementSchema }),
      z.strictObject({ outcome: z.enum(["absent", "partial", "unavailable"]) })]),
    observation: observationRead, resultLink: z.enum(["absent", "present", "unavailable"]),
  }).safeParse(raw);
  if (!p.success) return decision("corrupt");
  const { expected: x, read, observation, resultLink } = p.data, o = x.originalOutcome, u = x.observation, i = o.identity;
  if (!isHistoricalOutcomeConsistent(o) || o.outcome === "success" || o.callId !== u.callId || i.jobId !== u.jobId || i.sermonId !== u.sermonId ||
    i.quizSetId !== u.quizSetId || i.stepKey !== u.stepKey || i.task !== u.task || i.attempt !== u.attempt ||
    i.inputFingerprint !== u.inputFingerprint || !same(i.context, u.context) || (o.usage !== null && !same(o.usage, u)) ||
    Date.parse(x.settledAt) < Date.parse(u.observedAt)) return decision("conflict");
  if (read.outcome === "unavailable" || observation.outcome === "unavailable" || resultLink === "unavailable") return decision("unavailable");
  if (resultLink !== "absent") return decision("conflict");
  if (observation.outcome !== "present" || !same(observation.value, u)) return decision(observation.outcome === "present" ? "conflict" : "uncertain");
  if (read.outcome === "partial") return decision("uncertain");
  if (read.outcome === "present") return decision(same(read.value, x) ? "replayed" : "conflict");
  return { outcome: "append_cost_only_candidate", mutateTerminal: false, createResult: false };
}

const prefixSchema = z.array(z.strictObject({ stage: generationStageSchema, evidence: transitionEvidenceSchema })).max(15);
const legacyFinalSchema = z.strictObject({ capture: generationFinalCaptureSchema, auditContext: stepContextSchema, ticketId: lifecycleId,
  ticketFingerprint: z.string().regex(/^[0-9a-f]{64}$/u), audit: historicalOutcomeSchema,
  hardGate: z.enum(["passed", "failed", "unavailable"]), warningCount: lifecycleCount });
const validatedFinalSchema = z.strictObject({ kind: z.literal("validated"), capture: generationFinalCaptureSchema,
  validationContextId: lifecycleId, validationContext: requestContextSchema, ticketId: lifecycleId, ticketFingerprint: lifecycleDigest,
  previewFingerprint: lifecycleDigest, hardGate: z.literal("passed") });
const finishSchema = z.strictObject({
  requestContractVersion: z.union([z.literal(2), z.literal(3)]).default(2),
  captured: generationAuthoritySnapshotSchema, current: authorityReadSchema, prefix: prefixSchema,
  openEffect: z.boolean(), openCommand: z.boolean(), reusedAnalysis: z.boolean().default(false), reusedCritique: z.boolean().default(false),
  final: z.union([legacyFinalSchema, validatedFinalSchema]).nullable(),
});
/** Terminal candidate only. Actual CAS/event/outcome/FK writes and domain gate
 * execution are deliberately absent. warnings never constitute approval. */
export async function assessGenerationFinish(raw: unknown): Promise<LifecycleDecision | { outcome: "terminal_candidate"; status: "review_ready" | "needs_revision"; stage: "finish" | "content_review" }> {
  const p = finishSchema.safeParse(raw);
  if (!p.success) return decision("corrupt");
  const { captured: s, prefix, final } = p.data, current = classifyGenerationAuthority(p.data.current);
  if (current.outcome !== "captured") return decision(current.outcome === "needs_revision" ? "not_ready" : current.outcome);
  if (!same(s, current.snapshot)) return decision("stale");
  if (terminal(s) || s.status !== "running" || s.wait !== null || !Number.isSafeInteger(s.jobStateVersion + 1)) return decision("not_ready");
  if (p.data.openEffect || p.data.openCommand) return decision("busy");
  let lastEvent = 0, lastState = -1;
  for (const entry of prefix) {
    const e = entry.evidence;
    if (e.jobId !== s.jobId || e.eventNo <= lastEvent || e.after.stateVersion <= lastState || e.after.stateVersion > s.jobStateVersion ||
      !["step_succeeded", "stage_completed", "received", ...(p.data.reusedCritique ? ["wait_entered"] : [])].includes(e.reason)) return decision("corrupt");
    const mapping = GENERATION_STAGE_STORAGE[entry.stage];
    if (p.data.reusedCritique && p.data.reusedAnalysis && s.scope === "full" && p.data.requestContractVersion === 3 &&
      entry.stage === "intent_critique" && e.reason === "wait_entered" && e.before?.stage === "intent_critique" &&
      e.before.status === "running" && e.before.waitGeneration === null && e.after.stage === "intent_review" &&
      e.after.status === "awaiting_intent_review" && e.after.waitGeneration !== null && e.stepKey === null &&
      e.attempt === null && e.dispatchKey === null && e.commandKey === null) {
      lastEvent = e.eventNo; lastState = e.after.stateVersion; continue;
    }
    // A full continuation completes the analysis stage by reusing its verified
    // archived result. This is a local transition, never a successful AI call.
    if (p.data.reusedAnalysis && s.scope === "full" && p.data.requestContractVersion === 3 && entry.stage === "intent_analysis" &&
      e.reason === "stage_completed" && e.before?.stage === "intent_analysis" && e.before.status === "running" &&
      e.after.stage === "intent_critique" && e.after.status === "running" && e.before.waitGeneration === null && e.after.waitGeneration === null &&
      e.dispatchKey === null && e.commandKey === null && e.stepKey === null && e.attempt === null) {
      lastEvent = e.eventNo; lastState = e.after.stateVersion; continue;
    }
    // Intent-only work starts from an already confirmed transcript. Its
    // transcript stage is completed without opening a redundant human wait.
    if (s.scope === "intent" && entry.stage === "transcript_review" && e.reason === "stage_completed" &&
      e.before?.stage === "transcript_review" && e.before.status === "running" &&
      e.after.stage === (p.data.reusedAnalysis ? "intent_critique" : "intent_analysis") && e.after.status === "running" &&
      e.before.waitGeneration === null && e.after.waitGeneration === null &&
      e.dispatchKey === null && e.commandKey === null) {
      lastEvent = e.eventNo; lastState = e.after.stateVersion; continue;
    }
    // A receiver consumes the BEFORE wait and records the actual NEXT stage.
    // Stage-only transitions likewise complete their before-stage; AI outcomes
    // retain their own stage until a separate advance. Never rewrite DB history.
    if (mapping.evidence === "received") {
      const nextStage = entry.stage === "transcript_review" ? "intent_analysis" : s.scope === "intent" ? "finish" : "summary";
      const status = entry.stage === "transcript_review" ? "awaiting_transcript_review" : "awaiting_intent_review";
      if (e.before?.stage !== entry.stage || e.before.status !== status || e.before.waitGeneration === null ||
        e.after.stage !== nextStage || e.after.status !== "running" || e.after.waitGeneration !== null ||
        e.commandKey !== null || e.stepKey !== null || e.attempt === null) return decision("corrupt");
    } else if (mapping.evidence === "stage_completed") {
      if (e.before?.stage !== entry.stage || e.before.status !== "running" || e.after.status !== "running" ||
        e.before.waitGeneration !== null || e.after.waitGeneration !== null || e.dispatchKey !== null || e.commandKey !== null) return decision("corrupt");
    } else if (e.after.stage !== entry.stage) return decision("corrupt");
    if (e.reason !== mapping.evidence || (mapping.evidence === "received" && !e.dispatchKey) ||
      (mapping.evidence === "step_succeeded" && (e.stepKey !== mapping.stepKey || e.attempt === null))) return decision("corrupt");
    lastEvent = e.eventNo; lastState = e.after.stateVersion;
  }
  const actualStages = prefix.map((entry) => entry.stage);
  if (p.data.reusedAnalysis && !(s.scope === "intent" && actualStages[0] === "transcript_review" && actualStages[1] === "intent_critique" ||
    s.scope === "full" && p.data.requestContractVersion === 3 && actualStages[0] === "input_resolve" && actualStages[1] === "transcript_review" &&
    actualStages[2] === "intent_analysis" && prefix[2]?.evidence.reason === "stage_completed" && actualStages[3] === "intent_critique")) return decision("corrupt");
  const stages = p.data.reusedAnalysis && s.scope === "intent" ? ["transcript_review", "intent_analysis", ...actualStages.slice(1)] : actualStages;
  const storedContent = final && "kind" in final && final.kind === "validated" && final.validationContext.reuseCurrentContent;
  if (storedContent) {
    const original = final.validationContext.authority, content = original.content;
    if (s.scope !== "full" || p.data.requestContractVersion !== 3 || p.data.reusedAnalysis || p.data.reusedCritique ||
      !same(actualStages, ["input_resolve", "content_review", "place_child", "place_adult", "final_validate"]) ||
      prefix[0]?.evidence.after.stage !== "content_review" ||
      prefix[0]?.evidence.context.contextId !== final.validationContextId ||
      content.state !== "present" || !content.intent?.confirmation || !content.summary || !content.child || !content.adult) return decision("corrupt");
    if (!same(original.input, s.input) || !same(original.metadata, s.metadata) ||
      s.content.state !== "present" || s.content.intent?.confirmation?.id !== content.intent.confirmation.id) return decision("stale");
  } else {
  const next = nextGenerationStage(s.scope, stages, p.data.requestContractVersion);
  if (next.outcome !== "next") return decision("not_ready");
  const readiness = assessGenerationStage(s, stages, p.data.requestContractVersion);
  if (readiness.outcome === "needs_revision" && next.stage === "content_review") return { outcome: "terminal_candidate", status: "needs_revision", stage: "content_review" };
  if (readiness.outcome !== "ready") return decision(readiness.outcome === "needs_revision" ? "not_ready" : readiness.outcome);
  if (next.stage !== "finish") return decision("not_ready");
  }
  if (p.data.requestContractVersion === 3 && s.scope === "full") {
    if (!final || !("kind" in final) || final.kind !== "validated") return decision("not_ready");
    const last = prefix.at(-1)?.evidence, context = final.validationContext;
    if (!last || prefix.at(-1)?.stage !== "final_validate" || last.after.stateVersion !== s.jobStateVersion ||
      last.after.stage !== "finish" || last.context.contextId !== final.validationContextId) return decision("corrupt");
    const captured = assessFinalCapture(s, final.capture);
    if (captured.outcome !== "ready") return decision(captured.outcome === "needs_revision" ? "not_ready" : captured.outcome);
    if (await fingerprintLifecycleValue(final.capture.ticket) !== final.ticketFingerprint ||
      context.authority.jobId !== s.jobId || context.authority.sermonId !== s.sermonId || context.authority.quizSetId !== s.quizSetId ||
      !same(last.context, { contextId: final.validationContextId, fingerprint: await fingerprintLifecycleValue(context) })) return decision("conflict");
    return { outcome: "terminal_candidate", status: "review_ready", stage: "finish" };
  }
  if (s.scope === "full" || s.scope === "final_audit") {
    if (!final || "kind" in final || final.hardGate === "unavailable") return decision("not_ready");
    const captured = assessFinalCapture(s, final.capture);
    if (captured.outcome !== "ready") return decision(captured.outcome === "needs_revision" ? "not_ready" : captured.outcome);
    if (final.hardGate === "failed") return { outcome: "terminal_candidate", status: "needs_revision", stage: "content_review" };
    const audit = final.audit;
    if (!isHistoricalOutcomeConsistent(audit) || audit.outcome !== "success" || audit.identity.task !== "final_audit" || audit.identity.jobId !== s.jobId ||
      audit.identity.sermonId !== s.sermonId || audit.identity.quizSetId !== s.quizSetId ||
      !same(audit.after, { input: s.input, content: s.content }) ||
      !same(prefix.at(-1)?.evidence, audit.evidence) ||
      await fingerprintLifecycleValue(final.capture.ticket) !== final.ticketFingerprint) return decision("corrupt");
    const context = final.auditContext;
    if (context.execution.task !== "final_audit" || !same(context.execution.context, final.capture) ||
      context.authority.jobId !== s.jobId || context.authority.sermonId !== s.sermonId || context.authority.quizSetId !== s.quizSetId ||
      !context.references.some((ref) => ref.eventId === final.ticketId && ref.kind === "ticket" && ref.sha256 === final.ticketFingerprint && ref.sermonId === s.sermonId) ||
      !same(context.authority.input, s.input) || !same(context.authority.content, s.content) || !same(context.authority.metadata, s.metadata) || !same(context.authority.selection, s.selection) ||
      audit.evidence.context.fingerprint !== await fingerprintLifecycleValue(context)) return decision("conflict");
  } else if (final !== null) return decision("conflict");
  return { outcome: "terminal_candidate", status: "review_ready", stage: "finish" };
}

export function assessGenerationStale(raw: unknown): LifecycleDecision | { outcome: "stale_candidate"; usage: "none" | "settle_known" | "unknown"; createResult: false } {
  const p = z.strictObject({ current: generationAuthoritySnapshotSchema, authority: authorityReadSchema,
    effectStarted: z.boolean(), observation: observationRead, call: z.strictObject({ ...usageObservationSchema.shape }).pick({ callId: true, jobId: true, sermonId: true, quizSetId: true, stepKey: true, attempt: true, task: true, context: true, inputFingerprint: true }).nullable(),
  }).safeParse(raw);
  if (!p.success) return decision("corrupt");
  const { current: s, authority, effectStarted, observation, call } = p.data;
  if (terminal(s)) return decision("not_ready");
  if (authority.outcome === "unavailable" || observation.outcome === "unavailable") return decision("unavailable");
  if (authority.outcome === "corrupt") return decision("corrupt");
  if (observation.outcome === "partial") return decision("uncertain");
  if (authority.outcome !== "changed") return decision("not_ready");
  if (!Number.isSafeInteger(s.jobStateVersion + 1)) return decision("not_ready");
  if (effectStarted !== (call !== null)) return decision("conflict");
  if (call && (call.jobId !== s.jobId || call.sermonId !== s.sermonId || call.quizSetId !== s.quizSetId)) return decision("conflict");
  if (observation.outcome === "present") {
    const u = observation.value;
    if (!call || Object.entries(call).some(([key, value]) => !same(value, Reflect.get(u, key)))) return decision("conflict");
  }
  return { outcome: "stale_candidate", usage: !effectStarted ? "none" : observation.outcome === "present" ? "settle_known" : "unknown", createResult: false };
}
