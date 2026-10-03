import { describe, expect, it } from "vitest";
import { z } from "zod";
import { copyHistoryByteArray, sameHistoryByteArray, sameHistoryStoredRow } from "../_shared/storage/history-byte-array";
import { sameHistoryValue } from "../_shared/storage/history-json-codec";
import { openPackedHistoryOperation, readPackedHistorySnapshot } from "../_shared/repositories/sermon-history-packed-spike";
import { createDatabase } from "../_shared/db/client";
import { historyDb } from "./test/sermon-history-structure-fixture";
import { historyHuman, historySource } from "./test/sermon-history-codec-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";

const oldSchema = z.array(z.int().min(0).max(255)).max(65_536);

describe("P5-27 exact byte path", () => {
  it.each([null, "0,1", {}, new Uint8Array([0, 1]), [undefined], [NaN], [Infinity], [-1], [256],
    [0.5], ["1"], [true], [null], [1n], new Array(2)])("rejects non-byte input %# without coercion", (raw) => {
    expect(oldSchema.safeParse(raw).success).toBe(false);
    expect(copyHistoryByteArray(raw)).toBeNull();
    expect(sameHistoryByteArray(raw, new Uint8Array(Array.isArray(raw) ? raw.length : 1).buffer)).toBe(false);
  });
  it("accepts all byte values and owns the copied buffer", () => {
    const raw = Array.from({ length: 65_536 }, (_, i) => i % 256);
    const copy = copyHistoryByteArray(raw)!;
    expect(Array.from(copy)).toEqual(oldSchema.parse(raw));
    expect(sameHistoryByteArray(raw, copy.buffer as ArrayBuffer)).toBe(true);
    raw[0] = 255;
    expect(copy[0]).toBe(0);
    expect(copyHistoryByteArray([])).toEqual(new Uint8Array());
    expect(copyHistoryByteArray([...raw, 0])).toBeNull();
  });
  it.each([0, 32768, 65535])("rejects a changed byte at position %i", (index) => {
    const expected = new Uint8Array(65_536).fill(42), raw = Array.from(expected);
    raw[index] = 41;
    expect(sameHistoryByteArray(raw, expected.buffer)).toBe(false);
  });
  it("preserves exact array-key/length/order semantics and rejects inherited holes", () => {
    const bytes = new Uint8Array([0, 1, 255]);
    const extra = Object.assign([0, 1, 255], { extra: 1 });
    const hole = [0, 1, 255];
    Reflect.deleteProperty(hole, "1");
    Object.setPrototypeOf(hole, Object.assign(Object.create(Array.prototype), { 1: 1 }));
    for (const raw of [extra, hole, [0, 1], [0, 1, 255, 0], [255, 1, 0]]) {
      expect(sameHistoryValue(raw, Array.from(bytes))).toBe(false);
      expect(sameHistoryByteArray(raw, bytes.buffer)).toBe(false);
    }
    expect(copyHistoryByteArray(hole)).toBeNull();
    // Reader historically ignores extra named properties; own-attempt equality does not.
    expect(Array.from(copyHistoryByteArray(extra)!)).toEqual(oldSchema.parse(extra));
  });
  it("copies a getter-backed element only once and bounds a changing input length", () => {
    let reads = 0;
    const raw = [0];
    Object.defineProperty(raw, "0", { enumerable: true, get: () => ++reads === 1 ? 7 : 300 });
    expect(copyHistoryByteArray(raw)).toEqual(new Uint8Array([7]));
    expect(reads).toBe(1);
    const growing = [0];
    Object.defineProperty(growing, "0", { get: () => { growing.push(1); return 7; } });
    expect(copyHistoryByteArray(growing)).toBeNull();
  });
  it("retains exact row metadata, null/absent and verified comparisons", () => {
    const expected = { body: new Uint8Array([0, 255]).buffer, verified: 1, id: "TEST_ONLY", nullable: null };
    const actual = { id: "TEST_ONLY", nullable: null, body: [0, 255], verified: 1 };
    expect(sameHistoryStoredRow(actual, expected)).toBe(true);
    for (const invalid of [null, [], { ...actual, verified: 0 }, { ...actual, body: [0, 254] },
      { ...actual, extra: true }, { ...actual, nullable: undefined }]) {
      expect(sameHistoryStoredRow(invalid, expected)).toBe(false);
    }
  });
  it("packed read does not mutate DB rows or retain their mutable BLOB arrays", async () => {
    const id = crypto.randomUUID();
    await seedMetadataSermon(createDatabase(historyDb), id);
    const operation = await openPackedHistoryOperation(historyDb, id);
    const result = await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "x".repeat(200_000)) }, historyHuman);
    expect(result.outcome).toBe("updated");
    let captured: Record<string, unknown>[] = [], before = "";
    const db = new Proxy(historyDb, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        const results = await target.batch(statements);
        if (statements.length === 6) {
          captured = results[3]!.results as Record<string, unknown>[];
          before = JSON.stringify(captured);
        }
        return results;
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const snapshot = await readPackedHistorySnapshot(db, id);
    expect(JSON.stringify(captured)).toBe(before);
    (captured[0]!.body as number[]).fill(0);
    expect(snapshot.seed.current).toEqual(result.outcome === "updated" ? result.state : null);
    expect(Object.isFrozen(snapshot.seed.current)).toBe(true);
    expect(snapshot.metrics.readQueries).toBe(7);
  });
  it.each([0, 32768, 65535])("after response loss, own-attempt rejects corrupt probe byte %i even with unchanged hashes", async (index) => {
    const id = crypto.randomUUID();
    await seedMetadataSermon(createDatabase(historyDb), id);
    let batches = 0;
    const db = new Proxy(historyDb, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        const results = await target.batch(statements);
        batches++;
        if (batches === 3) throw new Error("Synthetic committed response loss");
        if (batches === 4) {
          const row = results[4]!.results[0] as { body: number[] };
          row.body[index] = (row.body[index]! + 1) % 256;
        }
        return results;
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const operation = await openPackedHistoryOperation(db, id);
    const result = await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "x".repeat(200_000)) }, historyHuman);
    expect(result.outcome).toBe("failed");
    expect(operation.metrics.probeQueries).toBe(6);
    expect(batches).toBe(4); // No automatic replay/second attempt.
    // The database committed before the deliberately damaged response: don't claim rollback.
    expect((await readPackedHistorySnapshot(historyDb, id)).seed.current?.version).toBe(1);
  });
});
