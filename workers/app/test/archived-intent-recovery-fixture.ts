import { env } from "cloudflare:workers";
import { vi } from "vitest";
import * as domainReader from "../../_shared/services/generation-domain-reader";
import { prepareManualTranscriptSource } from "../../_shared/services/manual-transcript-source";
import { createSermonInputService } from "../../_shared/services/sermon-input";
import { createSermonInputStore } from "../../_shared/repositories/sermon-input-store";
import { requestFullGeneration } from "../../_shared/services/content-intent-generation";
import { sendContentDispatch, runContentGeneration } from "../../_shared/services/content-generation";
import { seedGenerationContext } from "./generation-storage-fixture";
import { analysis, raw, sha } from "./generation-domain-fixture";

export async function archivedRecoveryFixture() {
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
  const options = { gridSizes: [5], targetWordCounts: [5], seed: "recovery-storage", maxTrials: 16, searchBudgetPerTrial: 3000 };
  const job = await requestFullGeneration(db, owner.sermonId, { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId,
    expectedVersion: 2, selection: { child: { options, index: 0 }, adult: { options, index: 0 } } }, actor.adminId);
  await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
  let requestText = "";
  const draft = analysis();
  for (const claims of Object.values(draft)) for (const c of claims) c.evidence[0]!.to = raw.length + 100;
  const body = { id: "synthetic", model: "gpt-5.6-terra", status: "completed", usage: { input_tokens: 100, output_tokens: 30 },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft }) }] }] };
  const responseText = JSON.stringify({ status: 200, body: JSON.stringify(body) });
  // Simulate the old domain refusal. These are synthetic strings, never a real API call.
  const actualPrepare = domainReader.prepareReadIntentResult;
  const old = vi.spyOn(domainReader, "prepareReadIntentResult").mockImplementation((basis, ...args) =>
    basis.authority.jobId === job.jobId ? Promise.resolve({ outcome: "invalid" }) : actualPrepare(basis, ...args));
  try {
    const result = await runContentGeneration({ DB: db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic" },
      { dispatchId: job.dispatchId }, job.jobId, { fetch: async (_url, init) => {
        requestText = JSON.stringify({ body: String(init?.body) }); return Response.json(body);
      } });
    if (result.outcome !== "rejected") throw new Error(`synthetic rejection required (${result.outcome})`);
  } finally { old.mockRestore(); }
  const wire = JSON.parse(JSON.parse(requestText).body);
  const pin = { sourceJobId: job.jobId, sermonId: owner.sermonId, quizSetId: owner.quizSetId, attempt: 1,
    requestSha256: await sha(requestText), responseSha256: await sha(responseText), instructionsSha256: await sha(wire.instructions) };
  const ledger = () => Promise.all(["generation_jobs", "generation_step_outcomes", "generation_step_receipts",
    "ai_provider_calls", "ai_usage_observations", "ai_usage_events", "ai_usage_settlements"]
    .map(async table => (await db.prepare(`SELECT * FROM ${table} WHERE ${table === "generation_jobs" ? "id" :
      ["generation_step_outcomes", "ai_usage_observations", "ai_usage_settlements"].includes(table) ? "job_id" : "generation_job_id"}=?`)
      .bind(job.jobId).all()).results));
  return { db, owner: { ...owner, jobId: job.jobId }, pin, requestText, responseText, actor: actor.adminId, ledger };
}
