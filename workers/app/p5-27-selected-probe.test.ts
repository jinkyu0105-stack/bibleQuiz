import { describe, expect, it, vi } from "vitest";
import probe from "./p5-27-selected-probe";
import { createDatabase } from "../_shared/db/client";
import { historyDb } from "./test/sermon-history-structure-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";
function request(body: string, host = "p5-27.invalid") {
  return new Request<unknown, IncomingRequestCfProperties>(`https://${host}/__p5-27/leaf`, { method: "POST", headers: { "x-p5-27-internal": "p5-27-service-binding-only" }, body });
}
describe("D-031 isolated Preview measurement wrapper", () => {
  it.each(["typical", "boundary"])("measures only new-path %s import without returning content", async (profile) => {
    await seedMetadataSermon(createDatabase(historyDb), `p527-${profile}-000`);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const response = await probe.fetch(request(JSON.stringify({ profile, index: 0 })), { DB: historyDb });
      const result = await response.json();
      expect(result).toMatchObject({ code: "P5_27_LEAF", runId: "p5-27-caption-30000-20260916", outcome: "updated", queries: 4, operationReads: 0, replayCount: 0 });
      expect(JSON.stringify(result) + JSON.stringify(log.mock.calls)).not.toContain("TEST_ONLY_P5_27_TYPICAL");
      expect(log).not.toHaveBeenCalled();
      const events = await historyDb.prepare("SELECT kind FROM sermon_input_events WHERE sermon_id = ?").bind(`p527-${profile}-000`).all();
      expect(events.results).toEqual([{ kind: "source" }]);
      expect((await historyDb.prepare("SELECT count(*) AS n FROM sermon_history_heads").first<{ n: number }>())?.n).toBe(0);
    } finally { log.mockRestore(); }
  });
  it("rejects external and arbitrary-content requests without touching DB", async () => {
    const db = { prepare() { throw new Error("PRIVATE_CAUSE"); } } as unknown as D1Database;
    expect((await probe.fetch(request("{}", "example.com"), { DB: db })).status).toBe(404);
    expect((await probe.fetch(request('{"profile":"boundary","index":100}'), { DB: db })).status).toBe(400);
    expect((await probe.fetch(request('{"profile":"boundary","index":0,"text":"PRIVATE_INPUT"}'), { DB: db })).status).toBe(400);
    expect(await (await probe.fetch(request("PRIVATE_INPUT"), { DB: db })).text()).toBe('{"code":"FAILED","runId":"p5-27-caption-30000-20260916"}');
  });
});
