import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { transcriptProvider } from "../_shared/services/accountless-transcript-contract";
import {
  privateTranscriptStateSchema, type PrivateTranscriptState, type TranscriptCommand,
  type TranscriptContent, type TranscriptRevisionStore, type TranscriptState,
} from "../_shared/services/transcript-revision-contract";
import { createTranscriptRevisionService, transcriptRevisionDiagnosticForCopy } from "../_shared/services/transcript-revisions";

const human = { kind: "human", adminId: "test-admin", now: "2026-09-08T00:00:00.000Z" };
const sermonId = "test-sermon";
const rawText = "\uFEFF TEST_ONLY_PRIVATE_REVISION_CANARY\r\n<b>합성 가 &amp; 가 😀</b>\t ";

async function digest(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function manual(text = rawText) {
  const result = await prepareManualTranscriptSource({
    sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript",
    sourceCoverage: "partial_notes", rawTranscriptText: text,
  });
  if (result.outcome !== "validated") throw new Error("Invalid synthetic fixture");
  return result.source;
}
async function timed() {
  const segments = [
    { text: "TEST_ONLY_SEGMENT_A", start: 0.5, duration: 2 },
    { text: "TEST_ONLY_SEGMENT_B", start: 1.5, duration: 1 },
  ];
  return {
    sourceMode: "public_unofficial" as const, videoId: "aaaaaaaaaaa", language: "ko" as const,
    trackId: "test-track", generated: true, retrievedAt: human.now,
    providerId: transcriptProvider.id, providerVersion: transcriptProvider.version,
    sourceSha256: await digest(JSON.stringify(segments)), segments,
  };
}
/** Test-only in-memory CAS. No D1, fixtures on disk, real content or network. */
function harness() {
  let stored: unknown = null;
  let commits = 0;
  let attempts = 0;
  const port: TranscriptRevisionStore = {
    async read() { return structuredClone(stored); },
    async compareAndSwap(_id, expected, next) {
      attempts++;
      const current = stored as TranscriptState | null;
      if ((current?.version ?? null) !== expected) return false;
      stored = structuredClone(next);
      commits++;
      return true;
    },
  };
  return {
    port, service: createTranscriptRevisionService(port),
    snapshot: () => structuredClone(stored) as TranscriptState,
    corrupt: (value: unknown) => { stored = value; },
    commits: () => commits, attempts: () => attempts,
  };
}
type Harness = ReturnType<typeof harness>;
function head(state: PrivateTranscriptState) {
  return {
    expectedVersion: state.version, sourceId: state.currentSourceId,
    revisionId: state.currentRevisionId, transcriptSha256: state.revisions.at(-1)!.transcriptSha256,
  };
}
async function run(h: Harness, command: TranscriptCommand) {
  const result = await h.service.execute(sermonId, command, human);
  expect(result.outcome).toBe("updated");
  if (result.outcome !== "updated") throw new Error("Synthetic transition failed");
  return result.state;
}
async function imported(payload?: Awaited<ReturnType<typeof manual>> | Awaited<ReturnType<typeof timed>>) {
  const h = harness();
  const state = await run(h, { action: "import_source", expectedVersion: 0, payload: payload ?? await manual() });
  return { h, state };
}
function edit(state: PrivateTranscriptState, text = "TEST_ONLY_MANUAL_EDIT"): TranscriptCommand {
  return { action: "edit", ...head(state), content: { format: "plain_text", text } };
}
function confirm(state: PrivateTranscriptState): TranscriptCommand {
  return { action: "confirm", ...head(state), reviewed: true };
}

afterEach(() => vi.restoreAllMocks());

describe("private transcript revisions (synthetic contracts only)", () => {
  it("preserves exact original bytes, provenance and checksum; import is unconfirmed", async () => {
    const payload = await manual();
    const { h, state } = await imported(payload);
    expect(state.sources[0]!.payload).toEqual(payload);
    expect(state.revisions[0]!.content).toEqual({ format: "plain_text", text: rawText });
    expect(state.revisions[0]!.transcriptSha256).toBe(payload.rawTranscriptSha256);
    expect(state.currentConfirmationId).toBeNull();
    expect(await h.service.readConfirmed(sermonId)).toMatchObject({ code: "TRANSCRIPT_NOT_CONFIRMED" });
    expect(Object.isFrozen(state.sources[0]!.payload)).toBe(true);
    expect(Object.isFrozen(state.revisions[0]!.content)).toBe(true);
    expect(() => Reflect.set(state.sources[0]!.payload, "rawTranscriptText", "TEST_ONLY_OVERWRITE")).not.toThrow();
    expect(Reflect.set(state.sources[0]!.payload, "rawTranscriptText", "TEST_ONLY_OVERWRITE")).toBe(false);
    expect(h.snapshot().sources[0]!.payload).toEqual(payload);
  });

  it("appends human edits and restores as new revisions without changing any original or history", async () => {
    const { h, state: first } = await imported();
    const second = await run(h, edit(first));
    expect(second.sources).toEqual(first.sources);
    expect(second.revisions[0]).toEqual(first.revisions[0]);
    expect(second.revisions[1]).toMatchObject({ kind: "manual_edit", parentRevisionId: first.currentRevisionId });
    const third = await run(h, { action: "restore", ...head(second), restoreRevisionId: first.currentRevisionId });
    expect(third.revisions.slice(0, 2)).toEqual(second.revisions);
    expect(third.revisions[2]).toMatchObject({
      kind: "restored", parentRevisionId: second.currentRevisionId, restoredFromRevisionId: first.currentRevisionId,
      content: first.revisions[0]!.content, transcriptSha256: first.revisions[0]!.transcriptSha256,
    });
    expect(new Set(third.revisions.map((r) => r.id)).size).toBe(3);
  });

  it("allows explicit human confirmation without AI and records the exact saved revision", async () => {
    const { h, state } = await imported();
    const confirmed = await run(h, confirm(state));
    expect(confirmed.revisions).toEqual(state.revisions);
    expect(confirmed.confirmations[0]).toMatchObject({
      sourceId: state.currentSourceId, revisionId: state.currentRevisionId,
      transcriptSha256: state.revisions[0]!.transcriptSha256, confirmedBy: human.adminId, confirmedAt: human.now,
    });
    expect(await h.service.readConfirmed(sermonId)).toEqual({ outcome: "confirmed", state: confirmed });
    expect(privateTranscriptStateSchema.safeParse(confirmed).success).toBe(true);
  });

  it("invalidates current confirmation on edit and restore while retaining previous confirmations", async () => {
    const { h, state } = await imported();
    const confirmed = await run(h, confirm(state));
    const edited = await run(h, edit(confirmed));
    expect(edited.confirmations).toEqual(confirmed.confirmations);
    expect(edited.currentConfirmationId).toBeNull();
    expect(await h.service.readConfirmed(sermonId)).toMatchObject({ code: "TRANSCRIPT_NOT_CONFIRMED" });
    const restored = await run(h, { action: "restore", ...head(edited), restoreRevisionId: state.currentRevisionId });
    expect(restored.currentConfirmationId).toBeNull();
    expect(await h.service.readConfirmed(sermonId)).toMatchObject({ code: "TRANSCRIPT_NOT_CONFIRMED" });
    expect((await run(h, confirm(restored))).confirmations).toHaveLength(2);
  });

  it("replaces a source by appending an increased source revision with an unconfirmed working head", async () => {
    const { h, state } = await imported();
    const confirmed = await run(h, confirm(state));
    const replacement = await run(h, { action: "import_source", expectedVersion: confirmed.version, payload: await timed() });
    expect(replacement.sources.map((s) => s.sourceRevision)).toEqual([1, 2]);
    expect(replacement.sources[0]).toEqual(state.sources[0]);
    expect(replacement.revisions[0]).toEqual(state.revisions[0]);
    expect(replacement.confirmations).toEqual(confirmed.confirmations);
    expect(replacement.currentConfirmationId).toBeNull();
    expect(replacement.revisions.at(-1)!.parentRevisionId).toBeNull();
    expect(await h.service.readConfirmed(sermonId)).toMatchObject({ code: "TRANSCRIPT_NOT_CONFIRMED" });
    expect(await h.service.execute(sermonId, { action: "restore", ...head(replacement), restoreRevisionId: state.currentRevisionId }, human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    expect(await h.service.execute(sermonId, { ...confirm(state), expectedVersion: replacement.version }, human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
  });

  it.each(["import_source", "edit", "confirm"])("rejects original overwrite fields in %s", async (action) => {
    const { h, state } = await imported();
    const before = h.snapshot();
    const command = action === "import_source"
      ? { action, expectedVersion: state.version, payload: await manual(), sourceId: state.currentSourceId }
      : { ...(action === "edit" ? edit(state) : confirm(state)), rawTranscriptText: "TEST_ONLY_OVERWRITE" };
    expect(await h.service.execute(sermonId, command, human)).toMatchObject({ code: "INVALID_TRANSCRIPT_REQUEST" });
    expect(h.snapshot()).toEqual(before);
  });

  it.each(["manual", "timed"])("rejects mismatched %s source checksum without repairing it", async (kind) => {
    const h = harness();
    const payload = kind === "manual" ? { ...await manual(), rawTranscriptSha256: "a".repeat(64) }
      : { ...await timed(), sourceSha256: "a".repeat(64) };
    expect(await h.service.execute(sermonId, { action: "import_source", expectedVersion: 0, payload }, human))
      .toMatchObject({ code: "TRANSCRIPT_CHECKSUM_MISMATCH" });
    expect(h.commits()).toBe(0);
  });

  it("keeps timed source JSON checksum distinct from working UTF-8 text; preserves overlapping timestamps", async () => {
    const payload = await timed();
    const { h, state } = await imported(payload);
    const revision = state.revisions[0]!;
    expect(revision.transcriptSha256).toBe(await digest("TEST_ONLY_SEGMENT_A\nTEST_ONLY_SEGMENT_B"));
    expect(revision.transcriptSha256).not.toBe(payload.sourceSha256);
    const content = structuredClone(revision.content) as TranscriptContent;
    if (content.format !== "timed_segments") throw new Error("Synthetic format");
    content.segments[0]!.text = "TEST_ONLY_CORRECTED_A";
    const edited = await run(h, { action: "edit", ...head(state), content });
    expect(edited.sources).toEqual(state.sources);
    expect(Object.isFrozen(edited.revisions[1]!.content)).toBe(true);
    expect(await h.service.execute(sermonId, { ...confirm(edited), transcriptSha256: payload.sourceSha256 }, human))
      .toMatchObject({ code: "TRANSCRIPT_CHECKSUM_MISMATCH" });
    await run(h, confirm(edited));
    expect((await h.service.readConfirmed(sermonId)).outcome).toBe("confirmed");
  });

  it.each(["id", "start", "duration", "order", "drop", "split", "format"])("rejects timed segment %s changes", async (change) => {
    const { h, state } = await imported(await timed());
    let content = structuredClone(state.revisions[0]!.content) as TranscriptContent;
    if (content.format !== "timed_segments") throw new Error("Synthetic format");
    if (change === "id") content.segments[0]!.segmentId = "other-segment";
    if (change === "start") content.segments[0]!.start++;
    if (change === "duration") content.segments[0]!.duration++;
    if (change === "order") content.segments.reverse();
    if (change === "drop") content.segments.pop();
    if (change === "split") content.segments.push({ ...content.segments[0]!, segmentId: "split" });
    if (change === "format") content = { format: "plain_text", text: "TEST_ONLY" };
    expect(await h.service.execute(sermonId, { action: "edit", ...head(state), content }, human))
      .toMatchObject({ code: "TRANSCRIPT_CONTENT_INVALID" });
    expect(h.commits()).toBe(1);
  });

  it.each(["", " \t\r\n\u200B", "TEST\u0000ONLY", "TEST\uD800", "가".repeat(349_526)])("rejects invalid working text (%#)", async (text) => {
    const { h, state } = await imported();
    expect(await h.service.execute(sermonId, edit(state, text), human)).toMatchObject({ code: "TRANSCRIPT_CONTENT_INVALID" });
    expect(h.commits()).toBe(1);
  });

  it.each([null, { ...human, kind: "ai" }, { ...human, adminId: "" }, { ...human, now: "yesterday" }])("requires trusted human context (%#)", async (context) => {
      const { h, state } = await imported();
      expect(await h.service.execute(sermonId, confirm(state), context)).toMatchObject({ code: "HUMAN_REVIEW_REQUIRED" });
      expect(h.commits()).toBe(1);
    });

  it.each([
    { reviewed: false }, { reviewed: undefined }, { content: { format: "plain_text", text: "TEST_ONLY_UNSAVED" } },
    { confirmedBy: "forged-admin" }, { status: "confirmed" }, { apiKey: "TEST_ONLY_SECRET" },
  ])("rejects unsaved content, forged confirmation and unreviewed input (%#)", async (extra) => {
    const { h, state } = await imported();
    const result = await h.service.execute(sermonId, { ...confirm(state), ...extra }, human);
    expect(result).toMatchObject({ code: "INVALID_TRANSCRIPT_REQUEST" });
    expect(JSON.stringify(result)).not.toContain("TEST_ONLY");
    expect(h.commits()).toBe(1);
  });

  it("rejects stale versions, stale revisions even with the latest version, and incorrect head checksums", async () => {
    const { h, state } = await imported();
    const current = await run(h, edit(state));
    for (const command of [confirm(state), { ...confirm(state), expectedVersion: current.version }]) {
      expect(await h.service.execute(sermonId, command, human)).toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    }
    expect(await h.service.execute(sermonId, { ...confirm(current), transcriptSha256: "b".repeat(64) }, human))
      .toMatchObject({ code: "TRANSCRIPT_CHECKSUM_MISMATCH" });
    expect(h.commits()).toBe(2);
  });

  it("rejects an old revision even when restored text has exactly the same checksum", async () => {
    const { h, state } = await imported();
    const sameText = await run(h, edit(state, rawText));
    expect(sameText.revisions[1]!.transcriptSha256).toBe(state.revisions[0]!.transcriptSha256);
    expect(await h.service.execute(sermonId, { ...confirm(state), expectedVersion: sameText.version }, human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    expect(h.commits()).toBe(2);
  });

  it("rejects attaching a historical confirmation to a newer working head", async () => {
    const { h, state } = await imported();
    const confirmed = await run(h, confirm(state));
    await run(h, edit(confirmed));
    const corrupt = h.snapshot();
    corrupt.currentConfirmationId = confirmed.currentConfirmationId;
    h.corrupt(corrupt);
    expect(await h.service.readConfirmed(sermonId)).toMatchObject({ code: "TRANSCRIPT_STATE_INVALID" });
  });

  it("rejects a restored revision whose content was changed even with a recomputed checksum", async () => {
    const { h, state } = await imported();
    const edited = await run(h, edit(state));
    const restored = await run(h, { action: "restore", ...head(edited), restoreRevisionId: state.currentRevisionId });
    await run(h, confirm(restored));
    const corrupt = h.snapshot();
    corrupt.revisions[2]!.content = { format: "plain_text", text: "TEST_ONLY_FORGED_RESTORE" };
    corrupt.revisions[2]!.transcriptSha256 = await digest("TEST_ONLY_FORGED_RESTORE");
    h.corrupt(corrupt);
    expect(await h.service.readConfirmed(sermonId)).toMatchObject({ code: "TRANSCRIPT_STATE_INVALID" });
  });

  it.each(["reversed", "blank", "nonfinite", "extra"])("revalidates %s provider output at the revision boundary", async (change) => {
    const payload = await timed();
    if (change === "reversed") payload.segments.reverse();
    if (change === "blank") payload.segments[0]!.text = " \u200B";
    if (change === "nonfinite") payload.segments[0]!.start = Infinity;
    if (change === "extra") Object.assign(payload, { signedUrl: "TEST_ONLY_SECRET_URL" });
    const h = harness();
    const result = await h.service.execute(sermonId, { action: "import_source", expectedVersion: 0, payload }, human);
    expect(result).toMatchObject({ outcome: "failed" });
    expect(JSON.stringify(result)).not.toContain("TEST_ONLY");
    expect(h.commits()).toBe(0);
  });

  it("isolates caller objects across asynchronous validation and returns safe getter/CAS failures", async () => {
    const { h, state } = await imported();
    const command = edit(state, "TEST_ONLY_EXPECTED");
    const pending = h.service.execute(sermonId, command, human);
    if (command.action === "edit" && command.content.format === "plain_text") command.content.text = "TEST_ONLY_LATE_MUTATION";
    const result = await pending;
    expect(result).toMatchObject({ outcome: "updated", state: { revisions: [expect.anything(), expect.objectContaining({
      content: { format: "plain_text", text: "TEST_ONLY_EXPECTED" },
    })] } });
    const throwingInput = Object.defineProperty({}, "action", { get() { throw new Error("TEST_ONLY_GETTER_SECRET"); } });
    expect(await h.service.execute(sermonId, throwingInput, human)).toMatchObject({ code: "TRANSCRIPT_VALIDATION_FAILED" });
    const before = h.snapshot();
    vi.spyOn(h.port, "compareAndSwap").mockRejectedValue(new Error("TEST_ONLY_STORAGE_SECRET"));
    expect(await h.service.execute(sermonId, confirm(before), human)).toMatchObject({ code: "TRANSCRIPT_VALIDATION_FAILED" });
    expect(h.snapshot()).toEqual(before);
  });

  it.each(["edit-edit", "edit-confirm", "confirm-confirm", "import-import"])("atomically accepts only one competing %s operation", async (race) => {
    const { h, state } = await imported();
    const importedCommand: TranscriptCommand = { action: "import_source", expectedVersion: state.version, payload: await manual("TEST_ONLY_NEW_SOURCE") };
    const pair = race === "edit-edit" ? [edit(state, "TEST_ONLY_A"), edit(state, "TEST_ONLY_B")]
      : race === "edit-confirm" ? [edit(state), confirm(state)]
        : race === "confirm-confirm" ? [confirm(state), confirm(state)] : [importedCommand, importedCommand];
    const results = await Promise.all(pair.map((c) => h.service.execute(sermonId, c, human)));
    expect(results.filter((r) => r.outcome === "updated")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "failed")).toEqual([
      expect.objectContaining({ code: "TRANSCRIPT_REVISION_CONFLICT" }),
    ]);
    expect(h.attempts()).toBe(3); // Both contenders reached CAS from the same read version.
    expect(h.commits()).toBe(2);
    expect(h.snapshot().version).toBe(2);
    expect(h.snapshot().sources[0]).toEqual(state.sources[0]);
  });

  it("also uses CAS when two requests both see an absent initial source", async () => {
    const h = harness();
    const command = { action: "import_source", expectedVersion: 0, payload: await manual() };
    const results = await Promise.all([h.service.execute(sermonId, command, human), h.service.execute(sermonId, command, human)]);
    expect(results.filter((r) => r.outcome === "updated")).toHaveLength(1);
    expect(h.attempts()).toBe(2);
    expect(h.commits()).toBe(1);
  });

  it.each(["source", "working", "confirmation"])("fails closed on persisted %s checksum corruption", async (kind) => {
    const { h, state } = await imported();
    await run(h, confirm(state));
    const corrupt = h.snapshot();
    if (kind === "source" && corrupt.sources[0]!.payload.sourceMode !== "public_unofficial") {
      corrupt.sources[0]!.payload.rawTranscriptText += "TEST_ONLY_TAMPER";
    }
    if (kind === "working") corrupt.revisions[0]!.transcriptSha256 = "a".repeat(64);
    if (kind === "confirmation") corrupt.confirmations[0]!.transcriptSha256 = "b".repeat(64);
    h.corrupt(corrupt);
    expect(await h.service.readConfirmed(sermonId)).toMatchObject({ code: "TRANSCRIPT_CHECKSUM_MISMATCH" });
    expect(await h.service.execute(sermonId, edit(corrupt), human)).toMatchObject({ code: "TRANSCRIPT_CHECKSUM_MISMATCH" });
    expect(h.snapshot()).toEqual(corrupt);
    expect(h.commits()).toBe(2);
  });

  it.each(["parent", "source", "head", "version", "sourceRevision", "duplicate", "extra", "confirmation", "sermon"])("rejects corrupt stored %s relationships", async (kind) => {
      const { h, state } = await imported();
      const current = await run(h, edit(state));
      await run(h, confirm(current));
      const corrupt = h.snapshot();
      if (kind === "parent") corrupt.revisions[1]!.parentRevisionId = "missing";
      if (kind === "source") corrupt.revisions[1]!.sourceId = "missing";
      if (kind === "head") corrupt.currentRevisionId = state.currentRevisionId;
      if (kind === "version") corrupt.version++;
      if (kind === "sourceRevision") corrupt.sources[0]!.sourceRevision = 2;
      if (kind === "duplicate") corrupt.revisions[1]!.id = corrupt.revisions[0]!.id;
      if (kind === "extra") Object.assign(corrupt, { secret: "TEST_ONLY_SECRET" });
      if (kind === "confirmation") corrupt.confirmations[0]!.revisionId = "missing";
      if (kind === "sermon") corrupt.sermonId = "another-sermon";
      h.corrupt(corrupt);
      const result = await h.service.readConfirmed(sermonId);
      expect(result).toMatchObject({ code: "TRANSCRIPT_STATE_INVALID" });
      expect(JSON.stringify(result)).not.toContain("TEST_ONLY");
    });

  it("returns only fixed safe failures for storage/hash exceptions and no partial success on rejected CAS", async () => {
    const { h, state } = await imported();
    vi.spyOn(h.port, "compareAndSwap").mockResolvedValue(false);
    expect(await h.service.execute(sermonId, confirm(state), human)).toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    expect(h.snapshot()).toEqual(state);
    vi.spyOn(h.port, "read").mockRejectedValue(new Error("TEST_ONLY_SECRET_STACK"));
    const result = await h.service.readConfirmed(sermonId);
    expect(result).toMatchObject({ code: "TRANSCRIPT_VALIDATION_FAILED" });
    expect(JSON.stringify(result)).not.toContain("TEST_ONLY");
    vi.restoreAllMocks();
    vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("TEST_ONLY_HASH_SECRET"));
    expect(await h.service.execute(sermonId, edit(state), human)).toMatchObject({ outcome: "failed" });
    expect(h.commits()).toBe(1);
  });

  it("does not leak private successful state through diagnostic copy", async () => {
    const { h, state } = await imported();
    const result = await h.service.execute(sermonId, confirm(state), human);
    expect(transcriptRevisionDiagnosticForCopy(result)).toEqual({ outcome: "updated" });
    expect(transcriptRevisionDiagnosticForCopy(await h.service.readConfirmed(sermonId))).toEqual({ outcome: "confirmed" });
    expect(transcriptRevisionDiagnosticForCopy({ outcome: "failed", code: "TRANSCRIPT_REVISION_CONFLICT", message: rawText }))
      .not.toHaveProperty("message", rawText);
  });
});
