import { describe, expect, it } from "vitest";
import { createGenerationLifecycleStore } from "../_shared/repositories/generation-lifecycle-store";
import { createHumanContentRuntimeStore } from "../_shared/repositories/human-content-runtime-store";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { sha256Bytes } from "../_shared/storage/sha256";
import { assessGenerationFinish } from "../_shared/services/generation-lifecycle";
import { fingerprintLifecycleValue } from "../_shared/services/generation-context-codec";
import type { GenerationContext } from "../_shared/services/generation-lifecycle-contract";
import { generationDb as db, seedGenerationContext } from "./test/generation-storage-fixture";
import { metadataCommand } from "./test/sermon-metadata-fixture";
import { requestContext, usage, now, later } from "./test/generation-lifecycle-fixture";

const lease = "2026-09-17T00:05:00.000Z";
async function fixture(scope: "intent" | "transcript_correction" | "full" = "intent") {
  const owner = await seedGenerationContext(), source = crypto.randomUUID(), confirm = crypto.randomUUID();
  const hash = await sha256Bytes(new TextEncoder().encode("TEST_ONLY_INPUT"));
  const input = createSermonInputStore(db), common = { sermon_id: owner.sermonId, source_type: "caption_plain" as const,
    source_id: source, document_id: source, document_sha256: hash, actor_id: "b".repeat(64) };
  await input.append({ ...common, version: 1, id: source, kind: "source", confirmation_id: null, parent_document_id: null, related_id: null, created_at: now },
    { contractVersion: 1, content: "TEST_ONLY_INPUT" });
  await input.append({ ...common, version: 2, id: confirm, kind: "confirm", confirmation_id: confirm, parent_document_id: source, related_id: null, created_at: now },
    { contractVersion: 1, reviewed: true });
  const c = requestContext(), m = metadataCommand(owner.sermonId), jobId = crypto.randomUUID();
  c.authority = { ...c.authority, ...owner, jobId, scope, content: { state: "absent" }, selection: { state: "unavailable" },
    input: { state: "present", version: 2, sourceId: source, documentId: source, sourceRevision: 1, sourceSha256: hash, documentSha256: hash,
      confirmationId: confirm, sourceKind: "caption", coverage: "full", checksumFormat: "sha256:utf8-working-text:v1" },
    metadata: { contractVersion: 1, sermonId: owner.sermonId, metadataRevision: 1, title: m.title, sermonDate: m.sermonDate, bibleReference: m.bibleReference } };
  const confirmRow = await db.prepare("SELECT payload_sha256 FROM sermon_input_events WHERE sermon_id=? AND id=?").bind(owner.sermonId, confirm).first<{ payload_sha256: string }>();
  c.references = [{ sermonId: owner.sermonId, eventId: source, kind: "input", sha256: hash },
    { sermonId: owner.sermonId, eventId: confirm, kind: "input", sha256: confirmRow!.payload_sha256 }];
  const base = { contextId: crypto.randomUUID(), jobId, ...owner, kind: "request" as const, requestKey: crypto.randomUUID(), createdAt: now,
    stepKey: null, waitGeneration: null, codec: "generation-context-json-utf8-v1" as const };
  return { c, base, store: createGenerationLifecycleStore(db), instance: crypto.randomUUID(), dispatch: crypto.randomUUID() };
}
async function started(scope: "intent" | "transcript_correction" | "full" = "intent") {
  const f = await fixture(scope);
  expect((await f.store.createRequest(f.c, f.base, f.instance, f.dispatch, 2)).outcome).toBe("created");
  expect(await f.store.claimDispatch(f.dispatch, "claim", now, lease)).toEqual({ outcome: "claimed", attempt: 1 });
  expect(await f.store.reserveSend(f.dispatch, 1, "claim", now)).toEqual({ outcome: "reserved" });
  const d = await f.store.readDispatch(f.dispatch); if (d.outcome !== "present") throw new Error("dispatch missing");
  expect(await f.store.receive(f.dispatch, d.value.identity.wire, f.instance, f.c.authority, now)).toEqual({ outcome: "received" });
  return f;
}
async function resumed() {
  const f = await started(), request = { contextId: f.base.contextId, fingerprint: await fingerprintLifecycleValue(f.c) };
  const i = f.c.authority.input; if (i.state !== "present") throw new Error("input missing");
  const c: Extract<GenerationContext, { kind: "wait" }> = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "wait",
    references: f.c.references, request, enter: { eventNo: 3, stateVersion: 2 }, parent: null,
    wait: { contractVersion: 1, jobId: f.base.jobId, sermonId: f.base.sermonId, quizSetId: f.base.quizSetId, kind: "transcript_review", generation: 1,
      jobStateVersion: 2, input: i, content: f.c.authority.content, metadataRevision: 1, selection: { state: "unavailable" }, rootAnalysisId: null } };
  expect(await f.store.enterWait(c, { ...f.base, contextId: crypto.randomUUID(), kind: "wait", waitGeneration: 1 })).toEqual({ outcome: "saved" });
  const current = { ...f.c.authority, status: "awaiting_transcript_review" as const, jobStateVersion: 2, wait: { kind: "transcript_review" as const, generation: 1 } };
  const dispatchId = crypto.randomUUID();
  expect(await f.store.ensureResume(f.base.jobId, current, dispatchId, now)).toEqual({ outcome: "saved", dispatchId });
  expect(await f.store.claimDispatch(dispatchId, "resume", now, lease)).toEqual({ outcome: "claimed", attempt: 1 });
  expect(await f.store.reserveSend(dispatchId, 1, "resume", now)).toEqual({ outcome: "reserved" });
  const d = await f.store.readDispatch(dispatchId); if (d.outcome !== "present") throw new Error("resume missing");
  expect(await f.store.receive(dispatchId, d.value.identity.wire, f.instance, current, now)).toEqual({ outcome: "received" });
  return { ...f, resumeId: dispatchId };
}

