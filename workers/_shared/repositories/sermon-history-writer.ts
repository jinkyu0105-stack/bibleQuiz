import { HistoryResourceLimitError, historyResourceLimits as limits, preflightHistoryState, measureHistoryBatch, withinHistoryLimit } from "../storage/history-resource-limits";
import { z } from "zod";

import {
  privateTranscriptStateSchema,
  type PrivateTranscriptState,
  type TranscriptRevisionStore,
  type TranscriptState,
} from "../services/transcript-revision-contract";
import { validateTranscriptState } from "../services/transcript-revisions";
import { sameHistoryValue, type HistoryPayload } from "../storage/history-json-codec";
import { sameHistoryStoredRow } from "../storage/history-byte-array";
import {
  encodeHistoryRecord,
  historyEnvelopeSchema,
  historyStreams,
  parseHistoryRecord,
  type HistoryRecord,
  type HistoryStream,
} from "../storage/history-record";
import {
  projectHistoryReferences,
  type HistoryReference,
  type HistoryScope,
} from "../storage/history-references";
import {
  createSermonHistoryReader,
  SermonHistoryReadError,
} from "./sermon-history-reader";

const idSchema = historyEnvelopeSchema.shape.sermonId;
const positive = z.int().positive();
const headSchema = z.strictObject({
  sermon_id: idSchema,
  version: positive,
  commit_id: idSchema,
  current_source_id: idSchema,
  current_revision_id: idSchema,
  current_confirmation_id: idSchema.nullable(),
  storage_format_version: z.literal(1),
  contract_version: z.literal(1),
});
const storedEnvelopeSchema = z.strictObject({
  sermon_id: idSchema,
  record_id: idSchema,
  stream: z.enum(historyStreams),
  stream_position: positive,
  commit_version: positive,
  commit_slot: z.union([z.literal(0), z.literal(1)]),
  source_revision: positive.nullable(),
  difficulty: z.enum(["child", "adult"]).nullable(),
  verified: z.literal(1),
});

type WriteFailureCode =
  | "HISTORY_WRITE_INVALID"
  | "HISTORY_WRITE_CORRUPT"
  | "HISTORY_WRITE_UNAVAILABLE"
  | "HISTORY_WRITE_FAILED"
  | "HISTORY_WRITE_UNCERTAIN";

export class SermonHistoryWriteError extends Error {
  constructor(readonly code: WriteFailureCode) {
    super(code);
  }
}

function fail(code: WriteFailureCode): never {
  throw new SermonHistoryWriteError(code);
}

type SqlValue = string | number | null | ArrayBuffer;
type PlannedStatement = {
  label: string;
  sql: string;
  values: SqlValue[];
  expectedChanges: number;
};
type StoredHead = z.infer<typeof headSchema>;
type PreparedRecord = {
  record: HistoryRecord;
  payload: HistoryPayload;
  references: HistoryReference[];
};
type AppendPlan = {
  attemptId: string;
  commitId: string;
  commit: Record<string, SqlValue>;
  expectedHead: StoredHead | null;
  statements: PlannedStatement[];
  records: PreparedRecord[];
};

type PlanMode = "row" | "grouped-free-spike";

export type SermonHistoryOperationMetrics = {
  readQueries: number;
  mutationStatements: number;
  probeQueries: number;
  operationReads: number;
};

export type SermonHistoryOperationSeed = {
  sermonId: string;
  current: PrivateTranscriptState | null;
  head: unknown;
  envelopes: unknown[];
};

const freeSpikeLimits = Object.freeze({
  statements: 24,
  deltaBytes: 512 * 1024,
  chunks: 16,
  references: 48,
  boundBytes: 2 * 1024 * 1024,
  wireBytes: 8 * 1024 * 1024,
});

function freeze(value: unknown): void {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}

function parseExactNext(next: unknown, sermonId: string): Promise<TranscriptState> {
  try { preflightHistoryState(next); } catch (error) {
    if (error instanceof HistoryResourceLimitError) throw error;
    return Promise.reject(new SermonHistoryWriteError("HISTORY_WRITE_INVALID"));
  }
  const parsed = privateTranscriptStateSchema.safeParse(next);
  if (!parsed.success || !sameHistoryValue(next, parsed.data) || parsed.data.sermonId !== sermonId) {
    return Promise.reject(new SermonHistoryWriteError("HISTORY_WRITE_INVALID"));
  }
  return validateTranscriptState(structuredClone(parsed.data), sermonId).catch(() =>
    fail("HISTORY_WRITE_INVALID"));
}

function countsOf(state: TranscriptState | null): Record<HistoryStream, number> {
  return Object.fromEntries(historyStreams.map((stream) => [stream, state?.[stream].length ?? 0])) as Record<HistoryStream, number>;
}

