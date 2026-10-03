import type { PrivateTranscriptState } from "../services/transcript-revision-contract";
import { createTranscriptRevisionService } from "../services/transcript-revisions";
import {
  historyResourceLimits as limits,
  withinHistoryLimit,
} from "../storage/history-resource-limits";
import {
  createSermonHistoryStorageReader,
  SermonHistoryReadError,
} from "./sermon-history-reader";
import {
  createSermonHistoryOperationStore,
  type SermonHistoryOperationMetrics,
  type SermonHistoryOperationSeed,
} from "./sermon-history-writer";

const packedReadQueries = 7;
const keyPattern = /^[A-Za-z0-9_-]{1,128}$/u;

type Row = Record<string, unknown>;

export type PackedHistorySnapshot = {
  seed: SermonHistoryOperationSeed;
  metrics: SermonHistoryOperationMetrics;
};

const metaSql = `WITH requested(id) AS (VALUES (?)) SELECT
  requested.id AS requested_sermon_id,
  EXISTS(SELECT 1 FROM sermons s WHERE s.id=requested.id) AS sermon_exists,
  (EXISTS(SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id=requested.id)
    OR EXISTS(SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=requested.id)
    OR EXISTS(SELECT 1 FROM sermon_history_references f WHERE f.sermon_id=requested.id)
    OR EXISTS(SELECT 1 FROM sermon_history_payloads p WHERE p.sermon_id=requested.id)
    OR EXISTS(SELECT 1 FROM sermon_history_chunks k WHERE k.sermon_id=requested.id)) AS has_history,
  (EXISTS(SELECT 1 FROM sermon_history_commits c LEFT JOIN sermon_history_heads h ON h.sermon_id=c.sermon_id
      WHERE c.sermon_id=requested.id AND (c.state<>'sealed' OR h.sermon_id IS NULL OR c.version>h.version))
    OR EXISTS(SELECT 1 FROM sermon_history_records r LEFT JOIN sermon_history_commits c
      ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE r.sermon_id=requested.id AND c.version IS NULL)
    OR EXISTS(SELECT 1 FROM sermon_history_payloads p LEFT JOIN sermon_history_records r
      ON r.sermon_id=p.sermon_id AND r.record_id=p.record_id WHERE p.sermon_id=requested.id AND r.record_id IS NULL)
    OR EXISTS(SELECT 1 FROM sermon_history_chunks k LEFT JOIN sermon_history_payloads p
      ON p.sermon_id=k.sermon_id AND p.record_id=k.record_id WHERE k.sermon_id=requested.id AND p.record_id IS NULL)
    OR EXISTS(SELECT 1 FROM sermon_history_references f LEFT JOIN sermon_history_records o
      ON o.sermon_id=f.sermon_id AND o.record_id=f.owner_record_id LEFT JOIN sermon_history_records t
      ON t.sermon_id=f.sermon_id AND t.record_id=f.target_record_id
      WHERE f.sermon_id=requested.id AND (o.record_id IS NULL OR t.record_id IS NULL))) AS invalid,
  (SELECT h.sermon_id FROM sermon_history_heads h WHERE h.sermon_id=requested.id) AS h_sermon_id,
  (SELECT h.version FROM sermon_history_heads h WHERE h.sermon_id=requested.id) AS h_version,
  (SELECT h.commit_id FROM sermon_history_heads h WHERE h.sermon_id=requested.id) AS h_commit_id,
  (SELECT h.current_source_id FROM sermon_history_heads h WHERE h.sermon_id=requested.id) AS h_current_source_id,
  (SELECT h.current_revision_id FROM sermon_history_heads h WHERE h.sermon_id=requested.id) AS h_current_revision_id,
  (SELECT h.current_confirmation_id FROM sermon_history_heads h WHERE h.sermon_id=requested.id) AS h_current_confirmation_id,
  (SELECT h.storage_format_version FROM sermon_history_heads h WHERE h.sermon_id=requested.id) AS h_storage_format_version,
  (SELECT h.contract_version FROM sermon_history_heads h WHERE h.sermon_id=requested.id) AS h_contract_version,
  COALESCE((SELECT SUM(c.record_count) FROM sermon_history_commits c JOIN sermon_history_heads h
    ON h.sermon_id=c.sermon_id WHERE c.sermon_id=requested.id AND c.version<=h.version),0) AS total_records,
  COALESCE((SELECT SUM(c.byte_length) FROM sermon_history_commits c JOIN sermon_history_heads h
    ON h.sermon_id=c.sermon_id WHERE c.sermon_id=requested.id AND c.version<=h.version),0) AS total_bytes,
  COALESCE((SELECT SUM(c.chunk_count) FROM sermon_history_commits c JOIN sermon_history_heads h
    ON h.sermon_id=c.sermon_id WHERE c.sermon_id=requested.id AND c.version<=h.version),0) AS total_chunks,
  COALESCE((SELECT SUM(c.reference_count) FROM sermon_history_commits c JOIN sermon_history_heads h
    ON h.sermon_id=c.sermon_id WHERE c.sermon_id=requested.id AND c.version<=h.version),0) AS total_refs
  FROM requested`;

