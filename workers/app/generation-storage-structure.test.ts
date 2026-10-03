import { describe, expect, it } from "vitest";

import {
  acknowledgeStartPlan,
  claimStartDispatch,
  executeGeneration,
  generationCreatePlan,
  generationDb,
  generationSnapshot,
  generationTestHash,
  receiptInsertStep,
  receiptSuccessPlan,
  seedGenerationContext,
  type GenerationCreatePlan,
  type GenerationContext,
} from "./test/generation-storage-fixture";

async function createRunningJob(): Promise<{ context: GenerationContext; plan: GenerationCreatePlan }> {
  const context = await seedGenerationContext();
  const plan = generationCreatePlan(context);
  await executeGeneration(plan.steps);
  expect((await claimStartDispatch(plan)).meta.changes).toBe(1);
  await executeGeneration(acknowledgeStartPlan(plan));
  return { context, plan };
}

describe("P5-32 generation storage structure / isolated D1", () => {
  it("adds four empty private tables, the active partial index, deferred required-event FK, and reviewed guards", async () => {
    const names = ["generation_job_dispatches", "generation_job_events", "generation_jobs", "generation_step_receipts"];
    const rows = (await generationDb.prepare(
      `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name IN (${names.map(() => "?").join(",")}) ORDER BY type,name`,
    ).bind(...names).all()).results as Array<Record<string, string>>;
    expect(rows.filter((row) => row.type === "table").map((row) => row.name)).toEqual([
      "generation_job_dispatches",
      "generation_job_events",
      "generation_jobs",
      "generation_step_receipts",
    ]);
    expect(rows.find((row) => row.name === "generation_jobs_one_active_quiz_set_uidx")?.sql).toContain("WHERE");
    expect(rows.find((row) => row.name === "generation_jobs")?.sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(rows.filter((row) => row.type === "trigger" && row.name !== "generation_ai_receipt_success_guard")).toHaveLength(12);
    for (const table of ["generation_jobs", "generation_job_events", "generation_step_receipts", "generation_job_dispatches"]) {
      expect((await generationDb.prepare(`SELECT count(*) AS total FROM ${table}`).first<{ total: number }>())?.total).toBe(0);
    }
  });

  it.each(["event", "dispatch", "sql"])("J31-01 rolls back job, first event, and start dispatch when %s fails", async (failure) => {
    const context = await seedGenerationContext();
    const plan = generationCreatePlan(context);
    if (failure === "event") plan.steps.splice(plan.steps.findIndex((step) => step.label === "event"), 1);
    if (failure === "dispatch") plan.steps.splice(plan.steps.findIndex((step) => step.label === "dispatch"), 1);
    if (failure === "sql") plan.steps.splice(2, 0, { label: "failure", sql: "INSERT INTO generation_missing_table VALUES (1)", values: [] });
    await expect(executeGeneration(plan.steps)).rejects.toThrow();
    expect((await generationSnapshot(context)).slice(0, 4)).toEqual([[], [], [], []]);
  });

  it("J31-02 keeps one physical request row and rejects same-key mutations without residue", async () => {
    const context = await seedGenerationContext();
    const first = generationCreatePlan(context);
    await executeGeneration(first.steps);
    const before = await generationSnapshot(context);
    const replay = generationCreatePlan(context, { requestKey: first.requestKey, requestFingerprint: first.requestFingerprint });
    await expect(executeGeneration(replay.steps)).rejects.toThrow();
    expect(await generationSnapshot(context)).toEqual(before);
    const mismatch = generationCreatePlan(context, { requestKey: first.requestKey, requestFingerprint: generationTestHash("f") });
    await expect(executeGeneration(mismatch.steps)).rejects.toThrow();
    expect(await generationSnapshot(context)).toEqual(before);
    expect(await generationDb.prepare("SELECT id,request_fingerprint FROM generation_jobs WHERE request_key=?").bind(first.requestKey).first()).toEqual({
      id: first.jobId,
      request_fingerprint: first.requestFingerprint,
    });
  });

  it("J31-03 rolls back dispatch acknowledgement when the expected job CAS affects zero rows", async () => {
    const context = await seedGenerationContext();
    const plan = generationCreatePlan(context);
    await executeGeneration(plan.steps);
    await claimStartDispatch(plan);
    const before = await generationSnapshot(context);
    const transition = acknowledgeStartPlan(plan);
    transition.find((step) => step.label === "job-running")!.sql += " AND 0";
    await expect(executeGeneration(transition)).rejects.toThrow();
    expect(await generationSnapshot(context)).toEqual(before);
  });

  it.each(["missing", "malformed"])("J31-04 required-event guard rolls back a %s event", async (failure) => {
    const context = await seedGenerationContext();
    const plan = generationCreatePlan(context);
    await executeGeneration(plan.steps);
    await claimStartDispatch(plan);
    const before = await generationSnapshot(context);
    const transition = acknowledgeStartPlan(plan);
    if (failure === "missing") transition.pop();
    else transition.at(-1)!.values[1] = 99;
    await expect(executeGeneration(transition)).rejects.toThrow();
    expect(await generationSnapshot(context)).toEqual(before);
  });

  it("J31-08 elects one dispatch claim and records one acknowledgement/event/state transition", async () => {
    const context = await seedGenerationContext();
    const plan = generationCreatePlan(context);
    await executeGeneration(plan.steps);
    const claims = await Promise.all([claimStartDispatch(plan), claimStartDispatch(plan)]);
    expect(claims.map((result) => result.meta.changes).sort()).toEqual([0, 1]);
    await executeGeneration(acknowledgeStartPlan(plan));
    const after = await generationSnapshot(context);
    expect(after[0]).toMatchObject([{ status: "running", state_version: 1, event_count: 2 }]);
    expect(after[1]).toHaveLength(2);
    expect(after[3]).toMatchObject([{ state: "acknowledged", attempt_count: 1 }]);
    await expect(executeGeneration(acknowledgeStartPlan(plan))).rejects.toThrow();
    expect(await generationSnapshot(context)).toEqual(after);
  });

  it("J31-09/J31-10 preserves one step receipt for same input and rejects a different fingerprint", async () => {
    const { context, plan } = await createRunningJob();
    const receipt = receiptInsertStep(plan.jobId);
    await executeGeneration([receipt]);
    const before = await generationSnapshot(context);
    await expect(executeGeneration([structuredClone(receipt)])).rejects.toThrow();
    expect(await generationSnapshot(context)).toEqual(before);
    const mismatch = receiptInsertStep(plan.jobId, "summary:1", generationTestHash("f"));
    await expect(executeGeneration([mismatch])).rejects.toThrow();
    expect(await generationSnapshot(context)).toEqual(before);
  });

  it("J31-11 elects one expired-lease reclaimer and forbids reclaim after effect_started", async () => {
    const { plan } = await createRunningJob();
    await executeGeneration([receiptInsertStep(plan.jobId)]);
    await generationDb.prepare(
      "UPDATE generation_step_receipts SET state='retryable_failed',claim_token=NULL,lease_expires_at=NULL,error_code='RETRYABLE',error_message_safe='RETRYABLE',error_fingerprint=?,updated_at=? WHERE generation_job_id=? AND step_key='summary:1' AND state='claimed'",
    ).bind(generationTestHash("f"), "2026-09-17T00:00:02.000Z", plan.jobId).run();
    const reclaim = (token: string) => generationDb.prepare(
      "UPDATE generation_step_receipts SET state='claimed',attempt_count=attempt_count+1,claim_token=?,lease_expires_at=?,error_code=NULL,error_message_safe=NULL,error_fingerprint=NULL,updated_at=? WHERE generation_job_id=? AND step_key='summary:1' AND state='retryable_failed' AND attempt_count=1",
    ).bind(token, "2026-09-17T00:10:00.000Z", "2026-09-17T00:00:03.000Z", plan.jobId).run();
    const claims = await Promise.all([reclaim("claim:a"), reclaim("claim:b")]);
    expect(claims.map((result) => result.meta.changes).sort()).toEqual([0, 1]);
    await generationDb.prepare(
      "UPDATE generation_step_receipts SET state='effect_started',provider_request_id_opaque=?,updated_at=? WHERE generation_job_id=? AND step_key='summary:1' AND state='claimed'",
    ).bind(generationTestHash("1"), "2026-09-17T00:00:04.000Z", plan.jobId).run();
    await expect(generationDb.prepare(
      "UPDATE generation_step_receipts SET state='claimed',attempt_count=attempt_count+1 WHERE generation_job_id=? AND step_key='summary:1' AND state='effect_started'",
    ).bind(plan.jobId).run()).rejects.toThrow();
    expect(await generationDb.prepare("SELECT state,attempt_count FROM generation_step_receipts WHERE generation_job_id=?").bind(plan.jobId).first()).toEqual({
      state: "effect_started",
      attempt_count: 2,
    });
  });

  it.each(["zero-row", "constraint"])("J31-13 rolls back receipt, job, and event when success has a %s failure", async (failure) => {
    const { context, plan } = await createRunningJob();
    await executeGeneration([receiptInsertStep(plan.jobId)]);
    const before = await generationSnapshot(context);
    const success = receiptSuccessPlan(plan.jobId);
    const receipt = success.find((step) => step.label === "receipt-succeed")!;
    if (failure === "zero-row") receipt.sql += " AND 0";
    else receipt.values[1] = "not-a-hash";
    await expect(executeGeneration(success)).rejects.toThrow();
    expect(await generationSnapshot(context)).toEqual(before);
  });

  it("J31-19 enforces one active job per quiz set and leaves the losing batch empty", async () => {
    const context = await seedGenerationContext();
    const first = generationCreatePlan(context);
    await executeGeneration(first.steps);
    const before = await generationSnapshot(context);
    const second = generationCreatePlan(context);
    await expect(executeGeneration(second.steps)).rejects.toThrow();
    expect(await generationSnapshot(context)).toEqual(before);
  });

  it("rejects cross-sermon quiz ownership and missing present-input foreign keys", async () => {
    const context = await seedGenerationContext();
    const other = await seedGenerationContext();
    const ownership = generationCreatePlan(context);
    ownership.steps[0]!.values[1] = other.sermonId;
    await expect(executeGeneration(ownership.steps)).rejects.toThrow();
    expect((await generationSnapshot(context)).slice(0, 4)).toEqual([[], [], [], []]);

    const input = generationCreatePlan(context);
    const job = input.steps[0]!;
    job.values[8] = "present";
    job.values[9] = 1;
    job.values[10] = "missing-source";
    job.values[11] = "missing-document";
    job.values[12] = generationTestHash("a");
    await expect(executeGeneration(input.steps)).rejects.toThrow();
    expect((await generationSnapshot(context)).slice(0, 4)).toEqual([[], [], [], []]);
  });

  it.each(["relation", "json", "state", "update", "delete"])("J31-20 fails closed on %s tampering", async (tamper) => {
    const context = await seedGenerationContext();
    const plan = generationCreatePlan(context);
    if (tamper === "relation") plan.steps[1]!.values[1] = "missing-job";
    if (tamper === "json") plan.steps[2]!.values[8] = "{not-json";
    if (tamper === "state") plan.steps[1]!.values[9] = "acknowledged";
    if (["relation", "json", "state"].includes(tamper)) {
      await expect(executeGeneration(plan.steps)).rejects.toThrow();
      expect((await generationSnapshot(context)).slice(0, 4)).toEqual([[], [], [], []]);
      return;
    }
    await executeGeneration(plan.steps);
    const before = await generationSnapshot(context);
    const sql = tamper === "update"
      ? "UPDATE generation_job_events SET message_safe=message_safe WHERE generation_job_id=?"
      : "DELETE FROM generation_job_events WHERE generation_job_id=?";
    await expect(generationDb.prepare(sql).bind(plan.jobId).run()).rejects.toThrow();
    expect(await generationSnapshot(context)).toEqual(before);
  });

  it.each(["metadata", "message", "error", "payload"])("J31-21 rejects a private canary in %s instead of persisting it", async (location) => {
    const context = await seedGenerationContext();
    const plan = generationCreatePlan(context);
    const canary = "PRIVATE_TRANSCRIPT_CANARY";
    if (location === "metadata") plan.steps[2]!.values[8] = JSON.stringify({ transcript: canary });
    if (location === "message") plan.steps[2]!.values[7] = canary;
    if (location === "error") {
      plan.steps[0]!.values[24] = "SAFE_ERROR";
      plan.steps[0]!.values[25] = canary;
      plan.steps[0]!.values[26] = generationTestHash("f");
    }
    if (location === "payload") plan.steps[1]!.values[8] = canary;
    await expect(executeGeneration(plan.steps)).rejects.toThrow();
    expect((await generationSnapshot(context)).slice(0, 4)).toEqual([[], [], [], []]);
    const serialized = JSON.stringify(await generationSnapshot(context));
    expect(serialized).not.toContain(canary);
  });

  it("seals a valid step receipt transition and keeps FK/quick_check clean", async () => {
    const { context, plan } = await createRunningJob();
    await executeGeneration([receiptInsertStep(plan.jobId)]);
    await executeGeneration(receiptSuccessPlan(plan.jobId));
    const snapshot = await generationSnapshot(context);
    expect(snapshot[0]).toMatchObject([{ status: "running", state_version: 2, event_count: 3 }]);
    expect(snapshot[1]).toHaveLength(3);
    expect(snapshot[2]).toMatchObject([{ state: "succeeded", result_kind: "validation_result" }]);
    expect((await generationDb.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect((await generationDb.prepare("PRAGMA quick_check").all()).results).toEqual([{ quick_check: "ok" }]);
  });
});