function validateDelta(current: TranscriptState | null, next: TranscriptState, expectedVersion: number | null): HistoryStream | "import" {
  const expected = expectedVersion ?? 0;
  if ((current === null) !== (expectedVersion === null) || (current?.version ?? null) !== expectedVersion ||
    next.version !== expected + 1 || !Number.isSafeInteger(next.version)) fail("HISTORY_WRITE_INVALID");

  const before = countsOf(current);
  const deltas = Object.fromEntries(historyStreams.map((stream) => {
    if (!sameHistoryValue(current?.[stream] ?? [], next[stream].slice(0, before[stream]))) fail("HISTORY_WRITE_INVALID");
    return [stream, next[stream].length - before[stream]];
  })) as Record<HistoryStream, number>;
  if (historyStreams.some((stream) => deltas[stream] < 0 || deltas[stream] > 1)) fail("HISTORY_WRITE_INVALID");

  let command: HistoryStream | "import";
  if (deltas.sources === 1) {
    if (deltas.revisions !== 1 || historyStreams.some((stream) =>
      stream !== "sources" && stream !== "revisions" && deltas[stream] !== 0) ||
      next.revisions.at(-1)?.kind !== "imported") fail("HISTORY_WRITE_INVALID");
    command = "import";
  } else {
    const changed = historyStreams.filter((stream) => stream !== "sources" && deltas[stream] === 1);
    if (changed.length !== 1 || historyStreams.some((stream) => stream !== changed[0] && deltas[stream] !== 0)) {
      fail("HISTORY_WRITE_INVALID");
    }
    command = changed[0]!;
    if (command === "revisions" && next.revisions.at(-1)?.kind === "imported") fail("HISTORY_WRITE_INVALID");
  }

  const oldSource = current?.currentSourceId;
  const oldRevision = current?.currentRevisionId;
  const oldConfirmation = current?.currentConfirmationId ?? null;
  if (command === "import") {
    if (next.currentSourceId !== next.sources.at(-1)?.id || next.currentRevisionId !== next.revisions.at(-1)?.id ||
      next.currentConfirmationId !== null) fail("HISTORY_WRITE_INVALID");
  } else if (command === "revisions") {
    if (next.currentSourceId !== oldSource || next.currentRevisionId !== next.revisions.at(-1)?.id ||
      next.currentConfirmationId !== null) fail("HISTORY_WRITE_INVALID");
  } else if (command === "confirmations") {
    if (next.currentSourceId !== oldSource || next.currentRevisionId !== oldRevision ||
      next.currentConfirmationId !== next.confirmations.at(-1)?.id) fail("HISTORY_WRITE_INVALID");
  } else if (next.currentSourceId !== oldSource || next.currentRevisionId !== oldRevision ||
    next.currentConfirmationId !== oldConfirmation) fail("HISTORY_WRITE_INVALID");
  return command;
}

function rowRecord(record: HistoryRecord): Record<string, SqlValue> {
  const envelope = record.envelope;
  return {
    sermon_id: envelope.sermonId,
    record_id: envelope.recordId,
    stream: envelope.stream,
    stream_position: envelope.streamPosition,
    commit_version: envelope.commitVersion,
    commit_slot: envelope.commitSlot,
    source_revision: envelope.sourceRevision,
    difficulty: envelope.difficulty,
    verified: 0,
  };
}

function rowPayload(record: HistoryRecord, payload: HistoryPayload): Record<string, SqlValue> {
  return {
    sermon_id: record.envelope.sermonId,
    record_id: record.envelope.recordId,
    codec: payload.manifest.codec,
    chunk_bytes: payload.manifest.chunkBytes,
    chunk_count: payload.manifest.chunkCount,
    byte_length: payload.manifest.byteLength,
    payload_sha256: payload.manifest.payloadSha256,
    verified: 0,
  };
}

function rowReference(reference: HistoryReference): Record<string, SqlValue> {
  return {
    sermon_id: reference.sermonId,
    owner_record_id: reference.ownerRecordId,
    reference_position: reference.referencePosition,
    relation: reference.relation,
    target_record_id: reference.targetRecordId,
    target_stream: reference.targetStream,
    target_member_id: reference.targetMemberId,
    payload_path: reference.payloadPath,
    verified: 0,
  };
}

function addClaimedRow(plan: PlannedStatement[], table: string, label: string,
  values: Record<string, SqlValue>, claimValues: SqlValue[]): void {
  const columns = Object.keys(values);
  const bound = Object.values(values);
  const claim = "EXISTS (SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id=? AND c.version=? AND c.attempt_id=? AND c.state='assembling')";
  plan.push({
    label: `${label}:insert`,
    sql: `INSERT INTO sermon_history_${table} (${columns.join(",")}) SELECT ${columns.map(() => "?").join(",")} WHERE ${claim}`,
    values: [...bound, ...claimValues],
    expectedChanges: 1,
  });
  plan.push({
    label: `${label}:verify`,
    sql: `UPDATE sermon_history_${table} SET verified=1 WHERE ${columns.map((column) => `${column} IS ?`).join(" AND ")} AND ${claim}`,
    values: [...bound, ...claimValues],
    expectedChanges: 1,
  });
}

