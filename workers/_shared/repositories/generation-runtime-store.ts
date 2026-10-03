import { z } from "zod";

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const idSchema = z.string().min(1).max(128);
const timestampSchema = z.iso.datetime();
const nullableIdSchema = idSchema.nullable();

const jobStatusSchema = z.enum([
  "queued",
  "dispatch_pending",
  "running",
  "awaiting_transcript_review",
  "awaiting_intent_review",
  "review_ready",
  "needs_revision",
  "stale",
  "failed",
]);
const waitKindSchema = z.enum(["transcript_review", "intent_review"]);
const dispatchKindSchema = z.enum(["start", "resume_transcript_review", "resume_intent_review"]);
const dispatchStateSchema = z.enum([
  "pending",
  "claimed",
  "acknowledged",
  "retryable_failed",
  "uncertain",
  "terminal_failed",
  "stale",
]);
const stepStateSchema = z.enum([
  "claimed",
  "effect_started",
  "succeeded",
  "retryable_failed",
  "uncertain",
  "terminal_failed",
  "stale",
]);
const taskSchema = z.enum([
  "fetch_transcript",
  "correction",
  "intent_analysis",
  "intent_critique",
  "summary",
  "child_candidates",
  "adult_candidates",
  "place_grid",
  "validate",
  "final_audit",
]);
const effectClassSchema = z.enum(["pure", "source_network", "ai_provider", "domain_write"]);
const aiResultTasks = new Set<GenerationTask>([
  "correction",
  "intent_analysis",
  "intent_critique",
  "summary",
  "child_candidates",
  "adult_candidates",
  "final_audit",
]);

const jobRowSchema = z.strictObject({
  id: idSchema,
  sermon_id: idSchema,
  quiz_set_id: idSchema,
  request_scope: z.enum(["full", "transcript_correction", "intent", "summary", "child", "adult", "single_entry", "final_audit"]),
  request_contract_version: z.literal(1),
  request_key: idSchema,
  request_fingerprint: digestSchema,
  workflow_instance_id: idSchema,
  start_input_state: z.enum(["absent", "present"]),
  start_input_version: z.number().int().positive().nullable(),
  start_source_id: nullableIdSchema,
  start_document_id: nullableIdSchema,
  start_document_sha256: digestSchema.nullable(),
  start_confirmation_id: nullableIdSchema,
  start_metadata_revision: z.number().int().positive(),
  settings_revision: z.number().int().positive().nullable(),
  selection_revision: z.number().int().positive().nullable(),
  status: jobStatusSchema,
  current_step: idSchema,
  state_version: z.number().int().nonnegative(),
  event_count: z.number().int().positive(),
  wait_kind: waitKindSchema.nullable(),
  wait_generation: z.number().int().nonnegative(),
  wait_input_fingerprint: digestSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
});

const dispatchRowSchema = z.strictObject({
  id: idSchema,
  generation_job_id: idSchema,
  dispatch_no: z.number().int().positive(),
  kind: dispatchKindSchema,
  dispatch_key: idSchema,
  workflow_instance_id: idSchema,
  job_state_version: z.number().int().nonnegative(),
  wait_generation: z.number().int().positive().nullable(),
  payload_fingerprint: digestSchema,
  state: dispatchStateSchema,
  attempt_count: z.number().int().nonnegative(),
  claim_token: nullableIdSchema,
  lease_expires_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  last_attempted_at: timestampSchema.nullable(),
  acknowledged_at: timestampSchema.nullable(),
});

const receiptRowSchema = z.strictObject({
  generation_job_id: idSchema,
  step_key: idSchema,
  task: taskSchema,
  effect_class: effectClassSchema,
  input_contract_version: z.literal(1),
  input_fingerprint: digestSchema,
  input_version: z.number().int().positive().nullable(),
  source_id: nullableIdSchema,
  document_id: nullableIdSchema,
  document_sha256: digestSchema.nullable(),
  confirmation_id: nullableIdSchema,
  metadata_revision: z.number().int().positive().nullable(),
  binding_id: nullableIdSchema,
  ticket_id: nullableIdSchema,
  state: stepStateSchema,
  attempt_count: z.number().int().positive(),
  claim_token: nullableIdSchema,
  lease_expires_at: timestampSchema.nullable(),
  provider_request_id_opaque: digestSchema.nullable(),
  result_kind: z.string().min(1).max(64).nullable(),
  result_id: nullableIdSchema,
  result_version: z.number().int().positive().nullable(),
  result_fingerprint: digestSchema.nullable(),
  started_at: timestampSchema,
  updated_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
});

export type GenerationJobRecord = z.infer<typeof jobRowSchema>;
export type GenerationDispatchRecord = z.infer<typeof dispatchRowSchema>;
export type GenerationStepReceiptRecord = z.infer<typeof receiptRowSchema>;
export type GenerationTask = z.infer<typeof taskSchema>;
export type GenerationEffectClass = z.infer<typeof effectClassSchema>;

type FailureCode =
  | "GENERATION_INVALID"
  | "GENERATION_STORAGE_UNAVAILABLE"
  | "GENERATION_STORAGE_CORRUPT"
  | "GENERATION_REQUEST_CONFLICT"
  | "GENERATION_ACTIVE_JOB_CONFLICT"
  | "GENERATION_DISPATCH_CONFLICT"
  | "GENERATION_STEP_INPUT_MISMATCH"
  | "GENERATION_STEP_BUSY"
  | "GENERATION_STEP_UNCERTAIN"
  | "GENERATION_STATE_CONFLICT";

export class GenerationRuntimeStoreError extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}

function fail(code: FailureCode): never {
  throw new GenerationRuntimeStoreError(code);
}

function resultChanges(result: unknown): number | null {
  if (!result || typeof result !== "object" || Reflect.get(result, "success") !== true) return null;
  const meta = Reflect.get(result, "meta");
  if (!meta || typeof meta !== "object") return null;
  const changes = Reflect.get(meta, "changes");
  return typeof changes === "number" && Number.isSafeInteger(changes) && changes >= 0 ? changes : null;
}

