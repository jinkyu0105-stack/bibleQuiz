import { prepareInputSchema } from "../services/prepare-input-schema";
import { readTogether, cachedGenerationRead, rememberGenerationRead, generationVerifiedRead } from "./generation-read-session";
import { z } from "zod";
import { snapshotDisplayStatement, hasSnapshotDisplayStorage } from "./generation-display-store";
import { sameTranscript } from "../services/sermon-intent";
import { createSermonInputStore } from "./sermon-input-store";
import { transcriptSourcePayloadSchema } from "../services/transcript-input-contract";
import { verifySource } from "../services/transcript-content";

import { finalCheckTicketSchema, type FinalCheckTicket } from "../services/final-check-contract";
import { sha256Bytes } from "../storage/sha256";
import { decodeD1HexBlob } from "../storage/d1-hex-blob";
import { domainPreparedSchema, type DomainPrepared } from "../services/generation-domain-contract";
import { domainLineage, domainStorageJson } from "./generation-domain-storage";
import { isReadIntentResult } from "../services/generation-domain-reader";

const id = z.string().min(1).max(128);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const timestamp = z.iso.datetime();
const operation = z.enum([
  "intent_edit",
  "intent_select",
  "intent_confirm",
  "summary_edit",
  "summary_select",
  "summary_restore",
  "summary_review",
  "candidate_edit",
  "candidate_set_status",
  "candidate_select",
  "candidate_restore",
  "candidate_review",
]);

export type HumanContentOperation = z.infer<typeof operation>;

const inputTupleSchema = z.strictObject({
  version: z.number().int().positive(),
  sourceId: id,
  documentId: id,
  documentSha256: digest,
  confirmationId: id.nullable(),
});

const currentRefsSchema = z.strictObject({
  eventCount: z.number().int().positive(),
  lastEventId: id,
  selectedAnalysisEventId: id.nullable(),
  intentCritiqueEventId: id.nullable(),
  intentConfirmationEventId: id.nullable(),
  summarySnapshotEventId: id.nullable(),
  summaryReviewEventId: id.nullable(),
  childPoolEventId: id.nullable(),
  childReviewEventId: id.nullable(),
  adultPoolEventId: id.nullable(),
  adultReviewEventId: id.nullable(),
});

export type HumanContentCurrentRefs = z.infer<typeof currentRefsSchema>;

const humanPayloadSchema = z.strictObject({
  contractVersion: z.literal(1),
  operation,
  command: z.unknown(),
  materializedSnapshot: z.unknown().nullable(),
});

const appendCommandSchema = z.strictObject({
  sermonId: id,
  eventId: id,
  commandKey: id,
  actorId: digest,
  createdAt: timestamp,
  expectedInput: inputTupleSchema,
  expectedCurrent: currentRefsSchema,
  operation,
  difficulty: z.enum(["child", "adult"]).nullable(),
  baseSnapshotEventId: id.nullable(),
  targetSnapshotEventId: id.nullable(),
  restoreSourceEventId: id.nullable(),
  critiqueEventId: id.nullable(),
  intentConfirmationEventId: id.nullable(),
  expectedCurrentReviewEventId: id.nullable(),
  payload: humanPayloadSchema,
});

export type AppendHumanContentCommand = z.input<typeof appendCommandSchema>;

const ticketInputsSchema = z.strictObject({
  intentConfirmationEventId: id,
  summarySnapshotEventId: id,
  summaryReviewEventId: id,
  childPoolEventId: id,
  childReviewEventId: id,
  adultPoolEventId: id,
  adultReviewEventId: id,
  childPlacementTicketFingerprint: digest,
  adultPlacementTicketFingerprint: digest,
  childSelectionIndex: z.number().int().min(0).max(2),
  adultSelectionIndex: z.number().int().min(0).max(2),
});

const commitTicketSchema = z.strictObject({
  ticketId: id,
  quizSetId: id,
  sermonId: id,
  createdAt: timestamp,
  expectedInput: inputTupleSchema,
  expectedCurrent: currentRefsSchema,
  expectedMetadataRevision: z.number().int().positive(),
  expectedTicketFingerprint: digest,
  inputs: ticketInputsSchema,
  payload: finalCheckTicketSchema,
});

export type CommitFinalCheckTicketCommand = z.input<typeof commitTicketSchema>;

export type HumanContentProbe = "absent" | "exact" | "mismatch" | "unavailable";
export type FinalTicketProbe = "absent" | "current" | "committed_but_stale" | "mismatch" | "unavailable";

type FailureCode =
  | "HUMAN_CONTENT_INVALID"
  | "HUMAN_CONTENT_NOT_READY"
  | "HUMAN_CONTENT_STATE_CONFLICT"
  | "HUMAN_CONTENT_WRITE_UNCERTAIN"
  | "HUMAN_CONTENT_READ_CHANGED"
  | "HUMAN_CONTENT_STORAGE_CORRUPT"
  | "HUMAN_CONTENT_STORAGE_UNAVAILABLE"
  | "FINAL_TICKET_INVALID"
  | "FINAL_TICKET_STATE_CONFLICT"
  | "FINAL_TICKET_WRITE_UNCERTAIN";

export class HumanContentRuntimeStoreError extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}

function fail(code: FailureCode): never {
  throw new HumanContentRuntimeStoreError(code);
}

function resultChanges(result: unknown): number | null {
  if (!result || typeof result !== "object" || Reflect.get(result, "success") !== true) return null;
  const meta = Reflect.get(result, "meta");
  const changes = meta && typeof meta === "object" ? Reflect.get(meta, "changes") : null;
  return typeof changes === "number" && Number.isSafeInteger(changes) && changes >= 0 ? changes : null;
}

function exactBatch(results: unknown, expected: readonly number[]): boolean {
  return Array.isArray(results) && results.length === expected.length &&
    results.every((result, index) => resultChanges(result) === expected[index]);
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => same(value, right[index]));
  }
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every((key) => Object.hasOwn(right, key) &&
    same(Reflect.get(left, key), Reflect.get(right, key)));
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fail("HUMAN_CONTENT_INVALID");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") return fail("HUMAN_CONTENT_INVALID");
  if (seen.has(value)) return fail("HUMAN_CONTENT_INVALID");
  seen.add(value);
  let encoded: string;
  if (Array.isArray(value)) {
    encoded = `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail("HUMAN_CONTENT_INVALID");
    encoded = `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key), seen)}`).join(",")}}`;
  }
  seen.delete(value);
  return encoded;
}

type PreparedPayload = {
  bytes: Uint8Array;
  chunks: Uint8Array[];
  chunkHashes: string[];
  payloadSha256: string;
};

async function preparePayload(value: unknown, domain = false): Promise<PreparedPayload> {
  const bytes = new TextEncoder().encode(domain ? domainStorageJson(value) : canonicalJson(value));
  if (bytes.byteLength < 1 || bytes.byteLength > 67_108_864) return fail("HUMAN_CONTENT_INVALID");
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 65_536) {
    chunks.push(bytes.slice(offset, Math.min(offset + 65_536, bytes.byteLength)));
  }
  if (chunks.length < 1 || chunks.length > 4096) return fail("HUMAN_CONTENT_INVALID");
  return {
    bytes,
    chunks,
    chunkHashes: await readTogether(chunks.map(sha256Bytes)),
    payloadSha256: await sha256Bytes(bytes),
  };
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function bytesFromD1(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return Uint8Array.from(value as number[]);
  }
  return null;
}

async function allRows(database: D1Database, sql: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  try {
    const result = await database.prepare(sql).bind(...values).all();
    if (!result.success || !Array.isArray(result.results)) return fail("HUMAN_CONTENT_STORAGE_UNAVAILABLE");
    return result.results as Record<string, unknown>[];
  } catch (error) {
    if (error instanceof HumanContentRuntimeStoreError) throw error;
    return fail("HUMAN_CONTENT_STORAGE_UNAVAILABLE");
  }
}

async function oneRow(database: D1Database, sql: string, values: unknown[]): Promise<Record<string, unknown> | null> {
  const result = await allRows(database, sql, values);
  if (result.length > 1) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
  return result[0] ?? null;
}

type StoredCurrent = HumanContentCurrentRefs & { input: z.infer<typeof inputTupleSchema> };

const currentRowSchema = prepareInputSchema(z.strictObject({
    event_count: z.number().int().positive(),
    last_event_id: id,
    selected_analysis_event_id: id.nullable(),
    intent_critique_event_id: id.nullable(),
    intent_confirmation_event_id: id.nullable(),
    summary_snapshot_event_id: id.nullable(),
    summary_review_event_id: id.nullable(),
    child_pool_event_id: id.nullable(),
    child_review_event_id: id.nullable(),
    adult_pool_event_id: id.nullable(),
    adult_review_event_id: id.nullable(),
    input_version: z.number().int().positive(),
    source_id: id,
    document_id: id,
    document_sha256: digest,
    confirmation_id: id.nullable(),
  }));

