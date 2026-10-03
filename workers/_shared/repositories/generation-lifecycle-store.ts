import { prepareInputSchema } from "../services/prepare-input-schema";
import { readTogether, generationVerifiedRead } from "./generation-read-session";
import { verifiedDomainWait } from "../services/generation-domain-wait";
import { z } from "zod";
import { generationAuthoritySnapshotSchema, generationStageSchema, type GenerationAuthoritySnapshot, type GenerationStage } from "../services/generation-bridge-contract";
import { assessFinalCapture, assessGenerationWait } from "../services/generation-bridge";
import { createHumanContentRuntimeStore } from "./human-content-runtime-store";
import { validateCurrentGenerationFinal } from "../services/generation-final-validation";
import { finalDisplayStatements } from "./generation-display-store";
import { fingerprintLifecycleValue, sameLifecycleValue as same, type ContextEnvelopeInput } from "../services/generation-context-codec";
import {
  providerModelSchema, GENERATION_STAGE_STORAGE, correctionCommandSchema, dispatchIdentitySchema, dispatchAttemptSchema, lifecycleId, lifecycleDigest, usageObservationSchema, lifecycleTime, lifecycleCount, transitionEvidenceSchema,
  type UsageObservation, type DispatchIdentity, type ReceiverReceipt, type TransitionEvidence,
} from "../services/generation-lifecycle-contract";
import { assessDispatchReceive, assessDispatchRecovery, assessCorrectionRegistration, assessGenerationFinish } from "../services/generation-lifecycle";
import { contextStorage, sqlAccess, equal, eventRow, evidenceRow, fail, parse, LifecycleStorageError, type Row } from "./generation-lifecycle-data";

import { prepareLifecycleArtifact, verifyLifecycleArtifact, type LifecycleResultInput, type LifecycleResultRef } from "./generation-lifecycle-artifact";
const positiveInteger = z.int().positive();

const resultReferenceSchema = z.strictObject({ kind: lifecycleId, id: lifecycleId, version: z.int().positive(), fingerprint: lifecycleDigest });
const outcomeProofSchema = z.strictObject({ jobId: lifecycleId, stepKey: lifecycleId, attempt: z.int().positive(),
  context: z.strictObject({ contextId: lifecycleId, fingerprint: lifecycleDigest }), outcome: z.enum(["success", "rejected", "stale", "uncertain"]),
  event: transitionEvidenceSchema, callId: lifecycleId.nullable(), usage: usageObservationSchema.nullable(), result: resultReferenceSchema.nullable(),
  beforeInputVersion: z.int().positive().nullable(), afterInputVersion: z.int().positive().nullable(), beforeContentCount: lifecycleCount, afterContentCount: lifecycleCount });
export type LifecycleOutcomeProof = z.infer<typeof outcomeProofSchema>;
const jobSchema = z.object({ id: lifecycleId, sermon_id: lifecycleId, quiz_set_id: lifecycleId,
  request_contract_version: z.literal(2), execution_contract_version: z.union([z.literal(2), z.literal(3)]), request_key: lifecycleId, request_context_id: lifecycleId,
  request_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u), workflow_instance_id: lifecycleId,
  request_scope: generationAuthoritySnapshotSchema.shape.scope, status: generationAuthoritySnapshotSchema.shape.status,
  settings_revision: z.int().positive().nullable(), selection_revision: z.int().positive().nullable(),
  current_step: lifecycleId, state_version: lifecycleCount, event_count: z.int().positive(),
  wait_generation: lifecycleCount, active_wait_generation: z.int().positive().nullable(), wait_kind: z.enum(["transcript_review", "intent_review"]).nullable(),
  required_event_no: z.int().positive(), required_event_state_version: lifecycleCount, evidence_event_no: z.int().positive(),
});
prepareInputSchema(jobSchema);
export type LifecycleJob = z.infer<typeof jobSchema>;
function logicalStage(value: unknown): GenerationStage | null {
  if (value === "dispatch") return null;
  if (typeof value === "string" && /^correction_[1-9][0-9]*$/u.test(value)) return "correction";
  return parse(generationStageSchema, value);
}
export type LifecycleRead<T> = { outcome: "present"; value: T } | { outcome: "absent" | "corrupt" | "unavailable" | "limit" };
async function safeRead<T>(read: () => Promise<T | null>): Promise<LifecycleRead<T>> {
  try { const value = await read(); return value === null ? { outcome: "absent" } : { outcome: "present", value }; }
  catch (error) { return { outcome: error instanceof LifecycleStorageError && (error.code === "unavailable" || error.code === "limit") ? error.code : "corrupt" }; }
}

async function readLifecycleJobRow(db: D1Database, id: string): Promise<LifecycleJob | null> {
    const sql = sqlAccess(db);
    parse(lifecycleId, id);
    const [row, marker] = await readTogether([
      sql.one("SELECT * FROM generation_jobs WHERE id=? LIMIT 2", [id]),
      sql.one("SELECT request_context_id FROM generation_full_v3_requests WHERE job_id=? LIMIT 2", [id]),
    ]);
    if (!row) return null;
    return decodeGenerationLifecycleJob(row, marker);
  }

/** Shared row validation for the combined display header and command reader. */
export function decodeGenerationLifecycleJob(row: Record<string, unknown>, marker: Record<string, unknown> | null): LifecycleJob {
    const j = parse(jobSchema, { ...row, execution_contract_version: marker ? 3 : 2 });
    if (marker && (marker.request_context_id !== j.request_context_id || j.request_scope !== "full")) return fail("corrupt");
    if (j.event_count !== j.state_version + 1 || j.required_event_no !== j.event_count || j.evidence_event_no !== j.event_count || j.required_event_state_version !== j.state_version) return fail("corrupt");
    return j;
}

/** Reads the same validated job without constructing command/ticket stores. */
export function readGenerationLifecycleJob(db: D1Database, id: string) {
  return safeRead(() => readLifecycleJobRow(db, id));
}

/** Private persistence only. Callers still supply the G03 domain authority port;
 * this store verifies physical current rows and never sends or invokes a provider. */
