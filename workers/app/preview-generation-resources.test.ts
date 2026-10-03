import { expect, it, vi } from "vitest";
import { meterD1 } from "../../scripts/p5-71-d1-meter";
import { marker, syntheticProvider, syntheticTranscript } from "../../scripts/p5-71-synthetic-provider";
import { generationDb as db, seedGenerationContext } from "./test/generation-storage-fixture";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { requestFullGeneration, requestContentResume } from "../_shared/services/content-intent-generation";
import { sendContentDispatch, runContentGeneration } from "../_shared/services/content-generation";
import { executeContentHumanCommand } from "../_shared/services/content-human-generation";
import { finishContentGeneration } from "../_shared/services/content-generation-final";
import { readContentGenerationView } from "../_shared/services/content-generation-view";
import { generationReadSession } from "../_shared/repositories/generation-read-session";
import { createGenerationLifecycleStore } from "../_shared/repositories/generation-lifecycle-store";
import { runPreviewMeasurement } from "../content/preview-measurement";

const fakeWorkflow = { create: async () => ({}), get: async () => ({ sendEvent: async () => {} }) } as never;
async function fixture(characters: number) {
  const owner = await seedGenerationContext();
  const store = createSermonInputStore(db), service = createSermonInputService(store);
  const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript",
    sourceCoverage: "full_transcript", rawTranscriptText: syntheticTranscript(characters) });
  if (source.outcome !== "validated") throw new Error("fixture");
  const actor = { kind: "human" as const, adminId: "a".repeat(64), now: new Date().toISOString() };
  await service.importPreparedManual(owner.sermonId, 0, source.source, actor);
  const head = (await store.head(owner.sermonId))!;
  await service.execute(owner.sermonId, { action: "confirm", expectedVersion: 1, sourceId: head.source_id,
    documentId: head.document_id, documentSha256: head.document_sha256, reviewed: true }, actor);
  return { owner, actor };
}
const placement = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
it("meters executed D1 calls separately from batch SQL without counting preparation or rebinding", async () => {
  const meter = meterD1(db);
  const statement = meter.db.prepare("SELECT ? AS n");
  expect(meter.counts.d1Calls).toBe(0);
  expect(await statement.bind(1).first("n")).toBe(1);
  await meter.db.batch([statement.bind(2), statement.bind(3)]);
  await statement.bind(4).raw();
  expect(meter.counts).toEqual({ d1Calls: 3, sqlStatements: 4, largestBatch: 2, blockedCalls: 0 });
});

