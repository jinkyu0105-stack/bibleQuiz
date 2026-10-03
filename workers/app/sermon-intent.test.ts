import { afterEach, describe, expect, it, vi } from "vitest";

import { transcriptProvider } from "../_shared/services/accountless-transcript-contract";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { intentFields, type IntentAnalysis, type IntentBinding, type IntentOperation } from "../_shared/services/sermon-intent-contract";
import { currentIntentBinding } from "../_shared/services/sermon-intent";
import { privateTranscriptStateSchema, transcriptContentSchema, type PrivateTranscriptState,
  type TranscriptCommand, type TranscriptRevisionStore, type TranscriptState } from "../_shared/services/transcript-revision-contract";
import { createTranscriptRevisionService, transcriptRevisionDiagnosticForCopy } from "../_shared/services/transcript-revisions";

const sermonId = "test-intent-sermon";
const human = { kind: "human", adminId: "test-intent-admin", now: "2026-09-08T00:00:00.000Z" };
const raw = "\uFEFF TEST_ONLY_PRIVATE_INTENT_CANARY\r\n가상 근거 😀\t";
async function hash(text: string) {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function payload(timed = false) {
  if (timed) {
    const segments = [{ text: raw, start: 0.5, duration: 2 }, { text: "TEST_ONLY_SECOND", start: 1, duration: 3 }];
    return { sourceMode: "public_unofficial" as const, videoId: "aaaaaaaaaaa", language: "ko" as const,
      trackId: "test-intent-track", generated: true, retrievedAt: human.now,
      providerId: transcriptProvider.id, providerVersion: transcriptProvider.version,
      sourceSha256: await hash(JSON.stringify(segments)), segments };
  }
  const result = await prepareManualTranscriptSource({ sourceMode: "sermon_notes", manualSourceKind: "sermon_summary",
    sourceCoverage: "partial_notes", rawTranscriptText: raw });
  if (result.outcome !== "validated") throw new Error("Invalid synthetic fixture");
  return result.source;
}
/** Sole storage implementation is this synthetic test double. No real data or IO. */
function harness() {
  let stored: unknown = null;
  let commits = 0;
  const port: TranscriptRevisionStore = {
    async read() { return structuredClone(stored); },
    async compareAndSwap(_id, version, next) {
      if (((stored as TranscriptState | null)?.version ?? null) !== version) return false;
      stored = structuredClone(next);
      commits++;
      return true;
    },
  };
  return { port, service: createTranscriptRevisionService(port), commits: () => commits,
    snapshot: () => structuredClone(stored) as TranscriptState, corrupt: (next: unknown) => { stored = next; } };
}
type Harness = ReturnType<typeof harness>;
function head(state: PrivateTranscriptState) {
  return { expectedVersion: state.version, sourceId: state.currentSourceId, revisionId: state.currentRevisionId,
    transcriptSha256: state.revisions.at(-1)!.transcriptSha256 };
}
function binding(state: PrivateTranscriptState): IntentBinding {
  const result = currentIntentBinding(state);
  if (!result) throw new Error("Unconfirmed synthetic fixture");
  return result;
}
function analysis(timed = false): IntentAnalysis {
  const from = raw.indexOf("가상");
  const evidence = { segmentId: timed ? "segment-1" : null, start: timed ? 0.5 : null, duration: timed ? 2 : null,
    from, to: from + "가상 근거 😀".length, quote: "가상 근거 😀" };
  return Object.fromEntries(intentFields.map((field) => [field, [{ id: field, text: `TEST_ONLY_${field}`,
    origin: "transcript", evidence: [structuredClone(evidence)] }]])) as IntentAnalysis;
}
function intent(state: PrivateTranscriptState, operation: IntentOperation): TranscriptCommand {
  return { action: "intent", ...head(state), operation };
}
function generate(state: PrivateTranscriptState, timed = false): TranscriptCommand {
  return intent(state, { kind: "analysis", binding: binding(state), analysis: analysis(timed) });
}
function critique(state: PrivateTranscriptState, timed = false, baseAnalysisId = state.intentEvents.at(-1)!.id): TranscriptCommand {
  const clear = { assessment: "clear" as const, concerns: [] };
  return intent(state, { kind: "critique", baseAnalysisId, binding: binding(state), analysis: analysis(timed),
    critique: { exaggeratedIntent: clear, unsupportedConclusion: clear, illustrationAsMainClaim: clear, reversedMeaning: clear } });
}
function confirmTranscript(state: PrivateTranscriptState): TranscriptCommand { return { action: "confirm", ...head(state), reviewed: true }; }
function editTranscript(state: PrivateTranscriptState): TranscriptCommand {
  return { action: "edit", ...head(state), content: transcriptContentSchema.parse(state.revisions.at(-1)!.content) };
}
async function run(h: Harness, command: TranscriptCommand) {
  const result = await h.service.execute(sermonId, command, human);
  expect(result.outcome).toBe("updated");
  if (result.outcome !== "updated") throw new Error(result.code);
  return result.state;
}
async function setup(timed = false) {
  const h = harness();
  const imported = await run(h, { action: "import_source", expectedVersion: 0, payload: await payload(timed) });
  return { h, imported, state: await run(h, confirmTranscript(imported)) };
}
async function ready(timed = false) {
  const { h, state: transcript } = await setup(timed);
  const initial = await run(h, generate(transcript, timed));
  const critiqued = await run(h, critique(initial, timed));
  const analysisId = critiqued.intentEvents.at(-1)!.id;
  const selected = await run(h, intent(critiqued, { kind: "select", analysisId }));
  return { h, transcript, initial, critiqued, selected, analysisId };
}
async function confirmed(timed = false) {
  const fixture = await ready(timed);
  return { ...fixture, state: await run(fixture.h, intent(fixture.selected, { kind: "confirm", analysisId: fixture.analysisId })) };
}
afterEach(() => vi.restoreAllMocks());

describe("sermon intent: synthetic private contracts", () => {
  it.each([false, true])("binds analysis, critique, human edit and final approval to confirmed input (timed=%s)", async (timed) => {
    const { h, transcript, initial, selected, analysisId } = await ready(timed);
    const first = initial.intentEvents[0]!;
    expect(first.operation).toMatchObject({ kind: "analysis", binding: binding(transcript) });
    expect(first).toMatchObject({ actorId: human.adminId, createdAt: human.now, version: transcript.version + 1 });
    const revised = analysis(timed);
    for (const field of intentFields) revised[field][0]!.text += "_HUMAN_EDIT";
    revised.warnings.push({ id: "human-context", text: "TEST_ONLY_ADMIN_CONTEXT", origin: "admin_context", evidence: [] });
    const changed = await run(h, intent(selected, { kind: "edit", baseAnalysisId: analysisId, analysis: revised }));
    revised.centralMessage[0]!.text = "TEST_ONLY_LATER_MUTATION";
    expect(await h.service.readIntent(sermonId)).toMatchObject({ outcome: "intent", view: {
      status: "awaiting_confirmation", current: { evidenceReviewIds: [...intentFields] }, confirmationId: null } });
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ code: "SERMON_INTENT_NOT_CONFIRMED" });
    const final = await run(h, intent(changed, { kind: "confirm", analysisId: changed.intentEvents.at(-1)!.id }));
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ outcome: "intent", view: {
      status: "confirmed", version: final.version, confirmationId: final.intentEvents.at(-1)!.id,
      current: { evidenceReviewIds: [], analysis: { centralMessage: [{ text: "TEST_ONLY_centralMessage_HUMAN_EDIT" }] } } } });
    expect(final.sources).toEqual(transcript.sources);
    expect(final.revisions).toEqual(transcript.revisions);
    expect(final.confirmations).toEqual(transcript.confirmations);
    expect(final.intentEvents.slice(0, initial.intentEvents.length)).toEqual(initial.intentEvents);
    expect(Object.isFrozen(final.intentEvents[0]!.operation)).toBe(true);
    expect(Object.isFrozen(final.intentEvents)).toBe(true);
  });

  it("keeps initial analysis after failed critique and requires critique before human final confirmation", async () => {
    const { h, state } = await setup();
    const initial = await run(h, generate(state));
    const analysisId = initial.intentEvents[0]!.id;
    expect(await h.service.execute(sermonId, intent(initial, { kind: "confirm", analysisId }), human))
      .toMatchObject({ code: "SERMON_INTENT_INVALID" });
    const bad = critique(initial);
    if (bad.action !== "intent" || bad.operation.kind !== "critique") throw new Error("fixture");
    bad.operation.critique.reversedMeaning = { assessment: "needs_review", concerns: [
      { field: "warnings", claimId: "outside-analysis", note: "TEST_ONLY_CRITIQUE" },
    ] };
    expect(await h.service.execute(sermonId, bad, human)).toMatchObject({ code: "SERMON_INTENT_INVALID" });
    expect(h.snapshot()).toEqual(initial);
    const retried = await run(h, critique(initial));
    expect(retried.intentEvents[0]).toEqual(initial.intentEvents[0]);
    expect(await h.service.readIntent(sermonId)).toMatchObject({ view: { status: "awaiting_critique", current: { id: analysisId } } });
    const selected = await run(h, intent(retried, { kind: "select", analysisId: retried.intentEvents.at(-1)!.id }));
    expect((await h.service.readIntent(sermonId)).outcome).toBe("intent");
    expect(selected.version).toBe(retried.version + 1);
  });

  it("preserves current human edits and approval while regeneration creates comparison candidates", async () => {
    const { h, state, analysisId } = await confirmed();
    const regenerated = await run(h, generate(state));
    const newInitialId = regenerated.intentEvents.at(-1)!.id;
    const critiqued = await run(h, critique(regenerated, false, newInitialId));
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ view: { current: { id: analysisId } } });
    const selected = await run(h, intent(critiqued, { kind: "select", analysisId: critiqued.intentEvents.at(-1)!.id }));
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ code: "SERMON_INTENT_NOT_CONFIRMED" });
    expect(selected.intentEvents.slice(0, state.intentEvents.length)).toEqual(state.intentEvents);
  });

  it("retains explicit uncertainties and critique concerns for human judgment without a fabricated confidence score", async () => {
    const { h, state } = await setup();
    const initial = await run(h, generate(state));
    const command = critique(initial);
    if (command.action !== "intent" || command.operation.kind !== "critique") throw new Error("fixture");
    command.operation.analysis.uncertainties = [{ id: "uncertain", text: "TEST_ONLY_UNKNOWN", origin: "unresolved", evidence: [] }];
    command.operation.critique.unsupportedConclusion = { assessment: "needs_review",
      concerns: [{ field: "purpose", claimId: "purpose", note: "TEST_ONLY_CHECK_CONTEXT" }] };
    const critiqued = await run(h, command);
    const analysisId = critiqued.intentEvents.at(-1)!.id;
    const selected = await run(h, intent(critiqued, { kind: "select", analysisId }));
    await run(h, intent(selected, { kind: "confirm", analysisId }));
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ view: { status: "confirmed", unresolvedClaimIds: ["uncertain"] } });
  });

  it.each(["edit", "restore", "import_source", "merge_corrections"] as const)("%s invalidates intent without erasing history, even with identical text", async (action) => {
    const { h, state: before } = await confirmed();
    let state = before;
    let command: TranscriptCommand;
    if (action === "import_source") command = { action, expectedVersion: state.version, payload: await payload() };
    else if (action === "restore") command = { action, ...head(state), restoreRevisionId: state.revisions[0]!.id };
    else if (action === "edit") command = editTranscript(state);
    else {
      const from = raw.indexOf("가상");
      state = await run(h, { action: "propose_corrections", ...head(state), proposal: {
        sourceId: state.currentSourceId, sourceSha256: binding(state).sourceSha256,
        baseRevisionId: state.currentRevisionId, baseTranscriptSha256: head(state).transcriptSha256,
        items: [{ id: "correction", segmentId: null, start: null, duration: null, from, to: from + 2,
          originalText: "가상", proposedText: "합성", changeType: "spelling", reason: "TEST_ONLY_REASON", confidence: 0.5,
          riskFlags: [], contextBefore: raw.slice(0, from), contextAfter: raw.slice(from + 2) }],
      } });
      state = await run(h, { action: "decide_corrections", ...head(state), proposalId: state.correctionProposals[0]!.id,
        decisions: [{ itemId: "correction", decision: "accepted" }], reviewed: true });
      expect(await h.service.readIntent(sermonId, true)).toMatchObject({ view: { status: "confirmed" } });
      command = { action, ...head(state), proposalId: state.correctionProposals[0]!.id };
    }
    const changed = await run(h, command);
    expect(changed.intentEvents).toEqual(before.intentEvents);
    expect(await h.service.readIntent(sermonId)).toMatchObject({ view: { status: "needs_review", confirmationId: null } });
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ code: "SERMON_INTENT_NOT_CONFIRMED" });
    const reconfirmed = await run(h, confirmTranscript(changed));
    expect(await h.service.readIntent(sermonId)).toMatchObject({ view: { status: "needs_review" } });
    expect(await h.service.execute(sermonId, intent(reconfirmed, { kind: "select", analysisId: before.intentEvents[0]!.id }), human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    if (action !== "merge_corrections") {
      const fresh = await run(h, generate(reconfirmed));
      const critiqued = await run(h, critique(fresh));
      const analysisId = critiqued.intentEvents.at(-1)!.id;
      const selected = await run(h, intent(critiqued, { kind: "select", analysisId }));
      await run(h, intent(selected, { kind: "confirm", analysisId }));
      expect(await h.service.readIntent(sermonId, true)).toMatchObject({ view: { status: "confirmed" } });
    }
  });

  it("editing confirmed intent clears its approval and flags changed evidence without requiring AI again", async () => {
    const { h, state, analysisId } = await confirmed();
    const data = analysis();
    data.centralMessage[0]!.text = "TEST_ONLY_CHANGED";
    data.warnings = [];
    const edited = await run(h, intent(state, { kind: "edit", baseAnalysisId: analysisId, analysis: data }));
    expect(await h.service.readIntent(sermonId)).toMatchObject({ view: { status: "awaiting_confirmation",
      current: { evidenceReviewIds: ["centralMessage"], analysis: { warnings: [] } } } });
    await run(h, intent(edited, { kind: "confirm", analysisId: edited.intentEvents.at(-1)!.id }));
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ view: { status: "confirmed" } });
  });

  it.each(["analysis", "critique"] as const)("rejects delayed %s even if the caller refreshes the outer expected head", async (kind) => {
    const { h, state } = await setup();
    const base = kind === "analysis" ? state : await run(h, generate(state));
    const stale = kind === "analysis" ? generate(base) : critique(base);
    const changed = await run(h, editTranscript(base));
    const latest = await run(h, confirmTranscript(changed));
    expect(await h.service.execute(sermonId, stale, human)).toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    expect(await h.service.execute(sermonId, { ...stale, ...head(latest) }, human)).toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    expect(h.snapshot()).toEqual(latest);
  });

  it.each(["sourceId", "sourceRevision", "sourceSha256", "revisionId", "transcriptSha256", "confirmationId", "version"] as const)(
    "rejects a mismatched input binding: %s", async (field) => {
      const { h, state } = await setup();
      const command = generate(state);
      if (command.action !== "intent" || command.operation.kind !== "analysis") throw new Error("fixture");
      const b = command.operation.binding;
      if (field === "sourceRevision" || field === "version") b[field]++;
      else b[field] = field.endsWith("Sha256") ? "0".repeat(64) : "other-id";
      expect(await h.service.execute(sermonId, command, human)).toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
      expect(h.snapshot()).toEqual(state);
    },
  );

  it.each(["quote", "outside", "reverse", "empty", "timestamp", "segment", "duplicate", "duplicate_claim", "ai_admin_context"])(
    "rejects invalid structured analysis/evidence: %s", async (mode) => {
      const { h, state } = await setup();
      const command = generate(state);
      if (command.action !== "intent" || command.operation.kind !== "analysis") throw new Error("fixture");
      const data = command.operation.analysis;
      const claim = data.centralMessage[0]!;
      if (claim.origin !== "transcript") throw new Error("fixture");
      const e = claim.evidence[0]!;
      if (mode === "quote") e.quote = "TEST_ONLY_FABRICATED";
      if (mode === "outside") e.to = raw.length + 1;
      if (mode === "reverse") e.from = e.to! + 1;
      if (mode === "empty") e.from = e.to;
      if (mode === "timestamp") e.start = 0;
      if (mode === "segment") e.segmentId = "segment-1";
      if (mode === "duplicate") claim.evidence.push(structuredClone(e));
      if (mode === "duplicate_claim") data.purpose[0]!.id = claim.id;
      if (mode === "ai_admin_context") data.centralMessage[0] = { id: claim.id, text: claim.text, origin: "admin_context", evidence: [] };
      expect(await h.service.execute(sermonId, command, human)).toMatchObject({ code: "SERMON_INTENT_INVALID" });
      expect(h.snapshot()).toEqual(state);
    },
  );

  it.each(["id", "start", "duration", "other_segment"])("verifies timed evidence against the original segment: %s", async (mode) => {
    const { h, state } = await setup(true);
    const command = generate(state, true);
    if (command.action !== "intent" || command.operation.kind !== "analysis") throw new Error("fixture");
    const e = command.operation.analysis.centralMessage[0]!.evidence[0]!;
    if (mode === "id") e.segmentId = null;
    if (mode === "start") e.start = 0;
    if (mode === "duration") e.duration = 99;
    if (mode === "other_segment") { e.segmentId = "segment-2"; e.start = 1; e.duration = 3; }
    expect(await h.service.execute(sermonId, command, human)).toMatchObject({ code: "SERMON_INTENT_INVALID" });
  });

  it.each(["extra_command", "extra_analysis", "missing_field", "blank", "lossy_unicode", "no_evidence", "fake_confidence", "provider", "spoof_actor"])(
    "strictly rejects untrusted fields and malformed text: %s", async (mode) => {
      const { h, state } = await setup();
      const command = generate(state);
      if (command.action !== "intent" || command.operation.kind !== "analysis") throw new Error("fixture");
      const data = command.operation.analysis;
      if (mode === "extra_command") Object.assign(command, { confirmedBy: "fake-admin" });
      if (mode === "extra_analysis") Object.assign(data, { bibleText: "TEST_ONLY_FORBIDDEN" });
      if (mode === "missing_field") Reflect.deleteProperty(data, "purpose");
      if (mode === "blank") data.centralMessage[0]!.text = "\u200b  ";
      if (mode === "lossy_unicode") data.centralMessage[0]!.text = "\ud800";
      if (mode === "no_evidence") data.centralMessage[0]!.evidence = [];
      if (mode === "fake_confidence") Object.assign(data.centralMessage[0]!, { confidence: 0.99 });
      if (mode === "provider") Object.assign(command.operation, { model: "not-configured", apiKey: "TEST_ONLY_SECRET" });
      if (mode === "spoof_actor") Object.assign(command.operation, { actorId: "fake-admin" });
      expect(await h.service.execute(sermonId, command, human)).toMatchObject({ code: "INVALID_TRANSCRIPT_REQUEST" });
      expect(h.snapshot()).toEqual(state);
    },
  );

  it("requires authoritative human context and currently confirmed transcript before accepting analysis", async () => {
    const { h, imported, state } = await setup();
    expect(await h.service.execute(sermonId, generate(state), { ...human, kind: "ai" })).toMatchObject({ code: "HUMAN_REVIEW_REQUIRED" });
    h.corrupt(imported);
    expect(await h.service.execute(sermonId, { ...generate(state), ...head(imported) }, human)).toMatchObject({ code: "TRANSCRIPT_NOT_CONFIRMED" });
    expect(h.snapshot()).toEqual(imported);
  });

  it("keeps empty drafts editable but cannot confirm without a central message and purpose", async () => {
    const { h, selected, analysisId } = await ready();
    const data = analysis();
    data.centralMessage = [];
    const edited = await run(h, intent(selected, { kind: "edit", baseAnalysisId: analysisId, analysis: data }));
    expect(await h.service.execute(sermonId, intent(edited, { kind: "confirm", analysisId: edited.intentEvents.at(-1)!.id }), human))
      .toMatchObject({ code: "SERMON_INTENT_INVALID" });
    expect(h.snapshot()).toEqual(edited);
  });

  it("does not silently approve an older analysis when a human save wins first", async () => {
    const { h, selected, analysisId } = await ready();
    const edited = await run(h, intent(selected, { kind: "edit", baseAnalysisId: analysisId, analysis: analysis() }));
    expect(await h.service.execute(sermonId, intent(edited, { kind: "confirm", analysisId }), human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    expect(h.snapshot()).toEqual(edited);
  });

  it("clears acknowledged evidence markers before a later edit of a different field", async () => {
    const { h, selected, analysisId } = await ready();
    const data = analysis();
    data.centralMessage[0]!.text += "_EDIT";
    const first = await run(h, intent(selected, { kind: "edit", baseAnalysisId: analysisId, analysis: data }));
    const firstId = first.intentEvents.at(-1)!.id;
    const approved = await run(h, intent(first, { kind: "confirm", analysisId: firstId }));
    data.purpose[0]!.text += "_EDIT";
    await run(h, intent(approved, { kind: "edit", baseAnalysisId: firstId, analysis: data }));
    expect(await h.service.readIntent(sermonId)).toMatchObject({ view: { current: { evidenceReviewIds: ["purpose"] } } });
  });

  it("rejects a delayed result after an aggregate-only change and requires refreshed confirmation provenance", async () => {
    const { h, state } = await setup();
    const delayed = generate(state);
    const reconfirmed = await run(h, confirmTranscript(state));
    expect(reconfirmed.currentRevisionId).toBe(state.currentRevisionId);
    expect(reconfirmed.currentConfirmationId).not.toBe(state.currentConfirmationId);
    expect(await h.service.execute(sermonId, { ...delayed, ...head(reconfirmed) }, human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    await run(h, generate(reconfirmed));
  });

  it.each(["missing_check", "false_clear", "flag_without_concern"])("validates all four critique checks: %s", async (mode) => {
    const { h, state } = await setup();
    const initial = await run(h, generate(state));
    const command = critique(initial);
    if (command.action !== "intent" || command.operation.kind !== "critique") throw new Error("fixture");
    const check = command.operation.critique;
    if (mode === "missing_check") Reflect.deleteProperty(check, "reversedMeaning");
    if (mode === "false_clear") check.exaggeratedIntent.concerns.push({ field: "purpose", claimId: "purpose", note: "TEST_ONLY_CONCERN" });
    if (mode === "flag_without_concern") check.exaggeratedIntent.assessment = "needs_review";
    expect(await h.service.execute(sermonId, command, human)).toMatchObject({ code: "INVALID_TRANSCRIPT_REQUEST" });
    expect(h.snapshot()).toEqual(initial);
  });

  it("returns an absent private view for no state and rejects invalid identities before storage", async () => {
    const h = harness();
    const read = vi.spyOn(h.port, "read");
    expect(await h.service.readIntent("../bad")).toMatchObject({ code: "INVALID_TRANSCRIPT_REQUEST" });
    expect(read).not.toHaveBeenCalled();
    expect(await h.service.readIntent(sermonId)).toEqual({ outcome: "intent",
      view: { status: "absent", version: 0, current: null, confirmationId: null, unresolvedClaimIds: [] } });
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ code: "SERMON_INTENT_NOT_CONFIRMED" });
  });

  it.each(["analysis_edit", "critique_edit", "intent_edit_edit", "confirm_edit", "confirm_confirm", "select_confirm"])(
    "atomically admits only one concurrent operation: %s", async (mode) => {
      const { h, selected, analysisId } = await ready();
      const data = analysis();
      data.centralMessage[0]!.text = "TEST_ONLY_CONCURRENT_EDIT";
      let first = intent(selected, { kind: "confirm", analysisId });
      let second = editTranscript(selected);
      if (mode === "analysis_edit") first = generate(selected);
      if (mode === "critique_edit") first = critique(selected, false, selected.intentEvents[0]!.id);
      if (mode === "intent_edit_edit") {
        first = intent(selected, { kind: "edit", baseAnalysisId: analysisId, analysis: data });
        second = first;
      }
      if (mode === "confirm_confirm") second = first;
      if (mode === "select_confirm") second = intent(selected, { kind: "select", analysisId });
      // Force both reads to finish on the same version, rather than rely on scheduling.
      const originalRead = h.port.read;
      let arrivals = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      vi.spyOn(h.port, "read").mockImplementation(async (id) => {
        const snapshot = await originalRead(id);
        if (++arrivals === 2) release();
        await gate;
        return snapshot;
      });
      const before = h.commits();
      const results = await Promise.all([h.service.execute(sermonId, first, human), h.service.execute(sermonId, second, human)]);
      expect(results.filter((r) => r.outcome === "updated")).toHaveLength(1);
      expect(results.filter((r) => r.outcome === "failed")).toEqual([expect.objectContaining({ code: "TRANSCRIPT_REVISION_CONFLICT" })]);
      expect(h.commits() - before).toBe(1);
      expect(h.snapshot().version).toBe(selected.version + 1);
      expect((await h.service.readIntent(sermonId)).outcome).toBe("intent");
    },
  );

  it.each(["source_hash", "quote", "event_version", "duplicate_id", "critique_link", "confirmation_target"])(
    "fails closed when reading corrupted intent history: %s", async (mode) => {
      const { h, state } = await confirmed();
      const corrupted = structuredClone(state) as TranscriptState;
      const initial = corrupted.intentEvents[0]!;
      const critiqued = corrupted.intentEvents[1]!;
      if (initial.operation.kind !== "analysis" || critiqued.operation.kind !== "critique") throw new Error("fixture");
      if (mode === "source_hash") initial.operation.binding.sourceSha256 = "0".repeat(64);
      if (mode === "quote") initial.operation.analysis.centralMessage[0]!.evidence[0]!.quote = "TEST_ONLY_CORRUPT";
      if (mode === "event_version") initial.version = state.version;
      if (mode === "duplicate_id") critiqued.id = initial.id;
      if (mode === "critique_link") critiqued.operation.baseAnalysisId = "missing";
      if (mode === "confirmation_target") {
        const final = corrupted.intentEvents.at(-1)!;
        if (final.operation.kind !== "confirm") throw new Error("fixture");
        final.operation.analysisId = initial.id;
      }
      h.corrupt(corrupted);
      expect(await h.service.readIntent(sermonId, true)).toMatchObject({ outcome: "failed" });
      expect(await h.service.readConfirmed(sermonId)).toMatchObject({ outcome: "failed" });
      expect(await h.service.execute(sermonId, editTranscript(state), human)).toMatchObject({ outcome: "failed" });
    },
  );

  it("supports legacy P5-07/P5-08 state and direct confirmation without any analysis", async () => {
    const { h, imported } = await setup();
    const legacy = structuredClone(imported);
    Reflect.deleteProperty(legacy, "intentEvents");
    h.corrupt(legacy);
    expect(privateTranscriptStateSchema.parse(legacy).intentEvents).toEqual([]);
    const state = await run(h, confirmTranscript(imported));
    expect(state.intentEvents).toEqual([]);
    expect(await h.service.readIntent(sermonId)).toMatchObject({ view: { status: "absent" } });
    expect((await h.service.readConfirmed(sermonId)).outcome).toBe("confirmed");
  });

  it("exposes only fixed diagnostics and fails without a partial commit on store exceptions", async () => {
    const { h, state } = await setup();
    const before = h.snapshot();
    vi.spyOn(h.port, "compareAndSwap").mockRejectedValueOnce(new Error(`${raw} TEST_ONLY_SECRET ${human.adminId}`));
    const result = await h.service.execute(sermonId, generate(state), human);
    expect(result).toMatchObject({ code: "TRANSCRIPT_VALIDATION_FAILED" });
    expect(h.snapshot()).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("TEST_ONLY");
    expect(JSON.stringify(result)).not.toContain(human.adminId);
    const updated = await h.service.execute(sermonId, generate(state), human);
    expect(transcriptRevisionDiagnosticForCopy(updated)).toEqual({ outcome: "updated" });
    expect(transcriptRevisionDiagnosticForCopy(await h.service.readIntent(sermonId))).toEqual({ outcome: "intent" });
    const spoofed = { outcome: "failed" as const, code: "SERMON_INTENT_INVALID" as const, message: raw };
    expect(transcriptRevisionDiagnosticForCopy(spoofed).message).not.toContain("TEST_ONLY");
  });
});