function currentFromRow(row: Record<string, unknown>): StoredCurrent {
  const parsed = currentRowSchema.safeParse(row);
  if (!parsed.success) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
  const value = parsed.data;
  return {
    eventCount: value.event_count,
    lastEventId: value.last_event_id,
    selectedAnalysisEventId: value.selected_analysis_event_id,
    intentCritiqueEventId: value.intent_critique_event_id,
    intentConfirmationEventId: value.intent_confirmation_event_id,
    summarySnapshotEventId: value.summary_snapshot_event_id,
    summaryReviewEventId: value.summary_review_event_id,
    childPoolEventId: value.child_pool_event_id,
    childReviewEventId: value.child_review_event_id,
    adultPoolEventId: value.adult_pool_event_id,
    adultReviewEventId: value.adult_review_event_id,
    input: {
      version: value.input_version,
      sourceId: value.source_id,
      documentId: value.document_id,
      documentSha256: value.document_sha256,
      confirmationId: value.confirmation_id,
    },
  };
}

const currentSql = `SELECT c.event_count,c.last_event_id,c.selected_analysis_event_id,c.intent_critique_event_id,
  c.intent_confirmation_event_id,c.summary_snapshot_event_id,c.summary_review_event_id,c.child_pool_event_id,
  c.child_review_event_id,c.adult_pool_event_id,c.adult_review_event_id,
  x.version AS input_version,d.source_id,d.document_id,d.document_sha256,d.confirmation_id
  FROM sermon_content_heads h JOIN sermon_content_current c ON c.sermon_id=h.sermon_id
    AND c.event_count=h.event_count AND c.last_event_id=h.last_event_id
  JOIN sermon_input_heads x ON x.sermon_id=h.sermon_id
  JOIN sermon_input_events d ON d.sermon_id=x.sermon_id AND d.version=x.version AND d.state='sealed'
  WHERE h.sermon_id=?`;

export async function readStoredCurrent(database: D1Database, sermonId: string): Promise<StoredCurrent | null> {
  const row = await oneRow(database, currentSql, [sermonId]);
  return row ? currentFromRow(row) : null;
}

function currentRefs(value: StoredCurrent): HumanContentCurrentRefs {
  return {
    eventCount: value.eventCount,
    lastEventId: value.lastEventId,
    selectedAnalysisEventId: value.selectedAnalysisEventId,
    intentCritiqueEventId: value.intentCritiqueEventId,
    intentConfirmationEventId: value.intentConfirmationEventId,
    summarySnapshotEventId: value.summarySnapshotEventId,
    summaryReviewEventId: value.summaryReviewEventId,
    childPoolEventId: value.childPoolEventId,
    childReviewEventId: value.childReviewEventId,
    adultPoolEventId: value.adultPoolEventId,
    adultReviewEventId: value.adultReviewEventId,
  };
}

function referencedEventIds(value: StoredCurrent): string[] {
  return [...new Set([
    value.lastEventId,
    value.selectedAnalysisEventId,
    value.intentCritiqueEventId,
    value.intentConfirmationEventId,
    value.summarySnapshotEventId,
    value.summaryReviewEventId,
    value.childPoolEventId,
    value.childReviewEventId,
    value.adultPoolEventId,
    value.adultReviewEventId,
  ].filter((item): item is string => item !== null))];
}

type VerifiedEvent = {
  eventId: string;
  kind: string;
  origin: "ai" | "human";
  difficulty: "adult" | "child" | null;
  humanOperation: HumanContentOperation | null;
  payload: unknown;
};

const verifiedSizes = new WeakMap<VerifiedEvent, { bytes: number; chunks: number }>();
const eventKey = (sermonId: string, eventId: string) => `content:${sermonId}:${eventId}`;
export async function readVerifiedEvents(database: D1Database, sermonId: string, eventIds: string[], account?: (bytes: number) => void): Promise<VerifiedEvent[]> {
  if (eventIds.length < 1 || eventIds.length > 10 || new Set(eventIds).size !== eventIds.length) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
  const hits = eventIds.map(id => cachedGenerationRead<VerifiedEvent>(database, eventKey(sermonId, id)));
  const missing = eventIds.filter((_id, index) => !hits[index]);
  // Publish pending immutable reads before yielding. Independent current-state
  // and lifecycle readers then share one verified body, including partial hits.
  const fresh = missing.length ? readVerifiedEventsFresh(database, sermonId, missing, account) : null;
  const values = await readTogether(eventIds.map((id, index) => hits[index]
    ? hits[index]!.then(value => { account?.(verifiedSizes.get(value)!.bytes); return value; })
    : generationVerifiedRead(database, eventKey(sermonId, id), async () => {
      const value = (await fresh!).find(v => v.eventId === id);
      if (!value) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
      return value;
    })));
  if (values.reduce((n, v) => n + verifiedSizes.get(v)!.bytes, 0) > 67_108_864 ||
    values.reduce((n, v) => n + verifiedSizes.get(v)!.chunks, 0) > 4096) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
  return values;
}
async function readVerifiedEventsFresh(database: D1Database, sermonId: string, eventIds: string[], account?: (bytes: number) => void): Promise<VerifiedEvent[]> {
  if (eventIds.length < 1 || eventIds.length > 10) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
  const placeholders = eventIds.map(() => "?").join(",");
  const events = await allRows(database, `SELECT e.event_id,e.kind,e.origin,e.difficulty,e.state,e.payload_sha256,
    e.payload_byte_length,e.payload_chunk_count,p.codec,p.chunk_bytes,p.chunk_count,p.byte_length,
    p.payload_sha256 AS manifest_sha256,p.verified,h.operation AS human_operation
    FROM sermon_content_events e JOIN sermon_content_payloads p ON p.sermon_id=e.sermon_id AND p.event_id=e.event_id
    LEFT JOIN sermon_content_human_events h ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id
    WHERE e.sermon_id=? AND e.event_id IN (${placeholders})`, [sermonId, ...eventIds]);
  if (events.length !== eventIds.length) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
  // Check metadata before reading bodies, including callers reading one lineage
  // event at a time. Bound the SQL result, not only the decoded array.
  let announcedBytes = 0, announcedChunks = 0;
  for (const event of events) {
    if (typeof event.payload_byte_length !== "number" || !Number.isSafeInteger(event.payload_byte_length) || event.payload_byte_length < 1 ||
      typeof event.payload_chunk_count !== "number" || !Number.isSafeInteger(event.payload_chunk_count) || event.payload_chunk_count < 1) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    announcedBytes += event.payload_byte_length; announcedChunks += event.payload_chunk_count;
  }
  if (announcedBytes > 67_108_864 || announcedChunks > 4096) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
  account?.(announcedBytes);
  const chunks = await allRows(database, `SELECT event_id,position,byte_length,chunk_sha256,CASE WHEN typeof(body)='blob' THEN hex(substr(body,1,65537)) END AS body_hex,verified
    FROM sermon_content_chunks WHERE sermon_id=? AND event_id IN (${placeholders}) ORDER BY event_id,position LIMIT 4097`,
  [sermonId, ...eventIds]);
  if (chunks.length > 4096) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const chunk of chunks) {
    if (typeof chunk.event_id !== "string") return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    const group = grouped.get(chunk.event_id) ?? [];
    group.push(chunk);
    grouped.set(chunk.event_id, group);
  }
  let totalBytes = 0;
  const output: VerifiedEvent[] = [];
  for (const eventId of eventIds) {
    const row = events.find((candidate) => candidate.event_id === eventId);
    if (!row || row.state !== "sealed" || row.codec !== "content-event-json-utf8-v1" || row.chunk_bytes !== 65536 ||
      row.verified !== 1 || row.payload_sha256 !== row.manifest_sha256 ||
      row.payload_byte_length !== row.byte_length || row.payload_chunk_count !== row.chunk_count ||
      typeof row.payload_sha256 !== "string" || typeof row.payload_byte_length !== "number" ||
      typeof row.payload_chunk_count !== "number" || row.payload_chunk_count !== Math.ceil(row.payload_byte_length / 65536) ||
      !["ai", "human"].includes(String(row.origin))) {
      return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    }
    totalBytes += row.payload_byte_length;
    if (totalBytes > 67_108_864) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    const eventChunks = grouped.get(eventId) ?? [];
    if (eventChunks.length !== row.payload_chunk_count) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    const bodies: Uint8Array[] = [];
    for (const [position, chunk] of eventChunks.entries()) {
      const body = decodeD1HexBlob(chunk.body_hex, 65536);
      if (!body || body.byteLength !== Math.min(65536, row.payload_byte_length - position * 65536) ||
        chunk.position !== position || chunk.byte_length !== body.byteLength || chunk.verified !== 1 ||
        await sha256Bytes(body) !== chunk.chunk_sha256) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
      bodies.push(body);
    }
    const bytes = new Uint8Array(bodies.reduce((sum, body) => sum + body.byteLength, 0));
    let offset = 0;
    for (const body of bodies) { bytes.set(body, offset); offset += body.byteLength; }
    if (bytes.byteLength !== row.payload_byte_length || await sha256Bytes(bytes) !== row.payload_sha256) {
      return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown; }
    catch { return fail("HUMAN_CONTENT_STORAGE_CORRUPT"); }
    if (row.origin === "human") {
      const parsed = humanPayloadSchema.safeParse(payload);
      if (!parsed.success || parsed.data.operation !== row.human_operation) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
      payload = parsed.data;
    } else if (row.human_operation !== null) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    if (typeof row.kind !== "string" || (row.difficulty !== null && row.difficulty !== "child" && row.difficulty !== "adult")) {
      return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    }
    const verified = freeze({ eventId, kind: row.kind, origin: row.origin as "ai" | "human",
      difficulty: row.difficulty as "adult" | "child" | null,
      humanOperation: row.human_operation as HumanContentOperation | null, payload: freeze(payload) });
    verifiedSizes.set(verified, { bytes: row.payload_byte_length, chunks: row.payload_chunk_count });
    output.push(verified);
  }
  return output;
}

