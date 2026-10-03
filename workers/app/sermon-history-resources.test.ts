import { describe, expect, it } from "vitest";
import { createDatabase } from "../_shared/db/client";
import { createSermonHistoryReader } from "../_shared/repositories/sermon-history-reader";
import { createSermonHistoryStore } from "../_shared/repositories/sermon-history-writer";
import { validateTranscriptState } from "../_shared/services/transcript-revisions";
import { historyStreams } from "../_shared/storage/history-record";
import { HistoryResourceLimitError, historyJsonBytes, historyResourceLimits as limits, measureHistoryBatch,
  preflightHistoryState, withinHistoryLimit } from "../_shared/storage/history-resource-limits";
import { historyFixture, historyHarness, historyHead, historySource } from "./test/sermon-history-codec-fixture";
import { observeHistoryReads, seedReadHistory } from "./test/sermon-history-read-fixture";
import { historyDb, historySnapshot } from "./test/sermon-history-structure-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";

async function confirmations(count: number, text = "TEST_ONLY_RESOURCE") {
  const h = historyHarness();
  await h.run({ action: "import_source", expectedVersion: 0, payload: await historySource(false, text) });
  while (h.state().version < count) await h.run({ action: "confirm", ...historyHead(h.state()), reviewed: true });
  return h;
}
function observed(loseResponse = false) {
  const stats = { queries: 0, readMs: 0, batchMs: 0, probeMs: 0, probeQueries: 0, batches: 0,
    maxChunkRows: 0, batch: { statements: 0, parameters: 0, sqlBytes: 0, rowBytes: 0, boundBytes: 0, wireBytes: 0 } };
  const prepared = new WeakMap<D1PreparedStatement, { sql: string; values: (string | number | null | ArrayBuffer)[] }>();
  let batched = false;
  const db = new Proxy(historyDb, { get(target, key) {
    if (key === "prepare") return (sql: string) => {
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
        get(stmt, prop) {
          if (prop === "bind") return (...bound: unknown[]) => wrap(stmt.bind(...bound));
          if (prop === "all") return async () => {
            const start = performance.now();
            const result = await stmt.all();
            const elapsed = performance.now() - start;
            stats.queries++;
            if (batched) { stats.probeMs += elapsed; stats.probeQueries++; } else stats.readMs += elapsed;
            if (sql.startsWith("SELECT * FROM sermon_history_chunks")) stats.maxChunkRows = Math.max(stats.maxChunkRows, result.results.length);
            return result;
          };
          const value: unknown = Reflect.get(stmt, prop);
          return typeof value === "function" ? value.bind(stmt) : value;
        },
      });
      const statement = target.prepare(sql);
      // Track the bound statement wrappers passed into batch without recording payloads.
      return new Proxy(statement, { get(stmt, prop) {
        if (prop === "bind") return (...values: (string | number | null | ArrayBuffer)[]) => {
          const bound = wrap(stmt.bind(...values));
          prepared.set(bound, { sql, values });
          return bound;
        };
        const value: unknown = Reflect.get(stmt, prop);
        return typeof value === "function" ? value.bind(stmt) : value;
      } });
    };
    if (key === "batch") return async (statements: D1PreparedStatement[]) => {
      stats.batches++;
      stats.batch = measureHistoryBatch(statements.map((s) => prepared.get(s)!));
      const start = performance.now();
      const result = await target.batch(statements);
      stats.batchMs += performance.now() - start; batched = true;
      if (loseResponse) throw new Error("Synthetic committed response loss");
      return result;
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { db, stats };
}
async function fixedLimit(action: Promise<unknown>) {
  await expect(action).rejects.toMatchObject({ code: "HISTORY_RESOURCE_LIMIT", message: "HISTORY_RESOURCE_LIMIT" });
  try { await action; } catch (error) {
    expect(error).toBeInstanceOf(HistoryResourceLimitError);
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).toBe('{"code":"HISTORY_RESOURCE_LIMIT"}');
  }
}

describe("P5-24 finite private resource envelope", () => {
  it.each([null, true, 12.75, "\u0000\b\t\n\r\f\"\\한😀é\ud800", { a: [1, "한글", null], b: false }])(
    "counts exact escaped UTF-8 without allocating full serialized copies: %j", (value) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
      expect(historyJsonBytes(value, bytes)).toBe(bytes);
      expect(() => historyJsonBytes(value, bytes - 1)).toThrow(HistoryResourceLimitError);
    });
  it("rejects cycles/accessors before reading values and bounds depth/nodes", () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    expect(() => preflightHistoryState(cycle)).toThrow();
    let accessed = false;
    expect(() => preflightHistoryState({ get secret() { accessed = true; return "TEST_ONLY"; } })).toThrow();
    expect(accessed).toBe(false);
    let deep: unknown = null;
    for (let i = 0; i < limits.jsonDepth + 1; i++) deep = [deep];
    expect(() => preflightHistoryState(deep)).toThrow(HistoryResourceLimitError);
    expect(() => preflightHistoryState(Array(limits.jsonNodes + 1).fill(null))).toThrow(HistoryResourceLimitError);
  });
  it.each(Object.entries(limits))("accepts exact %s and refuses one over", (_name, limit) => {
    expect(() => withinHistoryLimit(limit, limit)).not.toThrow();
    expect(() => withinHistoryLimit(limit + 1, limit)).toThrow(HistoryResourceLimitError);
  });
  it("checks actual SQL/parameter/row/batch/bound/wire resources before preparation", () => {
    const small = { sql: "SELECT ?", values: [1] };
    expect(measureHistoryBatch(Array(limits.batchStatements).fill(small)).statements).toBe(limits.batchStatements);
    expect(() => measureHistoryBatch(Array(limits.batchStatements + 1).fill(small))).toThrow(HistoryResourceLimitError);
    expect(() => measureHistoryBatch([{ sql: "x".repeat(limits.sqlBytes + 1), values: [] }])).toThrow(HistoryResourceLimitError);
    expect(() => measureHistoryBatch([{ sql: "SELECT 1", values: Array(limits.parameters + 1).fill(1) }])).toThrow(HistoryResourceLimitError);
    expect(() => measureHistoryBatch([{ sql: "SELECT ?", values: [new ArrayBuffer(limits.rowBytes + 1)] }])).toThrow(HistoryResourceLimitError);
    expect(() => measureHistoryBatch(Array(161).fill({ sql: "SELECT ?", values: [new ArrayBuffer(65536)] }))).toThrow(HistoryResourceLimitError);
    expect(() => measureHistoryBatch(Array(140).fill({ sql: "SELECT ?", values: ["\u0000".repeat(65536)] }))).toThrow(HistoryResourceLimitError);
  });
  it("rejects version 65 before a DB read or mutation, preserving all rows", async () => {
    const h = await confirmations(64), sermonId = await seedReadHistory(h);
    const before = await historySnapshot(sermonId), io = observed();
    await h.run({ action: "confirm", ...historyHead(h.state()), reviewed: true });
    await fixedLimit(createSermonHistoryStore(io.db).compareAndSwap(sermonId, 64, { ...h.state(), sermonId }));
    expect(io.stats.queries).toBe(0); expect(io.stats.batches).toBe(0);
    expect(await historySnapshot(sermonId)).toEqual(before);
  }, 30_000);
  it("refuses oversized stored summaries before loading any private BLOB, including writer reads", async () => {
    const h = await confirmations(1), sermonId = await seedReadHistory(h);
    const before = await historySnapshot(sermonId);
    let blobs = 0;
    const db = observeHistoryReads(({ sql, rows }) => {
      if (sql.includes("SUM(record_count)")) rows[0]!.bytes = limits.payloadBytes + 1;
      if (sql.startsWith("SELECT * FROM sermon_history_chunks")) blobs++;
    });
    await fixedLimit(createSermonHistoryReader(db).read(sermonId));
    await h.run({ action: "confirm", ...historyHead(h.state()), reviewed: true });
    await fixedLimit(createSermonHistoryStore(db).compareAndSwap(sermonId, 1, { ...h.state(), sermonId }));
    expect(blobs).toBe(0); expect(await historySnapshot(sermonId)).toEqual(before);
  });
  it("does not trust understated summaries or manifests to permit unbounded chunks", async () => {
    const h = await confirmations(1), sermonId = await seedReadHistory(h);
    const db = observeHistoryReads(({ sql, rows }) => {
      if (sql.startsWith("SELECT * FROM sermon_history_payloads")) rows[0]!.byte_length = limits.payloadBytes + 1;
    });
    await fixedLimit(createSermonHistoryReader(db).read(sermonId));
  });
  it("round-trips the exact 8MiB cumulative byte boundary then rejects the next append", async () => {
    const h = await confirmations(1, '"'.repeat(1_048_576));
    const sermonId = await seedReadHistory(h);
    await h.run({ action: "import_source", expectedVersion: 1,
      payload: await historySource(false, '"'.repeat(1_048_576 - 384)) });
    const bytes = historyStreams.reduce((sum, stream) => sum + h.state()[stream].reduce((n, record) => n + historyJsonBytes(record), 0), 0);
    expect(bytes).toBe(limits.payloadBytes);
    const store = createSermonHistoryStore(historyDb);
    expect(await store.compareAndSwap(sermonId, 1, { ...h.state(), sermonId })).toBe(true);
    expect(await store.read(sermonId)).toEqual({ ...h.state(), sermonId });
    const before = await historySnapshot(sermonId), io = observed();
    await h.run({ action: "confirm", ...historyHead(h.state()), reviewed: true });
    await fixedLimit(createSermonHistoryStore(io.db).compareAndSwap(sermonId, 2, { ...h.state(), sermonId }));
    expect(io.stats.queries).toBe(0); expect(io.stats.batches).toBe(0);
    expect(await historySnapshot(sermonId)).toEqual(before);
  }, 30_000);
  it("refuses a valid cumulative byte overflow with zero DB work and no history truncation", async () => {
    const h = await confirmations(1, '"'.repeat(1_048_576));
    const sermonId = await seedReadHistory(h), before = await historySnapshot(sermonId);
    await h.run({ action: "import_source", expectedVersion: 1, payload: await historySource(false, '"'.repeat(1_048_576)) });
    await validateTranscriptState(h.state(), h.state().sermonId);
    const io = observed();
    await fixedLimit(createSermonHistoryStore(io.db).compareAndSwap(sermonId, 1, { ...h.state(), sermonId }));
    expect(io.stats.queries).toBe(0); expect(io.stats.batches).toBe(0);
    expect(await historySnapshot(sermonId)).toEqual(before);
  }, 30_000);
  it("refuses a domain-valid reference-heavy delta before batch, preserving the exact DB", async () => {
    const raw = "x ".repeat(128), h = await confirmations(1, raw);
    const sermonId = await seedReadHistory(h), before = await historySnapshot(sermonId);
    const s = h.state(), source = s.sources[0]!.payload;
    if (source.sourceMode === "public_unofficial") throw new Error("Synthetic mode");
    await h.run({ action: "propose_corrections", ...historyHead(s), proposal: {
      sourceId: s.currentSourceId, sourceSha256: source.rawTranscriptSha256, baseRevisionId: s.currentRevisionId,
      baseTranscriptSha256: s.revisions[0]!.transcriptSha256,
      items: Array.from({ length: 128 }, (_, i) => ({ id: `item-${i}`, segmentId: null, start: null, duration: null,
        from: i * 2, to: i * 2 + 1, originalText: "x", proposedText: "y", changeType: "spelling",
        reason: "TEST_ONLY_RESOURCE", confidence: 0.5, riskFlags: ["needs_review"],
        contextBefore: raw.slice(Math.max(0, i * 2 - 120), i * 2), contextAfter: raw.slice(i * 2 + 1, i * 2 + 121) })),
    } });
    const io = observed();
    await fixedLimit(createSermonHistoryStore(io.db).compareAndSwap(sermonId, 1, { ...h.state(), sermonId }));
    expect(io.stats.batches).toBe(0); expect(await historySnapshot(sermonId)).toEqual(before);
  }, 15_000);
});