const packedDataSql = [
  `WITH requested(id) AS (VALUES (?)) SELECT c.* FROM sermon_history_commits c
    JOIN sermon_history_heads h ON h.sermon_id=c.sermon_id JOIN requested ON requested.id=c.sermon_id
    WHERE c.version<=h.version ORDER BY c.version LIMIT ${limits.commits + 1}`,
  `WITH requested(id) AS (VALUES (?)) SELECT r.* FROM sermon_history_records r
    JOIN sermon_history_heads h ON h.sermon_id=r.sermon_id JOIN requested ON requested.id=r.sermon_id
    WHERE r.commit_version<=h.version ORDER BY r.commit_version,r.commit_slot LIMIT ${limits.records + 1}`,
  `WITH requested(id) AS (VALUES (?)) SELECT p.* FROM sermon_history_payloads p
    JOIN sermon_history_records r ON r.sermon_id=p.sermon_id AND r.record_id=p.record_id
    JOIN sermon_history_heads h ON h.sermon_id=r.sermon_id JOIN requested ON requested.id=r.sermon_id
    WHERE r.commit_version<=h.version ORDER BY p.record_id LIMIT ${limits.records + 1}`,
  `WITH requested(id) AS (VALUES (?)) SELECT k.* FROM sermon_history_chunks k
    JOIN sermon_history_records r ON r.sermon_id=k.sermon_id AND r.record_id=k.record_id
    JOIN sermon_history_heads h ON h.sermon_id=r.sermon_id JOIN requested ON requested.id=r.sermon_id
    WHERE r.commit_version<=h.version ORDER BY k.record_id,k.chunk_index LIMIT ${limits.chunks + 1}`,
  `WITH requested(id) AS (VALUES (?)) SELECT f.* FROM sermon_history_references f
    JOIN sermon_history_records r ON r.sermon_id=f.sermon_id AND r.record_id=f.owner_record_id
    JOIN sermon_history_heads h ON h.sermon_id=r.sermon_id JOIN requested ON requested.id=r.sermon_id
    WHERE r.commit_version<=h.version ORDER BY f.owner_record_id,f.reference_position LIMIT ${limits.references + 1}`,
  "SELECT * FROM sermon_history_heads WHERE sermon_id=?",
] as const;

function unavailable(): never {
  throw new SermonHistoryReadError("HISTORY_READ_UNAVAILABLE");
}

function corrupt(): never {
  throw new SermonHistoryReadError("HISTORY_READ_CORRUPT");
}

function headFromMeta(meta: Row): Row | null {
  if (meta.h_sermon_id === null) return null;
  return {
    sermon_id: meta.h_sermon_id,
    version: meta.h_version,
    commit_id: meta.h_commit_id,
    current_source_id: meta.h_current_source_id,
    current_revision_id: meta.h_current_revision_id,
    current_confirmation_id: meta.h_current_confirmation_id,
    storage_format_version: meta.h_storage_format_version,
    contract_version: meta.h_contract_version,
  };
}