function exactBatch(results: unknown, expected: readonly number[]): boolean {
  if (!Array.isArray(results)) return false;
  const changes = Array.from(results, resultChanges);
  return changes.length === expected.length && changes.every((value, index) => value === expected[index]);
}

async function oneRow<T>(
  statement: D1PreparedStatement,
  schema: z.ZodType<T>,
): Promise<T | null> {
  try {
    const result = await statement.all();
    if (!result.success || !Array.isArray(result.results) || result.results.length > 1) {
      return fail("GENERATION_STORAGE_UNAVAILABLE");
    }
    if (result.results.length === 0) return null;
    const parsed = schema.safeParse(result.results[0]);
    return parsed.success ? parsed.data : fail("GENERATION_STORAGE_CORRUPT");
  } catch (error) {
    if (error instanceof GenerationRuntimeStoreError) throw error;
    return fail("GENERATION_STORAGE_UNAVAILABLE");
  }
}

const jobColumns = `id,sermon_id,quiz_set_id,request_scope,request_contract_version,request_key,request_fingerprint,
  workflow_instance_id,start_input_state,start_input_version,start_source_id,start_document_id,start_document_sha256,
  start_confirmation_id,start_metadata_revision,settings_revision,selection_revision,status,current_step,state_version,
  event_count,wait_kind,wait_generation,wait_input_fingerprint,created_at,updated_at,completed_at`;
const dispatchColumns = `id,generation_job_id,dispatch_no,kind,dispatch_key,workflow_instance_id,job_state_version,
  wait_generation,payload_fingerprint,state,attempt_count,claim_token,lease_expires_at,created_at,last_attempted_at,acknowledged_at`;
const receiptColumns = `generation_job_id,step_key,task,effect_class,input_contract_version,input_fingerprint,
  input_version,source_id,document_id,document_sha256,confirmation_id,metadata_revision,binding_id,ticket_id,state,
  attempt_count,claim_token,lease_expires_at,provider_request_id_opaque,result_kind,result_id,result_version,
  result_fingerprint,started_at,updated_at,completed_at`;

const createJobSchema = z.strictObject({
  id: idSchema,
  sermonId: idSchema,
  quizSetId: idSchema,
  requestScope: jobRowSchema.shape.request_scope,
  requestKey: idSchema,
  requestFingerprint: digestSchema,
  workflowInstanceId: idSchema,
  startInput: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("absent") }),
    z.strictObject({
      state: z.literal("present"),
      version: z.number().int().positive(),
      sourceId: idSchema,
      documentId: idSchema,
      documentSha256: digestSchema,
      confirmationId: nullableIdSchema,
    }),
  ]),
  startMetadataRevision: z.number().int().positive(),
  settingsRevision: z.number().int().positive().nullable(),
  selectionRevision: z.number().int().positive().nullable(),
  actorId: digestSchema,
  createdAt: timestampSchema,
  dispatchId: idSchema,
  dispatchKey: idSchema,
  dispatchPayloadFingerprint: digestSchema,
});

export type CreateGenerationJobCommand = z.input<typeof createJobSchema>;

const stepClaimSchema = z.strictObject({
  jobId: idSchema,
  stepKey: idSchema,
  task: taskSchema,
  effectClass: effectClassSchema,
  inputFingerprint: digestSchema,
  inputVersion: z.number().int().positive().nullable(),
  sourceId: nullableIdSchema,
  documentId: nullableIdSchema,
  documentSha256: digestSchema.nullable(),
  confirmationId: nullableIdSchema,
  metadataRevision: z.number().int().positive().nullable(),
  bindingId: nullableIdSchema,
  ticketId: nullableIdSchema,
  claimToken: idSchema,
  leaseExpiresAt: timestampSchema,
  now: timestampSchema,
});

export type ClaimGenerationStepCommand = z.input<typeof stepClaimSchema>;

export type GenerationResultReference = {
  kind: string;
  id: string;
  version: number;
  fingerprint: string;
};

export type GenerationResultProbe = "exact" | "absent" | "mismatch" | "unavailable";

export interface GenerationDomainResultPort {
  prepareInsert(database: D1Database, reference: GenerationResultReference): D1PreparedStatement;
  probe(database: D1Database, reference: GenerationResultReference): Promise<GenerationResultProbe>;
}

export type CompleteGenerationStepCommand = {
  jobId: string;
  stepKey: string;
  inputFingerprint: string;
  expectedAttempt: number;
  nextStep: string;
  now: string;
  result: GenerationResultReference;
  resultPort: GenerationDomainResultPort;
};

function sameRequest(job: GenerationJobRecord, command: z.output<typeof createJobSchema>): boolean {
  return job.request_key === command.requestKey && job.request_fingerprint === command.requestFingerprint &&
    job.sermon_id === command.sermonId && job.quiz_set_id === command.quizSetId &&
    job.request_scope === command.requestScope && job.start_metadata_revision === command.startMetadataRevision &&
    job.settings_revision === command.settingsRevision && job.selection_revision === command.selectionRevision;
}

function sameStep(receipt: GenerationStepReceiptRecord, command: z.output<typeof stepClaimSchema>): boolean {
  return receipt.input_fingerprint === command.inputFingerprint && receipt.task === command.task &&
    receipt.effect_class === command.effectClass && receipt.input_version === command.inputVersion &&
    receipt.source_id === command.sourceId && receipt.document_id === command.documentId &&
    receipt.document_sha256 === command.documentSha256 && receipt.confirmation_id === command.confirmationId &&
    receipt.metadata_revision === command.metadataRevision && receipt.binding_id === command.bindingId &&
    receipt.ticket_id === command.ticketId;
}

