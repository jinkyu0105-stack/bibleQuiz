import { describe, expect, it } from "vitest";

import { decodeHistoryJson, encodeHistoryJson, historyChunkBytes, historySha256, type HistoryPayload } from "../_shared/storage/history-json-codec";
import { decodeHistoryRecord, encodeHistoryRecord, historyStreams, parseHistoryRecord } from "../_shared/storage/history-record";
import { projectHistoryReferences, verifyHistoryReferences } from "../_shared/storage/history-references";
import { summaryBindingFromIntent } from "../_shared/services/sermon-summary";
import type { SermonCandidateDraft } from "../_shared/services/sermon-candidates-contract";
import { createTranscriptRevisionService } from "../_shared/services/transcript-revisions";
import { historyFixture, historyHarness, historyHead, historyRaw, historySource } from "./test/sermon-history-codec-fixture";

const invalid = "HISTORY_STORAGE_INVALID";
async function bytePayload(bytes: Uint8Array): Promise<HistoryPayload> {
  const chunks: HistoryPayload["chunks"] = [];
  for (let offset = 0; offset < bytes.length; offset += historyChunkBytes) {
    const body = bytes.slice(offset, offset + historyChunkBytes);
    chunks.push({ chunkIndex: chunks.length, byteLength: body.length, body, chunkSha256: await historySha256(body) });
  }
  return { manifest: { codec: "record-json-utf8-v1", chunkBytes: historyChunkBytes, chunkCount: chunks.length,
    byteLength: bytes.length, payloadSha256: await historySha256(bytes) }, chunks };
}
describe("P5-21 pure JSON UTF-8 transport (codec-only fixtures)", () => {
  it.each([65_535, 65_536, 65_537, 131_072, 131_073])("preserves exactly %i encoded bytes", async (length) => {
    const value = "x".repeat(length - 2);
    const encoded = await encodeHistoryJson(value);
    expect(encoded.manifest.byteLength).toBe(length);
    expect(encoded.chunks.map((c) => c.byteLength)).toEqual(Array.from({ length: Math.ceil(length / 65_536) },
      (_, i) => Math.min(length - i * 65_536, 65_536)));
    expect(await decodeHistoryJson(encoded)).toBe(value);
  });
  it.each(["가", "😀", "é"])("reassembles a split UTF-8 %s before decoding", async (character) => {
    const value = "x".repeat(65_534) + character + historyRaw;
    const encoded = await encodeHistoryJson(value);
    expect(() => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(encoded.chunks[0]!.body)).toThrow();
    encoded.chunks.reverse();
    expect(await decodeHistoryJson(encoded)).toBe(value);
  });
  it.each([
    ["missing", (p: HistoryPayload) => { p.chunks.pop(); }],
    ["duplicate", (p: HistoryPayload) => { p.chunks[1]!.chunkIndex = 0; }],
    ["index gap", (p: HistoryPayload) => { p.chunks[1]!.chunkIndex = 2; }],
    ["fractional index", (p: HistoryPayload) => { p.chunks[1]!.chunkIndex = 0.5; }],
    ["short non-final", (p: HistoryPayload) => { p.chunks[0]!.body = p.chunks[0]!.body.slice(1); }],
    ["empty final", (p: HistoryPayload) => { p.chunks[1]!.body = new Uint8Array(); }],
    ["same-length substitution", (p: HistoryPayload) => { p.chunks[0]!.body[9] = 121; }],
    ["chunk hash", (p: HistoryPayload) => { p.chunks[0]!.chunkSha256 = "0".repeat(64); }],
    ["total hash", (p: HistoryPayload) => { p.manifest.payloadSha256 = "0".repeat(64); }],
    ["length", (p: HistoryPayload) => { p.manifest.byteLength++; }],
    ["count", (p: HistoryPayload) => { p.manifest.chunkCount++; }],
    ["huge manifest", (p: HistoryPayload) => { p.manifest.byteLength = Number.MAX_SAFE_INTEGER; }],
  ] as const)("rejects %s without partial/default output", async (_label, mutate) => {
    const p = await encodeHistoryJson("x".repeat(70_000)); mutate(p);
    await expect(decodeHistoryJson(p)).rejects.toThrow(invalid);
  });
  it("rechecks the total hash even when an altered chunk has a new correct hash", async () => {
    const p = await encodeHistoryJson({ value: "abc" });
    p.chunks[0]!.body[10] = 122;
    p.chunks[0]!.chunkSha256 = await historySha256(p.chunks[0]!.body);
    await expect(decodeHistoryJson(p)).rejects.toThrow(invalid);
  });
  it("rejects a same-length chunk borrowed from another record", async () => {
    const p = await encodeHistoryJson("a".repeat(70_000));
    const other = await encodeHistoryJson("b".repeat(70_000));
    p.chunks[0] = other.chunks[0]!;
    await expect(decodeHistoryJson(p)).rejects.toThrow(invalid);
  });
  it.each([new Uint8Array([34, 0xc3, 34]), new TextEncoder().encode('{"a":'),
    new TextEncoder().encode('"\\ud800"'), new Uint8Array([239, 187, 191, 123, 125])])("rejects malformed text/JSON even with correct byte hashes", async (bytes) => {
    await expect(decodeHistoryJson(await bytePayload(bytes))).rejects.toThrow(invalid);
  });
  it.each([undefined, NaN, Infinity, -0, { missing: undefined }, [undefined], Array(1), new Date(), "\ud800", "\udfff", 1n])("refuses JSON loss for case %#", async (value) => {
    await expect(encodeHistoryJson(value)).rejects.toThrow(invalid);
  });
  it("keeps optional omission distinct from null and preserves array order", async () => {
    const value = { absent: {}, explicit: { a: null }, array: ["z", "a", "z"], text: historyRaw };
    expect(await decodeHistoryJson(await encodeHistoryJson(value))).toEqual(value);
  });
  it("uses the original byte hash, not a re-stringified JSON hash", async () => {
    const bytes = new TextEncoder().encode('{ "z": "\\u0061", "a": [2,1] }');
    const p = await bytePayload(bytes);
    expect(await decodeHistoryJson(p)).toEqual({ z: "a", a: [2, 1] });
    expect(p.manifest.payloadSha256).not.toBe((await encodeHistoryJson({ z: "a", a: [2, 1] })).manifest.payloadSha256);
  });
  it("detaches inputs before asynchronous verification", async () => {
    const p = await encodeHistoryJson({ text: "TEST_ONLY_PRIVATE" });
    const promise = decodeHistoryJson(p);
    p.chunks[0]!.body.fill(0); p.manifest.payloadSha256 = "0".repeat(64);
    expect(await promise).toEqual({ text: "TEST_ONLY_PRIVATE" });
  });
  it("rejects unknown codec/format and extra fields with a fixed private-safe error", async () => {
    const p = await encodeHistoryJson({ secret: historyRaw });
    for (const altered of [{ ...p, secret: historyRaw }, { ...p, manifest: { ...p.manifest, codec: "future" } }]) {
      try { await decodeHistoryJson(altered); throw new Error("accepted"); }
      catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(invalid);
        expect(error).not.toHaveProperty("cause");
        expect(JSON.stringify(error)).not.toContain(historyRaw);
      }
    }
  });
});

