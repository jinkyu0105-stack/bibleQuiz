import { describe, expect, it } from "vitest";
import {
  assessCorrectionConsume, assessCorrectionInputChange, assessCorrectionRegistration, assessCorrectionRewait,
  assessDispatchReceive, assessDispatchRecovery, assessGenerationFinish, assessGenerationStale,
  assessHistoricalOutcome, assessLateUsageSettlement, assessSendReservation, assessUsageObservation,
} from "../_shared/services/generation-lifecycle";
import { fingerprintLifecycleValue } from "../_shared/services/generation-context-codec";
import {
  dispatchAttemptSchema, transitionEvidenceSchema, usageObservationSchema,
  type CorrectionCommand, type DispatchIdentity, type HistoricalOutcome, type ReceiverReceipt,
} from "../_shared/services/generation-lifecycle-contract";
import type { GenerationScope, GenerationStage } from "../_shared/services/generation-bridge-contract";
import {
  contextRef, evidence, hash, historical, input, content, later, now, requestContext, snapshot, stepContext, ticket, usage, waiting, waitContext,
} from "./test/generation-lifecycle-fixture";

const canary = "TEST_ONLY_LIFECYCLE_PRIVATE_CANARY";
const absent = { outcome: "absent" as const };
async function dispatch(kind: DispatchIdentity["wire"]["dispatchKind"] = "start", requestScope: GenerationScope = "full"): Promise<DispatchIdentity> {
  const wire: DispatchIdentity["wire"] = { contractVersion: 1, jobId: "job", workflowInstanceId: "instance", dispatchKind: kind,
    dispatchKey: kind === "start" ? "start" : "wait_2", jobStateVersion: kind === "start" ? 0 : 5,
    waitGeneration: kind === "start" ? null : 2, requestFingerprint: hash };
  return { dispatchId: "dispatch", sermonId: "sermon", quizSetId: "quiz", requestContractVersion: 2, requestScope, wire, payloadFingerprint: await fingerprintLifecycleValue(wire),
    request: structuredClone(contextRef), context: structuredClone(contextRef), commandKey: kind === "correction" ? "command" : null };
}
function attempt(state: "reserved" | "send_started" | "uncertain" | "legacy_claimed" = "reserved") {
  return dispatchAttemptSchema.parse({ dispatchId: "dispatch", attempt: 1, claimToken: "token", state, leaseExpiresAt: later,
    sendStartedAt: state === "reserved" || state === "legacy_claimed" ? null : now });
}
function receipt(identity: DispatchIdentity): ReceiverReceipt {
  const e = evidence("input_resolve", identity.wire.jobStateVersion + 1);
  e.reason = "received"; e.dispatchKey = identity.wire.dispatchKey; e.commandKey = identity.commandKey;
  e.before!.waitGeneration = identity.wire.waitGeneration;
  e.before!.status = identity.wire.dispatchKind === "start" ? "dispatch_pending" : identity.wire.dispatchKind === "resume_intent_review" ? "awaiting_intent_review" : "awaiting_transcript_review";
  e.after.stage = identity.wire.dispatchKind === "start" ? "input_resolve" : identity.wire.dispatchKind === "resume_intent_review" ? "summary" : identity.wire.dispatchKind === "correction" ? "correction" : "intent_analysis";
  return { identity, receivedAt: later, evidence: e };
}
function command(): CorrectionCommand {
  const { wait } = waiting("transcript_review");
  return { jobId: "job", sermonId: "sermon", quizSetId: "quiz", key: "command", ordinal: 1, actorDigest: hash,
    waitGeneration: 2, enter: { eventNo: 6, stateVersion: 5 }, context: structuredClone(contextRef), expected: wait, state: "pending" };
}
function readOutcome(value: HistoricalOutcome) {
  return { outcome: "present" as const, value, artifact: value.outcome === "success" ? "verified" as const : "not_applicable" as const,
    receipt: "verified" as const, callAndUsage: "verified" as const };
}
function prefix(stages: GenerationStage[], scope: GenerationScope = "full") { return stages.map((stage, index) => {
  const e = evidence(stage, index + 1);
  if (stage === "transcript_review" || stage === "intent_review") {
    e.reason = "received"; e.dispatchKey = "wait_dispatch"; e.stepKey = null;
    e.before!.status = stage === "transcript_review" ? "awaiting_transcript_review" : "awaiting_intent_review";
    e.before!.waitGeneration = 1;
    e.after.stage = stage === "transcript_review" ? "intent_analysis" : scope === "intent" ? "finish" : "summary";
  }
  else if (["input_resolve", "content_review", "place_child", "place_adult", "final_validate"].includes(stage)) e.reason = "stage_completed";
  return { stage, evidence: e };
}); }

