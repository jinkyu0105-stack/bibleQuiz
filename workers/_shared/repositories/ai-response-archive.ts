import { z } from "zod";
import { sha256Bytes } from "../storage/sha256";

const limit = 67_108_864, chunkSize = 65_536;
const id = z.string().min(1).max(128);
const kindSchema = z.enum(["request", "response"]);
type Kind = z.infer<typeof kindSchema>;
const manifestSchema = z.object({ state: z.literal("sealed"), http_status: z.int().min(100).max(599).nullable(),
  byte_length: z.int().min(0).max(limit), chunk_count: z.int().min(0).max(1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u) });
const unavailable = () => new Error("AI_RESPONSE_ARCHIVE_UNAVAILABLE");

/** Durable before sending/parsing. A reserved request is never sent again, even
 * if the process dies before the network call. Explicit recovery reads bytes. */
export function createAiResponseArchive(db: D1Database, rawCallId: string) {
  const callId = id.parse(rawCallId);
  async function save(kind: Kind, bytes: Uint8Array, status: number | null) {
    if (bytes.byteLength > limit) throw unavailable();
    const sha = await sha256Bytes(bytes), count = Math.ceil(bytes.byteLength / chunkSize);
    const condition = kind === "request" ? "state='effect_started'" :
      "EXISTS (SELECT 1 FROM ai_response_archives a WHERE a.call_id=ai_provider_calls.id AND a.kind='request' AND a.state='sealed')";
    // Unique key is the send barrier. A concurrent or restarted process cannot
    // overwrite the request or infer from an absent response that sending is safe.
    const inserted = await db.prepare(`INSERT INTO ai_response_archives
      (call_id,kind,state,http_status,byte_length,chunk_count,sha256,created_at)
      SELECT id,?,'assembling',?,?,?,?,? FROM ai_provider_calls WHERE id=? AND ${condition}
      AND NOT EXISTS(SELECT 1 FROM draft_cleanup_records WHERE sermon_id=ai_provider_calls.sermon_id)`)
      .bind(kind, status, bytes.byteLength, count, sha, new Date().toISOString(), callId).run();
    if (inserted.meta.changes !== 1) throw unavailable();
    for (let position = 0; position < count; position += 32) {
      const saved = await db.batch(Array.from({ length: Math.min(32, count - position) }, (_, n) => {
        const i = position + n;
        return db.prepare(`INSERT INTO ai_response_archive_chunks(call_id,kind,position,body)
          SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM ai_response_archives a JOIN ai_provider_calls c ON c.id=a.call_id
          WHERE a.call_id=? AND a.kind=? AND a.state='assembling'
          AND NOT EXISTS(SELECT 1 FROM draft_cleanup_records WHERE sermon_id=c.sermon_id))`)
          .bind(callId, kind, i, bytes.slice(i * chunkSize, (i + 1) * chunkSize), callId, kind);
      }));
      if (saved.some(row => row.meta.changes !== 1)) throw unavailable();
    }
    const sealed = await db.prepare(`UPDATE ai_response_archives SET state='sealed' WHERE call_id=? AND kind=? AND state='assembling'
      AND chunk_count=(SELECT count(*) FROM ai_response_archive_chunks WHERE call_id=? AND kind=?)
      AND byte_length=(SELECT coalesce(sum(length(body)),0) FROM ai_response_archive_chunks WHERE call_id=? AND kind=?)
      AND NOT EXISTS(SELECT 1 FROM draft_cleanup_records p JOIN ai_provider_calls c ON c.sermon_id=p.sermon_id WHERE c.id=ai_response_archives.call_id)`)
      .bind(callId, kind, callId, kind, callId, kind).run();
    if (sealed.meta.changes !== 1) throw unavailable();
  }
  return {
    request: (body: string) => save("request", new TextEncoder().encode(body), null),
    response: (status: number, body: Uint8Array) => save("response", body, z.int().min(100).max(599).parse(status)),
  };
}

/** Operator/internal recovery only. There is deliberately no HTTP route. */
export async function readAiResponseArchive(db: D1Database, rawCallId: string, rawKind: Kind) {
  const callId = id.parse(rawCallId), kind = kindSchema.parse(rawKind);
  const raw = await db.prepare(`SELECT state,http_status,byte_length,chunk_count,sha256 FROM ai_response_archives WHERE call_id=? AND kind=?
    AND NOT EXISTS(SELECT 1 FROM draft_cleanup_records p JOIN ai_provider_calls c ON c.sermon_id=p.sermon_id WHERE c.id=ai_response_archives.call_id)`)
    .bind(callId, kind).first();
  if (!raw) return null;
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw unavailable();
  const m = parsed.data;
  if (m.chunk_count !== Math.ceil(m.byte_length / chunkSize) || (kind === "request") !== (m.http_status === null)) throw unavailable();
  // Validate sizes before reading any body. Incomplete/altered records fail closed.
  const sizes = await db.prepare("SELECT position,length(body) size FROM ai_response_archive_chunks WHERE call_id=? AND kind=? ORDER BY position")
    .bind(callId, kind).all<{ position: number; size: number }>();
  if (sizes.results.length !== m.chunk_count || sizes.results.some((c, i) => c.position !== i ||
    c.size !== Math.min(chunkSize, m.byte_length - i * chunkSize))) throw unavailable();
  const bytes = new Uint8Array(m.byte_length);
  for (let start = 0; start < m.chunk_count; start += 32) {
    const rows = await db.prepare("SELECT position,body FROM ai_response_archive_chunks WHERE call_id=? AND kind=? AND position>=? AND position<? ORDER BY position")
      .bind(callId, kind, start, Math.min(start + 32, m.chunk_count)).all<{ position: number; body: number[] | ArrayBuffer }>();
    if (rows.results.length !== Math.min(32, m.chunk_count - start)) throw unavailable();
    rows.results.forEach((row, n) => {
      const chunk = new Uint8Array(row.body);
      if (row.position !== start + n || chunk.byteLength !== sizes.results[start + n]!.size) throw unavailable();
      bytes.set(chunk, row.position * chunkSize);
    });
  }
  if (await sha256Bytes(bytes) !== m.sha256) throw unavailable();
  const current = await db.prepare(`SELECT 1 FROM ai_response_archives a WHERE call_id=? AND kind=? AND state='sealed'
    AND sha256=? AND byte_length=? AND chunk_count=? AND http_status IS ?
    AND NOT EXISTS(SELECT 1 FROM draft_cleanup_records p JOIN ai_provider_calls c ON c.sermon_id=p.sermon_id WHERE c.id=a.call_id)`)
    .bind(callId, kind, m.sha256, m.byte_length, m.chunk_count, m.http_status).first();
  if (!current) throw unavailable();
  return { status: m.http_status, bytes, sha256: m.sha256 };
}