async function analysisStep() {
  const f = await resumed(), i = f.c.authority.input;
  if (i.state !== "present") throw new Error("missing input");
  const context: Extract<GenerationContext, {kind: "step"}> = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "step",
    authority: { ...f.c.authority, status: "running", jobStateVersion: 3 }, references: f.c.references,
    request: { contextId: f.base.contextId, fingerprint: await fingerprintLifecycleValue(f.c) }, stepKey: "intent_analysis",
    execution: { task: "intent_analysis", context: { sermonId: f.base.sermonId, binding: { version: 2, sourceId: i.sourceId,
      sourceRevision: i.sourceRevision, sourceSha256: i.sourceSha256, revisionId: i.documentId, transcriptSha256: i.documentSha256,
      checksumFormat: i.checksumFormat, confirmationId: i.confirmationId! } } },
    predecessor: { kind: "wait_consume", eventNo: 4, stateVersion: 3 }, command: null, guidance: null };
  const base = { ...f.base, contextId: crypto.randomUUID(), kind: "step" as const, stepKey: "intent_analysis" };
  expect(await f.store.claimStep(context, base, "step-token", now, lease)).toEqual({ outcome: "claimed", attempt: 1 });
  const u = { ...usage(), jobId: f.base.jobId, sermonId: f.base.sermonId, quizSetId: f.base.quizSetId, stepKey: "intent_analysis", task: "intent_analysis" as const,
    callId: crypto.randomUUID(), usageId: crypto.randomUUID(), context: { contextId: base.contextId, fingerprint: await fingerprintLifecycleValue(context) },
    inputFingerprint: await fingerprintLifecycleValue(context) };
  expect(await f.store.startProviderCall(u.jobId, u.stepKey, 1, "step-token", { id: u.callId, provider: u.provider, model: u.model,
    reasoningEffort: null, providerRequestIdOpaque: null }, now)).toEqual({ outcome: "started" });
  return { ...f, stepContext: context, stepBase: base, u };
}

async function correctionStep() {
  const f = await started("transcript_correction"), i = f.c.authority.input;
  if (i.state !== "present") throw new Error("missing input");
  const c: Extract<GenerationContext, {kind: "step"}> = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "step",
    references: f.c.references, request: { contextId: f.base.contextId, fingerprint: await fingerprintLifecycleValue(f.c) },
    authority: { ...f.c.authority, status: "running", jobStateVersion: 1 }, stepKey: "correction", command: null, guidance: null,
    predecessor: { kind: "request", eventNo: 2, stateVersion: 1 },
    execution: { task: "correction", context: { sermonId: f.base.sermonId, expectedVersion: 2, sourceId: i.sourceId,
      sourceSha256: i.sourceSha256, baseRevisionId: i.documentId, baseTranscriptSha256: i.documentSha256 } } };
  const base = { ...f.base, contextId: crypto.randomUUID(), kind: "step" as const, stepKey: "correction" };
  expect(await f.store.claimStep(c, base, "step-token", now, lease)).toEqual({ outcome: "claimed", attempt: 1 });
  const u = { ...usage(), jobId: f.base.jobId, sermonId: f.base.sermonId, quizSetId: f.base.quizSetId, stepKey: "correction", task: "correction" as const,
    callId: crypto.randomUUID(), usageId: crypto.randomUUID(), context: { contextId: base.contextId, fingerprint: await fingerprintLifecycleValue(c) },
    inputFingerprint: await fingerprintLifecycleValue(c) };
  expect(await f.store.startProviderCall(u.jobId, u.stepKey, 1, "step-token", { id: u.callId, provider: u.provider, model: u.model,
    reasoningEffort: null, providerRequestIdOpaque: null }, now)).toEqual({ outcome: "started" });
  expect(await f.store.observeUsage(u)).toEqual({ outcome: "saved" });
  return { ...f, stepContext: c, stepBase: base, u };
}
function withBatch(batch: D1Database["batch"]) {
  const wrapped = Object.create(db) as D1Database;
  wrapped.batch = batch; wrapped.prepare = db.prepare.bind(db);
  return createGenerationLifecycleStore(wrapped);
}
async function commandFixture(consume = true) {
  const f = await started("full"), request = { contextId: f.base.contextId, fingerprint: await fingerprintLifecycleValue(f.c) };
  expect(await f.store.advance(f.base.jobId, f.base.contextId, "transcript_review", now)).toEqual({ outcome: "saved" });
  const i = f.c.authority.input; if (i.state !== "present") throw new Error("input missing");
  const waiting: Extract<GenerationContext, {kind: "wait"}> = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "wait",
    references: f.c.references, request, enter: { eventNo: 4, stateVersion: 3 }, parent: null,
    wait: { contractVersion: 1, jobId: f.base.jobId, sermonId: f.base.sermonId, quizSetId: f.base.quizSetId, kind: "transcript_review", generation: 1,
      jobStateVersion: 3, input: i, content: f.c.authority.content, metadataRevision: 1, selection: { state: "unavailable" }, rootAnalysisId: null } };
  expect(await f.store.enterWait(waiting, { ...f.base, contextId: crypto.randomUUID(), kind: "wait", waitGeneration: 1 })).toEqual({ outcome: "saved" });
  const authority = { ...f.c.authority, status: "awaiting_transcript_review" as const, jobStateVersion: 3, wait: { kind: "transcript_review" as const, generation: 1 } };
  const resumeId = crypto.randomUUID();
  expect(await f.store.ensureResume(f.base.jobId, authority, resumeId, now)).toEqual({ outcome: "saved", dispatchId: resumeId });
  const command = { key: crypto.randomUUID(), ordinal: 1, waitGeneration: 1 };
  const context: Extract<GenerationContext, {kind: "step"}> = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "step", references: f.c.references, request,
    authority: { ...f.c.authority, status: "running", jobStateVersion: 4 }, stepKey: "correction_1", command, guidance: null,
    predecessor: { kind: "wait_consume", eventNo: 5, stateVersion: 4 },
    execution: { task: "correction", context: { sermonId: f.base.sermonId, expectedVersion: 2, sourceId: i.sourceId,
      sourceSha256: i.sourceSha256, baseRevisionId: i.documentId, baseTranscriptSha256: i.documentSha256 } } };
  const base = { ...f.base, contextId: crypto.randomUUID(), kind: "step" as const, stepKey: "correction_1" }, id = crypto.randomUUID();
  expect(await f.store.registerCorrection(context, base, authority, "b".repeat(64), id)).toEqual({ outcome: "saved" });
  expect(await f.store.registerCorrection(context, base, authority, "b".repeat(64), id)).toEqual({ outcome: "replayed" });
  if (consume) {
    expect(await f.store.claimDispatch(id, "command-token", now, lease)).toEqual({ outcome: "claimed", attempt: 1 });
    expect(await f.store.reserveSend(id, 1, "command-token", now)).toEqual({ outcome: "reserved" });
    const d = await f.store.readDispatch(id); if (d.outcome !== "present") throw new Error("command dispatch missing");
    expect(await f.store.receive(id, d.value.identity.wire, f.instance, authority, now)).toEqual({ outcome: "received" });
  }
  return { ...f, commandContext: context, commandBase: base, waiting, resumeId };
}

