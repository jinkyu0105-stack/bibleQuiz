import { beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../_shared/db/client";
import {
  createSermonHistoryStore,
  SermonHistoryWriteError,
} from "../_shared/repositories/sermon-history-writer";
import type {
  PrivateTranscriptState,
  TranscriptRevisionStore,
  TranscriptState,
} from "../_shared/services/transcript-revision-contract";
import { createTranscriptRevisionService } from "../_shared/services/transcript-revisions";
import { historyStreams, type HistoryRecord, type HistoryStream } from "../_shared/storage/history-record";
import {
  historyFixture,
  historyHarness,
  historyHead,
  historyHuman,
  historySource,
} from "./test/sermon-history-codec-fixture";
import { seedReadHistory } from "./test/sermon-history-read-fixture";
import { historyDb, historySnapshot } from "./test/sermon-history-structure-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";

let complete: Awaited<ReturnType<typeof historyFixture>>;

beforeAll(async () => {
  complete = await historyFixture(false, true);
}, 30_000);

async function sermon() {
  const sermonId = crypto.randomUUID();
  await seedMetadataSermon(createDatabase(historyDb), sermonId);
  return sermonId;
}

function counts(state: TranscriptState): Record<HistoryStream, number> {
  return Object.fromEntries(historyStreams.map((stream) => [stream, state[stream].length])) as Record<HistoryStream, number>;
}

function stateAtVersion(records: readonly HistoryRecord[], version: number, sermonId: string): TranscriptState {
  if (version < 1) throw new Error("Synthetic version must be positive");
  const state: TranscriptState = {
    contractVersion: 1,
    sermonId,
    version,
    sources: [],
    revisions: [],
    confirmations: [],
    correctionProposals: [],
    correctionDecisions: [],
    intentEvents: [],
    summaryEvents: [],
    candidateEvents: [],
    currentSourceId: "",
    currentRevisionId: "",
    currentConfirmationId: null,
  };
  const selected = records.filter((record) => record.envelope.commitVersion <= version)
    .sort((a, b) => a.envelope.commitVersion - b.envelope.commitVersion || a.envelope.commitSlot - b.envelope.commitSlot);
  for (const record of selected) {
    (state[record.envelope.stream] as unknown[]).push(structuredClone(record.payload));
    if (record.envelope.stream === "sources") {
      state.currentSourceId = record.envelope.recordId;
      state.currentConfirmationId = null;
    }
    if (record.envelope.stream === "revisions") {
      state.currentRevisionId = record.envelope.recordId;
      state.currentConfirmationId = null;
    }
    if (record.envelope.stream === "confirmations") state.currentConfirmationId = record.envelope.recordId;
  }
  return state;
}

async function seedPrefix(version: number, sermonId: string): Promise<TranscriptState | null> {
  if (version === 0) {
    await seedMetadataSermon(createDatabase(historyDb), sermonId);
    return null;
  }
  const state = stateAtVersion(complete.records, version, sermonId);
  const records = complete.records.filter((record) => record.envelope.commitVersion <= version);
  const seed = {
    records,
    state: () => state,
    scope: () => ({ sermonId, version, counts: counts(state) }),
  } as unknown as Parameters<typeof seedReadHistory>[0];
  await seedReadHistory(seed, sermonId);
  return state;
}

function remapDelta(current: TranscriptState | null, next: TranscriptState): TranscriptState {
  const clone = structuredClone(next);
  const replacements = new Map<string, string>();
  for (const stream of historyStreams) {
    const start = current?.[stream].length ?? 0;
    for (const payload of clone[stream].slice(start)) replacements.set(payload.id, crypto.randomUUID());
  }
  function replace(value: unknown): unknown {
    if (typeof value === "string") return replacements.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
    }
    return value;
  }
  return replace(clone) as TranscriptState;
}

function deltaIds(current: TranscriptState | null, next: TranscriptState): string[] {
  return historyStreams.flatMap((stream) => next[stream].slice(current?.[stream].length ?? 0).map((value) => value.id));
}

