import { z } from "zod";

import { privateTranscriptStateSchema, type PrivateTranscriptState } from "../services/transcript-revision-contract";
import { validateTranscriptState } from "../services/transcript-revisions";
import { sameHistoryValue } from "../storage/history-json-codec";
import { copyHistoryByteArray } from "../storage/history-byte-array";
import { decodeHistoryRecord, historyEnvelopeSchema, historyStreams, type HistoryRecord, type HistoryStream } from "../storage/history-record";
import { verifyHistoryReferences, type HistoryReference, type HistoryScope } from "../storage/history-references";

import { HistoryResourceLimitError, historyResourceLimits as limits, preflightHistoryState, withinHistoryLimit } from "../storage/history-resource-limits";

const id = historyEnvelopeSchema.shape.sermonId;
const count = z.int().nonnegative(), positive = z.int().positive();
const pointers = { current_source_id: id, current_revision_id: id, current_confirmation_id: id.nullable() };
const headSchema = z.strictObject({ sermon_id: id, version: positive, commit_id: id, ...pointers,
  storage_format_version: z.literal(1), contract_version: z.literal(1) });
const commitSchema = z.strictObject({ sermon_id: id, version: positive, commit_id: id, ...pointers,
  attempt_id: id, previous_version: positive.nullable(), previous_commit_id: id.nullable(),
  state: z.literal("sealed"), required_seal_state: z.literal("sealed"),
  command: z.enum(["import", "revisions", "confirmations", "correctionProposals", "correctionDecisions", "intentEvents", "summaryEvents", "candidateEvents"]),
  sources_count: count, revisions_count: count, confirmations_count: count,
  correctionProposals_count: count, correctionDecisions_count: count, intentEvents_count: count,
  summaryEvents_count: count, candidateEvents_count: count,
  record_count: positive, reference_count: count, manifest_count: positive, chunk_count: positive, byte_length: positive });
const recordSchema = z.strictObject({ sermon_id: id, record_id: id, stream: z.enum(historyStreams),
  stream_position: positive, commit_version: positive, commit_slot: z.union([z.literal(0), z.literal(1)]),
  source_revision: positive.nullable(), difficulty: z.enum(["child", "adult"]).nullable(), verified: z.literal(1) });
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const manifestSchema = z.strictObject({ sermon_id: id, record_id: id, codec: z.literal("record-json-utf8-v1"),
  chunk_bytes: z.literal(65536), chunk_count: positive, byte_length: positive, payload_sha256: hash, verified: z.literal(1) });
const chunkSchema = z.strictObject({ sermon_id: id, record_id: id, chunk_index: count,
  byte_length: positive.max(65536), chunk_sha256: hash,
  // D1 all() returns BLOBs as byte arrays. Do not coerce strings or wrapped values.
  // Keep the strict row schema; validate/copy every byte once instead of running
  // a Zod integer schema and then copying the entire number array a second time.
  body: z.unknown().transform((value, context) => {
    const bytes = copyHistoryByteArray(value);
    if (bytes !== null) return bytes;
    context.addIssue({ code: "custom", message: "Invalid stored bytes" });
    return z.NEVER;
  }), verified: z.literal(1) });
const referenceSchema = z.strictObject({ sermon_id: id, owner_record_id: id, reference_position: positive,
  relation: z.string().min(1).max(128), target_record_id: id, target_stream: z.enum(historyStreams),
  target_member_id: id.nullable(), payload_path: z.string().min(1).max(512), verified: z.literal(1) });

type FailureCode = "HISTORY_READ_INVALID" | "HISTORY_READ_CORRUPT" | "HISTORY_READ_CHANGED" | "HISTORY_READ_UNAVAILABLE";
export class SermonHistoryReadError extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}
function fail(code: FailureCode = "HISTORY_READ_CORRUPT"): never { throw new SermonHistoryReadError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail();
  return parsed.data;
}
function freeze(value: unknown): void {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}
const tables = ["commits", "records", "references", "payloads", "chunks"] as const;

