import { describe, expect, it } from "vitest";

import { createDatabase } from "../_shared/db/client";
import { createSermonHistoryReader } from "../_shared/repositories/sermon-history-reader";
import {
  openPackedHistoryOperation,
  readPackedHistorySnapshot,
} from "../_shared/repositories/sermon-history-packed-spike";
import { createSermonHistoryStore } from "../_shared/repositories/sermon-history-writer";
import { createTranscriptRevisionService } from "../_shared/services/transcript-revisions";
import type { TranscriptState } from "../_shared/services/transcript-revision-contract";
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

type BatchResult = D1Result<unknown>[];

async function confirmations(count: number, text = "TEST_ONLY_PACKED_READ") {
  const h = historyHarness();
  await h.run({ action: "import_source", expectedVersion: 0, payload: await historySource(false, text) });
  while (h.state().version < count) await h.run({ action: "confirm", ...historyHead(h.state()), reviewed: true });
  return h;
}

async function emptySermon() {
  const sermonId = crypto.randomUUID();
  await seedMetadataSermon(createDatabase(historyDb), sermonId);
  return sermonId;
}

function trackedDatabase(target: D1Database) {
  const sqlByStatement = new WeakMap<D1PreparedStatement, string>();
  const batches: string[][] = [];
  const database = new Proxy(target, {
    get(databaseTarget, key) {
      if (key === "prepare") return (sql: string) => {
        const statement = databaseTarget.prepare(sql);
        return new Proxy(statement, {
          get(statementTarget, property) {
            if (property === "bind") return (...values: unknown[]) => {
              const bound = statementTarget.bind(...values);
              sqlByStatement.set(bound, sql);
              return bound;
            };
            const value: unknown = Reflect.get(statementTarget, property);
            return typeof value === "function" ? value.bind(statementTarget) : value;
          },
        });
      };
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        batches.push(statements.map((statement) => sqlByStatement.get(statement) ?? "unknown"));
        return databaseTarget.batch(statements);
      };
      const value: unknown = Reflect.get(databaseTarget, key);
      return typeof value === "function" ? value.bind(databaseTarget) : value;
    },
  });
  return { database, batches };
}

function mutatePackedRead(change: (results: BatchResult) => void, batchSize = 6): D1Database {
  const sqlByStatement = new WeakMap<D1PreparedStatement, string>();
  return new Proxy(historyDb, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => {
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get(statementTarget, property) {
            if (property === "bind") return (...values: unknown[]) => {
              const bound = statementTarget.bind(...values);
              sqlByStatement.set(bound, sql);
              return bound;
            };
            const value: unknown = Reflect.get(statementTarget, property);
            return typeof value === "function" ? value.bind(statementTarget) : value;
          },
        });
      };
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        const results = await target.batch(statements);
        if (statements.length === batchSize && (sqlByStatement.get(statements[0]!) ?? "").startsWith("WITH requested")) change(results);
        return results;
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function mutationFault(needle: string, mode: "zero" | "sql" | "bound"): D1Database {
  let changed = false;
  return new Proxy(historyDb, {
    get(target, key) {
      if (key !== "prepare") {
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (sql: string) => {
        const mutation = !sql.startsWith("WITH requested") && !sql.startsWith("SELECT") && sql.includes(needle);
        if (changed || !mutation) return target.prepare(sql);
        changed = true;
        if (mode === "zero") return target.prepare(`${sql} AND 0`);
        if (mode === "sql") {
          const table = /sermon_history_[a-z_]+/u.exec(sql)?.[0];
          if (!table) throw new Error("Synthetic table missing");
          return target.prepare(sql.replaceAll(table, "sermon_history_missing"));
        }
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get(statementTarget, property) {
            if (property === "bind") return (...values: unknown[]) => {
              const changedValues = [...values];
              const index = changedValues.findIndex((value) => value instanceof ArrayBuffer);
              if (index < 0) throw new Error("Synthetic BLOB missing");
              const bytes = new Uint8Array(changedValues[index] as ArrayBuffer).slice();
              bytes[0] = bytes[0] === 0 ? 1 : 0;
              changedValues[index] = bytes.buffer;
              return statement.bind(...changedValues);
            };
            const value: unknown = Reflect.get(statementTarget, property);
            return typeof value === "function" ? value.bind(statementTarget) : value;
          },
        });
      };
    },
  });
}

