import { readTogether } from "./generation-read-session";
import { snapshotDisplayStatement, hasSnapshotDisplayStorage } from "./generation-display-store";
import { z } from "zod";
import { readVerifiedEvents } from "./human-content-runtime-store";
import { domainStorageBudgetStatus } from "../services/generation-domain-resources";
import { correctionDocumentProposalSchema } from "../services/transcript-correction-document";
import { canonicalDomainJson } from "../services/generation-domain-codec";
import { assertPreparedDomain, DOMAIN_STORAGE_BUDGET, domainStorageJson, persistedDomain, domainLineage } from "./generation-domain-storage";
import { canonicalGenerationJson } from "../services/generation-context-codec";
import { lifecycleId, lifecycleDigest, type StepContext } from "../services/generation-lifecycle-contract";
import { buffer, digestBytes, equal, fail, parse, sqlAccess, type Row, type Value } from "./generation-lifecycle-data";

// Existing input-event storage limits, not a new product output quota.
const correctionStorageBudget = { maxPayloadBytes: 67_108_864, chunkBytes: 16_384, maxChunks: 4096,
  maxReferences: 32, maxTargets: 10, maxDepth: 32, maxNodes: 1_000_000,
  maxDecodedBytes: 134_217_728, maxBatchStatements: 4096 };
function artifactJson(value: unknown) {
  if (persistedDomain(value)) return domainStorageJson(value);
  const document = correctionDocumentProposalSchema.safeParse(value);
  return document.success ? canonicalDomainJson(document.data, correctionStorageBudget) : canonicalGenerationJson(value);
}
const resultSchema = z.strictObject({ id: lifecycleId, actorDigest: lifecycleDigest.nullable(), payload: z.unknown() });
export type LifecycleResultInput = z.input<typeof resultSchema>;
export type LifecycleResultRef = { kind: string; id: string; version: number; fingerprint: string };
/** Document correction and validated intent use measured storage envelopes.
 * Legacy synthetic payloads retain their original codec. */