function resultFromReceipt(receipt: GenerationStepReceiptRecord): GenerationResultReference {
  if (receipt.state !== "succeeded" || receipt.result_kind === null || receipt.result_id === null ||
    receipt.result_version === null || receipt.result_fingerprint === null) {
    return fail("GENERATION_STORAGE_CORRUPT");
  }
  return {
    kind: receipt.result_kind,
    id: receipt.result_id,
    version: receipt.result_version,
    fingerprint: receipt.result_fingerprint,
  };
}

export function createGenerationRuntimeStore(database: D1Database) {
  async function jobById(id: string): Promise<GenerationJobRecord | null> {
    if (!idSchema.safeParse(id).success) return fail("GENERATION_INVALID");
    return oneRow(database.prepare(`SELECT ${jobColumns} FROM generation_jobs WHERE id=?`).bind(id), jobRowSchema);
  }

  async function jobByRequestKey(requestKey: string): Promise<GenerationJobRecord | null> {
    if (!idSchema.safeParse(requestKey).success) return fail("GENERATION_INVALID");
    return oneRow(database.prepare(`SELECT ${jobColumns} FROM generation_jobs WHERE request_key=?`).bind(requestKey), jobRowSchema);
  }

  async function dispatchById(id: string): Promise<GenerationDispatchRecord | null> {
    if (!idSchema.safeParse(id).success) return fail("GENERATION_INVALID");
    return oneRow(database.prepare(`SELECT ${dispatchColumns} FROM generation_job_dispatches WHERE id=?`).bind(id), dispatchRowSchema);
  }

  async function dispatchByKey(key: string): Promise<GenerationDispatchRecord | null> {
    if (!idSchema.safeParse(key).success) return fail("GENERATION_INVALID");
    return oneRow(database.prepare(`SELECT ${dispatchColumns} FROM generation_job_dispatches WHERE dispatch_key=?`).bind(key), dispatchRowSchema);
  }

  async function receiptByKey(jobId: string, stepKey: string): Promise<GenerationStepReceiptRecord | null> {
    if (!idSchema.safeParse(jobId).success || !idSchema.safeParse(stepKey).success) return fail("GENERATION_INVALID");
    return oneRow(database.prepare(`SELECT ${receiptColumns} FROM generation_step_receipts WHERE generation_job_id=? AND step_key=?`)
      .bind(jobId, stepKey), receiptRowSchema);
  }

  async function verifyInitialEnvelope(job: GenerationJobRecord): Promise<void> {
    const dispatch = await oneRow(database.prepare(`SELECT ${dispatchColumns} FROM generation_job_dispatches
      WHERE generation_job_id=? AND dispatch_no=1`).bind(job.id), dispatchRowSchema);
    const event = await database.prepare(`SELECT event_code,job_state_version,event_no FROM generation_job_events
      WHERE generation_job_id=? AND event_no=1`).bind(job.id).all();
    if (!dispatch || dispatch.kind !== "start" || dispatch.workflow_instance_id !== job.workflow_instance_id ||
      !event.success || event.results.length !== 1 || event.results[0]?.event_code !== "job_created" ||
      event.results[0]?.job_state_version !== 0 || event.results[0]?.event_no !== 1) {
      return fail("GENERATION_STORAGE_CORRUPT");
    }
  }

  async function replayCreated(command: z.output<typeof createJobSchema>): Promise<GenerationJobRecord | null> {
    const existing = await jobByRequestKey(command.requestKey);
    if (!existing) return null;
    if (!sameRequest(existing, command)) return fail("GENERATION_REQUEST_CONFLICT");
    await verifyInitialEnvelope(existing);
    return existing;
  }

  async function createJob(raw: CreateGenerationJobCommand): Promise<{ outcome: "created" | "replayed"; job: GenerationJobRecord }> {
    const parsed = createJobSchema.safeParse(raw);
    if (!parsed.success) return fail("GENERATION_INVALID");
    const command = parsed.data;
    const replay = await replayCreated(command);
    if (replay) return { outcome: "replayed", job: replay };
    const present = command.startInput.state === "present" ? command.startInput : null;
    const statements = [
      database.prepare(`INSERT INTO generation_jobs (
        id,sermon_id,quiz_set_id,request_scope,request_contract_version,request_key,request_fingerprint,
        workflow_instance_id,start_input_state,start_input_version,start_source_id,start_document_id,start_document_sha256,
        start_confirmation_id,start_metadata_revision,settings_revision,selection_revision,status,current_step,state_version,
        event_count,wait_kind,wait_generation,wait_input_fingerprint,error_code,error_message_safe,error_fingerprint,
        created_by_actor_id,created_at,updated_at,completed_at,required_event_no,required_event_state_version
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'dispatch_pending','dispatch',0,1,NULL,0,NULL,NULL,NULL,NULL,?,?,?,NULL,1,0)`)
        .bind(command.id, command.sermonId, command.quizSetId, command.requestScope, 1, command.requestKey,
          command.requestFingerprint, command.workflowInstanceId, command.startInput.state, present?.version ?? null,
          present?.sourceId ?? null, present?.documentId ?? null, present?.documentSha256 ?? null,
          present?.confirmationId ?? null, command.startMetadataRevision, command.settingsRevision,
          command.selectionRevision, command.actorId, command.createdAt, command.createdAt),
      database.prepare(`INSERT INTO generation_job_dispatches (
        id,generation_job_id,dispatch_no,kind,dispatch_key,workflow_instance_id,job_state_version,wait_generation,
        payload_fingerprint,state,attempt_count,claim_token,lease_expires_at,error_code,error_message_safe,
        error_fingerprint,created_at,last_attempted_at,acknowledged_at
      ) VALUES (?,?,1,'start',?,?,0,NULL,?,'pending',0,NULL,NULL,NULL,NULL,NULL,?,NULL,NULL)`)
        .bind(command.dispatchId, command.id, command.dispatchKey, command.workflowInstanceId,
          command.dispatchPayloadFingerprint, command.createdAt),
      database.prepare(`INSERT INTO generation_job_events (
        generation_job_id,event_no,job_state_version,attempt_number,step_key,level,event_code,message_safe,
        metadata_json_safe,elapsed_ms,created_at
      ) VALUES (?,1,0,1,NULL,'info','job_created','job_created',?,0,?)`)
        .bind(command.id, JSON.stringify({ jobId: command.id, eventCode: "job_created", attempt: 1 }), command.createdAt),
    ];
    try {
      const results = await database.batch(statements);
      if (!exactBatch(results, [1, 1, 1])) {
        const recovered = await replayCreated(command);
        if (!recovered) return fail("GENERATION_STORAGE_UNAVAILABLE");
        return { outcome: "replayed", job: recovered };
      }
    } catch {
      const recovered = await replayCreated(command);
      if (!recovered) return fail("GENERATION_ACTIVE_JOB_CONFLICT");
      return { outcome: "replayed", job: recovered };
    }
    const created = await jobById(command.id);
    if (!created || !sameRequest(created, command)) return fail("GENERATION_STORAGE_CORRUPT");
    return { outcome: "created", job: created };
  }

  async function claimDispatch(id: string, claimToken: string, leaseExpiresAt: string, now: string): Promise<
    { outcome: "claimed"; dispatch: GenerationDispatchRecord; job: GenerationJobRecord } |
    { outcome: "acknowledged" | "uncertain" | "busy" | "terminal"; dispatch: GenerationDispatchRecord; job: GenerationJobRecord }
  > {
    if (![id, claimToken].every((value) => idSchema.safeParse(value).success) ||
      !timestampSchema.safeParse(leaseExpiresAt).success || !timestampSchema.safeParse(now).success) {
      return fail("GENERATION_INVALID");
    }
    let dispatch = await dispatchById(id);
    if (!dispatch) return fail("GENERATION_DISPATCH_CONFLICT");
    const job = await jobById(dispatch.generation_job_id);
    if (!job || job.workflow_instance_id !== dispatch.workflow_instance_id) return fail("GENERATION_STORAGE_CORRUPT");
    if (dispatch.state === "acknowledged") return { outcome: "acknowledged", dispatch, job };
    if (dispatch.state === "uncertain") return { outcome: "uncertain", dispatch, job };
    if (dispatch.state === "terminal_failed" || dispatch.state === "stale") return { outcome: "terminal", dispatch, job };
    if (dispatch.state === "claimed") return { outcome: "busy", dispatch, job };
    if (dispatch.state !== "pending" && dispatch.state !== "retryable_failed") return fail("GENERATION_STORAGE_CORRUPT");
    const result = await database.prepare(`UPDATE generation_job_dispatches SET state='claimed',attempt_count=attempt_count+1,
      claim_token=?,lease_expires_at=?,error_code=NULL,error_message_safe=NULL,error_fingerprint=NULL,last_attempted_at=?
      WHERE id=? AND state=? AND attempt_count=?`).bind(claimToken, leaseExpiresAt, now, id, dispatch.state, dispatch.attempt_count).run();
    if (resultChanges(result) !== 1) {
      dispatch = await dispatchById(id);
      if (!dispatch) return fail("GENERATION_STORAGE_CORRUPT");
      return { outcome: dispatch.state === "acknowledged" ? "acknowledged" : dispatch.state === "uncertain" ? "uncertain" : "busy", dispatch, job };
    }
    dispatch = await dispatchById(id);
    if (!dispatch || dispatch.state !== "claimed" || dispatch.claim_token !== claimToken) return fail("GENERATION_STORAGE_CORRUPT");
    return { outcome: "claimed", dispatch, job };
  }

  async function acknowledgeDispatch(id: string, expectedAttempt: number, now: string): Promise<"acknowledged" | "replayed"> {
    if (!idSchema.safeParse(id).success || !Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1 ||
      !timestampSchema.safeParse(now).success) return fail("GENERATION_INVALID");
    const dispatch = await dispatchById(id);
    if (!dispatch) return fail("GENERATION_DISPATCH_CONFLICT");
    if (dispatch.state === "acknowledged") return "replayed";
    if (!(["claimed", "uncertain"] as const).includes(dispatch.state as "claimed" | "uncertain") ||
      dispatch.attempt_count !== expectedAttempt) return fail("GENERATION_DISPATCH_CONFLICT");
    const job = await jobById(dispatch.generation_job_id);
    if (!job || job.workflow_instance_id !== dispatch.workflow_instance_id || job.state_version !== dispatch.job_state_version) {
      return fail("GENERATION_STATE_CONFLICT");
    }
    const expectedStatus = dispatch.kind === "start" ? "dispatch_pending" :
      dispatch.kind === "resume_transcript_review" ? "awaiting_transcript_review" : "awaiting_intent_review";
    const nextStep = dispatch.kind === "start" ? "fetch_transcript" : dispatch.kind;
    const nextStateVersion = job.state_version + 1;
    const nextEvent = job.event_count + 1;
    const statements = [
      database.prepare(`UPDATE generation_job_dispatches SET state='acknowledged',claim_token=NULL,lease_expires_at=NULL,
        error_code=NULL,error_message_safe=NULL,error_fingerprint=NULL,acknowledged_at=?
        WHERE id=? AND state=? AND attempt_count=?`).bind(now, id, dispatch.state, expectedAttempt),
      database.prepare(`UPDATE generation_jobs SET status='running',current_step=?,state_version=?,event_count=?,
        wait_kind=NULL,wait_input_fingerprint=NULL,required_event_no=?,required_event_state_version=?,updated_at=?
        WHERE id=? AND status=? AND state_version=? AND event_count=?`).bind(nextStep, nextStateVersion, nextEvent,
          nextEvent, nextStateVersion, now, job.id, expectedStatus, job.state_version, job.event_count),
      database.prepare(`INSERT INTO generation_job_events (
        generation_job_id,event_no,job_state_version,attempt_number,step_key,level,event_code,message_safe,
        metadata_json_safe,elapsed_ms,created_at
      ) VALUES (?,?,?,?,NULL,'info','dispatch_acknowledged','dispatch_acknowledged',?,NULL,?)`)
        .bind(job.id, nextEvent, nextStateVersion, expectedAttempt,
          JSON.stringify({ jobId: job.id, eventCode: "dispatch_acknowledged", attempt: expectedAttempt }), now),
    ];
    try {
      const results = await database.batch(statements);
      if (exactBatch(results, [1, 1, 1])) return "acknowledged";
    } catch { /* Resolve only the same dispatch/job/event below. */ }
    const afterDispatch = await dispatchById(id);
    const afterJob = await jobById(job.id);
    if (afterDispatch?.state === "acknowledged" && afterDispatch.acknowledged_at === now &&
      afterJob?.status === "running" && afterJob.state_version === nextStateVersion && afterJob.event_count === nextEvent) {
      return "replayed";
    }
    return fail("GENERATION_STATE_CONFLICT");
  }

  async function markDispatchRetryableOrUncertain(
    id: string,
    expectedAttempt: number,
    state: "retryable_failed" | "uncertain",
    errorCode: "GENERATION_WORKFLOW_MISSING" | "GENERATION_WORKFLOW_UNCERTAIN",
    errorFingerprint: string,
    now: string,
  ): Promise<void> {
    if (!idSchema.safeParse(id).success || !Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1 ||
      !digestSchema.safeParse(errorFingerprint).success || !timestampSchema.safeParse(now).success) return fail("GENERATION_INVALID");
    const result = await database.prepare(`UPDATE generation_job_dispatches SET state=?,claim_token=NULL,lease_expires_at=NULL,
      error_code=?,error_message_safe=?,error_fingerprint=?,last_attempted_at=?
      WHERE id=? AND state='claimed' AND attempt_count=?`)
      .bind(state, errorCode, errorCode, errorFingerprint, now, id, expectedAttempt).run();
    if (resultChanges(result) !== 1) return fail("GENERATION_DISPATCH_CONFLICT");
  }

  async function failDispatchMismatch(id: string, expectedAttempt: number, fingerprint: string, now: string): Promise<void> {
    if (!digestSchema.safeParse(fingerprint).success || !timestampSchema.safeParse(now).success) return fail("GENERATION_INVALID");
    const dispatch = await dispatchById(id);
    if (!dispatch || dispatch.attempt_count !== expectedAttempt || !(["claimed", "uncertain"] as const).includes(dispatch.state as "claimed" | "uncertain")) {
      return fail("GENERATION_DISPATCH_CONFLICT");
    }
    const job = await jobById(dispatch.generation_job_id);
    if (!job || job.state_version !== dispatch.job_state_version) return fail("GENERATION_STATE_CONFLICT");
    const nextState = job.state_version + 1;
    const nextEvent = job.event_count + 1;
    const code = "GENERATION_WORKFLOW_MISMATCH";
    const statements = [
      database.prepare(`UPDATE generation_job_dispatches SET state='terminal_failed',claim_token=NULL,lease_expires_at=NULL,
        error_code=?,error_message_safe=?,error_fingerprint=?,last_attempted_at=?
        WHERE id=? AND state=? AND attempt_count=?`).bind(code, code, fingerprint, now, id, dispatch.state, expectedAttempt),
      database.prepare(`UPDATE generation_jobs SET status='failed',current_step='dispatch',state_version=?,event_count=?,
        wait_kind=NULL,wait_input_fingerprint=NULL,error_code=?,error_message_safe=?,error_fingerprint=?,completed_at=?,
        required_event_no=?,required_event_state_version=?,updated_at=?
        WHERE id=? AND state_version=? AND event_count=?`).bind(nextState, nextEvent, code, code, fingerprint, now,
          nextEvent, nextState, now, job.id, job.state_version, job.event_count),
      database.prepare(`INSERT INTO generation_job_events (
        generation_job_id,event_no,job_state_version,attempt_number,step_key,level,event_code,message_safe,
        metadata_json_safe,elapsed_ms,created_at
      ) VALUES (?,?,?, ?,NULL,'error','job_failed','job_failed',?,NULL,?)`)
        .bind(job.id, nextEvent, nextState, expectedAttempt,
          JSON.stringify({ jobId: job.id, eventCode: "job_failed", attempt: expectedAttempt }), now),
    ];
    const results = await database.batch(statements);
    if (!exactBatch(results, [1, 1, 1])) return fail("GENERATION_STATE_CONFLICT");
  }

  async function claimStep(raw: ClaimGenerationStepCommand): Promise<
    { outcome: "claimed"; receipt: GenerationStepReceiptRecord } |
    { outcome: "replayed"; receipt: GenerationStepReceiptRecord; result: GenerationResultReference } |
    { outcome: "busy" | "uncertain" | "terminal"; receipt: GenerationStepReceiptRecord }
  > {
    const parsed = stepClaimSchema.safeParse(raw);
    if (!parsed.success) return fail("GENERATION_INVALID");
    const command = parsed.data;
    const job = await jobById(command.jobId);
    if (!job || !["running", "awaiting_transcript_review", "awaiting_intent_review"].includes(job.status)) {
      return fail("GENERATION_STATE_CONFLICT");
    }
    let existing = await receiptByKey(command.jobId, command.stepKey);
    if (existing) {
      if (!sameStep(existing, command)) return fail("GENERATION_STEP_INPUT_MISMATCH");
      if (existing.state === "succeeded") return { outcome: "replayed", receipt: existing, result: resultFromReceipt(existing) };
      if (existing.state === "effect_started" || existing.state === "uncertain") return { outcome: "uncertain", receipt: existing };
      if (existing.state === "terminal_failed" || existing.state === "stale") return { outcome: "terminal", receipt: existing };
      if (existing.state === "claimed" && existing.lease_expires_at !== null && existing.lease_expires_at > command.now) {
        return { outcome: "busy", receipt: existing };
      }
      if (existing.state === "claimed") {
        const expiredCode = "GENERATION_STEP_LEASE_EXPIRED";
        const expiredFingerprint = "0".repeat(64);
        const statements = [
          database.prepare(`UPDATE generation_step_receipts SET state='retryable_failed',claim_token=NULL,lease_expires_at=NULL,
            error_code=?,error_message_safe=?,error_fingerprint=?,updated_at=?
            WHERE generation_job_id=? AND step_key=? AND state='claimed' AND attempt_count=?`)
            .bind(expiredCode, expiredCode, expiredFingerprint, command.now, command.jobId, command.stepKey, existing.attempt_count),
          database.prepare(`UPDATE generation_step_receipts SET state='claimed',attempt_count=attempt_count+1,claim_token=?,
            lease_expires_at=?,error_code=NULL,error_message_safe=NULL,error_fingerprint=NULL,updated_at=?
            WHERE generation_job_id=? AND step_key=? AND state='retryable_failed' AND attempt_count=?`)
            .bind(command.claimToken, command.leaseExpiresAt, command.now, command.jobId, command.stepKey, existing.attempt_count),
        ];
        const results = await database.batch(statements);
        if (!exactBatch(results, [1, 1])) return fail("GENERATION_STEP_BUSY");
      } else if (existing.state === "retryable_failed") {
        const result = await database.prepare(`UPDATE generation_step_receipts SET state='claimed',attempt_count=attempt_count+1,
          claim_token=?,lease_expires_at=?,error_code=NULL,error_message_safe=NULL,error_fingerprint=NULL,updated_at=?
          WHERE generation_job_id=? AND step_key=? AND state='retryable_failed' AND attempt_count=?`)
          .bind(command.claimToken, command.leaseExpiresAt, command.now, command.jobId, command.stepKey, existing.attempt_count).run();
        if (resultChanges(result) !== 1) return fail("GENERATION_STEP_BUSY");
      } else {
        return fail("GENERATION_STORAGE_CORRUPT");
      }
      existing = await receiptByKey(command.jobId, command.stepKey);
      if (!existing || existing.state !== "claimed" || existing.claim_token !== command.claimToken) return fail("GENERATION_STORAGE_CORRUPT");
      return { outcome: "claimed", receipt: existing };
    }
    const result = await database.prepare(`INSERT INTO generation_step_receipts (
      generation_job_id,step_key,task,effect_class,input_contract_version,input_fingerprint,input_version,source_id,
      document_id,document_sha256,confirmation_id,metadata_revision,binding_id,ticket_id,state,attempt_count,
      claim_token,lease_expires_at,provider_request_id_opaque,result_kind,result_id,result_version,result_fingerprint,
      error_code,error_message_safe,error_fingerprint,started_at,updated_at,completed_at
    ) VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?,?,'claimed',1,?,?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?,?,NULL)`)
      .bind(command.jobId, command.stepKey, command.task, command.effectClass, command.inputFingerprint,
        command.inputVersion, command.sourceId, command.documentId, command.documentSha256, command.confirmationId,
        command.metadataRevision, command.bindingId, command.ticketId, command.claimToken, command.leaseExpiresAt,
        command.now, command.now).run();
    if (resultChanges(result) !== 1) {
      existing = await receiptByKey(command.jobId, command.stepKey);
      if (!existing) return fail("GENERATION_STEP_BUSY");
      if (!sameStep(existing, command)) return fail("GENERATION_STEP_INPUT_MISMATCH");
      return { outcome: "busy", receipt: existing };
    }
    existing = await receiptByKey(command.jobId, command.stepKey);
    if (!existing) return fail("GENERATION_STORAGE_CORRUPT");
    return { outcome: "claimed", receipt: existing };
  }

  async function markStepEffectStarted(
    jobId: string,
    stepKey: string,
    expectedAttempt: number,
    claimToken: string,
    providerRequestIdOpaque: string | null,
    now: string,
  ): Promise<void> {
    if (![jobId, stepKey, claimToken].every((value) => idSchema.safeParse(value).success) ||
      !Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1 ||
      !digestSchema.nullable().safeParse(providerRequestIdOpaque).success || !timestampSchema.safeParse(now).success) {
      return fail("GENERATION_INVALID");
    }
    const result = await database.prepare(`UPDATE generation_step_receipts SET state='effect_started',
      provider_request_id_opaque=?,updated_at=? WHERE generation_job_id=? AND step_key=? AND state='claimed'
      AND attempt_count=? AND claim_token=?`).bind(providerRequestIdOpaque, now, jobId, stepKey, expectedAttempt, claimToken).run();
    if (resultChanges(result) !== 1) return fail("GENERATION_STEP_BUSY");
  }

  async function markStepUncertain(jobId: string, stepKey: string, expectedAttempt: number, now: string): Promise<void> {
    if (![jobId, stepKey].every((value) => idSchema.safeParse(value).success) ||
      !Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1 || !timestampSchema.safeParse(now).success) {
      return fail("GENERATION_INVALID");
    }
    const code = "GENERATION_STEP_UNCERTAIN";
    const result = await database.prepare(`UPDATE generation_step_receipts SET state='uncertain',claim_token=NULL,
      lease_expires_at=NULL,error_code=?,error_message_safe=?,error_fingerprint=?,updated_at=?
      WHERE generation_job_id=? AND step_key=? AND state='effect_started' AND attempt_count=?`)
      .bind(code, code, "0".repeat(64), now, jobId, stepKey, expectedAttempt).run();
    if (resultChanges(result) !== 1) return fail("GENERATION_STEP_UNCERTAIN");
  }

  async function completeStep(raw: CompleteGenerationStepCommand): Promise<"succeeded" | "replayed"> {
    const commandSchema = z.strictObject({
      jobId: idSchema,
      stepKey: idSchema,
      inputFingerprint: digestSchema,
      expectedAttempt: z.number().int().positive(),
      nextStep: idSchema,
      now: timestampSchema,
      result: z.strictObject({ kind: z.string().min(1).max(64), id: idSchema, version: z.number().int().positive(), fingerprint: digestSchema }),
    });
    const { resultPort, ...candidate } = raw;
    const parsed = commandSchema.safeParse(candidate);
    if (!parsed.success || !resultPort || typeof resultPort.prepareInsert !== "function" || typeof resultPort.probe !== "function") {
      return fail("GENERATION_INVALID");
    }
    const command = { ...parsed.data, resultPort };
    const receipt = await receiptByKey(command.jobId, command.stepKey);
    if (!receipt || receipt.input_fingerprint !== command.inputFingerprint) return fail("GENERATION_STEP_INPUT_MISMATCH");
    // 0011 AI results require their task-specific payload, usage, link, receipt,
    // and job event adapter. The generic P5-33 port remains only for non-AI
    // domain results such as validate.
    if (aiResultTasks.has(receipt.task)) return fail("GENERATION_INVALID");
    if (receipt.state === "succeeded") {
      const reference = resultFromReceipt(receipt);
      const probe = await command.resultPort.probe(database, command.result);
      if (JSON.stringify(reference) === JSON.stringify(command.result) && probe === "exact") return "replayed";
      return fail("GENERATION_STEP_UNCERTAIN");
    }
    if (!(["claimed", "effect_started"] as const).includes(receipt.state as "claimed" | "effect_started") ||
      receipt.attempt_count !== command.expectedAttempt) return fail("GENERATION_STEP_UNCERTAIN");
    const job = await jobById(command.jobId);
    if (!job || job.status !== "running") return fail("GENERATION_STATE_CONFLICT");
    const nextState = job.state_version + 1;
    const nextEvent = job.event_count + 1;
    const statements = [
      command.resultPort.prepareInsert(database, command.result),
      database.prepare(`UPDATE generation_step_receipts SET state='succeeded',claim_token=NULL,lease_expires_at=NULL,
        result_kind=?,result_id=?,result_version=?,result_fingerprint=?,error_code=NULL,error_message_safe=NULL,
        error_fingerprint=NULL,updated_at=?,completed_at=? WHERE generation_job_id=? AND step_key=? AND state=?
        AND attempt_count=? AND input_fingerprint=?`).bind(command.result.kind, command.result.id, command.result.version,
          command.result.fingerprint, command.now, command.now, command.jobId, command.stepKey, receipt.state,
          command.expectedAttempt, command.inputFingerprint),
      database.prepare(`UPDATE generation_jobs SET current_step=?,state_version=?,event_count=?,required_event_no=?,
        required_event_state_version=?,updated_at=? WHERE id=? AND status='running' AND state_version=? AND event_count=?`)
        .bind(command.nextStep, nextState, nextEvent, nextEvent, nextState, command.now, command.jobId,
          job.state_version, job.event_count),
      database.prepare(`INSERT INTO generation_job_events (
        generation_job_id,event_no,job_state_version,attempt_number,step_key,level,event_code,message_safe,
        metadata_json_safe,elapsed_ms,created_at
      ) VALUES (?,?,?,?,?,'info','step_succeeded','step_succeeded',?,NULL,?)`)
        .bind(command.jobId, nextEvent, nextState, command.expectedAttempt, command.stepKey,
          JSON.stringify({ jobId: command.jobId, eventCode: "step_succeeded", stepKey: command.stepKey,
            attempt: command.expectedAttempt }), command.now),
    ];
    try {
      const results = await database.batch(statements);
      if (exactBatch(results, [1, 1, 1, 1])) return "succeeded";
    } catch { /* Exact own result/receipt probe below. */ }
    const after = await receiptByKey(command.jobId, command.stepKey);
    const probe = await command.resultPort.probe(database, command.result).catch(() => "unavailable" as const);
    if (after?.state === "succeeded" && JSON.stringify(resultFromReceipt(after)) === JSON.stringify(command.result) && probe === "exact") {
      return "replayed";
    }
    if (probe === "absent" && after?.state === receipt.state) return fail("GENERATION_STATE_CONFLICT");
    return fail("GENERATION_STEP_UNCERTAIN");
  }

  async function enterWait(
    jobId: string,
    expectedStateVersion: number,
    kind: z.infer<typeof waitKindSchema>,
    waitInputFingerprint: string,
    now: string,
  ): Promise<GenerationJobRecord> {
    if (!idSchema.safeParse(jobId).success || !Number.isSafeInteger(expectedStateVersion) || expectedStateVersion < 0 ||
      !waitKindSchema.safeParse(kind).success || !digestSchema.safeParse(waitInputFingerprint).success ||
      !timestampSchema.safeParse(now).success) return fail("GENERATION_INVALID");
    const job = await jobById(jobId);
    if (!job || job.status !== "running" || job.state_version !== expectedStateVersion) return fail("GENERATION_STATE_CONFLICT");
    const nextState = job.state_version + 1;
    const nextEvent = job.event_count + 1;
    const nextStatus = kind === "transcript_review" ? "awaiting_transcript_review" : "awaiting_intent_review";
    const statements = [
      database.prepare(`UPDATE generation_jobs SET status=?,current_step=?,state_version=?,event_count=?,wait_kind=?,
        wait_generation=wait_generation+1,wait_input_fingerprint=?,required_event_no=?,required_event_state_version=?,updated_at=?
        WHERE id=? AND status='running' AND state_version=? AND event_count=?`).bind(nextStatus, nextStatus, nextState,
          nextEvent, kind, waitInputFingerprint, nextEvent, nextState, now, jobId, job.state_version, job.event_count),
      database.prepare(`INSERT INTO generation_job_events (
        generation_job_id,event_no,job_state_version,attempt_number,step_key,level,event_code,message_safe,
        metadata_json_safe,elapsed_ms,created_at
      ) VALUES (?,?,?,1,NULL,'info','state_changed','state_changed',?,NULL,?)`)
        .bind(jobId, nextEvent, nextState, JSON.stringify({ jobId, eventCode: "state_changed", attempt: 1 }), now),
    ];
    const results = await database.batch(statements);
    if (!exactBatch(results, [1, 1])) return fail("GENERATION_STATE_CONFLICT");
    const waiting = await jobById(jobId);
    if (!waiting || waiting.status !== nextStatus) return fail("GENERATION_STORAGE_CORRUPT");
    return waiting;
  }

  async function ensureResumeDispatch(jobId: string, payloadFingerprint: string, now: string): Promise<
    { outcome: "created" | "replayed"; dispatch: GenerationDispatchRecord }
  > {
    if (!idSchema.safeParse(jobId).success || !digestSchema.safeParse(payloadFingerprint).success ||
      !timestampSchema.safeParse(now).success) return fail("GENERATION_INVALID");
    const job = await jobById(jobId);
    if (!job || !job.wait_kind || !["awaiting_transcript_review", "awaiting_intent_review"].includes(job.status)) {
      return fail("GENERATION_STATE_CONFLICT");
    }
    const kind = job.wait_kind === "transcript_review" ? "resume_transcript_review" : "resume_intent_review";
    const key = `resume:${job.id}:${job.wait_kind}:${job.wait_generation}`;
    const id = `dispatch:${job.id}:${job.wait_generation}`;
    if (key.length > 128 || id.length > 128) return fail("GENERATION_INVALID");
    const existing = await dispatchByKey(key);
    if (existing) {
      if (existing.generation_job_id !== job.id || existing.kind !== kind || existing.wait_generation !== job.wait_generation ||
        existing.workflow_instance_id !== job.workflow_instance_id || existing.payload_fingerprint !== payloadFingerprint) {
        return fail("GENERATION_DISPATCH_CONFLICT");
      }
      return { outcome: "replayed", dispatch: existing };
    }
    try {
      const result = await database.prepare(`INSERT INTO generation_job_dispatches (
        id,generation_job_id,dispatch_no,kind,dispatch_key,workflow_instance_id,job_state_version,wait_generation,
        payload_fingerprint,state,attempt_count,claim_token,lease_expires_at,error_code,error_message_safe,
        error_fingerprint,created_at,last_attempted_at,acknowledged_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'pending',0,NULL,NULL,NULL,NULL,NULL,?,NULL,NULL)`)
        .bind(id, job.id, job.wait_generation + 1, kind, key, job.workflow_instance_id, job.state_version,
          job.wait_generation, payloadFingerprint, now).run();
      if (resultChanges(result) === 1) {
        const created = await dispatchById(id);
        if (!created) return fail("GENERATION_STORAGE_CORRUPT");
        return { outcome: "created", dispatch: created };
      }
    } catch { /* Same deterministic key probe below. */ }
    const recovered = await dispatchByKey(key);
    if (!recovered || recovered.payload_fingerprint !== payloadFingerprint || recovered.generation_job_id !== job.id) {
      return fail("GENERATION_DISPATCH_CONFLICT");
    }
    return { outcome: "replayed", dispatch: recovered };
  }

  async function markJobStale(jobId: string, reasonFingerprint: string, now: string): Promise<"stale" | "replayed"> {
    if (!idSchema.safeParse(jobId).success || !digestSchema.safeParse(reasonFingerprint).success ||
      !timestampSchema.safeParse(now).success) return fail("GENERATION_INVALID");
    const job = await jobById(jobId);
    if (!job) return fail("GENERATION_STATE_CONFLICT");
    if (job.status === "stale") return "replayed";
    if (!["dispatch_pending", "running", "awaiting_transcript_review", "awaiting_intent_review"].includes(job.status)) {
      return fail("GENERATION_STATE_CONFLICT");
    }
    const nextState = job.state_version + 1;
    const nextEvent = job.event_count + 1;
    const statements = [
      database.prepare(`UPDATE generation_jobs SET status='stale',current_step='stale',state_version=?,event_count=?,
        wait_kind=NULL,wait_input_fingerprint=NULL,completed_at=?,required_event_no=?,required_event_state_version=?,updated_at=?
        WHERE id=? AND status=? AND state_version=? AND event_count=?`).bind(nextState, nextEvent, now, nextEvent,
          nextState, now, jobId, job.status, job.state_version, job.event_count),
      database.prepare(`INSERT INTO generation_job_events (
        generation_job_id,event_no,job_state_version,attempt_number,step_key,level,event_code,message_safe,
        metadata_json_safe,elapsed_ms,created_at
      ) VALUES (?,?,?,1,NULL,'warning','job_stale','job_stale',?,NULL,?)`)
        .bind(jobId, nextEvent, nextState, JSON.stringify({ jobId, eventCode: "job_stale", count: 1 }), now),
    ];
    try {
      const results = await database.batch(statements);
      if (exactBatch(results, [1, 1])) return "stale";
    } catch { /* Same job/event probe below. */ }
    const after = await jobById(jobId);
    if (after?.status === "stale" && after.state_version === nextState && after.event_count === nextEvent) return "replayed";
    return fail("GENERATION_STATE_CONFLICT");
  }

  return {
    acknowledgeDispatch,
    claimDispatch,
    claimStep,
    completeStep,
    createJob,
    dispatchById,
    enterWait,
    ensureResumeDispatch,
    failDispatchMismatch,
    jobById,
    markDispatchRetryableOrUncertain,
    markJobStale,
    markStepEffectStarted,
    markStepUncertain,
    receiptByKey,
  };
}

export type GenerationRuntimeStore = ReturnType<typeof createGenerationRuntimeStore>;
