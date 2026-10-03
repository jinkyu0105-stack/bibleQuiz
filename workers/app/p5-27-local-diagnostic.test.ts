import { describe, expect, it } from "vitest";
import { createDatabase } from "../_shared/db/client";
import diagnostic from "./p5-27-local-diagnostic";
import { historyDb, historySnapshot } from "./test/sermon-history-structure-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";

async function seed() {
  const id = `p527-${crypto.randomUUID()}`;
  await seedMetadataSermon(createDatabase(historyDb), id);
  return id;
}
function invoke(mode: string, sermonId: string, db = historyDb, profile = "boundary") {
  return diagnostic.fetch(new Request(`https://p5-27-local.invalid/${mode}`, {
    method: "POST", body: JSON.stringify({ profile, index: 0, sermonId }),
  }), { DB: db });
}

describe("P5-27 local-only failure attribution", () => {
  it("rejects unrelated host and invalid fixture identifiers", async () => {
    expect((await diagnostic.fetch(new Request("https://example.com/operation"), { DB: historyDb })).status).toBe(404);
    expect((await invoke("operation", "not-a-synthetic-id")).status).toBe(400);
    expect((await invoke("unknown", "p527-test")).status).toBe(400);
  });
  it("isolates payload preparation without DB history writes", async () => {
    const id = await seed(), before = await historySnapshot(id);
    expect(await (await invoke("payload", id)).json()).toMatchObject({ outcome: "validated" });
    expect(await historySnapshot(id)).toEqual(before);
  });
  it("records read/payload/execute and three batches without normal-success readback", async () => {
    const result = await (await invoke("operation", await seed())).json() as {
      outcome: string; spans: { phase: string; statements?: number }[]; metrics: object;
    };
    expect(result.outcome).toBe("updated");
    expect(result.metrics).toEqual({ readQueries: 7, mutationStatements: 21, probeQueries: 0, operationReads: 1 });
    expect(result.spans.filter((s) => s.statements).map((s) => s.statements)).toEqual([1, 6, 21]);
    expect(result.spans.filter((s) => !s.statements).map((s) => s.phase)).toEqual(["read", "payload", "execute"]);
  });
  it("reproduces a pre-write HISTORY_READ_CHANGED when another operation commits between H0/H1", async () => {
    const id = await seed();
    const response = await invoke("race", id);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ outcome: "caught", failureCode: "HISTORY_READ_CHANGED",
      phase: "read", winner: "updated", spans: [{ statements: 1 }, { statements: 6 }] });
    const snapshot = await historySnapshot(id);
    expect(snapshot.slice(0, 6).map((rows) => rows.length)).toEqual([1, 1, 2, 1, 2, 8]);
  });
  it("keeps DB unavailability distinct and suppresses underlying private exception text", async () => {
    const db = new Proxy(historyDb, { get(target, key) {
      if (key === "batch") return () => { throw new Error("PRIVATE_SQL_SECRET_CANARY"); };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const response = await invoke("operation", await seed(), db);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ failureCode: "HISTORY_READ_UNAVAILABLE", phase: "read" });
    expect(text).not.toContain("PRIVATE_SQL_SECRET_CANARY");
  });
});