describe("P5-21 complete domain elements, envelopes and reference projection", () => {
  it.each([false, true])("round-trips every operation, all 8 streams and original order (timed=%s)", async (timed) => {
    const h = await historyFixture(timed);
    const state = h.state();
    const restored = structuredClone(state);
    for (const stream of historyStreams) restored[stream] = [] as never;
    const decoded = [];
    for (const record of h.records) {
      const encoded = await encodeHistoryRecord(record);
      const result = await decodeHistoryRecord(record.envelope, encoded);
      expect(result).toEqual(record);
      decoded.push(result);
      (restored[result.envelope.stream] as unknown[]).push(result.payload);
    }
    expect(restored).toEqual(state);
    for (const stream of historyStreams) expect(restored[stream].length).toBeGreaterThan(0);
    const refs = projectHistoryReferences(h.records, h.scope());
    expect(projectHistoryReferences([...decoded].reverse(), h.scope())).toEqual(refs);
    verifyHistoryReferences(decoded, h.scope(), refs);
    // Full read validation is exercised only with a synthetic memory double in tests.
    const service = createTranscriptRevisionService({ async read() { return restored; }, async compareAndSwap() { throw new Error("no write"); } });
    expect(await service.readIntent(h.scope().sermonId)).toEqual(await h.service.readIntent(h.scope().sermonId));
    expect(await service.readSummary(h.scope().sermonId)).toEqual(await h.service.readSummary(h.scope().sermonId));
    expect(await service.readCandidates(h.scope().sermonId, "child")).toEqual(await h.service.readCandidates(h.scope().sermonId, "child"));
    expect(await service.readConfirmed(h.scope().sermonId)).toMatchObject({ code: "TRANSCRIPT_NOT_CONFIRMED" });
    const status = state.candidateEvents.findLast((e) => e.operation.kind === "set_status")!;
    expect(refs.find((r) => r.ownerRecordId === status.id && r.relation === "candidate")).toMatchObject({
      targetRecordId: status.operation.kind === "set_status" ? status.operation.poolId : "", targetMemberId: "candidate-a", payloadPath: "/operation/candidateId" });
  });
  it("keeps storage, source JSON and working-text checksums independent", async () => {
    const h = historyHarness();
    await h.run({ action: "import_source", expectedVersion: 0, payload: await historySource(true) });
    const encoded = await Promise.all(h.records.map(encodeHistoryRecord));
    const source = h.state().sources[0]!.payload;
    if (source.sourceMode !== "public_unofficial") throw new Error("fixture");
    const working = h.state().revisions[0]!.transcriptSha256;
    expect(new Set([source.sourceSha256, working, ...encoded.map((e) => e.manifest.payloadSha256)]).size).toBe(4);
    for (const record of h.records) {
      const altered = structuredClone(record);
      if ("content" in altered.payload) altered.payload.transcriptSha256 = source.sourceSha256;
      else if ("payload" in altered.payload && altered.payload.payload.sourceMode === "public_unofficial") altered.payload.payload.sourceSha256 = working;
      // Even freshly computed storage hashes cannot conceal an invalid domain checksum.
      await expect(decodeHistoryRecord(altered.envelope, await encodeHistoryJson(altered.payload))).rejects.toThrow(invalid);
    }
  });
  it("preserves an exact 1MiB valid manual source escaped beyond 2,000,000 bytes", async () => {
    const raw = "TEST_ONLY_BIG_" + '"'.repeat(1_048_576 - "TEST_ONLY_BIG_".length);
    const h = historyHarness();
    await h.run({ action: "import_source", expectedVersion: 0, payload: await historySource(false, raw) });
    for (const r of h.records) {
      const encoded = await encodeHistoryRecord(r);
      expect(encoded.manifest.byteLength).toBeGreaterThan(2_000_000);
      expect(encoded.chunks.length).toBeGreaterThan(30);
      expect(await decodeHistoryRecord(r.envelope, encoded)).toEqual(r);
    }
    expect(projectHistoryReferences(h.records, h.scope())).toHaveLength(1);
  });
  it("rejects source tampering despite newly valid storage hash", async () => {
    const h = historyHarness();
    await h.run({ action: "import_source", expectedVersion: 0, payload: await historySource() });
    const r = structuredClone(h.records[0]!);
    if (!("payload" in r.payload) || r.payload.payload.sourceMode === "public_unofficial") throw new Error("fixture");
    r.payload.payload.rawTranscriptText += "x";
    await expect(decodeHistoryRecord(r.envelope, await encodeHistoryJson(r.payload))).rejects.toThrow(invalid);
  });
  it("rejects envelope ID/version/slot/projection mismatch and strict missing/extra fields", async () => {
    const h = await historyFixture();
    const source = h.records[0]!;
    for (const patch of [{ recordId: "wrong" }, { sourceRevision: 2 }, { storageFormatVersion: 2 },
      { difficulty: "child" }, { commitSlot: 1 }, { streamPosition: 0 }, { extra: true }]) {
      await expect(encodeHistoryRecord({ ...source, envelope: { ...source.envelope, ...patch } })).rejects.toThrow(invalid);
    }
    const event = h.records.find((r) => r.envelope.stream === "candidateEvents")!;
    expect(() => parseHistoryRecord({ ...event, envelope: { ...event.envelope, commitVersion: event.envelope.commitVersion + 1 } })).toThrow(invalid);
    expect(() => parseHistoryRecord({ ...source, payload: { ...source.payload, extra: historyRaw } })).toThrow(invalid);
    const p = { ...source.payload } as Record<string, unknown>; delete p.id;
    expect(() => parseHistoryRecord({ ...source, payload: p })).toThrow(invalid);
  });
});