function withReadMutation(mutate: (query: string, rows: Record<string, unknown>[]) => void) {
  const wrapped = Object.create(db) as D1Database;
  wrapped.prepare = query => {
    function wrap(statement: D1PreparedStatement): D1PreparedStatement {
      return new Proxy(statement, { get(target, property) {
        if (property === "bind") return (...values: unknown[]) => wrap(target.bind(...values));
        if (property === "all") return async () => {
          const result = await target.all<Record<string, unknown>>();
          mutate(query, result.results); return result;
        };
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    }
    return wrap(db.prepare(query));
  };
  return createGenerationLifecycleStore(wrapped);
}

describe("P5-45 private lifecycle storage on disposable 0013 D1", () => {
  it("stores canonical original context and replays the request without adopting newer state", async () => {
    const f = await started();
    expect((await f.store.createRequest(f.c, f.base, f.instance, f.dispatch, 2)).outcome).toBe("replayed");
    const read = await f.store.readContext(f.base.contextId);
    expect(read.outcome).toBe("present");
    if (read.outcome === "present") expect(read.value.context).toEqual(f.c);
    await expect(f.store.createRequest({ ...f.c, actorDigest: "f".repeat(64) }, f.base, f.instance, f.dispatch, 2)).rejects.toThrow("CONFLICT");
    expect((await db.prepare("SELECT count(*) AS n FROM generation_jobs WHERE id=?").bind(f.base.jobId).first<{n:number}>())!.n).toBe(1);
  });
  it("reproduces stored resume after-stage versus completed wait prefix without rewriting evidence", async () => {
    const f = await resumed(), read = await f.store.readReceiver(f.resumeId);
    expect(read.outcome).toBe("present"); if (read.outcome !== "present") return;
    const e = read.value.evidence;
    expect(e.before?.stage).toBe("transcript_review"); expect(e.after.stage).toBe("intent_analysis");
    const captured = { ...f.c.authority, status: "running", jobStateVersion: 3 };
    // A valid partial prefix is not complete yet; it must not be classified as corrupt.
    expect(await assessGenerationFinish({ captured, current: { outcome: "captured", snapshot: captured },
      prefix: [{ stage: "transcript_review", evidence: e }], openEffect: false, openCommand: false, final: null })).toEqual({ outcome: "not_ready" });
    expect((await db.prepare("SELECT after_stage FROM generation_transition_evidence WHERE job_id=? AND event_no=4").bind(f.base.jobId).first<{after_stage:string}>())!.after_stage).toBe("intent_analysis");
  });
  it("only one concurrent dispatch claim wins and a send marker never grants a second send", async () => {
    const f = await fixture(); await f.store.createRequest(f.c, f.base, f.instance, f.dispatch, 2);
    const results = await Promise.all([f.store.claimDispatch(f.dispatch, "one", now, lease), f.store.claimDispatch(f.dispatch, "two", now, lease)]);
    expect(results.filter(r => r.outcome === "claimed")).toHaveLength(1);
    const a = await db.prepare("SELECT claim_token FROM generation_dispatch_attempts WHERE dispatch_id=?").bind(f.dispatch).first<{claim_token:string}>();
    expect(await f.store.reserveSend(f.dispatch, 1, a!.claim_token, now)).toEqual({ outcome: "reserved" });
    expect(await f.store.reserveSend(f.dispatch, 1, a!.claim_token, now)).toEqual({ outcome: "uncertain" });
    expect(await f.store.claimDispatch(f.dispatch, "new", lease, "2026-09-17T00:10:00.000Z")).toEqual({ outcome: "uncertain" });
  });
  it("reclaims an expired never-sent attempt and fences its old token", async () => {
    const f = await fixture(); await f.store.createRequest(f.c, f.base, f.instance, f.dispatch, 2);
    await f.store.claimDispatch(f.dispatch, "old", now, later);
    expect(await f.store.claimDispatch(f.dispatch, "new", later, lease)).toEqual({ outcome: "claimed", attempt: 2 });
    expect(await f.store.reserveSend(f.dispatch, 1, "old", later)).toEqual({ outcome: "uncertain" });
    expect(await f.store.reserveSend(f.dispatch, 2, "new", later)).toEqual({ outcome: "reserved" });
  });
  it("distinguishes missing from failed reads without exposing private exception text", async () => {
    const f = await started();
    expect(await f.store.readContext("missing")).toEqual({ outcome: "absent" });
    const broken = Object.create(db) as D1Database;
    broken.prepare = () => { throw new Error("TEST_ONLY_PRIVATE_FAILURE"); };
    expect(await createGenerationLifecycleStore(broken).readContext(f.base.contextId)).toEqual({ outcome: "unavailable" });
  });
  it("atomically stores synthetic content, exact nullable usage, outcome and its own historical proof", async () => {
    const f = await analysisStep();
    expect(await f.store.observeUsage(f.u)).toEqual({ outcome: "saved" });
    const command = { jobId: f.base.jobId, stepKey: "intent_analysis", attempt: 1, token: "step-token", now: later,
      outcome: "success" as const, callId: f.u.callId, usage: f.u, result: { id: crypto.randomUUID(), actorDigest: null, payload: { synthetic: true } } };
    const saved = await f.store.commitOutcome(command);
    expect(saved.outcome).toBe("saved");
    expect((await f.store.commitOutcome(command)).outcome).toBe("replayed");
    expect((await f.store.readOutcome(command.jobId, command.stepKey, 1)).outcome).toBe("present");
    if ("proof" in saved) {
      expect(await f.store.probeOutcome(saved.proof)).toEqual({ outcome: "exact" });
      expect(await f.store.probeOutcome({ ...saved.proof, usage: { ...f.u, cachedInputTokens: 0 } })).toEqual({ outcome: "conflict" });
    }
  });
  it("keeps unknown usage uncertain and late settlement cannot turn it into success", async () => {
    const f = await analysisStep();
    const saved = await f.store.commitOutcome({ jobId: f.base.jobId, stepKey: "intent_analysis", attempt: 1, token: "step-token", now: later,
      outcome: "uncertain", callId: f.u.callId, usage: null, result: null });
    expect(saved.outcome).toBe("saved");
    expect(await f.store.observeUsage(f.u)).toEqual({ outcome: "saved" });
    expect(await f.store.settleLateUsage(f.u, later)).toEqual({ outcome: "saved" });
    expect(await f.store.settleLateUsage(f.u, later)).toEqual({ outcome: "replayed" });
    if ("proof" in saved) expect(await f.store.probeOutcome(saved.proof)).toEqual({ outcome: "exact" });
    expect((await f.store.claimStep(f.stepContext, f.stepBase, "new", later, lease)).outcome).toBe("uncertain");
  });

  it("finishes standalone correction only from its own result, then replays historical proof after terminal", async () => {
    const f = await correctionStep();
    const saved = await f.store.commitOutcome({ jobId: f.base.jobId, stepKey: "correction", attempt: 1, token: "step-token", now: later,
      outcome: "success", callId: f.u.callId, usage: f.u, result: { id: crypto.randomUUID(), actorDigest: "b".repeat(64), payload: { synthetic: "가".repeat(6000) } } });
    expect(saved.outcome).toBe("saved");
    const i = f.c.authority.input; if (i.state !== "present") throw new Error("input missing");
    const current = { ...f.c.authority, status: "running" as const, jobStateVersion: 2, input: { ...i, version: 3 } };
    expect(await f.store.finish(current, later)).toEqual({ outcome: "saved" });
    expect(await f.store.finish(current, later)).toEqual({ outcome: "replayed" });
    if ("proof" in saved) expect(await f.store.probeOutcome(saved.proof)).toEqual({ outcome: "exact" });
  });
  it.each(["throw", "malformed"])("recovers exact own outcome after a %s batch response", async mode => {
    const f = await analysisStep(); await f.store.observeUsage(f.u);
    const store = withBatch(async <T>(statements: D1PreparedStatement[]) => {
      const results = await db.batch<T>(statements);
      if (mode === "throw") throw new Error("TEST_ONLY_RESPONSE_LOST");
      return results.map(r => ({ ...r, meta: { ...r.meta, changes: 0 } }));
    });
    const r = await store.commitOutcome({ jobId: f.base.jobId, stepKey: "intent_analysis", attempt: 1, token: "step-token", now: later,
      outcome: "success", callId: f.u.callId, usage: f.u, result: { id: crypto.randomUUID(), actorDigest: null, payload: { synthetic: true } } });
    expect(r.outcome).toBe("replayed");
  });
  it("closes stale waiting work once and rejects finish gates reserved for G03", async () => {
    const f = await started();
    expect(await f.store.markStale(f.base.jobId, 1, f.base.contextId, later)).toEqual({ outcome: "saved" });
    expect(await f.store.markStale(f.base.jobId, 1, f.base.contextId, later)).toEqual({ outcome: "replayed" });
    const full = await fixture("full");
    expect(await full.store.finish(full.c.authority, now)).toEqual({ outcome: "not_ready" });
  });
  it("P5-50 creates v3 without an audit scope and keeps full finish closed without validation proof", async () => {
    const f = await fixture("full");
    expect((await f.store.createRequest(f.c, f.base, f.instance, f.dispatch)).outcome).toBe("created");
    const job = await f.store.readJob(f.base.jobId);
    expect(job.outcome).toBe("present");
    if (job.outcome === "present") {
      expect(job.value.request_contract_version).toBe(2);
      expect(job.value.execution_contract_version).toBe(3);
    }
    const marker = await db.prepare("SELECT request_context_id FROM generation_full_v3_requests WHERE job_id=?")
      .bind(f.base.jobId).first<{ request_context_id: string }>();
    expect(marker?.request_context_id).toBe(f.base.contextId);
    expect((await f.store.createRequest(f.c, f.base, f.instance, f.dispatch)).outcome).toBe("replayed");
    await expect(db.prepare("UPDATE generation_full_v3_requests SET created_at=? WHERE job_id=?")
      .bind(later, f.base.jobId).run()).rejects.toThrow();
    expect(await f.store.finish(f.c.authority, now)).toEqual({ outcome: "not_ready" });
    const legacy = await fixture("full");
    expect((await legacy.store.createRequest(legacy.c, legacy.base, legacy.instance, legacy.dispatch, 2)).outcome).toBe("created");
    await expect(db.prepare("INSERT INTO generation_full_v3_requests(job_id,request_context_id,created_at) VALUES(?,?,?)")
      .bind(legacy.base.jobId, legacy.base.contextId, now).run()).rejects.toThrow();
    const audit = await fixture("full");
    audit.c.authority.scope = "final_audit";
    await expect(audit.store.createRequest(audit.c, audit.base, audit.instance, audit.dispatch)).rejects.toThrow("INVALID");
  });

  it("consumes a correction command, retires the old resume and atomically creates its next wait", async () => {
    const f = await commandFixture();
    expect(await f.store.claimStep(f.commandContext, f.commandBase, "step-token", now, lease)).toEqual({ outcome: "claimed", attempt: 1 });
    const fingerprint = await fingerprintLifecycleValue(f.commandContext);
    const u = { ...usage(), jobId: f.base.jobId, sermonId: f.base.sermonId, quizSetId: f.base.quizSetId, stepKey: "correction_1", task: "correction" as const,
      callId: crypto.randomUUID(), usageId: crypto.randomUUID(), context: { contextId: f.commandBase.contextId, fingerprint }, inputFingerprint: fingerprint };
    expect(await f.store.startProviderCall(u.jobId, u.stepKey, 1, "step-token", { id: u.callId, provider: u.provider, model: u.model, reasoningEffort: null, providerRequestIdOpaque: null }, now)).toEqual({ outcome: "started" });
    expect(await f.store.observeUsage(u)).toEqual({ outcome: "saved" });
    const nextWait = { ...f.waiting, enter: { eventNo: 6, stateVersion: 5 },
      parent: { waitGeneration: 1, commandKey: f.commandContext.command!.key, outcome: { eventNo: 6, stateVersion: 5 } },
      wait: { ...f.waiting.wait, generation: 2, jobStateVersion: 5, input: { ...f.waiting.wait.input, version: 3 } } };
    const saved = await f.store.commitOutcome({ jobId: u.jobId, stepKey: u.stepKey, attempt: 1, token: "step-token", now: later, outcome: "success", callId: u.callId, usage: u,
      result: { id: crypto.randomUUID(), actorDigest: "b".repeat(64), payload: { synthetic: true } },
      rewait: { context: nextWait, base: { ...f.base, contextId: crypto.randomUUID(), kind: "wait", waitGeneration: 2 } } });
    expect(saved.outcome).toBe("saved");
    if ("proof" in saved) expect(await f.store.probeOutcome(saved.proof)).toEqual({ outcome: "exact" });
    const j = await f.store.readJob(f.base.jobId); expect(j.outcome).toBe("present");
    if (j.outcome === "present") expect(j.value).toMatchObject({ status: "awaiting_transcript_review", active_wait_generation: 2 });
    const resume = await f.store.readDispatch(f.resumeId);
    if (resume.outcome === "present") expect(resume.value.row.state).toBe("stale"); else throw new Error("missing resume");
  });
  it.each([false, true])("rejects a superseded command before any effect (consumed=%s) with a new wait", async consume => {
    const f = await commandFixture(consume), old = f.waiting.wait.input, confirmation = crypto.randomUUID();
    await createSermonInputStore(db).append({ sermon_id: f.base.sermonId, version: 3, id: confirmation, kind: "confirm", source_type: "caption_plain",
      source_id: old.sourceId, document_id: old.documentId, document_sha256: old.documentSha256, confirmation_id: confirmation,
      parent_document_id: old.documentId, related_id: null, actor_id: "b".repeat(64), created_at: later }, { contractVersion: 1, reviewed: true });
    const payload = await db.prepare("SELECT payload_sha256 FROM sermon_input_events WHERE sermon_id=? AND id=?").bind(f.base.sermonId, confirmation).first<{payload_sha256:string}>();
    const enter = { eventNo: consume ? 6 : 5, stateVersion: consume ? 5 : 4 };
    const next = { ...f.waiting, enter, references: [...f.waiting.references, { kind: "input" as const, eventId: confirmation, sermonId: f.base.sermonId, sha256: payload!.payload_sha256 }],
      parent: { waitGeneration: 1, commandKey: f.commandContext.command!.key, outcome: enter },
      wait: { ...f.waiting.wait, generation: 2, jobStateVersion: enter.stateVersion, input: { ...old, version: 3, confirmationId: confirmation } } };
    const base = { ...f.base, contextId: crypto.randomUUID(), kind: "wait" as const, waitGeneration: 2 };
    expect(await f.store.rejectCorrection(next, base)).toEqual({ outcome: "saved" });
    expect(await f.store.rejectCorrection(next, base)).toEqual({ outcome: "replayed" });
    expect((await f.store.readContext(base.contextId)).outcome).toBe("present");
  });
  it("rolls back every omitted member of a result transaction, including deferred event/usage links", async () => {
    const f = await analysisStep(); await f.store.observeUsage(f.u);
    let plan: D1PreparedStatement[] = [];
    const capture = withBatch(async statements => { plan = statements; throw new Error("TEST_ONLY_CAPTURE"); });
    const cmd = { jobId: f.base.jobId, stepKey: "intent_analysis", attempt: 1, token: "step-token", now: later,
      outcome: "success" as const, callId: f.u.callId, usage: f.u, result: { id: crypto.randomUUID(), actorDigest: null, payload: { synthetic: "가".repeat(23000) } } };
    expect((await capture.commitOutcome(cmd)).outcome).toBe("uncertain");
    const tables = await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{name:string}>();
    const snapshot = async () => (await db.batch(tables.results.map(t => db.prepare(`SELECT * FROM "${t.name}"`)))).map(r => r.results);
    const before = await snapshot();
    expect(plan.length).toBeGreaterThan(10);
    // Index 0 is the read-only authority assertion; all remaining members are required writes.
    for (let index = 1; index < plan.length; index++) {
      await expect(db.batch(plan.filter((_, n) => n !== index)), `omitted member ${index}`).rejects.toThrow();
      expect(await snapshot(), `rollback member ${index}`).toEqual(before);
    }
    expect((await f.store.commitOutcome(cmd)).outcome).toBe("saved");
  });
  it("checks authority inside the result transaction when it changes after preflight", async () => {
    const f = await analysisStep(); await f.store.observeUsage(f.u);
    const store = withBatch(async <T>(statements: D1PreparedStatement[]) => {
      await db.prepare("UPDATE sermon_metadata_drafts SET metadata_revision=metadata_revision+1 WHERE sermon_id=?").bind(f.base.sermonId).run();
      return db.batch<T>(statements);
    });
    const r = await store.commitOutcome({ jobId: f.base.jobId, stepKey: "intent_analysis", attempt: 1, token: "step-token", now: later,
      outcome: "success", callId: f.u.callId, usage: f.u, result: { id: crypto.randomUUID(), actorDigest: null, payload: { synthetic: true } } });
    expect(r.outcome).toBe("uncertain");
    expect(await f.store.readOutcome(f.base.jobId, "intent_analysis", 1)).toEqual({ outcome: "absent" });
    expect((await f.store.readContext(f.stepBase.contextId)).outcome).toBe("present");
    expect((await db.prepare("SELECT state FROM ai_provider_calls WHERE id=?").bind(f.u.callId).first<{state:string}>())!.state).toBe("effect_started");
  });
  it.each(["rejected", "stale"] as const)("settles known usage on %s without writing content", async failure => {
    const f = await analysisStep(); await f.store.observeUsage(f.u);
    if (failure === "stale") await db.prepare("UPDATE sermon_metadata_drafts SET metadata_revision=2 WHERE sermon_id=?").bind(f.base.sermonId).run();
    const r = await f.store.commitOutcome({ jobId: f.base.jobId, stepKey: "intent_analysis", attempt: 1, token: "step-token", now: later,
      outcome: failure, callId: f.u.callId, usage: f.u, result: null });
    expect(r.outcome).toBe("saved");
    if ("proof" in r) expect(await f.store.probeOutcome(r.proof)).toEqual({ outcome: "exact" });
    expect((await db.prepare("SELECT count(*) AS n FROM sermon_content_events WHERE sermon_id=?").bind(f.base.sermonId).first<{n:number}>())!.n).toBe(0);
  });

  it.each(["bytes", "digest", "projection", "owner", "references", "count"])("rejects corrupted stored context %s without returning private data", async field => {
    const f = await started(); let chunkRead = false;
    const store = withReadMutation((q, rows) => {
      if (q.includes("SELECT * FROM generation_contexts") && rows[0]) {
        if (field === "digest") rows[0].fingerprint = "f".repeat(64);
        if (field === "projection") rows[0].input_version = 99;
        if (field === "owner") rows[0].sermon_id = "other";
        if (field === "count") rows[0].byte_length = 1000000;
      }
      if (q.includes("FROM generation_context_chunks")) {
        chunkRead = true;
        if (field === "bytes" && rows[0]) rows[0].body_hex = "7B7D";
      }
      if (field === "references" && q.includes("AS payload_digest") && rows[0]) { rows[0].digest = "f".repeat(64); rows[0].payload_digest = "f".repeat(64); }
    });
    expect(await store.readContext(f.base.contextId)).toEqual({ outcome: field === "count" ? "limit" : "corrupt" });
    if (field === "count") expect(chunkRead).toBe(false);
  });
  it("rejects changed nullable settled usage, and never uses a later job event as own outcome proof", async () => {
    const f = await analysisStep(); await f.store.observeUsage(f.u);
    const saved = await f.store.commitOutcome({ jobId: f.base.jobId, stepKey: "intent_analysis", attempt: 1, token: "step-token", now: later,
      outcome: "success", callId: f.u.callId, usage: f.u, result: { id: crypto.randomUUID(), actorDigest: null, payload: { synthetic: true } } });
    expect(saved.outcome).toBe("saved");
    expect(await f.store.advance(f.base.jobId, f.stepBase.contextId, "intent_critique", later)).toEqual({ outcome: "saved" });
    if ("proof" in saved) expect(await f.store.probeOutcome(saved.proof)).toEqual({ outcome: "exact" });
    const broken = withReadMutation((q, rows) => { if (q.includes("FROM ai_usage_events") && rows[0]) rows[0].cached_input_tokens = 0; });
    expect(await broken.readOutcome(f.base.jobId, "intent_analysis", 1)).toEqual({ outcome: "corrupt" });
    const receipt = withReadMutation((q, rows) => { if (q.includes("SELECT * FROM generation_step_receipts") && rows[0]) rows[0].metadata_revision = 99; });
    expect(await receipt.readOutcome(f.base.jobId, "intent_analysis", 1)).toEqual({ outcome: "corrupt" });
  });
  it("reclaims only an expired pure step and fences its old attempt and token", async () => {
    const f = await started("full");
    const context: Extract<GenerationContext, {kind: "step"}> = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "step",
      references: f.c.references, request: { contextId: f.base.contextId, fingerprint: await fingerprintLifecycleValue(f.c) },
      authority: { ...f.c.authority, status: "running", jobStateVersion: 1 }, stepKey: "input_resolve", execution: { task: "input_resolve", context: null },
      predecessor: { kind: "request", eventNo: 2, stateVersion: 1 }, command: null, guidance: null };
    expect(await f.store.claimStep(context, { ...f.base, contextId: crypto.randomUUID(), kind: "step", stepKey: "input_resolve" }, "old", now, later)).toEqual({ outcome: "claimed", attempt: 1 });
    expect(await f.store.reclaimStep(f.base.jobId, "input_resolve", 1, "early", now, lease)).toEqual({ outcome: "busy" });
    expect(await f.store.reclaimStep(f.base.jobId, "input_resolve", 1, "new", later, lease)).toEqual({ outcome: "claimed" });
    await expect(f.store.commitOutcome({ jobId: f.base.jobId, stepKey: "input_resolve", attempt: 1, token: "old", now: later, outcome: "stale", callId: null, usage: null, result: null })).rejects.toThrow("CONFLICT");
    expect((await f.store.commitOutcome({ jobId: f.base.jobId, stepKey: "input_resolve", attempt: 2, token: "new", now: later, outcome: "stale", callId: null, usage: null, result: null })).outcome).toBe("saved");
  });
  it("finishes intent through stored analysis, critique, human confirmation and actual intent-resume evidence", async () => {
    const f = await analysisStep(), analysisId = crypto.randomUUID(), critiqueId = crypto.randomUUID(), confirmId = crypto.randomUUID();
    await f.store.observeUsage(f.u);
    const first = await f.store.commitOutcome({ jobId: f.base.jobId, stepKey: "intent_analysis", attempt: 1, token: "step-token", now: later,
      outcome: "success", callId: f.u.callId, usage: f.u, result: { id: analysisId, actorDigest: null, payload: { synthetic: true } } });
    expect(first.outcome).toBe("saved"); if (!("proof" in first) || !first.proof.result || f.stepContext.execution.task !== "intent_analysis") throw new Error("analysis missing");
    expect(await f.store.advance(f.base.jobId, f.stepBase.contextId, "intent_critique", later)).toEqual({ outcome: "saved" });
    expect(await f.store.advance(f.base.jobId, f.stepBase.contextId, "intent_critique", later)).toEqual({ outcome: "replayed" });
    const content = { state: "present" as const, eventCount: 1, lastEventId: analysisId,
      intent: { selectedId: analysisId, rootAnalysisId: analysisId, binding: f.stepContext.execution.context.binding, critique: null, confirmation: null },
      summary: null, child: null, adult: null };
    const refs = [...f.c.references, { sermonId: f.base.sermonId, eventId: analysisId, kind: "content" as const, sha256: first.proof.result.fingerprint }];
    const c: Extract<GenerationContext, {kind: "step"}> = { ...f.stepContext, references: refs,
      authority: { ...f.stepContext.authority, jobStateVersion: 5, content }, stepKey: "intent_critique",
      predecessor: { kind: "outcome", eventNo: 6, stateVersion: 5 }, execution: { task: "intent_critique", context: {
        ...f.stepContext.execution.context, baseAnalysisId: analysisId, binding: { ...f.stepContext.execution.context.binding, version: 3 } } } };
    const base = { ...f.stepBase, contextId: crypto.randomUUID(), stepKey: "intent_critique" };
    expect(await f.store.claimStep(c, base, "critique", later, lease)).toEqual({ outcome: "claimed", attempt: 1 });
    const fingerprint = await fingerprintLifecycleValue(c), u = { ...f.u, stepKey: "intent_critique", task: "intent_critique" as const,
      context: { contextId: base.contextId, fingerprint }, inputFingerprint: fingerprint, callId: crypto.randomUUID(), usageId: crypto.randomUUID(), startedAt: later };
    expect(await f.store.startProviderCall(u.jobId, u.stepKey, 1, "critique", { id: u.callId, provider: u.provider, model: u.model,
      reasoningEffort: null, providerRequestIdOpaque: null }, later)).toEqual({ outcome: "started" });
    await f.store.observeUsage(u);
    const second = await f.store.commitOutcome({ jobId: u.jobId, stepKey: u.stepKey, attempt: 1, token: "critique", now: later,
      outcome: "success", callId: u.callId, usage: u, result: { id: critiqueId, actorDigest: null, payload: { synthetic: true } } });
    expect(second.outcome).toBe("saved"); if (!("proof" in second) || !second.proof.result) throw new Error("critique missing");
    const input = c.authority.input; if (input.state !== "present") throw new Error("input missing");
    const human = await createHumanContentRuntimeStore(db).appendHuman({ sermonId: f.base.sermonId, eventId: confirmId, commandKey: crypto.randomUUID(), actorId: "b".repeat(64), createdAt: later,
      expectedInput: { version: input.version, sourceId: input.sourceId, documentId: input.documentId, documentSha256: input.documentSha256, confirmationId: input.confirmationId },
      expectedCurrent: { eventCount: 2, lastEventId: critiqueId, selectedAnalysisEventId: analysisId, intentCritiqueEventId: critiqueId, intentConfirmationEventId: null,
        summarySnapshotEventId: null, summaryReviewEventId: null, childPoolEventId: null, childReviewEventId: null, adultPoolEventId: null, adultReviewEventId: null },
      operation: "intent_confirm", difficulty: null, baseSnapshotEventId: null, targetSnapshotEventId: analysisId, restoreSourceEventId: null, critiqueEventId: critiqueId,
      intentConfirmationEventId: null, expectedCurrentReviewEventId: null, payload: { contractVersion: 1, operation: "intent_confirm", command: { targetEventId: analysisId }, materializedSnapshot: null } });
    expect(human.outcome).toBe("saved");
    const hash = (await db.prepare("SELECT payload_sha256 FROM sermon_content_events WHERE sermon_id=? AND event_id=?").bind(f.base.sermonId, confirmId).first<{payload_sha256:string}>())!.payload_sha256;
    const currentContent = { ...content, eventCount: 3, lastEventId: confirmId, intent: { ...content.intent,
      critique: { id: critiqueId, rootAnalysisId: analysisId }, confirmation: { id: confirmId, targetId: analysisId, critiqueId, origin: "human" as const } } };
    const wait: Extract<GenerationContext, {kind: "wait"}> = { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "wait", request: c.request,
      references: [...refs, { sermonId: f.base.sermonId, eventId: critiqueId, kind: "content", sha256: second.proof.result.fingerprint }, { sermonId: f.base.sermonId, eventId: confirmId, kind: "content", sha256: hash }],
      enter: { eventNo: 8, stateVersion: 7 }, parent: null, wait: { contractVersion: 1, jobId: u.jobId, sermonId: u.sermonId, quizSetId: u.quizSetId,
        kind: "intent_review", generation: 2, jobStateVersion: 7, input, content: currentContent, metadataRevision: 1, selection: c.authority.selection, rootAnalysisId: analysisId } };
    expect(await f.store.enterWait(wait, { ...f.base, contextId: crypto.randomUUID(), kind: "wait", waitGeneration: 2 })).toEqual({ outcome: "saved" });
    const authority = { ...c.authority, content: currentContent, status: "awaiting_intent_review" as const, jobStateVersion: 7, wait: { kind: "intent_review" as const, generation: 2 } };
    const id = crypto.randomUUID(); expect(await f.store.ensureResume(u.jobId, authority, id, later)).toEqual({ outcome: "saved", dispatchId: id });
    await f.store.claimDispatch(id, "last", later, lease); await f.store.reserveSend(id, 1, "last", later);
    const dispatch = await f.store.readDispatch(id); if (dispatch.outcome !== "present") throw new Error("dispatch missing");
    expect(await f.store.receive(id, dispatch.value.identity.wire, f.instance, authority, later)).toEqual({ outcome: "received" });
    const receipt = await f.store.readReceiver(id); if (receipt.outcome !== "present") throw new Error("receipt missing");
    expect(receipt.value.evidence.before?.stage).toBe("intent_review"); expect(receipt.value.evidence.after.stage).toBe("finish");
    expect(await f.store.finish({ ...authority, status: "running", jobStateVersion: 8, wait: null }, later)).toEqual({ outcome: "saved" });
    expect(await f.store.probeOutcome(first.proof)).toEqual({ outcome: "exact" });
  });

});
