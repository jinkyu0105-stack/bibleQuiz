import { describe, expect, it, vi } from "vitest";
import { generationDb as db, seedGenerationContext } from "./test/generation-storage-fixture";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { createGenerationLifecycleStore } from "../_shared/repositories/generation-lifecycle-store";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { hash } from "../_shared/services/transcript-content";
import { requestCorrection, sendContentDispatch, runContentGeneration } from "../_shared/services/content-generation";
const actor = "a".repeat(64);
async function fixture(text = "하나님 사랑") {
  const owner = await seedGenerationContext();
  const service = createSermonInputService(createSermonInputStore(db));
  const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript",
    sourceCoverage: "full_transcript", rawTranscriptText: text });
  if (source.outcome !== "validated") throw new Error("fixture source");
  const imported = await service.importPreparedManual(owner.sermonId, 0, source.source,
    { adminId: actor, kind: "human", now: new Date().toISOString() });
  expect(imported.outcome).toBe("saved");
  const command = { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId, expectedInputVersion: 1 };
  const requested = await requestCorrection(db, owner.sermonId, command, actor);
  const create = vi.fn(async () => ({ id: requested.jobId }));
  expect((await sendContentDispatch(db, { create } as never, requested.dispatchId)).outcome).toBe("sent");
  return { ...owner, service, command, requested, create };
}
const complete = (draft: unknown, extra: Record<string, unknown> = {}) => Response.json({
  id: "response-synthetic", model: "gpt-5.6-terra", status: "completed",
  usage: { input_tokens: 100, output_tokens: 30, input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 10 } },
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft }) }] }], ...extra,
});
const bindings = { DB: db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic-key" };
async function execute(f: Awaited<ReturnType<typeof fixture>>, response: () => Promise<Response>) {
  return runContentGeneration(bindings, { dispatchId: f.requested.dispatchId }, f.requested.jobId, { fetch: response });
}
describe("Content Workflow correction / real D1 and mocked HTTP", () => {
  it("stores document and usage atomically, finishes, and replays without another call", async () => {
    const f = await fixture();
    const fetcher = vi.fn(async () => complete({ format: "plain_text", text: "하나님의 사랑" }));
    const result = await execute(f, fetcher);
    expect(result.outcome).toBe("saved");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const current = await f.service.current(f.sermonId);
    expect(current.outcome === "loaded" && current.input?.content).toEqual({ format: "plain_text", text: "하나님 사랑" });
    const proposal = await createSermonInputStore(db).event(f.sermonId, `proposal-${f.requested.jobId}`);
    expect(proposal?.kind).toBe("proposal");
    expect(await createSermonInputStore(db).payload(proposal!)).toMatchObject({ kind: "correction_document_v1", content: { text: "하나님의 사랑" } });
    const usage = await db.prepare("SELECT input_tokens,output_tokens,estimated_cost_micro_usd FROM ai_usage_events WHERE generation_job_id=?")
      .bind(f.requested.jobId).first();
    expect(usage).toEqual({ input_tokens: 100, output_tokens: 30, estimated_cost_micro_usd: 524 });
    expect((await execute(f, fetcher)).outcome).toBe("replayed");
    expect((await requestCorrection(db, f.sermonId, f.command, actor)).outcome).toBe("replayed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves usage for malformed generated content without modifying the input", async () => {
    const f = await fixture(), fetcher = vi.fn(async () => complete({ format: "plain_text", text: "" }));
    expect((await execute(f, fetcher)).outcome).toBe("rejected");
    expect((await execute(f, fetcher)).outcome).toBe("failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await db.prepare("SELECT count(*) n FROM ai_usage_observations WHERE job_id=?").bind(f.requested.jobId).first()).toEqual({ n: 1 });
    expect((await createSermonInputStore(db).head(f.sermonId))?.version).toBe(1);
  });
  it("never retries a lost response and never invents zero usage", async () => {
    const f = await fixture(), fetcher = vi.fn(async () => { throw new Error("private upstream body"); });
    expect((await execute(f, fetcher)).outcome).toBe("uncertain");
    expect((await execute(f, fetcher)).outcome).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(f.requested.jobId).first()).toEqual({ n: 0 });
  });
  it("correlates safe HTTP diagnostics with the unchanged uncertain call", async () => {
    const f = await fixture("PRIVATE_TRANSCRIPT");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn(async () => Response.json({ error: { code: "credit_balance_exhausted",
      message: "PRIVATE_KEY PRIVATE_TRANSCRIPT", param: "PRIVATE_PARAMETER" } }, { status: 429 }));
    try {
      expect((await execute(f, fetcher)).outcome).toBe("uncertain");
      expect((await execute(f, fetcher)).outcome).toBe("uncertain");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(warn.mock.calls[0]![0]))).toEqual({ code: "OPENAI_DRAFT_DIAGNOSTIC",
        callId: `call-${f.requested.jobId}`, phase: "http", httpStatus: 429, providerCode: "credit_balance_exhausted" });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE_");
      expect(await db.prepare("SELECT state FROM ai_provider_calls WHERE generation_job_id=?")
        .bind(f.requested.jobId).first()).toEqual({ state: "uncertain" });
      expect(await db.prepare("SELECT count(*) n FROM ai_usage_observations WHERE job_id=?")
        .bind(f.requested.jobId).first()).toEqual({ n: 0 });
      expect((await createSermonInputStore(db).head(f.sermonId))?.version).toBe(1);
    } finally { warn.mockRestore(); }
  });
  it("keeps observed cost when the input changes during generation", async () => {
    const f = await fixture();
    const head = await createSermonInputStore(db).head(f.sermonId);
    const result = await execute(f, async () => {
      expect((await f.service.execute(f.sermonId, { action: "edit", expectedVersion: 1, sourceId: head!.source_id,
        documentId: head!.document_id, documentSha256: head!.document_sha256, content: { format: "plain_text", text: "직접 수정" } },
      { adminId: actor, kind: "human", now: new Date().toISOString() })).outcome).toBe("saved");
      return complete({ format: "plain_text", text: "교정 초안" });
    });
    expect(result.outcome).toBe("stale");
    expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(f.requested.jobId).first()).toEqual({ n: 1 });
    expect((await createSermonInputStore(db).head(f.sermonId))?.version).toBe(2);
  });
  it("does not call provider before runtime opt-in or for a foreign instance", async () => {
    const f = await fixture(), fetcher = vi.fn(async () => complete({}));
    expect((await runContentGeneration({ DB: db }, { dispatchId: f.requested.dispatchId }, f.requested.jobId, { fetch: fetcher })).outcome).toBe("disabled");
    expect((await runContentGeneration(bindings, { dispatchId: f.requested.dispatchId }, "other", { fetch: fetcher })).outcome).toBe("conflict");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects request-key reuse with a different owner, actor, or selected input", async () => {
    const f = await fixture();
    await expect(requestCorrection(db, "other-sermon", f.command, actor)).rejects.toThrow("GENERATION_REQUEST_CONFLICT");
    await expect(requestCorrection(db, f.sermonId, f.command, "b".repeat(64))).rejects.toThrow("GENERATION_REQUEST_CONFLICT");
    await expect(requestCorrection(db, f.sermonId, { ...f.command, expectedInputVersion: 2 }, actor)).rejects.toThrow("GENERATION_REQUEST_CONFLICT");
  });
  it("records an input change before dispatch as stale without a provider call", async () => {
    const f = await fixture(), store = createSermonInputStore(db), head = await store.head(f.sermonId);
    await f.service.execute(f.sermonId, { action: "edit", expectedVersion: 1, sourceId: head!.source_id,
      documentId: head!.document_id, documentSha256: head!.document_sha256, content: { format: "plain_text", text: "새 본문" } },
    { kind: "human", adminId: actor, now: new Date().toISOString() });
    const fetcher = vi.fn(async () => complete({}));
    expect((await execute(f, fetcher)).outcome).toBe("stale");
    expect(fetcher).not.toHaveBeenCalled();
    const job = await createGenerationLifecycleStore(db).readJob(f.requested.jobId);
    expect(job.outcome === "present" && job.value.status).toBe("stale");
  });
  it("a lost Workflow create response cannot grant a second send", async () => {
    const f = await fixture();
    expect(["uncertain", "busy"]).toContain((await sendContentDispatch(db, { create: f.create } as never, f.requested.dispatchId)).outcome);
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("reads the job as a correction job, without a new audit", async () => {
    const f = await fixture();
    await execute(f, async () => complete({ format: "plain_text", text: "하나님 사랑" }));
    const job = await createGenerationLifecycleStore(db).readJob(f.requested.jobId);
    expect(job.outcome === "present" && job.value.status).toBe("review_ready");
    expect(await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=? AND task='final_audit'").bind(f.requested.jobId).first()).toEqual({ n: 0 });
  });
  it("preserves decimal timestamps and the raw source checksum through document adoption", async () => {
    const owner = await seedGenerationContext(), service = createSermonInputService(createSermonInputStore(db));
    const segments = Array.from({ length: 1800 }, (_, index) => ({ text: "원문", start: index + 0.25, duration: 0.75 }));
    const sourceSha256 = await hash(JSON.stringify(segments));
    expect((await service.execute(owner.sermonId, { action: "import_source", expectedVersion: 0, payload: {
      sourceMode: "public_unofficial", videoId: "abcdefghijk", language: "ko", trackId: "synthetic", generated: true,
      retrievedAt: new Date().toISOString(), providerId: "accountless-youtube-spike", providerVersion: "0.1.0", sourceSha256, segments,
    } }, { kind: "human", adminId: actor, now: new Date().toISOString() })).outcome).toBe("saved");
    const requested = await requestCorrection(db, owner.sermonId, { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId, expectedInputVersion: 1 }, actor);
    await sendContentDispatch(db, { create: async () => ({}) } as never, requested.dispatchId);
    const draft = { format: "timed_segments", segments: segments.map((_, index) => ({ segmentId: `segment-${index + 1}`, text: "교정" })) };
    expect((await runContentGeneration(bindings, { dispatchId: requested.dispatchId }, requested.jobId, { fetch: async () => complete(draft) })).outcome).toBe("saved");
    const store = createSermonInputStore(db), record = await store.event(owner.sermonId, `proposal-${requested.jobId}`);
    expect(record!.byte_length).toBeGreaterThan(131072);
    expect(await store.payload(record!)).toMatchObject({ sourceSha256, content: { segments: [{ segmentId: "segment-1", text: "교정", start: 0.25, duration: 0.75 }, ...segments.slice(1).map((s, i) => ({ ...s, segmentId: `segment-${i + 2}`, text: "교정" }))] } });
    const head = await store.head(owner.sermonId);
    expect((await service.execute(owner.sermonId, { action: "apply_correction_document", expectedVersion: head!.version,
      sourceId: head!.source_id, documentId: head!.document_id, documentSha256: head!.document_sha256,
      proposalId: record!.id, reviewed: true }, { kind: "human", adminId: actor, now: new Date().toISOString() })).outcome).toBe("saved");
    expect((await store.head(owner.sermonId))?.confirmation_id).toBeNull();
  });
  it("an explicit new request preserves an old uncertain call and creates a distinct call", async () => {
    const f = await fixture();
    expect((await execute(f, async () => { throw new Error("lost"); })).outcome).toBe("uncertain");
    const next = await requestCorrection(db, f.sermonId, { ...f.command, requestKey: crypto.randomUUID(), supersedesJobId: f.requested.jobId }, actor);
    await sendContentDispatch(db, { create: async () => ({}) } as never, next.dispatchId);
    expect((await runContentGeneration(bindings, { dispatchId: next.dispatchId }, next.jobId, { fetch: async () => complete({ format: "plain_text", text: "새 교정" }) })).outcome).toBe("saved");
    expect(await db.prepare("SELECT state FROM ai_provider_calls WHERE generation_job_id=?").bind(f.requested.jobId).first()).toEqual({ state: "uncertain" });
    expect(await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE quiz_set_id=?").bind(f.quizSetId).first()).toEqual({ n: 2 });
  });
  it("settles usage that arrives after a timeout without accepting the late document", async () => {
    const f = await fixture();
    let deliver!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { deliver = resolve; });
    const result = await runContentGeneration(bindings, { dispatchId: f.requested.dispatchId }, f.requested.jobId,
      { fetch: async () => pending, timeoutMs: 10 });
    expect(result.outcome).toBe("uncertain");
    deliver(complete({ format: "plain_text", text: "늦은 교정" }));
    await vi.waitFor(async () => {
      expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(f.requested.jobId).first()).toEqual({ n: 1 });
    }, { timeout: 5_000 });
    expect((await createSermonInputStore(db).head(f.sermonId))?.version).toBe(1);
  });

});