describe("P5-21 reference corruption and nested ownership", () => {
  it("rejects missing/extra records, stream/count/commit gaps, reused IDs and foreign ownership", async () => {
    const h = await historyFixture();
    for (const mutate of [
      (r: typeof h.records) => { r.pop(); },
      (r: typeof h.records) => { r.splice(3, 1); },
      (r: typeof h.records) => { r.push(structuredClone(r[0]!)); },
      (r: typeof h.records) => { r[0]!.envelope.sermonId = "other-sermon"; },
      (r: typeof h.records) => { r[0]!.envelope.streamPosition++; },
      (r: typeof h.records) => { r[1]!.envelope.commitVersion++; },
      (r: typeof h.records) => { r[1]!.envelope.recordId = r[0]!.envelope.recordId; r[1]!.payload.id = r[0]!.payload.id; },
      (r: typeof h.records) => { const c = r.filter((r) => r.envelope.stream === "candidateEvents");
        [c[0]!.envelope.streamPosition, c[1]!.envelope.streamPosition] = [c[1]!.envelope.streamPosition, c[0]!.envelope.streamPosition]; },
    ]) {
      const altered = structuredClone(h.records); mutate(altered);
      expect(() => projectHistoryReferences(altered, h.scope())).toThrow(invalid);
    }
    const scope = h.scope();
    expect(() => projectHistoryReferences(h.records, { ...scope, version: scope.version + 1 })).toThrow(invalid);
    expect(() => projectHistoryReferences(h.records, { ...scope, counts: { ...scope.counts, summaryEvents: 0 } })).toThrow(invalid);
    const counts = { ...scope.counts } as Record<string, number>; delete counts.summaryEvents;
    expect(() => projectHistoryReferences(h.records, { ...scope, counts })).toThrow(invalid);
    expect(() => projectHistoryReferences([], scope)).toThrow(invalid);
  });
  it("checks all projected columns, owner paths and positions without silently repairing rows", async () => {
    const h = await historyFixture();
    const refs = projectHistoryReferences(h.records, h.scope());
    for (const field of ["sermonId", "ownerRecordId", "relation", "targetRecordId", "targetStream", "targetMemberId", "payloadPath"] as const) {
      const altered = structuredClone(refs); altered[0] = { ...altered[0]!, [field]: "foreign" };
      expect(() => verifyHistoryReferences(h.records, h.scope(), altered)).toThrow(invalid);
    }
    for (const altered of [refs.slice(1), [...refs, refs[0]], [...refs].reverse(),
      refs.map((r, i) => i === 0 ? { ...r, referencePosition: 0 } : r),
      refs.map((r, i) => i === 0 ? { ...r, extra: true } : r),
      Object.assign(Array(refs.length + 1), refs)]) {
      expect(() => verifyHistoryReferences(h.records, h.scope(), altered)).toThrow(invalid);
    }
    // Object insertion order is not a meaningful mutation.
    verifyHistoryReferences(h.records, h.scope(), refs.map((r) => Object.fromEntries(Object.entries(r).reverse())));
  });
  it("rejects forward, wrong-kind, cross-source and parent/restore confusion", async () => {
    const h = await historyFixture();
    const revisions = h.state().revisions;
    const restored = revisions.find((r) => r.kind === "restored")!;
    const manual = revisions.find((r) => r.kind === "manual_edit")!;
    const targetCases = [
      [restored.id, "restoredFromRevisionId", manual.id],
      [restored.id, "parentRevisionId", restored.restoredFromRevisionId!],
      [manual.id, "parentRevisionId", h.state().sources[0]!.id],
      [manual.id, "sourceId", h.state().sources.at(-1)!.id],
      [revisions.at(-1)!.id, "parentRevisionId", manual.id],
    ] as const;
    for (const [id, key, value] of targetCases) {
      const records = structuredClone(h.records);
      const r = records.find((r) => r.payload.id === id)!;
      if (!("content" in r.payload)) throw new Error("fixture");
      r.payload[key] = value;
      expect(() => projectHistoryReferences(records, h.scope())).toThrow(invalid);
    }
  });
  it("resolves repeated correction item IDs in their proposal and detects missing/re-decided items", async () => {
    const h = await historyFixture();
    const p = h.state().correctionProposals;
    expect(p[0]!.items.map((i) => i.id)).toEqual(p[1]!.items.map((i) => i.id));
    const refs = projectHistoryReferences(h.records, h.scope()).filter((r) => r.relation === "correction_item");
    expect(refs.every((r) => r.targetRecordId === p[1]!.id)).toBe(true);
    for (const mode of ["missing", "duplicate"] as const) {
      const records = structuredClone(h.records);
      const decisions = records.filter((r) => "decisions" in r.payload);
      const record = decisions[1]!;
      if (!("decisions" in record.payload)) throw new Error("fixture");
      if (mode === "missing") {
        const other = records.find((r) => r.envelope.recordId === p[0]!.id)!;
        if (!("items" in other.payload)) throw new Error("fixture");
        other.payload.items[0]!.id = "foreign-item";
      }
      record.payload.decisions[0]!.itemId = mode === "missing" ? "foreign-item" : "item-0";
      expect(() => projectHistoryReferences(records, h.scope())).toThrow(invalid);
    }
  });
  it("rejects wrong difficulty, non-pool events and members absent from the inherited pool", async () => {
    const h = await historyFixture();
    for (const mode of ["difficulty", "non-pool", "member", "duplicate-member"] as const) {
      const records = structuredClone(h.records);
      const status = records.findLast((r) => "operation" in r.payload && r.payload.operation.kind === "set_status")!;
      if (!("operation" in status.payload) || status.payload.operation.kind !== "set_status") throw new Error("fixture");
      const op = status.payload.operation;
      if (mode === "difficulty") op.poolId = h.state().candidateEvents[0]!.id;
      if (mode === "non-pool") op.poolId = h.state().candidateEvents.find((e) => e.operation.kind === "review")!.id;
      if (mode === "member") {
        const other = records.find((r) => r.envelope.stream === "candidateEvents")!;
        if (!("operation" in other.payload) || other.payload.operation.kind !== "generate" || !("candidates" in other.payload.operation.draft)) throw new Error("fixture");
        other.payload.operation.draft.candidates.push({ ...structuredClone(other.payload.operation.draft.candidates[0]!),
          id: "only-in-another-pool", displayAnswer: "외부", gridAnswer: "외부", clue: "TEST_ONLY_FOREIGN" });
        op.candidateId = "only-in-another-pool";
      }
      if (mode === "duplicate-member") {
        const generate = records.find((r) => r.envelope.stream === "candidateEvents")!;
        if (!("operation" in generate.payload) || generate.payload.operation.kind !== "generate" || !("candidates" in generate.payload.operation.draft)) throw new Error("fixture");
        generate.payload.operation.draft.candidates[1]!.id = generate.payload.operation.draft.candidates[0]!.id;
      }
      expect(() => projectHistoryReferences(records, h.scope())).toThrow(invalid);
    }
    const refs = projectHistoryReferences(h.records, h.scope());
    const nested = refs.filter((r) => r.relation === "candidate");
    expect(new Set(nested.map((r) => r.targetMemberId)).size).toBe(2);
    expect(new Set(nested.map((r) => r.targetRecordId)).size).toBe(4);
  });
  it("checks critique claim field, analysis snapshot and UTF-16 evidence ownership", async () => {
    const h = await historyFixture(true);
    for (const mode of ["field", "claim", "binding", "segment", "time", "offset", "surrogate"] as const) {
      const records = structuredClone(h.records);
      const critique = records.find((r) => "operation" in r.payload && r.payload.operation.kind === "critique")!;
      if (!("operation" in critique.payload) || critique.payload.operation.kind !== "critique") throw new Error("fixture");
      const op = critique.payload.operation;
      if (mode === "field") op.critique.exaggeratedIntent.concerns[0]!.field = "purpose";
      if (mode === "claim") op.critique.exaggeratedIntent.concerns[0]!.claimId = "foreign-claim";
      if (mode === "binding") op.binding.confirmationId = h.state().confirmations[0]!.id;
      const evidence = op.analysis.centralMessage[0]!.evidence[0]!;
      if (mode === "segment") evidence.segmentId = "segment-2";
      if (mode === "time") evidence.start = 9;
      if (mode === "offset") evidence.from = evidence.from! + 1;
      if (mode === "surrogate") { evidence.from = historyRaw.indexOf("😀") + 1; evidence.to = evidence.from! + 1; evidence.quote = "\ude00"; }
      expect(() => projectHistoryReferences(records, h.scope())).toThrow(invalid);
    }
  });
  it("does not use a same-named claim from another analysis or summary review as a draft", async () => {
    const h = await historyFixture();
    for (const mode of ["missing-claim", "wrong-analysis", "non-draft", "duplicate-paragraph"] as const) {
      const records = structuredClone(h.records);
      const first = records.find((r) => r.envelope.stream === "summaryEvents")!;
      if (!("operation" in first.payload) || first.payload.operation.kind !== "generate" || !("paragraphs" in first.payload.operation.draft)) throw new Error("fixture");
      if (mode === "missing-claim") {
        const other = records.find((r) => r.envelope.stream === "intentEvents")!;
        if (!("operation" in other.payload) || other.payload.operation.kind !== "analysis") throw new Error("fixture");
        other.payload.operation.analysis.uncertainties.push({ ...structuredClone(other.payload.operation.analysis.centralMessage[0]!), id: "foreign-claim" });
        first.payload.operation.draft.paragraphs[0]!.intentClaimIds[0] = "foreign-claim";
      }
      if (mode === "duplicate-paragraph") first.payload.operation.draft.paragraphs[1]!.id = first.payload.operation.draft.paragraphs[0]!.id;
      if (mode === "wrong-analysis") first.payload.operation.binding.analysisId = h.state().intentEvents[0]!.id;
      if (mode === "non-draft") {
        const restored = records.find((r) => r.envelope.stream === "summaryEvents" && "operation" in r.payload && r.payload.operation.kind === "restore")!;
        if (!("operation" in restored.payload) || restored.payload.operation.kind !== "restore" || !("summaryId" in restored.payload.operation)) throw new Error("fixture");
        restored.payload.operation.summaryId = h.state().summaryEvents.find((e) => e.operation.kind === "review")!.id;
      }
      expect(() => projectHistoryReferences(records, h.scope())).toThrow(invalid);
    }
  });
});

