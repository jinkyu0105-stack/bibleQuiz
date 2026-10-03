import { beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../_shared/db/client";
import { createSermonHistoryReader, SermonHistoryReadError } from "../_shared/repositories/sermon-history-reader";
import { summaryBindingFromIntent } from "../_shared/services/sermon-summary";
import { createTranscriptRevisionService, validateTranscriptState } from "../_shared/services/transcript-revisions";
import type { TranscriptRevisionStore } from "../_shared/services/transcript-revision-contract";
import { encodeHistoryJson } from "../_shared/storage/history-json-codec";
import { historyFixture, historyHarness, historyHead, historyRaw, historySource } from "./test/sermon-history-codec-fixture";
import { observeHistoryReads, seedReadHistory, type ReadProbe } from "./test/sermon-history-read-fixture";
import { historyDb, historySnapshot } from "./test/sermon-history-structure-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";

let h: Awaited<ReturnType<typeof historyFixture>>, sermonId: string;
beforeAll(async () => {
  h = await historyFixture(false, false);
  // Twenty paragraphs project >32 member references, exercising a second reference page.
  const summaryEvent = h.state().summaryEvents[0]!;
  if (summaryEvent.operation.kind !== "generate") throw new Error("fixture");
  const paragraph = summaryEvent.operation.draft.paragraphs[0]!;
  const intent = await h.service.readIntent("test-history-sermon", true);
  if (intent.outcome !== "intent") throw new Error("fixture");
  await h.run({ action: "summary", ...historyHead(h.state()), operation: {
    kind: "generate", binding: summaryBindingFromIntent(intent.view)!,
    draft: { paragraphs: Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(paragraph), id: `paragraph-${i}` })) },
  } });
  sermonId = await seedReadHistory(h);
}, 30_000);

async function corrupt(hook: (p: ReadProbe) => void | Promise<void>, code = "HISTORY_READ_CORRUPT") {
  let caught: unknown;
  try { await createSermonHistoryReader(observeHistoryReads(hook)).read(sermonId); }
  catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(SermonHistoryReadError);
  expect(caught).toMatchObject({ code, message: code });
  expect(caught).not.toHaveProperty("cause");
  const diagnostic = JSON.stringify(caught) + String(caught);
  for (const secret of [historyRaw, "TEST_ONLY_", "test-private-actor", h.state().currentSourceId,
    h.state().revisions[0]!.transcriptSha256]) expect(diagnostic).not.toContain(secret);
}
function on(table: string, change: (rows: Record<string, unknown>[], p: ReadProbe) => void) {
  return (p: ReadProbe) => { if (p.sql.startsWith(`SELECT * FROM sermon_history_${table} `)) change(p.rows, p); };
}