it.each([11715, 30000])("completes generation/review/replay with a hard 50-call bound per request or Workflow unit, using %i synthetic characters", async characters => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NO_NETWORK"));
  const rows: unknown[] = [];
  const units: unknown[] = [];
  let measuredJobId: string | undefined;
  const counters = new WeakMap<D1Database, ReturnType<typeof meterD1>>();
  async function measure<T>(stage: string, fn: (measured: D1Database) => Promise<T>): Promise<T> {
    const meter = meterD1(db, 50), started = Date.now();
    const connection = generationReadSession(meter.db);
    counters.set(connection, meter);
    try {
      if (measuredJobId && /^(intent-|review-|resume-|finish)/u.test(stage)) {
        expect((await createGenerationLifecycleStore(connection).readJob(measuredJobId)).outcome).toBe("present");
      }
      return await fn(connection);
    }
    finally {
      rows.push({ stage, ...meter.counts, wallMs: Date.now() - started, cpuMs: null });
      expect(meter.counts.blockedCalls, stage).toBe(0);
    }
  }
  try {
    const { owner, actor } = await fixture(characters), requestKey = crypto.randomUUID();
    const command = { requestKey, quizSetId: owner.quizSetId, expectedVersion: 2,
      selection: { child: { options: placement, index: 0 }, adult: { options: placement, index: 0 } } };
    const job = await measure("request-and-dispatch", async measured => {
      const job = await requestFullGeneration(measured, owner.sermonId, command, actor.adminId);
      await sendContentDispatch(measured, fakeWorkflow, job.dispatchId); return job;
    });
    const provider = syntheticProvider(), fullOwner = { ...owner, jobId: job.jobId };
    measuredJobId = job.jobId;
    const run = (measured: D1Database, dispatchId: string) => runContentGeneration({ DB: measured, AI_GENERATION_ENABLED: "true",
      OPENAI_API_KEY: "synthetic-only-not-a-key" }, { dispatchId }, job.jobId, { fetch: provider.fetch, unit: async (name, action) => {
        const meter = counters.get(measured)!; const before = { ...meter.counts };
        const result = await meter.withinWindow(action);
        const d1Calls = meter.counts.d1Calls - before.d1Calls;
        units.push({ name, d1Calls, sqlStatements: meter.counts.sqlStatements - before.sqlStatements });
        expect(d1Calls, name).toBeLessThanOrEqual(50);
        return result;
      } });
    expect(await measure("workflow-initial", measured => run(measured, job.dispatchId))).toEqual({ outcome: "awaiting_intent_review" });
    expect(provider.stats.syntheticResponses).toBe(2);
    expect(await measure("duplicate-initial", measured => run(measured, job.dispatchId))).toEqual({ outcome: "awaiting_intent_review" });
    expect(provider.stats.syntheticResponses).toBe(2);
    for (const [index, kind] of (["select", "confirm"] as const).entries()) {
      const result = await measure(`intent-${kind}`, measured => executeContentHumanCommand(measured, fullOwner, {
        requestKey: crypto.randomUUID(), expectedVersion: 4 + index,
        operation: { family: "intent", operation: { kind, analysisId: `result-${job.jobId}-intent_critique` } },
      }, actor.adminId));
      expect(result.outcome).toBe("saved");
    }
    const resumed = await measure("resume-and-dispatch", async measured => {
      const result = await requestContentResume(measured, fullOwner);
      if (!("dispatchId" in result) || !result.dispatchId) throw new Error("resume");
      await sendContentDispatch(measured, fakeWorkflow, result.dispatchId); return result;
    });
    const resumeId = resumed.dispatchId!;
    expect(await measure("workflow-resumed", measured => run(measured, resumeId))).toEqual({ outcome: "awaiting_content_review" });
    expect(provider.stats.syntheticResponses).toBe(5);
    expect((await measure("view-before-review", measured => readContentGenerationView(measured, owner.sermonId, true))).status).toBe("running");
    for (const [index, family] of (["summary", "child", "adult"] as const).entries()) {
      const operation = family === "summary" ? { family, operation: { kind: "review", summaryId: `result-${job.jobId}-summary` } } :
        { family: "candidate", operation: { kind: "review", difficulty: family, poolId: `result-${job.jobId}-${family}_candidates` } };
      expect((await measure(`review-${family}`, measured => executeContentHumanCommand(measured, fullOwner,
        { requestKey: crypto.randomUUID(), expectedVersion: 9 + index, operation }, actor.adminId))).outcome).toBe("saved");
    }
    expect((await measure("finish", measured => finishContentGeneration(measured, fullOwner))).outcome).toBe("review_ready");
    expect((await measure("view-completed", measured => readContentGenerationView(measured, owner.sermonId, true))).preview).not.toBeNull();
    expect(await measure("duplicate-completed", measured => run(measured, resumeId))).toEqual({ outcome: "review_ready" });
    expect(provider.stats.syntheticResponses).toBe(5);
    expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(job.jobId).first()).toEqual({ n: 5 });
    expect(await db.prepare("SELECT status FROM quiz_sets WHERE id=?").bind(owner.quizSetId).first()).toEqual({ status: "draft" });
    expect(network).not.toHaveBeenCalled();
    console.log("P571_LOCAL_MEASUREMENT " + JSON.stringify({ characters, ...provider.stats, rows, units }));
  } finally { network.mockRestore(); }
}, 90_000);

