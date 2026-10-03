import { readVerifiedEvents } from "../repositories/human-content-runtime-store";
import { readTogether, generationReadSession } from "../repositories/generation-read-session";
import { snapshotDisplayStatement, readDisplaySnapshots, finalDisplayPartStatement, readDisplayFinal } from "../repositories/generation-display-store";
import { domainPreparedSchema } from "./generation-domain-contract";
import { fingerprintLifecycleValue } from "./generation-context-codec";
import { domainLineage, domainStorageJson } from "../repositories/generation-domain-storage";
import { readArchivedIntentRecovery, verifyArchivedIntentRecovery } from "../repositories/archived-intent-recovery-store";
import { presentGenerationFinalPart } from "./generation-final-validation";
import { finalCheckTicketSchema } from "./final-check-contract";
import { sha256Bytes } from "../storage/sha256";

// These are domain payloads: timed evidence permits finite decimals and larger
// analyses. Keep lifecycle contexts on their separate integer-only codec.
function sameDisplaySource(a: unknown, b: unknown): boolean {
  try { return domainStorageJson(a) === domainStorageJson(b); } catch { return false; }
}

type Owner = { sermonId: string; quizSetId: string; jobId: string };
export async function verifyPreparedDisplayFinal(db: D1Database, owner: Owner, ticketId: string) {
  const [saved, proof] = await readTogether([readDisplayFinal(db, owner, ticketId),
    db.prepare("SELECT preview_fingerprint FROM generation_final_validation_proofs WHERE job_id=? AND ticket_id=?")
      .bind(owner.jobId, ticketId).first<{preview_fingerprint: string}>()]);
  if (!proof || await fingerprintLifecycleValue(saved.preview) !== proof.preview_fingerprint) throw new Error("CONTENT_DISPLAY_CORRUPT");
  return { outcome: "prepared" as const };
}
/** Explicit one-time preparation of existing immutable data, never a GET effect. */
export async function prepareDisplayEvent(db: D1Database, owner: Owner, eventId: string) {
  db = generationReadSession(db);
  const ids = [eventId];
    const [events, evidence] = await readTogether([readVerifiedEvents(db, owner.sermonId, ids),
      db.prepare(`SELECT l.*,e.payload_sha256,e.content_sequence,e.generation_job_id,e.created_at,e.created_by_actor_id,h.operation human_operation,
        EXISTS(SELECT 1 FROM generation_step_outcomes o JOIN generation_step_result_links r
          ON r.generation_job_id=o.job_id AND r.step_key=o.result_step_key
          JOIN generation_contexts c ON c.id=o.context_id AND c.state='sealed'
          WHERE o.job_id=e.generation_job_id AND o.step_key=e.step_key AND o.attempt=1 AND o.outcome='success'
          AND r.content_sermon_id=e.sermon_id AND r.content_event_id=e.event_id
          AND r.result_id=e.event_id AND r.result_fingerprint=e.payload_sha256) display_success,
        (SELECT c.id FROM generation_step_outcomes o JOIN generation_contexts c ON c.id=o.context_id AND c.state='sealed'
          WHERE o.job_id=e.generation_job_id AND o.step_key=e.step_key AND o.attempt=1) display_context_id,
        (SELECT c.fingerprint FROM generation_step_outcomes o JOIN generation_contexts c ON c.id=o.context_id AND c.state='sealed'
          WHERE o.job_id=e.generation_job_id AND o.step_key=e.step_key AND o.attempt=1) display_context_fingerprint,
        EXISTS(SELECT 1 FROM generation_archived_intent_recoveries r WHERE r.sermon_id=e.sermon_id AND r.event_id=e.event_id) recovered
        FROM sermon_content_events e JOIN sermon_content_domain_lineage l ON l.sermon_id=e.sermon_id AND l.event_id=e.event_id
        LEFT JOIN sermon_content_human_events h ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id
        WHERE e.sermon_id=? AND e.event_id IN (${ids.map(() => "?").join(",")})`)
        .bind(owner.sermonId, ...ids).all<Record<string, unknown>>()]);
    for (const event of events) {
      const wrapper = event.origin === "human" && event.payload && typeof event.payload === "object" && "command" in event.payload ? event.payload : null;
      const prepared = domainPreparedSchema.parse(wrapper ? wrapper.command : event.payload);
      const snapshot = prepared.materializedSnapshot, op = prepared.operation.operation;
      if (prepared.owner.sermonId !== owner.sermonId || prepared.owner.quizSetId !== owner.quizSetId ||
        prepared.origin !== event.origin || prepared.event.id !== event.eventId ||
        snapshot && snapshot.value.id !== event.eventId ||
        wrapper && (!('materializedSnapshot' in wrapper) || !sameDisplaySource(wrapper.materializedSnapshot, snapshot))) throw new Error("CONTENT_DISPLAY_CORRUPT");
      const row = evidence.results.find(r => r.event_id === event.eventId);
      if (!row || Object.entries(domainLineage(prepared)).some(([key, value]) => row[key] !== value) ||
        snapshot && !sameDisplaySource(snapshot.operation, op)) throw new Error("CONTENT_DISPLAY_CORRUPT");
      if (event.origin === "human") {
        if (!("kind" in op) || row.created_at !== prepared.event.createdAt || row.created_by_actor_id !== prepared.event.actorDigest ||
          row.human_operation !== `${prepared.operation.family}_${op.kind}`) throw new Error("CONTENT_DISPLAY_CORRUPT");
      } else if (row.recovered === 1) {
        const recovery = await readArchivedIntentRecovery(db, owner.sermonId, event.eventId);
        if (!recovery || !await verifyArchivedIntentRecovery(db, recovery, prepared)) throw new Error("CONTENT_DISPLAY_CORRUPT");
      } else if (row.generation_job_id !== prepared.owner.jobId || row.display_success !== 1 ||
        row.display_context_id !== prepared.context.contextId || row.display_context_fingerprint !== prepared.context.fingerprint) {
        throw new Error("CONTENT_DISPLAY_CORRUPT");
      }

      if (typeof row.payload_sha256 !== "string") throw new Error("CONTENT_DISPLAY_CORRUPT");
      await (await snapshotDisplayStatement(db, prepared, row.payload_sha256)).run();
    }
  await readDisplaySnapshots(db, owner, ids);
  return { outcome: "prepared" as const };
}