// Finite deterministic counts, three wall-time observations per scenario. No text/IDs/hashes in diagnostics.
describe("P5-24 synthetic read/validation/preparation/batch/probe measurements", () => {
  for (const scenario of [1, 16, 32, 63, "mixed", "large"] as const) {
  it(`measures ${scenario} independently three times`, async ({ task }) => {
    const h = scenario === "mixed" ? await historyFixture(false, true) :
      await confirmations(scenario === "large" ? 1 : scenario, scenario === "large" ? '"'.repeat(1_048_576) : "TEST_ONLY_RESOURCE");
    const samples = [];
    for (let repeat = 0; repeat < 3; repeat++) {
      const sermonId = await seedReadHistory(h), io = observed();
      const readerStart = performance.now();
      const state = await createSermonHistoryReader(io.db).read(sermonId);
      const readMs = performance.now() - readerStart, readQueries = io.stats.queries;
      expect(state).toEqual({ ...h.state(), sermonId });
      const validationStart = performance.now();
      await validateTranscriptState(state, sermonId);
      const validationMs = performance.now() - validationStart;
      const next = structuredClone(h.state());
      const last = next.revisions.at(-1)!;
      next.confirmations.push({ id: crypto.randomUUID(), sourceId: next.currentSourceId, revisionId: next.currentRevisionId,
        transcriptSha256: last.transcriptSha256, confirmedBy: "test-private-actor", confirmedAt: "2026-09-10T00:00:00.000Z" });
      next.currentConfirmationId = next.confirmations.at(-1)!.id; next.version++; next.sermonId = sermonId;
      const writerIo = observed(), writeStart = performance.now();
      expect(await createSermonHistoryStore(writerIo.db).compareAndSwap(sermonId, state!.version, next)).toBe(true);
      const writeMs = performance.now() - writeStart;
      samples.push({ fullReadMs: readMs, readQueries, validationMs, writeMs,
        prepareAndValidateMs: writeMs - writerIo.stats.readMs - writerIo.stats.batchMs - writerIo.stats.probeMs,
        ...writerIo.stats });
      expect(writerIo.stats.batches).toBe(1); expect(writerIo.stats.maxChunkRows).toBeLessThanOrEqual(4);
      expect(writerIo.stats.probeQueries).toBe(0);
    }
    Reflect.set(task.meta, "historyResources", { scenario, commits: h.state().version,
      streams: Object.fromEntries(historyStreams.map((s) => [s, h.state()[s].length])),
      payloadBytes: historyStreams.reduce((sum, s) => sum + h.state()[s].reduce((n, r) => n + historyJsonBytes(r), 0), 0), samples });
  }, 60_000);
  }
  it("measures large import and paged own-attempt proof after response loss three times", async ({ task }) => {
    const h = await confirmations(1, '"'.repeat(1_048_576));
    const samples = [];
    for (let repeat = 0; repeat < 3; repeat++) {
      const sermonId = crypto.randomUUID(); await seedMetadataSermon(createDatabase(historyDb), sermonId);
      const io = observed(true), start = performance.now();
      expect(await createSermonHistoryStore(io.db).compareAndSwap(sermonId, null, { ...h.state(), sermonId })).toBe(true);
      samples.push({ elapsedMs: performance.now() - start, ...io.stats });
      expect(io.stats.batch.statements).toBe(145); expect(io.stats.maxChunkRows).toBe(4);
    }
    Reflect.set(task.meta, "historyResources", { scenario: "large-import-response-loss", samples });
  }, 60_000);
});