export async function prepareLifecycleArtifact(db: D1Database, c: StepContext, raw: LifecycleResultInput, now: string, contextId: string) {
  const result = parse(resultSchema, raw), sql = sqlAccess(db), a = c.authority, i = a.input;
  if (i.state !== "present") return fail("invalid");
  const task = c.execution.task;
  const domain = persistedDomain(result.payload) ? await assertPreparedDomain(result.payload, c, contextId, result.id) : null;
  if (!["correction", "intent_analysis", "intent_critique", "summary", "child_candidates", "adult_candidates"].includes(task)) return fail("not_ready");
  const text = artifactJson(result.payload), bytes = new TextEncoder().encode(text), fingerprint = await digestBytes(bytes);
  const count = a.content.state === "present" ? a.content.eventCount : 0;
  const reference: LifecycleResultRef = { id: result.id, version: task === "correction" ? i.version + 1 : i.version + count + 1,
    kind: task === "correction" ? "correction_proposal" : `${task}_event`, fingerprint };
  parse(z.int().positive(), reference.version);
  const statements: D1PreparedStatement[] = [];
  if (task === "correction") {
    if (!result.actorDigest || i.sourceKind !== "caption") return fail("invalid");
    const source = await sql.one("SELECT source_type FROM sermon_input_events WHERE sermon_id=? AND id=? AND state='sealed' LIMIT 2", [a.sermonId, i.sourceId]);
    if (!source || typeof source.source_type !== "string") return fail("corrupt");
    // TEXT splitting preserves exact UTF-8 bytes, including multi-byte boundaries.
    const chunks: string[] = []; let current = "", size = 0;
    for (const ch of text) { const n = new TextEncoder().encode(ch).byteLength; if (size + n > 16384) { chunks.push(current); current = ""; size = 0; } current += ch; size += n; }
    if (current) chunks.push(current);
    if (correctionDocumentProposalSchema.safeParse(result.payload).success && domainStorageBudgetStatus("correction", {
      payload: result.payload, byteLength: bytes.byteLength, chunkCount: chunks.length, statementCount: chunks.length + 3,
    }).outcome !== "ready") return fail("limit");
    statements.push(sql.insert("sermon_input_events", { sermon_id: a.sermonId, version: reference.version, id: result.id,
      kind: "proposal", source_type: source.source_type, source_id: i.sourceId, document_id: i.documentId, confirmation_id: i.confirmationId,
      parent_document_id: i.documentId, related_id: null, document_sha256: i.documentSha256, payload_sha256: fingerprint,
      chunk_count: chunks.length, byte_length: bytes.byteLength, actor_id: result.actorDigest, created_at: now, state: "pending", required_state: "sealed" }),
      ...chunks.map((body, position) => sql.insert("sermon_input_chunks", { sermon_id: a.sermonId, event_id: result.id, position, body })),
      sql.stmt("UPDATE sermon_input_heads SET version=? WHERE sermon_id=? AND version=?", [reference.version, a.sermonId, i.version]),
      sql.stmt("UPDATE sermon_input_events SET state='sealed' WHERE sermon_id=? AND id=? AND state='pending'", [a.sermonId, result.id]));
  } else {
    if (result.actorDigest !== null) return fail("invalid");
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < bytes.byteLength; offset += 65536) chunks.push(bytes.slice(offset, offset + 65536));
    const content = a.content.state === "present" ? a.content : null;
    // The legacy SQL pointer records an available comparison critique. Domain
    // authority records the critique belonging to the actually selected snapshot.
    const comparison = domain && count > 0 ? await sql.one(
      "SELECT intent_critique_event_id FROM sermon_content_current WHERE sermon_id=? AND event_count=? AND last_event_id=?",
      [a.sermonId, count, content!.lastEventId]) : null;
    if (domain && count > 0 && !comparison) return fail("conflict");
    const kind = task.endsWith("_candidates") ? "candidate" : task, difficulty = task === "child_candidates" ? "child" : task === "adult_candidates" ? "adult" : null;
    const relatesIntent = kind === "summary" || kind === "candidate";
    statements.push(sql.insert("sermon_content_events", { sermon_id: a.sermonId, event_id: result.id, content_sequence: count + 1,
      aggregate_version: reference.version, origin: "ai", kind, difficulty, generation_job_id: a.jobId, step_key: c.stepKey,
      input_version: i.version, source_id: i.sourceId, document_id: i.documentId, document_sha256: i.documentSha256, confirmation_id: i.confirmationId,
      base_analysis_event_id: c.execution.task === "intent_critique" ? c.execution.context.baseAnalysisId : null,
      analysis_event_id: relatesIntent ? content?.intent?.selectedId ?? null : null,
      intent_confirmation_event_id: relatesIntent ? content?.intent?.confirmation?.id ?? null : null,
      payload_sha256: fingerprint, payload_byte_length: bytes.byteLength, payload_chunk_count: chunks.length,
      state: "assembling", required_state: "sealed", created_by_actor_id: null, created_at: now }),
      sql.insert("sermon_content_payloads", { sermon_id: a.sermonId, event_id: result.id, codec: "content-event-json-utf8-v1", chunk_bytes: 65536,
        chunk_count: chunks.length, byte_length: bytes.byteLength, payload_sha256: fingerprint, verified: 0 }));
    if (domain) statements.push(sql.insert("sermon_content_domain_lineage", domainLineage(domain)));
    for (const [position, chunk] of chunks.entries()) statements.push(sql.insert("sermon_content_chunks", {
      sermon_id: a.sermonId, event_id: result.id, position, byte_length: chunk.byteLength, chunk_sha256: await digestBytes(chunk), body: buffer(chunk), verified: 1 }));
    const current: Record<string, Value> = { sermon_id: a.sermonId, event_count: count + 1, last_event_id: result.id,
      selected_analysis_event_id: domain?.after.state === "present" ? domain.after.intent?.selectedId ?? null : task === "intent_analysis" ? result.id : content?.intent?.selectedId ?? null,
      intent_critique_event_id: domain?.after.state === "present" ? domain.after.availableCritique?.id ?? domain.after.intent?.critique?.id ?? null : task === "intent_critique" ? result.id : content?.intent?.critique?.id ?? null,
      intent_confirmation_event_id: content?.intent?.confirmation?.id ?? null,
      summary_snapshot_event_id: domain?.after.state === "present" ? domain.after.summary?.id ?? null : task === "summary" ? result.id : content?.summary?.id ?? null, summary_review_event_id: content?.summary?.review?.id ?? null,
      child_pool_event_id: domain?.after.state === "present" ? domain.after.child?.id ?? null : difficulty === "child" ? result.id : content?.child?.id ?? null, child_review_event_id: content?.child?.review?.id ?? null,
      adult_pool_event_id: domain?.after.state === "present" ? domain.after.adult?.id ?? null : difficulty === "adult" ? result.id : content?.adult?.id ?? null, adult_review_event_id: content?.adult?.review?.id ?? null,
      required_event_count: count + 1, required_event_id: result.id };
    statements.push(count === 0 ? sql.insert("sermon_content_heads", { sermon_id: a.sermonId, event_count: 1, last_event_id: result.id, required_event_count: 1, required_event_id: result.id }) :
      sql.stmt("UPDATE sermon_content_heads SET event_count=?,last_event_id=?,required_event_count=?,required_event_id=? WHERE sermon_id=? AND event_count=?", [count + 1, result.id, count + 1, result.id, a.sermonId, count]));
    if (count > 0) {
      const entries = Object.entries(current).filter(([key]) => key !== "sermon_id");
      statements.push(sql.stmt(`UPDATE sermon_content_current SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE sermon_id=? AND event_count=?`, [...entries.map(([, value]) => value), a.sermonId, count]));
    }
    statements.push(sql.stmt("UPDATE sermon_content_payloads SET verified=1 WHERE sermon_id=? AND event_id=? AND verified=0", [a.sermonId, result.id]),
      sql.stmt("UPDATE sermon_content_events SET state='sealed' WHERE sermon_id=? AND event_id=? AND state='assembling'", [a.sermonId, result.id]));
    if (count === 0) statements.push(sql.insert("sermon_content_current", current));
    const displayProjection = !!domain && await hasSnapshotDisplayStorage(db);
    if (domain && displayProjection) statements.push(await snapshotDisplayStatement(db, domain, fingerprint));
    if (domain && (bytes.byteLength > DOMAIN_STORAGE_BUDGET.maxPayloadBytes || chunks.length > DOMAIN_STORAGE_BUDGET.maxChunks ||
      statements.length > DOMAIN_STORAGE_BUDGET.maxBatchStatements)) return fail("limit");
    if (domain && domainStorageBudgetStatus(task as "intent_analysis" | "intent_critique", {
      payload: domain, byteLength: bytes.byteLength, chunkCount: chunks.length, statementCount: statements.length, displayProjection,
    }).outcome !== "ready") return fail("not_ready");
  }
  return { statements, reference, afterInputVersion: task === "correction" ? i.version + 1 : i.version,
    afterContentCount: task === "correction" ? count : count + 1 };
}
export async function verifyLifecycleArtifact(db: D1Database, c: StepContext, link: Row, reference: LifecycleResultRef) {
  const sql = sqlAccess(db), a = c.authority, i = a.input;
  if (i.state !== "present" || !equal(link, { generation_job_id: a.jobId, step_key: c.stepKey, task: c.execution.task,
    result_kind: reference.kind, result_id: reference.id, result_version: reference.version, result_fingerprint: reference.fingerprint })) return false;
  const count = a.content.state === "present" ? a.content.eventCount : 0;
  if (reference.kind !== (c.execution.task === "correction" ? "correction_proposal" : `${c.execution.task}_event`) ||
    reference.version !== i.version + (c.execution.task === "correction" ? 1 : count + 1)) return false;
  let bytes: Uint8Array;
  if (c.execution.task === "correction") {
    if (!equal(link, { correction_sermon_id: a.sermonId, correction_event_id: reference.id, content_sermon_id: null, content_event_id: null, final_audit_result_id: null })) return false;
    const event = await sql.one("SELECT * FROM sermon_input_events WHERE sermon_id=? AND id=? LIMIT 2", [a.sermonId, reference.id]);
    if (!event || !equal(event, { kind: "proposal", state: "sealed", version: reference.version, payload_sha256: reference.fingerprint,
      source_id: i.sourceId, document_id: i.documentId, document_sha256: i.documentSha256, confirmation_id: i.confirmationId, parent_document_id: i.documentId })) return false;
    if (typeof event.byte_length !== "number" || event.byte_length > 67_108_864 || typeof event.chunk_count !== "number" || event.chunk_count > 4096) return false;
    const chunks = await sql.rows("SELECT position,substr(body,1,16385) AS body,length(CAST(body AS BLOB)) AS stored_length FROM sermon_input_chunks WHERE sermon_id=? AND event_id=? ORDER BY position LIMIT 4097", [a.sermonId, reference.id], 4096);
    if (chunks.length !== event.chunk_count || chunks.some((v, n) => v.position !== n || typeof v.body !== "string" || typeof v.stored_length !== "number" || v.stored_length > 16384 || new TextEncoder().encode(v.body).byteLength !== v.stored_length)) return false;
    bytes = new TextEncoder().encode(chunks.map(c => c.body).join(""));
    if (bytes.byteLength !== event.byte_length) return false;
  } else {
    if (!equal(link, { correction_sermon_id: null, correction_event_id: null, content_sermon_id: a.sermonId, content_event_id: reference.id, final_audit_result_id: null })) return false;
    const [event, manifest] = await readTogether([
      sql.one("SELECT * FROM sermon_content_events WHERE sermon_id=? AND event_id=? LIMIT 2", [a.sermonId, reference.id]),
      sql.one("SELECT * FROM sermon_content_payloads WHERE sermon_id=? AND event_id=? LIMIT 2", [a.sermonId, reference.id]),
    ]);
    const kind = c.execution.task.endsWith("_candidates") ? "candidate" : c.execution.task;
    if (!event || !manifest || !equal(event, { generation_job_id: a.jobId, step_key: c.stepKey, kind, state: "sealed", origin: "ai",
      aggregate_version: reference.version, content_sequence: (a.content.state === "present" ? a.content.eventCount : 0) + 1,
      base_analysis_event_id: c.execution.task === "intent_critique" ? c.execution.context.baseAnalysisId : null,
      analysis_event_id: ["summary", "candidate"].includes(kind) && a.content.state === "present" ? a.content.intent?.selectedId ?? null : null,
      intent_confirmation_event_id: ["summary", "candidate"].includes(kind) && a.content.state === "present" ? a.content.intent?.confirmation?.id ?? null : null,
      payload_sha256: reference.fingerprint, input_version: i.version, source_id: i.sourceId,
      document_id: i.documentId, document_sha256: i.documentSha256, confirmation_id: i.confirmationId,
      difficulty: c.execution.task === "child_candidates" ? "child" : c.execution.task === "adult_candidates" ? "adult" : null }) ||
      !equal(manifest, { codec: "content-event-json-utf8-v1", chunk_bytes: 65536, verified: 1, payload_sha256: reference.fingerprint, byte_length: event.payload_byte_length, chunk_count: event.payload_chunk_count })) return false;
    const length = parse(z.int().positive().max(DOMAIN_STORAGE_BUDGET.maxPayloadBytes), manifest.byte_length);
    parse(z.int().positive().max(DOMAIN_STORAGE_BUDGET.maxChunks), manifest.chunk_count);
    // The current-content reader and lifecycle proof verify the same sealed
    // bytes. Reuse its operation-scoped, hash-checked payload; keep the distinct
    // lifecycle owner/projection checks above and canonical-byte check here.
    try {
      const [verified] = await readVerifiedEvents(db, a.sermonId, [reference.id]);
      if (!verified || verified.origin !== "ai" || verified.kind !== kind) return false;
      const canonical = new TextEncoder().encode(artifactJson(verified.payload));
      return canonical.byteLength === length && await digestBytes(canonical) === reference.fingerprint;
    } catch { return false; }
  }
  if (await digestBytes(bytes) !== reference.fingerprint) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return artifactJson(JSON.parse(text)) === text;
  } catch { return false; }
}