function versionFor(stream: HistoryStream, predicate: (record: HistoryRecord) => boolean = () => true): number {
  const record = complete.records.find((item) => item.envelope.stream === stream && predicate(item));
  if (!record) throw new Error(`Synthetic ${stream} version missing`);
  return record.envelope.commitVersion;
}

async function oneImport(sermonId: string, text = "TEST_ONLY_WRITER") {
  const h = historyHarness();
  await h.run({ action: "import_source", expectedVersion: 0, payload: await historySource(false, text) });
  return { ...h.state(), sermonId } as TranscriptState;
}

function mutateDatabase(
  match: (sql: string) => boolean,
  mode: "zero" | "sql" | "chunk-bound",
): D1Database {
  let changed = false;
  return new Proxy(historyDb, {
    get(target, key) {
      if (key !== "prepare") {
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (sql: string) => {
        if (changed || !match(sql)) return target.prepare(sql);
        changed = true;
        if (mode === "zero") return target.prepare(`${sql} AND 0`);
        if (mode === "chunk-bound") {
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(boundTarget, property) {
              if (property === "bind") return (...values: unknown[]) => {
                const modified = [...values];
                const bodyIndex = modified.findIndex((value) => value instanceof ArrayBuffer);
                if (bodyIndex < 0) throw new Error("Synthetic BLOB binding missing");
                const body = new Uint8Array(modified[bodyIndex] as ArrayBuffer).slice();
                body[0] = body[0] === 0 ? 1 : 0;
                modified[bodyIndex] = body.buffer;
                return boundTarget.bind(...modified);
              };
              const value: unknown = Reflect.get(boundTarget, property);
              return typeof value === "function" ? value.bind(boundTarget) : value;
            },
          });
        }
        if (sql.startsWith("INSERT INTO sermon_history_heads")) {
          return target.prepare(sql.replace("SELECT ?,?,?,?,?,?,1,1 WHERE", "SELECT ?,?,?,?,?,?,1,2 WHERE"));
        }
        if (sql.startsWith("UPDATE sermon_history_commits SET state='sealed'")) {
          return target.prepare(sql.replace("SET state='sealed'", "SET state='broken'"));
        }
        if (sql.includes(" SET verified=1 ")) {
          return target.prepare(sql.replace(" SET verified=1 ", " SET verified=2 "));
        }
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get(boundTarget, property) {
            if (property === "bind") return (...values: unknown[]) => {
              const modified = [...values];
              modified[modified.length - 4] = 2;
              return boundTarget.bind(...modified);
            };
            const value: unknown = Reflect.get(boundTarget, property);
            return typeof value === "function" ? value.bind(boundTarget) : value;
          },
        });
      };
    },
  });
}