function groupedStatement(table: string, action: "insert" | "verify", rows: Record<string, SqlValue>[],
  claimValues: SqlValue[]): PlannedStatement {
  const columns = Object.keys(rows[0]!);
  const tuples = rows.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
  const incoming = `WITH incoming(${columns.join(",")}) AS (VALUES ${tuples})`;
  const claim = "EXISTS (SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id=? AND c.version=? AND c.attempt_id=? AND c.state='assembling')";
  const values = [...rows.flatMap((row) => Object.values(row)), ...claimValues];
  if (action === "insert") {
    return {
      label: `${table}:grouped-insert`,
      sql: `${incoming} INSERT INTO sermon_history_${table} (${columns.join(",")}) SELECT ${columns.join(",")} FROM incoming WHERE ${claim}`,
      values,
      expectedChanges: rows.length,
    };
  }
  return {
    label: `${table}:grouped-verify`,
    sql: `${incoming} UPDATE sermon_history_${table} SET verified=1 WHERE verified=0 AND EXISTS (SELECT 1 FROM incoming WHERE ${columns.map((column) => `sermon_history_${table}.${column} IS incoming.${column}`).join(" AND ")}) AND ${claim}`,
    values,
    expectedChanges: rows.length,
  };
}

/** Group only while the unchanged P5-24 per-statement parameter/byte guards hold.
 * In particular, 64KiB BLOB rows stay one-per-statement so exact bound-byte
 * verification is not weakened to a hash-only comparison. */
function addGroupedRows(plan: PlannedStatement[], table: string, rows: Record<string, SqlValue>[],
  claimValues: SqlValue[]): void {
  if (!rows.length) return;
  let group: Record<string, SqlValue>[] = [];
  function flush() {
    if (!group.length) return;
    plan.push(groupedStatement(table, "insert", group, claimValues));
    plan.push(groupedStatement(table, "verify", group, claimValues));
    group = [];
  }
  for (const row of rows) {
    const candidate = [...group, row];
    try {
      measureHistoryBatch([
        groupedStatement(table, "insert", candidate, claimValues),
        groupedStatement(table, "verify", candidate, claimValues),
      ]);
      group = candidate;
    } catch (error) {
      if (!(error instanceof HistoryResourceLimitError) || group.length === 0) throw error;
      flush();
      group = [row];
      measureHistoryBatch([
        groupedStatement(table, "insert", group, claimValues),
        groupedStatement(table, "verify", group, claimValues),
      ]);
    }
  }
  flush();
}

function newRecords(current: TranscriptState | null, next: TranscriptState, command: HistoryStream | "import"): HistoryRecord[] {
  const before = countsOf(current);
  const streams: HistoryStream[] = command === "import" ? ["sources", "revisions"] : [command];
  return streams.map((stream, slot) => {
    const payload = next[stream][before[stream]];
    if (!payload) return fail("HISTORY_WRITE_INVALID");
    return parseHistoryRecord({
      envelope: {
        storageFormatVersion: 1,
        sermonId: next.sermonId,
        recordId: payload.id,
        stream,
        streamPosition: before[stream] + 1,
        commitVersion: next.version,
        commitSlot: slot,
        sourceRevision: "sourceRevision" in payload ? payload.sourceRevision : null,
        difficulty: stream === "candidateEvents" && "operation" in payload && "difficulty" in payload.operation
          ? payload.operation.difficulty
          : null,
      },
      payload,
    });
  });
}

function storedRecords(state: TranscriptState | null, rows: z.infer<typeof storedEnvelopeSchema>[]): HistoryRecord[] {
  if (!state) {
    if (rows.length) fail("HISTORY_WRITE_CORRUPT");
    return [];
  }
  if (rows.length !== historyStreams.reduce((sum, stream) => sum + state[stream].length, 0)) fail("HISTORY_WRITE_CORRUPT");
  try {
    return rows.map((row) => {
      const payload = state[row.stream][row.stream_position - 1];
      if (!payload || payload.id !== row.record_id) fail("HISTORY_WRITE_CORRUPT");
      return parseHistoryRecord({
        envelope: {
          storageFormatVersion: 1,
          sermonId: row.sermon_id,
          recordId: row.record_id,
          stream: row.stream,
          streamPosition: row.stream_position,
          commitVersion: row.commit_version,
          commitSlot: row.commit_slot,
          sourceRevision: row.source_revision,
          difficulty: row.difficulty,
        },
        payload,
      });
    });
  } catch {
    return fail("HISTORY_WRITE_CORRUPT");
  }
}

