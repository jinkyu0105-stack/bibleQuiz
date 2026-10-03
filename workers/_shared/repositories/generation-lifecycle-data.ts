import { readTogether, generationVerifiedRead } from "./generation-read-session";
import { createSermonInputStore } from "./sermon-input-store";
import { transcriptSourcePayloadSchema } from "../services/transcript-input-contract";
import { verifySource } from "../services/transcript-content";
import { z } from "zod";
import { sha256Bytes } from "../storage/sha256";
import { decodeD1HexBlob } from "../storage/d1-hex-blob";
import {
  decodeGenerationContext, encodeGenerationContext, GENERATION_CONTEXT_LIMITS, sameLifecycleValue,
  type ContextEnvelopeInput, type EncodedGenerationContext,
} from "../services/generation-context-codec";
import {
  generationContextEnvelopeSchema, generationContextSchema, lifecycleId,
  GENERATION_STAGE_STORAGE, type GenerationContext, type TransitionEvidence,
} from "../services/generation-lifecycle-contract";

/** Internal SQL machinery. Never exposed as a route, Workflow value or diagnostic. */
export type Row = Record<string, unknown>;
export type Value = string | number | null | ArrayBuffer;
export type Probe = "exact" | "absent" | "conflict" | "corrupt" | "unavailable";
export class LifecycleStorageError extends Error {
  constructor(readonly code: "invalid" | "limit" | "corrupt" | "unavailable" | "conflict" | "uncertain" | "not_ready") {
    super(`GENERATION_LIFECYCLE_${code.toUpperCase()}`);
  }
}
export function fail(code: LifecycleStorageError["code"]): never { throw new LifecycleStorageError(code); }
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fail("corrupt");
}
export function equal(actual: Row, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => sameLifecycleValue(actual[key], value));
}
export function blob(raw: unknown): Uint8Array {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (raw instanceof Uint8Array) return raw;
  if (Array.isArray(raw) && raw.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) return new Uint8Array(raw);
  return fail("corrupt");
}
export function buffer(bytes: Uint8Array): ArrayBuffer { return new Uint8Array(bytes).buffer; }
export function sqlAccess(db: D1Database) {
  const stmt = (sql: string, values: Value[] = []) => db.prepare(sql).bind(...values);
  async function rows(sql: string, values: Value[] = [], maximum = 1): Promise<Row[]> {
    let result: D1Result<Row>;
    try { result = await stmt(sql, values).all<Row>(); } catch { return fail("unavailable"); }
    if (!result.success || !Array.isArray(result.results)) return fail("unavailable");
    if (result.results.length > maximum) return fail("limit");
    return result.results;
  }
  async function one(sql: string, values: Value[] = []): Promise<Row | null> {
    return (await rows(sql, values))[0] ?? null;
  }
  // Table/column names are authored in this private module's callers, never user input.
  const insert = (table: string, row: Record<string, Value>) => stmt(
    `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`, Object.values(row));
  async function batch(statements: D1PreparedStatement[], changes = statements.map(() => 1)): Promise<boolean> {
    try {
      const result = await db.batch(statements);
      return result.length === changes.length && result.every((r, i) => r.success === true &&
        Number.isSafeInteger(r.meta.changes) && r.meta.changes === changes[i]);
    } catch { return false; }
  }
  return { stmt, rows, one, insert, batch };
}
export function contextProjection(c: GenerationContext) {
  const a = c.kind === "wait" ? c.wait : c.authority, i = a.input, t = a.content;
  const content = t.state === "present" ? t : null;
  const ticket = c.references.filter(r => r.kind === "ticket");
  if (ticket.length > 1) return fail("invalid");
  return {
    input_state: i.state, input_version: i.state === "present" ? i.version : null,
    source_id: i.state === "present" ? i.sourceId : null, document_id: i.state === "present" ? i.documentId : null,
    document_sha256: i.state === "present" ? i.documentSha256 : null, confirmation_id: i.state === "present" ? i.confirmationId : null,
    content_count: content?.eventCount ?? 0, last_content_event_id: content?.lastEventId ?? null,
    analysis_event_id: content?.intent?.selectedId ?? null, critique_event_id: content?.availableCritique?.id ?? content?.intent?.critique?.id ?? null,
    intent_confirmation_event_id: content?.intent?.confirmation?.id ?? null,
    summary_event_id: content?.summary?.id ?? null, summary_review_event_id: content?.summary?.review?.id ?? null,
    child_event_id: content?.child?.id ?? null, child_review_event_id: content?.child?.review?.id ?? null,
    adult_event_id: content?.adult?.id ?? null, adult_review_event_id: content?.adult?.review?.id ?? null,
    metadata_revision: c.kind === "wait" ? c.wait.metadataRevision : c.authority.metadata.metadataRevision,
    settings_revision: a.selection.state === "present" ? a.selection.settingsRevision : null,
    selection_revision: a.selection.state === "present" ? a.selection.selectionRevision : null,
    ticket_id: ticket[0]?.eventId ?? null, ticket_fingerprint: ticket[0]?.sha256 ?? null,
  };
}
export type StoredContext = { context: GenerationContext; encoded: EncodedGenerationContext; row: Row };
export function contextStorage(db: D1Database) {
  const sql = sqlAccess(db);
  async function prepare(raw: unknown, base: ContextEnvelopeInput) {
    let encoded: EncodedGenerationContext;
    try { encoded = await encodeGenerationContext(raw, base); } catch { return fail("invalid"); }
    const context = parse(generationContextSchema, raw), e = encoded.envelope;
    const row = { id: e.contextId, job_id: e.jobId, sermon_id: e.sermonId, quiz_set_id: e.quizSetId, kind: e.kind,
      contract_version: 2, validator_version: 1, assembly_version: 1, codec: e.codec, fingerprint: e.fingerprint,
      byte_length: e.byteLength, chunk_count: e.chunkCount, reference_count: e.referencedEvents,
      state: "assembling", required_state: "sealed", created_at: e.createdAt, ...contextProjection(context) };
    return { context, encoded, row };
  }
  function inserts(p: Awaited<ReturnType<typeof prepare>>) {
    return [sql.insert("generation_contexts", p.row), ...p.encoded.chunks.map(c => sql.insert("generation_context_chunks", {
      context_id: p.encoded.envelope.contextId, position: c.position, byte_length: c.byteLength, sha256: c.sha256, body: buffer(c.body), verified: 1,
    }))];
  }
  const seal = (id: string) => sql.stmt("UPDATE generation_contexts SET state='sealed' WHERE id=? AND state='assembling'", [id]);
  async function references(c: GenerationContext) {
    // IDs are bounded by the codec to 32. Grouped IN queries avoid D1 compound-SELECT limits.
    if (!c.references.length) return;
    const found: Row[] = [];
    await readTogether((["input", "content", "ticket"] as const).map(async kind => {
      const refs = c.references.filter(r => r.kind === kind);
      if (!refs.length) return;
      const table = kind === "input" ? "sermon_input_events" : kind === "content" ? "sermon_content_events" : "final_check_tickets";
      const column = kind === "content" ? "event_id" : "id";
      const digest = kind === "input" ? "document_sha256" : kind === "content" ? "payload_sha256" : "ticket_fingerprint";
      found.push(...await sql.rows(`SELECT ${column} AS id,sermon_id,state,${digest} AS digest,payload_sha256 AS payload_digest,'${kind}' AS kind
        FROM ${table} WHERE sermon_id=? AND ${column} IN (${refs.map(() => "?").join(",")})`,
        [refs[0]!.sermonId, ...refs.map(r => r.eventId)], 32));
    }));
    const input = c.kind === "wait" ? c.wait.input : c.authority.input;
    if (found.length !== c.references.length || c.references.some(r => !found.some(v => v.id === r.eventId && v.sermon_id === r.sermonId &&
      v.state === "sealed" && v.kind === r.kind && (r.kind === "input" && input.state === "present" &&
        r.eventId !== input.sourceId && r.eventId !== input.documentId ? v.payload_digest : v.digest) === r.sha256))) fail("corrupt");
    for (const reference of c.references) {
      if (reference.sourceSha256 === undefined) continue;
      if (input.state !== "present" || reference.eventId !== input.sourceId || reference.sourceSha256 !== input.sourceSha256) fail("corrupt");
      const inputStore = createSermonInputStore(db), source = await inputStore.event(reference.sermonId, reference.eventId);
      if (!source || source.kind !== "source") fail("corrupt");
      const rawSource = transcriptSourcePayloadSchema.parse(await inputStore.payload(source));
      await verifySource(rawSource);
      if ((rawSource.sourceMode === "public_unofficial" ? rawSource.sourceSha256 : rawSource.rawTranscriptSha256) !== reference.sourceSha256) fail("corrupt");
    }
  }
  function read(id: string): Promise<StoredContext | null> {
    return generationVerifiedRead(db, `context:${id}`, () => readFresh(id));
  }
  async function readFresh(id: string): Promise<StoredContext | null> {
    parse(lifecycleId, id);
    const [row, j, requestLink, waitLink, stepLink, command, request] = await readTogether([
      sql.one("SELECT * FROM generation_contexts WHERE id=? LIMIT 2", [id]),
      sql.one("SELECT j.request_key,j.request_contract_version,j.request_context_id,j.sermon_id,j.quiz_set_id,j.request_scope FROM generation_jobs j JOIN generation_contexts c ON c.job_id=j.id WHERE c.id=? LIMIT 2", [id]),
      sql.one("SELECT * FROM generation_request_contexts WHERE context_id=? AND job_id=(SELECT job_id FROM generation_contexts WHERE id=?) LIMIT 2", [id, id]),
      sql.one("SELECT * FROM generation_wait_contexts WHERE context_id=? AND job_id=(SELECT job_id FROM generation_contexts WHERE id=?) LIMIT 2", [id, id]),
      sql.one("SELECT * FROM generation_step_contexts WHERE context_id=? AND job_id=(SELECT job_id FROM generation_contexts WHERE id=?) LIMIT 2", [id, id]),
      sql.one("SELECT * FROM generation_control_commands WHERE context_id=? AND job_id=(SELECT job_id FROM generation_contexts WHERE id=?) LIMIT 2", [id, id]),
      sql.one("SELECT c.fingerprint,c.state,r.context_id FROM generation_request_contexts r JOIN generation_contexts c ON c.id=r.context_id WHERE r.job_id=(SELECT job_id FROM generation_contexts WHERE id=?) LIMIT 2", [id]),
    ]);
    if (!row) return null;
    if (!equal(row, { state: "sealed", required_state: "sealed", contract_version: 2, validator_version: 1, assembly_version: 1 })) return fail("corrupt");
    const jobId = parse(lifecycleId, row.job_id);
    if (!j || Number(j.request_contract_version) !== 2 || j.sermon_id !== row.sermon_id || j.quiz_set_id !== row.quiz_set_id) return fail("corrupt");
    const kind = parse(z.enum(["request", "step", "wait"]), row.kind);
    const link = kind === "request" ? requestLink : kind === "wait" ? waitLink : stepLink;
    if (!link && !command) return fail("corrupt");
    const envelope = parse(generationContextEnvelopeSchema, { contextId: id, jobId, sermonId: row.sermon_id, quizSetId: row.quiz_set_id,
      kind, requestKey: j.request_key, createdAt: row.created_at, stepKey: kind === "step" ? (link?.step_key ?? command?.step_key) : null,
      waitGeneration: kind === "wait" ? link?.wait_generation : null, codec: row.codec, fingerprint: row.fingerprint,
      byteLength: row.byte_length, chunkCount: row.chunk_count, referencedEvents: row.reference_count });
    const limit = GENERATION_CONTEXT_LIMITS[kind];
    if (envelope.byteLength > limit.maxContextBytes || envelope.chunkCount > limit.maxChunks || envelope.referencedEvents > limit.maxReferencedEvents) return fail("limit");
    const rawChunks = await sql.rows("SELECT position,byte_length,sha256,CASE WHEN typeof(body)='blob' THEN hex(substr(body,1,16385)) END AS body_hex,length(body) AS stored_length,verified FROM generation_context_chunks WHERE context_id=? ORDER BY position LIMIT 5", [id], 4);
    const chunks = rawChunks.map(c => {
      if (c.verified !== 1 || c.stored_length !== c.byte_length || typeof c.byte_length !== "number" || c.byte_length > 16384) return fail("corrupt");
      const body = decodeD1HexBlob(c.body_hex, 16384);
      if (!body) return fail("corrupt");
      return { position: c.position, byteLength: c.byte_length, sha256: c.sha256, body };
    });
    let context: GenerationContext;
    try { context = await decodeGenerationContext(envelope, chunks, envelope); } catch { return fail("corrupt"); }
    if (!equal(row, contextProjection(context))) return fail("corrupt");
    if (context.kind === "request") {
      if (j.request_context_id !== id || link?.fingerprint !== envelope.fingerprint || context.authority.scope !== j.request_scope) return fail("corrupt");
    } else {
      if (!request || request.state !== "sealed" || !equal(request, { context_id: context.request.contextId, fingerprint: context.request.fingerprint }) || j.request_context_id !== context.request.contextId) return fail("corrupt");
      if (context.kind === "wait") {
        if (!link || !equal(link, { request_context_id: context.request.contextId, kind: context.wait.kind, enter_event_no: context.enter.eventNo, enter_state_version: context.enter.stateVersion })) return fail("corrupt");
        if (link.parent_wait_generation !== (context.parent?.waitGeneration ?? null)) return fail("corrupt");
        if (context.parent) {
          const parent = await sql.one("SELECT command_key,step_key,outcome_attempt FROM generation_control_commands WHERE job_id=? AND ordinal=? LIMIT 2", [jobId, parse(z.int().positive(), link.command_ordinal)]);
          if (!parent || parent.command_key !== context.parent.commandKey || link.parent_attempt !== parent.outcome_attempt ||
            link.parent_step_key !== (parent.outcome_attempt === null ? null : parent.step_key)) return fail("corrupt");
        } else if (link.command_ordinal !== null || link.parent_step_key !== null || link.parent_attempt !== null) return fail("corrupt");
      } else {
        if (context.authority.scope !== j.request_scope) return fail("corrupt");
        if (link && !equal(link, { task: GENERATION_STAGE_STORAGE[context.execution.task].receiptTask, request_context_id: context.request.contextId, input_fingerprint: envelope.fingerprint,
          command_ordinal: context.command?.ordinal ?? null })) return fail("corrupt");
        if (link && !equal(link, { predecessor_event_no: context.predecessor.eventNo, predecessor_state_version: context.predecessor.stateVersion, predecessor_kind: context.predecessor.kind })) return fail("corrupt");
        if (context.command && (!command || !equal(command, { fingerprint: envelope.fingerprint, ordinal: context.command.ordinal, command_key: context.command.key, wait_generation: context.command.waitGeneration }))) return fail("corrupt");
      }
    }
    await references(context);
    return { context, encoded: { envelope, chunks: chunks as EncodedGenerationContext["chunks"] }, row };
  }
  return { prepare, inserts, seal, read, references };
}
export function evidenceRow(e: TransitionEvidence, physical: { before: string | null; after: string; dispatchId?: string | null; commandOrdinal?: number | null }): Record<string, Value> {
  return { job_id: e.jobId, event_no: e.eventNo, before_version: e.before?.stateVersion ?? null, after_version: e.after.stateVersion,
    before_status: e.before?.status ?? null, after_status: e.after.status, before_stage: physical.before, after_stage: physical.after,
    before_wait: e.before?.waitGeneration ?? null, after_wait: e.after.waitGeneration, reason: e.reason,
    context_id: e.context.contextId, fingerprint: e.context.fingerprint, step_key: e.stepKey, attempt: e.attempt,
    dispatch_id: physical.dispatchId ?? null, command_ordinal: physical.commandOrdinal ?? null };
}
export function eventRow(e: TransitionEvidence, now: string): Record<string, Value> {
  return { generation_job_id: e.jobId, event_no: e.eventNo, job_state_version: e.after.stateVersion, attempt_number: e.attempt ?? 1,
    step_key: e.stepKey, level: "info", event_code: e.reason, message_safe: e.reason, metadata_json_safe: null, elapsed_ms: null, created_at: now };
}
export async function digestBytes(bytes: Uint8Array) { return sha256Bytes(bytes); }
