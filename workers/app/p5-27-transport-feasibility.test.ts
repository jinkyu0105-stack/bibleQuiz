// Read-only synthetic SQL / existing-plan inspection. No transport implementation.
import { describe, expect, it } from "vitest";
import { createDatabase } from "../_shared/db/client";
import { openPackedHistoryOperation } from "../_shared/repositories/sermon-history-packed-spike";
import { measureHistoryBatch, HistoryResourceLimitError } from "../_shared/storage/history-resource-limits";
import { historyDb, historySnapshot } from "./test/sermon-history-structure-fixture";
import { historyHuman, historySource } from "./test/sermon-history-codec-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";

type HexBytes = Uint8Array & { toHex(): string };
type HexConstructor = typeof Uint8Array & { fromHex(value: string): Uint8Array };
const hexConstructor = Uint8Array as HexConstructor;

describe("P5-27 transport feasibility, local only", () => {
  it("supports native hex and SQL hex/unhex with every byte value and binary boundaries", async ({ task }) => {
    expect(typeof Reflect.get(Uint8Array.prototype, "toHex")).toBe("function");
    expect(typeof Reflect.get(Uint8Array, "fromHex")).toBe("function");
    const inputs = [new Uint8Array(), new Uint8Array([0, 255, 128]),
      Uint8Array.from({ length: 65_536 }, (_, i) => i % 256),
      new TextEncoder().encode('TEST_ONLY_가😀"\\\n').slice(0, 12)];
    for (const bytes of inputs) {
      const expected = (bytes as HexBytes).toHex().toUpperCase();
      const row = await historyDb.prepare("SELECT typeof(?1) AS kind, length(?1) AS n, hex(?1) AS encoded")
        .bind(bytes.buffer).first<{ kind: string; n: number; encoded: string }>();
      expect(row?.kind).toBe("blob");
      expect(row?.n).toBe(bytes.length);
      expect(row?.encoded === expected).toBe(true);
      expect(hexConstructor.fromHex(row!.encoded).every((b, i) => b === bytes[i])).toBe(true);
      // Diagnostic SELECT only; this is not approval to bypass a mutation budget.
      const inverse = await historyDb.prepare("SELECT typeof(unhex(?1)) AS kind, hex(unhex(?1)) AS encoded")
        .bind(expected).first<{ kind: string; encoded: string }>();
      expect(inverse?.kind).toBe("blob");
      expect(inverse?.encoded === expected).toBe(true);
    }
    const bytes = inputs[2]!;
    const rawJsonBytes = new TextEncoder().encode(JSON.stringify(Array.from(bytes))).byteLength;
    const hexJsonBytes = new TextEncoder().encode(JSON.stringify((bytes as HexBytes).toHex())).byteLength;
    Reflect.set(task.meta, "transportReview", { kind: "wire-representation",
      inputBytes: bytes.length, rawJsonBytes, hexJsonBytes, nativeHex: true, localSqlUnhex: true });
  });
  it("demonstrates why hex projection must retain SQL type and length guards", async () => {
    const rows = (await historyDb.prepare(`SELECT typeof(v) AS kind, length(v) AS n, hex(v) AS encoded
      FROM (SELECT X'4142' AS v UNION ALL SELECT 'AB' UNION ALL SELECT NULL UNION ALL SELECT X'')`).all()).results;
    expect(rows).toEqual([
      { kind: "blob", n: 2, encoded: "4142" },
      { kind: "text", n: 2, encoded: "4142" },
      { kind: "null", n: null, encoded: "" },
      { kind: "blob", n: 0, encoded: "" },
    ]);
    // Native decoder rejects malformed encodings; SQL unhex returns NULL instead.
    for (const malformed of ["0", "GG", "00 11", "0x00"]) {
      expect(() => hexConstructor.fromHex(malformed)).toThrow();
      expect(await historyDb.prepare("SELECT unhex(?) IS NULL AS invalid").bind(malformed).first("invalid")).toBe(1);
    }
  });
  it("rejects naive hex writes under the unchanged actual mutation-plan byte budget, without writing", async ({ task }) => {
    const sermonId = crypto.randomUUID();
    await seedMetadataSermon(createDatabase(historyDb), sermonId);
    const before = await historySnapshot(sermonId);
    type Statement = { sql: string; values: (string | number | null | ArrayBuffer)[] };
    const prepared = new WeakMap<D1PreparedStatement, Statement>();
    let captured: Statement[] = [], batches = 0;
    const database = new Proxy(historyDb, { get(target, key) {
      if (key === "prepare") return (sql: string) => {
        const statement = target.prepare(sql);
        return new Proxy(statement, { get(statementTarget, property) {
          if (property === "bind") return (...values: Statement["values"]) => {
            const bound = statementTarget.bind(...values);
            prepared.set(bound, { sql, values }); return bound;
          };
          const value: unknown = Reflect.get(statementTarget, property);
          return typeof value === "function" ? value.bind(statementTarget) : value;
        } });
      };
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        if (++batches === 3) {
          captured = statements.map(s => prepared.get(s)!);
          throw new Error("SYNTHETIC_STOP_BEFORE_MUTATION");
        }
        return target.batch(statements);
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const operation = await openPackedHistoryOperation(database, sermonId);
    expect((await operation.execute({ action: "import_source", expectedVersion: 0,
      payload: await historySource(false, "x".repeat(200_000)) }, historyHuman)).outcome).toBe("failed");
    expect(await historySnapshot(sermonId)).toEqual(before);
    const original = measureHistoryBatch(captured);
    expect(original.statements).toBe(21);
    const converted = captured.map(s => ({ sql: s.sql, values: s.values.map(v => v instanceof ArrayBuffer
      ? (new Uint8Array(v) as HexBytes).toHex() : v) }));
    // The failure already occurs in bound values, even before adding unhex() to SQL.
    expect(() => measureHistoryBatch(converted)).toThrow(HistoryResourceLimitError);
    const rowBytes = (s: Statement) => s.values.reduce<number>((n, v) => n +
      (v instanceof ArrayBuffer ? v.byteLength : typeof v === "string" ? new TextEncoder().encode(v).byteLength : 8), 0);
    Reflect.set(task.meta, "transportReview", { kind: "actual-plan-budget",
      statements: original.statements, originalRowBytes: original.rowBytes,
      naiveHexRowBytes: Math.max(...converted.map(rowBytes)), unchangedRowLimit: 131_072,
      originalBoundBytes: original.boundBytes, originalWireEstimate: original.wireBytes, historyWrites: 0 });
  });
});