async function preparePlan(current: TranscriptState | null, next: TranscriptState, expectedHead: StoredHead | null,
  envelopes: z.infer<typeof storedEnvelopeSchema>[], command: HistoryStream | "import", mode: PlanMode = "row"): Promise<AppendPlan> {
  try {
    const oldRecords = storedRecords(current, envelopes);
    const delta = newRecords(current, next, command);
    const scope: HistoryScope = { sermonId: next.sermonId, version: next.version, counts: countsOf(next) };
    const allRecords = [...oldRecords, ...delta];
    const allReferences = projectHistoryReferences(allRecords, scope);
    withinHistoryLimit(allReferences.length, limits.references);
    const ids = new Set(delta.map((record) => record.envelope.recordId));
    const references = allReferences.filter((reference) => ids.has(reference.ownerRecordId));
    const encoded = await Promise.all(delta.map((record) => encodeHistoryRecord(record)));
    withinHistoryLimit(encoded.reduce((sum, p) => sum + p.manifest.byteLength, 0), limits.deltaBytes);
    withinHistoryLimit(encoded.reduce((sum, p) => sum + p.chunks.length, 0), limits.chunks);
    const prepared: PreparedRecord[] = delta.map((record, index) => ({
      record,
      payload: encoded[index]!,
      references: references.filter((reference) => reference.ownerRecordId === record.envelope.recordId),
    }));
    const attemptId = crypto.randomUUID();
    const commitId = crypto.randomUUID();
    const counts = countsOf(next);
    const commit: Record<string, SqlValue> = {
      sermon_id: next.sermonId,
      version: next.version,
      commit_id: commitId,
      current_source_id: next.currentSourceId,
      current_revision_id: next.currentRevisionId,
      current_confirmation_id: next.currentConfirmationId,
      attempt_id: attemptId,
      previous_version: expectedHead?.version ?? null,
      previous_commit_id: expectedHead?.commit_id ?? null,
      state: "assembling",
      command,
      ...Object.fromEntries(historyStreams.map((stream) => [`${stream}_count`, counts[stream]])),
      record_count: prepared.length,
      reference_count: references.length,
      manifest_count: prepared.length,
      chunk_count: prepared.reduce((sum, item) => sum + item.payload.chunks.length, 0),
      byte_length: prepared.reduce((sum, item) => sum + item.payload.manifest.byteLength, 0),
    };
    if (Object.values(commit).some((value) => typeof value === "number" && !Number.isSafeInteger(value))) {
      fail("HISTORY_WRITE_INVALID");
    }
    const statements: PlannedStatement[] = [];
    const columns = Object.keys(commit);
    const previous = expectedHead
      ? "EXISTS (SELECT 1 FROM sermon_history_heads h JOIN sermon_history_commits p ON p.sermon_id=h.sermon_id AND p.version=h.version AND p.commit_id=h.commit_id WHERE h.sermon_id=? AND h.version=? AND h.commit_id=? AND p.state='sealed')"
      : "EXISTS (SELECT 1 FROM sermons WHERE id=?) AND NOT EXISTS (SELECT 1 FROM sermon_history_heads WHERE sermon_id=?) AND NOT EXISTS (SELECT 1 FROM sermon_history_commits WHERE sermon_id=?) AND NOT EXISTS (SELECT 1 FROM sermon_history_records WHERE sermon_id=?) AND NOT EXISTS (SELECT 1 FROM sermon_history_references WHERE sermon_id=?) AND NOT EXISTS (SELECT 1 FROM sermon_history_payloads WHERE sermon_id=?) AND NOT EXISTS (SELECT 1 FROM sermon_history_chunks WHERE sermon_id=?)";
    const previousValues: SqlValue[] = expectedHead
      ? [next.sermonId, expectedHead.version, expectedHead.commit_id]
      : Array.from({ length: 7 }, () => next.sermonId);
    statements.push({
      label: "claim",
      sql: `INSERT INTO sermon_history_commits (${columns.join(",")}) SELECT ${columns.map(() => "?").join(",")} WHERE ${previous}`,
      values: [...Object.values(commit), ...previousValues],
      expectedChanges: 1,
    });
    const claimValues: SqlValue[] = [next.sermonId, next.version, attemptId];
    const recordRows = prepared.map((item) => rowRecord(item.record));
    const payloadRows = prepared.map((item) => rowPayload(item.record, item.payload));
    const chunkRows = prepared.flatMap((item) => item.payload.chunks.map((chunk) => ({
      sermon_id: next.sermonId,
      record_id: item.record.envelope.recordId,
      chunk_index: chunk.chunkIndex,
      byte_length: chunk.byteLength,
      chunk_sha256: chunk.chunkSha256,
      body: chunk.body.slice().buffer as ArrayBuffer,
      verified: 0,
    })));
    const referenceRows = prepared.flatMap((item) => item.references.map(rowReference));
    if (mode === "grouped-free-spike") {
      addGroupedRows(statements, "records", recordRows, claimValues);
      addGroupedRows(statements, "payloads", payloadRows, claimValues);
      addGroupedRows(statements, "chunks", chunkRows, claimValues);
      addGroupedRows(statements, "references", referenceRows, claimValues);
    } else {
      for (const [recordIndex, row] of recordRows.entries()) {
        addClaimedRow(statements, "records", `record:${recordIndex}`, row, claimValues);
        addClaimedRow(statements, "payloads", `payload:${recordIndex}`, payloadRows[recordIndex]!, claimValues);
        for (const chunkIndex of prepared[recordIndex]!.payload.chunks.keys()) {
          addClaimedRow(statements, "chunks", `chunk:${recordIndex}:${chunkIndex}`,
            chunkRows.splice(0, 1)[0]!, claimValues);
        }
      }
      for (const [referenceIndex, row] of referenceRows.entries()) {
        addClaimedRow(statements, "references", `reference:${referenceIndex}`, row, claimValues);
      }
    }
    if (expectedHead) {
      statements.push({
        label: "head",
        sql: `UPDATE sermon_history_heads SET version=?,commit_id=?,current_source_id=?,current_revision_id=?,current_confirmation_id=?
          WHERE sermon_id=? AND version=? AND commit_id=? AND current_source_id=? AND current_revision_id=? AND current_confirmation_id IS ?
          AND EXISTS (SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id=? AND c.version=? AND c.attempt_id=? AND c.state='assembling')`,
        values: [next.version, commitId, next.currentSourceId, next.currentRevisionId, next.currentConfirmationId,
          next.sermonId, expectedHead.version, expectedHead.commit_id, expectedHead.current_source_id,
          expectedHead.current_revision_id, expectedHead.current_confirmation_id, ...claimValues],
        expectedChanges: 1,
      });
    } else {
      statements.push({
        label: "head",
        sql: `INSERT INTO sermon_history_heads (sermon_id,version,commit_id,current_source_id,current_revision_id,current_confirmation_id,storage_format_version,contract_version)
          SELECT ?,?,?,?,?,?,1,1 WHERE EXISTS (SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id=? AND c.version=? AND c.attempt_id=? AND c.state='assembling')`,
        values: [next.sermonId, next.version, commitId, next.currentSourceId, next.currentRevisionId,
          next.currentConfirmationId, ...claimValues],
        expectedChanges: 1,
      });
    }
    statements.push({
      label: "seal",
      sql: "UPDATE sermon_history_commits SET state='sealed' WHERE sermon_id=? AND version=? AND attempt_id=? AND state='assembling'",
      values: claimValues,
      expectedChanges: 1,
    });
    const measured = measureHistoryBatch(statements);
    if (mode === "grouped-free-spike") {
      withinHistoryLimit(prepared.reduce((sum, item) => sum + item.payload.manifest.byteLength, 0), freeSpikeLimits.deltaBytes);
      withinHistoryLimit(chunkRows.length || prepared.reduce((sum, item) => sum + item.payload.chunks.length, 0), freeSpikeLimits.chunks);
      withinHistoryLimit(references.length, freeSpikeLimits.references);
      withinHistoryLimit(measured.statements, freeSpikeLimits.statements);
      withinHistoryLimit(measured.boundBytes, freeSpikeLimits.boundBytes);
      withinHistoryLimit(measured.wireBytes, freeSpikeLimits.wireBytes);
    }
    return { attemptId, commitId, commit, expectedHead, statements, records: prepared };
  } catch (error) {
    if (error instanceof SermonHistoryWriteError || error instanceof HistoryResourceLimitError) throw error;
    return fail("HISTORY_WRITE_INVALID");
  }
}