describe("P5-43 dispatch planning on supplied evidence, no sender/receiver/storage execution", () => {
  it("P42-04 only an expired reserved attempt is a reclaim candidate; old token cannot reserve send", async () => {
    const identity = await dispatch(), a = attempt(), currentJob = snapshot(); currentJob.status = "dispatch_pending"; currentJob.jobStateVersion = 0;
    const recover = { identity, attempt: a, receipt: absent, now, jobActive: true, external: "missing" };
    expect(await assessDispatchRecovery(recover)).toEqual({ outcome: "busy" });
    expect(await assessDispatchRecovery({ ...recover, now: later })).toEqual({ outcome: "reclaim_candidate", nextAttempt: 2 });
    expect(await assessSendReservation({ current: a, expected: a, now, currentJob, identity })).toEqual({ outcome: "eligible" });
    expect(await assessSendReservation({ current: { ...a, attempt: 2, claimToken: "new" }, expected: a, now, currentJob, identity })).toEqual({ outcome: "conflict" });
    expect(await assessSendReservation({ current: a, expected: a, now: later, currentJob, identity })).toEqual({ outcome: "stale" });
    expect(await assessDispatchRecovery({ ...recover, now: later, attempt: { ...a, attempt: Number.MAX_SAFE_INTEGER } })).toEqual({ outcome: "not_ready" });
  });
  it.each(["exists", "missing", "unavailable"])("P42-05 send_started + external %s does not become retryable", async (external) => {
    const identity = await dispatch();
    for (const state of ["send_started", "uncertain", "legacy_claimed"] as const) {
      expect(await assessDispatchRecovery({ identity, attempt: attempt(state), receipt: absent, now: later, jobActive: true, external })).toEqual({ outcome: "uncertain" });
    }
  });
  it("P42-06 exact receiver proof replays after terminal/instance expiry; partial and unavailable remain distinct", async () => {
    const identity = await dispatch(), r = receipt(identity);
    const base = { identity, attempt: attempt("send_started"), receipt: { outcome: "present", receipt: r }, now: later, jobActive: false, external: "missing" };
    expect(await assessDispatchRecovery(base)).toEqual({ outcome: "replayed" });
    r.evidence.context.fingerprint = "b".repeat(64);
    expect(await assessDispatchRecovery(base)).toEqual({ outcome: "corrupt" });
    expect(await assessDispatchRecovery({ ...base, receipt: { outcome: "partial" } })).toEqual({ outcome: "uncertain" });
    expect(await assessDispatchRecovery({ ...base, receipt: { outcome: "unavailable" } })).toEqual({ outcome: "unavailable" });
  });
  it.each([
    ["full", "input_resolve"], ["transcript_correction", "correction"], ["intent", "transcript_review"],
    ["summary", "summary"], ["child", "child_candidates"], ["adult", "adult_candidates"], ["final_audit", "content_review"],
  ] as const)("receiver starts %s at its own %s stage", async (scope, stage) => {
    const identity = await dispatch("start", scope), s = snapshot(scope); s.status = "dispatch_pending"; s.jobStateVersion = 0;
    const raw = { identity, delivered: identity.wire, runtimeInstanceId: "instance", attempt: attempt("send_started"), receipt: absent,
      authority: { outcome: "captured", snapshot: s }, wait: null, command: null, openEffect: false };
    expect(await assessDispatchReceive(raw)).toEqual({ outcome: "eligible", stage, nextStateVersion: 1 });
    const saved = structuredClone(raw);
    expect(await assessDispatchReceive({ ...raw, runtimeInstanceId: "forged" })).toEqual({ outcome: "conflict" });
    expect(raw).toEqual(saved);
    expect(await assessDispatchReceive({ ...raw, identity: { ...identity, requestScope: "single_entry" } })).toEqual({ outcome: "stale" });
  });
  it.each(["jobId", "workflowInstanceId", "dispatchKey", "requestFingerprint", "jobStateVersion", "waitGeneration", "contractVersion", "dispatchKind"])("P42-07 compares wire field %s", async (field) => {
    const identity = await dispatch(), s = snapshot(); s.status = "dispatch_pending"; s.jobStateVersion = 0;
    const delivered = { ...identity.wire, [field]: ["contractVersion", "jobStateVersion", "waitGeneration"].includes(field) ? 3 : field === "requestFingerprint" ? "b".repeat(64) : "foreign" };
    expect((await assessDispatchReceive({ identity, delivered, runtimeInstanceId: "instance", attempt: attempt("send_started"), receipt: absent,
      authority: { outcome: "captured", snapshot: s }, wait: null, command: null, openEffect: false })).outcome).not.toBe("eligible");
  });
  it("P42-08/09 confirmation already present resumes; re-read failure, ABA and pending correction block", async () => {
    const identity = await dispatch("resume_transcript_review"), { s, wait } = waiting("transcript_review");
    const raw = { identity, delivered: identity.wire, runtimeInstanceId: "instance", attempt: attempt("uncertain"), receipt: absent,
      authority: { outcome: "captured", snapshot: s }, wait, command: null, openEffect: false };
    expect(await assessDispatchReceive(raw)).toMatchObject({ outcome: "eligible", stage: "intent_analysis" });
    expect(await assessDispatchReceive({ ...raw, command: command() })).toEqual({ outcome: "busy" });
    expect(await assessDispatchReceive({ ...raw, authority: { outcome: "unavailable" } })).toEqual({ outcome: "unavailable" });
    expect(await assessDispatchReceive({ ...raw, authority: { outcome: "corrupt" } })).toEqual({ outcome: "corrupt" });
    const stale = structuredClone(s); stale.metadata.metadataRevision++;
    expect(await assessDispatchReceive({ ...raw, authority: { outcome: "captured", snapshot: stale } })).toEqual({ outcome: "stale" });
    const end = structuredClone(s); end.status = "review_ready"; end.wait = null;
    expect(await assessDispatchReceive({ ...raw, authority: { outcome: "captured", snapshot: end } })).toEqual({ outcome: "stale" });
    expect(await assessDispatchReceive({ ...raw, authority: { outcome: "captured", snapshot: end }, receipt: { outcome: "present", receipt: receipt(identity) } })).toEqual({ outcome: "replayed" });
  });
});

