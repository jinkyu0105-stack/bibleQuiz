import { afterEach, describe, expect, it, vi } from "vitest";

import {
  manualTranscriptChecksumFormat,
  manualTranscriptDiagnosticForCopy,
  manualTranscriptMaxBytes,
  prepareManualTranscriptSource,
  verifyManualTranscriptSource,
} from "../_shared/services/manual-transcript-source";

const input = {
  sourceMode: "manual_paste",
  manualSourceKind: "youtube_visible_transcript",
  sourceCoverage: "full_transcript",
  rawTranscriptText: "TEST_ONLY_PRIVATE_MANUAL_CANARY\r\n00:01\t합성 자료 가 😀\n",
} as const;

afterEach(() => vi.restoreAllMocks());

describe("manual source contract (synthetic text only)", () => {
  it("encodes each accepted text once for both its byte limit and checksum", async () => {
    const text = "TEST_ONLY_ENCODING_ONCE 😀\r\n";
    const encoding = vi.spyOn(TextEncoder.prototype, "encode");
    const result = await prepareManualTranscriptSource({ ...input, rawTranscriptText: text });
    expect(result.outcome).toBe("validated");
    expect(encoding.mock.calls.filter(([value]) => value === text)).toHaveLength(1);
    encoding.mockClear();
    if (result.outcome !== "validated") return;
    expect(await verifyManualTranscriptSource(result.source)).toEqual(result);
    expect(encoding.mock.calls.filter(([value]) => value === text)).toHaveLength(1);
  });
  it.each([
    ["manual_paste", "youtube_visible_transcript", "full_transcript"],
    ["manual_paste", "youtube_visible_transcript", "partial_notes"],
    ["sermon_notes", "sermon_manuscript", "partial_notes"],
    ["sermon_notes", "sermon_summary", "partial_notes"],
  ])("accepts explicit %s / %s / %s without inferring coverage", async (sourceMode, manualSourceKind, sourceCoverage) => {
    const raw = { ...input, sourceMode, manualSourceKind, sourceCoverage };
    const result = await prepareManualTranscriptSource(raw);
    expect(result.outcome).toBe("validated");
    if (result.outcome !== "validated") return;
    expect(result.source).toEqual({
      ...raw, checksumFormat: manualTranscriptChecksumFormat,
      rawTranscriptSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(Object.isFrozen(result.source)).toBe(true);
    expect(await verifyManualTranscriptSource(result.source)).toEqual(result);
    expect(manualTranscriptDiagnosticForCopy(result)).toEqual({ outcome: "validated" });
  });

  it.each([
    ["sermon_notes", "youtube_visible_transcript", "full_transcript"],
    ["sermon_notes", "youtube_visible_transcript", "partial_notes"],
    ["manual_paste", "sermon_manuscript", "partial_notes"],
    ["manual_paste", "sermon_summary", "partial_notes"],
    ["sermon_notes", "sermon_manuscript", "full_transcript"],
    ["sermon_notes", "sermon_summary", "full_transcript"],
    ["manual_paste", "sermon_manuscript", "full_transcript"],
    ["manual_paste", "sermon_summary", "full_transcript"],
  ])("rejects mismatched %s / %s / %s on both boundaries", async (sourceMode, manualSourceKind, sourceCoverage) => {
    const raw = { ...input, sourceMode, manualSourceKind, sourceCoverage };
    expect(await prepareManualTranscriptSource(raw)).toMatchObject({ outcome: "failed", code: "MANUAL_SOURCE_MISMATCH" });
    expect(await verifyManualTranscriptSource({
      ...raw, checksumFormat: manualTranscriptChecksumFormat, rawTranscriptSha256: "a".repeat(64),
    })).toMatchObject({ outcome: "failed", code: "MANUAL_SOURCE_MISMATCH" });
  });

  it.each([
    null, [], "TEST_ONLY", {},
    { ...input, sourceMode: "public_unofficial" },
    { ...input, sourceMode: "manual_upload" },
    { ...input, manualSourceKind: "audio_transcription" },
    { ...input, sourceCoverage: "FULL_TRANSCRIPT" },
    { ...input, sourceCoverage: undefined },
    { ...input, sourceMode: undefined },
    { ...input, manualSourceKind: undefined },
    { ...input, rawTranscriptText: 123 },
    { ...input, confirmed: true },
    { ...input, segments: [{ text: "TEST_ONLY", start: 0, duration: 1 }] },
    { ...input, apiKey: "TEST_ONLY_SECRET" },
    { ...input, rawTranscriptSha256: "a".repeat(64) },
  ])("rejects unsupported or extra fields without echoing input (%#)", async (raw) => {
    const result = await prepareManualTranscriptSource(raw);
    expect(result).toEqual({ outcome: "failed", code: "INVALID_MANUAL_SOURCE", message: "입력 자료의 형식을 확인해 주세요." });
    expect(JSON.stringify(result)).not.toContain("TEST_ONLY");
  });

  it.each(["", " \t\r\n", "\uFEFF\u200B\u200C\u200D\u2060　"]) ("rejects blank/invisible-only input (%#)", async (rawTranscriptText) => {
    expect(await prepareManualTranscriptSource({ ...input, rawTranscriptText })).toMatchObject({ code: "MANUAL_TEXT_EMPTY" });
  });

  it.each(["TEST\0ONLY", "TEST\u000BONLY", "TEST\u007FONLY", "\uD800", "\uDC00", "a\uD800b"])("rejects lossy Unicode or control characters (%#)", async (rawTranscriptText) => {
    expect(await prepareManualTranscriptSource({ ...input, rawTranscriptText })).toMatchObject({ code: "MANUAL_TEXT_INVALID" });
  });

  it("checks UTF-8 bytes, including the exact limit, without truncation", async () => {
    const exact = "가".repeat(Math.floor(manualTranscriptMaxBytes / 3)) + "a";
    expect(new TextEncoder().encode(exact).byteLength).toBe(manualTranscriptMaxBytes);
    expect((await prepareManualTranscriptSource({ ...input, rawTranscriptText: exact })).outcome).toBe("validated");
    for (const text of [exact + "a", "a".repeat(manualTranscriptMaxBytes + 1)]) {
      expect(await prepareManualTranscriptSource({ ...input, rawTranscriptText: text })).toMatchObject({ code: "MANUAL_TEXT_TOO_LARGE" });
    }
  });

  it("uses the known SHA-256 of raw UTF-8, not JSON or segment serialization", async () => {
    const result = await prepareManualTranscriptSource({ ...input, rawTranscriptText: "abc" });
    expect(result).toMatchObject({ source: {
      checksumFormat: "sha256:utf8-raw-text:v1",
      rawTranscriptSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    } });
  });

  it("preserves BOM, HTML-like text, entities, timestamps and Unicode exactly", async () => {
    const text = "\uFEFF 00:01\r\n<b>TEST_ONLY &amp; 가 가 😀</b>\t ";
    const result = await prepareManualTranscriptSource({ ...input, rawTranscriptText: text });
    expect(result).toMatchObject({ source: { rawTranscriptText: text } });
    if (result.outcome !== "validated") return;
    for (const changed of [text.trim(), text.replaceAll("\r\n", "\n"), text.normalize("NFC"), text + " "]) {
      const candidate = await prepareManualTranscriptSource({ ...input, rawTranscriptText: changed });
      expect(candidate.outcome).toBe("validated");
      if (candidate.outcome === "validated") expect(candidate.source.rawTranscriptSha256).not.toBe(result.source.rawTranscriptSha256);
      expect(await verifyManualTranscriptSource({ ...result.source, rawTranscriptText: changed })).toMatchObject({ code: "MANUAL_CHECKSUM_MISMATCH" });
    }
  });

  it("revalidates strict source shape and checksum format instead of trusting a saved object", async () => {
    const result = await prepareManualTranscriptSource(input);
    expect(result.outcome).toBe("validated");
    if (result.outcome !== "validated") return;
    for (const change of [
      { rawTranscriptSha256: undefined }, { rawTranscriptSha256: "x".repeat(64) },
      { rawTranscriptSha256: "A".repeat(64) }, { checksumFormat: "sha256:segment-json" },
      { checksumFormat: undefined }, { token: "TEST_ONLY_SECRET" }, { status: "confirmed" },
    ]) {
      expect(await verifyManualTranscriptSource({ ...result.source, ...change })).toMatchObject({ code: "INVALID_MANUAL_SOURCE" });
    }
    expect(await verifyManualTranscriptSource({ ...result.source, rawTranscriptSha256: "0".repeat(64) })).toMatchObject({ code: "MANUAL_CHECKSUM_MISMATCH" });
  });

  it("returns a detached immutable source; hashing is not administrator confirmation", async () => {
    const raw = { ...input, rawTranscriptText: "TEST_ONLY_ORIGINAL" };
    const pending = prepareManualTranscriptSource(raw);
    raw.rawTranscriptText = "TEST_ONLY_EDITED";
    const result = await pending;
    expect(result).toMatchObject({ source: { rawTranscriptText: "TEST_ONLY_ORIGINAL" } });
    if (result.outcome !== "validated") return;
    expect(Reflect.set(result.source, "rawTranscriptText", "TEST_ONLY_EDITED")).toBe(false);
    expect(result.source).not.toHaveProperty("status");
    expect(result.source).not.toHaveProperty("segments");
  });

  it("contains thrown errors and keeps source/secret/checksum out of diagnostics and logs", async () => {
    const errorSpy = vi.spyOn(console, "error");
    const logSpy = vi.spyOn(console, "log");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("TEST_ONLY_NETWORK_FORBIDDEN"));
    const raw = { ...input, get sourceCoverage(): string { throw new Error("TEST_ONLY_SECRET"); } };
    const result = await prepareManualTranscriptSource(raw);
    expect(result).toMatchObject({ outcome: "failed", code: "MANUAL_VALIDATION_FAILED" });
    const failedHash = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("TEST_ONLY_PRIVATE_HASH_ERROR"));
    expect(await prepareManualTranscriptSource(input)).toEqual(result);
    failedHash.mockRestore();
    expect(manualTranscriptDiagnosticForCopy({ outcome: "failed", code: "MANUAL_TEXT_EMPTY", message: "TEST_ONLY_SECRET" })).toEqual({
      outcome: "failed", code: "MANUAL_TEXT_EMPTY", message: "입력 자료에 비어 있지 않은 텍스트가 필요합니다.",
    });
    expect(JSON.stringify(manualTranscriptDiagnosticForCopy(result))).not.toContain("TEST_ONLY");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