function normalizeExpectedRow(row: Record<string, SqlValue>, verified = false): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    verified && key === "verified" ? 1 : value]));
}

function exactRows(actual: unknown[], expected: Record<string, unknown>[]): boolean {
  return actual.length === expected.length && actual.every((row, index) => sameHistoryStoredRow(row, expected[index]!));
}

type Probe = "committed" | "absent" | "conflict" | "mismatch" | "unavailable";

async function probeAttempt(database: D1Database, plan: AppendPlan): Promise<Probe> {
  async function rows(sql: string, values: SqlValue[]): Promise<unknown[]> {
    const result = await database.prepare(sql).bind(...values).all();
    if (!result.success || !Array.isArray(result.results)) throw new Error("probe");
    return result.results;
  }
  try {
    const commits = await rows("SELECT * FROM sermon_history_commits WHERE attempt_id=?", [plan.attemptId]);
    if (commits.length === 0) {
      const heads = await rows("SELECT * FROM sermon_history_heads WHERE sermon_id=?", [String(plan.commit.sermon_id)]);
      if (heads.length > 1) return "mismatch";
      if (!plan.expectedHead) return heads.length === 0 ? "absent" : "conflict";
      if (heads.length === 0) return "mismatch";
      const head = headSchema.safeParse(heads[0]);
      if (!head.success) return "mismatch";
      return sameHistoryValue(head.data, plan.expectedHead) ? "absent" : "conflict";
    }
    const expectedCommit = { ...normalizeExpectedRow(plan.commit), state: "sealed", required_seal_state: "sealed" };
    if (!exactRows(commits, [expectedCommit])) return "mismatch";
    const sermonId = String(plan.commit.sermon_id);
    const version = Number(plan.commit.version);
    const actualRecords = await rows("SELECT * FROM sermon_history_records WHERE sermon_id=? AND commit_version=? ORDER BY commit_slot", [sermonId, version]);
    const expectedRecords = plan.records.map((item) => normalizeExpectedRow(rowRecord(item.record), true));
    if (!exactRows(actualRecords, expectedRecords)) return "mismatch";
    const recordIds = plan.records.map((item) => item.record.envelope.recordId);
    const placeholders = recordIds.map(() => "?").join(",");
    const actualPayloads = await rows(`SELECT * FROM sermon_history_payloads WHERE sermon_id=? AND record_id IN (${placeholders}) ORDER BY record_id`, [sermonId, ...recordIds]);
    const expectedPayloads = plan.records.map((item) => normalizeExpectedRow(rowPayload(item.record, item.payload), true))
      .sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)));
    if (!exactRows(actualPayloads, expectedPayloads)) return "mismatch";
    // Keep exact own-attempt proof, but never expand the entire delta BLOB into
    // two multi-million-element number arrays at once.
    for (const item of plan.records) {
      const recordId = item.record.envelope.recordId;
      let cursor = -1, seen = 0;
      for (;;) {
        const actual = await rows(`SELECT * FROM sermon_history_chunks WHERE sermon_id=? AND record_id=?
          AND chunk_index>? ORDER BY chunk_index LIMIT 4`, [sermonId, recordId, cursor]);
        if (actual.length > 4) return "mismatch";
        const expected = item.payload.chunks.slice(seen, seen + 4).map((chunk) => normalizeExpectedRow({
          sermon_id: sermonId, record_id: recordId, chunk_index: chunk.chunkIndex,
          byte_length: chunk.byteLength, chunk_sha256: chunk.chunkSha256,
          body: chunk.body.buffer as ArrayBuffer, verified: 0,
        }, true));
        if (!exactRows(actual, expected)) return "mismatch";
        seen += actual.length; cursor = seen - 1;
        if (actual.length < 4) break;
      }
      if (seen !== item.payload.chunks.length) return "mismatch";
    }
    const actualReferences = await rows(`SELECT * FROM sermon_history_references WHERE sermon_id=? AND owner_record_id IN (${placeholders}) ORDER BY owner_record_id,reference_position`, [sermonId, ...recordIds]);
    const expectedReferences = plan.records.flatMap((item) => item.references.map((reference) =>
      normalizeExpectedRow(rowReference(reference), true)))
      .sort((a, b) => String(a.owner_record_id).localeCompare(String(b.owner_record_id)) ||
        Number(a.reference_position) - Number(b.reference_position));
    return exactRows(actualReferences, expectedReferences) ? "committed" : "mismatch";
  } catch {
    return "unavailable";
  }
}