function losingResponseDatabase(afterCommit?: () => Promise<void>, blind = false): D1Database {
  let lost = false;
  return new Proxy(historyDb, {
    get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        if (blind) {
          lost = true;
          throw new Error("Synthetic response unavailable before execution");
        }
        await target.batch(statements);
        if (afterCommit) await afterCommit();
        lost = true;
        throw new Error("Synthetic committed response loss");
      };
      if (key === "prepare" && lost && blind) return () => { throw new Error("Synthetic probe unavailable"); };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function measuredDatabase(measurements: { sqlBytes: number; parameters: number }[][]): D1Database {
  const prepared = new WeakMap<D1PreparedStatement, { sqlBytes: number; parameters: number }>();
  return new Proxy(historyDb, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => {
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get(boundTarget, property) {
            if (property === "bind") return (...values: unknown[]) => {
              const bound = boundTarget.bind(...values);
              prepared.set(bound, { sqlBytes: new TextEncoder().encode(sql).byteLength, parameters: values.length });
              return bound;
            };
            const value: unknown = Reflect.get(boundTarget, property);
            return typeof value === "function" ? value.bind(boundTarget) : value;
          },
        });
      };
      if (key === "batch") return (statements: D1PreparedStatement[]) => {
        measurements.push(statements.map((statement) => prepared.get(statement) ?? { sqlBytes: -1, parameters: -1 }));
        return target.batch(statements);
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function expectFixedError(action: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await action;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SermonHistoryWriteError);
  expect(caught).toMatchObject({ code, message: code });
  expect(caught).not.toHaveProperty("cause");
  expect(JSON.stringify(caught) + String(caught)).not.toMatch(/TEST_ONLY|private-actor|[0-9a-f]{64}/u);
}

describe("private append-only sermon history writer", () => {
  it("appends every P5-07~P5-11 operation as one delta and round-trips the final state", async () => {
    const sermonId = await sermon();
    const store = createSermonHistoryStore(historyDb);
    for (let version = 1; version <= complete.state().version; version++) {
      const next = stateAtVersion(complete.records, version, sermonId);
      expect(await store.compareAndSwap(sermonId, version === 1 ? null : version - 1, next)).toBe(true);
      expect(((await store.read(sermonId)) as TranscriptState | null)?.version).toBe(version);
    }
    expect(await store.read(sermonId)).toEqual({ ...complete.state(), sermonId });
  }, 120_000);

  it("works as the unchanged TranscriptRevisionStore port without runtime wiring", async () => {
    const sermonId = await sermon();
    const store = createSermonHistoryStore(historyDb);
    const service = createTranscriptRevisionService(store);
    const imported = await service.execute(sermonId, {
      action: "import_source",
      expectedVersion: 0,
      payload: await historySource(),
    }, historyHuman);
    expect(imported.outcome).toBe("updated");
    if (imported.outcome !== "updated") throw new Error("Synthetic import failed");
    const edited = await service.execute(sermonId, {
      action: "edit",
      ...historyHead(imported.state as TranscriptState),
      content: { format: "plain_text", text: "TEST_ONLY_SERVICE_EDIT" },
    }, historyHuman);
    expect(edited.outcome).toBe("updated");
    expect(Object.keys(store).sort()).toEqual(["compareAndSwap", "read"]);
  });

  it.each([
    ["initial import", "sources", (record: HistoryRecord) => record.envelope.commitSlot === 0],
    ["edit", "revisions", (record) => record.envelope.commitSlot === 0],
    ["confirmation", "confirmations", () => true],
    ["correction", "correctionProposals", () => true],
    ["intent", "intentEvents", () => true],
    ["summary", "summaryEvents", () => true],
    ["child candidates", "candidateEvents", (record) => record.envelope.difficulty === "child"],
    ["adult candidates", "candidateEvents", (record) => record.envelope.difficulty === "adult"],
  ] satisfies [string, HistoryStream, (record: HistoryRecord) => boolean][]) (
    "allows exactly one same-version %s winner and leaves no loser rows",
    async (_name, stream, predicate) => {
      const version = versionFor(stream, predicate);
      const sermonId = crypto.randomUUID();
      const current = await seedPrefix(version - 1, sermonId);
      const first = stateAtVersion(complete.records, version, sermonId);
      const second = remapDelta(current, first);
      const store = createSermonHistoryStore(historyDb);
      const [a, b] = await Promise.all([
        store.compareAndSwap(sermonId, current?.version ?? null, first),
        store.compareAndSwap(sermonId, current?.version ?? null, second),
      ]);
      expect([a, b].sort()).toEqual([false, true]);
      const winner = a ? first : second;
      const loser = a ? second : first;
      expect(await store.read(sermonId)).toEqual(winner);
      const snapshot = JSON.stringify(await historySnapshot(sermonId));
      for (const id of deltaIds(current, loser)) expect(snapshot).not.toContain(id);
    },
    30_000,
  );

  it("rejects stale expected versions without adding an attempt, chunk, or head change", async () => {
    const sermonId = await sermon();
    const store = createSermonHistoryStore(historyDb);
    const first = await oneImport(sermonId);
    expect(await store.compareAndSwap(sermonId, null, first)).toBe(true);
    const before = await historySnapshot(sermonId);
    expect(await store.compareAndSwap(sermonId, null, first)).toBe(false);
    expect(await historySnapshot(sermonId)).toEqual(before);
  });

  it("rejects a rewritten prefix and a two-version delta before any DB mutation", async () => {
    const sermonId = await sermon();
    const store = createSermonHistoryStore(historyDb);
    const service = createTranscriptRevisionService(store);
    const imported = await service.execute(sermonId, { action: "import_source", expectedVersion: 0,
      payload: await historySource() }, historyHuman);
    if (imported.outcome !== "updated") throw new Error("Synthetic import failed");
    const current = structuredClone(imported.state) as TranscriptState;
    const before = await historySnapshot(sermonId);
    const rewritten = structuredClone(current);
    rewritten.revisions[0]!.createdBy = "rewritten-actor";
    rewritten.version++;
    rewritten.confirmations.push({ id: crypto.randomUUID(), sourceId: rewritten.currentSourceId,
      revisionId: rewritten.currentRevisionId, transcriptSha256: rewritten.revisions[0]!.transcriptSha256,
      confirmedBy: "test-actor", confirmedAt: historyHuman.now });
    await expectFixedError(store.compareAndSwap(sermonId, 1, rewritten), "HISTORY_WRITE_INVALID");

    const branch: TranscriptRevisionStore = {
      async read() { return structuredClone(current); },
      async compareAndSwap(_id, _expected, next) { Object.assign(current, structuredClone(next)); return true; },
    };
    const branchService = createTranscriptRevisionService(branch);
    await branchService.execute(sermonId, { action: "edit", ...historyHead(current),
      content: { format: "plain_text", text: "TEST_ONLY_MULTI_DELTA" } }, historyHuman);
    await branchService.execute(sermonId, { action: "confirm", ...historyHead(current), reviewed: true }, historyHuman);
    await expectFixedError(store.compareAndSwap(sermonId, 1, current), "HISTORY_WRITE_INVALID");
    expect(await historySnapshot(sermonId)).toEqual(before);
  });

  const stages = [
    ["record insert", (sql: string) => sql.startsWith("INSERT INTO sermon_history_records")],
    ["record verified", (sql: string) => sql.startsWith("UPDATE sermon_history_records SET verified=1")],
    ["payload insert", (sql: string) => sql.startsWith("INSERT INTO sermon_history_payloads")],
    ["payload verified", (sql: string) => sql.startsWith("UPDATE sermon_history_payloads SET verified=1")],
    ["chunk insert", (sql: string) => sql.startsWith("INSERT INTO sermon_history_chunks")],
    ["chunk verified", (sql: string) => sql.startsWith("UPDATE sermon_history_chunks SET verified=1")],
    ["reference insert", (sql: string) => sql.startsWith("INSERT INTO sermon_history_references")],
    ["reference verified", (sql: string) => sql.startsWith("UPDATE sermon_history_references SET verified=1")],
    ["head", (sql: string) => sql.startsWith("INSERT INTO sermon_history_heads")],
    ["seal", (sql: string) => sql.startsWith("UPDATE sermon_history_commits SET state='sealed'")],
  ] satisfies [string, (sql: string) => boolean][];

  it.each(stages)("rolls back the entire initial append when %s changes zero rows", async (_name, match) => {
    const sermonId = await sermon();
    const next = await oneImport(sermonId);
    const before = await historySnapshot(sermonId);
    await expectFixedError(createSermonHistoryStore(mutateDatabase(match, "zero")).compareAndSwap(sermonId, null, next),
      "HISTORY_WRITE_FAILED");
    expect(await historySnapshot(sermonId)).toEqual(before);
  });

  it.each(stages)("rolls back the entire initial append when %s raises a SQL/constraint failure", async (_name, match) => {
    const sermonId = await sermon();
    const next = await oneImport(sermonId);
    const before = await historySnapshot(sermonId);
    await expectFixedError(createSermonHistoryStore(mutateDatabase(match, "sql")).compareAndSwap(sermonId, null, next),
      "HISTORY_WRITE_FAILED");
    expect(await historySnapshot(sermonId)).toEqual(before);
  });

  it("requires exact original bound chunk bytes before verified and seal", async () => {
    const sermonId = await sermon();
    const next = await oneImport(sermonId);
    const before = await historySnapshot(sermonId);
    const database = mutateDatabase((sql) => sql.startsWith("UPDATE sermon_history_chunks SET verified=1"), "chunk-bound");
    await expectFixedError(createSermonHistoryStore(database).compareAndSwap(sermonId, null, next), "HISTORY_WRITE_FAILED");
    expect(await historySnapshot(sermonId)).toEqual(before);
  });

  it("recovers its own sealed commit after the batch response is lost and a later commit wins", async () => {
    const sermonId = await sermon();
    const next = await oneImport(sermonId);
    const normalStore = createSermonHistoryStore(historyDb);
    const database = losingResponseDatabase(async () => {
      const current = await normalStore.read(sermonId) as TranscriptState;
      const result = await createTranscriptRevisionService(normalStore).execute(sermonId, {
        action: "edit",
        ...historyHead(current),
        content: { format: "plain_text", text: "TEST_ONLY_AFTER_LOST_RESPONSE" },
      }, historyHuman);
      if (result.outcome !== "updated") throw new Error("Synthetic follow-up failed");
    });
    expect(await createSermonHistoryStore(database).compareAndSwap(sermonId, null, next)).toBe(true);
    expect(((await normalStore.read(sermonId)) as TranscriptState | null)?.version).toBe(2);
  });

  it("accepts an exact successful batch without any subsequent SELECT", async () => {
    const sermonId = await sermon();
    const next = await oneImport(sermonId);
    let committed = false, readbacks = 0;
    const database = new Proxy(historyDb, {
      get(target, key) {
        if (key === "batch") return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements);
          committed = true;
          return results;
        };
        if (key === "prepare" && committed) return () => {
          readbacks++;
          throw new Error("Synthetic post-success read unavailable");
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await createSermonHistoryStore(database).compareAndSwap(sermonId, null, next)).toBe(true);
    expect(readbacks).toBe(0);
    expect(await createSermonHistoryStore(historyDb).read(sermonId)).toEqual(next);
  });

  it("returns a fixed uncertain error when neither the batch result nor own-attempt probe is available", async () => {
    const sermonId = await sermon();
    const next = await oneImport(sermonId);
    const before = await historySnapshot(sermonId);
    await expectFixedError(createSermonHistoryStore(losingResponseDatabase(undefined, true))
      .compareAndSwap(sermonId, null, next), "HISTORY_WRITE_UNCERTAIN");
    expect(await historySnapshot(sermonId)).toEqual(before);
  });

  it("atomically stores an exact 1MiB escaped source with bounded SQL and parameters", async () => {
    const sermonId = await sermon();
    const measurements: { sqlBytes: number; parameters: number }[][] = [];
    const store = createSermonHistoryStore(measuredDatabase(measurements));
    const next = await oneImport(sermonId, '"'.repeat(1_048_576));
    expect(await store.compareAndSwap(sermonId, null, next)).toBe(true);
    expect(await store.read(sermonId)).toEqual(next);
    expect(measurements).toHaveLength(1);
    const batch = measurements[0]!;
    expect(batch.length).toBeGreaterThan(100);
    expect(batch.length).toBeLessThan(1_000);
    expect(Math.max(...batch.map((item) => item.parameters))).toBeLessThanOrEqual(100);
    expect(Math.max(...batch.map((item) => item.sqlBytes))).toBeLessThan(100_000);
    expect(batch.every((item) => item.parameters >= 0 && item.sqlBytes > 0)).toBe(true);
    expect({ statementCount: batch.length, maxParameters: Math.max(...batch.map((item) => item.parameters)),
      maxSqlBytes: Math.max(...batch.map((item) => item.sqlBytes)) }).toEqual({ statementCount: 145, maxParameters: 31, maxSqlBytes: 954 });
    const commit = await historyDb.prepare("SELECT byte_length,chunk_count,record_count FROM sermon_history_commits WHERE sermon_id=?")
      .bind(sermonId).first<{ byte_length: number; chunk_count: number; record_count: number }>();
    expect(commit).toEqual({ byte_length: 4_195_072, chunk_count: 66, record_count: 2 });
  }, 60_000);

  it("uses fixed private errors without attaching original causes", async () => {
    const sermonId = await sermon();
    await expectFixedError(createSermonHistoryStore(historyDb).compareAndSwap(sermonId, null,
      { sermonId } as unknown as PrivateTranscriptState), "HISTORY_WRITE_INVALID");
  });
});
