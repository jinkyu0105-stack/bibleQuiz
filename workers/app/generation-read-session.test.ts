import { expect, it } from "vitest";
import { generationDb as db, seedGenerationContext } from "./test/generation-storage-fixture";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { generationReadSession, clearGenerationReads, readTogether } from "../_shared/repositories/generation-read-session";
import { meterD1 } from "../../scripts/p5-71-d1-meter";

it("coalesces immutable reads within one operation while keeping metadata fresh and invalidating after writes/effects", async () => {
  const owner = await seedGenerationContext(), input = createSermonInputStore(db);
  const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript",
    sourceCoverage: "full_transcript", rawTranscriptText: "별도 합성 원문" });
  if (source.outcome !== "validated") throw new Error("fixture");
  await createSermonInputService(input).importPreparedManual(owner.sermonId, 0, source.source,
    { kind: "human", adminId: "a".repeat(64), now: new Date().toISOString() });
  const head = (await input.head(owner.sermonId))!;
  const meter = meterD1(db), scoped = generationReadSession(meter.db);
  const event = () => scoped.prepare("SELECT id FROM sermon_input_events WHERE sermon_id=? AND id=?").bind(owner.sermonId, head.id).first();
  const title = () => scoped.prepare("SELECT title FROM sermon_metadata_drafts WHERE sermon_id=?").bind(owner.sermonId).first("title");
  const initial = await readTogether([event(), title()]);
  expect(meter.counts.d1Calls).toBe(1);
  expect(await event()).toEqual(initial[0]);
  expect(meter.counts.d1Calls).toBe(1);
  await db.prepare("UPDATE sermon_metadata_drafts SET title=? WHERE sermon_id=?").bind("다른 요청에서 바뀐 제목", owner.sermonId).run();
  expect(await title()).toBe("다른 요청에서 바뀐 제목");
  expect(meter.counts.d1Calls).toBe(2);
  clearGenerationReads(scoped);
  expect(await event()).toEqual(initial[0]);
  expect(meter.counts.d1Calls).toBe(3);
  await scoped.prepare("UPDATE sermon_metadata_drafts SET title=? WHERE sermon_id=?").bind("같은 요청의 변경", owner.sermonId).run();
  await event();
  expect(meter.counts.d1Calls).toBe(5);
  const separate = generationReadSession(meter.db);
  await separate.prepare("SELECT id FROM sermon_input_events WHERE sermon_id=? AND id=?").bind(owner.sermonId, head.id).first();
  expect(meter.counts.d1Calls).toBe(6);
});

it("drains a failed batch, returns no partial cache and allows a fresh explicit read", async () => {
  let fail = true, batches = 0;
  const faulty = new Proxy(db, { get(target, key) {
    if (key === "batch") return async (statements: D1PreparedStatement[]) => {
      batches++;
      if (fail) throw new Error("synthetic read failure");
      return target.batch(statements);
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const scoped = generationReadSession(faulty);
  const values = () => [scoped.prepare("SELECT 1 AS n").first("n"), scoped.prepare("SELECT 2 AS n").first("n")];
  await expect(readTogether(values())).rejects.toThrow("synthetic read failure");
  expect(batches).toBe(1);
  fail = false;
  expect(await readTogether(values())).toEqual([1, 2]);
  expect(batches).toBe(2);
  expect(await scoped.prepare("SELECT 1 AS n WHERE 0").raw({ columnNames: true })).toEqual([["n"]]);
});

it("shares an in-flight immutable read but not one across a cleared read window", async () => {
  const owner = await seedGenerationContext();
  const meter = meterD1(db), scoped = generationReadSession(meter.db);
  const read = () => scoped.prepare("SELECT id FROM generation_contexts WHERE sermon_id=?").bind(owner.sermonId).all();
  const before = read();
  const shared = read();
  expect(shared).toBe(before);
  clearGenerationReads(scoped);
  const after = read();
  expect(after).not.toBe(before);
  await readTogether([before, shared, after]);
  expect(meter.counts.sqlStatements).toBe(2);
});

it("keeps the caller budget across independent Workflow windows and stops the 51st real execution", async () => {
  const meter = meterD1(db, 50);
  for (let n = 0; n < 49; n++) await meter.db.prepare("SELECT 1").first();
  for (let unit = 0; unit < 2; unit++) await meter.withinWindow(async () => {
    for (let n = 0; n < 50; n++) await meter.db.prepare("SELECT 1").first();
    expect(() => meter.db.prepare("SELECT 1").first()).toThrow("P571_SIMULATED_D1_RPC_LIMIT");
  });
  await meter.db.prepare("SELECT 1").first();
  expect(() => meter.db.prepare("SELECT 1").first()).toThrow("P571_SIMULATED_D1_RPC_LIMIT");
  expect(meter.counts).toMatchObject({ d1Calls: 150, blockedCalls: 3 });
});

it("bounds retained BLOB memory while returning the complete uncached large result", async () => {
  const owner = await seedGenerationContext();
  const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript",
    sourceCoverage: "full_transcript", rawTranscriptText: "별도 합성 원문" });
  if (source.outcome !== "validated") throw new Error("fixture");
  await createSermonInputService(createSermonInputStore(db)).importPreparedManual(owner.sermonId, 0, source.source,
    { kind: "human", adminId: "a".repeat(64), now: new Date().toISOString() });
  const meter = meterD1(db), scoped = generationReadSession(meter.db);
  const read = (bytes: number) => scoped.prepare("SELECT zeroblob(?) AS body FROM sermon_input_events WHERE sermon_id=?")
    .bind(bytes, owner.sermonId).first<{ body: number[] }>();
  // The database API exposes each BLOB byte as a number. Six hundred thousand
  // bytes exceed the four-MiB retained-array budget; none are truncated.
  expect((await read(600_000))?.body.length).toBe(600_000);
  expect((await read(600_000))?.body.length).toBe(600_000);
  expect(meter.counts.d1Calls).toBe(2);
  expect((await read(65_536))?.body.length).toBe(65_536);
  expect((await read(65_536))?.body.length).toBe(65_536);
  expect(meter.counts.d1Calls).toBe(3);
});