/** Six-query, record-independent own-attempt proof for the P5-26 spike. */
async function probeAttemptPacked(database: D1Database, plan: AppendPlan): Promise<Probe> {
  const sermonId = String(plan.commit.sermon_id);
  const statements = [
    database.prepare("SELECT * FROM sermon_history_commits WHERE attempt_id=?").bind(plan.attemptId),
    database.prepare("SELECT * FROM sermon_history_heads WHERE sermon_id=?").bind(sermonId),
    database.prepare(`SELECT r.* FROM sermon_history_records r JOIN sermon_history_commits c
      ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE c.attempt_id=? ORDER BY r.commit_slot`).bind(plan.attemptId),
    database.prepare(`SELECT p.* FROM sermon_history_payloads p JOIN sermon_history_records r
      ON r.sermon_id=p.sermon_id AND r.record_id=p.record_id JOIN sermon_history_commits c
      ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE c.attempt_id=? ORDER BY p.record_id`).bind(plan.attemptId),
    database.prepare(`SELECT k.* FROM sermon_history_chunks k JOIN sermon_history_records r
      ON r.sermon_id=k.sermon_id AND r.record_id=k.record_id JOIN sermon_history_commits c
      ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE c.attempt_id=? ORDER BY k.record_id,k.chunk_index`).bind(plan.attemptId),
    database.prepare(`SELECT f.* FROM sermon_history_references f JOIN sermon_history_records r
      ON r.sermon_id=f.sermon_id AND r.record_id=f.owner_record_id JOIN sermon_history_commits c
      ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE c.attempt_id=? ORDER BY f.owner_record_id,f.reference_position`).bind(plan.attemptId),
  ];
  try {
    const results = await database.batch(statements);
    if (results.length !== 6 || results.some((result) => !result.success || !Array.isArray(result.results))) return "unavailable";
    const [commits, heads, records, payloads, chunks, references] = results.map((result) => result.results);
    if (commits!.length === 0) {
      if (heads!.length > 1) return "mismatch";
      if (!plan.expectedHead) return heads!.length === 0 ? "absent" : "conflict";
      if (heads!.length === 0) return "mismatch";
      const head = headSchema.safeParse(heads![0]);
      if (!head.success) return "mismatch";
      return sameHistoryValue(head.data, plan.expectedHead) ? "absent" : "conflict";
    }
    const expectedCommit = { ...normalizeExpectedRow(plan.commit), state: "sealed", required_seal_state: "sealed" };
    if (!exactRows(commits!, [expectedCommit])) return "mismatch";
    const expectedRecords = plan.records.map((item) => normalizeExpectedRow(rowRecord(item.record), true));
    if (!exactRows(records!, expectedRecords)) return "mismatch";
    const expectedPayloads = plan.records.map((item) => normalizeExpectedRow(rowPayload(item.record, item.payload), true))
      .sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)));
    if (!exactRows(payloads!, expectedPayloads)) return "mismatch";
    const expectedChunks = plan.records.flatMap((item) => item.payload.chunks.map((chunk) => normalizeExpectedRow({
      sermon_id: sermonId,
      record_id: item.record.envelope.recordId,
      chunk_index: chunk.chunkIndex,
      byte_length: chunk.byteLength,
      chunk_sha256: chunk.chunkSha256,
      body: chunk.body.buffer as ArrayBuffer,
      verified: 0,
    }, true))).sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)) ||
      Number(a.chunk_index) - Number(b.chunk_index));
    if (!exactRows(chunks!, expectedChunks)) return "mismatch";
    const expectedReferences = plan.records.flatMap((item) => item.references.map((reference) =>
      normalizeExpectedRow(rowReference(reference), true)))
      .sort((a, b) => String(a.owner_record_id).localeCompare(String(b.owner_record_id)) ||
        Number(a.reference_position) - Number(b.reference_position));
    return exactRows(references!, expectedReferences) ? "committed" : "mismatch";
  } catch {
    return "unavailable";
  }
}