const contentPresenceSchema = prepareInputSchema(z.strictObject({ sermon_exists: z.union([z.literal(0), z.literal(1)]),
    has_head: z.union([z.literal(0), z.literal(1)]), has_current: z.union([z.literal(0), z.literal(1)]),
    has_events: z.union([z.literal(0), z.literal(1)]) }));

async function contentPresence(database: D1Database, sermonId: string) {
  const row = await oneRow(database, `SELECT
    EXISTS(SELECT 1 FROM sermons WHERE id=?) AS sermon_exists,
    EXISTS(SELECT 1 FROM sermon_content_heads WHERE sermon_id=?) AS has_head,
    EXISTS(SELECT 1 FROM sermon_content_current WHERE sermon_id=?) AS has_current,
    EXISTS(SELECT 1 FROM sermon_content_events WHERE sermon_id=?) AS has_events`,
  [sermonId, sermonId, sermonId, sermonId]);
  const parsed = contentPresenceSchema.safeParse(row);
  if (!parsed.success) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
  return parsed.data;
}

function validateCurrentEvents(current: StoredCurrent, events: VerifiedEvent[]): void {
  const byId = new Map(events.map((event) => [event.eventId, event]));
  const expectEvent = (eventId: string | null, expected: Partial<VerifiedEvent>) => {
    if (eventId === null) return;
    const event = byId.get(eventId);
    if (!event || Object.entries(expected).some(([key, value]) => Reflect.get(event, key) !== value)) {
      return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    }
  };
  const selected = events.find(event => event.eventId === current.selectedAnalysisEventId);
  if (selected && !["intent_analysis", "intent_critique"].includes(selected.kind)) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
  expectEvent(current.selectedAnalysisEventId, { difficulty: null });
  expectEvent(current.intentCritiqueEventId, { kind: "intent_critique", difficulty: null });
  expectEvent(current.intentConfirmationEventId, {
    kind: "intent_confirmation", difficulty: null, origin: "human", humanOperation: "intent_confirm",
  });
  expectEvent(current.summarySnapshotEventId, { kind: "summary", difficulty: null });
  expectEvent(current.summaryReviewEventId, {
    kind: "summary", difficulty: null, origin: "human", humanOperation: "summary_review",
  });
  expectEvent(current.childPoolEventId, { kind: "candidate", difficulty: "child" });
  expectEvent(current.childReviewEventId, {
    kind: "candidate", difficulty: "child", origin: "human", humanOperation: "candidate_review",
  });
  expectEvent(current.adultPoolEventId, { kind: "candidate", difficulty: "adult" });
  expectEvent(current.adultReviewEventId, {
    kind: "candidate", difficulty: "adult", origin: "human", humanOperation: "candidate_review",
  });
}

function expectedRefsMatch(actual: StoredCurrent, command: z.output<typeof appendCommandSchema>): boolean {
  return same(actual.input, command.expectedInput) && same(currentRefs(actual), command.expectedCurrent);
}

function requiresMaterializedSnapshot(value: HumanContentOperation): boolean {
  return ["intent_edit", "summary_edit", "summary_restore", "candidate_edit", "candidate_set_status", "candidate_restore"]
    .includes(value);
}

function validateHumanCommand(command: z.output<typeof appendCommandSchema>): void {
  if (command.payload.operation !== command.operation ||
    (requiresMaterializedSnapshot(command.operation) ? command.payload.materializedSnapshot === null
      : command.payload.materializedSnapshot !== null)) return fail("HUMAN_CONTENT_INVALID");
  const current = command.expectedCurrent;
  const summaryOperation = command.operation.startsWith("summary_");
  const candidateOperation = command.operation.startsWith("candidate_");
  if (candidateOperation !== (command.difficulty !== null) || (!candidateOperation && command.difficulty !== null)) {
    return fail("HUMAN_CONTENT_INVALID");
  }
  if (command.operation.startsWith("intent_") && command.expectedCurrentReviewEventId !== null) {
    return fail("HUMAN_CONTENT_INVALID");
  }
  if (summaryOperation && command.expectedCurrentReviewEventId !== current.summaryReviewEventId) {
    return fail("HUMAN_CONTENT_STATE_CONFLICT");
  }
  if (candidateOperation) {
    const review = command.difficulty === "child" ? current.childReviewEventId : current.adultReviewEventId;
    if (command.expectedCurrentReviewEventId !== review) return fail("HUMAN_CONTENT_STATE_CONFLICT");
  }
  if (command.operation === "intent_edit" && (command.baseSnapshotEventId !== current.selectedAnalysisEventId ||
    command.targetSnapshotEventId !== null || command.restoreSourceEventId !== null || command.critiqueEventId !== null ||
    command.intentConfirmationEventId !== null)) return fail("HUMAN_CONTENT_STATE_CONFLICT");
  if (command.operation === "intent_select" && (command.baseSnapshotEventId !== null || !command.targetSnapshotEventId ||
    command.restoreSourceEventId !== null || command.critiqueEventId !== null || command.intentConfirmationEventId !== null)) {
    return fail("HUMAN_CONTENT_STATE_CONFLICT");
  }
  if (command.operation === "intent_confirm" && (command.baseSnapshotEventId !== null ||
    command.targetSnapshotEventId !== current.selectedAnalysisEventId || command.restoreSourceEventId !== null ||
    command.critiqueEventId !== current.intentCritiqueEventId || command.intentConfirmationEventId !== null ||
    current.intentConfirmationEventId !== null || current.summaryReviewEventId !== null ||
    current.childReviewEventId !== null || current.adultReviewEventId !== null)) return fail("HUMAN_CONTENT_STATE_CONFLICT");
  if (summaryOperation || candidateOperation) {
    if (command.intentConfirmationEventId !== current.intentConfirmationEventId || !current.intentConfirmationEventId ||
      command.critiqueEventId !== null) return fail("HUMAN_CONTENT_STATE_CONFLICT");
    const snapshot = summaryOperation ? current.summarySnapshotEventId
      : command.difficulty === "child" ? current.childPoolEventId : current.adultPoolEventId;
    if (command.operation.endsWith("_edit") || command.operation === "candidate_set_status") {
      if (command.baseSnapshotEventId !== snapshot || command.targetSnapshotEventId !== null || command.restoreSourceEventId !== null) {
        return fail("HUMAN_CONTENT_STATE_CONFLICT");
      }
    } else if (command.operation.endsWith("_select") || command.operation.endsWith("_review")) {
      if (command.baseSnapshotEventId !== null || !command.targetSnapshotEventId || command.restoreSourceEventId !== null ||
        (command.operation.endsWith("_review") && command.targetSnapshotEventId !== snapshot)) {
        return fail("HUMAN_CONTENT_STATE_CONFLICT");
      }
    } else if (command.operation.endsWith("_restore")) {
      if (command.baseSnapshotEventId !== snapshot || command.targetSnapshotEventId !== null || !command.restoreSourceEventId) {
        return fail("HUMAN_CONTENT_STATE_CONFLICT");
      }
    }
  }
}

