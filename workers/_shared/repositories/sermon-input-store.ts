import { string, strictObject, int, enum as zEnum, iso, literal, type z } from "zod";
import {
  ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_BYTES,
  ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_CHUNKS,
  ADMIN_SERMON_INPUT_DECISION_BATCH_LIMIT,
  ADMIN_SERMON_INPUT_HISTORY_LIMIT,
} from "../../../shared/api/admin-sermon-input";
import { hash } from "../services/transcript-content";
import { prepareInputSchema } from "../services/prepare-input-schema";
import { sha256Bytes } from "../storage/sha256";

const id = string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const digest = string().regex(/^[0-9a-f]{64}$/u);
export const inputEventSchema = strictObject({
  sermon_id: id, version: int().positive(), id,
  kind: zEnum(["source", "edit", "restore", "confirm", "proposal", "decision", "merge"]),
  source_type: zEnum(["caption_plain", "caption_timed", "sermon_manuscript", "sermon_summary"]),
  source_id: id, document_id: id, confirmation_id: id.nullable(),
  parent_document_id: id.nullable(), related_id: id.nullable(),
  document_sha256: digest, payload_sha256: digest,
  chunk_count: int().min(1).max(4096), byte_length: int().min(1).max(67_108_864),
  actor_id: id, created_at: iso.datetime(), state: literal("sealed"), required_state: literal("sealed"),
});
export type InputEvent = z.infer<typeof inputEventSchema>;
prepareInputSchema(inputEventSchema);
export type InputAppend = Omit<InputEvent, "payload_sha256" | "chunk_count" | "byte_length" | "state" | "required_state">;

const inputHeadMetadataSchema = strictObject({
  id,
  version: int().positive(),
  source_type: inputEventSchema.shape.source_type,
  source_id: id,
  document_id: id,
  confirmation_id: id.nullable(),
});
prepareInputSchema(inputHeadMetadataSchema);
export type InputHeadMetadata = z.infer<typeof inputHeadMetadataSchema>;

const inputHistoryMetadataSchema = strictObject({
  sermon_id: id,
  version: int().positive(),
  id,
  kind: inputEventSchema.shape.kind,
  source_type: inputEventSchema.shape.source_type,
  source_id: id,
  document_id: id,
  confirmation_id: id.nullable(),
  parent_document_id: id.nullable(),
  related_id: id.nullable(),
  created_at: iso.datetime(),
  state: literal("sealed"),
});
export type InputHistoryMetadata = z.infer<typeof inputHistoryMetadataSchema>;

/** Private local path, deliberately not a partial implementation of TranscriptState.
 * A read selects an ID, never the aggregate's entire historical text.
 */