function resultChanges(result: unknown): number | null {
  if (!result || typeof result !== "object" || Reflect.get(result, "success") !== true) return null;
  const meta = Reflect.get(result, "meta");
  if (!meta || typeof meta !== "object") return null;
  const changes = Reflect.get(meta, "changes");
  return typeof changes === "number" && Number.isSafeInteger(changes) && changes >= 0 ? changes : null;
}

async function readHead(database: D1Database, sermonId: string): Promise<StoredHead | null> {
  try {
    const result = await database.prepare("SELECT * FROM sermon_history_heads WHERE sermon_id=?").bind(sermonId).all();
    if (!result.success || result.results.length > 1) return fail("HISTORY_WRITE_UNAVAILABLE");
    if (!result.results.length) return null;
    const parsed = headSchema.safeParse(result.results[0]);
    if (!parsed.success || parsed.data.sermon_id !== sermonId) return fail("HISTORY_WRITE_CORRUPT");
    return parsed.data;
  } catch (error) {
    if (error instanceof SermonHistoryWriteError || error instanceof HistoryResourceLimitError) throw error;
    return fail("HISTORY_WRITE_UNAVAILABLE");
  }
}

async function readEnvelopes(database: D1Database, sermonId: string, version: number): Promise<z.infer<typeof storedEnvelopeSchema>[]> {
  const result: z.infer<typeof storedEnvelopeSchema>[] = [];
  let commit = 0;
  let slot = -1;
  try {
    for (;;) {
      const page = await database.prepare(`SELECT sermon_id,record_id,stream,stream_position,commit_version,commit_slot,source_revision,difficulty,verified
        FROM sermon_history_records WHERE sermon_id=? AND commit_version<=? AND (commit_version>? OR (commit_version=? AND commit_slot>?))
        ORDER BY commit_version,commit_slot LIMIT 64`).bind(sermonId, version, commit, commit, slot).all();
      if (!page.success || !Array.isArray(page.results) || page.results.length > 64) fail("HISTORY_WRITE_UNAVAILABLE");
      for (const raw of page.results) {
        const parsed = storedEnvelopeSchema.safeParse(raw);
        if (!parsed.success || parsed.data.sermon_id !== sermonId || parsed.data.commit_version > version ||
          parsed.data.commit_version < commit || (parsed.data.commit_version === commit && parsed.data.commit_slot <= slot)) {
          fail("HISTORY_WRITE_CORRUPT");
        }
        withinHistoryLimit(result.length + 1, limits.records);
        result.push(parsed.data);
        commit = parsed.data.commit_version;
        slot = parsed.data.commit_slot;
      }
      if (page.results.length < 64) return result;
    }
  } catch (error) {
    if (error instanceof SermonHistoryWriteError || error instanceof HistoryResourceLimitError) throw error;
    return fail("HISTORY_WRITE_UNAVAILABLE");
  }
}

async function resolveBatchOutcome(database: D1Database, plan: AppendPlan, results: unknown[] | null,
  packedMetrics: SermonHistoryOperationMetrics | null = null): Promise<boolean> {
  // Array.from visits missing slots too: an incomplete response must never be
  // treated as success just because Array.every skips sparse array entries.
  const changes = Array.isArray(results) ? Array.from(results, resultChanges) : null;
  const expected = changes !== null && changes.length === plan.statements.length && changes.every((value) => value !== null)
    ? changes as number[]
    : null;
  const cleanSuccess = expected?.every((value, index) => value === plan.statements[index]!.expectedChanges) ?? false;
  // D-031: the atomic batch has already checked the original bound values and
  // sealed the complete write. A complete, exact success needs no body readback.
  // Missing/malformed results still require the original own-attempt proof.
  if (cleanSuccess) return true;
  const cleanConflict = expected?.every((value) => value === 0) ?? false;
  if (packedMetrics) packedMetrics.probeQueries += 6;
  const probe = packedMetrics ? await probeAttemptPacked(database, plan) : await probeAttempt(database, plan);
  if (probe === "committed") return true;
  if (probe === "conflict" && (cleanConflict || results === null)) return false;
  if (probe === "absent") return fail("HISTORY_WRITE_FAILED");
  if (probe === "unavailable") return fail("HISTORY_WRITE_UNCERTAIN");
  return fail("HISTORY_WRITE_FAILED");
}