function transformCurrent(command: z.output<typeof appendCommandSchema>): HumanContentCurrentRefs {
  const next = { ...command.expectedCurrent, eventCount: command.expectedCurrent.eventCount + 1, lastEventId: command.eventId };
  switch (command.operation) {
    case "intent_edit":
      return { ...next, selectedAnalysisEventId: command.eventId, intentCritiqueEventId: null,
        intentConfirmationEventId: null, summaryReviewEventId: null, childReviewEventId: null, adultReviewEventId: null };
    case "intent_select":
      return { ...next, selectedAnalysisEventId: command.targetSnapshotEventId, intentCritiqueEventId: null,
        intentConfirmationEventId: null, summaryReviewEventId: null, childReviewEventId: null, adultReviewEventId: null };
    case "intent_confirm":
      return { ...next, intentCritiqueEventId: command.critiqueEventId, intentConfirmationEventId: command.eventId };
    case "summary_edit":
    case "summary_restore":
      return { ...next, summarySnapshotEventId: command.eventId, summaryReviewEventId: null };
    case "summary_select":
      return { ...next, summarySnapshotEventId: command.targetSnapshotEventId, summaryReviewEventId: null };
    case "summary_review":
      return { ...next, summaryReviewEventId: command.eventId };
    case "candidate_edit":
    case "candidate_set_status":
    case "candidate_restore":
      return command.difficulty === "child" ? { ...next, childPoolEventId: command.eventId, childReviewEventId: null }
        : { ...next, adultPoolEventId: command.eventId, adultReviewEventId: null };
    case "candidate_select":
      return command.difficulty === "child" ? { ...next, childPoolEventId: command.targetSnapshotEventId, childReviewEventId: null }
        : { ...next, adultPoolEventId: command.targetSnapshotEventId, adultReviewEventId: null };
    case "candidate_review":
      return command.difficulty === "child" ? { ...next, childReviewEventId: command.eventId }
        : { ...next, adultReviewEventId: command.eventId };
  }
}

function eventKind(command: z.output<typeof appendCommandSchema>): "candidate" | "intent_analysis" | "intent_confirmation" | "summary" {
  if (command.operation.startsWith("candidate_")) return "candidate";
  if (command.operation.startsWith("summary_")) return "summary";
  return command.operation === "intent_confirm" ? "intent_confirmation" : "intent_analysis";
}

function currentValues(value: HumanContentCurrentRefs): unknown[] {
  return [value.eventCount, value.lastEventId, value.selectedAnalysisEventId, value.intentCritiqueEventId,
    value.intentConfirmationEventId, value.summarySnapshotEventId, value.summaryReviewEventId,
    value.childPoolEventId, value.childReviewEventId, value.adultPoolEventId, value.adultReviewEventId,
    value.eventCount, value.lastEventId];
}

type PreparedHumanAppend = {
  command: z.output<typeof appendCommandSchema>;
  next: HumanContentCurrentRefs;
  payload: PreparedPayload;
  domain: DomainPrepared | null;
};

async function prepareHumanAppend(raw: AppendHumanContentCommand): Promise<PreparedHumanAppend> {
  const parsed = appendCommandSchema.safeParse(raw);
  if (!parsed.success) return fail("HUMAN_CONTENT_INVALID");
  validateHumanCommand(parsed.data);
  const candidate = parsed.data.payload.command;
  let domain: DomainPrepared | null = null;
  if (domainPreparedSchema.safeParse(candidate).success) {
    const p = candidate as DomainPrepared, c = parsed.data, input = p.expectedInput, before = p.before;
    if (p.operation.family === "correction" || !isReadIntentResult(p) || p.origin !== "human" || p.owner.sermonId !== c.sermonId || p.event.id !== c.eventId ||
      p.event.actorDigest !== c.actorId || p.event.createdAt !== c.createdAt || before.state !== "present" ||
      before.eventCount !== c.expectedCurrent.eventCount || before.lastEventId !== c.expectedCurrent.lastEventId ||
      input.version !== c.expectedInput.version || input.sourceId !== c.expectedInput.sourceId || input.documentId !== c.expectedInput.documentId ||
      input.documentSha256 !== c.expectedInput.documentSha256 || input.confirmationId !== c.expectedInput.confirmationId ||
      `${p.operation.family}_${p.operation.operation.kind}` !== c.operation ||
      domainStorageJson(p.materializedSnapshot) !== domainStorageJson(c.payload.materializedSnapshot)) return fail("HUMAN_CONTENT_INVALID");
    domain = p;
  }
  const next = transformCurrent(parsed.data);
  if (domain && domain.after.state === "present" && ["intent_select", "intent_edit"].includes(parsed.data.operation)) {
    next.intentCritiqueEventId = domain.after.intent?.critique?.id ?? null;
  }
  return { command: parsed.data, next, payload: await preparePayload(parsed.data.payload, domain !== null), domain };
}

function exactObject(row: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => row[key] === value);
}

async function verifyStoredPayload(
  database: D1Database,
  sermonId: string,
  eventId: string,
  expected: PreparedPayload,
): Promise<boolean> {
  const manifest = await oneRow(database, `SELECT codec,chunk_bytes,chunk_count,byte_length,payload_sha256,verified
    FROM sermon_content_payloads WHERE sermon_id=? AND event_id=?`, [sermonId, eventId]);
  if (!manifest || !exactObject(manifest, { codec: "content-event-json-utf8-v1", chunk_bytes: 65536,
    chunk_count: expected.chunks.length, byte_length: expected.bytes.byteLength,
    payload_sha256: expected.payloadSha256, verified: 1 })) return false;
  const chunks = await allRows(database, `SELECT position,byte_length,chunk_sha256,body,verified
    FROM sermon_content_chunks WHERE sermon_id=? AND event_id=? ORDER BY position`, [sermonId, eventId]);
  if (chunks.length !== expected.chunks.length) return false;
  for (const [index, row] of chunks.entries()) {
    const body = bytesFromD1(row.body);
    if (!body || row.position !== index || row.byte_length !== expected.chunks[index]!.byteLength ||
      row.chunk_sha256 !== expected.chunkHashes[index] || row.verified !== 1 ||
      !same([...body], [...expected.chunks[index]!])) return false;
  }
  return true;
}

function humanEventExpected(prepared: PreparedHumanAppend): Record<string, unknown> {
  const { command, payload } = prepared;
  return {
    sermon_id: command.sermonId,
    event_id: command.eventId,
    content_sequence: command.expectedCurrent.eventCount + 1,
    aggregate_version: command.expectedInput.version + command.expectedCurrent.eventCount + 1,
    origin: "human",
    kind: eventKind(command),
    difficulty: command.difficulty,
    input_version: command.expectedInput.version,
    source_id: command.expectedInput.sourceId,
    document_id: command.expectedInput.documentId,
    document_sha256: command.expectedInput.documentSha256,
    confirmation_id: command.expectedInput.confirmationId,
    analysis_event_id: command.operation === "intent_confirm" ? command.targetSnapshotEventId
      : eventKind(command) === "summary" || eventKind(command) === "candidate"
        ? command.expectedCurrent.selectedAnalysisEventId : null,
    intent_confirmation_event_id: eventKind(command) === "summary" || eventKind(command) === "candidate"
      ? command.expectedCurrent.intentConfirmationEventId : null,
    payload_sha256: payload.payloadSha256,
    payload_byte_length: payload.bytes.byteLength,
    payload_chunk_count: payload.chunks.length,
    state: "sealed",
    created_by_actor_id: command.actorId,
    created_at: command.createdAt,
  };
}

function humanDetailExpected(command: z.output<typeof appendCommandSchema>): Record<string, unknown> {
  return {
    sermon_id: command.sermonId,
    event_id: command.eventId,
    operation: command.operation,
    command_key: command.commandKey,
    base_snapshot_event_id: command.baseSnapshotEventId,
    target_snapshot_event_id: command.targetSnapshotEventId,
    restore_source_event_id: command.restoreSourceEventId,
    critique_event_id: command.critiqueEventId,
    intent_confirmation_event_id: command.intentConfirmationEventId,
    expected_current_review_event_id: command.expectedCurrentReviewEventId,
    created_by_actor_id: command.actorId,
    created_at: command.createdAt,
  };
}

function currentExpected(sermonId: string, value: HumanContentCurrentRefs): Record<string, unknown> {
  return {
    sermon_id: sermonId,
    event_count: value.eventCount,
    last_event_id: value.lastEventId,
    selected_analysis_event_id: value.selectedAnalysisEventId,
    intent_critique_event_id: value.intentCritiqueEventId,
    intent_confirmation_event_id: value.intentConfirmationEventId,
    summary_snapshot_event_id: value.summarySnapshotEventId,
    summary_review_event_id: value.summaryReviewEventId,
    child_pool_event_id: value.childPoolEventId,
    child_review_event_id: value.childReviewEventId,
    adult_pool_event_id: value.adultPoolEventId,
    adult_review_event_id: value.adultReviewEventId,
    required_event_count: value.eventCount,
    required_event_id: value.lastEventId,
  };
}