export function createSermonInputStore(db: D1Database) {
  async function event(sermonId: string, eventId: string): Promise<InputEvent | null> {
    const raw = await db.prepare("SELECT * FROM sermon_input_events WHERE sermon_id = ? AND id = ? AND state = 'sealed'")
      .bind(sermonId, eventId).first();
    return raw === null ? null : inputEventSchema.parse(raw);
  }
  async function payload(record: InputEvent): Promise<unknown> {
    const result = await db.prepare("SELECT position, body FROM sermon_input_chunks WHERE sermon_id = ? AND event_id = ? ORDER BY position")
      .bind(record.sermon_id, record.id).all<{ position: number; body: string }>();
    if (!result.success || result.results.length !== record.chunk_count || result.results.some((r, i) => r.position !== i || typeof r.body !== "string")) {
      throw new Error("Input payload unavailable");
    }
    const text = result.results.map((r) => r.body).join("");
    if (new TextEncoder().encode(text).byteLength !== record.byte_length || await hash(text) !== record.payload_sha256) {
      throw new Error("Input payload unavailable");
    }
    return JSON.parse(text) as unknown;
  }
  return {
    event, payload,
    async sermonExists(sermonId: string): Promise<boolean> {
      const row = await db.prepare("SELECT 1 AS found FROM sermons WHERE id = ? LIMIT 1")
        .bind(sermonId).first<{ found: number }>();
      return row?.found === 1;
    },
    async head(sermonId: string): Promise<InputEvent | null> {
      const raw = await db.prepare("SELECT e.* FROM sermon_input_heads h JOIN sermon_input_events e USING (sermon_id, version) WHERE h.sermon_id = ? AND e.state = 'sealed'")
        .bind(sermonId).first();
      return raw === null ? null : inputEventSchema.parse(raw);
    },
    async metadataHead(sermonId: string): Promise<InputHeadMetadata | null> {
      const raw = await db.prepare("SELECT e.id,e.version,e.source_type,e.source_id,e.document_id,e.confirmation_id FROM sermon_input_heads h JOIN sermon_input_events e USING (sermon_id,version) WHERE h.sermon_id = ? AND e.state = 'sealed'")
        .bind(sermonId).first();
      return raw === null ? null : inputHeadMetadataSchema.parse(raw);
    },
    async historyMetadata(sermonId: string, sourceId: string): Promise<InputHistoryMetadata[]> {
      // Explicit allowlist: no actor, hashes, byte sizes, payload, or chunks.
      const result = await db.prepare(`SELECT sermon_id,version,id,kind,source_type,source_id,document_id,confirmation_id,parent_document_id,related_id,created_at,state
        FROM sermon_input_events WHERE sermon_id = ? AND source_id = ? AND state = 'sealed'
        ORDER BY version LIMIT ?`)
        .bind(sermonId, sourceId, ADMIN_SERMON_INPUT_HISTORY_LIMIT + 1)
        .all();
      if (!result.success || result.results.length > ADMIN_SERMON_INPUT_HISTORY_LIMIT) {
        throw new Error("Input history unavailable");
      }
      return result.results.map((row) => inputHistoryMetadataSchema.parse(row));
    },
    async decisions(sermonId: string, proposalId: string): Promise<{ record: InputEvent; payload: unknown }[]> {
      // Preflight metadata before reading one selected proposal's decisions.
      // This prevents a corrupt/oversized history from returning an unbounded
      // chunk join while keeping ordinary correction commands bounded.
      const metadata = await db.prepare(`SELECT * FROM sermon_input_events
        WHERE sermon_id = ? AND related_id = ? AND kind = 'decision' AND state = 'sealed'
        ORDER BY version LIMIT ?`)
        .bind(sermonId, proposalId, ADMIN_SERMON_INPUT_DECISION_BATCH_LIMIT + 1)
        .all();
      if (!metadata.success || metadata.results.length > ADMIN_SERMON_INPUT_DECISION_BATCH_LIMIT) {
        throw new Error("Input decisions unavailable");
      }
      const records = metadata.results.map((row) => inputEventSchema.parse(row));
      const totalBytes = records.reduce((sum, record) => sum + record.byte_length, 0);
      const totalChunks = records.reduce((sum, record) => sum + record.chunk_count, 0);
      if (totalBytes > ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_BYTES ||
        totalChunks > ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_CHUNKS) {
        throw new Error("Input decisions unavailable");
      }
      if (records.length === 0) return [];
      const chunks = await db.prepare(`SELECT c.event_id,c.position,c.body
        FROM sermon_input_chunks c JOIN sermon_input_events e
          ON e.sermon_id = c.sermon_id AND e.id = c.event_id
        WHERE e.sermon_id = ? AND e.related_id = ? AND e.kind = 'decision' AND e.state = 'sealed'
        ORDER BY e.version,c.position LIMIT ?`)
        .bind(sermonId, proposalId, ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_CHUNKS + 1)
        .all<{ event_id: string; position: number; body: string }>();
      if (!chunks.success || chunks.results.length !== totalChunks ||
        chunks.results.length > ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_CHUNKS) {
        throw new Error("Input decisions unavailable");
      }
      const groups = new Map(records.map((record) => [record.id, { record, chunks: [] as string[] }]));
      for (const row of chunks.results) {
        const group = groups.get(row.event_id);
        if (!group || row.position !== group.chunks.length || typeof row.body !== "string") throw new Error("Input decisions unavailable");
        group.chunks.push(row.body);
      }
      const output: { record: InputEvent; payload: unknown }[] = [];
      for (const { record, chunks } of groups.values()) {
        const text = chunks.join("");
        if (chunks.length !== record.chunk_count || new TextEncoder().encode(text).byteLength !== record.byte_length || await hash(text) !== record.payload_sha256) throw new Error("Input decisions unavailable");
        output.push({ record, payload: JSON.parse(text) as unknown });
      }
      return output;
    },
    async append(input: InputAppend, value: unknown): Promise<"saved" | "not_saved" | "unknown"> {
      // TEXT avoids D1's BLOB→number-array decoding. Split at Unicode boundaries;
      // each <=16,384 UTF-16 units, hence <=65,536 UTF-8 bytes. No normalization.
      const text = JSON.stringify(value);
      const chunks: string[] = [];
      for (let offset = 0; offset < text.length;) {
        let end = Math.min(offset + 16_384, text.length);
        if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--;
        chunks.push(text.slice(offset, end)); offset = end;
      }
      const bytes = new TextEncoder().encode(text);
      const record = inputEventSchema.parse({ ...input, payload_sha256: await sha256Bytes(bytes),
        chunk_count: chunks.length, byte_length: bytes.byteLength,
        state: "sealed", required_state: "sealed" });
      const keys = Object.keys(record) as (keyof InputEvent)[];
      const statements = [db.prepare(`INSERT INTO sermon_input_events (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
        .bind(...keys.map((key) => key === "state" ? "pending" : record[key]))];
      const changes = [1];
      for (let offset = 0; offset < chunks.length; offset += 8) {
        const page = chunks.slice(offset, offset + 8);
        statements.push(db.prepare(`INSERT INTO sermon_input_chunks (sermon_id,event_id,position,body) VALUES ${page.map(() => "(?,?,?,?)").join(",")}`)
          .bind(...page.flatMap((body, i) => [record.sermon_id, record.id, offset + i, body])));
        changes.push(page.length);
      }
      statements.push(db.prepare("INSERT INTO sermon_input_heads (sermon_id,version) VALUES (?,?) ON CONFLICT(sermon_id) DO UPDATE SET version = excluded.version WHERE sermon_input_heads.version = ?")
        .bind(record.sermon_id, record.version, record.version - 1));
      statements.push(db.prepare("UPDATE sermon_input_events SET state = 'sealed' WHERE sermon_id = ? AND id = ? AND state = 'pending'")
        .bind(record.sermon_id, record.id));
      changes.push(1, 1);
      try {
        const results = await db.batch(statements);
        if (Array.isArray(results) && results.length === changes.length &&
          Array.from(results).every((r, i) => r?.success === true && r.meta?.changes === changes[i])) return "saved";
      } catch { /* Ambiguous response: inspect this attempt only, never replay it. */ }
      try {
        const own = await event(record.sermon_id, record.id);
        if (own === null) return "not_saved";
        if (!keys.every((key) => own[key] === record[key])) return "unknown";
        const result = await db.prepare("SELECT position, body FROM sermon_input_chunks WHERE sermon_id = ? AND event_id = ? ORDER BY position")
          .bind(record.sermon_id, record.id).all<{ position: number; body: string }>();
        return result.success && result.results.length === chunks.length &&
          result.results.every((r, i) => r.position === i && r.body === chunks[i]) ? "saved" : "unknown";
      } catch { return "unknown"; }
    },
  };
}
export type SermonInputStore = ReturnType<typeof createSermonInputStore>;
