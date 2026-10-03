import { expect, it, vi } from "vitest";
import { generationDb as db, seedGenerationContext } from "./test/generation-storage-fixture";
import { createAiResponseArchive, readAiResponseArchive } from "../_shared/repositories/ai-response-archive";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { requestFullGeneration } from "../_shared/services/content-intent-generation";
import { runContentGeneration, sendContentDispatch } from "../_shared/services/content-generation";
import { syntheticProvider, syntheticTranscript } from "../../scripts/p5-71-synthetic-provider";
import { purgeExpiredDraft } from "../_shared/services/draft-cleanup";

it("retains rejected wire bytes and usage across new readers without sending again; detects corrupted or missing bytes", async () => {
  const owner = await seedGenerationContext(), input = createSermonInputStore(db);
  const service = createSermonInputService(input), actor = { kind: "human" as const, adminId: "a".repeat(64), now: new Date().toISOString() };
  const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript",
    sourceCoverage: "full_transcript", rawTranscriptText: syntheticTranscript(30000) });
  if (source.outcome !== "validated") throw new Error("fixture");
  await service.importPreparedManual(owner.sermonId, 0, source.source, actor);
  const head = (await input.head(owner.sermonId))!;
  await service.execute(owner.sermonId, { action: "confirm", expectedVersion: 1, sourceId: head.source_id,
    documentId: head.document_id, documentSha256: head.document_sha256, reviewed: true }, actor);
  const options = { gridSizes: [5], targetWordCounts: [4], seed: "archive", maxTrials: 1, searchBudgetPerTrial: 100 };
  const job = await requestFullGeneration(db, owner.sermonId, { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId,
    expectedVersion: 2, selection: { child: { options, index: 0 }, adult: { options, index: 0 } } }, actor.adminId);
  await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
  const provider = syntheticProvider("invalid_output"), upstream = vi.fn(provider.fetch), params = { dispatchId: job.dispatchId };
  const bindings = { DB: db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "DO_NOT_ARCHIVE_THIS_KEY" };
  await runContentGeneration(bindings, params, job.jobId, { fetch: upstream, archiveResponses: true });
  const callId = `call-${job.jobId}-intent_analysis`;
  const request = await readAiResponseArchive(db, callId, "request"), response = await readAiResponseArchive(db, callId, "response");
  expect(request!.bytes.byteLength).toBeGreaterThan(65536);
  expect(new TextDecoder().decode(request!.bytes)).not.toContain("DO_NOT_ARCHIVE_THIS_KEY");
  expect(JSON.parse(new TextDecoder().decode(request!.bytes)).model).toBe("gpt-5.6-terra");
  expect(response?.status).toBe(200);
  expect(new TextDecoder().decode(response!.bytes)).toContain("P571_INVALID_SYNTHETIC_RESPONSE");
  expect(await db.prepare("SELECT status FROM generation_jobs WHERE id=?").bind(job.jobId).first("status")).toBe("failed");
  expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(job.jobId).first("n")).toBe(1);
  await runContentGeneration(bindings, params, job.jobId, { fetch: upstream, archiveResponses: true });
  expect(upstream).toHaveBeenCalledTimes(1);
  await expect(createAiResponseArchive(db, callId).request(new TextDecoder().decode(request!.bytes))).rejects.toThrow();
  const reopened = await readAiResponseArchive(db, callId, "response");
  expect(reopened!.sha256).toBe(response!.sha256);
  const changed = response!.bytes.slice(); changed[0] = changed[0]! ^ 1;
  await db.prepare("UPDATE ai_response_archive_chunks SET body=? WHERE call_id=? AND kind='response' AND position=0")
    .bind(changed, callId).run();
  await expect(readAiResponseArchive(db, callId, "response")).rejects.toThrow("AI_RESPONSE_ARCHIVE_UNAVAILABLE");
  await db.prepare("DELETE FROM ai_response_archive_chunks WHERE call_id=? AND kind='response'").bind(callId).run();
  await expect(readAiResponseArchive(db, callId, "response")).rejects.toThrow("AI_RESPONSE_ARCHIVE_UNAVAILABLE");
  expect((await purgeExpiredDraft(db, owner.sermonId, "2099-01-01T00:00:00.000Z")).outcome).toBe("purged");
  expect(await readAiResponseArchive(db, callId, "request")).toBeNull();
  expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(job.jobId).first("n")).toBe(1);
  await expect(createAiResponseArchive(db, callId).response(200, new Uint8Array([1]))).rejects.toThrow();
}, 60_000);

it("refuses an archive for a nonexistent paid-call receipt", async () => {
  const callId = crypto.randomUUID();
  await expect(createAiResponseArchive(db, callId).request("{}")).rejects.toThrow("AI_RESPONSE_ARCHIVE_UNAVAILABLE");
  expect(await readAiResponseArchive(db, callId, "request")).toBeNull();
});