export async function fingerprintFinalCheckTicket(raw: unknown): Promise<{
  ticket: FinalCheckTicket;
  ticketFingerprint: string;
  childPlacementTicketFingerprint: string;
  adultPlacementTicketFingerprint: string;
}> {
  const parsed = finalCheckTicketSchema.safeParse(raw);
  if (!parsed.success) return fail("FINAL_TICKET_INVALID");
  const ticket = parsed.data;
  const ticketFingerprint = await sha256Bytes(new TextEncoder().encode(canonicalJson(ticket)));
  const childPlacementTicketFingerprint = await sha256Bytes(
    new TextEncoder().encode(canonicalJson(ticket.placements.child.ticket)),
  );
  const adultPlacementTicketFingerprint = await sha256Bytes(
    new TextEncoder().encode(canonicalJson(ticket.placements.adult.ticket)),
  );
  return { ticket, ticketFingerprint, childPlacementTicketFingerprint, adultPlacementTicketFingerprint };
}

type PreparedTicket = {
  command: z.output<typeof commitTicketSchema>;
  payload: PreparedPayload;
  derived: Awaited<ReturnType<typeof fingerprintFinalCheckTicket>>;
};

function sameConfirmedBinding(a: FinalCheckTicket["binding"], b: FinalCheckTicket["binding"]) {
  return sameTranscript(a.transcript, b.transcript) && a.analysisId === b.analysisId && a.intentConfirmationId === b.intentConfirmationId;
}
async function prepareTicket(raw: CommitFinalCheckTicketCommand): Promise<PreparedTicket> {
  const parsed = commitTicketSchema.safeParse(raw);
  if (!parsed.success) return fail("FINAL_TICKET_INVALID");
  const command = parsed.data;
  const derived = await fingerprintFinalCheckTicket(command.payload);
  const aggregateVersion = command.expectedInput.version + command.expectedCurrent.eventCount;
  if (command.expectedTicketFingerprint !== derived.ticketFingerprint ||
    command.inputs.childPlacementTicketFingerprint !== derived.childPlacementTicketFingerprint ||
    command.inputs.adultPlacementTicketFingerprint !== derived.adultPlacementTicketFingerprint ||
    command.inputs.childSelectionIndex !== derived.ticket.placements.child.index ||
    command.inputs.adultSelectionIndex !== derived.ticket.placements.adult.index ||
    derived.ticket.sermonId !== command.sermonId || derived.ticket.expectedVersion !== aggregateVersion ||
    derived.ticket.metadata.sermonId !== command.sermonId ||
    derived.ticket.metadata.metadataRevision !== command.expectedMetadataRevision ||
    derived.ticket.binding.analysisId !== command.expectedCurrent.selectedAnalysisEventId ||
    derived.ticket.binding.intentConfirmationId !== command.inputs.intentConfirmationEventId ||
    !sameConfirmedBinding(derived.ticket.summary.binding, derived.ticket.binding) ||
    !sameConfirmedBinding(derived.ticket.placements.child.ticket.binding, derived.ticket.binding) ||
    !sameConfirmedBinding(derived.ticket.placements.adult.ticket.binding, derived.ticket.binding) ||
    derived.ticket.binding.transcript.sourceId !== command.expectedInput.sourceId ||
    derived.ticket.binding.transcript.revisionId !== command.expectedInput.documentId ||
    derived.ticket.binding.transcript.transcriptSha256 !== command.expectedInput.documentSha256 ||
    derived.ticket.binding.transcript.confirmationId !== command.expectedInput.confirmationId ||
    derived.ticket.binding.transcript.version !== aggregateVersion ||
    derived.ticket.summary.summaryId !== command.inputs.summarySnapshotEventId ||
    derived.ticket.summary.reviewId !== command.inputs.summaryReviewEventId ||
    derived.ticket.placements.child.ticket.poolId !== command.inputs.childPoolEventId ||
    derived.ticket.placements.child.ticket.reviewId !== command.inputs.childReviewEventId ||
    derived.ticket.placements.adult.ticket.poolId !== command.inputs.adultPoolEventId ||
    derived.ticket.placements.adult.ticket.reviewId !== command.inputs.adultReviewEventId ||
    !same(command.inputs, {
      intentConfirmationEventId: command.expectedCurrent.intentConfirmationEventId,
      summarySnapshotEventId: command.expectedCurrent.summarySnapshotEventId,
      summaryReviewEventId: command.expectedCurrent.summaryReviewEventId,
      childPoolEventId: command.expectedCurrent.childPoolEventId,
      childReviewEventId: command.expectedCurrent.childReviewEventId,
      adultPoolEventId: command.expectedCurrent.adultPoolEventId,
      adultReviewEventId: command.expectedCurrent.adultReviewEventId,
      childPlacementTicketFingerprint: derived.childPlacementTicketFingerprint,
      adultPlacementTicketFingerprint: derived.adultPlacementTicketFingerprint,
      childSelectionIndex: derived.ticket.placements.child.index,
      adultSelectionIndex: derived.ticket.placements.adult.index,
    })) return fail("FINAL_TICKET_INVALID");
  return { command, derived, payload: await preparePayload(derived.ticket) };
}

