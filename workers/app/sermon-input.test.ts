import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_BYTES,
  ADMIN_SERMON_INPUT_HISTORY_LIMIT,
} from "../../shared/api/admin-sermon-input";
import { createDatabase } from "../_shared/db/client";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { createSermonInputService, inputExpectation } from "../_shared/services/sermon-input";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { historyDb } from "./test/sermon-history-structure-fixture";
import { historyHarness, historyHuman, historyRaw, historySource } from "./test/sermon-history-codec-fixture";
import { seedReadHistory } from "./test/sermon-history-read-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";
import { hash, originalContent } from "../_shared/services/transcript-content";
import { materializeCorrectionDocument } from "../_shared/services/transcript-correction-document";

async function caption(text = historyRaw) {
  const result = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript", rawTranscriptText: text });
  if (result.outcome !== "validated") throw new Error("Synthetic source invalid");
  return result.source;
}
async function harness(database = historyDb) {
  const sermonId = crypto.randomUUID();
  await seedMetadataSermon(createDatabase(historyDb), sermonId);
  const store = createSermonInputStore(database);
  const service = createSermonInputService(store);
  const run = async (command: unknown) => service.execute(sermonId, command, historyHuman);
  const save = async (command: unknown) => {
    const result = await run(command);
    if (result.outcome !== "saved") throw new Error(result.code);
    return result.head;
  };
  const head = async () => (await store.head(sermonId))!;
  const events = async () => (await historyDb.prepare("SELECT * FROM sermon_input_events WHERE sermon_id = ? ORDER BY version").bind(sermonId).all()).results;
  return { sermonId, store, service, run, save, head, events };
}
function observed(mode: "normal" | "lost" | "sparse" | "no-seal" | "no-chunks" | "no-head" | "unavailable" = "normal") {
  const sql: string[] = [];
  let written = false;
  const database = new Proxy(historyDb, {
    get(target, key) {
      if (key === "prepare") return (query: string) => {
        sql.push(query);
        if (mode === "unavailable" && written && query.startsWith("SELECT")) throw new Error("TEST_ONLY_PRIVATE_SECRET");
        return target.prepare(query);
      };
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        const selected = mode === "no-seal" ? statements.slice(0, -1) : mode === "no-chunks" ? [statements[0]!, ...statements.slice(2)] : mode === "no-head" ? [...statements.slice(0, -2), statements.at(-1)!] : statements;
        const results = await target.batch(selected); written = true;
        if (mode === "lost" || mode === "unavailable") throw new Error("TEST_ONLY_PRIVATE_SECRET");
        if (mode === "sparse") delete results[1];
        return results;
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { database, sql };
}
describe("D-031 selected input storage (local synthetic only)", () => {
  it.each(["가", "😀"])("enforces D-033 at prepared/plain import and edit for %s", async character => {
    for (const size of [29_999, 30_000, 30_001]) {
      const tracked = observed(); const h = await harness(tracked.database);
      const payload = await caption(character.repeat(size));
      const result = await h.service.importPreparedManual(h.sermonId, 0, payload, historyHuman);
      expect(result.outcome).toBe(size <= 30_000 ? "saved" : "failed");
      if (size > 30_000) {
        expect(result).toMatchObject({ code: "INPUT_TOO_LARGE" });
        expect(tracked.sql).toEqual([]);
        expect(await h.run({ action: "import_source", expectedVersion: 0, payload })).toMatchObject({ code: "INPUT_TOO_LARGE" });
        expect(await h.events()).toEqual([]);
      } else {
        expect(await h.store.payload(await h.head())).toEqual(payload);
        const before = await h.head();
        await h.save({ action: "edit", ...inputExpectation(before), content: { format: "plain_text", text: character.repeat(30_000) } });
        const saved = await h.head(); const events = await h.events();
        expect(await h.run({ action: "edit", ...inputExpectation(saved), content: { format: "plain_text", text: character.repeat(30_001) } })).toMatchObject({ code: "INPUT_TOO_LARGE" });
        expect(await h.head()).toEqual(saved); expect(await h.events()).toEqual(events);
        expect(await h.run({ action: "import_source", expectedVersion: saved.version, payload: await caption(character.repeat(30_001)) })).toMatchObject({ code: "INPUT_TOO_LARGE" });
        expect(await h.events()).toEqual(events);
      }
    }
  });
  it("counts timed captions with LF separators and rejects oversized import/edit without writes", async () => {
    const template = await historySource(true);
    if (template.sourceMode !== "public_unofficial") throw new Error("Synthetic invalid");
    for (const size of [29_999, 30_000, 30_001]) {
      const h = await harness();
      const segments = [{ text: "가".repeat(15_000), start: 0, duration: 1 }, { text: "나".repeat(size - 15_001), start: 1, duration: 1 }];
      const payload = { ...template, segments, sourceSha256: await hash(JSON.stringify(segments)) };
      const result = await h.run({ action: "import_source", expectedVersion: 0, payload });
      if (size > 30_000) {
        expect(result).toMatchObject({ code: "INPUT_TOO_LARGE" }); expect(await h.events()).toEqual([]);
      } else {
        expect(result.outcome).toBe("saved");
        const head = await h.head();
        const content = { format: "timed_segments", segments: segments.map((s, i) => ({ ...s, segmentId: `segment-${i + 1}`, text: i === 1 ? "나".repeat(14_999) : s.text })) };
        await h.save({ action: "edit", ...inputExpectation(head), content });
        const current = await h.head(); const before = await h.events();
        content.segments[1]!.text += "다";
        expect(await h.run({ action: "edit", ...inputExpectation(current), content })).toMatchObject({ code: "INPUT_TOO_LARGE" });
        expect(await h.events()).toEqual(before);
      }
    }
  });
  it.each([29_999, 30_000])("checks the final AI merge length from %i characters", async size => {
    const h = await harness(); const payload = await caption("가".repeat(size));
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload });
    const proposed = await h.save({ action: "propose_corrections", ...inputExpectation(first), proposal: {
      sourceId: first.source_id, sourceSha256: payload.rawTranscriptSha256, baseDocumentId: first.document_id,
      baseDocumentSha256: first.document_sha256, items: [{ ...item("가"), proposedText: "가가", contextAfter: "가".repeat(120) }],
    } });
    const decision = await h.save({ action: "decide_corrections", ...inputExpectation(proposed), proposalId: proposed.id, decisions: [{ itemId: "fix", decision: "accepted" }], reviewed: true });
    const before = await h.events(); const previousHead = await h.head();
    const result = await h.run({ action: "merge_corrections", ...inputExpectation(decision), proposalId: proposed.id });
    if (size === 30_000) {
      expect(result).toMatchObject({ code: "INPUT_TOO_LARGE" });
      expect(await h.head()).toEqual(previousHead); expect(await h.events()).toEqual(before);
    } else {
      expect(result.outcome).toBe("saved");
      expect(await h.store.payload(await h.head())).toEqual({ format: "plain_text", text: "가".repeat(30_000) });
    }
  });
  it("keeps a pre-policy oversized document readable but refuses to restore it as a new write", async () => {
    const h = await harness();
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload: await caption() });
    const text = "가".repeat(30_001); const legacyId = crypto.randomUUID();
    // Seed an existing selected-format record directly, not through the new-write policy.
    expect(await h.store.append({ ...first, id: legacyId, version: 2, kind: "edit", document_id: legacyId,
      parent_document_id: first.document_id, document_sha256: await hash(text) }, { format: "plain_text", text })).toBe("saved");
    const old = await h.head();
    const current = await h.save({ action: "edit", ...inputExpectation(old), content: { format: "plain_text", text: "가".repeat(30_000) } });
    const before = await h.events(); const previousHead = await h.head();
    const comparison = await h.service.comparison(h.sermonId, first.source_id, legacyId, current.id);
    expect(comparison.outcome).toBe("loaded");
    if (comparison.outcome !== "loaded") throw new Error("Synthetic comparison missing");
    expect(comparison.comparison.left.content).toEqual({ format: "plain_text", text });
    expect(await h.run({ action: "restore", ...inputExpectation(current), restoreDocumentId: legacyId })).toMatchObject({ code: "INPUT_TOO_LARGE" });
    expect(await h.events()).toEqual(before); expect(await h.head()).toEqual(previousHead);
  });
  it("still validates the separately supplied version before any prepared import DB access", async () => {
    const tracked = observed(); const h = await harness(tracked.database);
    for (const version of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "0", null]) {
      expect(await h.service.importPreparedManual(h.sermonId, version as number, await caption(), historyHuman)).toMatchObject({ outcome: "failed", code: "INPUT_INVALID" });
    }
    expect(tracked.sql).toEqual([]);
  });
  it("uses the atomic first-import claim without a separate head read", async () => {
    const tracked = observed(); const h = await harness(tracked.database);
    expect(await h.service.importPreparedManual(h.sermonId, 0, await caption("가".repeat(30_000)), historyHuman)).toMatchObject({ outcome: "saved" });
    expect(tracked.sql).toHaveLength(4);
    expect(tracked.sql.some(sql => sql.startsWith("SELECT"))).toBe(false);
    expect(await h.events()).toHaveLength(1);
  });
  it("keeps one winner and no loser records for 20 separately prepared atomic imports", async () => {
    const h = await harness();
    const prepared = await Promise.all(Array.from({ length: 20 }, () => caption("가".repeat(30_000))));
    const results = await Promise.all(prepared.map(payload => h.service.importPreparedManual(h.sermonId, 0, payload, historyHuman)));
    expect(results.filter(r => r.outcome === "saved")).toHaveLength(1);
    expect(results.filter(r => r.outcome === "failed" && r.code === "INPUT_CONFLICT")).toHaveLength(19);
    expect(await h.events()).toHaveLength(1);
  });
  it("saves 20 independent 30000-character captions concurrently", async () => {
    const cases = await Promise.all(Array.from({ length: 20 }, () => harness()));
    const results = await Promise.all(cases.map(async h => h.service.importPreparedManual(h.sermonId, 0, await caption("가".repeat(30_000)), historyHuman)));
    expect(results.every(r => r.outcome === "saved")).toBe(true);
    for (const h of cases) expect(await h.events()).toHaveLength(1);
  });
  it.each(["no-seal", "no-chunks", "no-head"] as const)("rolls back prepared first import with %s", async mode => {
    const h = await harness(observed(mode).database);
    expect(await h.service.importPreparedManual(h.sermonId, 0, await caption(), historyHuman)).toMatchObject({ outcome: "failed" });
    expect(await h.events()).toEqual([]); expect(await h.head()).toBeNull();
  });
  it.each(["lost", "sparse", "unavailable"] as const)("keeps own-attempt proof for prepared first import with %s response", async mode => {
    const h = await harness(observed(mode).database);
    const result = await h.service.importPreparedManual(h.sermonId, 0, await caption(), historyHuman);
    expect(result).toMatchObject(mode === "unavailable" ? { outcome: "failed", code: "INPUT_SAVE_UNCERTAIN" } : { outcome: "saved" });
    expect(await h.events()).toHaveLength(1);
  });
  it("hands a freshly validated immutable source to import once without hashing it twice", async () => {
    const h = await harness();
    const payload = await caption("TEST_ONLY_ONE_PREPARATION 😀");
    const hashing = vi.spyOn(crypto.subtle, "digest");
    try {
      expect(await h.service.importPreparedManual(h.sermonId, 0, payload, historyHuman)).toMatchObject({ outcome: "saved" });
      expect(hashing).toHaveBeenCalledTimes(1); // Stored JSON digest still required.
      hashing.mockClear();
      const second = await harness();
      expect(await second.service.importPreparedManual(second.sermonId, 0, payload, historyHuman)).toMatchObject({ outcome: "saved" });
      expect(hashing).toHaveBeenCalledTimes(2); // Consumed capability must reverify.
    } finally { hashing.mockRestore(); }
    expect(await h.store.payload(await h.head())).toEqual(payload);
  });
  it("does not trust copied, altered or serialized prepared source objects", async () => {
    const payload = await caption();
    for (const copy of [{ ...payload, rawTranscriptText: "TEST_ONLY_FORGED" },
      { ...payload, rawTranscriptSha256: "0".repeat(64) },
      { ...payload, sourceCoverage: "unsupported" }]) {
      const h = await harness();
      expect(await h.service.importPreparedManual(h.sermonId, 0, copy, historyHuman)).toMatchObject({ outcome: "failed", code: "INPUT_INVALID" });
      expect(await h.events()).toEqual([]);
    }
    const h = await harness();
    const hashing = vi.spyOn(crypto.subtle, "digest");
    try {
      expect(await h.service.importPreparedManual(h.sermonId, 0, JSON.parse(JSON.stringify(payload)), historyHuman)).toMatchObject({ outcome: "saved" });
      expect(hashing).toHaveBeenCalledTimes(2);
    } finally { hashing.mockRestore(); }
  });
  it("keeps command/context validation and stale-version rejection on the handoff path", async () => {
    const h = await harness();
    expect(await h.service.importPreparedManual(h.sermonId, 0, await caption(), { ...historyHuman, extra: true })).toMatchObject({ code: "INPUT_INVALID" });
    expect(await h.events()).toEqual([]);
    const payload = await caption();
    expect(Reflect.set(payload, "rawTranscriptText", "TEST_ONLY_CHANGED")).toBe(false);
    expect(await h.service.importPreparedManual(h.sermonId, 0, payload, historyHuman)).toMatchObject({ outcome: "saved" });
    expect(await h.service.importPreparedManual(h.sermonId, 0, await caption(), historyHuman)).toMatchObject({ code: "INPUT_CONFLICT" });
    expect(await h.events()).toHaveLength(1);
  });
  it("encodes the stored JSON once for its length and exact payload digest", async () => {
    const h = await harness();
    const payload = await caption("TEST_ONLY_STORED_BYTES 😀\r\n");
    const text = JSON.stringify(payload);
    const encoding = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      await h.save({ action: "import_source", expectedVersion: 0, payload });
      expect(encoding.mock.calls.filter(([value]) => value === text)).toHaveLength(1);
    } finally { encoding.mockRestore(); }
    expect(await h.store.payload(await h.head())).toEqual(payload);
  });
  it("imports one lossless original and no copied revision; normal success performs no body readback", async () => {
    const tracked = observed(); const h = await harness(tracked.database);
    const payload = await caption();
    const head = await h.save({ action: "import_source", expectedVersion: 0, payload });
    expect(head.source_id).toBe(head.document_id);
    expect((await h.events()).map((e) => e.kind)).toEqual(["source"]);
    expect(tracked.sql.filter((sql) => sql.startsWith("SELECT"))).toHaveLength(1);
    expect(await h.store.payload(await h.head())).toEqual(payload);
  });
  it("confirms the original without making a revision or reading its body", async () => {
    const tracked = observed(); const h = await harness(tracked.database);
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload: await caption() });
    tracked.sql.length = 0;
    const confirmed = await h.save({ action: "confirm", ...inputExpectation(first), reviewed: true });
    expect(confirmed.document_id).toBe(first.id); expect(confirmed.confirmation_id).toBe(confirmed.id);
    expect(tracked.sql.filter((sql) => sql.startsWith("SELECT"))).toHaveLength(1);
    expect((await h.events()).map((e) => e.kind)).toEqual(["source", "confirm"]);
  });
  it("keeps all revisions; plain caption edits read no old body, irrespective of old history", async () => {
    const tracked = observed(); const h = await harness(tracked.database);
    let head = await h.save({ action: "import_source", expectedVersion: 0, payload: await caption() });
    for (let i = 0; i < 8; i++) {
      tracked.sql.length = 0;
      head = await h.save({ action: "edit", ...inputExpectation(head), content: { format: "plain_text", text: `TEST_ONLY_EDIT_${i}` } });
      expect(tracked.sql.filter((sql) => sql.startsWith("SELECT"))).toHaveLength(1);
      expect(tracked.sql.filter((sql) => sql.includes("FROM sermon_input_chunks"))).toHaveLength(0);
    }
    expect(await h.events()).toHaveLength(9);
  });
  it("restores selected content as a new document, invalidates confirmation and rejects old versions/other sources", async () => {
    const h = await harness();
    const original = await h.save({ action: "import_source", expectedVersion: 0, payload: await caption() });
    const edited = await h.save({ action: "edit", ...inputExpectation(original), content: { format: "plain_text", text: "TEST_ONLY_EDIT" } });
    const confirmed = await h.save({ action: "confirm", ...inputExpectation(edited), reviewed: true });
    const restored = await h.save({ action: "restore", ...inputExpectation(confirmed), restoreDocumentId: original.id });
    expect(restored.document_id).not.toBe(original.id); expect(restored.confirmation_id).toBeNull();
    expect(await h.store.payload(await h.head())).toEqual({ format: "plain_text", text: historyRaw });
    expect(await h.run({ action: "edit", ...inputExpectation(edited), content: { format: "plain_text", text: "STALE" } })).toMatchObject({ outcome: "failed", code: "INPUT_CONFLICT" });
    const other = await h.save({ action: "import_source", expectedVersion: restored.version, payload: await caption("TEST_ONLY_OTHER_SOURCE") });
    expect(await h.run({ action: "restore", ...inputExpectation(other), restoreDocumentId: original.id })).toMatchObject({ outcome: "failed" });
    expect(await h.events()).toHaveLength(5);
  });
  it.each(["sermon_manuscript", "sermon_summary"] as const)("blocks all five editing actions on pastor-provided %s", async (manualSourceKind) => {
    const h = await harness();
    const prepared = await prepareManualTranscriptSource({ sourceMode: "sermon_notes", manualSourceKind, sourceCoverage: "partial_notes", rawTranscriptText: "TEST_ONLY_PASTOR" });
    if (prepared.outcome !== "validated") throw new Error("Synthetic invalid");
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload: prepared.source });
    const proposal = { sourceId: first.source_id, sourceSha256: prepared.source.rawTranscriptSha256, baseDocumentId: first.document_id, baseDocumentSha256: first.document_sha256, items: [item("TEST_ONLY_PASTOR")] };
    for (const action of [
      { action: "edit", content: { format: "plain_text", text: "TEST_ONLY_EDIT" } },
      { action: "restore", restoreDocumentId: first.id },
      { action: "propose_corrections", proposal },
      { action: "decide_corrections", proposalId: first.id, decisions: [{ itemId: "fix", decision: "accepted" }], reviewed: true },
      { action: "merge_corrections", proposalId: first.id },
    ]) expect(await h.run({ ...action, ...inputExpectation(first) })).toMatchObject({ outcome: "failed", code: "INPUT_READ_ONLY" });
    expect(await h.events()).toHaveLength(1);
    await h.save({ action: "confirm", ...inputExpectation(first), reviewed: true });
  });
  it("supports AI proposal→human decision→merge directly on the original, without a fake revision", async () => {
    const h = await harness(); const payload = await caption("TEST_ONLY_WRONG");
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload });
    const proposed = await h.save({ action: "propose_corrections", ...inputExpectation(first), proposal: {
      sourceId: first.source_id, sourceSha256: payload.rawTranscriptSha256, baseDocumentId: first.document_id,
      baseDocumentSha256: first.document_sha256, items: [item("TEST_ONLY_WRONG")],
    } });
    expect(proposed.document_id).toBe(first.id);
    const decision = await h.save({ action: "decide_corrections", ...inputExpectation(proposed), proposalId: proposed.id, decisions: [{ itemId: "fix", decision: "accepted" }], reviewed: true });
    expect(await h.run({ action: "decide_corrections", ...inputExpectation(decision), proposalId: proposed.id, decisions: [{ itemId: "fix", decision: "rejected" }], reviewed: true })).toMatchObject({ outcome: "failed" });
    const merged = await h.save({ action: "merge_corrections", ...inputExpectation(decision), proposalId: proposed.id });
    expect(merged.confirmation_id).toBeNull();
    expect(await h.store.payload(await h.head())).toEqual({ format: "plain_text", text: "TEST_ONLY_CORRECT" });
    expect((await h.events()).map((e) => e.kind)).toEqual(["source", "proposal", "decision", "merge"]);
  });
  it("keeps a document proposal separate until human adoption and confirmation", async () => {
    const h = await harness(); const source = await caption("TEST_ONLY_WRONG");
    const original = await h.save({ action: "import_source", expectedVersion: 0, payload: source });
    const confirmed = await h.save({ action: "confirm", ...inputExpectation(original), reviewed: true });
    const proposalId = crypto.randomUUID();
    const payload = { kind: "correction_document_v1", sourceId: original.source_id,
      sourceSha256: source.rawTranscriptSha256, baseDocumentId: original.document_id,
      baseDocumentSha256: original.document_sha256,
      content: { format: "plain_text", text: "TEST_ONLY_CORRECT" } };
    expect(await h.store.append({ ...confirmed, id: proposalId, version: confirmed.version + 1,
      kind: "proposal", parent_document_id: confirmed.document_id, related_id: null,
      actor_id: historyHuman.adminId, created_at: historyHuman.now }, payload)).toBe("saved");
    const proposed = await h.head();
    expect(proposed.document_id).toBe(original.document_id);
    expect(proposed.confirmation_id).toBe(confirmed.id);
    const detail = await h.service.correctionDetail(h.sermonId, proposalId);
    expect(detail).toMatchObject({ outcome: "loaded", correction: { proposal: {
      kind: "correction_document_v1", content: payload.content,
    } } });
    const edited = { format: "plain_text", text: "TEST_ONLY_HUMAN_EDIT" };
    expect(await h.run({ action: "merge_corrections", ...inputExpectation(proposed), proposalId })).toMatchObject({ code: "INPUT_INVALID" });
    const adopted = await h.save({ action: "apply_correction_document", ...inputExpectation(proposed), proposalId,
      reviewed: true, content: edited });
    expect(adopted.kind).toBe("merge");
    expect(adopted.related_id).toBe(proposalId);
    expect(adopted.confirmation_id).toBeNull();
    expect(await h.store.payload(await h.store.event(h.sermonId, adopted.id) as NonNullable<Awaited<ReturnType<typeof h.store.event>>>)).toEqual(edited);
    expect(await h.store.payload(await h.store.event(h.sermonId, original.id) as NonNullable<Awaited<ReturnType<typeof h.store.event>>>)).toEqual(source);
    expect(await h.store.payload(await h.store.event(h.sermonId, proposalId) as NonNullable<Awaited<ReturnType<typeof h.store.event>>>)).toEqual(payload);
    expect(await h.run({ action: "apply_correction_document", ...inputExpectation(proposed), proposalId, reviewed: true })).toMatchObject({ code: "INPUT_CONFLICT" });
    const final = await h.save({ action: "confirm", ...inputExpectation(adopted), reviewed: true });
    expect(final.confirmation_id).toBe(final.id);
    expect((await h.events()).map((event) => event.kind)).toEqual(["source", "confirm", "proposal", "merge", "confirm"]);
  });
  it("rejects stale and oversized document adoption without writing", async () => {
    const h = await harness(); const source = await caption("TEST_ONLY_BASE");
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload: source });
    const proposalId = crypto.randomUUID();
    expect(await h.store.append({ ...first, id: proposalId, version: 2, kind: "proposal",
      parent_document_id: first.document_id, related_id: null, actor_id: historyHuman.adminId,
      created_at: historyHuman.now }, { kind: "correction_document_v1", sourceId: first.source_id,
      sourceSha256: source.rawTranscriptSha256, baseDocumentId: first.document_id,
      baseDocumentSha256: first.document_sha256, content: { format: "plain_text", text: "TEST_ONLY_PROPOSAL" } })).toBe("saved");
    const proposed = await h.head(); const before = await h.events();
    expect(await h.run({ action: "apply_correction_document", ...inputExpectation(proposed), proposalId,
      reviewed: true, content: { format: "plain_text", text: "가".repeat(30_001) } })).toMatchObject({ code: "INPUT_TOO_LARGE" });
    expect(await h.events()).toEqual(before);
    const edited = await h.save({ action: "edit", ...inputExpectation(proposed), content: { format: "plain_text", text: "TEST_ONLY_CHANGED" } });
    expect(await h.run({ action: "apply_correction_document", ...inputExpectation(edited), proposalId, reviewed: true })).toMatchObject({ code: "INPUT_INVALID" });
    expect((await h.events()).map((event) => event.kind)).toEqual(["source", "proposal", "edit"]);
  });
  it("reconstructs timed correction without accepting invented times or order", async () => {
    const base = { format: "timed_segments" as const, segments: [
      { segmentId: "one", text: "TEST_ONLY_FIRST", start: 1, duration: 2 },
      { segmentId: "two", text: "TEST_ONLY_SECOND", start: 3, duration: 2 },
    ] };
    expect(materializeCorrectionDocument(base, { format: "timed_segments", segments: [
      { segmentId: "one", text: "TEST_ONLY_FIXED" }, { segmentId: "two", text: "TEST_ONLY_SECOND" },
    ] })).toEqual({ ...base, segments: [{ ...base.segments[0], text: "TEST_ONLY_FIXED" }, base.segments[1]] });
    expect(materializeCorrectionDocument(base, { format: "timed_segments", segments: [
      { segmentId: "two", text: "TEST_ONLY_FIXED" }, { segmentId: "one", text: "TEST_ONLY_SECOND" },
    ] })).toBeNull();
    expect(materializeCorrectionDocument(base, { format: "timed_segments", segments: [
      { segmentId: "one", text: "TEST_ONLY_FIXED", start: 0 }, { segmentId: "two", text: "TEST_ONLY_SECOND" },
    ] })).toBeNull();
  });
  it("adopts a timed document while preserving source segment times", async () => {
    const h = await harness(), source = await historySource(true);
    if (source.sourceMode !== "public_unofficial") throw new Error("Expected timed source");
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload: source });
    const original = originalContent(source);
    if (original.format !== "timed_segments") throw new Error("Expected timed content");
    const output = { format: "timed_segments", segments: original.segments.map((segment, index) => ({
      segmentId: segment.segmentId, text: index === 0 ? "TEST_ONLY_FIXED" : segment.text,
    })) };
    const content = materializeCorrectionDocument(original, output);
    if (!content || content.format !== "timed_segments") throw new Error("Expected corrected content");
    const proposalId = crypto.randomUUID();
    expect(await h.store.append({ ...first, id: proposalId, version: 2, kind: "proposal",
      parent_document_id: first.document_id, related_id: null, actor_id: historyHuman.adminId,
      created_at: historyHuman.now }, { kind: "correction_document_v1", sourceId: first.source_id,
      sourceSha256: source.sourceSha256, baseDocumentId: first.document_id,
      baseDocumentSha256: first.document_sha256, content })).toBe("saved");
    const proposed = await h.head();
    expect(await h.run({ action: "apply_correction_document", ...inputExpectation(proposed), proposalId,
      reviewed: true, content: { ...content, segments: content.segments.map((segment, index) =>
        index === 0 ? { ...segment, start: segment.start + 1 } : segment) } })).toMatchObject({ code: "INPUT_INVALID" });
    const adopted = await h.save({ action: "apply_correction_document", ...inputExpectation(proposed), proposalId, reviewed: true });
    const saved = await h.store.event(h.sermonId, adopted.id);
    if (!saved) throw new Error("Missing adopted timed content");
    expect(await h.store.payload(saved)).toEqual(content);
    expect(adopted.confirmation_id).toBeNull();
  });
  it("reads only the selected restore, correction base, proposal, and decision bodies", async () => {
    const tracked = observed(); const h = await harness(tracked.database);
    const payload = await caption("TEST_ONLY_WRONG");
    const original = await h.save({ action: "import_source", expectedVersion: 0, payload });
    const edited = await h.save({ action: "edit", ...inputExpectation(original), content: { format: "plain_text", text: "TEST_ONLY_EDIT" } });

    tracked.sql.length = 0;
    const restored = await h.save({ action: "restore", ...inputExpectation(edited), restoreDocumentId: original.id });
    expect(tracked.sql.filter((sql) => sql.startsWith("SELECT position, body FROM sermon_input_chunks"))).toHaveLength(1);

    tracked.sql.length = 0;
    const proposed = await h.save({ action: "propose_corrections", ...inputExpectation(restored), proposal: {
      sourceId: restored.source_id, sourceSha256: payload.rawTranscriptSha256,
      baseDocumentId: restored.document_id, baseDocumentSha256: restored.document_sha256,
      items: [item("TEST_ONLY_WRONG")],
    } });
    expect(tracked.sql.filter((sql) => sql.startsWith("SELECT position, body FROM sermon_input_chunks"))).toHaveLength(1);

    tracked.sql.length = 0;
    const decided = await h.save({ action: "decide_corrections", ...inputExpectation(proposed), proposalId: proposed.id,
      decisions: [{ itemId: "fix", decision: "accepted" }], reviewed: true });
    expect(tracked.sql.filter((sql) => sql.startsWith("SELECT position, body FROM sermon_input_chunks"))).toHaveLength(2);

    tracked.sql.length = 0;
    await h.save({ action: "merge_corrections", ...inputExpectation(decided), proposalId: proposed.id });
    expect(tracked.sql.filter((sql) => sql.startsWith("SELECT position, body FROM sermon_input_chunks"))).toHaveLength(2);
    expect(tracked.sql.some((sql) => sql.includes("ORDER BY version LIMIT ?"))).toBe(true);
    expect(tracked.sql.some((sql) => sql.includes("ORDER BY e.version,c.position LIMIT ?"))).toBe(true);
  });
  it("preserves timed segment identity and rejects timing changes", async () => {
    const h = await harness(); const payload = await historySource(true);
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload });
    if (payload.sourceMode !== "public_unofficial") throw new Error("Synthetic invalid");
    const segments = payload.segments.map((s, i) => ({ ...s, segmentId: `segment-${i + 1}`, text: s.text + " TEST_ONLY_EDIT" }));
    expect(await h.run({ action: "edit", ...inputExpectation(first), content: { format: "timed_segments", segments: segments.map((s) => ({ ...s, start: s.start + 1 })) } })).toMatchObject({ outcome: "failed" });
    await h.save({ action: "edit", ...inputExpectation(first), content: { format: "timed_segments", segments } });
  });
  it.each(["lost", "sparse"] as const)("proves only its own attempt after %s response, without replay", async (mode) => {
    const tracked = observed(mode); const h = await harness(tracked.database);
    await h.save({ action: "import_source", expectedVersion: 0, payload: await caption() });
    expect(await h.events()).toHaveLength(1);
    expect(tracked.sql.filter((sql) => sql.startsWith("INSERT INTO sermon_input_events"))).toHaveLength(1);
    expect(tracked.sql.filter((sql) => sql.startsWith("SELECT"))).toHaveLength(3);
  });
  it("returns a fixed uncertain error if proof is unavailable; never leaks text or replays", async () => {
    const h = await harness(observed("unavailable").database);
    expect(await h.run({ action: "import_source", expectedVersion: 0, payload: await caption() })).toEqual({ outcome: "failed", code: "INPUT_SAVE_UNCERTAIN", message: "저장 결과를 확인하지 못했습니다. 자동 재저장은 하지 않았습니다." });
    expect(await h.events()).toHaveLength(1);
  });
  it.each(["no-seal", "no-chunks", "no-head"] as const)("rolls back the entire transaction when %s", async (mode) => {
    const h = await harness(observed(mode).database);
    expect(await h.run({ action: "import_source", expectedVersion: 0, payload: await caption() })).toMatchObject({ outcome: "failed" });
    expect(await h.events()).toHaveLength(0); expect(await h.head()).toBeNull();
  });
  it("allows only one winner among 20 same-version saves and leaves no loser records", async () => {
    const h = await harness(); const payload = await caption();
    const results = await Promise.all(Array.from({ length: 20 }, () => h.run({ action: "import_source", expectedVersion: 0, payload })));
    expect(results.filter((r) => r.outcome === "saved")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "failed")).toHaveLength(19);
    expect(await h.events()).toHaveLength(1);
  });
  it.each(Array.from({ length: 200 }, (_, index) => ({ scenario: index < 100 ? "typical" : "boundary", run: index % 100 + 1, size: index < 100 ? 1024 : 30_000 })))("local $scenario invocation $run: import and edit stay bounded", async ({ size }) => {
      const tracked = observed(); const h = await harness(tracked.database);
      const first = await h.save({ action: "import_source", expectedVersion: 0, payload: await caption("가".repeat(size)) });
      expect(tracked.sql).toHaveLength(5);
      tracked.sql.length = 0;
      await h.save({ action: "edit", ...inputExpectation(first), content: { format: "plain_text", text: "나".repeat(size) } });
      expect(tracked.sql).toHaveLength(5);
      expect(tracked.sql.some((sql) => sql.includes("FROM sermon_input_chunks"))).toBe(false);
    });
  it("proves an earlier committed attempt even after another save advances the head", async () => {
    const database = new Proxy(historyDb, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        await target.batch(statements);
        const store = createSermonInputStore(historyDb);
        const head = (await store.head(h.sermonId))!;
        const result = await createSermonInputService(store).execute(h.sermonId, { action: "edit", ...inputExpectation(head), content: { format: "plain_text", text: "TEST_ONLY_LATER_EDIT" } }, historyHuman);
        expect(result.outcome).toBe("saved");
        throw new Error("TEST_ONLY_LOST_RESPONSE");
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const h = await harness(database);
    const saved = await h.save({ action: "import_source", expectedVersion: 0, payload: await caption() });
    expect(saved.version).toBe(1); expect((await h.head()).version).toBe(2);
    expect(await h.events()).toHaveLength(2);
  });
  it("keeps old storage readable and prevents either path from acquiring the other's sermon", async () => {
    const legacy = historyHarness();
    await legacy.run({ action: "import_source", expectedVersion: 0, payload: await historySource() });
    const old = await harness();
    await seedReadHistory(legacy, old.sermonId, 0, false);
    const before = await historyDb.prepare("SELECT * FROM sermon_history_heads WHERE sermon_id = ?").bind(old.sermonId).first();
    expect(await old.run({ action: "import_source", expectedVersion: 0, payload: await caption() })).toMatchObject({ outcome: "failed" });
    expect(await old.events()).toHaveLength(0);
    expect(await historyDb.prepare("SELECT * FROM sermon_history_heads WHERE sermon_id = ?").bind(old.sermonId).first()).toEqual(before);
    const fresh = await harness();
    await fresh.save({ action: "import_source", expectedVersion: 0, payload: await caption() });
    await expect(seedReadHistory(legacy, fresh.sermonId, 0, false)).rejects.toThrow();
    expect(await historyDb.prepare("SELECT * FROM sermon_history_heads WHERE sermon_id = ?").bind(fresh.sermonId).first()).toBeNull();
    expect(await fresh.events()).toHaveLength(1);
  });
  it("keeps pastor-provided summaries at their unchanged byte limit, not the caption cap", async () => {
    for (const size of [200_000, 1_048_576]) {
      const tracked = observed(); const h = await harness(tracked.database);
      const payload = await historySource(false, "T".repeat(size));
      await h.save({ action: "import_source", expectedVersion: 0, payload });
      if (size === 200_000) expect(tracked.sql).toHaveLength(6);
      expect(await h.store.payload(await h.head())).toEqual(payload);
    }
  });
  it("lists bounded current-source metadata without reading any history body", async () => {
    const tracked = observed(); const h = await harness(tracked.database);
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload: await caption() });
    const edited = await h.save({ action: "edit", ...inputExpectation(first), content: { format: "plain_text", text: "TEST_ONLY_EDIT" } });
    const confirmed = await h.save({ action: "confirm", ...inputExpectation(edited), reviewed: true });
    const proposed = await h.save({ action: "propose_corrections", ...inputExpectation(confirmed), proposal: {
      sourceId: first.source_id, sourceSha256: first.document_sha256, baseDocumentId: edited.document_id,
      baseDocumentSha256: edited.document_sha256, items: [item("TEST_ONLY_EDIT")],
    } });
    await h.save({ action: "decide_corrections", ...inputExpectation(proposed), proposalId: proposed.id,
      decisions: [{ itemId: "fix", decision: "rejected" }], reviewed: true });
    tracked.sql.length = 0;
    const result = await h.service.history(h.sermonId);
    expect(result.outcome).toBe("loaded");
    if (result.outcome !== "loaded" || result.history === null) throw new Error("Synthetic history missing");
    expect(result.history.events.map((event) => event.kind)).toEqual([
      "source", "edit", "confirm", "proposal", "decision",
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(historyRaw);
    expect(serialized).not.toContain("TEST_ONLY_EDIT");
    expect(serialized).not.toContain("actor");
    expect(serialized).not.toContain("sha256");
    expect(tracked.sql.filter((sql) => sql.includes("sermon_input_chunks"))).toHaveLength(0);

    const metadataHead = await h.store.metadataHead(h.sermonId);
    const metadata = await h.store.historyMetadata(h.sermonId, first.source_id);
    if (metadataHead === null) throw new Error("Synthetic metadata head missing");
    const oversizedStore = {
      ...h.store,
      metadataHead: async () => metadataHead,
      historyMetadata: async () => Array.from(
        { length: ADMIN_SERMON_INPUT_HISTORY_LIMIT + 1 },
        () => metadata[0]!,
      ),
    };
    await expect(createSermonInputService(oversizedStore).history(h.sermonId))
      .rejects.toThrow("Input history unavailable");
  });
  it("reads only two selected documents and rejects another source or a non-document selection", async () => {
    const tracked = observed(); const h = await harness(tracked.database);
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload: await caption() });
    const edited = await h.save({ action: "edit", ...inputExpectation(first), content: { format: "plain_text", text: "TEST_ONLY_EDIT" } });
    const proposed = await h.save({ action: "propose_corrections", ...inputExpectation(edited), proposal: {
      sourceId: first.source_id, sourceSha256: first.document_sha256, baseDocumentId: edited.document_id,
      baseDocumentSha256: edited.document_sha256, items: [item("TEST_ONLY_EDIT")],
    } });
    tracked.sql.length = 0;
    const selected = await h.service.comparison(h.sermonId, first.id, first.id, edited.id);
    expect(selected.outcome).toBe("loaded");
    expect(tracked.sql.filter((sql) => sql.includes("FROM sermon_input_chunks"))).toHaveLength(2);

    tracked.sql.length = 0;
    expect(await h.service.comparison(h.sermonId, "different-source", first.id, edited.id))
      .toEqual({ outcome: "selection_not_found" });
    expect(await h.service.comparison(h.sermonId, first.id, proposed.id, edited.id))
      .toEqual({ outcome: "selection_not_found" });
    expect(tracked.sql.filter((sql) => sql.includes("FROM sermon_input_chunks"))).toHaveLength(0);
  });
  it("loads one selected correction proposal and only decisions linked to it", async () => {
    const tracked = observed(); const h = await harness(tracked.database);
    const payload = await caption("TEST_ONLY_WRONG");
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload });
    const proposed = await h.save({ action: "propose_corrections", ...inputExpectation(first), proposal: {
      sourceId: first.source_id, sourceSha256: payload.rawTranscriptSha256, baseDocumentId: first.document_id,
      baseDocumentSha256: first.document_sha256, items: [item("TEST_ONLY_WRONG")],
    } });
    const decided = await h.save({ action: "decide_corrections", ...inputExpectation(proposed), proposalId: proposed.id,
      decisions: [{ itemId: "fix", decision: "accepted" }], reviewed: true });
    await h.save({ action: "merge_corrections", ...inputExpectation(decided), proposalId: proposed.id });
    tracked.sql.length = 0;
    const result = await h.service.correctionDetail(h.sermonId, proposed.id);
    expect(result.outcome).toBe("loaded");
    if (result.outcome !== "loaded") throw new Error("Synthetic correction missing");
    expect(result.correction.proposal).toMatchObject({
      proposalId: proposed.id,
      sourceId: first.source_id,
      baseDocumentId: first.document_id,
    });
    if (!("decisions" in result.correction)) throw new Error("Expected legacy correction");
    expect(result.correction.decisions).toHaveLength(1);
    expect(result.correction.decisions[0]).toMatchObject({
      decisions: [{ itemId: "fix", decision: "accepted" }],
    });
    expect(JSON.stringify(result)).not.toContain("sourceSha256");
    expect(JSON.stringify(result)).not.toContain("baseDocumentSha256");
    expect(JSON.stringify(result)).not.toContain("actor");
    expect(tracked.sql.filter((sql) => sql.includes("sermon_input_chunks"))).toHaveLength(2);

    const proposalRecord = await h.store.event(h.sermonId, proposed.id);
    if (proposalRecord === null) throw new Error("Synthetic proposal record missing");
    const payloadRead = vi.fn(h.store.payload);
    const oversizedStore = {
      ...h.store,
      event: async (sermonId: string, eventId: string) => eventId === proposed.id
        ? { ...proposalRecord, byte_length: ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_BYTES + 1 }
        : h.store.event(sermonId, eventId),
      payload: payloadRead,
    };
    await expect(createSermonInputService(oversizedStore).correctionDetail(h.sermonId, proposed.id))
      .rejects.toThrow("Input correction unavailable");
    expect(payloadRead).not.toHaveBeenCalled();
  });
  it("loads just the two selected bodies for comparison; stored records cannot be deleted or overwritten", async () => {
    const tracked = observed(); const h = await harness(tracked.database);
    const first = await h.save({ action: "import_source", expectedVersion: 0, payload: await caption() });
    const edited = await h.save({ action: "edit", ...inputExpectation(first), content: { format: "plain_text", text: "TEST_ONLY_EDIT" } });
    tracked.sql.length = 0;
    expect(await h.service.comparison(h.sermonId, first.id, first.id, edited.id)).toEqual({
      outcome: "loaded",
      comparison: {
        sourceId: first.id,
        left: { documentId: first.id, content: { format: "plain_text", text: historyRaw } },
        right: { documentId: edited.id, content: { format: "plain_text", text: "TEST_ONLY_EDIT" } },
      },
    });
    expect(tracked.sql.filter((sql) => sql.includes("FROM sermon_input_chunks"))).toHaveLength(2);
    for (const sql of ["DELETE FROM sermon_input_events WHERE sermon_id = ?", "UPDATE sermon_input_chunks SET body = 'BROKEN' WHERE sermon_id = ?", "DELETE FROM sermon_input_heads WHERE sermon_id = ?"]) {
      await expect(historyDb.prepare(sql).bind(h.sermonId).run()).rejects.toThrow();
    }
    expect(await h.events()).toHaveLength(2);
  });
});

function item(text: string) {
  return { id: "fix", segmentId: null, start: null, duration: null, from: 0, to: text.length,
    originalText: text, proposedText: "TEST_ONLY_CORRECT", changeType: "spelling", reason: "TEST_ONLY_REASON",
    confidence: 0.9, riskFlags: ["needs_review"], contextBefore: "", contextAfter: "" };
}