describe("P5-21 representative large domain-valid synthetic elements", () => {
  it("keeps all 1,000 correction items and their array positions beyond 2MB", async () => {
    const h = historyHarness();
    const raw = "x ".repeat(1000);
    await h.run({ action: "import_source", expectedVersion: 0, payload: await historySource(false, raw) });
    const s = h.state();
    const source = s.sources[0]!.payload;
    if (source.sourceMode === "public_unofficial") throw new Error("fixture");
    await h.run({ action: "propose_corrections", ...historyHead(s), proposal: {
      sourceId: s.currentSourceId, sourceSha256: source.rawTranscriptSha256, baseRevisionId: s.currentRevisionId,
      baseTranscriptSha256: s.revisions[0]!.transcriptSha256,
      items: Array.from({ length: 1000 }, (_, i) => ({ id: `item-${1000 - i}`, segmentId: null, start: null, duration: null,
        from: i * 2, to: i * 2 + 1, originalText: "x", proposedText: "y".repeat(2000), changeType: "spelling",
        reason: "TEST_ONLY_BIG_PROPOSAL", confidence: 0.25, riskFlags: ["needs_review"],
        contextBefore: raw.slice(Math.max(0, i * 2 - 120), i * 2), contextAfter: raw.slice(i * 2 + 1, i * 2 + 121) })),
    } });
    const record = h.records.at(-1)!;
    const encoded = await encodeHistoryRecord(record);
    expect(encoded.manifest.byteLength).toBeGreaterThan(2_000_000);
    expect(await decodeHistoryRecord(record.envelope, encoded)).toEqual(record);
    const refs = projectHistoryReferences(h.records, h.scope());
    expect(refs.filter((r) => r.relation === "correction_target")).toHaveLength(1000);
    expect(refs.at(-1)!.payloadPath).toBe("/items/999");
  });
  it("keeps 128 candidates with large private fields, all members and ordered references beyond 2MB", async () => {
    const h = await historyFixture(false, false);
    const intent = await h.service.readIntent(h.scope().sermonId, true);
    if (intent.outcome !== "intent") throw new Error("fixture");
    const existing = h.state().candidateEvents[0]!.operation;
    if (existing.kind !== "generate") throw new Error("fixture");
    const template = existing.draft.candidates[0]!;
    const draft: SermonCandidateDraft = { candidates: Array.from({ length: 128 }, (_, i) => ({ ...structuredClone(template),
      id: `large-${128 - i}`, displayAnswer: `합${String.fromCodePoint(0xac00 + i)}`, gridAnswer: `합${String.fromCodePoint(0xac00 + i)}`,
      clue: `TEST_ONLY_LARGE_${i}`, selectionReason: "TEST_ONLY_BIG_REASON_" + "z".repeat(20_000),
    })) };
    await h.run({ action: "candidates", ...historyHead(h.state()), operation: { kind: "generate", difficulty: "child",
      binding: summaryBindingFromIntent(intent.view)!, draft } });
    const record = h.records.at(-1)!;
    const encoded = await encodeHistoryRecord(record);
    expect(encoded.manifest.byteLength).toBeGreaterThan(2_000_000);
    expect(await decodeHistoryRecord(record.envelope, encoded)).toEqual(record);
    const refs = projectHistoryReferences(h.records, h.scope()).filter((r) => r.ownerRecordId === record.envelope.recordId);
    expect(refs.filter((r) => r.relation === "intent_claim")).toHaveLength(128);
    expect(refs.at(-1)!.payloadPath).toBe("/operation/draft/candidates/127/grounding/evidence/0");
  });
});