/** Read-only private adapter. Pass the raw D1 binding, never a session/replica wrapper.
 * Its prepare() uses workerd's always-primary session; all reads below are awaited
 * serially. No Sessions/read-replication configuration or runtime route is added.
 * Local resource preflight bounds accumulation; this is not Free runtime eligibility.
 */
function readerForOperation(database: D1Database, validateDomain: boolean): {
  read(sermonId: string): Promise<PrivateTranscriptState | null>;
} {
  let queryCount = 0;
  async function rows(sql: string, values: unknown[]): Promise<unknown[]> {
    withinHistoryLimit(++queryCount, limits.readQueries);
    try {
      const result = await database.prepare(sql).bind(...values).all();
      if (!result.success || !Array.isArray(result.results)) return fail("HISTORY_READ_UNAVAILABLE");
      return result.results;
    } catch { return fail("HISTORY_READ_UNAVAILABLE"); }
  }
  async function head(sermonId: string) {
    const result = await rows("SELECT * FROM sermon_history_heads WHERE sermon_id=?", [sermonId]);
    if (result.length > 1) return fail();
    const value = result.length ? parse(headSchema, result[0]) : null;
    if (value && value.sermon_id !== sermonId) return fail();
    return value;
  }
  // This probe deliberately does not INNER JOIN away orphan rows or assembling commits.
  // It runs against the current DB head; newer valid appends are caught by H1.
  async function integrity(sermonId: string) {
    const result = await rows(`SELECT
      EXISTS(SELECT 1 FROM sermons WHERE id=?) AS sermon_exists,
      (${tables.map((table) => `EXISTS(SELECT 1 FROM sermon_history_${table} WHERE sermon_id=?)`).join(" OR ")}) AS has_history,
      (EXISTS(SELECT 1 FROM sermon_history_commits c LEFT JOIN sermon_history_heads h ON h.sermon_id=c.sermon_id
        WHERE c.sermon_id=? AND (c.state<>'sealed' OR h.sermon_id IS NULL OR c.version>h.version))
      OR EXISTS(SELECT 1 FROM sermon_history_records r LEFT JOIN sermon_history_commits c
        ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE r.sermon_id=? AND c.version IS NULL)
      OR EXISTS(SELECT 1 FROM sermon_history_payloads p LEFT JOIN sermon_history_records r
        ON r.sermon_id=p.sermon_id AND r.record_id=p.record_id WHERE p.sermon_id=? AND r.record_id IS NULL)
      OR EXISTS(SELECT 1 FROM sermon_history_chunks c LEFT JOIN sermon_history_payloads p
        ON p.sermon_id=c.sermon_id AND p.record_id=c.record_id WHERE c.sermon_id=? AND p.record_id IS NULL)
      OR EXISTS(SELECT 1 FROM sermon_history_references f LEFT JOIN sermon_history_records o
        ON o.sermon_id=f.sermon_id AND o.record_id=f.owner_record_id LEFT JOIN sermon_history_records t
        ON t.sermon_id=f.sermon_id AND t.record_id=f.target_record_id
        WHERE f.sermon_id=? AND (o.record_id IS NULL OR t.record_id IS NULL))) AS invalid`,
    Array.from({ length: 11 }, () => sermonId));
    if (result.length !== 1) return fail();
    return parse(z.strictObject({ sermon_exists: z.union([z.literal(0), z.literal(1)]),
      has_history: z.union([z.literal(0), z.literal(1)]), invalid: z.union([z.literal(0), z.literal(1)]) }), result[0]);
  }
  async function* pages<T>(sql: string, values: unknown[], schema: z.ZodType<T>, key: (row: T) => number,
    start: number, pageSize: number) {
    let cursor = start;
    for (;;) {
      const page = await rows(sql, [...values, cursor, pageSize]);
      if (page.length > pageSize) return fail();
      for (const raw of page) {
        const row = parse(schema, raw), next = key(row);
        if (next <= cursor) return fail();
        cursor = next;
        yield row;
      }
      // A short page isn't proof of completeness; counts/chain/codec are checked later.
      if (page.length < pageSize) return;
    }
  }
  return {
    async read(sermonId) {
      if (!id.safeParse(sermonId).success) return fail("HISTORY_READ_INVALID");
      try {
        const h0 = await head(sermonId);
        if (h0) {
          withinHistoryLimit(h0.version, limits.commits);
          // Small immutable commit summaries before fetching any payload/chunk.
          const totals = await rows(`SELECT SUM(record_count) AS records, SUM(byte_length) AS bytes,
            SUM(chunk_count) AS chunks, SUM(reference_count) AS refs
            FROM sermon_history_commits WHERE sermon_id=? AND version<=?`, [sermonId, h0.version]);
          if (totals.length !== 1) return fail();
          const total = parse(z.strictObject({ records: positive, bytes: positive, chunks: positive, refs: count }), totals[0]);
          withinHistoryLimit(total.records, limits.records); withinHistoryLimit(total.bytes, limits.payloadBytes);
          withinHistoryLimit(total.chunks, limits.chunks); withinHistoryLimit(total.refs, limits.references);
        }
        const probe = await integrity(sermonId);
        if (!probe.sermon_exists || probe.invalid) return fail();
        if (!h0) {
          if (probe.has_history) return fail();
          if (await head(sermonId) !== null) return fail("HISTORY_READ_CHANGED");
          return null;
        }
        const records: HistoryRecord[] = [], references: HistoryReference[] = [];
        const counts = Object.fromEntries(historyStreams.map((s) => [s, 0])) as Record<HistoryStream, number>;
        const commitIds = new Set<string>(), attempts = new Set<string>();
        let actualBytes = 0, actualChunks = 0;
        let previous: z.infer<typeof commitSchema> | null = null;
        let source: string | null = null, revision: string | null = null, confirmation: string | null = null;
        for await (const c of pages("SELECT * FROM sermon_history_commits WHERE sermon_id=? AND version<=? AND version>? ORDER BY version LIMIT ?",
          [sermonId, h0.version], commitSchema, (r) => r.version, 0, 32)) {
          if (c.sermon_id !== sermonId || c.version > h0.version || c.version !== (previous?.version ?? 0) + 1 ||
            c.previous_version !== (previous?.version ?? null) || c.previous_commit_id !== (previous?.commit_id ?? null) ||
            commitIds.has(c.commit_id) || attempts.has(c.attempt_id)) return fail();
          commitIds.add(c.commit_id); attempts.add(c.attempt_id);
          const delta = (await rows("SELECT * FROM sermon_history_records WHERE sermon_id=? AND commit_version=? ORDER BY commit_slot LIMIT 3",
            [sermonId, c.version])).map((r) => parse(recordSchema, r));
          const streams = c.command === "import" ? ["sources", "revisions"] : [c.command];
          if (delta.length !== streams.length || c.record_count !== delta.length || c.manifest_count !== delta.length) return fail();
          let bytes = 0, chunks = 0, refs = 0;
          for (const [slot, row] of delta.entries()) {
            if (row.sermon_id !== sermonId || row.commit_version !== c.version || row.commit_slot !== slot ||
              row.stream !== streams[slot] || row.stream_position !== ++counts[row.stream]) return fail();
            const manifests = await rows("SELECT * FROM sermon_history_payloads WHERE sermon_id=? AND record_id=?", [sermonId, row.record_id]);
            if (manifests.length !== 1) return fail();
            const m = parse(manifestSchema, manifests[0]);
            if (m.sermon_id !== sermonId || m.record_id !== row.record_id) return fail();
            actualBytes += m.byte_length;
            withinHistoryLimit(actualBytes, limits.payloadBytes);
            withinHistoryLimit(m.chunk_count, limits.chunks);
            const bodies = [];
            for await (const chunk of pages("SELECT * FROM sermon_history_chunks WHERE sermon_id=? AND record_id=? AND chunk_index>? ORDER BY chunk_index LIMIT ?",
              [sermonId, row.record_id], chunkSchema, (r) => r.chunk_index, -1, 4)) {
              if (chunk.sermon_id !== sermonId || chunk.record_id !== row.record_id) return fail();
              withinHistoryLimit(++actualChunks, limits.chunks);
              if (bodies.length >= m.chunk_count) return fail();
              bodies.push({ chunkIndex: chunk.chunk_index, byteLength: chunk.byte_length,
                chunkSha256: chunk.chunk_sha256, body: chunk.body });
            }
            const record = await decodeHistoryRecord({ storageFormatVersion: h0.storage_format_version,
              sermonId, recordId: row.record_id, stream: row.stream, streamPosition: row.stream_position,
              commitVersion: row.commit_version, commitSlot: row.commit_slot, sourceRevision: row.source_revision, difficulty: row.difficulty },
            { manifest: { codec: m.codec, chunkBytes: m.chunk_bytes, chunkCount: m.chunk_count,
              byteLength: m.byte_length, payloadSha256: m.payload_sha256 }, chunks: bodies });
            withinHistoryLimit(records.length + 1, limits.records);
            records.push(record); bytes += m.byte_length; chunks += bodies.length;
            for await (const ref of pages("SELECT * FROM sermon_history_references WHERE sermon_id=? AND owner_record_id=? AND reference_position>? ORDER BY reference_position LIMIT ?",
              [sermonId, row.record_id], referenceSchema, (r) => r.reference_position, 0, 32)) {
              if (ref.sermon_id !== sermonId || ref.owner_record_id !== row.record_id) return fail();
              withinHistoryLimit(references.length + 1, limits.references);
              references.push({ sermonId, ownerRecordId: ref.owner_record_id, referencePosition: ref.reference_position,
                relation: ref.relation, targetRecordId: ref.target_record_id, targetStream: ref.target_stream,
                targetMemberId: ref.target_member_id, payloadPath: ref.payload_path });
              refs++;
            }
            if (row.stream === "sources") source = row.record_id;
            if (row.stream === "revisions") { revision = row.record_id; confirmation = null; }
            if (row.stream === "confirmations") confirmation = row.record_id;
          }
          if (bytes !== c.byte_length || chunks !== c.chunk_count || refs !== c.reference_count ||
            c.current_source_id !== source || c.current_revision_id !== revision || c.current_confirmation_id !== confirmation ||
            historyStreams.some((s) => c[`${s}_count`] !== counts[s]) ||
            historyStreams.filter((s) => s !== "sources").reduce((sum, s) => sum + counts[s], 0) !== c.version) return fail();
          previous = c;
        }
        if (!previous || previous.version !== h0.version || previous.commit_id !== h0.commit_id ||
          source !== h0.current_source_id || revision !== h0.current_revision_id || confirmation !== h0.current_confirmation_id) return fail();
        const scope: HistoryScope = { sermonId, version: h0.version, counts };
        verifyHistoryReferences(records, scope, references);
        const raw = { contractVersion: h0.contract_version, sermonId, version: h0.version,
          currentSourceId: source, currentRevisionId: revision, currentConfirmationId: confirmation,
          ...Object.fromEntries(historyStreams.map((s) => [s, records.filter((r) => r.envelope.stream === s).map((r) => r.payload)])) };
        preflightHistoryState(raw);
        const strict = privateTranscriptStateSchema.parse(raw);
        if (!sameHistoryValue(raw, strict)) return fail();
        // The storage-only variant is used by the P5-26 operation-scoped spike:
        // its single trusted service call performs the full domain replay once.
        // Public/current reader behavior remains the validating branch.
        const state = validateDomain ? await validateTranscriptState(strict, sermonId) : strict;
        freeze(state);
        const h1 = await head(sermonId);
        if (!sameHistoryValue(h0, h1)) return fail("HISTORY_READ_CHANGED");
        return state;
      } catch (error) {
        if (error instanceof SermonHistoryReadError || error instanceof HistoryResourceLimitError) throw error;
        return fail();
      }
    },
  };
}

/** Each read owns its counters, including concurrent reads of the same store. */
export function createSermonHistoryReader(database: D1Database) {
  return { read: (sermonId: string) => readerForOperation(database, true).read(sermonId) };
}

/** P5-26 local spike seam. It still verifies the complete physical history,
 * codec, checksums and references, but deliberately leaves the one full domain
 * replay to the operation-scoped service. It is not wired to runtime code. */
export function createSermonHistoryStorageReader(database: D1Database) {
  return { read: (sermonId: string) => readerForOperation(database, false).read(sermonId) };
}
