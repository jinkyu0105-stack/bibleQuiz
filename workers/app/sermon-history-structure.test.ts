import { describe, expect, it } from "vitest";
import { executeHistory, historyDb, historyPlan, historySnapshot, historyTables, seedHistory } from "./test/sermon-history-structure-fixture";

describe("P5-20 empty history structure / isolated D1", () => {
  it("seals imports and all seven streams with a shared order, two difficulties, and unchanged metadata/public rows", async () => {
    const id = await seedHistory(), before = await historySnapshot(id);
    for (const [command, difficulty] of [["import", "child"], ["revisions", "child"], ["confirmations", "child"], ["correctionProposals", "child"], ["correctionDecisions", "child"], ["intentEvents", "child"], ["summaryEvents", "child"], ["candidateEvents", "child"], ["candidateEvents", "adult"], ["import", "child"]]) {
      const plan = await historyPlan(id, command, 65537, difficulty), result = await executeHistory(plan.steps);
      expect(result[0]!.meta.changes).toBe(1);
      expect(result.at(-1)!.meta.changes).toBe(1);
    }
    const after = await historySnapshot(id);
    expect(after[0]).toMatchObject([{ version: 10, current_confirmation_id: null }]);
    expect(after[1]).toHaveLength(10);
    expect(after[1]!.every((c) => c.state === "sealed")).toBe(true);
    expect(after[2]!.filter((r) => r.stream === "candidateEvents").sort((a,b) => Number(a.stream_position)-Number(b.stream_position)).map((r) => [r.stream_position, r.difficulty])).toEqual([[1, "child"], [2, "adult"]]);
    expect(after.slice(6)).toEqual(before.slice(6));
    expect((await historyDb.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    expect((await historyDb.prepare("PRAGMA quick_check").all()).results).toEqual([{ quick_check: "ok" }]);
  });

  it.each([65535, 65536, 65537, 131073])("accepts exact BLOB geometry at %i bytes (synthetic envelope, not a domain codec)", async (size) => {
    const id = await seedHistory(), plan = await historyPlan(id, "import", size);
    await executeHistory(plan.steps);
    expect((await historySnapshot(id))[5]).toHaveLength(2 * Math.ceil(size / 65536));
  });

  it.each(["record:0", "record:1", "payload:0", "payload:1", "chunk:0:0", "chunk:0:1", "ref:source", "record:0:verify", "payload:0:verify", "chunk:0:0:verify", "ref:source:verify", "head"])("rolls back every table when %s silently affects zero rows", async (label) => {
    const id = await seedHistory(), before = await historySnapshot(id), plan = await historyPlan(id);
    const step = plan.steps.find((s) => s.label === label)!;
    step.sql += " AND 0";
    await expect(executeHistory(plan.steps)).rejects.toThrow();
    expect(await historySnapshot(id)).toEqual(before);
  });

  it.each(["claim", "record:0", "payload:0", "chunk:0:0", "ref:source", "chunk:0:0:verify", "head", "seal"])("rolls back an injected SQL failure after %s, including an advanced existing head", async (label) => {
    const id = await seedHistory();
    await executeHistory((await historyPlan(id)).steps);
    const before = await historySnapshot(id), plan = await historyPlan(id);
    plan.steps.splice(plan.steps.findIndex((s) => s.label === label) + 1, 0, { label: "failure", sql: "INSERT INTO history_missing_test_table VALUES (1)", values: [] });
    await expect(executeHistory(plan.steps)).rejects.toThrow();
    expect(await historySnapshot(id)).toEqual(before);
  });

  it("rejects same-length substituted bytes before seal because exact verification affects zero rows", async () => {
    const id = await seedHistory(), before = await historySnapshot(id), plan = await historyPlan(id);
    const step = plan.steps.find((s) => s.label === "chunk:0:0")!;
    step.values[5] = new Uint8Array(65536).fill(90).buffer;
    await expect(executeHistory(plan.steps)).rejects.toThrow(/HISTORY_CONSTRAINT/);
    expect(await historySnapshot(id)).toEqual(before);
  });

  it.each(["record:0", "payload:0", "chunk:0:0", "ref:source"])("cannot bypass verification by inserting %s pre-verified", async (label) => {
    const id = await seedHistory(), before = await historySnapshot(id), plan = await historyPlan(id);
    const step = plan.steps.find((s) => s.label === label)!;
    step.values[step.values.length - 4] = 1;
    await expect(executeHistory(plan.steps)).rejects.toThrow(/HISTORY_CONSTRAINT/);
    expect(await historySnapshot(id)).toEqual(before);
  });

  it.each(historyTables)("forbids sealed %s UPDATE/DELETE and preserves all history", async (table) => {
    const id = await seedHistory(); await executeHistory((await historyPlan(id)).steps);
    const before = await historySnapshot(id);
    await expect(historyDb.prepare(`UPDATE sermon_history_${table} SET sermon_id=sermon_id WHERE sermon_id=?`).bind(id).run()).rejects.toThrow();
    await expect(historyDb.prepare(`DELETE FROM sermon_history_${table} WHERE sermon_id=?`).bind(id).run()).rejects.toThrow();
    expect(await historySnapshot(id)).toEqual(before);
  });

  it.each(["record:0", "payload:0", "chunk:0:0", "ref:source"])("rejects duplicate keys for %s atomically", async (label) => {
    const id = await seedHistory(), before = await historySnapshot(id), plan = await historyPlan(id);
    const index = plan.steps.findIndex((s) => s.label === label);
    plan.steps.splice(index + 1, 0, structuredClone(plan.steps[index]!));
    await expect(executeHistory(plan.steps)).rejects.toThrow(/UNIQUE|HISTORY_CONSTRAINT/);
    expect(await historySnapshot(id)).toEqual(before);
  });

  it.each(["target", "kind", "forward", "position", "slot", "count", "chunk-gap", "chunk-short", "head-pointer", "source-revision", "fraction", "hash"])("rejects malformed structural projection: %s", async (mutation) => {
    const id = await seedHistory(), before = await historySnapshot(id), plan = await historyPlan(id);
    const ref = plan.steps.find((s) => s.label === "ref:source")!;
    if (mutation === "target") ref.values[4] = "missing-other-sermon-record";
    if (mutation === "kind") ref.values[5] = "revisions";
    if (mutation === "forward") ref.values[4] = plan.revision;
    if (mutation === "position") plan.steps.find((s) => s.label === "record:0")!.values[3] = 2;
    if (mutation === "slot") plan.steps.find((s) => s.label === "record:1")!.values[5] = 2;
    if (mutation === "count") plan.steps[0]!.values[11] = 2;
    if (mutation === "chunk-gap") plan.steps.find((s) => s.label === "chunk:0:1")!.values[2] = 2;
    if (mutation === "chunk-short") plan.steps.find((s) => s.label === "chunk:0:0")!.values[3] = 1;
    if (mutation === "head-pointer") plan.steps.find((s) => s.label === "head")!.values[3] = plan.revision;
    if (mutation === "source-revision") plan.steps.find((s) => s.label === "record:0")!.values[6] = null;
    if (mutation === "fraction") plan.steps.find((s) => s.label === "chunk:0:0")!.values[2] = 0.5;
    if (mutation === "hash") plan.steps.find((s) => s.label === "chunk:0:0")!.values[4] = "z".repeat(64);
    await expect(executeHistory(plan.steps)).rejects.toThrow();
    expect(await historySnapshot(id)).toEqual(before);
  });

  it.each(["record:0", "payload:0", "chunk:0:0", "ref:source"])("blocks INSERT OR REPLACE for %s even during assembly", async (label) => {
    const id = await seedHistory(), before = await historySnapshot(id), plan = await historyPlan(id);
    const index = plan.steps.findIndex((s) => s.label === label), duplicate = structuredClone(plan.steps[index]!);
    duplicate.sql = duplicate.sql.replace("INSERT INTO", "INSERT OR REPLACE INTO");
    plan.steps.splice(index + 1, 0, duplicate);
    await expect(executeHistory(plan.steps)).rejects.toThrow(/HISTORY_CONSTRAINT/);
    expect(await historySnapshot(id)).toEqual(before);
  });

  it.each(["payload:0:verify", "chunk:0:0:verify", "ref:source:verify", "head", "chunk:0:1", "seal"])("reaches the seal guard on silent %s omission and rolls back an existing history", async (label) => {
    const id = await seedHistory(); await executeHistory((await historyPlan(id)).steps);
    const before = await historySnapshot(id), plan = await historyPlan(id);
    plan.steps.find((s) => s.label === label)!.sql += " AND 0";
    await expect(executeHistory(plan.steps)).rejects.toThrow(/HISTORY_CONSTRAINT|FOREIGN KEY/);
    expect(await historySnapshot(id)).toEqual(before);
  });

  it("rejects cross-sermon FK ownership without relying on the reference trigger", async () => {
    const id = await seedHistory(), other = await seedHistory();
    await executeHistory((await historyPlan(other)).steps);
    const before = await historySnapshot(id), plan = await historyPlan(id);
    const foreignRecord = String((await historySnapshot(other))[2]![0]!.record_id);
    plan.steps.find((s) => s.label === "payload:0")!.values[1] = foreignRecord;
    await expect(executeHistory(plan.steps)).rejects.toThrow();
    expect(await historySnapshot(id)).toEqual(before);
  });

  it("rejects a duplicate cross-stream ID and duplicate source/stream positions", async () => {
    for (const field of ["id", "position", "sourceRevision"]) {
      const id = await seedHistory(); await executeHistory((await historyPlan(id)).steps);
      const before = await historySnapshot(id), plan = await historyPlan(id);
      const record = plan.steps.find((s) => s.label === "record:0")!;
      if (field === "id") record.values[1] = before[0]![0]!.current_revision_id as string;
      if (field === "position") record.values[3] = 1;
      if (field === "sourceRevision") record.values[6] = 1;
      await expect(executeHistory(plan.steps)).rejects.toThrow();
      expect(await historySnapshot(id)).toEqual(before);
    }
  });

  it("elects a single same-read claim and gives the loser no child writes", async () => {
    const id = await seedHistory(), a = await historyPlan(id), b = await historyPlan(id);
    const results = await Promise.all([executeHistory(a.steps), executeHistory(b.steps)]);
    expect(results.map((r) => r[0]!.meta.changes).sort()).toEqual([0, 1]);
    const loser = results.find((r) => r[0]!.meta.changes === 0)!;
    expect(loser.every((r) => r.meta.changes === 0)).toBe(true);
    expect((await historySnapshot(id))[1]).toHaveLength(1);
  });
});
