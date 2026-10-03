import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareArchivedIntentRecovery } from "../_shared/services/archived-intent-recovery";
import * as domainReader from "../_shared/services/generation-domain-reader";
import { createGenerationLifecycleStore } from "../_shared/repositories/generation-lifecycle-store";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { requestFullGeneration } from "../_shared/services/content-intent-generation";
import { sendContentDispatch, runContentGeneration } from "../_shared/services/content-generation";
import { seedGenerationContext } from "./test/generation-storage-fixture";
import { analysis, raw, sha } from "./test/generation-domain-fixture";

// Freeze Date per synthetic case, keeping real timers and SQL time guards active.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });

it("prepares a previously rejected full analysis offline; binds archive, context and settled ledger without changing any rows", async () => {
  const db = (env as Env).DB, owner = await seedGenerationContext();
  const store = createSermonInputStore(db), service = createSermonInputService(store);
  const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript",
    sourceCoverage: "full_transcript", rawTranscriptText: raw });
  if (source.outcome !== "validated") throw new Error("fixture");
  const actor = { kind: "human" as const, adminId: "a".repeat(64), now: new Date().toISOString() };
  await service.importPreparedManual(owner.sermonId, 0, source.source, actor);
  const head = (await store.head(owner.sermonId))!;
  await service.execute(owner.sermonId, { action: "confirm", expectedVersion: 1, sourceId: head.source_id,
    documentId: head.document_id, documentSha256: head.document_sha256, reviewed: true }, actor);
  const options = { gridSizes: [5], targetWordCounts: [5], seed: "recovery-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
  const job = await requestFullGeneration(db, owner.sermonId, { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId,
    expectedVersion: 2, selection: { child: { options, index: 0 }, adult: { options, index: 0 } } }, actor.adminId);
  await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
  let requestText = "";
  const draft = analysis();
  for (const claims of Object.values(draft)) for (const c of claims) c.evidence[0]!.to = raw.length + 100;
  const responseBody = { id: "synthetic", model: "gpt-5.6-terra", status: "completed", usage: { input_tokens: 100, output_tokens: 30 },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft }) }] }] };
  const responseText = JSON.stringify({ status: 200, body: JSON.stringify(responseBody) });
  // Reproduce the historical domain refusal while retaining valid original quotes.
  // Current parsing repairs the offsets; the simulated old validator still rejects.
  const actualPrepare = domainReader.prepareReadIntentResult;
  const oldValidator = vi.spyOn(domainReader, "prepareReadIntentResult").mockImplementation((basis, ...args) =>
    basis.authority.jobId === job.jobId ? Promise.resolve({ outcome: "invalid" }) : actualPrepare(basis, ...args));
  try {
    const generated = await runContentGeneration({ DB: db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic" },
      { dispatchId: job.dispatchId }, job.jobId, { fetch: async (_url, init) => {
        requestText = JSON.stringify({ body: String(init?.body) }); return Response.json(responseBody);
      } });
    expect(generated).toEqual({ outcome: "rejected" });
  } finally { oldValidator.mockRestore(); }
  const wire = JSON.parse(JSON.parse(requestText).body);
  const pin = { sourceJobId: job.jobId, sermonId: owner.sermonId, quizSetId: owner.quizSetId, attempt: 1,
    requestSha256: await sha(requestText), responseSha256: await sha(responseText), instructionsSha256: await sha(wire.instructions) };
  const readonly = { prepare(sql: string) { expect(sql.trim()).toMatch(/^(SELECT|WITH)\b/iu); return db.prepare(sql); } } as D1Database;
  const tables = ["generation_jobs", "generation_step_outcomes", "ai_provider_calls", "ai_usage_events", "ai_usage_observations",
    "ai_usage_settlements", "sermon_content_events", "sermon_input_events"];
  const snapshot = () => Promise.all(tables.map(async table => (await db.prepare(`SELECT * FROM ${table} WHERE ${table === "generation_jobs" ? "id" :
    ["generation_step_outcomes", "ai_usage_observations", "ai_usage_settlements"].includes(table) ? "job_id" :
    table.startsWith("sermon_") ? "sermon_id" : "generation_job_id"}=?`)
    .bind(table.startsWith("sermon_") ? owner.sermonId : job.jobId).all()).results));
  const before = await snapshot(), network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_FORBIDDEN"));
  try {
    const result = await prepareArchivedIntentRecovery(readonly, pin, requestText, responseText);
    expect(result.outcome).toBe("ready_for_local_review");
    if (result.outcome !== "ready_for_local_review") throw new Error(result.code);
    expect(result.package.boundaries).toMatchObject({ providerCalls: 0, appWrites: 0, writePermit: false,
      humanApproved: false, critiquePerformed: false, appRecoveryCommitImplemented: true });
    expect(result.package.checks).toMatchObject({ claimCount: 9, evidenceCount: 9, ledgerMatched: true });
    if (result.package.result.task !== "intent_analysis") throw new Error("unexpected recovery task");
    expect(result.package.result.content.centralMessage[0]!.evidence[0]!.to).toBe(9);
    expect(result.package.source).toMatchObject({ originalOutcome: "rejected", originalJobStatus: "failed" });
    expect(await prepareArchivedIntentRecovery(readonly, pin, requestText, responseText)).toEqual(result);
    for (const [req, res] of [[requestText + " ", responseText], [requestText, responseText + " "]]) {
      expect(await prepareArchivedIntentRecovery(readonly, pin, req!, res!)).toEqual({ outcome: "rejected", code: "ARCHIVE_CHANGED" });
    }
    expect(await prepareArchivedIntentRecovery(readonly, { ...pin, sourceJobId: "other-job" }, requestText, responseText))
      .toEqual({ outcome: "rejected", code: "SOURCE_NOT_ELIGIBLE" });
    expect(await prepareArchivedIntentRecovery(readonly, { ...pin, instructionsSha256: "0".repeat(64) }, requestText, responseText))
      .toEqual({ outcome: "rejected", code: "ARCHIVE_CHANGED" });
    const swappedWire = { ...wire, input: JSON.stringify({ transcript: { format: "plain_text", text: "OTHER_PRIVATE_INPUT" } }) };
    const swappedRequest = JSON.stringify({ body: JSON.stringify(swappedWire) });
    expect(await prepareArchivedIntentRecovery(readonly, { ...pin, requestSha256: await sha(swappedRequest) }, swappedRequest, responseText))
      .toEqual({ outcome: "rejected", code: "CONTEXT_CHANGED" });
    const wrongUsage = JSON.stringify({ status: 200, body: JSON.stringify({ ...responseBody, usage: { input_tokens: 101, output_tokens: 30 } }) });
    expect(await prepareArchivedIntentRecovery(readonly, { ...pin, responseSha256: await sha(wrongUsage) }, requestText, wrongUsage))
      .toEqual({ outcome: "rejected", code: "USAGE_MISMATCH" });
    const badDraft = structuredClone(draft); badDraft.centralMessage[0]!.evidence[0]!.quote = "SECRET_ABSENT_QUOTE";
    const invalid = JSON.stringify({ status: 200, body: JSON.stringify({ ...responseBody,
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft: badDraft }) }] }] }) });
    const missingLocation = await prepareArchivedIntentRecovery(readonly, { ...pin, responseSha256: await sha(invalid) }, requestText, invalid);
    expect(missingLocation.outcome).toBe("ready_for_local_review");
    if (missingLocation.outcome !== "ready_for_local_review" || missingLocation.package.result.task !== "intent_analysis") throw new Error("fixture");
    expect(missingLocation.package.result.content.centralMessage[0]!.evidence[0])
      .toMatchObject({ locationStatus: "unverified", reason: "not_found", from: null, to: null });
    expect(JSON.stringify(missingLocation.package.checks)).not.toContain("SECRET");
    expect(await snapshot()).toEqual(before);
    expect(network).not.toHaveBeenCalled();
    expect((await createGenerationLifecycleStore(db).readJob(job.jobId))).toMatchObject({ outcome: "present", value: { status: "failed" } });
  } finally { network.mockRestore(); }
  // A new metadata value makes the otherwise unchanged saved result stale.
  await db.prepare("UPDATE sermon_metadata_drafts SET title=? WHERE sermon_id=?").bind("CHANGED_SYNTHETIC_TITLE", owner.sermonId).run();
  expect(await prepareArchivedIntentRecovery(readonly, pin, requestText, responseText))
    .toEqual({ outcome: "rejected", code: "CONTEXT_CHANGED" });
});
