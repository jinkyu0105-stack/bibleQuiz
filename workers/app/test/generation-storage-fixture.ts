// P5-32 synthetic SQL-envelope rehearsal only. This is not a repository,
// Workflow dispatcher, provider adapter, or proof of an external side effect.
import { env } from "cloudflare:workers";

import { createDatabase } from "../../_shared/db/client";
import { createSermonMetadataRepository } from "../../_shared/repositories/sermon-metadata-repository";
import { metadataCommand, seedMetadataSermon } from "./sermon-metadata-fixture";

export const generationDb = (env as Env).DB;

type Value = string | number | null;
export type GenerationStep = { label: string; sql: string; values: Value[] };

export interface GenerationContext {
  quizSetId: string;
  sermonId: string;
}

export interface GenerationCreatePlan {
  dispatchId: string;
  jobId: string;
  requestFingerprint: string;
  requestKey: string;
  steps: GenerationStep[];
  workflowInstanceId: string;
}

const now = "2026-09-17T00:00:00.000Z";
const later = "2026-09-17T00:00:01.000Z";
const hash = (character: string) => character.repeat(64);

function insertStep(label: string, table: string, values: Record<string, Value>): GenerationStep {
  const columns = Object.keys(values);
  return {
    label,
    sql: `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    values: Object.values(values),
  };
}

export async function seedGenerationContext(): Promise<GenerationContext> {
  const sermonId = crypto.randomUUID();
  const quizSetId = crypto.randomUUID();
  const database = createDatabase(generationDb);
  await seedMetadataSermon(database, sermonId);
  await createSermonMetadataRepository(database).save(metadataCommand(sermonId));
  await generationDb.prepare(
    "INSERT INTO quiz_sets (id,sermon_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?)",
  ).bind(quizSetId, sermonId, "TEST_ONLY_ACTOR", now, now).run();
  return { quizSetId, sermonId };
}

export function generationCreatePlan(
  context: GenerationContext,
  overrides: Partial<Pick<GenerationCreatePlan, "jobId" | "requestFingerprint" | "requestKey" | "workflowInstanceId">> = {},
): GenerationCreatePlan {
  const jobId = overrides.jobId ?? crypto.randomUUID();
  const requestKey = overrides.requestKey ?? `request:${crypto.randomUUID()}`;
  const requestFingerprint = overrides.requestFingerprint ?? hash("a");
  const workflowInstanceId = overrides.workflowInstanceId ?? `workflow:${jobId}`;
  const dispatchId = crypto.randomUUID();
  const steps = [
    insertStep("job", "generation_jobs", {
      id: jobId,
      sermon_id: context.sermonId,
      quiz_set_id: context.quizSetId,
      request_scope: "full",
      request_contract_version: 1,
      request_key: requestKey,
      request_fingerprint: requestFingerprint,
      workflow_instance_id: workflowInstanceId,
      start_input_state: "absent",
      start_input_version: null,
      start_source_id: null,
      start_document_id: null,
      start_document_sha256: null,
      start_confirmation_id: null,
      start_metadata_revision: 1,
      settings_revision: null,
      selection_revision: null,
      status: "dispatch_pending",
      current_step: "dispatch",
      state_version: 0,
      event_count: 1,
      wait_kind: null,
      wait_generation: 0,
      wait_input_fingerprint: null,
      error_code: null,
      error_message_safe: null,
      error_fingerprint: null,
      created_by_actor_id: hash("b"),
      created_at: now,
      updated_at: now,
      completed_at: null,
      required_event_no: 1,
      required_event_state_version: 0,
    }),
    insertStep("dispatch", "generation_job_dispatches", {
      id: dispatchId,
      generation_job_id: jobId,
      dispatch_no: 1,
      kind: "start",
      dispatch_key: `start:${jobId}`,
      workflow_instance_id: workflowInstanceId,
      job_state_version: 0,
      wait_generation: null,
      payload_fingerprint: hash("c"),
      state: "pending",
      attempt_count: 0,
      claim_token: null,
      lease_expires_at: null,
      error_code: null,
      error_message_safe: null,
      error_fingerprint: null,
      created_at: now,
      last_attempted_at: null,
      acknowledged_at: null,
    }),
    insertStep("event", "generation_job_events", {
      generation_job_id: jobId,
      event_no: 1,
      job_state_version: 0,
      attempt_number: 1,
      step_key: null,
      level: "info",
      event_code: "job_created",
      message_safe: "job_created",
      metadata_json_safe: JSON.stringify({ jobId, eventCode: "job_created", attempt: 1 }),
      elapsed_ms: 0,
      created_at: now,
    }),
  ];
  return { dispatchId, jobId, requestFingerprint, requestKey, steps, workflowInstanceId };
}

export function executeGeneration(steps: GenerationStep[]) {
  return generationDb.batch(steps.map((step) => generationDb.prepare(step.sql).bind(...step.values)));
}

export async function generationSnapshot(context: GenerationContext) {
  const jobIds = "SELECT id FROM generation_jobs WHERE quiz_set_id=?";
  const queries = [
    "SELECT * FROM generation_jobs WHERE quiz_set_id=? ORDER BY id",
    `SELECT * FROM generation_job_events WHERE generation_job_id IN (${jobIds}) ORDER BY generation_job_id,event_no`,
    `SELECT * FROM generation_step_receipts WHERE generation_job_id IN (${jobIds}) ORDER BY generation_job_id,step_key`,
    `SELECT * FROM generation_job_dispatches WHERE generation_job_id IN (${jobIds}) ORDER BY generation_job_id,dispatch_no`,
    "SELECT * FROM sermons WHERE id=?",
    "SELECT * FROM quiz_sets WHERE id=?",
    "SELECT * FROM sermon_metadata_drafts WHERE sermon_id=?",
  ];
  return Promise.all(queries.map(async (sql, index) => {
    const value = index === 5 ? context.quizSetId : context.sermonId;
    const binds = index >= 4 ? [value] : sql.includes(jobIds) ? [context.quizSetId] : [context.quizSetId];
    return (await generationDb.prepare(sql).bind(...binds).all()).results;
  }));
}

export async function claimStartDispatch(plan: GenerationCreatePlan) {
  return generationDb.prepare(
    "UPDATE generation_job_dispatches SET state='claimed',attempt_count=attempt_count+1,claim_token=?,lease_expires_at=?,last_attempted_at=? WHERE id=? AND state='pending' AND attempt_count=0",
  ).bind(`claim:${crypto.randomUUID()}`, "2026-09-17T00:05:00.000Z", later, plan.dispatchId).run();
}

export function acknowledgeStartPlan(plan: GenerationCreatePlan): GenerationStep[] {
  return [
    {
      label: "dispatch-acknowledge",
      sql: "UPDATE generation_job_dispatches SET state='acknowledged',claim_token=NULL,lease_expires_at=NULL,acknowledged_at=? WHERE id=? AND state='claimed' AND attempt_count=1",
      values: [later, plan.dispatchId],
    },
    {
      label: "job-running",
      sql: "UPDATE generation_jobs SET status='running',current_step='fetch_transcript',state_version=1,event_count=2,required_event_no=2,required_event_state_version=1,updated_at=? WHERE id=? AND status='dispatch_pending' AND state_version=0 AND event_count=1",
      values: [later, plan.jobId],
    },
    insertStep("event-running", "generation_job_events", {
      generation_job_id: plan.jobId,
      event_no: 2,
      job_state_version: 1,
      attempt_number: 1,
      step_key: null,
      level: "info",
      event_code: "dispatch_acknowledged",
      message_safe: "dispatch_acknowledged",
      metadata_json_safe: JSON.stringify({ jobId: plan.jobId, eventCode: "dispatch_acknowledged", attempt: 1 }),
      elapsed_ms: 1,
      created_at: later,
    }),
  ];
}

export function receiptInsertStep(jobId: string, stepKey = "summary:1", inputFingerprint = hash("d")): GenerationStep {
  return insertStep("receipt", "generation_step_receipts", {
    generation_job_id: jobId,
    step_key: stepKey,
    task: "validate",
    effect_class: "pure",
    input_contract_version: 1,
    input_fingerprint: inputFingerprint,
    input_version: null,
    source_id: null,
    document_id: null,
    document_sha256: null,
    confirmation_id: null,
    metadata_revision: 1,
    binding_id: null,
    ticket_id: null,
    state: "claimed",
    attempt_count: 1,
    claim_token: `claim:${crypto.randomUUID()}`,
    lease_expires_at: "2026-09-17T00:05:00.000Z",
    provider_request_id_opaque: null,
    result_kind: null,
    result_id: null,
    result_version: null,
    result_fingerprint: null,
    error_code: null,
    error_message_safe: null,
    error_fingerprint: null,
    started_at: later,
    updated_at: later,
    completed_at: null,
  });
}

export function receiptSuccessPlan(jobId: string, stepKey = "summary:1"): GenerationStep[] {
  const completedAt = "2026-09-17T00:00:02.000Z";
  return [
    {
      label: "receipt-succeed",
      sql: "UPDATE generation_step_receipts SET state='succeeded',claim_token=NULL,lease_expires_at=NULL,result_kind='validation_result',result_id=?,result_version=1,result_fingerprint=?,updated_at=?,completed_at=? WHERE generation_job_id=? AND step_key=? AND state='claimed' AND attempt_count=1",
      values: [`result:${jobId}`, hash("e"), completedAt, completedAt, jobId, stepKey],
    },
    {
      label: "job-step-succeeded",
      sql: "UPDATE generation_jobs SET current_step='intent_review',state_version=2,event_count=3,required_event_no=3,required_event_state_version=2,updated_at=? WHERE id=? AND status='running' AND state_version=1 AND event_count=2",
      values: [completedAt, jobId],
    },
    insertStep("event-step-succeeded", "generation_job_events", {
      generation_job_id: jobId,
      event_no: 3,
      job_state_version: 2,
      attempt_number: 1,
      step_key: stepKey,
      level: "info",
      event_code: "step_succeeded",
      message_safe: "step_succeeded",
      metadata_json_safe: JSON.stringify({ jobId, eventCode: "step_succeeded", stepKey, attempt: 1 }),
      elapsed_ms: 1,
      created_at: completedAt,
    }),
  ];
}

export const generationTestHash = hash;