function interceptMutationResponse(change: (results: BatchResult) => unknown,
  afterCommit?: () => Promise<void>, failProbe = false): D1Database {
  const sqlByStatement = new WeakMap<D1PreparedStatement, string>();
  let lost = false;
  return new Proxy(historyDb, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => {
        const statement = target.prepare(sql);
        return new Proxy(statement, {
          get(statementTarget, property) {
            if (property === "bind") return (...values: unknown[]) => {
              const bound = statementTarget.bind(...values);
              sqlByStatement.set(bound, sql);
              return bound;
            };
            const value: unknown = Reflect.get(statementTarget, property);
            return typeof value === "function" ? value.bind(statementTarget) : value;
          },
        });
      };
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        const first = sqlByStatement.get(statements[0]!) ?? "";
        const mutation = first.includes("INSERT INTO sermon_history_commits");
        if (!lost && mutation) {
          const results = await target.batch(statements);
          lost = true;
          if (afterCommit) await afterCommit();
          return change(results);
        }
        if (lost && failProbe) throw new Error("Synthetic packed probe unavailable");
        return target.batch(statements);
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function loseMutationResponse(afterCommit?: () => Promise<void>, failProbe = false): D1Database {
  return interceptMutationResponse(() => { throw new Error("Synthetic committed response loss"); }, afterCommit, failProbe);
}

describe("P5-26 schema-less packed read", () => {
  it.each([1, 16, 32, 64])("round-trips %i commits in exactly seven D1 query statements", async (version) => {
    const h = await confirmations(version);
    const sermonId = await seedReadHistory(h);
    const tracked = trackedDatabase(historyDb);
    const packed = await readPackedHistorySnapshot(tracked.database, sermonId);
    expect(packed.seed.current).toEqual({ ...h.state(), sermonId });
    expect(packed.metrics.readQueries).toBe(7);
    expect(tracked.batches.map((batch) => batch.length)).toEqual([1, 6]);
    expect(tracked.batches.flat().every((sql) => sql.startsWith("WITH requested") || sql.startsWith("SELECT"))).toBe(true);
  }, 60_000);

  it("preserves all eight streams and the existing validating reader result", async () => {
    const h = await historyFixture(false, true);
    const sermonId = await seedReadHistory(h);
    const packed = await readPackedHistorySnapshot(historyDb, sermonId);
    expect(packed.seed.current).toEqual(await createSermonHistoryReader(historyDb).read(sermonId));
  }, 30_000);

  it("rejects missing packed rows and an H0/H1 mismatch instead of returning partial history", async () => {
    const h = await confirmations(2);
    const sermonId = await seedReadHistory(h);
    await expect(readPackedHistorySnapshot(mutatePackedRead((results) => {
      (results[1]!.results as unknown[]).length = 0;
    }), sermonId)).rejects.toMatchObject({ code: "HISTORY_READ_CORRUPT" });
    await expect(readPackedHistorySnapshot(mutatePackedRead((results) => {
      const head = results[5]!.results[0] as Record<string, unknown>;
      head.version = Number(head.version) + 1;
    }), sermonId)).rejects.toMatchObject({ code: "HISTORY_READ_CHANGED" });
  });

  it("returns null only for an existing empty sermon and rejects invalid/missing IDs", async () => {
    const sermonId = await emptySermon();
    expect((await readPackedHistorySnapshot(historyDb, sermonId)).seed.current).toBeNull();
    await expect(readPackedHistorySnapshot(historyDb, "bad/private")).rejects.toMatchObject({ code: "HISTORY_READ_INVALID" });
    await expect(readPackedHistorySnapshot(historyDb, "missing-sermon")).rejects.toMatchObject({ code: "HISTORY_READ_CORRUPT" });
  });

  it("rejects an oversized meta summary before issuing the bounded BLOB/data batch", async () => {
    const h = await confirmations(1);
    const sermonId = await seedReadHistory(h);
    const mutated = mutatePackedRead((results) => {
      (results[0]!.results[0] as Record<string, unknown>).total_bytes = 8 * 1024 * 1024 + 1;
    }, 1);
    const tracked = trackedDatabase(mutated);
    await expect(readPackedHistorySnapshot(tracked.database, sermonId)).rejects.toMatchObject({ code: "HISTORY_RESOURCE_LIMIT" });
    expect(tracked.batches.map((batch) => batch.length)).toEqual([1]);
  });
});

describe("P5-26 operation handle, grouped mutation and bounded probe", () => {
  it("uses one operation read and no post-success probe for a grouped import", async () => {
    const sermonId = await emptySermon();
    const tracked = trackedDatabase(historyDb);
    const operation = await openPackedHistoryOperation(tracked.database, sermonId);
    const result = await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "TEST_ONLY_GROUPED") }, historyHuman);
    expect(result.outcome).toBe("updated");
    expect(operation.metrics).toMatchObject({ readQueries: 7, operationReads: 1, probeQueries: 0 });
    expect(operation.metrics.mutationStatements).toBeLessThanOrEqual(24);
    expect(operation.metrics.readQueries + operation.metrics.mutationStatements + operation.metrics.probeQueries).toBeLessThanOrEqual(31);
    expect(tracked.batches.map((batch) => batch.length)).toEqual([1, 6, operation.metrics.mutationStatements]);
    expect(await createSermonHistoryReader(historyDb).read(sermonId)).toEqual(result.outcome === "updated" ? result.state : null);
  });

  it("allows one same-version winner and leaves the losing handle's domain rows absent", async () => {
    const sermonId = await emptySermon();
    const first = await openPackedHistoryOperation(historyDb, sermonId);
    const second = await openPackedHistoryOperation(historyDb, sermonId);
    const [a, b] = await Promise.all([
      first.execute({ action: "import_source", expectedVersion: 0, payload: await historySource(false, "TEST_ONLY_FIRST") }, historyHuman),
      second.execute({ action: "import_source", expectedVersion: 0, payload: await historySource(false, "TEST_ONLY_SECOND") }, historyHuman),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(["failed", "updated"]);
    const loser = a.outcome === "failed" ? a : b;
    expect(loser).toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    const snapshot = JSON.stringify(await historySnapshot(sermonId));
    expect(snapshot.includes("TEST_ONLY_FIRST") && snapshot.includes("TEST_ONLY_SECOND")).toBe(false);
    expect(first.metrics.operationReads).toBe(1);
    expect(second.metrics.operationReads).toBe(1);
  });

  it("accepts the eight-chunk fast path and rejects a delta above 512KiB before mutation", async () => {
    const acceptedId = await emptySermon();
    const accepted = await openPackedHistoryOperation(historyDb, acceptedId);
    const ok = await accepted.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "x".repeat(200_000)) }, historyHuman);
    expect(ok.outcome).toBe("updated");
    expect(accepted.metrics).toMatchObject({ readQueries: 7, mutationStatements: 21, probeQueries: 0 });
    expect(await historyDb.prepare("SELECT chunk_count FROM sermon_history_commits WHERE sermon_id=?")
      .bind(acceptedId).first("chunk_count")).toBe(8);

    const rejectedId = await emptySermon();
    const before = await historySnapshot(rejectedId);
    const rejected = await openPackedHistoryOperation(historyDb, rejectedId);
    const result = await rejected.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "x".repeat(270_000)) }, historyHuman);
    expect(result.outcome).toBe("failed");
    expect(rejected.metrics.mutationStatements).toBe(0);
    expect(await historySnapshot(rejectedId)).toEqual(before);
  }, 30_000);

  const stages = [
    "INSERT INTO sermon_history_commits",
    "sermon_history_records",
    "sermon_history_payloads",
    "sermon_history_chunks",
    "sermon_history_references",
    "sermon_history_heads",
    "UPDATE sermon_history_commits SET state='sealed'",
  ];
  it.each(stages)("rolls back every grouped row when %s changes zero rows", async (stage) => {
    const sermonId = await emptySermon();
    const before = await historySnapshot(sermonId);
    const operation = await openPackedHistoryOperation(mutationFault(stage, "zero"), sermonId);
    const result = await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "TEST_ONLY_ZERO") }, historyHuman);
    expect(result.outcome).toBe("failed");
    expect(await historySnapshot(sermonId)).toEqual(before);
  });

  it.each(stages)("rolls back every grouped row when %s raises SQL/constraint failure", async (stage) => {
    const sermonId = await emptySermon();
    const before = await historySnapshot(sermonId);
    const operation = await openPackedHistoryOperation(mutationFault(stage, "sql"), sermonId);
    const result = await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "TEST_ONLY_SQL") }, historyHuman);
    expect(result.outcome).toBe("failed");
    expect(await historySnapshot(sermonId)).toEqual(before);
  });

  it("keeps exact original bound BLOB verification in the grouped path", async () => {
    const sermonId = await emptySermon();
    const before = await historySnapshot(sermonId);
    const operation = await openPackedHistoryOperation(mutationFault("UPDATE sermon_history_chunks", "bound"), sermonId);
    const result = await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "TEST_ONLY_BOUND") }, historyHuman);
    expect(result.outcome).toBe("failed");
    expect(await historySnapshot(sermonId)).toEqual(before);
  });

  it("recovers only its own commit in six probe queries after response loss and a later commit", async () => {
    const sermonId = await emptySermon();
    const normal = createSermonHistoryStore(historyDb);
    const database = loseMutationResponse(async () => {
      const current = await normal.read(sermonId) as TranscriptState | null;
      if (!current) throw new Error("Synthetic current missing");
      const followUp = await createTranscriptRevisionService(normal).execute(sermonId, {
        action: "edit", ...historyHead(current), content: { format: "plain_text", text: "TEST_ONLY_FOLLOW_UP" },
      }, historyHuman);
      if (followUp.outcome !== "updated") throw new Error("Synthetic follow-up failed");
    });
    const operation = await openPackedHistoryOperation(database, sermonId);
    const result = await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "TEST_ONLY_LOST") }, historyHuman);
    expect(result.outcome).toBe("updated");
    expect(operation.metrics.probeQueries).toBe(6);
    expect(((await normal.read(sermonId)) as TranscriptState | null)?.version).toBe(2);
  });

  it("does not depend on the probe being available after an exact successful response", async () => {
    const sermonId = await emptySermon();
    const tracked = trackedDatabase(interceptMutationResponse((results) => results, undefined, true));
    const operation = await openPackedHistoryOperation(tracked.database, sermonId);
    const result = await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "TEST_ONLY_NO_READBACK") }, historyHuman);
    expect(result.outcome).toBe("updated");
    expect(operation.metrics.probeQueries).toBe(0);
    expect(tracked.batches).toHaveLength(3);
    expect((await createSermonHistoryReader(historyDb).read(sermonId))?.version).toBe(1);
  });

  it.each(["missing-result", "sparse-result", "extra-result", "missing-meta", "false-success", "zero-changes",
    "fractional-changes", "string-changes"])("uses own-attempt proof for %s instead of accepting an incomplete success", async (fault) => {
    const sermonId = await emptySermon();
    const database = interceptMutationResponse((results) => {
      switch (fault) {
        case "missing-result": results.pop(); break;
        case "sparse-result": delete results[0]; break;
        case "extra-result": results.push(results[0]!); break;
        case "missing-meta": Reflect.deleteProperty(results[0]!, "meta"); break;
        case "false-success": Reflect.set(results[0]!, "success", false); break;
        case "zero-changes": results[0]!.meta.changes = 0; break;
        case "fractional-changes": results[0]!.meta.changes = 0.5; break;
        case "string-changes": Reflect.set(results[0]!.meta, "changes", "1"); break;
      }
      return results;
    });
    const operation = await openPackedHistoryOperation(database, sermonId);
    const result = await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "TEST_ONLY_INCOMPLETE_SUCCESS") }, historyHuman);
    expect(result.outcome).toBe("updated");
    expect(operation.metrics.probeQueries).toBe(6);
    expect((await createSermonHistoryReader(historyDb).read(sermonId))?.version).toBe(1);
  });

  it("does not claim success or replay when an incomplete response cannot be proved", async () => {
    const sermonId = await emptySermon();
    const tracked = trackedDatabase(interceptMutationResponse((results) => {
      delete results[0];
      return results;
    }, undefined, true));
    const operation = await openPackedHistoryOperation(tracked.database, sermonId);
    const result = await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "TEST_ONLY_UNPROVED_SUCCESS") }, historyHuman);
    expect(result).toMatchObject({ outcome: "failed", code: "TRANSCRIPT_VALIDATION_FAILED" });
    expect(operation.metrics.probeQueries).toBe(6);
    expect(tracked.batches.filter((batch) => batch[0]?.includes("INSERT INTO sermon_history_commits"))).toHaveLength(1);
    expect((await createSermonHistoryReader(historyDb).read(sermonId))?.version).toBe(1);
  });

  it("returns uncertain without replay when both the response and packed probe are unavailable", async () => {
    const sermonId = await emptySermon();
    const operation = await openPackedHistoryOperation(loseMutationResponse(undefined, true), sermonId);
    const result = await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "TEST_ONLY_UNCERTAIN") }, historyHuman);
    expect(result).toMatchObject({ outcome: "failed", code: "TRANSCRIPT_VALIDATION_FAILED" });
    expect(operation.metrics.probeQueries).toBe(6);
    expect((await createSermonHistoryReader(historyDb).read(sermonId))?.version).toBe(1);
  });
});