it("preserves rejected usage and refuses automatic paid replay, and observes a simulated 50-call stop", async () => {
  const { owner, actor } = await fixture(11715), provider = syntheticProvider("invalid_output");
  const command = { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId, expectedVersion: 2,
    selection: { child: { options: placement, index: 0 }, adult: { options: placement, index: 0 } } };
  const job = await requestFullGeneration(db, owner.sermonId, command, actor.adminId);
  await sendContentDispatch(db, fakeWorkflow, job.dispatchId);
  const bindings = { DB: db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic-only" };
  const params = { dispatchId: job.dispatchId };
  await runContentGeneration(bindings, params, job.jobId, { fetch: provider.fetch });
  await runContentGeneration(bindings, params, job.jobId, { fetch: provider.fetch });
  expect(provider.stats.syntheticResponses).toBe(1);
  expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(job.jobId).first()).toEqual({ n: 1 });
  expect(await db.prepare("SELECT status FROM generation_jobs WHERE id=?").bind(job.jobId).first()).toEqual({ status: "failed" });
  const limited = meterD1(db, 50);
  for (let i = 0; i < 50; i++) await limited.db.prepare("SELECT 1").first();
  expect(() => limited.db.prepare("SELECT 1").first()).toThrow("P571_SIMULATED_D1_RPC_LIMIT");
  expect(limited.counts.blockedCalls).toBe(1);
});

it("stops before provider work if the Workflow unit boundary is omitted under a simulated 50-call allowance", async () => {
  const { owner, actor } = await fixture(11715), provider = syntheticProvider();
  const job = await requestFullGeneration(db, owner.sermonId, { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId,
    expectedVersion: 2, selection: { child: { options: placement, index: 0 }, adult: { options: placement, index: 0 } } }, actor.adminId);
  await sendContentDispatch(db, fakeWorkflow, job.dispatchId);
  const measured = meterD1(db, 50);
  const result = await runContentGeneration({ DB: measured.db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic-only" },
    { dispatchId: job.dispatchId }, job.jobId, { fetch: provider.fetch });
  expect(result.outcome).toBe("unavailable");
  expect(measured.counts.d1Calls).toBe(50);
  expect(measured.counts.blockedCalls).toBeGreaterThan(0);
  expect(provider.stats.syntheticResponses).toBe(0);
  expect(await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=?").bind(job.jobId).first()).toEqual({ n: 0 });
});

it("keeps the Preview measurement entry disabled and rejects unrelated jobs without mutating them", async () => {
  const measured = meterD1(db), params = { dispatchId: "unknown" };
  expect(await runPreviewMeasurement(measured.db, params, "unknown")).toEqual({ outcome: "disabled" });
  expect(await runPreviewMeasurement(measured.db, params, "unknown", "true", "wrong")).toEqual({ outcome: "unavailable" });
  expect(measured.counts.d1Calls).toBe(0);
  expect(await runPreviewMeasurement(measured.db, params, "unknown", "true", "success")).toEqual({ outcome: "unavailable" });
  expect(measured.counts).toEqual({ d1Calls: 1, sqlStatements: 1, largestBatch: 0, blockedCalls: 0 });
});

it("runs the opt-in Preview entry only on marked synthetic content and reports numeric data without network", async () => {
  const { owner, actor } = await fixture(11715);
  await db.prepare("UPDATE sermon_metadata_drafts SET title=? WHERE sermon_id=?").bind(marker, owner.sermonId).run();
  const job = await requestFullGeneration(db, owner.sermonId, { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId,
    expectedVersion: 2, selection: { child: { options: placement, index: 0 }, adult: { options: placement, index: 0 } } }, actor.adminId);
  await sendContentDispatch(db, fakeWorkflow, job.dispatchId);
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NO_NETWORK"));
  const logs = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(await runPreviewMeasurement(db, { dispatchId: job.dispatchId }, job.jobId, "true", "success"))
      .toEqual({ outcome: "awaiting_intent_review" });
    expect(network).not.toHaveBeenCalled();
    expect(JSON.parse(logs.mock.calls[0]![0])).toMatchObject({ code: "P571_MEASUREMENT", syntheticResponses: 2, paidCalls: 0, cpuMs: null });
    expect(JSON.stringify(logs.mock.calls)).not.toContain(marker);
  } finally { network.mockRestore(); logs.mockRestore(); }
});
