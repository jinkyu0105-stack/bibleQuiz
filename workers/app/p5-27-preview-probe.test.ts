import { describe, expect, it, vi } from "vitest";
import probe from "./p5-27-preview-probe";
import { openPackedHistoryOperation } from "../_shared/repositories/sermon-history-packed-spike";
import { createDatabase } from "../_shared/db/client";
import { historyDb, historySnapshot } from "./test/sermon-history-structure-fixture";
import { historyHuman, historySource } from "./test/sermon-history-codec-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";

function request(body = JSON.stringify({ profile: "concurrent", index: 0 }), path = "leaf") {
  return new Request<unknown, IncomingRequestCfProperties>(`https://p5-27.invalid/__p5-27/${path}`, { method: "POST",
    headers: { "x-p5-27-internal": "p5-27-service-binding-only" }, body });
}
const unavailable = { prepare: () => ({ bind() { return this; } }),
  batch: () => { throw new Error("PRIVATE_DATABASE_CAUSE_CANARY"); } } as unknown as D1Database;

describe("P5-27 safe probe failure classification", () => {
  it.each(["leaf", "ready"])("classifies %s failures without exception text", async (path) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await probe.fetch(request(undefined, path), { DB: unavailable });
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({ code: "FAILED", phase: path === "leaf" ? "read" : "ready",
        failureCode: path === "leaf" ? "HISTORY_READ_UNAVAILABLE" : "UNCLASSIFIED" });
      expect(text + JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_DATABASE_CAUSE_CANARY");
    } finally { log.mockRestore(); }
  });
  it("does not echo malformed input or admit external requests", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await probe.fetch(request("PRIVATE_INPUT_CANARY"), { DB: unavailable });
      expect(await result.json()).toMatchObject({ phase: "request", profile: null, index: null, failureCode: "UNCLASSIFIED" });
      expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_INPUT_CANARY");
      expect((await probe.fetch(new Request("https://example.com/__p5-27/leaf"), { DB: unavailable })).status).toBe(404);
      expect((await probe.fetch(request('{"profile":"real-content","index":0}'), { DB: unavailable })).status).toBe(400);
    } finally { log.mockRestore(); }
  });
  it("reports a real H0/H1 race as read-changed with synthetic profile/index and no losing write", async () => {
    const id = "p527-concurrent";
    await seedMetadataSermon(createDatabase(historyDb), id);
    let calls = 0;
    const db = new Proxy(historyDb, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        const results = await target.batch(statements);
        if (++calls === 1) {
          const winner = await openPackedHistoryOperation(target, id);
          expect((await winner.execute({ action: "import_source", expectedVersion: 0,
            payload: await historySource(false, "TEST_ONLY_WINNER") }, historyHuman)).outcome).toBe("updated");
        }
        return results;
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await probe.fetch(request(), { DB: db });
      expect(result.status).toBe(500);
      expect(await result.json()).toMatchObject({ code: "FAILED", failureCode: "HISTORY_READ_CHANGED",
        phase: "read", profile: "concurrent", index: 0 });
      expect(calls).toBe(2);
      expect((await historySnapshot(id)).slice(0, 6).map(rows => rows.length)).toEqual([1, 1, 2, 1, 2, 2]);
      expect(JSON.stringify(log.mock.calls)).not.toContain("TEST_ONLY_WINNER");
    } finally { log.mockRestore(); }
  });
});