/** Private append-only D1 store. It is not connected to routes, Workflow, providers, or publication. */
export function createSermonHistoryStore(database: D1Database): TranscriptRevisionStore {
  const reader = createSermonHistoryReader(database);
  return {
    read: reader.read,
    async compareAndSwap(sermonId: string, expectedVersion: number | null, next: PrivateTranscriptState): Promise<boolean> {
      if (!idSchema.safeParse(sermonId).success ||
        (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1))) {
        return fail("HISTORY_WRITE_INVALID");
      }
      const snapshot = await parseExactNext(next, sermonId);
      freeze(snapshot);
      let current: TranscriptState | null;
      try {
        current = structuredClone(await reader.read(sermonId)) as TranscriptState | null;
      } catch (error) {
        if (error instanceof HistoryResourceLimitError) throw error;
        if (error instanceof SermonHistoryReadError && error.code === "HISTORY_READ_CHANGED") return false;
        if (error instanceof SermonHistoryReadError && error.code === "HISTORY_READ_CORRUPT") {
          return fail("HISTORY_WRITE_CORRUPT");
        }
        return fail("HISTORY_WRITE_UNAVAILABLE");
      }
      if (expectedVersion !== (current?.version ?? null)) return false;
      const command = validateDelta(current, snapshot, expectedVersion);
      const head = await readHead(database, sermonId);
      if ((head?.version ?? null) !== expectedVersion || (head === null) !== (expectedVersion === null)) return false;
      if (head && (head.current_source_id !== current?.currentSourceId || head.current_revision_id !== current.currentRevisionId ||
        head.current_confirmation_id !== current.currentConfirmationId)) return fail("HISTORY_WRITE_CORRUPT");
      const envelopes = await readEnvelopes(database, sermonId, expectedVersion ?? 0);
      const plan = await preparePlan(current, snapshot, head, envelopes, command);
      let statements: D1PreparedStatement[];
      try {
        statements = plan.statements.map((statement) => database.prepare(statement.sql).bind(...statement.values));
      } catch {
        return fail("HISTORY_WRITE_UNAVAILABLE");
      }
      try {
        const results = await database.batch(statements);
        return resolveBatchOutcome(database, plan, results);
      } catch {
        return resolveBatchOutcome(database, plan, null);
      }
    },
  };
}

/** P5-26 schema-less local spike. The supplied seed must come from the packed
 * storage reader in the same invocation. It is single-read/single-CAS and is
 * intentionally not wired to a route, Workflow, or the content Worker. */
export function createSermonHistoryOperationStore(
  database: D1Database,
  seed: SermonHistoryOperationSeed,
  metrics: SermonHistoryOperationMetrics,
): TranscriptRevisionStore {
  if (!idSchema.safeParse(seed.sermonId).success) fail("HISTORY_WRITE_INVALID");
  const parsedCurrent = seed.current === null ? null : privateTranscriptStateSchema.safeParse(seed.current);
  if (parsedCurrent !== null && (!parsedCurrent.success || !sameHistoryValue(seed.current, parsedCurrent.data) ||
    parsedCurrent.data.sermonId !== seed.sermonId)) fail("HISTORY_WRITE_CORRUPT");
  const current = parsedCurrent === null ? null : structuredClone(parsedCurrent.data) as TranscriptState;
  const parsedHead = seed.head === null ? null : headSchema.safeParse(seed.head);
  if (parsedHead !== null && (!parsedHead.success || parsedHead.data.sermon_id !== seed.sermonId)) fail("HISTORY_WRITE_CORRUPT");
  const head = parsedHead === null ? null : parsedHead.data;
  const envelopes = seed.envelopes.map((raw) => {
    const parsed = storedEnvelopeSchema.safeParse(raw);
    if (!parsed.success || parsed.data.sermon_id !== seed.sermonId) return fail("HISTORY_WRITE_CORRUPT");
    return parsed.data;
  });
  if ((current === null) !== (head === null) || (head?.version ?? null) !== (current?.version ?? null) ||
    (head && (head.current_source_id !== current!.currentSourceId || head.current_revision_id !== current!.currentRevisionId ||
      head.current_confirmation_id !== current!.currentConfirmationId))) fail("HISTORY_WRITE_CORRUPT");
  freeze(current);
  let read = false;
  let consumed = false;
  return {
    async read(sermonId: string) {
      if (sermonId !== seed.sermonId || read || consumed) return fail("HISTORY_WRITE_INVALID");
      read = true;
      metrics.operationReads++;
      return current;
    },
    async compareAndSwap(sermonId: string, expectedVersion: number | null, next: PrivateTranscriptState) {
      if (sermonId !== seed.sermonId || !read || consumed ||
        (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1))) {
        return fail("HISTORY_WRITE_INVALID");
      }
      consumed = true;
      try { preflightHistoryState(next); } catch (error) {
        if (error instanceof HistoryResourceLimitError) throw error;
        return fail("HISTORY_WRITE_INVALID");
      }
      const parsedNext = privateTranscriptStateSchema.safeParse(next);
      if (!parsedNext.success || !sameHistoryValue(next, parsedNext.data) || parsedNext.data.sermonId !== sermonId) {
        return fail("HISTORY_WRITE_INVALID");
      }
      const snapshot = structuredClone(parsedNext.data) as TranscriptState;
      freeze(snapshot);
      if (expectedVersion !== (current?.version ?? null)) return false;
      const command = validateDelta(current, snapshot, expectedVersion);
      const plan = await preparePlan(current, snapshot, head, envelopes, command, "grouped-free-spike");
      metrics.mutationStatements = plan.statements.length;
      let statements: D1PreparedStatement[];
      try {
        statements = plan.statements.map((statement) => database.prepare(statement.sql).bind(...statement.values));
      } catch {
        return fail("HISTORY_WRITE_UNAVAILABLE");
      }
      try {
        const results = await database.batch(statements);
        return resolveBatchOutcome(database, plan, results, metrics);
      } catch {
        return resolveBatchOutcome(database, plan, null, metrics);
      }
    },
  };
}