describe("P5-43 same-job correction and wait transition candidates", () => {
  it("P42-10 registers exactly the requested command, replays same semantics and blocks a competing key", () => {
    const proposed = command(), current = waiting("transcript_review").s;
    const raw = { proposed, existing: null, current, lastOrdinal: 0, openEffect: false };
    expect(assessCorrectionRegistration(raw)).toEqual({ outcome: "eligible" });
    expect(assessCorrectionRegistration({ ...raw, existing: { ...proposed, state: "succeeded" }, lastOrdinal: 1 })).toEqual({ outcome: "replayed" });
    expect(assessCorrectionRegistration({ ...raw, proposed: { ...proposed, actorDigest: "b".repeat(64) }, existing: proposed })).toEqual({ outcome: "conflict" });
    expect(assessCorrectionRegistration({ ...raw, proposed: { ...proposed, key: "other", ordinal: 2 }, existing: proposed, lastOrdinal: 1 })).toEqual({ outcome: "busy" });
    expect(assessCorrectionRegistration({ ...raw, lastOrdinal: Number.MAX_SAFE_INTEGER })).toEqual({ outcome: "conflict" });
  });
  it.each(["sermon_manuscript", "sermon_summary", "intent_review", "summary", "terminal"])("P42-10 refuses %s correction", (kind) => {
    const c = command(), current = waiting("transcript_review").s;
    if (kind === "sermon_manuscript" || kind === "sermon_summary") { c.expected.input.sourceKind = kind; input(current).sourceKind = kind; }
    if (kind === "intent_review") { const w = waiting("intent_review"); c.expected = w.wait; Object.assign(current, w.s); }
    if (kind === "summary") current.scope = "summary";
    if (kind === "terminal") current.status = "stale";
    expect(assessCorrectionConsume({ command: c, current, openEffect: false }).outcome).not.toBe("eligible");
  });
  it("P42-11 models either consume order using the new state, never counts this as DB concurrency", async () => {
    const d = await dispatch("correction"), c = command(), { s, wait } = waiting("transcript_review");
    expect(await assessDispatchReceive({ identity: d, delivered: d.wire, runtimeInstanceId: "instance", attempt: attempt("send_started"), receipt: absent,
      authority: { outcome: "captured", snapshot: s }, wait, command: c, openEffect: false })).toMatchObject({ outcome: "eligible" });
    const consumed = structuredClone(s); consumed.jobStateVersion++; consumed.wait = null; consumed.status = "running";
    expect(assessCorrectionConsume({ command: c, current: consumed, openEffect: false })).toEqual({ outcome: "stale" });
    const resume = await dispatch("resume_transcript_review");
    expect(await assessDispatchReceive({ identity: resume, delivered: resume.wire, runtimeInstanceId: "instance", attempt: attempt("send_started"), receipt: absent,
      authority: { outcome: "captured", snapshot: consumed }, wait, command: null, openEffect: false })).toEqual({ outcome: "stale" });
  });
  it("P42-12 never rebases a correction after direct edit: rewait candidate before effect, stale after", () => {
    const c = command(), current = waiting("transcript_review").s, saved = structuredClone(c);
    input(current).version++; input(current).documentId = "edited"; input(current).documentSha256 = "b".repeat(64); input(current).confirmationId = null;
    expect(assessCorrectionInputChange({ command: c, current, effectStarted: false })).toEqual({ outcome: "reject_and_rewait_candidate" });
    expect(assessCorrectionInputChange({ command: c, current, effectStarted: true })).toEqual({ outcome: "stale" });
    input(current).sourceId = "other";
    expect(assessCorrectionInputChange({ command: c, current, effectStarted: false })).toEqual({ outcome: "stale" });
    expect(c).toEqual(saved);
  });
  it("correction success requires own proposal + input increment and a fresh wait generation/version", () => {
    const c = command(); c.state = "running";
    const before = snapshot(); before.jobStateVersion = 6;
    const after = structuredClone(before); after.jobStateVersion++; after.status = "awaiting_transcript_review"; after.wait = { kind: "transcript_review", generation: 3 }; input(after).version++;
    const w = { ...structuredClone(c.expected), generation: 3, jobStateVersion: 7, input: structuredClone(input(after)) };
    const o = historical(); o.identity.task = "correction"; o.identity.stepKey = "correction_1"; o.identity.event = { eventNo: 8, stateVersion: 7 };
    o.result = { kind: "correction", id: "proposal", version: 3, fingerprint: hash }; o.usage!.task = "correction"; o.usage!.stepKey = "correction_1";
    o.evidence = evidence("correction", 7); o.evidence.stepKey = "correction_1"; o.evidence.commandKey = c.key; o.evidence.after.status = "awaiting_transcript_review"; o.evidence.after.waitGeneration = 3;
    o.before = { input: before.input, content: before.content }; o.after = { input: after.input, content: after.content };
    const nextContext = waitContext(); nextContext.wait = w; nextContext.enter = o.identity.event;
    nextContext.parent = { commandKey: c.key, waitGeneration: c.waitGeneration, outcome: o.identity.event };
    const raw = { command: c, before, after, nextContext, outcome: o };
    expect(assessCorrectionRewait(raw)).toEqual({ outcome: "eligible" });
    expect(assessCorrectionRewait({ ...raw, nextContext: { ...nextContext, wait: c.expected } })).toEqual({ outcome: "stale" });
    expect(assessCorrectionRewait({ ...raw, outcome: { ...o, result: { ...o.result, version: 2 } } })).toEqual({ outcome: "stale" });
    expect(assessCorrectionConsume({ command: { ...c, state: "pending" }, current: after, openEffect: false })).toEqual({ outcome: "stale" });
  });
});