export function createGenerationLifecycleStore(db: D1Database) {
  const sql = sqlAccess(db), contexts = contextStorage(db);
  const finalTickets = createHumanContentRuntimeStore(db);
  const job = (id: string) => readLifecycleJobRow(db, id);
  async function mustJob(id: string) { return await job(id) ?? fail("conflict"); }
  function evidence(jobId: string, eventNo: number): Promise<TransitionEvidence | null> {
    return generationVerifiedRead(db, `evidence:${jobId}:${eventNo}`, () => readEvidenceFresh(jobId, eventNo));
  }
  async function readEvidenceFresh(jobId: string, eventNo: number): Promise<TransitionEvidence | null> {
    parse(lifecycleId, jobId); parse(positiveInteger, eventNo);
    const r = await sql.one(`SELECT e.*,v.event_code,v.message_safe,v.job_state_version,v.step_key AS event_step_key,v.attempt_number,
      d.dispatch_key,c.command_key FROM generation_transition_evidence e
      JOIN generation_job_events v ON v.generation_job_id=e.job_id AND v.event_no=e.event_no
      LEFT JOIN generation_job_dispatches d ON d.id=e.dispatch_id
      LEFT JOIN generation_control_commands c ON c.job_id=e.job_id AND c.ordinal=e.command_ordinal
      WHERE e.job_id=? AND e.event_no=? LIMIT 2`, [jobId, eventNo]);
    if (!r) {
      const partial = await sql.one("SELECT event_no FROM generation_job_events WHERE generation_job_id=? AND event_no=? LIMIT 2", [jobId, eventNo]);
      if (partial) return fail("corrupt");
      return null;
    }
    const c = await contexts.read(parse(lifecycleId, r.context_id));
    if (!c || c.encoded.envelope.jobId !== jobId || c.encoded.envelope.fingerprint !== r.fingerprint ||
      r.event_code !== r.reason || r.message_safe !== r.reason || r.job_state_version !== r.after_version ||
      r.event_step_key !== r.step_key || (r.attempt !== null && r.attempt_number !== r.attempt)) return fail("corrupt");
    return parse(transitionEvidenceSchema, { jobId, eventNo, before: r.before_version === null ? null : {
      stateVersion: r.before_version, status: r.before_status, stage: logicalStage(r.before_stage), waitGeneration: r.before_wait },
      after: { stateVersion: r.after_version, status: r.after_status, stage: logicalStage(r.after_stage), waitGeneration: r.after_wait },
      reason: r.reason, context: { contextId: r.context_id, fingerprint: r.fingerprint }, stepKey: r.step_key, attempt: r.attempt,
      dispatchKey: r.dispatch_key ?? null, commandKey: r.command_key ?? null });
  }
  async function dispatch(id: string) {
    parse(lifecycleId, id);
    const row = await sql.one("SELECT * FROM generation_job_dispatches WHERE id=? LIMIT 2", [id]);
    if (!row) return null;
    const j = await mustJob(parse(lifecycleId, row.generation_job_id));
    const [request, context] = await readTogether([contexts.read(j.request_context_id), contexts.read(parse(lifecycleId, row.context_id))]);
    if (!request || request.context.kind !== "request" || !context || context.encoded.envelope.jobId !== j.id) return fail("corrupt");
    const command = row.command_ordinal === null ? null : await sql.one("SELECT command_key FROM generation_control_commands WHERE job_id=? AND ordinal=? LIMIT 2", [j.id, parse(positiveInteger, row.command_ordinal)]);
    const identity = parse(dispatchIdentitySchema, { dispatchId: id, sermonId: j.sermon_id, quizSetId: j.quiz_set_id,
      requestContractVersion: j.execution_contract_version, requestScope: j.request_scope, wire: { contractVersion: 1, jobId: j.id,
        workflowInstanceId: row.workflow_instance_id, dispatchKind: row.kind, dispatchKey: row.dispatch_key,
        jobStateVersion: row.job_state_version, waitGeneration: row.wait_generation, requestFingerprint: j.request_fingerprint },
      payloadFingerprint: row.payload_fingerprint, request: { contextId: j.request_context_id, fingerprint: j.request_fingerprint },
      context: { contextId: row.context_id, fingerprint: context.encoded.envelope.fingerprint }, commandKey: command?.command_key ?? null });
    if (identity.wire.workflowInstanceId !== j.workflow_instance_id || await fingerprintLifecycleValue(identity.wire) !== identity.payloadFingerprint) return fail("corrupt");
    return { row, identity, job: j };
  }
  async function receiver(id: string): Promise<ReceiverReceipt | null> {
    const d = await dispatch(id);
    if (!d) return null;
    const r = await sql.one("SELECT * FROM generation_dispatch_receipts WHERE dispatch_id=? LIMIT 2", [id]);
    if (!r) {
      if (d.row.state === "acknowledged" || d.row.receiver_dispatch_id !== null) return fail("corrupt");
      return null;
    }
    if (d.row.state !== "acknowledged" || d.row.receiver_dispatch_id !== id || !equal(r, {
      job_id: d.job.id, workflow_instance_id: d.identity.wire.workflowInstanceId, request_context_id: d.identity.request.contextId,
      request_fingerprint: d.identity.request.fingerprint, payload_fingerprint: d.identity.payloadFingerprint,
      context_id: d.identity.context.contextId, wait_generation: d.identity.wire.waitGeneration, command_ordinal: d.row.command_ordinal,
      received_at: d.row.acknowledged_at })) return fail("corrupt");
    const e = await evidence(d.job.id, parse(positiveInteger, r.event_no));
    if (!e || e.after.stateVersion !== r.state_version) return fail("corrupt");
    const receipt = { identity: d.identity, receivedAt: parse(lifecycleTime, r.received_at), evidence: e };
    const a = await attempt(d.row);
    if (!a || (await assessDispatchRecovery({ identity: d.identity, attempt: a, receipt: { outcome: "present", receipt },
      now: receipt.receivedAt, jobActive: false, external: "unavailable" })).outcome !== "replayed") return fail("corrupt");
    return receipt;
  }
  async function attempt(d: Row) {
    if (d.attempt_count === 0) return null;
    const a = await sql.one("SELECT * FROM generation_dispatch_attempts WHERE dispatch_id=? AND attempt=? LIMIT 2", [parse(lifecycleId, d.id), parse(positiveInteger, d.attempt_count)]);
    if (!a) return fail("corrupt");
    return parse(dispatchAttemptSchema, { dispatchId: a.dispatch_id, attempt: a.attempt, claimToken: a.claim_token,
      state: a.state === "observed" ? "send_started" : a.state, leaseExpiresAt: a.lease_expires_at, sendStartedAt: a.send_started_at });
  }
  async function physicalCurrent(raw: GenerationAuthoritySnapshot, knownJob?: LifecycleJob) {
    const s = parse(generationAuthoritySnapshotSchema, raw), j = knownJob ?? await mustJob(s.jobId);
    const [settings, row] = await readTogether([
      sql.one(`SELECT coalesce(max(revision),?) settings_revision, coalesce(max(revision),?) selection_revision FROM generation_placement_selections WHERE job_id=?`,
        [j.settings_revision, j.selection_revision, j.id]),
      sql.one(`SELECT h.version,i.source_id,i.document_id,i.document_sha256,i.confirmation_id,
      ch.event_count,ch.last_event_id,m.metadata_revision,m.title,m.sermon_date,m.bible_reference_json
      FROM sermon_metadata_drafts m LEFT JOIN sermon_input_heads h ON h.sermon_id=m.sermon_id
      LEFT JOIN sermon_input_events i ON i.sermon_id=h.sermon_id AND i.version=h.version
      LEFT JOIN sermon_content_heads ch ON ch.sermon_id=m.sermon_id WHERE m.sermon_id=? LIMIT 2`, [s.sermonId]),
    ]);
    if (j.sermon_id !== s.sermonId || j.quiz_set_id !== s.quizSetId || j.request_scope !== s.scope || j.state_version !== s.jobStateVersion || j.status !== s.status ||
      !equal(settings ?? {}, { settings_revision: s.selection.state === "present" ? s.selection.settingsRevision : null,
        selection_revision: s.selection.state === "present" ? s.selection.selectionRevision : null }) ||
      j.active_wait_generation !== (s.wait?.generation ?? null)) return false;
    if (!row || !equal(row, { version: s.input.state === "present" ? s.input.version : null,
      source_id: s.input.state === "present" ? s.input.sourceId : null, document_id: s.input.state === "present" ? s.input.documentId : null,
      document_sha256: s.input.state === "present" ? s.input.documentSha256 : null, confirmation_id: s.input.state === "present" ? s.input.confirmationId : null,
      event_count: s.content.state === "present" ? s.content.eventCount : null, last_event_id: s.content.state === "present" ? s.content.lastEventId : null,
      metadata_revision: s.metadata.metadataRevision, title: s.metadata.title, sermon_date: s.metadata.sermonDate })) return false;
    try { if (!same(JSON.parse(String(row.bible_reference_json)), s.metadata.bibleReference)) return false; } catch { return false; }
    return true;
  }
  function authorityGuard(s: GenerationAuthoritySnapshot) {
    const i = s.input, c = s.content;
    // A failed predicate must abort the whole D1 transaction, not merely affect zero rows.
    return sql.stmt(`SELECT CASE WHEN EXISTS (
      SELECT 1 FROM generation_jobs j JOIN sermon_metadata_drafts m ON m.sermon_id=j.sermon_id
      LEFT JOIN sermon_input_heads h ON h.sermon_id=j.sermon_id
      LEFT JOIN sermon_input_events i ON i.sermon_id=h.sermon_id AND i.version=h.version
      LEFT JOIN sermon_content_heads c ON c.sermon_id=j.sermon_id
      WHERE j.id=? AND j.state_version=? AND j.status=? AND j.active_wait_generation IS ?
      AND coalesce((SELECT max(revision) FROM generation_placement_selections WHERE job_id=j.id),j.settings_revision) IS ?
      AND coalesce((SELECT max(revision) FROM generation_placement_selections WHERE job_id=j.id),j.selection_revision) IS ?
      AND m.metadata_revision=? AND h.version IS ? AND i.source_id IS ? AND i.document_id IS ?
      AND i.document_sha256 IS ? AND i.confirmation_id IS ? AND c.event_count IS ? AND c.last_event_id IS ?
    ) THEN 1 ELSE json('GENERATION_AUTHORITY_CONFLICT') END`, [s.jobId, s.jobStateVersion, s.status, s.wait?.generation ?? null,
      s.selection.state === "present" ? s.selection.settingsRevision : null, s.selection.state === "present" ? s.selection.selectionRevision : null,
      s.metadata.metadataRevision, i.state === "present" ? i.version : null, i.state === "present" ? i.sourceId : null,
      i.state === "present" ? i.documentId : null, i.state === "present" ? i.documentSha256 : null,
      i.state === "present" ? i.confirmationId : null, c.state === "present" ? c.eventCount : null, c.state === "present" ? c.lastEventId : null]);
  }
  async function guardedBatch(s: GenerationAuthoritySnapshot, statements: D1PreparedStatement[], changes = statements.map(() => 1)) {
    return sql.batch([authorityGuard(s), ...statements], [0, ...changes]);
  }
  function updateJob(j: LifecycleJob, e: TransitionEvidence, physicalAfter: string, now: string, waitFingerprint: string | null = null) {
    const isWait = e.after.waitGeneration !== null, isTerminal = ["review_ready", "needs_revision", "stale", "failed"].includes(e.after.status);
    return sql.stmt(`UPDATE generation_jobs SET status=?,current_step=?,state_version=?,event_count=?,required_event_no=?,required_event_state_version=?,
      evidence_event_no=?,active_wait_generation=?,wait_kind=?,wait_generation=?,wait_input_fingerprint=?,updated_at=?,completed_at=?
      WHERE id=? AND state_version=? AND event_count=? AND status=?`, [e.after.status, physicalAfter, e.after.stateVersion, e.eventNo, e.eventNo, e.after.stateVersion,
      e.eventNo, e.after.waitGeneration, isWait ? e.after.stage : null, e.after.waitGeneration ?? j.wait_generation, waitFingerprint, now, isTerminal ? now : null,
      j.id, j.state_version, j.event_count, j.status]);
  }
  function transition(j: LifecycleJob, context: TransitionEvidence["context"], reason: TransitionEvidence["reason"], stage: GenerationStage, status: LifecycleJob["status"] = "running", wait: number | null = null): TransitionEvidence {
    return parse(transitionEvidenceSchema, { jobId: j.id, eventNo: j.event_count + 1,
      before: { stateVersion: j.state_version, status: j.status, stage: logicalStage(j.current_step), waitGeneration: j.active_wait_generation },
      after: { stateVersion: j.state_version + 1, status, stage, waitGeneration: wait }, reason, context,
      stepKey: null, attempt: null, dispatchKey: null, commandKey: null });
  }
  async function dispatchRow(j: Pick<LifecycleJob, "id" | "workflow_instance_id" | "state_version" | "request_fingerprint">, contextId: string,
    kind: DispatchIdentity["wire"]["dispatchKind"], id: string, no: number, key: string, generation: number | null, now: string, ordinal: number | null = null) {
    parse(lifecycleId, id); parse(lifecycleId, key); parse(lifecycleTime, now);
    const wire: DispatchIdentity["wire"] = { contractVersion: 1, jobId: j.id, workflowInstanceId: j.workflow_instance_id, dispatchKind: kind,
      dispatchKey: key, jobStateVersion: j.state_version, waitGeneration: generation, requestFingerprint: j.request_fingerprint };
    return { id, generation_job_id: j.id, dispatch_no: no, kind, dispatch_key: key, workflow_instance_id: j.workflow_instance_id,
      job_state_version: j.state_version, wait_generation: generation, payload_fingerprint: await fingerprintLifecycleValue(wire),
      state: "pending", attempt_count: 0, claim_token: null, lease_expires_at: null, error_code: null, error_message_safe: null, error_fingerprint: null,
      created_at: now, last_attempted_at: null, acknowledged_at: null, context_id: contextId, command_ordinal: ordinal, required_attempt: null, receiver_dispatch_id: null };
  }
  async function createRequest(raw: unknown, base: ContextEnvelopeInput, workflowInstanceId: string, dispatchId: string, requestedContractVersion?: 2 | 3, analysisReuse?: { sourceJobId: string; analysisEventId: string }) {
    parse(lifecycleId, workflowInstanceId); parse(lifecycleId, dispatchId);
    const p = await contexts.prepare(raw, base), c = p.context, e = p.encoded.envelope;
    if (c.kind !== "request") return fail("invalid");
    const requestContractVersion = requestedContractVersion ?? (c.authority.scope === "full" ? 3 : 2);
    if (c.authority.scope === "final_audit" || requestContractVersion === 3 && c.authority.scope !== "full") return fail("invalid");
    const existing = await sql.one("SELECT id,request_context_id,workflow_instance_id,request_contract_version FROM generation_jobs WHERE request_key=? LIMIT 2", [e.requestKey]);
    if (existing) {
      const original = await contexts.read(parse(lifecycleId, existing.request_context_id));
      const marker = await sql.one("SELECT request_context_id FROM generation_full_v3_requests WHERE job_id=? LIMIT 2", [e.jobId]);
      if (!original || original.encoded.envelope.fingerprint !== e.fingerprint || existing.id !== e.jobId || existing.workflow_instance_id !== workflowInstanceId ||
        existing.request_contract_version !== 2 || (marker ? 3 : 2) !== requestContractVersion ||
        (marker && marker.request_context_id !== e.contextId)) return fail("conflict");
      const reuse = await sql.one("SELECT source_job_id,analysis_event_id FROM generation_intent_analysis_reuse WHERE job_id=? LIMIT 2", [e.jobId]);
      if (!same(reuse, analysisReuse ? { source_job_id: analysisReuse.sourceJobId, analysis_event_id: analysisReuse.analysisEventId } : null)) return fail("conflict");
      if (!await evidence(e.jobId, 1)) return fail("corrupt");
      return { outcome: "replayed" as const, context: original.encoded.envelope };
    }
    await contexts.references(c);
    const a = c.authority, projection = p.row;
    const j = { id: e.jobId, sermon_id: e.sermonId, quiz_set_id: e.quizSetId, request_scope: a.scope, request_contract_version: 2,
      request_key: e.requestKey, request_fingerprint: e.fingerprint, workflow_instance_id: workflowInstanceId,
      start_input_state: projection.input_state, start_input_version: projection.input_version, start_source_id: projection.source_id,
      start_document_id: projection.document_id, start_document_sha256: projection.document_sha256, start_confirmation_id: projection.confirmation_id,
      start_metadata_revision: projection.metadata_revision, settings_revision: projection.settings_revision, selection_revision: projection.selection_revision,
      status: "dispatch_pending", current_step: "dispatch", state_version: 0, event_count: 1, wait_kind: null, wait_generation: 0,
      wait_input_fingerprint: null, error_code: null, error_message_safe: null, error_fingerprint: null, created_by_actor_id: c.actorDigest,
      created_at: e.createdAt, updated_at: e.createdAt, completed_at: null, required_event_no: 1, required_event_state_version: 0,
      request_context_id: e.contextId, evidence_event_no: 1, active_wait_generation: null };
    const d = await dispatchRow(j, e.contextId, "start", dispatchId, 1, dispatchId, null, e.createdAt);
    const ev: TransitionEvidence = { jobId: e.jobId, eventNo: 1, before: null,
      after: { stateVersion: 0, status: "dispatch_pending", stage: null, waitGeneration: null }, reason: "job_created",
      context: { contextId: e.contextId, fingerprint: e.fingerprint }, stepKey: null, attempt: null, dispatchKey: null, commandKey: null };
    const plan = [sql.insert("generation_jobs", j), ...contexts.inserts(p), sql.insert("generation_request_contexts", { job_id: e.jobId, context_id: e.contextId, fingerprint: e.fingerprint }),
      ...(requestContractVersion === 3 ? [sql.insert("generation_full_v3_requests", { job_id: e.jobId, request_context_id: e.contextId, created_at: e.createdAt })] : []),
      ...(analysisReuse ? [sql.insert("generation_intent_analysis_reuse", { job_id: e.jobId, source_job_id: analysisReuse.sourceJobId, sermon_id: e.sermonId, analysis_event_id: analysisReuse.analysisEventId, created_at: e.createdAt })] : []),
      contexts.seal(e.contextId), sql.insert("generation_job_dispatches", d), sql.insert("generation_transition_evidence", evidenceRow(ev, { before: null, after: "dispatch" })), sql.insert("generation_job_events", eventRow(ev, e.createdAt))];
    if (await sql.batch(plan)) return { outcome: "created" as const, context: e };
    const own = await safeRead(async () => {
      const saved = await contexts.read(e.contextId), proof = await evidence(e.jobId, 1), dispatchProof = await dispatch(dispatchId);
      return saved && proof && dispatchProof && same(saved.encoded.envelope, e) && same(proof, ev) ? saved : null;
    });
    if (own.outcome === "present") return { outcome: "replayed" as const, context: e };
    return fail(own.outcome === "unavailable" ? "unavailable" : "conflict");
  }
  async function claimDispatch(id: string, token: string, now: string, lease: string) {
    parse(lifecycleId, token); parse(lifecycleTime, now); parse(lifecycleTime, lease);
    if (Date.parse(lease) <= Date.parse(now)) return fail("invalid");
    const d = await dispatch(id); if (!d) return fail("conflict");
    if (await receiver(id)) return { outcome: "replayed" as const };
    const previous = await attempt(d.row), oldCount = parse(lifecycleCount, d.row.attempt_count);
    const statements: D1PreparedStatement[] = [];
    if (previous) {
      const verdict = await assessDispatchRecovery({ identity: d.identity, attempt: previous, receipt: { outcome: "absent" }, now,
        jobActive: !["review_ready", "needs_revision", "stale", "failed"].includes(d.job.status), external: "unavailable" });
      if (verdict.outcome !== "reclaim_candidate") return verdict;
      statements.push(sql.stmt("UPDATE generation_dispatch_attempts SET state='expired',ended_at=? WHERE dispatch_id=? AND attempt=? AND state='reserved' AND claim_token=?", [now, id, oldCount, previous.claimToken]));
    } else if (d.row.state !== "pending") return fail("uncertain");
    const next = parse(positiveInteger, oldCount + 1);
    statements.push(sql.stmt("UPDATE generation_job_dispatches SET state='claimed',attempt_count=?,required_attempt=?,claim_token=?,lease_expires_at=?,last_attempted_at=? WHERE id=? AND attempt_count=?", [next, next, token, lease, now, id, oldCount]),
      sql.insert("generation_dispatch_attempts", { dispatch_id: id, attempt: next, claim_token: token, lease_expires_at: lease, state: "reserved", reserved_at: now, send_started_at: null, ended_at: null }));
    if (await sql.batch(statements)) return { outcome: "claimed" as const, attempt: next };
    const row = await sql.one("SELECT * FROM generation_dispatch_attempts WHERE dispatch_id=? AND attempt=? LIMIT 2", [id, next]);
    if (row && equal(row, { claim_token: token, lease_expires_at: lease, reserved_at: now, state: "reserved" })) return { outcome: "replayed" as const, attempt: next };
    return { outcome: "busy" as const };
  }
  async function reserveSend(id: string, count: number, token: string, now: string) {
    parse(lifecycleId, id); parse(positiveInteger, count); parse(lifecycleId, token); parse(lifecycleTime, now);
    // Never return a second send permit after a lost response or replay.
    const ok = await sql.batch([sql.stmt("UPDATE generation_dispatch_attempts SET state='send_started',send_started_at=? WHERE dispatch_id=? AND attempt=? AND claim_token=? AND state='reserved' AND lease_expires_at>?", [now, id, count, token, now])]);
    return { outcome: ok ? "reserved" as const : "uncertain" as const };
  }
  async function receive(id: string, delivered: unknown, runtimeInstanceId: string, authority: GenerationAuthoritySnapshot, now: string) {
    parse(lifecycleTime, now); parse(lifecycleId, runtimeInstanceId);
    const d = await dispatch(id); if (!d) return fail("conflict");
    const prior = await receiver(id), a = await attempt(d.row); if (!a) return fail("uncertain");
    const c = await contexts.read(d.identity.context.contextId); if (!c) return fail("corrupt");
    const command = d.row.command_ordinal === null ? null : await readCommand(d.job.id, parse(positiveInteger, d.row.command_ordinal));
    const originalWait = c.context.kind === "wait" ? c.context.wait : command?.expected ?? null;
    const wait = originalWait && d.job.execution_contract_version === 3 ? await verifiedDomainWait(db, originalWait, authority) : originalWait;
    const verdict = await assessDispatchReceive({ identity: d.identity, delivered, runtimeInstanceId, attempt: a,
      receipt: prior ? { outcome: "present", receipt: prior } : { outcome: "absent" },
      authority: { outcome: "captured", snapshot: authority }, wait, command, openEffect: false });
    if (verdict.outcome === "replayed") return { outcome: "replayed" as const };
    if (verdict.outcome !== "eligible" || !("stage" in verdict)) return verdict;
    if (!await physicalCurrent(authority)) return { outcome: "stale" as const };
    const stage = parse(generationStageSchema, verdict.stage), ev = transition(d.job, d.identity.context, "received", stage);
    ev.dispatchKey = d.identity.wire.dispatchKey; ev.attempt = a.attempt; ev.commandKey = command?.key ?? null;
    const physicalStage = command ? `correction_${command.ordinal}` : stage;
    const receipt = { dispatch_id: id, job_id: d.job.id, workflow_instance_id: runtimeInstanceId,
      request_context_id: d.identity.request.contextId, request_fingerprint: d.identity.request.fingerprint,
      payload_fingerprint: d.identity.payloadFingerprint, context_id: d.identity.context.contextId,
      wait_generation: d.identity.wire.waitGeneration, command_ordinal: command?.ordinal ?? null, event_no: ev.eventNo, state_version: ev.after.stateVersion, received_at: now };
    const plan = [sql.insert("generation_transition_evidence", evidenceRow(ev, { before: d.job.current_step, after: physicalStage, dispatchId: id, commandOrdinal: command?.ordinal ?? null })),
      sql.insert("generation_dispatch_receipts", receipt),
      sql.stmt("UPDATE generation_job_dispatches SET state='acknowledged',receiver_dispatch_id=id,claim_token=NULL,lease_expires_at=NULL,acknowledged_at=? WHERE id=? AND attempt_count=? AND state IN ('claimed','uncertain')", [now, id, a.attempt]),
      sql.stmt("UPDATE generation_dispatch_attempts SET state='observed',ended_at=? WHERE dispatch_id=? AND attempt=? AND state='send_started'", [now, id, a.attempt]),
      ...(command ? [sql.stmt("UPDATE generation_control_commands SET state='running' WHERE job_id=? AND ordinal=? AND state='pending'", [d.job.id, command.ordinal]),
        sql.stmt("UPDATE generation_job_dispatches SET state='stale',claim_token=NULL,lease_expires_at=NULL WHERE generation_job_id=? AND wait_generation=? AND kind LIKE 'resume_%' AND state NOT IN ('stale','terminal_failed')", [d.job.id, command.waitGeneration])] : []),
      updateJob(d.job, ev, physicalStage, now), sql.insert("generation_job_events", eventRow(ev, now))];
    const changes = plan.map(() => 1);
    if (command) {
      const count = await sql.one("SELECT count(*) AS n FROM generation_job_dispatches WHERE generation_job_id=? AND wait_generation=? AND kind LIKE 'resume_%' AND state NOT IN ('stale','terminal_failed')", [d.job.id, command.waitGeneration]);
      changes[5] = parse(lifecycleCount, count?.n);
    }
    if (await guardedBatch(authority, plan, changes)) return { outcome: "received" as const };
    const saved = await safeRead(() => receiver(id));
    if (saved.outcome === "present" && same(saved.value.evidence, ev)) return { outcome: "replayed" as const };
    return { outcome: saved.outcome === "unavailable" ? "unavailable" as const : "conflict" as const };
  }
  async function enterWait(raw: unknown, base: ContextEnvelopeInput) {
    const p = await contexts.prepare(raw, base), c = p.context, envelope = p.encoded.envelope;
    if (c.kind !== "wait" || c.parent !== null) return fail("invalid");
    const prior = await contexts.read(envelope.contextId);
    if (prior) return same(prior.encoded.envelope, envelope) ? { outcome: "replayed" as const } : fail("conflict");
    const j = await mustJob(envelope.jobId);
    if (j.status !== "running" || j.current_step !== (c.wait.kind === "intent_review" ? "intent_critique" : "transcript_review") ||
      c.wait.generation !== j.wait_generation + 1 || c.enter.eventNo !== j.event_count + 1 || c.enter.stateVersion !== j.state_version + 1) return fail("conflict");
    const ev = transition(j, { contextId: envelope.contextId, fingerprint: envelope.fingerprint }, "wait_entered", c.wait.kind,
      c.wait.kind === "transcript_review" ? "awaiting_transcript_review" : "awaiting_intent_review", c.wait.generation);
    const plan = [...contexts.inserts(p), sql.insert("generation_transition_evidence", evidenceRow(ev, { before: j.current_step, after: c.wait.kind })),
      sql.insert("generation_wait_contexts", { job_id: j.id, wait_generation: c.wait.generation, context_id: envelope.contextId,
        request_context_id: c.request.contextId, kind: c.wait.kind, enter_event_no: c.enter.eventNo, enter_state_version: c.enter.stateVersion,
        parent_wait_generation: null, command_ordinal: null, parent_step_key: null, parent_attempt: null }), contexts.seal(envelope.contextId),
      updateJob(j, ev, c.wait.kind, envelope.createdAt, envelope.fingerprint), sql.insert("generation_job_events", eventRow(ev, envelope.createdAt))];
    if (await sql.batch(plan)) return { outcome: "saved" as const };
    const saved = await safeRead(() => contexts.read(envelope.contextId));
    return saved.outcome === "present" && same(saved.value.encoded.envelope, envelope) ? { outcome: "replayed" as const } : { outcome: "conflict" as const };
  }
  async function ensureResume(jobId: string, authority: GenerationAuthoritySnapshot, id: string, now: string) {
    const j = await mustJob(jobId);
    if (j.active_wait_generation === null || !j.wait_kind) return fail("conflict");
    const link = await sql.one("SELECT context_id FROM generation_wait_contexts WHERE job_id=? AND wait_generation=? LIMIT 2", [jobId, j.active_wait_generation]);
    const c = link ? await contexts.read(parse(lifecycleId, link.context_id)) : null;
    if (!c || c.context.kind !== "wait") return fail("corrupt");
    const kind = `resume_${j.wait_kind}` as const;
    const old = await sql.one("SELECT id FROM generation_job_dispatches WHERE generation_job_id=? AND kind=? AND wait_generation=? LIMIT 2", [jobId, kind, j.active_wait_generation]);
    if (old) { const verified = await dispatch(parse(lifecycleId, old.id)); return { outcome: "replayed" as const, dispatchId: verified!.identity.dispatchId }; }
    const checkedWait = j.execution_contract_version === 3 ? await verifiedDomainWait(db, c.context.wait, authority) : c.context.wait;
    const verdict = assessGenerationWait(checkedWait, authority);
    if (verdict.outcome !== "ready") return verdict;
    if (!await physicalCurrent(authority)) return { outcome: "stale" as const };
    const count = await sql.one("SELECT coalesce(max(dispatch_no),0) AS n FROM generation_job_dispatches WHERE generation_job_id=?", [jobId]);
    const no = parse(positiveInteger, parse(lifecycleCount, count?.n) + 1);
    const d = await dispatchRow(j, c.encoded.envelope.contextId, kind, id, no, id, j.active_wait_generation, now);
    if (await guardedBatch(authority, [sql.insert("generation_job_dispatches", d)])) return { outcome: "saved" as const, dispatchId: id };
    const raced = await sql.one("SELECT id FROM generation_job_dispatches WHERE generation_job_id=? AND kind=? AND wait_generation=? LIMIT 2", [jobId, kind, j.active_wait_generation]);
    if (raced && await dispatch(parse(lifecycleId, raced.id))) return { outcome: "replayed" as const, dispatchId: String(raced.id) };
    return { outcome: "conflict" as const };
  }
  async function readCommand(jobId: string, ordinal: number) {
    const row = await sql.one("SELECT * FROM generation_control_commands WHERE job_id=? AND ordinal=? LIMIT 2", [jobId, ordinal]);
    if (!row) return null;
    const w = await sql.one("SELECT context_id FROM generation_wait_contexts WHERE job_id=? AND wait_generation=? LIMIT 2", [jobId, parse(positiveInteger, row.wait_generation)]);
    const context = w ? await contexts.read(parse(lifecycleId, w.context_id)) : null;
    if (!context || context.context.kind !== "wait") return fail("corrupt");
    const wait = context.context;
    return parse(correctionCommandSchema, { jobId, sermonId: context.encoded.envelope.sermonId, quizSetId: context.encoded.envelope.quizSetId,
      key: row.command_key, ordinal, actorDigest: row.actor_digest, waitGeneration: row.wait_generation, enter: wait.enter,
      context: { contextId: row.context_id, fingerprint: row.fingerprint }, expected: wait.wait, state: row.state });
  }
  async function registerCorrection(raw: unknown, base: ContextEnvelopeInput, current: GenerationAuthoritySnapshot, actorDigest: string, dispatchId: string) {
    const p = await contexts.prepare(raw, base), c = p.context, e = p.encoded.envelope;
    if (c.kind !== "step" || !c.command || c.execution.task !== "correction") return fail("invalid");
    const j = await mustJob(e.jobId);
    const old = await sql.one("SELECT ordinal FROM generation_control_commands WHERE job_id=? AND command_key=? LIMIT 2", [j.id, c.command.key]);
    if (old) {
      const prior = await readCommand(j.id, parse(positiveInteger, old.ordinal));
      const original = prior ? await contexts.read(prior.context.contextId) : null;
      if (!original || !same(original.context, c) || prior?.actorDigest !== actorDigest) return fail("conflict");
      return { outcome: "replayed" as const };
    }
    const w = await sql.one("SELECT context_id FROM generation_wait_contexts WHERE job_id=? AND wait_generation=? LIMIT 2", [j.id, c.command.waitGeneration]);
    const wc = w ? await contexts.read(parse(lifecycleId, w.context_id)) : null;
    if (!wc || wc.context.kind !== "wait") return fail("corrupt");
    const proposed = parse(correctionCommandSchema, { jobId: j.id, sermonId: j.sermon_id, quizSetId: j.quiz_set_id,
      key: c.command.key, ordinal: c.command.ordinal, actorDigest, waitGeneration: c.command.waitGeneration, enter: wc.context.enter,
      context: { contextId: e.contextId, fingerprint: e.fingerprint }, expected: wc.context.wait, state: "pending" });
    const counts = await sql.one(`SELECT (SELECT coalesce(max(ordinal),0) FROM generation_control_commands WHERE job_id=?) AS ordinal,
      (SELECT coalesce(max(dispatch_no),0) FROM generation_job_dispatches WHERE generation_job_id=?) AS dispatch`, [j.id, j.id]);
    const busy = await sql.one("SELECT ordinal FROM generation_control_commands WHERE job_id=? AND state IN ('pending','running','uncertain') LIMIT 2", [j.id]);
    const existing = busy ? await readCommand(j.id, parse(positiveInteger, busy.ordinal)) : null;
    const verdict = assessCorrectionRegistration({ proposed, existing, current, lastOrdinal: counts?.ordinal, openEffect: false });
    if (verdict.outcome !== "eligible") return verdict;
    if (!await physicalCurrent(current) || c.authority.jobStateVersion !== j.state_version + 1 || c.predecessor.eventNo !== j.event_count + 1 || c.predecessor.kind !== "wait_consume") return fail("conflict");
    const d = await dispatchRow(j, e.contextId, "correction", dispatchId, parse(positiveInteger, Number(counts?.dispatch) + 1), dispatchId, c.command.waitGeneration, e.createdAt, c.command.ordinal);
    const plan = [...contexts.inserts(p), sql.insert("generation_control_commands", { job_id: j.id, ordinal: c.command.ordinal, command_key: c.command.key,
      wait_generation: c.command.waitGeneration, context_id: e.contextId, actor_digest: actorDigest, fingerprint: e.fingerprint,
      state: "pending", step_key: c.stepKey, outcome_attempt: null, created_at: e.createdAt }), sql.insert("generation_job_dispatches", d), contexts.seal(e.contextId)];
    if (await guardedBatch(current, plan)) return { outcome: "saved" as const };
    const found = await safeRead(() => contexts.read(e.contextId));
    return found.outcome === "present" && same(found.value.encoded.envelope, e) ? { outcome: "replayed" as const } : { outcome: "conflict" as const };
  }
  async function claimStep(raw: unknown, base: ContextEnvelopeInput, token: string, now: string, lease: string) {
    parse(lifecycleId, token); parse(lifecycleTime, now); parse(lifecycleTime, lease);
    if (Date.parse(lease) <= Date.parse(now)) return fail("invalid");
    const p = await contexts.prepare(raw, base), c = p.context, e = p.encoded.envelope;
    if (c.kind !== "step") return fail("invalid");
    const task = GENERATION_STAGE_STORAGE[c.execution.task].receiptTask;
    if (!task) return fail("invalid");
    const [j, r, original] = await readTogether([
      mustJob(e.jobId), sql.one("SELECT * FROM generation_step_receipts WHERE generation_job_id=? AND step_key=? LIMIT 2", [e.jobId, c.stepKey]),
      contexts.read(c.request.contextId),
    ]);
    if (r) {
      if (r.context_id !== e.contextId || r.input_fingerprint !== e.fingerprint) return fail("conflict");
      if (["succeeded", "terminal_failed", "stale"].includes(String(r.state))) {
        const own = await outcome(j.id, c.stepKey, parse(positiveInteger, r.outcome_attempt));
        if (!own) return fail("corrupt");
        return { outcome: "historical" as const, proof: own };
      }
      if (r.state === "effect_started" || r.state === "uncertain") return { outcome: "uncertain" as const };
      return { outcome: "busy" as const };
    }
    if (j.current_step !== c.stepKey || j.status !== "running" || j.state_version !== c.authority.jobStateVersion || !await physicalCurrent(c.authority, j)) return fail("conflict");
    const predecessor = await evidence(j.id, j.event_count);
    if (!predecessor || c.predecessor.eventNo !== j.event_count || c.predecessor.stateVersion !== j.state_version) return fail("conflict");
    if (!original || original.context.kind !== "request" || original.encoded.envelope.fingerprint !== c.request.fingerprint) return fail("corrupt");
    if (original.context.reuseCurrentContent) return fail("conflict");
    if ((c.execution.task === "child_candidates" || c.execution.task === "adult_candidates") &&
      !same(original.context.candidateTarget ?? null, c.execution.context.target ?? null)) return fail("conflict");
    const receipt = { generation_job_id: j.id, step_key: c.stepKey, task, effect_class: ["fetch_transcript", "place_grid", "validate"].includes(task) ? "pure" : "ai_provider",
      input_contract_version: 2, input_fingerprint: e.fingerprint, input_version: p.row.input_version, source_id: p.row.source_id,
      document_id: p.row.document_id, document_sha256: p.row.document_sha256, confirmation_id: p.row.confirmation_id,
      metadata_revision: p.row.metadata_revision, binding_id: c.execution.task === "intent_critique" ? c.execution.context.baseAnalysisId : null,
      ticket_id: p.row.ticket_id, state: "claimed", attempt_count: 1, claim_token: token, lease_expires_at: lease, provider_request_id_opaque: null,
      result_kind: null, result_id: null, result_version: null, result_fingerprint: null, error_code: null, error_message_safe: null, error_fingerprint: null,
      started_at: now, updated_at: now, completed_at: null, context_id: e.contextId, outcome_attempt: null };
    if (c.command) {
      const saved = await contexts.read(e.contextId);
      if (!saved || !same(saved.encoded.envelope, e)) return fail("corrupt");
    }
    const plan = [...(c.command ? [] : contexts.inserts(p)), sql.insert("generation_step_receipts", receipt),
      sql.insert("generation_step_contexts", { job_id: j.id, step_key: c.stepKey, context_id: e.contextId, request_context_id: c.request.contextId,
        task, input_fingerprint: e.fingerprint, predecessor_event_no: j.event_count, predecessor_state_version: j.state_version,
        predecessor_kind: c.predecessor.kind, command_ordinal: c.command?.ordinal ?? null }), ...(c.command ? [] : [contexts.seal(e.contextId)])];
    if (await guardedBatch(c.authority, plan)) return { outcome: "claimed" as const, attempt: 1 };
    const saved = await sql.one("SELECT * FROM generation_step_receipts WHERE generation_job_id=? AND step_key=? LIMIT 2", [j.id, c.stepKey]);
    if (saved && equal(saved, receipt)) return { outcome: "replayed" as const, attempt: 1 };
    return { outcome: "conflict" as const };
  }
  async function advance(jobId: string, contextId: string, stage: GenerationStage, now: string) {
    parse(lifecycleTime, now); parse(generationStageSchema, stage);
    const j = await mustJob(jobId), c = await contexts.read(contextId);
    if (!c || c.encoded.envelope.jobId !== jobId) return fail("corrupt");
    const prior = await sql.one("SELECT event_no FROM generation_transition_evidence WHERE job_id=? AND context_id=? AND reason='stage_completed' AND after_stage=? LIMIT 2", [jobId, contextId, stage]);
    if (prior) {
      const own = await evidence(jobId, parse(positiveInteger, prior.event_no));
      return { outcome: own?.reason === "stage_completed" && own.after.stage === stage && own.context.fingerprint === c.encoded.envelope.fingerprint ? "replayed" as const : "conflict" as const };
    }
    const ev = transition(j, { contextId, fingerprint: c.encoded.envelope.fingerprint }, "stage_completed", stage);
    const plan = [sql.insert("generation_transition_evidence", evidenceRow(ev, { before: j.current_step, after: stage })),
      updateJob(j, ev, stage, now), sql.insert("generation_job_events", eventRow(ev, now))];
    if (await sql.batch(plan)) return { outcome: "saved" as const };
    const saved = await evidence(j.id, ev.eventNo);
    return saved && same(saved, ev) ? { outcome: "replayed" as const } : { outcome: "conflict" as const };
  }

  async function step(jobId: string, key: string) {
    const r = await sql.one("SELECT * FROM generation_step_receipts WHERE generation_job_id=? AND step_key=? LIMIT 2", [parse(lifecycleId, jobId), parse(lifecycleId, key)]);
    if (!r) return null;
    const stored = await contexts.read(parse(lifecycleId, r.context_id));
    if (!stored || stored.context.kind !== "step" || stored.context.stepKey !== key || stored.encoded.envelope.jobId !== jobId ||
      r.input_contract_version !== 2 || r.input_fingerprint !== stored.encoded.envelope.fingerprint) return fail("corrupt");
    if (!equal(r, { task: GENERATION_STAGE_STORAGE[stored.context.execution.task].receiptTask,
      input_version: stored.row.input_version, source_id: stored.row.source_id, document_id: stored.row.document_id,
      document_sha256: stored.row.document_sha256, confirmation_id: stored.row.confirmation_id, metadata_revision: stored.row.metadata_revision,
      binding_id: stored.context.execution.task === "intent_critique" ? stored.context.execution.context.baseAnalysisId : null,
      ticket_id: stored.row.ticket_id })) return fail("corrupt");
    return { row: r, stored, context: stored.context };
  }
  async function startProviderCall(jobId: string, key: string, expectedAttempt: number, token: string,
    raw: { id: string; provider: string; model: string; reasoningEffort: string | null; providerRequestIdOpaque: string | null }, now: string) {
    const call = parse(z.strictObject({ id: lifecycleId, provider: z.string().min(1).max(64), model: providerModelSchema,
      reasoningEffort: z.string().min(1).max(32).nullable(), providerRequestIdOpaque: lifecycleDigest.nullable() }), raw);
    parse(lifecycleTime, now); parse(positiveInteger, expectedAttempt); parse(lifecycleId, token);
    const s = await step(jobId, key); if (!s) return fail("conflict");
    const a = s.context.authority;
    const old = await sql.one("SELECT * FROM ai_provider_calls WHERE id=? LIMIT 2", [call.id]);
    const row = { id: call.id, generation_job_id: jobId, step_key: key, attempt_number: expectedAttempt, quiz_set_id: a.quizSetId, sermon_id: a.sermonId,
      task: s.row.task as string, input_fingerprint: s.stored.encoded.envelope.fingerprint, provider: call.provider, model: call.model,
      reasoning_effort: call.reasoningEffort, state: "effect_started", provider_request_id_opaque: call.providerRequestIdOpaque, started_at: now, completed_at: null, settlement_call_id: null };
    // Even exact persistence replay is not permission to invoke a provider again.
    if (old) return equal(old, row) ? { outcome: "observed" as const } : { outcome: "conflict" as const };
    const plan = [sql.stmt(`UPDATE generation_step_receipts SET state='effect_started',updated_at=? WHERE generation_job_id=? AND step_key=?
      AND state='claimed' AND attempt_count=? AND claim_token=? AND lease_expires_at>?`, [now, jobId, key, expectedAttempt, token, now]), sql.insert("ai_provider_calls", row)];
    if (await sql.batch(plan)) return { outcome: "started" as const };
    const observed = await sql.one("SELECT * FROM ai_provider_calls WHERE id=? LIMIT 2", [call.id]);
    return { outcome: observed && equal(observed, row) ? "observed" as const : "uncertain" as const };
  }
  function usageRow(u: UsageObservation) {
    return { id: u.usageId, provider_call_id: u.callId, generation_job_id: u.jobId, step_key: u.stepKey, attempt_number: u.attempt,
      quiz_set_id: u.quizSetId, sermon_id: u.sermonId, task: u.task, provider: u.provider, model: u.model, input_tokens: u.inputTokens,
      cached_input_tokens: u.cachedInputTokens, reasoning_tokens: u.reasoningTokens, output_tokens: u.outputTokens, audio_input_tokens: u.audioInputTokens,
      audio_seconds: u.audioSeconds, pricing_version: u.pricingVersion, estimated_cost_micro_usd: u.estimatedCostMicroUsd, usage_source: u.usageSource, observed_at: u.observedAt };
  }
  async function observationRow(u: UsageObservation) {
    const values = usageRow(u);
    const { id, provider_call_id, generation_job_id, attempt_number, ...rest } = values;
    return { ...rest, call_id: provider_call_id, usage_event_id: id, job_id: generation_job_id, attempt: attempt_number,
      context_id: u.context.contextId, input_fingerprint: u.inputFingerprint, reasoning_effort: u.reasoningEffort,
      provider_request_id_opaque: u.providerRequestIdOpaque, started_at: u.startedAt, fingerprint: await fingerprintLifecycleValue(u) };
  }
  async function readObservation(callId: string, loaded?: { row: Row | null; step: Awaited<ReturnType<typeof step>>; call: Row | null }): Promise<UsageObservation | null> {
    const r = loaded ? loaded.row : await sql.one("SELECT * FROM ai_usage_observations WHERE call_id=? LIMIT 2", [parse(lifecycleId, callId)]);
    if (!r) return null;
    const s = loaded ? loaded.step : await step(parse(lifecycleId, r.job_id), parse(lifecycleId, r.step_key)); if (!s) return fail("corrupt");
    const u = parse(usageObservationSchema, { contractVersion: 2, callId, usageId: r.usage_event_id, jobId: r.job_id, sermonId: r.sermon_id, quizSetId: r.quiz_set_id,
      stepKey: r.step_key, attempt: r.attempt, task: r.task, context: { contextId: r.context_id, fingerprint: s.stored.encoded.envelope.fingerprint },
      inputFingerprint: r.input_fingerprint, provider: r.provider, model: r.model, reasoningEffort: r.reasoning_effort, providerRequestIdOpaque: r.provider_request_id_opaque,
      inputTokens: r.input_tokens, cachedInputTokens: r.cached_input_tokens, reasoningTokens: r.reasoning_tokens, outputTokens: r.output_tokens,
      audioInputTokens: r.audio_input_tokens, audioSeconds: r.audio_seconds, pricingVersion: r.pricing_version, estimatedCostMicroUsd: r.estimated_cost_micro_usd,
      usageSource: r.usage_source, startedAt: r.started_at, observedAt: r.observed_at });
    if (u.context.contextId !== s.stored.encoded.envelope.contextId || u.inputFingerprint !== u.context.fingerprint || !equal(r, await observationRow(u))) return fail("corrupt");
    const call = loaded ? loaded.call : await sql.one("SELECT * FROM ai_provider_calls WHERE id=? LIMIT 2", [callId]);
    if (!call || !equal(call, { generation_job_id: u.jobId, step_key: u.stepKey, attempt_number: u.attempt, sermon_id: u.sermonId, quiz_set_id: u.quizSetId,
      task: u.task, input_fingerprint: u.inputFingerprint, provider: u.provider, model: u.model, reasoning_effort: u.reasoningEffort,
      provider_request_id_opaque: u.providerRequestIdOpaque, started_at: u.startedAt })) return fail("corrupt");
    return u;
  }
  async function observeUsage(raw: UsageObservation) {
    const u = parse(usageObservationSchema, raw), old = await readObservation(u.callId);
    if (old) return { outcome: same(old, u) ? "replayed" as const : "conflict" as const };
    const row = await observationRow(u);
    if (await sql.batch([sql.insert("ai_usage_observations", row)])) return { outcome: "saved" as const };
    const found = await safeRead(() => readObservation(u.callId));
    return { outcome: found.outcome === "present" && same(found.value, u) ? "replayed" as const : found.outcome === "unavailable" ? "unavailable" as const : "conflict" as const };
  }
  async function settlementPlan(u: UsageObservation, now: string, includeSettlement: boolean) {
    const fingerprint = await fingerprintLifecycleValue(u);
    return [sql.stmt("UPDATE ai_provider_calls SET state='completed',completed_at=?,settlement_call_id=id WHERE id=? AND state IN ('effect_started','uncertain')", [now, u.callId]),
      sql.insert("ai_usage_events", usageRow(u)), ...(includeSettlement ? [sql.insert("ai_usage_settlements", { call_id: u.callId, usage_event_id: u.usageId,
        job_id: u.jobId, step_key: u.stepKey, attempt: u.attempt, fingerprint, settled_at: now })] : [])];
  }
  async function settled(u: UsageObservation, loaded?: [Row | null, Row | null, Row | null]) {
    const [call, event, settlement] = loaded ?? await readTogether([
      sql.one("SELECT * FROM ai_provider_calls WHERE id=? LIMIT 2", [u.callId]),
      sql.one("SELECT * FROM ai_usage_events WHERE provider_call_id=? LIMIT 2", [u.callId]),
      sql.one("SELECT * FROM ai_usage_settlements WHERE call_id=? LIMIT 2", [u.callId]),
    ]);
    return !!call && !!event && !!settlement && equal(event, usageRow(u)) && equal(call, { state: "completed", settlement_call_id: u.callId }) &&
      equal(settlement, { usage_event_id: u.usageId, job_id: u.jobId, step_key: u.stepKey, attempt: u.attempt, fingerprint: await fingerprintLifecycleValue(u) }) &&
      typeof call.completed_at === "string" && typeof settlement.settled_at === "string" && call.completed_at >= u.observedAt && settlement.settled_at >= u.observedAt;
  }
  function outcome(jobId: string, key: string, attempt: number): Promise<LifecycleOutcomeProof | null> {
    return generationVerifiedRead(db, `outcome:${jobId}:${key}:${attempt}`, () => readOutcomeFresh(jobId, key, attempt));
  }
  async function readOutcomeFresh(jobId: string, key: string, attempt: number): Promise<LifecycleOutcomeProof | null> {
    parse(positiveInteger, attempt);
    const o = await sql.one("SELECT * FROM generation_step_outcomes WHERE job_id=? AND step_key=? AND attempt=? LIMIT 2", [jobId, key, attempt]);
    if (!o) {
      const receipt = await sql.one("SELECT state,outcome_attempt FROM generation_step_receipts WHERE generation_job_id=? AND step_key=? LIMIT 2", [jobId, key]);
      if (receipt?.outcome_attempt === attempt) return fail("corrupt");
      return null;
    }
    const callId = o.call_id === null ? null : parse(lifecycleId, o.call_id);
    const [s, e, call, observation, usageEvent, settlement, link] = await readTogether([
      step(jobId, key), evidence(jobId, parse(positiveInteger, o.event_no)),
      callId ? sql.one("SELECT * FROM ai_provider_calls WHERE id=? LIMIT 2", [callId]) : null,
      callId ? sql.one("SELECT * FROM ai_usage_observations WHERE call_id=? LIMIT 2", [callId]) : null,
      callId ? sql.one("SELECT * FROM ai_usage_events WHERE provider_call_id=? LIMIT 2", [callId]) : null,
      callId ? sql.one("SELECT * FROM ai_usage_settlements WHERE call_id=? LIMIT 2", [callId]) : null,
      sql.one("SELECT * FROM generation_step_result_links WHERE generation_job_id=? AND step_key=? LIMIT 2", [jobId, key]),
    ]);
    if (!s || !e) return fail("corrupt");
    const a = s.context.authority, i = a.input, count = a.content.state === "present" ? a.content.eventCount : 0;
    const state = parse(z.enum(["success", "rejected", "stale", "uncertain"]), o.outcome);
    const expectedState = { success: "succeeded", rejected: "terminal_failed", stale: "stale", uncertain: "uncertain" }[state];
    if (!equal(o, { context_id: s.stored.encoded.envelope.contextId, input_fingerprint: s.stored.encoded.envelope.fingerprint,
      task: s.row.task, state_version: e.after.stateVersion, before_input_version: i.state === "present" ? i.version : null, before_content_count: count }) ||
      !equal(s.row, { state: expectedState, outcome_attempt: attempt, attempt_count: attempt }) || e.stepKey !== key || e.attempt !== attempt ||
      !same(e.context, { contextId: s.stored.encoded.envelope.contextId, fingerprint: s.stored.encoded.envelope.fingerprint }) ||
      e.reason !== ({ success: "step_succeeded", rejected: "step_rejected", stale: "step_stale", uncertain: "step_uncertain" } as const)[state] ||
      o.reason !== ({ success: "none", rejected: "domain_invalid", stale: "authority_changed", uncertain: "usage_unknown" } as const)[state]) return fail("corrupt");
    let usage: UsageObservation | null = null;
    if (o.call_id !== null) {
      if (!call || !equal(call, { generation_job_id: jobId, step_key: key, attempt_number: attempt, task: s.row.task,
        input_fingerprint: o.input_fingerprint, sermon_id: a.sermonId, quiz_set_id: a.quizSetId })) return fail("corrupt");
      const observed = await readObservation(String(o.call_id), { row: observation, step: s, call });
      if (o.usage_event_id !== null) {
        if (!observed || observed.usageId !== o.usage_event_id || !await settled(observed, [call, usageEvent, settlement])) return fail("corrupt");
        usage = observed;
      } else if (call.state === "completed") {
        if (!observed || !await settled(observed, [call, usageEvent, settlement])) return fail("corrupt");
      } else if (call.state !== "uncertain") return fail("corrupt");
    } else if (o.usage_event_id !== null) return fail("corrupt");
    let result: LifecycleResultRef | null = null;
    if (state === "success") {
      if (!link || !usage || o.result_step_key !== key || link.usage_event_id !== usage.usageId) return fail("corrupt");
      result = parse(resultReferenceSchema, { kind: s.row.result_kind, id: s.row.result_id, version: s.row.result_version, fingerprint: s.row.result_fingerprint });
      if (!await verifyLifecycleArtifact(db, s.context, link, result)) return fail("corrupt");
      if (o.after_input_version !== (i.state === "present" ? i.version + (s.context.execution.task === "correction" ? 1 : 0) : null) ||
        o.after_content_count !== count + (s.context.execution.task === "correction" ? 0 : 1)) return fail("corrupt");
    } else if (link || o.result_step_key !== null || s.row.result_id !== null || s.row.result_fingerprint !== null || s.row.result_kind !== null || s.row.result_version !== null) return fail("corrupt");
    return parse(outcomeProofSchema, { jobId, stepKey: key, attempt, context: e.context, outcome: state,
      event: e, callId: o.call_id, usage, result, beforeInputVersion: o.before_input_version, afterInputVersion: o.after_input_version,
      beforeContentCount: o.before_content_count, afterContentCount: o.after_content_count });
  }
  async function probeOutcome(expected: LifecycleOutcomeProof) {
    const pin = parse(outcomeProofSchema, expected), read = await safeRead(() => outcome(pin.jobId, pin.stepKey, pin.attempt));
    if (read.outcome !== "present") return { outcome: read.outcome };
    return { outcome: same(pin, read.value) ? "exact" as const : "conflict" as const };
  }
  async function commitOutcome(command: { jobId: string; stepKey: string; attempt: number; token: string; now: string;
    outcome: "success" | "rejected" | "stale" | "uncertain"; callId: string | null; usage: UsageObservation | null;
    result: LifecycleResultInput | null; rewait?: { context: unknown; base: ContextEnvelopeInput } }) {
    const cmd = parse(z.strictObject({ jobId: lifecycleId, stepKey: lifecycleId, attempt: z.int().positive(), token: lifecycleId, now: lifecycleTime,
      outcome: z.enum(["success", "rejected", "stale", "uncertain"]), callId: lifecycleId.nullable(), usage: usageObservationSchema.nullable(),
      result: z.strictObject({ id: lifecycleId, actorDigest: lifecycleDigest.nullable(), payload: z.unknown() }).nullable(),
      rewait: z.object({ context: z.unknown(), base: z.unknown() }).optional() }), command);
    const [s, prior, j, observed] = await readTogether([
      step(cmd.jobId, cmd.stepKey), outcome(cmd.jobId, cmd.stepKey, cmd.attempt), mustJob(cmd.jobId),
      cmd.usage ? readObservation(cmd.usage.callId) : null,
    ]);
    if (!s) return fail("conflict");
    if (prior) {
      const artifact = cmd.result ? await prepareLifecycleArtifact(db, s.context, cmd.result, cmd.now, s.stored.encoded.envelope.contextId) : null;
      if (prior.outcome !== cmd.outcome || prior.callId !== cmd.callId || !same(prior.usage, cmd.usage) || !same(prior.result, artifact?.reference ?? null)) return fail("conflict");
      return { outcome: "replayed" as const, proof: prior };
    }
    if (s.row.attempt_count !== cmd.attempt || s.row.claim_token !== cmd.token || !["claimed", "effect_started"].includes(String(s.row.state))) return fail("conflict");
    const a = s.context.authority;
    if (j.status !== "running" || j.current_step !== cmd.stepKey) return fail("conflict");
    if (cmd.usage && (!same(observed, cmd.usage) || cmd.usage.callId !== cmd.callId || cmd.usage.jobId !== cmd.jobId || cmd.usage.stepKey !== cmd.stepKey || cmd.usage.attempt !== cmd.attempt)) return fail("conflict");
    if (cmd.outcome === "success" ? !cmd.result || !cmd.usage || !cmd.callId : cmd.result !== null) return fail("invalid");
    if (cmd.outcome === "rejected" && (!cmd.usage || !cmd.callId)) return fail("invalid");
    if (cmd.outcome === "uncertain" && (cmd.usage !== null || !cmd.callId)) return fail("invalid");
    const artifact = cmd.result ? await prepareLifecycleArtifact(db, s.context, cmd.result, cmd.now, s.stored.encoded.envelope.contextId) : null;
    const state = { success: "succeeded", rejected: "terminal_failed", stale: "stale", uncertain: "uncertain" }[cmd.outcome];
    const reason = { success: "step_succeeded", rejected: "step_rejected", stale: "step_stale", uncertain: "step_uncertain" } as const;
    const nextStatus = cmd.outcome === "stale" ? "stale" : cmd.outcome === "rejected" ? "failed" : "running";
    const ev = transition(j, { contextId: s.stored.encoded.envelope.contextId, fingerprint: s.stored.encoded.envelope.fingerprint }, reason[cmd.outcome],
      logicalStage(j.current_step) ?? fail("corrupt"), nextStatus);
    ev.stepKey = cmd.stepKey; ev.attempt = cmd.attempt; ev.commandKey = s.context.command?.key ?? null;
    const wait = command.rewait ? await contexts.prepare(command.rewait.context, command.rewait.base) : null;
    if (s.context.command && cmd.outcome === "success") {
      if (!wait || wait.context.kind !== "wait" || wait.context.parent?.commandKey !== s.context.command.key ||
        wait.context.parent.waitGeneration !== s.context.command.waitGeneration || wait.context.wait.generation !== j.wait_generation + 1 ||
        wait.context.enter.eventNo !== ev.eventNo || wait.context.enter.stateVersion !== ev.after.stateVersion) return fail("invalid");
      ev.after.status = "awaiting_transcript_review"; ev.after.stage = "transcript_review"; ev.after.waitGeneration = wait.context.wait.generation;
    } else if (wait) return fail("invalid");
    const after = artifact ? null : await sql.one("SELECT (SELECT version FROM sermon_input_heads WHERE sermon_id=?) AS input,(SELECT coalesce(max(event_count),0) FROM sermon_content_heads WHERE sermon_id=?) AS content", [a.sermonId, a.sermonId]);
    const beforeInput = a.input.state === "present" ? a.input.version : null, beforeContent = a.content.state === "present" ? a.content.eventCount : 0;
    const afterInput = artifact?.afterInputVersion ?? parse(z.int().positive().nullable(), after?.input), afterContent = artifact?.afterContentCount ?? parse(lifecycleCount, after?.content);
    const outcomeRow = { job_id: j.id, step_key: cmd.stepKey, attempt: cmd.attempt, context_id: ev.context.contextId, input_fingerprint: ev.context.fingerprint,
      task: s.row.task as string, outcome: cmd.outcome, reason: ({ success: "none", rejected: "domain_invalid", stale: "authority_changed", uncertain: "usage_unknown" } as const)[cmd.outcome],
      event_no: ev.eventNo, state_version: ev.after.stateVersion, call_id: cmd.callId, usage_event_id: cmd.usage?.usageId ?? null,
      result_step_key: artifact ? cmd.stepKey : null, before_input_version: beforeInput, after_input_version: afterInput, before_content_count: beforeContent, after_content_count: afterContent };
    const plan: D1PreparedStatement[] = [...(artifact?.statements ?? [])];
    if (cmd.usage) plan.push(...await settlementPlan(cmd.usage, cmd.now, false));
    else if (cmd.callId) plan.push(sql.stmt("UPDATE ai_provider_calls SET state='uncertain',completed_at=? WHERE id=? AND generation_job_id=? AND step_key=? AND attempt_number=? AND state='effect_started'", [cmd.now, cmd.callId, cmd.jobId, cmd.stepKey, cmd.attempt]));
    if (artifact && cmd.usage) plan.push(sql.insert("generation_step_result_links", { generation_job_id: j.id, step_key: cmd.stepKey, task: s.row.task as string,
      correction_sermon_id: s.context.execution.task === "correction" ? a.sermonId : null, correction_event_id: s.context.execution.task === "correction" ? artifact.reference.id : null,
      content_sermon_id: s.context.execution.task === "correction" ? null : a.sermonId, content_event_id: s.context.execution.task === "correction" ? null : artifact.reference.id,
      final_audit_result_id: null, usage_event_id: cmd.usage.usageId, result_kind: artifact.reference.kind, result_id: artifact.reference.id, result_version: artifact.reference.version, result_fingerprint: artifact.reference.fingerprint }));
    const physicalAfter = wait ? "transcript_review" : j.current_step;
    plan.push(sql.insert("generation_transition_evidence", evidenceRow(ev, { before: j.current_step, after: physicalAfter, commandOrdinal: s.context.command?.ordinal ?? null })),
      sql.insert("generation_step_outcomes", outcomeRow),
      sql.stmt(`UPDATE generation_step_receipts SET state=?,outcome_attempt=?,claim_token=NULL,lease_expires_at=NULL,result_kind=?,result_id=?,result_version=?,result_fingerprint=?,updated_at=?,completed_at=?
        WHERE generation_job_id=? AND step_key=? AND attempt_count=? AND claim_token=? AND state=?`, [state, cmd.attempt, artifact?.reference.kind ?? null, artifact?.reference.id ?? null,
        artifact?.reference.version ?? null, artifact?.reference.fingerprint ?? null, cmd.now, cmd.now, cmd.jobId, cmd.stepKey, cmd.attempt, cmd.token, String(s.row.state)]));
    if (cmd.usage) plan.push(sql.insert("ai_usage_settlements", { call_id: cmd.usage.callId, usage_event_id: cmd.usage.usageId, job_id: j.id, step_key: cmd.stepKey,
      attempt: cmd.attempt, fingerprint: await fingerprintLifecycleValue(cmd.usage), settled_at: cmd.now }));
    if (s.context.command) plan.push(sql.stmt("UPDATE generation_control_commands SET state=?,outcome_attempt=? WHERE job_id=? AND ordinal=? AND state='running'", [cmd.outcome === "success" ? "succeeded" : cmd.outcome === "uncertain" ? "uncertain" : cmd.outcome === "stale" ? "stale" : "rejected", cmd.attempt, j.id, s.context.command.ordinal]));
    if (wait && wait.context.kind === "wait") plan.push(...contexts.inserts(wait), sql.insert("generation_wait_contexts", { job_id: j.id, wait_generation: wait.context.wait.generation,
      context_id: wait.encoded.envelope.contextId, request_context_id: wait.context.request.contextId, kind: "transcript_review", enter_event_no: ev.eventNo, enter_state_version: ev.after.stateVersion,
      parent_wait_generation: s.context.command!.waitGeneration, command_ordinal: s.context.command!.ordinal, parent_step_key: cmd.stepKey, parent_attempt: cmd.attempt }), contexts.seal(wait.encoded.envelope.contextId));
    plan.push(updateJob(j, ev, physicalAfter, cmd.now, wait?.encoded.envelope.fingerprint ?? null), sql.insert("generation_job_events", eventRow(ev, cmd.now)));
    const proof = parse(outcomeProofSchema, { jobId: j.id, stepKey: cmd.stepKey, attempt: cmd.attempt, context: ev.context, outcome: cmd.outcome, event: ev,
      callId: cmd.callId, usage: cmd.usage, result: artifact?.reference ?? null, beforeInputVersion: beforeInput, afterInputVersion: afterInput, beforeContentCount: beforeContent, afterContentCount: afterContent });
    if (await (cmd.outcome === "success" ? guardedBatch(a, plan) : sql.batch(plan))) return { outcome: "saved" as const, proof };
    const probe = await probeOutcome(proof);
    if (probe.outcome === "exact") return { outcome: "replayed" as const, proof };
    return { outcome: probe.outcome === "unavailable" ? "unavailable" as const : "uncertain" as const };
  }
  async function settleLateUsage(raw: UsageObservation, now: string) {
    const u = parse(usageObservationSchema, raw); parse(lifecycleTime, now);
    if (!same(await readObservation(u.callId), u) || now < u.observedAt) return fail("conflict");
    const o = await outcome(u.jobId, u.stepKey, u.attempt);
    if (!o || o.outcome === "success" || o.callId !== u.callId) return fail("conflict");
    if (await settled(u)) return { outcome: "replayed" as const };
    if (await sql.batch(await settlementPlan(u, now, true))) return { outcome: "saved" as const };
    return { outcome: await settled(u) ? "replayed" as const : "uncertain" as const };
  }

  async function completedPrefix(jobId: string) {
    const rows = await sql.rows(`SELECT event_no FROM generation_transition_evidence WHERE job_id=? AND
      (reason='step_succeeded' AND command_ordinal IS NULL OR reason='received' AND before_wait IS NOT NULL AND command_ordinal IS NULL
       OR reason='wait_entered' AND before_stage='intent_critique' AND EXISTS (
         SELECT 1 FROM generation_jobs j JOIN generation_contexts c ON c.id=j.request_context_id
         JOIN generation_archived_intent_recoveries r ON r.event_id=c.critique_event_id AND r.sermon_id=j.sermon_id
         JOIN generation_intent_analysis_reuse reuse ON reuse.job_id=j.id WHERE j.id=generation_transition_evidence.job_id)
       OR reason='stage_completed' AND (before_stage IN ('input_resolve','content_review','place_child','place_adult','final_validate')
         OR before_stage='intent_analysis' AND EXISTS (SELECT 1 FROM generation_intent_analysis_reuse reuse WHERE reuse.job_id=generation_transition_evidence.job_id)
         OR before_stage='transcript_review' AND NOT EXISTS (SELECT 1 FROM generation_wait_contexts w WHERE w.job_id=generation_transition_evidence.job_id AND w.kind='transcript_review')))
      ORDER BY event_no LIMIT 16`, [jobId], 15);
    const result = await readTogether(rows.map(async row => {
      const e = await evidence(jobId, parse(positiveInteger, row.event_no));
      if (!e) return fail("corrupt");
      const stage = (e.reason === "step_succeeded" ? e.after.stage : e.before?.stage) ?? fail("corrupt");
      if (e.reason === "step_succeeded") {
        const own = await outcome(jobId, e.stepKey ?? fail("corrupt"), e.attempt ?? fail("corrupt"));
        if (!own || own.outcome !== "success" || !same(own.event, e)) return fail("corrupt");
      } else if (e.reason === "received") {
        const d = await sql.one("SELECT id FROM generation_job_dispatches WHERE generation_job_id=? AND dispatch_key=? LIMIT 2", [jobId, e.dispatchKey ?? fail("corrupt")]);
        if (!d || !same((await receiver(parse(lifecycleId, d.id)))?.evidence, e)) return fail("corrupt");
      }
      return { stage, evidence: e };
    }));
    if (result.length > 15) return fail("limit");
    return result;
  }
  async function completeFinalValidation(raw: GenerationAuthoritySnapshot, ticketId: string, now: string) {
    const a = parse(generationAuthoritySnapshotSchema, raw); parse(lifecycleId, ticketId); parse(lifecycleTime, now);
    const j = await mustJob(a.jobId);
    const prior = await sql.one("SELECT * FROM generation_final_validation_proofs WHERE job_id=? LIMIT 2", [j.id]);
    if (j.execution_contract_version === 3 && j.request_scope === "full" && j.status === "running" &&
      j.current_step === "finish" && prior && prior.ticket_id === ticketId && prior.context_id === j.request_context_id &&
      prior.event_no === j.event_count && prior.state_version === j.state_version) {
      return { outcome: "replayed" as const, previewFingerprint: parse(lifecycleDigest, prior.preview_fingerprint) };
    }
    const stored = await contexts.read(j.request_context_id);
    if (j.execution_contract_version !== 3 || j.request_scope !== "full" || j.status !== "running" ||
      j.current_step !== "final_validate" || !stored || stored.context.kind !== "request" ||
      j.settings_revision === null || j.selection_revision === null) return fail("conflict");
    const saved = await finalTickets.readFinalTicket(ticketId);
    if (!saved || saved.status !== "current") return { outcome: "stale" as const };
    if (a.selection.state !== "present") return { outcome: "not_ready" as const };
    const capture = { ticket: saved.payload, settingsRevision: a.selection.settingsRevision, selectionRevision: a.selection.selectionRevision };
    const ticketFingerprint = parse(lifecycleDigest, saved.row.ticket_fingerprint);
    if (ticketFingerprint !== await fingerprintLifecycleValue(capture.ticket) || assessFinalCapture(a, capture).outcome !== "ready" ||
      !await physicalCurrent(a)) return { outcome: "stale" as const };
    const checked = await validateCurrentGenerationFinal(db, capture.ticket);
    if (checked.outcome !== "passed") return { outcome: "not_ready" as const };
    const open = await sql.one(`SELECT
      (SELECT count(*) FROM generation_step_receipts WHERE generation_job_id=? AND state IN ('claimed','effect_started','retryable_failed','uncertain')) AS effects,
      (SELECT count(*) FROM generation_control_commands WHERE job_id=? AND state IN ('pending','running','uncertain')) AS commands,
      (SELECT count(*) FROM generation_job_dispatches WHERE generation_job_id=? AND state NOT IN ('acknowledged','stale','terminal_failed')) AS dispatches`, [j.id, j.id, j.id]);
    if (Number(open?.effects) || Number(open?.commands) || Number(open?.dispatches)) return { outcome: "busy" as const };
    if (prior) return { outcome: "conflict" as const };
    const ev = transition(j, { contextId: j.request_context_id, fingerprint: stored.encoded.envelope.fingerprint }, "stage_completed", "finish");
    const previewFingerprint = await fingerprintLifecycleValue(checked.preview);
    const plan = [sql.insert("generation_transition_evidence", evidenceRow(ev, { before: "final_validate", after: "finish" })),
      sql.insert("generation_final_validation_proofs", { job_id: j.id, context_id: j.request_context_id, ticket_id: ticketId,
        ticket_fingerprint: ticketFingerprint, preview_fingerprint: previewFingerprint, event_no: ev.eventNo,
        state_version: ev.after.stateVersion, checked_at: now }),
      updateJob(j, ev, "finish", now), sql.insert("generation_job_events", eventRow(ev, now)),
      ...await finalDisplayStatements(db, a, ticketId, capture.ticket, checked)];
    if (await guardedBatch(a, plan)) return { outcome: "saved" as const, previewFingerprint };
    const own = await sql.one("SELECT * FROM generation_final_validation_proofs WHERE job_id=? LIMIT 2", [j.id]);
    return { outcome: own && equal(own, { context_id: j.request_context_id, ticket_id: ticketId, ticket_fingerprint: ticketFingerprint,
      preview_fingerprint: previewFingerprint, event_no: ev.eventNo, state_version: ev.after.stateVersion }) ? "replayed" as const : "conflict" as const };
  }
  async function finishReuse(j: LifecycleJob, a: Pick<GenerationAuthoritySnapshot, "scope" | "sermonId" | "quizSetId">) {
    const reuse = a.scope === "intent" || a.scope === "full" ? await sql.one("SELECT source_job_id,analysis_event_id FROM generation_intent_analysis_reuse WHERE job_id=? LIMIT 2", [j.id]) : null;
    if (reuse) {
      const recovery = a.scope === "full" ? await sql.one(`SELECT attempt,call_id,usage_id,context_id,context_fingerprint
        FROM generation_archived_intent_recoveries WHERE event_id=? AND source_job_id=? AND sermon_id=? AND quiz_set_id=? LIMIT 2`,
      [parse(lifecycleId, reuse.analysis_event_id), parse(lifecycleId, reuse.source_job_id), a.sermonId, a.quizSetId]) : null;
      const source = await outcome(parse(lifecycleId, reuse.source_job_id), "intent_analysis", recovery ? parse(positiveInteger, recovery.attempt) : 1);
      if (a.scope === "full" ? !recovery || !source || source.outcome !== "rejected" || source.result !== null ||
        source.callId !== recovery.call_id || source.usage?.usageId !== recovery.usage_id ||
        source.context.contextId !== recovery.context_id || source.context.fingerprint !== recovery.context_fingerprint :
        !source || source.outcome !== "success" || source.result?.id !== reuse.analysis_event_id) return fail("corrupt");
    }
    const requestCapture = await contexts.read(j.request_context_id);
    const reusedCritiqueId = reuse && j.execution_contract_version === 3 && requestCapture?.context.kind === "request" &&
      requestCapture.context.authority.content.state === "present" ? requestCapture.context.authority.content.availableCritique?.id ?? null : null;
    if (reusedCritiqueId) {
      const recovery = await sql.one("SELECT source_job_id,attempt,call_id,usage_id,context_id,context_fingerprint FROM generation_archived_intent_recoveries WHERE event_id=? AND sermon_id=? AND quiz_set_id=?",
        [reusedCritiqueId, a.sermonId, a.quizSetId]);
      if (!recovery) return fail("corrupt");
      const source = await outcome(parse(lifecycleId, recovery.source_job_id), "intent_critique", parse(positiveInteger, recovery.attempt));
      if (!source || source.outcome !== "rejected" || source.result !== null || source.callId !== recovery.call_id ||
        source.usage?.usageId !== recovery.usage_id || source.context.contextId !== recovery.context_id ||
        source.context.fingerprint !== recovery.context_fingerprint) return fail("corrupt");
    }
    return { reusedAnalysis: !!reuse, reusedCritique: !!reusedCritiqueId };
  }

  const finishPreparations = new WeakSet<object>();
  function freezePreparation<T>(value: T): T {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freezePreparation(child);
      Object.freeze(value);
    }
    return value;
  }
  async function prepareReviewedFull(jobId: string) {
    const jobRead = mustJob(jobId);
    const [initial, prefix, open, reuse] = await readTogether([
      jobRead, completedPrefix(jobId),
      sql.one(`SELECT
        (SELECT count(*) FROM generation_step_receipts WHERE generation_job_id=? AND state IN ('claimed','effect_started','retryable_failed','uncertain')) AS effects,
        (SELECT count(*) FROM generation_control_commands WHERE job_id=? AND state IN ('pending','running','uncertain')) AS commands,
        (SELECT count(*) FROM generation_job_dispatches WHERE generation_job_id=? AND state NOT IN ('acknowledged','stale','terminal_failed')) AS dispatches`, [jobId,jobId,jobId]),
      jobRead.then(j => finishReuse(j, { scope: j.request_scope, sermonId: j.sermon_id, quizSetId: j.quiz_set_id })),
    ]);
    const prepared = freezePreparation({ initial, prefix, open, reuse }); finishPreparations.add(prepared); return prepared;
  }
  /** Finish a reviewed full job as one conditional transaction. The same
   * evidence rows, validation proof and guards are used as the resumable path;
   * there is no need to re-read the entire graph after each bookkeeping stage. */
  async function completeReviewedFull(raw: GenerationAuthoritySnapshot, ticketId: string, now: string, prepared?: Awaited<ReturnType<typeof prepareReviewedFull>>) {
    const a = parse(generationAuthoritySnapshotSchema, raw); parse(lifecycleId, ticketId); parse(lifecycleTime, now);
    const [preflight, saved] = await readTogether([prepared ?? prepareReviewedFull(a.jobId), finalTickets.readFinalTicket(ticketId)]);
    if (!finishPreparations.has(preflight) || preflight.initial.id !== a.jobId || preflight.initial.state_version !== a.jobStateVersion) return fail("conflict");
    const { initial, open, reuse } = preflight;
    const prefix = [...preflight.prefix];
    if (initial.execution_contract_version !== 3 || initial.request_scope !== "full" || initial.status !== "running" ||
      initial.current_step !== "content_review" || a.selection.state !== "present") return { outcome: "not_ready" as const };
    if (!saved || saved.status !== "current" || saved.row.quiz_set_id !== a.quizSetId || saved.row.sermon_id !== a.sermonId)
      return { outcome: "stale" as const };
    if (Number(open?.effects) || Number(open?.commands) || Number(open?.dispatches)) return { outcome: "busy" as const };
    const capture = { ticket: saved.payload, settingsRevision: a.selection.settingsRevision, selectionRevision: a.selection.selectionRevision };
    if (assessFinalCapture(a, capture).outcome !== "ready") return { outcome: "stale" as const };
    const [current, stored, checked] = await readTogether([physicalCurrent(a, initial), contexts.read(initial.request_context_id), validateCurrentGenerationFinal(db, saved.payload)]);
    if (!current) return { outcome: "stale" as const };
    if (!stored || stored.context.kind !== "request" || checked.outcome !== "passed") return { outcome: "not_ready" as const };
    const ticketFingerprint = await fingerprintLifecycleValue(saved.payload), previewFingerprint = await fingerprintLifecycleValue(checked.preview);
    if (saved.row.ticket_fingerprint !== ticketFingerprint) return fail("corrupt");
    const plan: D1PreparedStatement[] = [];
    plan.push(...await finalDisplayStatements(db, a, ticketId, saved.payload, checked));
    let j = initial;
    for (const stage of ["place_child", "place_adult", "final_validate", "finish"] as const) {
      const ev = transition(j, { contextId: j.request_context_id, fingerprint: stored.encoded.envelope.fingerprint }, "stage_completed", stage);
      plan.push(sql.insert("generation_transition_evidence", evidenceRow(ev, { before: j.current_step, after: stage })));
      if (stage === "finish") plan.push(sql.insert("generation_final_validation_proofs", { job_id: j.id, context_id: j.request_context_id,
        ticket_id: ticketId, ticket_fingerprint: ticketFingerprint, preview_fingerprint: previewFingerprint,
        event_no: ev.eventNo, state_version: ev.after.stateVersion, checked_at: now }));
      plan.push(updateJob(j, ev, stage, now), sql.insert("generation_job_events", eventRow(ev, now)));
      prefix.push({ stage: parse(generationStageSchema, j.current_step), evidence: ev });
      j = { ...j, current_step: stage, state_version: ev.after.stateVersion, event_count: ev.eventNo,
        required_event_no: ev.eventNo, required_event_state_version: ev.after.stateVersion, evidence_event_no: ev.eventNo };
    }
    const finalAuthority = { ...a, jobStateVersion: j.state_version };
    const final = { kind: "validated", capture, validationContextId: j.request_context_id, validationContext: stored.context,
      ticketId, ticketFingerprint, previewFingerprint, hardGate: "passed" };
    const verdict = await assessGenerationFinish({ requestContractVersion: 3, captured: finalAuthority,
      current: { outcome: "captured", snapshot: finalAuthority }, prefix, openEffect: false, openCommand: false, ...reuse, final });
    if (verdict.outcome !== "terminal_candidate" || verdict.status !== "review_ready") return verdict;
    const ev = transition(j, prefix.at(-1)!.evidence.context, "review_ready", "finish", "review_ready");
    plan.push(sql.insert("generation_transition_evidence", evidenceRow(ev, { before: "finish", after: "finish" })),
      updateJob(j, ev, "finish", now), sql.insert("generation_job_events", eventRow(ev, now)));
    // Quality ratings and cleanup can change without moving the content head.
    const qualityGuard = sql.stmt(`SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=?)
      AND NOT EXISTS (SELECT 1 FROM sermon_content_quality_reviews r WHERE r.sermon_id=? AND r.snapshot_event_id IN (?,?,?,?)
        AND r.status='regenerate' AND r.revision=(SELECT max(v.revision) FROM sermon_content_quality_reviews v
          WHERE v.sermon_id=r.sermon_id AND v.snapshot_event_id=r.snapshot_event_id))
      AND NOT EXISTS (SELECT 1 FROM generation_step_receipts WHERE generation_job_id=? AND state IN ('claimed','effect_started','retryable_failed','uncertain'))
      AND NOT EXISTS (SELECT 1 FROM generation_control_commands WHERE job_id=? AND state IN ('pending','running','uncertain'))
      AND NOT EXISTS (SELECT 1 FROM generation_job_dispatches WHERE generation_job_id=? AND state NOT IN ('acknowledged','stale','terminal_failed'))
      THEN 1 ELSE json('GENERATION_REVIEW_CHANGED') END`, [a.sermonId,a.sermonId,saved.payload.binding.analysisId,
        saved.payload.summary.summaryId,saved.payload.placements.child.ticket.poolId,saved.payload.placements.adult.ticket.poolId,a.jobId,a.jobId,a.jobId]);
    if (await guardedBatch(a, [qualityGuard, ...plan], [0, ...plan.map(() => 1)])) return { outcome: "saved" as const, preview: checked.preview };
    const own = await safeRead(() => evidence(j.id, ev.eventNo));
    return own.outcome === "present" && same(own.value, ev) ? { outcome: "replayed" as const, preview: checked.preview }
      : { outcome: own.outcome === "unavailable" ? "unavailable" as const : "conflict" as const };
  }
  async function finish(raw: GenerationAuthoritySnapshot, now: string) {
    const a = parse(generationAuthoritySnapshotSchema, raw); parse(lifecycleTime, now);
    if (["final_audit", "single_entry"].includes(a.scope)) return { outcome: "not_ready" as const };
    const j = await job(a.jobId);
    if (!j || (a.scope === "full" && j.execution_contract_version !== 3)) return { outcome: "not_ready" as const };
    const prefix = await completedPrefix(a.jobId), last = prefix.at(-1);
    if (!last) return { outcome: "not_ready" as const };
    const existing = await evidence(a.jobId, a.jobStateVersion + 2);
    if (j.status === "review_ready") return { outcome: existing?.reason === "review_ready" && existing.before?.stateVersion === a.jobStateVersion &&
      same(existing.context, last.evidence.context) ? "replayed" as const : "conflict" as const };
    const open = await sql.one(`SELECT
      (SELECT count(*) FROM generation_step_receipts WHERE generation_job_id=? AND state IN ('claimed','effect_started','retryable_failed','uncertain')) AS effects,
      (SELECT count(*) FROM generation_control_commands WHERE job_id=? AND state IN ('pending','running','uncertain')) AS commands`, [j.id, j.id]);
    let final: unknown = null;
    if (a.scope === "full") {
      const proof = await sql.one("SELECT * FROM generation_final_validation_proofs WHERE job_id=? LIMIT 2", [j.id]);
      if (!proof || proof.event_no !== last.evidence.eventNo || proof.state_version !== last.evidence.after.stateVersion ||
        proof.context_id !== last.evidence.context.contextId) return { outcome: "not_ready" as const };
      const stored = await contexts.read(parse(lifecycleId, proof.context_id));
      if (!stored || stored.context.kind !== "request" || j.settings_revision === null || j.selection_revision === null ||
        stored.encoded.envelope.fingerprint !== last.evidence.context.fingerprint) return { outcome: "corrupt" as const };
      const ticket = await finalTickets.readFinalTicket(parse(lifecycleId, proof.ticket_id));
      if (!ticket || ticket.status !== "current" || ticket.row.ticket_fingerprint !== proof.ticket_fingerprint) return { outcome: "stale" as const };
      if (a.selection.state !== "present") return { outcome: "not_ready" as const };
      final = { kind: "validated", capture: { ticket: ticket.payload, settingsRevision: a.selection.settingsRevision, selectionRevision: a.selection.selectionRevision }, validationContextId: proof.context_id,
        validationContext: stored.context, ticketId: proof.ticket_id, ticketFingerprint: proof.ticket_fingerprint,
        previewFingerprint: proof.preview_fingerprint, hardGate: "passed" };
    }
    const { reusedAnalysis, reusedCritique } = await finishReuse(j, a);
    const verdict = await assessGenerationFinish({ requestContractVersion: j.execution_contract_version, captured: a,
      current: { outcome: "captured", snapshot: a }, prefix, openEffect: Number(open?.effects) > 0,
      openCommand: Number(open?.commands) > 0, reusedAnalysis, reusedCritique, final });
    if (verdict.outcome !== "terminal_candidate" || verdict.status !== "review_ready" || verdict.stage !== "finish") return verdict;
    if (!await physicalCurrent(a)) return { outcome: "stale" as const };
    const ev = transition(j, last.evidence.context, "review_ready", "finish", "review_ready");
    if (await guardedBatch(a, [sql.insert("generation_transition_evidence", evidenceRow(ev, { before: j.current_step, after: "finish" })),
      updateJob(j, ev, "finish", now), sql.insert("generation_job_events", eventRow(ev, now))])) return { outcome: "saved" as const };
    const own = await safeRead(() => evidence(j.id, ev.eventNo));
    return { outcome: own.outcome === "present" && same(own.value, ev) ? "replayed" as const : own.outcome === "unavailable" ? "unavailable" as const : "conflict" as const };
  }
  async function reclaimStep(jobId: string, key: string, expectedAttempt: number, token: string, now: string, lease: string) {
    parse(positiveInteger, expectedAttempt); parse(lifecycleId, token); parse(lifecycleTime, now); parse(lifecycleTime, lease);
    if (lease <= now) return fail("invalid");
    const s = await step(jobId, key); if (!s) return fail("conflict");
    if (s.row.effect_class !== "pure" || !["claimed", "retryable_failed"].includes(String(s.row.state))) return { outcome: "uncertain" as const };
    if (s.row.attempt_count !== expectedAttempt || (s.row.state === "claimed" && String(s.row.lease_expires_at) > now)) return { outcome: "busy" as const };
    const ok = await guardedBatch(s.context.authority, [sql.stmt(`UPDATE generation_step_receipts SET state='claimed',attempt_count=?,claim_token=?,lease_expires_at=?,updated_at=?
      WHERE generation_job_id=? AND step_key=? AND attempt_count=? AND effect_class='pure' AND (state='retryable_failed' OR state='claimed' AND lease_expires_at<=?)`,
    [expectedAttempt + 1, token, lease, now, jobId, key, expectedAttempt, now])]);
    if (ok) return { outcome: "claimed" as const };
    const own = await safeRead(() => step(jobId, key));
    return { outcome: own.outcome === "present" && equal(own.value.row, { state: "claimed", attempt_count: expectedAttempt + 1,
      claim_token: token, lease_expires_at: lease, updated_at: now }) ? "replayed" as const : own.outcome === "unavailable" ? "unavailable" as const : "busy" as const };
  }
  async function markStale(jobId: string, expectedVersion: number, contextId: string, now: string) {
    parse(lifecycleCount, expectedVersion); parse(lifecycleTime, now);
    const j = await mustJob(jobId), c = await contexts.read(contextId);
    if (!c || c.encoded.envelope.jobId !== jobId) return fail("conflict");
    const old = await evidence(jobId, expectedVersion + 2);
    if (old?.reason === "job_stale" && old.context.contextId === contextId && old.before?.stateVersion === expectedVersion) return { outcome: "replayed" as const };
    if (j.state_version !== expectedVersion || ["review_ready", "needs_revision", "stale", "failed"].includes(j.status)) return fail("conflict");
    const ev = transition(j, { contextId, fingerprint: c.encoded.envelope.fingerprint }, "job_stale", logicalStage(j.current_step) ?? "input_resolve", "stale");
    ev.after.stage = logicalStage(j.current_step);
    const rows = await sql.one(`SELECT
      (SELECT count(*) FROM generation_control_commands WHERE job_id=? AND state IN ('pending','running')) AS commands,
      (SELECT count(*) FROM generation_job_dispatches WHERE generation_job_id=? AND state IN ('pending','claimed','retryable_failed','uncertain')) AS dispatches`, [jobId, jobId]);
    const plan = [sql.insert("generation_transition_evidence", evidenceRow(ev, { before: j.current_step, after: j.current_step })),
      sql.stmt("UPDATE generation_control_commands SET state='stale' WHERE job_id=? AND state IN ('pending','running')", [jobId]),
      sql.stmt("UPDATE generation_job_dispatches SET state='stale',claim_token=NULL,lease_expires_at=NULL WHERE generation_job_id=? AND state IN ('pending','claimed','retryable_failed','uncertain')", [jobId]),
      updateJob(j, ev, j.current_step, now), sql.insert("generation_job_events", eventRow(ev, now))];
    if (await sql.batch(plan, [1, parse(lifecycleCount, rows?.commands), parse(lifecycleCount, rows?.dispatches), 1, 1])) return { outcome: "saved" as const };
    const own = await safeRead(() => evidence(jobId, ev.eventNo));
    return { outcome: own.outcome === "present" && same(own.value, ev) ? "replayed" as const : own.outcome === "unavailable" ? "unavailable" as const : "conflict" as const };
  }
  async function rejectCorrection(raw: unknown, base: ContextEnvelopeInput) {
    const p = await contexts.prepare(raw, base), c = p.context, e = p.encoded.envelope;
    if (c.kind !== "wait" || !c.parent || c.wait.kind !== "transcript_review") return fail("invalid");
    const saved = await contexts.read(e.contextId);
    if (saved) return { outcome: same(saved.encoded.envelope, e) ? "replayed" as const : "conflict" as const };
    const j = await mustJob(e.jobId), command = await sql.one("SELECT * FROM generation_control_commands WHERE job_id=? AND command_key=? LIMIT 2", [e.jobId, c.parent.commandKey]);
    if (!command || !["pending", "running"].includes(String(command.state)) || command.outcome_attempt !== null ||
      command.wait_generation !== c.parent.waitGeneration || c.enter.eventNo !== j.event_count + 1 || c.enter.stateVersion !== j.state_version + 1) return fail("conflict");
    const ordinal = parse(positiveInteger, command.ordinal);
    const ev = transition(j, { contextId: e.contextId, fingerprint: e.fingerprint }, "wait_entered", "transcript_review", "awaiting_transcript_review", c.wait.generation);
    ev.commandKey = c.parent.commandKey;
    const affected = await sql.one("SELECT count(*) AS n FROM generation_job_dispatches WHERE generation_job_id=? AND wait_generation=? AND state IN ('pending','claimed','retryable_failed','uncertain')", [j.id, c.parent.waitGeneration]);
    const plan = [...contexts.inserts(p), sql.insert("generation_transition_evidence", evidenceRow(ev, { before: j.current_step, after: "transcript_review", commandOrdinal: ordinal })),
      sql.stmt("UPDATE generation_control_commands SET state='rejected' WHERE job_id=? AND ordinal=? AND state=? AND outcome_attempt IS NULL", [j.id, ordinal, String(command.state)]),
      sql.stmt("UPDATE generation_job_dispatches SET state='stale',claim_token=NULL,lease_expires_at=NULL WHERE generation_job_id=? AND wait_generation=? AND state IN ('pending','claimed','retryable_failed','uncertain')", [j.id, c.parent.waitGeneration]),
      sql.insert("generation_wait_contexts", { job_id: j.id, wait_generation: c.wait.generation, context_id: e.contextId,
        request_context_id: c.request.contextId, kind: c.wait.kind, enter_event_no: c.enter.eventNo, enter_state_version: c.enter.stateVersion,
        parent_wait_generation: c.parent.waitGeneration, command_ordinal: ordinal, parent_step_key: null, parent_attempt: null }), contexts.seal(e.contextId),
      updateJob(j, ev, "transcript_review", e.createdAt, e.fingerprint), sql.insert("generation_job_events", eventRow(ev, e.createdAt))];
    const changes = plan.map(() => 1); changes[p.encoded.chunks.length + 3] = parse(lifecycleCount, affected?.n);
    if (await sql.batch(plan, changes)) return { outcome: "saved" as const };
    const own = await safeRead(() => evidence(j.id, ev.eventNo));
    return { outcome: own.outcome === "present" && same(own.value, ev) ? "replayed" as const : own.outcome === "unavailable" ? "unavailable" as const : "conflict" as const };
  }

  return { finish, prepareReviewedFull, completeReviewedFull, completeFinalValidation, reclaimStep, markStale, rejectCorrection, readCompletedPrefix: (id: string) => safeRead(() => completedPrefix(id)), startProviderCall, observeUsage, commitOutcome, settleLateUsage, probeOutcome,
    readObservation: (id: string) => safeRead(() => readObservation(id)),
    readOutcome: (jobId: string, key: string, attempt: number) => safeRead(() => outcome(jobId, key, attempt)),
    registerCorrection, claimStep, advance, createRequest, claimDispatch, reserveSend, receive, enterWait, ensureResume,
    readContext: (id: string) => safeRead(() => contexts.read(id)),
    readEvidence: (id: string, no: number) => safeRead(() => evidence(id, no)),
    readReceiver: (id: string) => safeRead(() => receiver(id)),
    readDispatch: (id: string) => safeRead(() => dispatch(id)),
    readJob: (id: string) => safeRead(() => job(id)),
  };
}