/** Old completed jobs have an immutable final-validation proof. Use that proof
 * for this display-only copy; no source re-extraction or publication permission. */
export async function prepareDisplayFinalPart(db: D1Database, owner: Owner, ticketId: string, difficulty: "child" | "adult") {
  const row = await db.prepare(`SELECT t.ticket_fingerprint,t.payload_sha256,t.payload_byte_length,t.payload_chunk_count,
    EXISTS(SELECT 1 FROM generation_final_validation_proofs p WHERE p.job_id=? AND p.ticket_id=t.id AND p.ticket_fingerprint=t.ticket_fingerprint) checked
    FROM final_check_tickets t WHERE t.id=? AND t.sermon_id=? AND t.quiz_set_id=? AND t.state='sealed'`)
    .bind(owner.jobId, ticketId, owner.sermonId, owner.quizSetId).first<{ticket_fingerprint: string; payload_sha256: string;
      payload_byte_length: number; payload_chunk_count: number; checked: number}>();
  if (!row || row.checked !== 1) throw new Error("CONTENT_DISPLAY_UNVERIFIED_TICKET");
  const chunks = await db.prepare("SELECT position,hex(body) body_hex,byte_length,chunk_sha256 FROM final_check_ticket_chunks WHERE ticket_id=? AND verified=1 ORDER BY position")
    .bind(ticketId).all<{position: number; body_hex: string; byte_length: number; chunk_sha256: string}>();
  if (chunks.results.length !== row.payload_chunk_count) throw new Error("CONTENT_DISPLAY_CORRUPT");
  const bytes = new Uint8Array(row.payload_byte_length); let offset = 0;
  for (const [index, chunk] of chunks.results.entries()) {
    const body = Uint8Array.from(chunk.body_hex.match(/.{2}/g) ?? [], value => parseInt(value, 16));
    if (chunk.position !== index || body.length !== chunk.byte_length || await sha256Bytes(body) !== chunk.chunk_sha256) throw new Error("CONTENT_DISPLAY_CORRUPT");
    bytes.set(body, offset); offset += body.length;
  }
  if (offset !== bytes.length || await sha256Bytes(bytes) !== row.payload_sha256) throw new Error("CONTENT_DISPLAY_CORRUPT");
  const ticket = finalCheckTicketSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)));
  if (ticket.sermonId !== owner.sermonId || await fingerprintLifecycleValue(ticket) !== row.ticket_fingerprint) throw new Error("CONTENT_DISPLAY_CORRUPT");
  const ids = [ticket.summary.summaryId, ticket.placements[difficulty].ticket.poolId];
  const saved = await readDisplaySnapshots(db, owner, ids);
  // A proof was only written after validating source eligibility and disclosure.
  const source = await db.prepare("SELECT source_type FROM sermon_input_events WHERE sermon_id=? AND id=? AND state='sealed'")
    .bind(owner.sermonId, ticket.binding.transcript.sourceId).first<{source_type: string}>();
  if (!source) throw new Error("CONTENT_DISPLAY_CORRUPT");
  const part = await presentGenerationFinalPart(ticket, id => saved.find(s => s.snapshot?.value.id === id)?.snapshot ?? null,
    source.source_type === "caption_plain" || source.source_type === "caption_timed", difficulty);
  if (part.outcome !== "passed") throw new Error("CONTENT_DISPLAY_UNAVAILABLE");
  await (await finalDisplayPartStatement(db, owner, ticketId, difficulty, { ticket, preview: part.preview, layout: part.layout })).run();
  return { outcome: "prepared" as const };
}