describe("private consistent history reader", () => {
  it("reads every stream/operation/page, freezes the detached result and preserves all tables", async () => {
    const before = await historySnapshot(sermonId), queries: ReadProbe[] = [];
    const result = await createSermonHistoryReader(observeHistoryReads((p) => { queries.push(p); })).read(sermonId);
    expect(result).toEqual({ ...h.state(), sermonId });
    expect(queries.filter((p) => p.sql.includes("FROM sermon_history_commits WHERE")).length).toBeGreaterThan(1);
    expect(queries.filter((p) => p.sql.includes("FROM sermon_history_references WHERE") && Number(p.values[2]) > 0).length).toBeGreaterThan(0);
    function frozen(value: unknown) {
      if (value && typeof value === "object") {
        expect(Object.isFrozen(value)).toBe(true);
        for (const child of Object.values(value)) frozen(child);
      }
    }
    frozen(result);
    expect(result).not.toHaveProperty("storageFormatVersion");
    expect(result).not.toHaveProperty("commitId");
    expect(await historySnapshot(sermonId)).toEqual(before);
    expect(Object.keys(createSermonHistoryReader(historyDb))).toEqual(["read"]);
  });

  it("preserves existing service read/validation outcomes with a test-only read port", async () => {
    const store: TranscriptRevisionStore = { read: () => createSermonHistoryReader(historyDb).read(sermonId),
      async compareAndSwap() { throw new Error("No writer in read tests"); } };
    const service = createTranscriptRevisionService(store);
    // The service requires matching ownership, so compare the same remapped state in memory.
    const memory = createTranscriptRevisionService({ ...store, async read() { return { ...h.state(), sermonId }; } });
    expect(await service.readConfirmed(sermonId)).toEqual(await memory.readConfirmed(sermonId));
    expect(await service.readIntent(sermonId, true)).toEqual(await memory.readIntent(sermonId, true));
    expect(await service.readSummary(sermonId, true)).toEqual(await memory.readSummary(sermonId, true));
    for (const difficulty of ["child", "adult"] as const)
      expect(await service.readCandidates(sermonId, difficulty, true)).toEqual(await memory.readCandidates(sermonId, difficulty, true));
  }, 15_000);

  it("round-trips timed text, overlapping fractional times, repeated confirmation and source replacement", async () => {
    const timed = await historyFixture(true, true), id = await seedReadHistory(timed);
    expect(await createSermonHistoryReader(historyDb).read(id)).toEqual({ ...timed.state(), sermonId: id });
  }, 30_000);

  it("reads a 1MiB escaped source in >2MB records across all chunk pages without truncation", async () => {
    const large = historyHarness();
    await large.run({ action: "import_source", expectedVersion: 0, payload: await historySource(false, "\\".repeat(1_048_576)) });
    const id = await seedReadHistory(large), cursors: number[] = [];
    const result = await createSermonHistoryReader(observeHistoryReads((p) => {
      if (p.sql.startsWith("SELECT * FROM sermon_history_chunks")) cursors.push(Number(p.values[2]));
    })).read(id);
    expect(result).toEqual({ ...large.state(), sermonId: id });
    expect(Math.max(...cursors)).toBeGreaterThan(28);
  }, 30_000);

  it("returns null only for an existing sermon with no history, with no initialization writes", async () => {
    const id = crypto.randomUUID();
    await seedMetadataSermon(createDatabase(historyDb), id);
    const before = await historySnapshot(id);
    expect(await createSermonHistoryReader(historyDb).read(id)).toBeNull();
    expect(await historySnapshot(id)).toEqual(before);
    await expect(createSermonHistoryReader(historyDb).read("missing-sermon")).rejects.toMatchObject({ code: "HISTORY_READ_CORRUPT" });
  });

  it("rejects invalid sermon keys before DB access", async () => {
    let calls = 0;
    await expect(createSermonHistoryReader(observeHistoryReads(() => { calls++; })).read("bad/private"))
      .rejects.toMatchObject({ code: "HISTORY_READ_INVALID" });
    expect(calls).toBe(0);
  });

  it("uses raw binding prepare with its always-primary session, never withSession", async () => {
    // Local workerd implementation evidence, not a claim of remote replication testing.
    const session = Reflect.get(historyDb, "alwaysPrimarySession") as object;
    expect(session.constructor.name).toBe("D1DatabaseSessionAlwaysPrimary");
    expect(historyDb.prepare.toString()).toContain("alwaysPrimarySession");
    const bound = new Proxy(historyDb, { get(target, key) {
      if (key === "withSession") throw new Error("Sessions must not be enabled by reader");
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    expect((await createSermonHistoryReader(bound).read(sermonId))?.version).toBe(h.state().version);
  });

  it.each([
    ["head format", "heads", (r: Record<string, unknown>) => { r.storage_format_version = 2; }],
    ["head commit", "heads", (r) => { r.commit_id = "wrong-commit"; }],
    ["head pointer", "heads", (r) => { r.current_revision_id = h.state().revisions[0]!.id; }],
    ["head scope", "heads", (r) => { r.sermon_id = "other-sermon"; }],
    ["assembling", "commits", (r) => { r.state = "assembling"; }],
    ["chain", "commits", (r) => { r.previous_commit_id = "wrong-previous"; }],
    ["version", "commits", (r) => { r.version = 2; }],
    ["count", "commits", (r) => { r.intentEvents_count = 1; }],
    ["command", "commits", (r) => { r.command = "revisions"; }],
    ["byte total", "commits", (r) => { r.byte_length = Number(r.byte_length) + 1; }],
    ["chunk total", "commits", (r) => { r.chunk_count = 99; }],
    ["ref total", "commits", (r) => { r.reference_count = 99; }],
    ["record total", "commits", (r) => { r.record_count = 99; }],
    ["manifest total", "commits", (r) => { r.manifest_count = 99; }],
    ["commit pointer", "commits", (r) => { r.current_confirmation_id = "wrong-confirmation"; }],
    ["record order", "records", (r) => { r.stream_position = 2; }],
    ["record slot", "records", (r) => { r.commit_slot = 1; }],
    ["record version", "records", (r) => { r.commit_version = 2; }],
    ["source revision", "records", (r) => { r.source_revision = 2; }],
    ["difficulty", "records", (r) => { r.difficulty = "child"; }],
    ["codec", "payloads", (r) => { r.codec = "unknown"; }],
    ["payload hash", "payloads", (r) => { r.payload_sha256 = "0".repeat(64); }],
    ["manifest length", "payloads", (r) => { r.byte_length = Number(r.byte_length) + 1; }],
    ["chunk gap", "chunks", (r) => { r.chunk_index = 1; }],
    ["chunk hash", "chunks", (r) => { r.chunk_sha256 = "0".repeat(64); }],
    ["chunk length", "chunks", (r) => { r.byte_length = Number(r.byte_length) + 1; }],
    ["same length byte", "chunks", (r) => { (r.body as number[])[0] = 0; }],
    ["wrong record chunk", "chunks", (r) => { r.record_id = "other-record"; }],
    ["string blob", "chunks", (r) => { r.body = "not-blob"; }],
    ["reference target", "references", (r) => { r.target_record_id = "other-record"; }],
    ["reference path", "references", (r) => { r.payload_path = "/wrong"; }],
    ["reference member", "references", (r) => { r.target_member_id = "other-member"; }],
  ] satisfies [string, string, (row: Record<string, unknown>) => void][])("rejects %s corruption", async (_name, table, change) => {
    await corrupt(on(table, (rows) => { if (rows[0]) change(rows[0]); }));
  });

  it.each(["records", "payloads", "chunks", "references"])("does not trust %s verified flags", async (table) => {
    await corrupt(on(table, (rows) => { if (rows[0]) rows[0].verified = 0; }));
  });
  it.each(["commits", "records", "payloads", "chunks", "references"])("rejects missing %s instead of partial/null success", async (table) => {
    await corrupt(on(table, (rows) => { rows.length = 0; }));
  });
  it.each(["commits", "records", "payloads", "chunks", "references"])("rejects duplicate %s", async (table) => {
    await corrupt(on(table, (rows) => { if (rows[0]) rows.push(structuredClone(rows[0])); }));
  });
  it("rejects head absence with residual history", async () => {
    await corrupt(on("heads", (rows) => { rows.length = 0; }));
  });
  it("rejects orphan/incomplete history found by the independent integrity probe", async () => {
    await corrupt((p) => { if (p.sql.includes("AS invalid")) p.rows[0]!.invalid = 1; });
  });
  it("rejects a truncated non-final commit page even if it looks like a short page", async () => {
    await corrupt(on("commits", (rows) => { rows.splice(5); }));
  });
  it("rejects transport errors with fixed private-safe diagnostics", async () => {
    await corrupt(() => { throw new Error(historyRaw); }, "HISTORY_READ_UNAVAILABLE");
  });
  it.each(["version", "commit_id", "current_source_id", "current_revision_id", "current_confirmation_id"])("compares H1 %s even after a complete read", async (key) => {
    let reads = 0;
    await corrupt(on("heads", (rows) => {
      if (++reads === 2) rows[0]![key] = key === "version" ? h.state().version + 2 : "different";
    }), "HISTORY_READ_CHANGED");
  });

  it("revalidates domain evidence after storage hashes and reference projection pass", async () => {
    const record = h.records.find((r) => r.envelope.stream === "intentEvents")!;
    const payload = structuredClone(record.payload);
    if (!("operation" in payload) || payload.operation.kind !== "analysis") throw new Error("fixture");
    payload.operation.analysis.centralMessage[0]!.evidence[0]!.quote = "거짓 근거 😀";
    const encoded = await encodeHistoryJson(payload);
    await corrupt((p) => {
      if (p.values[1] !== record.envelope.recordId) return;
      if (p.sql.startsWith("SELECT * FROM sermon_history_payloads")) {
        p.rows[0]!.payload_sha256 = encoded.manifest.payloadSha256;
        expect(p.rows[0]!.byte_length).toBe(encoded.manifest.byteLength);
      }
      if (p.sql.startsWith("SELECT * FROM sermon_history_chunks")) {
        const c = encoded.chunks[0]!;
        p.rows[0]!.body = [...c.body]; p.rows[0]!.chunk_sha256 = c.chunkSha256;
      }
    });
    await expect(validateTranscriptState({ ...h.state(), intentEvents: [payload, ...h.state().intentEvents.slice(1)] }, "test-history-sermon"))
      .rejects.toBeInstanceOf(Error);
  });

  it("bounds commit pages at H0 and rejects an actual new import between pages", async () => {
    const racing = await historyFixture(false, false), id = await seedReadHistory(racing);
    const originalVersion = racing.state().version;
    let injected = false;
    const reader = createSermonHistoryReader(observeHistoryReads(async (p) => {
      if (p.sql.startsWith("SELECT * FROM sermon_history_commits WHERE")) {
        expect(p.values[1]).toBe(originalVersion);
        if (!injected) {
          injected = true;
          await racing.run({ action: "import_source", expectedVersion: originalVersion, payload: await historySource(true) });
          await seedReadHistory(racing, id, originalVersion);
        }
      }
    }));
    await expect(reader.read(id)).rejects.toMatchObject({ code: "HISTORY_READ_CHANGED" });
    expect(await createSermonHistoryReader(historyDb).read(id)).toEqual({ ...racing.state(), sermonId: id });
  }, 30_000);

  it("rejects actual edit/restore ABA with the same text but a newer version", async () => {
    const racing = historyHarness();
    await racing.run({ action: "import_source", expectedVersion: 0, payload: await historySource() });
    const id = await seedReadHistory(racing), original = racing.state(), originalRevision = original.currentRevisionId;
    let injected = false;
    const reader = createSermonHistoryReader(observeHistoryReads(async (p) => {
      if (!injected && p.sql.startsWith("SELECT * FROM sermon_history_commits WHERE")) {
        injected = true;
        await racing.run({ action: "edit", ...historyHead(racing.state()), content: { format: "plain_text", text: "TEST_ONLY_CHANGED" } });
        await racing.run({ action: "restore", ...historyHead(racing.state()), restoreRevisionId: originalRevision });
        await seedReadHistory(racing, id, original.version);
      }
    }));
    await expect(reader.read(id)).rejects.toMatchObject({ code: "HISTORY_READ_CHANGED" });
    expect(racing.state().revisions.at(-1)!.transcriptSha256).toBe(original.revisions[0]!.transcriptSha256);
    expect((await createSermonHistoryReader(historyDb).read(id))?.version).toBe(original.version + 2);
  });

  it("rejects initialization between absence check and H1 without returning false null", async () => {
    const racing = historyHarness(), id = crypto.randomUUID();
    await seedMetadataSermon(createDatabase(historyDb), id);
    await racing.run({ action: "import_source", expectedVersion: 0, payload: await historySource() });
    let injected = false;
    const reader = createSermonHistoryReader(observeHistoryReads(async (p) => {
      if (!injected && p.sql.includes("AS invalid")) {
        injected = true;
        await seedReadHistory(racing, id, 0, false);
      }
    }));
    await expect(reader.read(id)).rejects.toMatchObject({ code: "HISTORY_READ_CHANGED" });
    expect((await createSermonHistoryReader(historyDb).read(id))?.version).toBe(1);
  });
});
