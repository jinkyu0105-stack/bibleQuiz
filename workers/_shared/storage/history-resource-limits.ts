import { historyStreams } from "./history-record";

/** Finite LOCAL adapter envelope, not Free-plan runtime eligibility (see 14.3.8).
 * No caller overrides: source/domain limits, retention and CAS are unchanged. */
export const historyResourceLimits = Object.freeze({
  commits: 64, records: 128, payloadBytes: 8 * 1024 * 1024,
  chunks: 256, references: 2048, readQueries: 768,
  jsonNodes: 100_000, jsonDepth: 64,
  deltaBytes: 4_500_000, batchStatements: 256,
  parameters: 80, sqlBytes: 80_000, rowBytes: 128 * 1024,
  boundBytes: 10 * 1024 * 1024, wireBytes: 40 * 1024 * 1024,
});
export class HistoryResourceLimitError extends Error {
  readonly code = "HISTORY_RESOURCE_LIMIT";
  constructor() { super("HISTORY_RESOURCE_LIMIT"); }
}
export function withinHistoryLimit(value: number, limit: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new HistoryResourceLimitError();
}

/** Count JSON UTF-8 without making a second large string/buffer. Includes escaping.
 * Reject accessors/cycles/non-JSON early; domain schemas still decide validity. */
export function historyJsonBytes(input: unknown, maximum = historyResourceLimits.payloadBytes): number {
  let bytes = 0, nodes = 0;
  const ancestors = new Set<object>();
  function add(n: number) { bytes += n; withinHistoryLimit(bytes, maximum); }
  function string(value: string) {
    add(2);
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c === 34 || c === 92 || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) add(2);
      else if (c < 32) add(6);
      else if (c < 128) add(1);
      else if (c < 2048) add(2);
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length &&
        value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { add(4); i++; }
      else if (c >= 0xd800 && c <= 0xdfff) add(6);
      else add(3);
    }
  }
  function visit(value: unknown, depth: number): void {
    withinHistoryLimit(++nodes, historyResourceLimits.jsonNodes);
    withinHistoryLimit(depth, historyResourceLimits.jsonDepth);
    if (typeof value === "string") return string(value);
    if (value === null) return add(4);
    if (typeof value === "boolean") return add(value ? 4 : 5);
    if (typeof value === "number" && Number.isFinite(value)) return add(String(value).length);
    if (!value || typeof value !== "object" || ancestors.has(value)) throw new TypeError("Invalid history input");
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError("Invalid history input");
    }
    // Bound cardinality before key/descriptor allocation or recursive traversal.
    if (array) withinHistoryLimit(value.length, historyResourceLimits.jsonNodes - nodes);
    ancestors.add(value); add(2);
    let count = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      withinHistoryLimit(++count, historyResourceLimits.jsonNodes);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) throw new TypeError("Invalid history input");
      if (count > 1) add(1);
      if (!array) { string(key); add(1); }
      visit(descriptor.value, depth + 1);
    }
    if (array && count !== value.length) throw new TypeError("Invalid history input");
    ancestors.delete(value);
  }
  visit(input, 0);
  return bytes;
}

/** Before Zod/clone/hash: bound the whole supplied graph and exact record total. */
export function preflightHistoryState(raw: unknown): void {
  historyJsonBytes(raw, historyResourceLimits.payloadBytes + 65_536);
  if (!raw || typeof raw !== "object") return;
  const version: unknown = Reflect.get(raw, "version");
  if (typeof version === "number" && Number.isSafeInteger(version) && version >= 0) {
    withinHistoryLimit(version, historyResourceLimits.commits);
  }
  let records = 0, bytes = 0, chunks = 0;
  for (const stream of historyStreams) {
    const values: unknown = Reflect.get(raw, stream);
    if (!Array.isArray(values)) continue;
    records += values.length; withinHistoryLimit(records, historyResourceLimits.records);
    for (const value of values) {
      const size = historyJsonBytes(value, historyResourceLimits.payloadBytes - bytes);
      bytes += size; chunks += Math.ceil(size / 65_536);
      withinHistoryLimit(chunks, historyResourceLimits.chunks);
    }
  }
}

type SqlValue = string | number | null | ArrayBuffer;
export function measureHistoryBatch(statements: readonly { sql: string; values: readonly SqlValue[] }[]) {
  let boundBytes = 0, wireBytes = 2, sqlBytes = 0, parameters = 0, rowBytes = 0;
  withinHistoryLimit(statements.length, historyResourceLimits.batchStatements);
  for (const statement of statements) {
    const sql = new TextEncoder().encode(statement.sql).byteLength;
    withinHistoryLimit(sql, historyResourceLimits.sqlBytes);
    withinHistoryLimit(statement.values.length, historyResourceLimits.parameters);
    sqlBytes = Math.max(sqlBytes, sql); parameters = Math.max(parameters, statement.values.length);
    let row = 0;
    // Conservative JSON transport envelope and BLOB-as-number-array upper bound.
    wireBytes += 64 + historyJsonBytes(statement.sql, historyResourceLimits.sqlBytes * 6);
    for (const value of statement.values) {
      const size = value instanceof ArrayBuffer ? value.byteLength : typeof value === "string"
        ? new TextEncoder().encode(value).byteLength : 8;
      row += size;
      wireBytes += value instanceof ArrayBuffer ? value.byteLength * 4 + 3 :
        typeof value === "string" ? historyJsonBytes(value, historyResourceLimits.rowBytes * 6) + 1 : 25;
    }
    withinHistoryLimit(row, historyResourceLimits.rowBytes);
    rowBytes = Math.max(rowBytes, row); boundBytes += row;
    withinHistoryLimit(boundBytes, historyResourceLimits.boundBytes);
    withinHistoryLimit(wireBytes, historyResourceLimits.wireBytes);
  }
  return { statements: statements.length, parameters, sqlBytes, rowBytes, boundBytes, wireBytes };
}