function cachedPackedDatabase(meta: Row, h0: Row | null, h1: Row | null, packed: Row[][]): D1Database {
  const [commits, records, payloads, chunks, references] = packed;
  let headReads = 0;
  function page(rows: Row[], after: number, limit: number, key: (row: Row) => number): Row[] {
    return rows.filter((row) => key(row) > after).slice(0, limit);
  }
  function result(sql: string, values: unknown[]): Row[] {
    if (sql.startsWith("SELECT * FROM sermon_history_heads")) return headReads++ === 0 ? (h0 ? [h0] : []) : (h1 ? [h1] : []);
    if (sql.startsWith("SELECT SUM(record_count)")) return [{
      records: meta.total_records,
      bytes: meta.total_bytes,
      chunks: meta.total_chunks,
      refs: meta.total_refs,
    }];
    if (sql.includes("AS sermon_exists")) return [{
      sermon_exists: meta.sermon_exists,
      has_history: meta.has_history,
      invalid: meta.invalid,
    }];
    if (sql.startsWith("SELECT * FROM sermon_history_commits")) {
      const ceiling = Number(values[1]);
      return page(commits!.filter((row) => Number(row.version) <= ceiling), Number(values[2]), Number(values[3]),
        (row) => Number(row.version));
    }
    if (sql.startsWith("SELECT * FROM sermon_history_records")) {
      return records!.filter((row) => Number(row.commit_version) === Number(values[1])).slice(0, 3);
    }
    if (sql.startsWith("SELECT * FROM sermon_history_payloads")) {
      return payloads!.filter((row) => row.record_id === values[1]);
    }
    if (sql.startsWith("SELECT * FROM sermon_history_chunks")) {
      return page(chunks!.filter((row) => row.record_id === values[1]), Number(values[2]), Number(values[3]),
        (row) => Number(row.chunk_index));
    }
    if (sql.startsWith("SELECT * FROM sermon_history_references")) {
      return page(references!.filter((row) => row.owner_record_id === values[1]), Number(values[2]), Number(values[3]),
        (row) => Number(row.reference_position));
    }
    return unavailable();
  }
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...bound: unknown[]) { values = bound; return statement; },
        // Private read-only view, never exposed as state. The reader parses row
        // metadata and copies validated BLOB bytes before decode/hash; duplicating
        // all numeric BLOB arrays here adds no ownership protection to that state.
        async all() { return { success: true, results: result(sql, values) }; },
      };
      return statement;
    },
  } as unknown as D1Database;
}

/** Fetch all bounded physical rows in seven statements, then run the existing
 * P5-22 storage/codec/reference validator over an in-memory query view. */
export async function readPackedHistorySnapshot(database: D1Database, sermonId: string): Promise<PackedHistorySnapshot> {
  if (!keyPattern.test(sermonId)) throw new SermonHistoryReadError("HISTORY_READ_INVALID");
  let metaResults: D1Result<unknown>[];
  try {
    metaResults = await database.batch([database.prepare(metaSql).bind(sermonId)]);
  } catch {
    return unavailable();
  }
  const metaResult = metaResults[0];
  if (metaResults.length !== 1 || !metaResult || !metaResult.success ||
    !Array.isArray(metaResult.results) || metaResult.results.length !== 1) {
    return unavailable();
  }
  const meta = metaResult.results[0] as Row;
  if (meta.requested_sermon_id !== sermonId) return corrupt();
  const h0 = headFromMeta(meta);
  if (h0) {
    withinHistoryLimit(Number(meta.h_version), limits.commits);
    withinHistoryLimit(Number(meta.total_records), limits.records);
    withinHistoryLimit(Number(meta.total_bytes), limits.payloadBytes);
    withinHistoryLimit(Number(meta.total_chunks), limits.chunks);
    withinHistoryLimit(Number(meta.total_refs), limits.references);
  }
  let dataResults: D1Result<unknown>[];
  try {
    dataResults = await database.batch(packedDataSql.map((sql) => database.prepare(sql).bind(sermonId)));
  } catch {
    return unavailable();
  }
  if (dataResults.length !== packedReadQueries - 1 ||
    dataResults.some((result) => !result.success || !Array.isArray(result.results))) return unavailable();
  const rows = dataResults.map((result) => result.results as Row[]);
  if (rows[5]!.length > 1) return corrupt();
  withinHistoryLimit(rows[0]!.length, limits.commits);
  withinHistoryLimit(rows[1]!.length, limits.records);
  withinHistoryLimit(rows[2]!.length, limits.records);
  withinHistoryLimit(rows[3]!.length, limits.chunks);
  withinHistoryLimit(rows[4]!.length, limits.references);
  const h1 = rows[5]![0] ?? null;
  const cache = cachedPackedDatabase(meta, h0, h1, rows.slice(0, 5));
  const current = await createSermonHistoryStorageReader(cache).read(sermonId);
  const metrics: SermonHistoryOperationMetrics = {
    readQueries: packedReadQueries,
    mutationStatements: 0,
    probeQueries: 0,
    operationReads: 0,
  };
  return {
    seed: { sermonId, current, head: h0, envelopes: rows[1]! },
    metrics,
  };
}

/** Opaque same-invocation coordinator used only by the local P5-26 tests. */
export async function openPackedHistoryOperation(database: D1Database, sermonId: string) {
  const snapshot = await readPackedHistorySnapshot(database, sermonId);
  const store = createSermonHistoryOperationStore(database, snapshot.seed, snapshot.metrics);
  const service = createTranscriptRevisionService(store);
  return Object.freeze({
    execute(command: unknown, humanContext: unknown) {
      return service.execute(sermonId, command, humanContext);
    },
    metrics: snapshot.metrics,
  });
}

export type PackedHistoryOperation = Awaited<ReturnType<typeof openPackedHistoryOperation>>;
export type PackedHistoryState = PrivateTranscriptState;
