import { expect, it, vi } from "vitest";
import { createArchivedTrialFetch } from "../../scripts/quality-trial-response-archive";
import { diagnoseIntentEvidence } from "../_shared/services/sermon-intent";
import { analysis, raw } from "./test/generation-domain-fixture";
const config = { origin: "http://127.0.0.1:12345", token: "a".repeat(64) };
const url = "https://api.openai.com/v1/responses";
const request = { method: "POST", headers: { Authorization: "Bearer synthetic-key" }, body: JSON.stringify({ input: "synthetic private input" }) };
it("awaits request/response archival, preserves response bytes and does not archive the API key", async () => {
  const calls: { url: string; body: string }[] = [];
  const upstream = vi.fn<typeof fetch>(async (input, init) => {
    const target = String(input); calls.push({ url: target, body: String(init?.body) });
    if (target === url) { expect(calls).toHaveLength(2); return new Response("{\"usage\":123}", { status: 200 }); }
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${config.token}`);
    expect(init?.redirect).toBe("manual"); return new Response(null, { status: 201 });
  });
  expect(await (await createArchivedTrialFetch(config, upstream)(url, request)).text()).toBe('{"usage":123}');
  expect(calls).toHaveLength(3);
  expect(calls[0]!.url.replace(/request$/, "response")).toBe(calls[2]!.url);
  expect(JSON.stringify(calls.filter(c => c.url !== url))).not.toContain("synthetic-key");
  expect(JSON.parse(calls[2]!.body)).toEqual({ status: 200, body: '{"usage":123}' });
});
it("does not call provider when request archive fails or redirects", async () => {
  const upstream = vi.fn<typeof fetch>(async () => new Response(null, { status: 302 }));
  await expect(createArchivedTrialFetch(config, upstream)(url, request)).rejects.toThrow("LOCAL_ARCHIVE_UNAVAILABLE");
  expect(upstream).toHaveBeenCalledTimes(1);
});
it("returns a paid response for usage accounting if archival fails, then blocks later calls without retry", async () => {
  const logs = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response('{"usage":42}')).mockRejectedValueOnce(new Error("secret response must not log"));
    const archived = createArchivedTrialFetch(config, upstream);
    expect(await (await archived(url, request)).text()).toBe('{"usage":42}');
    await expect(archived(url, request)).rejects.toThrow("LOCAL_ARCHIVE_PREVIOUS_RESPONSE_LOST");
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(logs.mock.calls)).not.toContain("secret");
  } finally { logs.mockRestore(); }
});
it("rejects non-loopback archive config; unrelated authentication fetch remains unchanged", async () => {
  expect(() => createArchivedTrialFetch({ ...config, origin: "https://external.invalid" })).toThrow();
  const upstream = vi.fn<typeof fetch>(async () => new Response("certs"));
  expect(await (await createArchivedTrialFetch(config, upstream)("https://access.invalid/certs")).text()).toBe("certs");
  expect(upstream).toHaveBeenCalledTimes(1);
});
it("diagnoses exact evidence failures without accepting them or returning private text", () => {
  const content = { format: "plain_text" as const, text: raw }, valid = analysis();
  expect(diagnoseIntentEvidence(content, valid)).toBeNull();
  const quote = structuredClone(valid); quote.centralMessage[0]!.evidence[0]!.quote = "private-wrong-quote";
  expect(diagnoseIntentEvidence(content, quote)).toEqual({ code: "quote_mismatch", claimIndex: 0, evidenceIndex: 0 });
  const range = structuredClone(valid); range.centralMessage[0]!.evidence[0]!.to = raw.length + 1;
  expect(diagnoseIntentEvidence(content, range)?.code).toBe("evidence_range");
  const timed = { format: "timed_segments" as const, segments: [{ segmentId: "s", text: raw, start: 0.359, duration: 1.23 }] };
  const evidence = valid.centralMessage[0]!.evidence[0]!;
  evidence.segmentId = "s"; evidence.start = 0.36; evidence.duration = 1.23;
  expect(diagnoseIntentEvidence(timed, valid)?.code).toBe("segment_time");
  evidence.segmentId = "missing";
  expect(diagnoseIntentEvidence(timed, valid)?.code).toBe("segment_missing");
});

it("replays a stored response offline through the real provider and evidence validators", async () => {
  const { replayArchivedIntent } = await import("../../scripts/quality-trial-response-replay");
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NO_NETWORK"));
  try {
    const saved = { body: JSON.stringify({ model: "gpt-5.6-terra", input: JSON.stringify({ transcript: { format: "plain_text", text: raw } }),
      text: { format: { name: "intent_analysis_v1" } } }) };
    const response = (draft: unknown) => ({ status: 200, body: JSON.stringify({ id: "synthetic", model: "gpt-5.6-terra", status: "completed",
      usage: { input_tokens: 100, output_tokens: 30 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft }) }] }] }) });
    expect(await replayArchivedIntent(saved, response(analysis()))).toMatchObject({ stage: "content_valid_only", originalDbAuthorityVerified: false, usageObserved: true, paidCalls: 0, unverifiedEvidenceCount: 0 });
    expect(await replayArchivedIntent(saved, response({ invalid: "private-invalid" }))).toMatchObject({ stage: "provider", code: "AI_DRAFT_OUTPUT_INVALID", paidCalls: 0 });
    const invalid = analysis(); invalid.centralMessage[0]!.evidence[0]!.quote = "private-invalid";
    const result = await replayArchivedIntent(saved, response(invalid));
    expect(result).toMatchObject({ stage: "content_valid_only", unverifiedEvidenceCount: 1, paidCalls: 0 });
    expect(JSON.stringify(result)).not.toContain("private-invalid");
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});

it("archives both synthetic calls through real D1 generation and stops at intent review", async () => {
  const { env } = await import("cloudflare:workers");
  const { seedGenerationContext } = await import("./test/generation-storage-fixture");
  const { prepareManualTranscriptSource } = await import("../_shared/services/manual-transcript-source");
  const { createSermonInputService } = await import("../_shared/services/sermon-input");
  const { createSermonInputStore } = await import("../_shared/repositories/sermon-input-store");
  const { requestFullGeneration } = await import("../_shared/services/content-intent-generation");
  const { sendContentDispatch, runContentGeneration } = await import("../_shared/services/content-generation");
  const { clearCritique } = await import("./test/generation-domain-fixture");
  const db = (env as Env).DB, owner = await seedGenerationContext();
  const store = createSermonInputStore(db), service = createSermonInputService(store);
  const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript", rawTranscriptText: raw });
  if (source.outcome !== "validated") throw new Error("fixture");
  const actor = { kind: "human" as const, adminId: "a".repeat(64), now: new Date().toISOString() };
  await service.importPreparedManual(owner.sermonId, 0, source.source, actor);
  const head = (await store.head(owner.sermonId))!;
  await service.execute(owner.sermonId, { action: "confirm", expectedVersion: 1, sourceId: head.source_id, documentId: head.document_id, documentSha256: head.document_sha256, reviewed: true }, actor);
  const options = { gridSizes: [5], targetWordCounts: [5], seed: "archive-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
  const job = await requestFullGeneration(db, owner.sermonId, { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId, expectedVersion: 2,
    selection: { child: { options, index: 0 }, adult: { options, index: 0 } } }, actor.adminId);
  await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
  let providerCalls = 0;
  const archives: string[] = [];
  const upstream = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input).startsWith(config.origin)) { archives.push(String(init?.body)); return new Response(null, { status: 201 }); }
    expect(String(input)).toBe(url);
    const draft = ++providerCalls === 1 ? analysis() : { analysis: analysis(), critique: clearCritique };
    return Response.json({ id: "synthetic", model: "gpt-5.6-terra", status: "completed", usage: { input_tokens: 100, output_tokens: 30 },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft }) }] }] });
  });
  const result = await runContentGeneration({ DB: db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic-private-key" },
    { dispatchId: job.dispatchId }, job.jobId, { fetch: createArchivedTrialFetch(config, upstream) });
  expect(result).toEqual({ outcome: "awaiting_intent_review" });
  expect(providerCalls).toBe(2); expect(archives).toHaveLength(4);
  expect(archives.join()).not.toContain("synthetic-private-key");
  expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(job.jobId).first()).toEqual({ n: 2 });
});