const currentWitnesses = new WeakMap<object, { db: D1Database; sermonId: string }>();
export function createHumanContentRuntimeStore(database: D1Database) {
  async function readCurrent(sermonId: string) {
    if (!id.safeParse(sermonId).success) return fail("HUMAN_CONTENT_INVALID");
    try {
      const h0 = await readStoredCurrent(database, sermonId);
      if (!h0) {
        const presence = await contentPresence(database, sermonId);
        if (presence.sermon_exists === 0) return null;
        if (presence.has_head === 1 || presence.has_current === 1 || presence.has_events === 1) {
          return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
        }
        return null;
      }
      const events = await readVerifiedEvents(database, sermonId, referencedEventIds(h0));
      validateCurrentEvents(h0, events);
      const [h1, contentEvents] = await readTogether([readStoredCurrent(database, sermonId),
        allRows(database, `SELECT DISTINCT input_version,source_id,document_id,
        document_sha256,confirmation_id FROM sermon_content_events WHERE sermon_id=? AND event_id IN
        (${referencedEventIds(h0).map(() => "?").join(",")})`, [sermonId, ...referencedEventIds(h0)]),
      ]);
      if (!h1 || !same(h0, h1)) return fail("HUMAN_CONTENT_READ_CHANGED");
      const bound = events.every((event) => {
        const row = event as VerifiedEvent;
        return row.eventId === h0.lastEventId || [
          h0.selectedAnalysisEventId, h0.intentCritiqueEventId, h0.intentConfirmationEventId,
          h0.summarySnapshotEventId, h0.summaryReviewEventId, h0.childPoolEventId,
          h0.childReviewEventId, h0.adultPoolEventId, h0.adultReviewEventId,
        ].includes(row.eventId);
      });
      if (!bound) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
      if (contentEvents.length !== 1) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
      const binding = contentEvents[0]!;
      const currentBinding = binding.input_version === h0.input.version && binding.source_id === h0.input.sourceId &&
        binding.document_id === h0.input.documentId && binding.document_sha256 === h0.input.documentSha256 &&
        binding.confirmation_id === h0.input.confirmationId;
      const value = freeze({ status: currentBinding ? "current" as const : "stale" as const,
        input: h0.input, current: currentRefs(h0), events });
      currentWitnesses.set(value, { db: database, sermonId });
      return value;
    } catch (error) {
      if (error instanceof HumanContentRuntimeStoreError) throw error;
      return fail("HUMAN_CONTENT_STORAGE_UNAVAILABLE");
    }
  }

  async function probeHumanPrepared(prepared: PreparedHumanAppend): Promise<HumanContentProbe> {
    try {
      const { command } = prepared;
      const event = await oneRow(database, "SELECT * FROM sermon_content_events WHERE sermon_id=? AND event_id=?",
        [command.sermonId, command.eventId]);
      const detail = await oneRow(database, "SELECT * FROM sermon_content_human_events WHERE sermon_id=? AND event_id=?",
        [command.sermonId, command.eventId]);
      const byCommand = await allRows(database, "SELECT sermon_id,event_id FROM sermon_content_human_events WHERE command_key=?",
        [command.commandKey]);
      if (!event && !detail && byCommand.length === 0) return "absent";
      if (!event || !detail || byCommand.length !== 1 || byCommand[0]?.sermon_id !== command.sermonId ||
        byCommand[0]?.event_id !== command.eventId || !exactObject(event, humanEventExpected(prepared)) ||
        !exactObject(detail, humanDetailExpected(command)) ||
        !await verifyStoredPayload(database, command.sermonId, command.eventId, prepared.payload)) return "mismatch";
      const head = await oneRow(database, "SELECT * FROM sermon_content_heads WHERE sermon_id=?", [command.sermonId]);
      const current = await oneRow(database, "SELECT * FROM sermon_content_current WHERE sermon_id=?", [command.sermonId]);
      return head && current && exactObject(head, { sermon_id: command.sermonId, event_count: prepared.next.eventCount,
        last_event_id: prepared.next.lastEventId, required_event_count: prepared.next.eventCount,
        required_event_id: prepared.next.lastEventId }) && exactObject(current, currentExpected(command.sermonId, prepared.next))
        ? "exact" : "mismatch";
    } catch {
      return "unavailable";
    }
  }

  async function probeHumanAppend(raw: AppendHumanContentCommand): Promise<HumanContentProbe> {
    try { return await probeHumanPrepared(await prepareHumanAppend(raw)); }
    catch { return "unavailable"; }
  }

  function humanStatements(prepared: PreparedHumanAppend): { changes: number[]; statements: D1PreparedStatement[] } {
    const { command, next, payload } = prepared;
    const sequence = next.eventCount;
    const kind = eventKind(command);
    const statements: D1PreparedStatement[] = [
      database.prepare(`INSERT INTO sermon_content_events (sermon_id,event_id,content_sequence,aggregate_version,
        origin,kind,difficulty,generation_job_id,step_key,input_version,source_id,document_id,document_sha256,
        confirmation_id,base_analysis_event_id,analysis_event_id,intent_confirmation_event_id,payload_sha256,
        payload_byte_length,payload_chunk_count,state,required_state,created_by_actor_id,created_at)
        VALUES (?,?,?,?,'human',?,?,NULL,NULL,?,?,?,?,?,NULL,?,?,?,?,?,'assembling','sealed',?,?)`)
        .bind(command.sermonId, command.eventId, sequence, command.expectedInput.version + sequence, kind,
          command.difficulty, command.expectedInput.version, command.expectedInput.sourceId, command.expectedInput.documentId,
          command.expectedInput.documentSha256, command.expectedInput.confirmationId,
          command.operation === "intent_confirm" ? command.targetSnapshotEventId
            : kind === "summary" || kind === "candidate" ? command.expectedCurrent.selectedAnalysisEventId : null,
          kind === "summary" || kind === "candidate" ? command.expectedCurrent.intentConfirmationEventId : null,
          payload.payloadSha256, payload.bytes.byteLength, payload.chunks.length, command.actorId, command.createdAt),
      database.prepare(`INSERT INTO sermon_content_human_events (sermon_id,event_id,operation,command_key,
        base_snapshot_event_id,target_snapshot_event_id,restore_source_event_id,critique_event_id,
        intent_confirmation_event_id,expected_current_review_event_id,created_by_actor_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(command.sermonId, command.eventId, command.operation, command.commandKey,
          command.baseSnapshotEventId, command.targetSnapshotEventId, command.restoreSourceEventId,
          command.critiqueEventId, command.intentConfirmationEventId, command.expectedCurrentReviewEventId,
          command.actorId, command.createdAt),
      database.prepare(`INSERT INTO sermon_content_payloads (sermon_id,event_id,codec,chunk_bytes,chunk_count,
        byte_length,payload_sha256,verified) VALUES (?,?,'content-event-json-utf8-v1',65536,?,?,?,0)`)
        .bind(command.sermonId, command.eventId, payload.chunks.length, payload.bytes.byteLength, payload.payloadSha256),
    ];
    const changes = [1, 1, 1];
    if (prepared.domain) {
      const row = domainLineage(prepared.domain);
      statements.push(database.prepare(`INSERT INTO sermon_content_domain_lineage
        (sermon_id,event_id,family,root_analysis_event_id,critique_event_id,target_snapshot_event_id) VALUES (?,?,?,?,?,?)`)
        .bind(row.sermon_id,row.event_id,row.family,row.root_analysis_event_id,row.critique_event_id,row.target_snapshot_event_id));
      changes.push(1);
    }
    for (const [position, chunk] of payload.chunks.entries()) {
      statements.push(database.prepare(`INSERT INTO sermon_content_chunks
        (sermon_id,event_id,position,byte_length,chunk_sha256,body,verified) VALUES (?,?,?,?,?,?,1)`)
        .bind(command.sermonId, command.eventId, position, chunk.byteLength, payload.chunkHashes[position], arrayBuffer(chunk)));
      changes.push(1);
    }
    statements.push(
      database.prepare(`UPDATE sermon_content_heads SET event_count=?,last_event_id=?,required_event_count=?,required_event_id=?
        WHERE sermon_id=? AND event_count=? AND last_event_id=?`).bind(sequence, command.eventId, sequence,
        command.eventId, command.sermonId, command.expectedCurrent.eventCount, command.expectedCurrent.lastEventId),
      database.prepare(`UPDATE sermon_content_current SET event_count=?,last_event_id=?,selected_analysis_event_id=?,
        intent_critique_event_id=?,intent_confirmation_event_id=?,summary_snapshot_event_id=?,summary_review_event_id=?,
        child_pool_event_id=?,child_review_event_id=?,adult_pool_event_id=?,adult_review_event_id=?,
        required_event_count=?,required_event_id=? WHERE sermon_id=? AND event_count=? AND last_event_id=?`)
        .bind(...currentValues(next), command.sermonId, command.expectedCurrent.eventCount, command.expectedCurrent.lastEventId),
      database.prepare("UPDATE sermon_content_payloads SET verified=1 WHERE sermon_id=? AND event_id=? AND verified=0")
        .bind(command.sermonId, command.eventId),
      database.prepare("UPDATE sermon_content_events SET state='sealed' WHERE sermon_id=? AND event_id=? AND state='assembling'")
        .bind(command.sermonId, command.eventId),
    );
    changes.push(1, 1, 1, 1);
    return { changes, statements };
  }

  async function appendHuman(raw: AppendHumanContentCommand): Promise<{
    outcome: "replayed" | "saved";
    eventId: string;
    current: HumanContentCurrentRefs;
  }> {
    const prepared = await prepareHumanAppend(raw);
    const before = await probeHumanPrepared(prepared);
    if (before === "exact") return { outcome: "replayed", eventId: prepared.command.eventId, current: prepared.next };
    if (before !== "absent") return fail(before === "unavailable" ? "HUMAN_CONTENT_WRITE_UNCERTAIN" : "HUMAN_CONTENT_STATE_CONFLICT");
    const current = await readCurrent(prepared.command.sermonId);
    if (!current) return fail("HUMAN_CONTENT_NOT_READY");
    if (current.status !== "current" || !expectedRefsMatch({ ...current.current, input: current.input }, prepared.command)) {
      return fail("HUMAN_CONTENT_STATE_CONFLICT");
    }
    const plan = humanStatements(prepared);
    if (prepared.domain && await hasSnapshotDisplayStorage(database)) {
      plan.statements.push(await snapshotDisplayStatement(database, prepared.domain, prepared.payload.payloadSha256));
      plan.changes.push(1);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const results = await database.batch(plan.statements);
        if (exactBatch(results, plan.changes)) return { outcome: "saved", eventId: prepared.command.eventId, current: prepared.next };
      } catch { /* Resolve only this command/event identity below. */ }
      const probe = await probeHumanPrepared(prepared);
      if (probe === "exact") return { outcome: "replayed", eventId: prepared.command.eventId, current: prepared.next };
      if (probe !== "absent") return fail("HUMAN_CONTENT_WRITE_UNCERTAIN");
    }
    return fail("HUMAN_CONTENT_WRITE_UNCERTAIN");
  }

  async function readTicketRecord(ticketId: string): Promise<{
    payload: FinalCheckTicket;
    row: Record<string, unknown>;
    status: "current" | "stale";
  } | null> {
    const remembered = cachedGenerationRead<{ row: Record<string, unknown>; payload: Awaited<ReturnType<typeof fingerprintFinalCheckTicket>>["ticket"] }>(database, `ticket:${ticketId}`);
    if (remembered) { const saved = await remembered; return ticketStatus(saved.row, saved.payload); }
    const row = await oneRow(database, `SELECT t.*,i.intent_confirmation_event_id,i.summary_snapshot_event_id,
      i.summary_review_event_id,i.child_pool_event_id,i.child_review_event_id,i.adult_pool_event_id,
      i.adult_review_event_id,i.child_placement_ticket_fingerprint,i.adult_placement_ticket_fingerprint,
      i.child_selection_index,i.adult_selection_index FROM final_check_tickets t
      LEFT JOIN final_check_ticket_inputs i ON i.ticket_id=t.id WHERE t.id=?`, [ticketId]);
    if (!row) return null;
    if (row.state !== "sealed" || typeof row.payload_chunk_count !== "number" ||
      typeof row.payload_byte_length !== "number" || typeof row.payload_sha256 !== "string") {
      return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    }
    const chunks = await allRows(database, `SELECT position,byte_length,chunk_sha256,CASE WHEN typeof(body)='blob' THEN hex(substr(body,1,65537)) END AS body_hex,verified
      FROM final_check_ticket_chunks WHERE ticket_id=? ORDER BY position`, [ticketId]);
    if (chunks.length !== row.payload_chunk_count || chunks.length > 4096) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    const bodies: Uint8Array[] = [];
    for (const [position, chunk] of chunks.entries()) {
      const body = decodeD1HexBlob(chunk.body_hex, 65536);
      if (!body || chunk.position !== position || chunk.byte_length !== body.byteLength || chunk.verified !== 1 ||
        await sha256Bytes(body) !== chunk.chunk_sha256) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
      bodies.push(body);
    }
    const bytes = new Uint8Array(bodies.reduce((sum, body) => sum + body.byteLength, 0));
    let offset = 0;
    for (const body of bodies) { bytes.set(body, offset); offset += body.byteLength; }
    if (bytes.byteLength !== row.payload_byte_length || await sha256Bytes(bytes) !== row.payload_sha256) {
      return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown; }
    catch { return fail("HUMAN_CONTENT_STORAGE_CORRUPT"); }
    let derived: Awaited<ReturnType<typeof fingerprintFinalCheckTicket>>;
    try { derived = await fingerprintFinalCheckTicket(raw); }
    catch { return fail("HUMAN_CONTENT_STORAGE_CORRUPT"); }
    if (derived.ticketFingerprint !== row.ticket_fingerprint ||
      derived.childPlacementTicketFingerprint !== row.child_placement_ticket_fingerprint ||
      derived.adultPlacementTicketFingerprint !== row.adult_placement_ticket_fingerprint ||
      derived.ticket.placements.child.index !== row.child_selection_index ||
      derived.ticket.placements.adult.index !== row.adult_selection_index ||
      derived.ticket.summary.reviewId !== row.summary_review_event_id ||
      derived.ticket.placements.child.ticket.poolId !== row.child_pool_event_id ||
      derived.ticket.placements.child.ticket.reviewId !== row.child_review_event_id ||
      derived.ticket.placements.adult.ticket.poolId !== row.adult_pool_event_id ||
      derived.ticket.placements.adult.ticket.reviewId !== row.adult_review_event_id ||
      derived.ticket.binding.intentConfirmationId !== row.intent_confirmation_event_id ||
      !sameConfirmedBinding(derived.ticket.summary.binding, derived.ticket.binding) ||
      !sameConfirmedBinding(derived.ticket.placements.child.ticket.binding, derived.ticket.binding) ||
      !sameConfirmedBinding(derived.ticket.placements.adult.ticket.binding, derived.ticket.binding)) {
      return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    }
    const [input, confirmation] = await readTogether([
      oneRow(database, `SELECT d.version,d.source_id,d.document_id,d.document_sha256,d.confirmation_id,
      s.version AS source_revision,s.document_sha256 AS source_sha256 FROM sermon_input_events d
      JOIN sermon_input_events s ON s.sermon_id=d.sermon_id AND s.id=d.source_id AND s.kind='source' AND s.state='sealed'
      WHERE d.sermon_id=? AND d.version=? AND d.state='sealed'`, [row.sermon_id, row.input_version]),
      oneRow(database, `SELECT h.target_snapshot_event_id FROM sermon_content_human_events h
      JOIN sermon_content_events e ON e.sermon_id=h.sermon_id AND e.event_id=h.event_id
      WHERE h.sermon_id=? AND h.event_id=? AND h.operation='intent_confirm'
        AND e.kind='intent_confirmation' AND e.origin='human' AND e.state='sealed'`,
    [row.sermon_id, row.intent_confirmation_event_id]),
    ]);
    const transcript = derived.ticket.binding.transcript;
    if (!input || !confirmation || input.version !== row.input_version ||
      transcript.sourceId !== input.source_id || transcript.sourceRevision !== input.source_revision ||
      transcript.revisionId !== input.document_id ||
      transcript.transcriptSha256 !== input.document_sha256 || transcript.confirmationId !== input.confirmation_id ||
      transcript.version !== row.aggregate_version ||
      derived.ticket.binding.analysisId !== confirmation.target_snapshot_event_id) {
      return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    }
    if (transcript.sourceSha256 !== input.source_sha256) {
      const store = createSermonInputStore(database), record = await store.event(String(row.sermon_id), transcript.sourceId);
      if (!record) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
      const payload = transcriptSourcePayloadSchema.parse(await store.payload(record));
      await verifySource(payload);
      if ((payload.sourceMode === "public_unofficial" ? payload.sourceSha256 : payload.rawTranscriptSha256) !== transcript.sourceSha256) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    }
    const payload = freeze(derived.ticket);
    rememberGenerationRead(database, `ticket:${ticketId}`, { payload, row });
    return ticketStatus(row, payload);
  }
  async function ticketStatus(row: Record<string, unknown>, payload: Awaited<ReturnType<typeof fingerprintFinalCheckTicket>>["ticket"]) {
    const [current, metadata] = await readTogether([readStoredCurrent(database, String(row.sermon_id)),
      oneRow(database, "SELECT metadata_revision FROM sermon_metadata_drafts WHERE sermon_id=?", [row.sermon_id])]);
    if (!current || !metadata) return fail("HUMAN_CONTENT_STORAGE_CORRUPT");
    const exactCurrent = metadata.metadata_revision === row.metadata_revision &&
      current.input.version === row.input_version && current.eventCount === row.content_event_count &&
      current.intentConfirmationEventId === row.intent_confirmation_event_id &&
      current.summarySnapshotEventId === row.summary_snapshot_event_id && current.summaryReviewEventId === row.summary_review_event_id &&
      current.childPoolEventId === row.child_pool_event_id && current.childReviewEventId === row.child_review_event_id &&
      current.adultPoolEventId === row.adult_pool_event_id && current.adultReviewEventId === row.adult_review_event_id;
    return { payload, row, status: exactCurrent ? "current" as const : "stale" as const };
  }

  async function readFinalTicket(ticketId: string) {
    if (!id.safeParse(ticketId).success) return fail("FINAL_TICKET_INVALID");
    try { return await readTicketRecord(ticketId); }
    catch (error) {
      if (error instanceof HumanContentRuntimeStoreError) throw error;
      return fail("HUMAN_CONTENT_STORAGE_UNAVAILABLE");
    }
  }

  function ticketExpected(prepared: PreparedTicket) {
    const { command, payload, derived } = prepared;
    return {
        id: command.ticketId, sermon_id: command.sermonId, quiz_set_id: command.quizSetId,
        aggregate_version: command.expectedInput.version + command.expectedCurrent.eventCount,
        metadata_revision: command.expectedMetadataRevision, input_version: command.expectedInput.version,
        content_event_count: command.expectedCurrent.eventCount, summary_review_id: command.inputs.summaryReviewEventId,
        child_review_id: command.inputs.childReviewEventId, adult_review_id: command.inputs.adultReviewEventId,
        child_placement_ticket_id: command.inputs.childPlacementTicketFingerprint,
        adult_placement_ticket_id: command.inputs.adultPlacementTicketFingerprint,
        ticket_fingerprint: derived.ticketFingerprint, payload_sha256: payload.payloadSha256,
        payload_byte_length: payload.bytes.byteLength, payload_chunk_count: payload.chunks.length,
        state: "sealed", created_at: command.createdAt,
        intent_confirmation_event_id: command.inputs.intentConfirmationEventId,
        summary_snapshot_event_id: command.inputs.summarySnapshotEventId,
        summary_review_event_id: command.inputs.summaryReviewEventId,
        child_pool_event_id: command.inputs.childPoolEventId, child_review_event_id: command.inputs.childReviewEventId,
        adult_pool_event_id: command.inputs.adultPoolEventId, adult_review_event_id: command.inputs.adultReviewEventId,
        child_placement_ticket_fingerprint: command.inputs.childPlacementTicketFingerprint,
        adult_placement_ticket_fingerprint: command.inputs.adultPlacementTicketFingerprint,
        child_selection_index: command.inputs.childSelectionIndex, adult_selection_index: command.inputs.adultSelectionIndex,
      };
  }
  async function probeTicketPrepared(prepared: PreparedTicket): Promise<FinalTicketProbe> {
    try {
      const [found, duplicate] = await readTogether([readTicketRecord(prepared.command.ticketId),
        allRows(database, "SELECT id FROM final_check_tickets WHERE ticket_fingerprint=?", [prepared.derived.ticketFingerprint])]);
      if (!found) {
        return duplicate.length === 0 ? "absent" : "mismatch";
      }
      const { command, payload } = prepared;
      const expected = ticketExpected(prepared);
      if (!exactObject(found.row, expected)) return "mismatch";
      const chunksMatch = await allRows(database, `SELECT position,byte_length,chunk_sha256,body,verified
        FROM final_check_ticket_chunks WHERE ticket_id=? ORDER BY position`, [command.ticketId]);
      if (chunksMatch.length !== payload.chunks.length) return "mismatch";
      for (const [index, row] of chunksMatch.entries()) {
        const body = bytesFromD1(row.body);
        if (!body || row.position !== index || row.byte_length !== payload.chunks[index]!.byteLength ||
          row.chunk_sha256 !== payload.chunkHashes[index] || row.verified !== 1 ||
          !same([...body], [...payload.chunks[index]!])) return "mismatch";
      }
      return found.status === "current" ? "current" : "committed_but_stale";
    } catch {
      return "unavailable";
    }
  }

  async function probeFinalTicket(raw: CommitFinalCheckTicketCommand): Promise<FinalTicketProbe> {
    try { return await probeTicketPrepared(await prepareTicket(raw)); }
    catch { return "unavailable"; }
  }

  function ticketStatements(prepared: PreparedTicket): { changes: number[]; statements: D1PreparedStatement[] } {
    const { command, payload, derived } = prepared;
    const statements: D1PreparedStatement[] = [
      database.prepare(`INSERT INTO final_check_tickets (id,sermon_id,quiz_set_id,aggregate_version,metadata_revision,
        input_version,content_event_count,summary_review_id,child_review_id,adult_review_id,
        child_placement_ticket_id,adult_placement_ticket_id,ticket_fingerprint,payload_sha256,payload_byte_length,
        payload_chunk_count,state,required_state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'sealed',?)`)
        .bind(command.ticketId, command.sermonId, command.quizSetId,
          command.expectedInput.version + command.expectedCurrent.eventCount, command.expectedMetadataRevision,
          command.expectedInput.version, command.expectedCurrent.eventCount, command.inputs.summaryReviewEventId,
          command.inputs.childReviewEventId, command.inputs.adultReviewEventId,
          command.inputs.childPlacementTicketFingerprint, command.inputs.adultPlacementTicketFingerprint,
          derived.ticketFingerprint, payload.payloadSha256, payload.bytes.byteLength, payload.chunks.length,
          "assembling", command.createdAt),
    ];
    const changes = [1];
    for (const [position, chunk] of payload.chunks.entries()) {
      statements.push(database.prepare(`INSERT INTO final_check_ticket_chunks
        (ticket_id,position,byte_length,chunk_sha256,body,verified) VALUES (?,?,?,?,?,1)`)
        .bind(command.ticketId, position, chunk.byteLength, payload.chunkHashes[position], arrayBuffer(chunk)));
      changes.push(1);
    }
    statements.push(
      database.prepare(`INSERT INTO final_check_ticket_inputs (ticket_id,sermon_id,intent_confirmation_event_id,
        summary_snapshot_event_id,summary_review_event_id,child_pool_event_id,child_review_event_id,
        adult_pool_event_id,adult_review_event_id,child_placement_ticket_fingerprint,
        adult_placement_ticket_fingerprint,child_selection_index,adult_selection_index)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(command.ticketId, command.sermonId,
          command.inputs.intentConfirmationEventId, command.inputs.summarySnapshotEventId,
          command.inputs.summaryReviewEventId, command.inputs.childPoolEventId, command.inputs.childReviewEventId,
          command.inputs.adultPoolEventId, command.inputs.adultReviewEventId,
          command.inputs.childPlacementTicketFingerprint, command.inputs.adultPlacementTicketFingerprint,
          command.inputs.childSelectionIndex, command.inputs.adultSelectionIndex),
      database.prepare("UPDATE final_check_tickets SET state='sealed' WHERE id=? AND state='assembling'")
        .bind(command.ticketId),
    );
    changes.push(1, 1);
    return { changes, statements };
  }

  async function commitFinalTicket(raw: CommitFinalCheckTicketCommand, captured?: Awaited<ReturnType<typeof readCurrent>>): Promise<{
    outcome: "committed" | "replayed";
    status: "current" | "committed_but_stale";
    ticketId: string;
    ticketFingerprint: string;
  }> {
    const prepared = await prepareTicket(raw);
    const [before, metadata, source, confirmation] = await readTogether([probeTicketPrepared(prepared),
      oneRow(database, `SELECT m.metadata_revision,q.sermon_id AS quiz_sermon_id
      FROM sermon_metadata_drafts m JOIN quiz_sets q ON q.sermon_id=m.sermon_id
      WHERE m.sermon_id=? AND q.id=?`, [prepared.command.sermonId, prepared.command.quizSetId]),
      oneRow(database, `SELECT s.version,s.document_sha256 FROM sermon_input_events s
      WHERE s.sermon_id=? AND s.id=? AND s.kind='source' AND s.state='sealed'`,
    [prepared.command.sermonId, prepared.command.expectedInput.sourceId]),
      oneRow(database, `SELECT target_snapshot_event_id FROM sermon_content_human_events
      WHERE sermon_id=? AND event_id=? AND operation='intent_confirm'`,
    [prepared.command.sermonId, prepared.command.inputs.intentConfirmationEventId]),
    ]);
    if (before === "current" || before === "committed_but_stale") return { outcome: "replayed", status: before,
      ticketId: prepared.command.ticketId, ticketFingerprint: prepared.derived.ticketFingerprint };
    if (before !== "absent") return fail(before === "unavailable" ? "FINAL_TICKET_WRITE_UNCERTAIN" : "FINAL_TICKET_STATE_CONFLICT");
    const witness = captured && currentWitnesses.get(captured);
    const current = witness?.db === database && witness.sermonId === prepared.command.sermonId ? captured : await readCurrent(prepared.command.sermonId);
    if (!current || current.status !== "current" ||
      !same(current.input, prepared.command.expectedInput) || !same(current.current, prepared.command.expectedCurrent)) {
      return fail("FINAL_TICKET_STATE_CONFLICT");
    }
    if (!metadata || metadata.metadata_revision !== prepared.command.expectedMetadataRevision ||
      metadata.quiz_sermon_id !== prepared.command.sermonId) return fail("FINAL_TICKET_STATE_CONFLICT");
    const transcript = prepared.derived.ticket.binding.transcript;
    if (!source || !confirmation || transcript.sourceRevision !== source.version ||
      prepared.derived.ticket.binding.analysisId !== confirmation.target_snapshot_event_id) {
      return fail("FINAL_TICKET_STATE_CONFLICT");
    }
    if (transcript.sourceSha256 !== source.document_sha256) {
      const store = createSermonInputStore(database), record = await store.event(prepared.command.sermonId, prepared.command.expectedInput.sourceId);
      if (!record) return fail("FINAL_TICKET_STATE_CONFLICT");
      const payload = transcriptSourcePayloadSchema.parse(await store.payload(record));
      await verifySource(payload);
      const sourceHash = payload.sourceMode === "public_unofficial" ? payload.sourceSha256 : payload.rawTranscriptSha256;
      if (sourceHash !== transcript.sourceSha256) return fail("FINAL_TICKET_STATE_CONFLICT");
    }
    const plan = ticketStatements(prepared);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const results = await database.batch(plan.statements);
        if (exactBatch(results, plan.changes)) {
          rememberGenerationRead(database, `ticket:${prepared.command.ticketId}`, { payload: freeze(prepared.derived.ticket),
            row: { ...ticketExpected(prepared), required_state: "sealed" } });
          return { outcome: "committed", status: "current", ticketId: prepared.command.ticketId, ticketFingerprint: prepared.derived.ticketFingerprint };
        }
      } catch { /* Exact ticket ID/fingerprint probe below. */ }
      const probe = await probeTicketPrepared(prepared);
      if (probe === "current" || probe === "committed_but_stale") return { outcome: "replayed", status: probe,
        ticketId: prepared.command.ticketId, ticketFingerprint: prepared.derived.ticketFingerprint };
      if (probe !== "absent") return fail("FINAL_TICKET_WRITE_UNCERTAIN");
    }
    return fail("FINAL_TICKET_WRITE_UNCERTAIN");
  }

  return { appendHuman, commitFinalTicket, probeFinalTicket, probeHumanAppend, readCurrent, readFinalTicket };
}

export type HumanContentRuntimeStore = ReturnType<typeof createHumanContentRuntimeStore>;