describe("P5-43 historical outcome and full-value usage witnesses", () => {
  it("P42-13 original success stays committed after later stages/finish; currentness is separate", () => {
    const expected = historical(), read = readOutcome(structuredClone(expected));
    expect(assessHistoricalOutcome({ expected, read, current: "same", effectStarted: true })).toEqual({ outcome: "committed" });
    expect(assessHistoricalOutcome({ expected, read, current: "changed", effectStarted: true })).toEqual({ outcome: "committed_but_stale" });
    expect(assessHistoricalOutcome({ expected, read, current: "unavailable", effectStarted: true })).toEqual({ outcome: "unavailable" });
    read.value.evidence.eventNo++;
    expect(assessHistoricalOutcome({ expected, read, current: "same", effectStarted: true })).toEqual({ outcome: "corrupt" });
  });
  it.each(["attempt", "context", "step", "result", "receipt", "artifact", "usage", "event"])("rejects foreign/partial historical %s", (field) => {
    const expected = historical(), read = readOutcome(structuredClone(expected));
    if (field === "attempt") read.value.identity.attempt++;
    if (field === "context") read.value.identity.context.contextId = "foreign";
    if (field === "step") read.value.identity.stepKey = "other";
    if (field === "result") read.value.result!.id = "other";
    if (field === "receipt") Reflect.set(read, "receipt", "missing");
    if (field === "artifact") Reflect.set(read, "artifact", "mismatch");
    if (field === "usage") Reflect.set(read, "callAndUsage", "missing");
    if (field === "event") read.value.identity.event.eventNo++;
    expect(assessHistoricalOutcome({ expected, read, current: "same", effectStarted: true })).toEqual({ outcome: "corrupt" });
  });
  it.each(["inputTokens", "cachedInputTokens", "reasoningTokens", "outputTokens", "audioInputTokens", "audioSeconds", "estimatedCostMicroUsd", "pricingVersion", "usageSource", "observedAt", "provider", "model", "reasoningEffort", "providerRequestIdOpaque", "startedAt"])("P42-14 same usage/call IDs cannot replay changed %s", (field) => {
    const expected = historical("rejected"), read = readOutcome(structuredClone(expected));
    const u = read.value.usage!;
    const old = Reflect.get(u, field);
    const value = field === "observedAt" ? "2026-09-17T00:02:00Z" : field === "startedAt" ? "2026-09-16T00:00:00Z" : field === "usageSource" ? "provider_reported" : field === "providerRequestIdOpaque" ? hash :
      ["pricingVersion", "provider", "model", "reasoningEffort"].includes(field) ? "other" : typeof old === "number" ? old + 1 : 0;
    Reflect.set(u, field, value);
    expect(assessHistoricalOutcome({ expected, read, current: "same", effectStarted: true })).toEqual({ outcome: "corrupt" });
  });
  it.each(["rejected", "stale", "uncertain"] as const)("replays exact %s without manufacturing success", (kind) => {
    const expected = historical(kind);
    expect(assessHistoricalOutcome({ expected, read: readOutcome(expected), current: "changed", effectStarted: true })).toEqual({ outcome: "failure_replayed" });
    expect(assessHistoricalOutcome({ expected, read: absent, current: "same", effectStarted: true })).toEqual({ outcome: "uncertain" });
    expect(assessHistoricalOutcome({ expected, read: { outcome: "partial" }, current: "same", effectStarted: true })).toEqual({ outcome: "uncertain" });
    expect(assessHistoricalOutcome({ expected, read: { outcome: "unavailable" }, current: "same", effectStarted: true })).toEqual({ outcome: "unavailable" });
  });
  it("P42-15/17 observation crash remains unknown; known zero is distinct from missing usage", () => {
    expect(assessUsageObservation({ expected: null, read: absent, effectStarted: true })).toEqual({ outcome: "usage_unknown" });
    const expected = usage(); expected.inputTokens = 0; expected.outputTokens = null; expected.estimatedCostMicroUsd = 0;
    expect(assessUsageObservation({ expected, read: absent, effectStarted: true })).toEqual({ outcome: "append_candidate" });
    expected.inputTokens = null;
    expect(assessUsageObservation({ expected, read: absent, effectStarted: true })).toEqual({ outcome: "corrupt" });
    expect(usageObservationSchema.safeParse({ ...usage(), inputTokens: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  });
  it("P42-16/18/19 late costs only append from exact observation and own failure; terminals/results are untouched", () => {
    const observation = usage(), originalOutcome = historical("uncertain");
    const expected = { observation, originalOutcome, settledAt: later };
    const raw = { expected, read: absent, observation: { outcome: "present", value: observation }, resultLink: "absent" };
    expect(assessLateUsageSettlement(raw)).toEqual({ outcome: "append_cost_only_candidate", mutateTerminal: false, createResult: false });
    expect(assessLateUsageSettlement({ ...raw, read: { outcome: "present", value: expected } })).toEqual({ outcome: "replayed" });
    expect(assessLateUsageSettlement({ ...raw, resultLink: "present" })).toEqual({ outcome: "conflict" });
    expect(assessLateUsageSettlement({ ...raw, observation: absent })).toEqual({ outcome: "uncertain" });
    expect(assessLateUsageSettlement({ ...raw, read: { outcome: "partial" } })).toEqual({ outcome: "uncertain" });
    expect(assessLateUsageSettlement({ ...raw, observation: { outcome: "unavailable" } })).toEqual({ outcome: "unavailable" });
    expect(assessLateUsageSettlement({ ...raw, observation: { outcome: "present", value: { ...observation, outputTokens: 21 } } })).toEqual({ outcome: "conflict" });
    expect(assessLateUsageSettlement({ ...raw, expected: { ...expected, originalOutcome: historical("success") } })).toEqual({ outcome: "conflict" });
  });
  it("observation response-loss requires all supplied values and refuses replacement", () => {
    const expected = usage();
    expect(assessUsageObservation({ expected, read: { outcome: "present", value: expected }, effectStarted: true })).toEqual({ outcome: "replayed" });
    expect(assessUsageObservation({ expected, read: { outcome: "present", value: { ...expected, outputTokens: 21 } }, effectStarted: true })).toEqual({ outcome: "conflict" });
  });
});

async function finalFinish() {
  const s = snapshot("final_audit"), stages: GenerationStage[] = ["content_review", "place_child", "place_adult", "final_validate", "final_audit"];
  const completed = prefix(stages, "final_audit"), capture = { ticket: ticket(s), settingsRevision: 1, selectionRevision: 1 };
  const ticketFingerprint = await fingerprintLifecycleValue(capture.ticket), ctx = stepContext();
  ctx.authority = structuredClone(s); ctx.authority.jobStateVersion = 4; ctx.predecessor = { kind: "outcome", eventNo: 5, stateVersion: 4 }; ctx.stepKey = "final_audit"; ctx.execution = { task: "final_audit", context: capture };
  ctx.references.push({ sermonId: "sermon", eventId: "ticket", kind: "ticket", sha256: ticketFingerprint });
  const audit = historical(); audit.identity.task = "final_audit"; audit.identity.stepKey = "final_audit";
  audit.usage!.task = "final_audit"; audit.usage!.stepKey = "final_audit"; audit.result!.kind = "final_audit";
  audit.evidence = completed.at(-1)!.evidence;
  audit.identity.context = { contextId: "audit_context", fingerprint: await fingerprintLifecycleValue(ctx) };
  audit.evidence.context = audit.identity.context; audit.usage!.context = audit.identity.context;
  return { captured: s, current: { outcome: "captured", snapshot: s }, prefix: completed, openEffect: false, openCommand: false,
    final: { capture, auditContext: ctx, ticketId: "ticket", ticketFingerprint, audit, hardGate: "passed", warningCount: 0 } };
}
describe("P5-43 finish/stale eligibility, no write or publishing", () => {
  it("P5-50 v3 full finish requires the real final_validate capture and never an audit outcome", async () => {
    const s = snapshot("full");
    const stages: GenerationStage[] = ["input_resolve", "transcript_review", "intent_analysis", "intent_critique",
      "intent_review", "summary", "child_candidates", "adult_candidates", "content_review", "place_child", "place_adult", "final_validate"];
    const completed = prefix(stages);
    s.jobStateVersion = completed.length;
    const last = completed.at(-1)!.evidence;
    last.after.stage = "finish";
    const capture = { ticket: ticket(s), settingsRevision: 1, selectionRevision: 1 };
    const context = requestContext();
    context.authority = structuredClone(s);
    context.authority.jobStateVersion = 0;
    context.authority.status = "dispatch_pending";
    const ticketFingerprint = await fingerprintLifecycleValue(capture.ticket);
    last.context = { contextId: "validation_context", fingerprint: await fingerprintLifecycleValue(context) };
    const final = { kind: "validated" as const, capture, validationContextId: "validation_context", validationContext: context,
      ticketId: "ticket", ticketFingerprint, previewFingerprint: hash, hardGate: "passed" as const };
    const raw = { requestContractVersion: 3, captured: s, current: { outcome: "captured" as const, snapshot: s },
      prefix: completed, openEffect: false, openCommand: false, final };
    expect(await assessGenerationFinish(raw)).toEqual({ outcome: "terminal_candidate", status: "review_ready", stage: "finish" });
    expect((await assessGenerationFinish({ ...raw, final: null })).outcome).not.toBe("terminal_candidate");
    expect((await assessGenerationFinish({ ...raw, openEffect: true })).outcome).not.toBe("terminal_candidate");
    expect((await assessGenerationFinish({ ...raw, openCommand: true })).outcome).not.toBe("terminal_candidate");
    const stale = structuredClone(raw);
    stale.final.capture.selectionRevision++;
    expect((await assessGenerationFinish(stale)).outcome).not.toBe("terminal_candidate");
    const forged = structuredClone(raw);
    forged.prefix.at(-1)!.evidence.context.fingerprint = hash;
    expect((await assessGenerationFinish(forged)).outcome).not.toBe("terminal_candidate");
  });
  it.each([
    ["transcript_correction", ["correction"]], ["summary", ["summary"]], ["child", ["child_candidates"]],
    ["adult", ["adult_candidates"]], ["intent", ["transcript_review", "intent_analysis", "intent_critique", "intent_review"]],
  ] as [GenerationScope, GenerationStage[]][])("P42-21 finishes %s scope only", async (scope, stages) => {
    const s = snapshot(scope);
    expect(await assessGenerationFinish({ captured: s, current: { outcome: "captured", snapshot: s }, prefix: prefix(stages, scope), openEffect: false, openCommand: false, final: null }))
      .toEqual({ outcome: "terminal_candidate", status: "review_ready", stage: "finish" });
  });
  it.each(["effect", "command", "prefix", "changed", "unavailable", "corrupt", "terminal", "overflow"])("P42-20 refuses %s finish", async (kind) => {
    const s = snapshot("summary"), current = structuredClone(s);
    if (kind === "changed") current.metadata.metadataRevision++;
    if (kind === "terminal") { s.status = "review_ready"; current.status = "review_ready"; }
    if (kind === "overflow") { s.jobStateVersion = Number.MAX_SAFE_INTEGER; current.jobStateVersion = Number.MAX_SAFE_INTEGER; }
    const result = await assessGenerationFinish({ captured: s, current: kind === "unavailable" || kind === "corrupt" ? { outcome: kind } : { outcome: "captured", snapshot: current },
      prefix: kind === "prefix" ? [] : prefix(["summary"]), openEffect: kind === "effect", openCommand: kind === "command", final: null });
    expect(result.outcome).not.toBe("terminal_candidate");
  });
  it("full scope requires its entire ordered prefix and preserves original final capture versions", async () => {
    const raw = await finalFinish();
    raw.captured.scope = "full"; raw.captured.jobStateVersion = 13;
    raw.prefix = prefix(["input_resolve", "transcript_review", "intent_analysis", "intent_critique", "intent_review", "summary", "child_candidates", "adult_candidates", "content_review", "place_child", "place_adult", "final_validate", "final_audit"]);
    raw.final.auditContext.authority.scope = "full"; raw.final.auditContext.authority.jobStateVersion = 12;
    raw.final.auditContext.predecessor = { kind: "outcome", eventNo: 13, stateVersion: 12 };
    const ref = { contextId: "full_audit", fingerprint: await fingerprintLifecycleValue(raw.final.auditContext) };
    raw.final.audit.identity.context = ref; raw.final.audit.usage!.context = ref;
    raw.final.audit.identity.event = { eventNo: 14, stateVersion: 13 };
    raw.final.audit.evidence = raw.prefix.at(-1)!.evidence; raw.final.audit.evidence.context = ref;
    expect(await assessGenerationFinish(raw)).toEqual({ outcome: "terminal_candidate", status: "review_ready", stage: "finish" });
    expect(raw.final.capture.ticket.summary.binding.transcript.version).toBe(5);
    raw.prefix[1]!.evidence.reason = "step_succeeded";
    expect(await assessGenerationFinish(raw)).toEqual({ outcome: "corrupt" });
  });
  it("P42-21 content review incomplete ends needs_revision; it does not create a review", async () => {
    const raw = await finalFinish(); content(raw.captured).child!.review = null; raw.prefix = [];
    expect(await assessGenerationFinish(raw)).toEqual({ outcome: "terminal_candidate", status: "needs_revision", stage: "content_review" });
    expect(content(raw.captured).child!.review).toBeNull();
  });
  it.each([0, 5])("final audit with %i warnings keeps warning-only meaning", async (warningCount) => {
    const raw = await finalFinish(); raw.final.warningCount = warningCount;
    expect(await assessGenerationFinish(raw)).toEqual({ outcome: "terminal_candidate", status: "review_ready", stage: "finish" });
    raw.final.hardGate = "unavailable";
    expect(await assessGenerationFinish(raw)).toEqual({ outcome: "not_ready" });
  });
  it.each(["ticket", "capture", "audit", "context", "prefix", "gate"])("refuses changed final %s evidence", async (kind) => {
    const raw = await finalFinish();
    if (kind === "ticket") raw.final.ticketId = "other";
    if (kind === "capture") raw.final.capture.settingsRevision++;
    if (kind === "audit") raw.final.audit.result = null;
    if (kind === "context") raw.final.auditContext.authority.metadata.metadataRevision++;
    if (kind === "prefix") raw.prefix[0]!.evidence.jobId = "foreign";
    if (kind === "gate") raw.final.hardGate = "failed";
    expect(await assessGenerationFinish(raw)).not.toMatchObject({ status: "review_ready" });
  });
  it("stale before/after effect preserves known/unknown usage and never creates a result", () => {
    const s = snapshot(), u = usage();
    const call = { callId: u.callId, jobId: u.jobId, sermonId: u.sermonId, quizSetId: u.quizSetId, stepKey: u.stepKey, attempt: u.attempt, task: u.task, context: u.context, inputFingerprint: u.inputFingerprint };
    expect(assessGenerationStale({ current: s, authority: { outcome: "changed" }, effectStarted: false, observation: absent, call: null })).toEqual({ outcome: "stale_candidate", usage: "none", createResult: false });
    const raw = { current: s, authority: { outcome: "changed" }, effectStarted: true, observation: absent, call };
    expect(assessGenerationStale(raw)).toEqual({ outcome: "stale_candidate", usage: "unknown", createResult: false });
    expect(assessGenerationStale({ ...raw, observation: { outcome: "present", value: u } })).toEqual({ outcome: "stale_candidate", usage: "settle_known", createResult: false });
    expect(assessGenerationStale({ ...raw, authority: { outcome: "unavailable" } })).toEqual({ outcome: "unavailable" });
    expect(assessGenerationStale({ ...raw, observation: { outcome: "present", value: { ...u, callId: "other" } } })).toEqual({ outcome: "conflict" });
    expect(assessGenerationStale({ ...raw, current: { ...s, status: "stale" } })).toEqual({ outcome: "not_ready" });
  });
  it("P42-22 errors/decisions do not return injected private values", async () => {
    const bad = { secret: canary, cause: canary };
    const values = [assessCorrectionConsume(bad), assessHistoricalOutcome(bad), assessUsageObservation(bad), assessLateUsageSettlement(bad),
      await assessDispatchReceive(bad), await assessDispatchRecovery(bad), await assessGenerationFinish(bad), assessGenerationStale(bad)];
    expect(JSON.stringify(values)).not.toContain(canary);
    expect(values.every((v) => v.outcome === "corrupt")).toBe(true);
  });
  it("transition evidence requires exact +1 and only initial event may have null before", () => {
    const e = evidence();
    expect(transitionEvidenceSchema.safeParse(e).success).toBe(true);
    expect(transitionEvidenceSchema.safeParse({ ...e, before: null }).success).toBe(false);
    expect(transitionEvidenceSchema.safeParse({ ...e, after: { ...e.after, stateVersion: e.after.stateVersion + 1 } }).success).toBe(false);
  });
});
