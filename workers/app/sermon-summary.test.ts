import { afterEach, describe, expect, it, vi } from "vitest";

import { publicSermonSchema } from "../../shared/api/public-quiz";
import { transcriptProvider } from "../_shared/services/accountless-transcript-contract";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { currentIntentBinding } from "../_shared/services/sermon-intent";
import { intentFields, type IntentAnalysis, type IntentOperation } from "../_shared/services/sermon-intent-contract";
import { summaryBindingFromIntent } from "../_shared/services/sermon-summary";
import { sermonSummaryDraftSchema, type SermonSummaryDraft, type SummaryBinding, type SummaryOperation } from "../_shared/services/sermon-summary-contract";
import { privateTranscriptStateSchema, type PrivateTranscriptState, type TranscriptCommand,
  type TranscriptRevisionStore, type TranscriptState } from "../_shared/services/transcript-revision-contract";
import { createTranscriptRevisionService, transcriptRevisionDiagnosticForCopy } from "../_shared/services/transcript-revisions";

const sermonId = "test-summary-sermon";
const human = { kind: "human", adminId: "test-summary-private-admin", now: "2026-09-08T00:00:00.000Z" };
const raw = "\uFEFF TEST_ONLY_PRIVATE_SUMMARY_CANARY\r\n합성 근거 😀\t";
const publicText = "TEST_ONLY_PUBLIC_SUMMARY";
type Source = "timed" | "full" | "partial" | "manuscript" | "notes";
async function payload(source: Source = "notes") {
  if (source === "timed") {
    const segments = [{ text: raw, start: 0.5, duration: 2 }, { text: "TEST_ONLY_SECOND", start: 1, duration: 3 }];
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(segments)));
    return { sourceMode: "public_unofficial" as const, videoId: "aaaaaaaaaaa", language: "ko" as const,
      trackId: "test-summary-track", generated: true, retrievedAt: human.now,
      providerId: transcriptProvider.id, providerVersion: transcriptProvider.version,
      sourceSha256: Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join(""), segments };
  }
  const result = await prepareManualTranscriptSource({
    sourceMode: source === "full" || source === "partial" ? "manual_paste" : "sermon_notes",
    manualSourceKind: source === "full" || source === "partial" ? "youtube_visible_transcript"
      : source === "manuscript" ? "sermon_manuscript" : "sermon_summary",
    sourceCoverage: source === "full" ? "full_transcript" : "partial_notes", rawTranscriptText: raw,
  });
  if (result.outcome !== "validated") throw new Error("Synthetic source invalid");
  return result.source;
}
// The only store is an isolated synthetic memory double, with no IO or network.
function harness() {
  let stored: unknown = null;
  let commits = 0;
  const port: TranscriptRevisionStore = {
    async read() { return structuredClone(stored); },
    async compareAndSwap(_id, version, next) {
      if (((stored as TranscriptState | null)?.version ?? null) !== version) return false;
      stored = structuredClone(next); commits++; return true;
    },
  };
  return { port, service: createTranscriptRevisionService(port), commits: () => commits,
    snapshot: () => structuredClone(stored) as TranscriptState, corrupt: (value: unknown) => { stored = value; } };
}
type Harness = ReturnType<typeof harness>;
function head(state: PrivateTranscriptState) {
  return { expectedVersion: state.version, sourceId: state.currentSourceId, revisionId: state.currentRevisionId,
    transcriptSha256: state.revisions.at(-1)!.transcriptSha256 };
}
function intent(state: PrivateTranscriptState, operation: IntentOperation): TranscriptCommand {
  return { action: "intent", ...head(state), operation };
}
function summary(state: PrivateTranscriptState, operation: SummaryOperation): TranscriptCommand {
  return { action: "summary", ...head(state), operation };
}
function evidence(timed = false) {
  const from = raw.indexOf("합성");
  return { segmentId: timed ? "segment-1" : null, start: timed ? 0.5 : null, duration: timed ? 2 : null,
    from, to: from + "합성 근거 😀".length, quote: "합성 근거 😀" };
}
function analysis(timed = false): IntentAnalysis {
  return Object.fromEntries(intentFields.map((field) => [field, [{ id: field, text: `TEST_ONLY_PRIVATE_${field}`,
    origin: "transcript", evidence: [evidence(timed)] }]])) as IntentAnalysis;
}
function draft(timed = false): SermonSummaryDraft {
  return { paragraphs: [{ id: "central", text: publicText, intentClaimIds: ["centralMessage", "purpose"], evidence: [evidence(timed)] },
    { id: "application", text: "TEST_ONLY_PUBLIC_APPLICATION", intentClaimIds: ["audienceResponse"], evidence: [evidence(timed)] }] };
}
async function run(h: Harness, command: TranscriptCommand) {
  const result = await h.service.execute(sermonId, command, human);
  expect(result.outcome).toBe("updated");
  if (result.outcome !== "updated") throw new Error(result.code);
  return result.state;
}
async function binding(h: Harness): Promise<SummaryBinding> {
  const result = await h.service.readIntent(sermonId, true);
  if (result.outcome !== "intent") throw new Error(result.code);
  const value = summaryBindingFromIntent(result.view);
  if (!value) throw new Error("Unconfirmed fixture");
  return value;
}
async function confirmIntent(h: Harness, state: PrivateTranscriptState, timed = false) {
  const first = await run(h, intent(state, { kind: "analysis", binding: currentIntentBinding(state)!, analysis: analysis(timed) }));
  const clear = { assessment: "clear" as const, concerns: [] };
  const second = await run(h, intent(first, { kind: "critique", binding: currentIntentBinding(first)!,
    baseAnalysisId: first.intentEvents.at(-1)!.id, analysis: analysis(timed),
    critique: { exaggeratedIntent: clear, unsupportedConclusion: clear, illustrationAsMainClaim: clear, reversedMeaning: clear } }));
  const analysisId = second.intentEvents.at(-1)!.id;
  const selected = await run(h, intent(second, { kind: "select", analysisId }));
  return run(h, intent(selected, { kind: "confirm", analysisId }));
}
async function setup(source: Source = "notes") {
  const h = harness();
  const imported = await run(h, { action: "import_source", expectedVersion: 0, payload: await payload(source) });
  const transcript = await run(h, { action: "confirm", ...head(imported), reviewed: true });
  const state = await confirmIntent(h, transcript, source === "timed");
  return { h, imported, transcript, state };
}
async function generated(source: Source = "notes") {
  const fixture = await setup(source);
  const generated = await run(fixture.h, summary(fixture.state,
    { kind: "generate", binding: await binding(fixture.h), draft: draft(source === "timed") }));
  return { ...fixture, state: generated, summaryId: generated.summaryEvents.at(-1)!.id };
}
async function reviewed(source: Source = "notes") {
  const fixture = await generated(source);
  return { ...fixture, state: await run(fixture.h, summary(fixture.state, { kind: "review", summaryId: fixture.summaryId })) };
}
afterEach(() => vi.restoreAllMocks());

describe("P5-10 synthetic summary contract and server boundary", () => {
  it.each(["timed", "full", "manuscript", "notes"] as const)("projects only public paragraphs and source-derived disclosure: %s", async (source) => {
    const { h, state, summaryId } = await generated(source);
    expect(await h.service.readSummary(sermonId)).toMatchObject({ view: { status: "awaiting_review",
      current: { id: summaryId, evidenceReviewIds: ["central", "application"] }, reviewId: null } });
    expect(await h.service.readSummaryPreview(sermonId, true)).toMatchObject({ code: "SERMON_SUMMARY_NOT_REVIEWED" });
    const preview = await h.service.readSummaryPreview(sermonId);
    expect(preview.outcome).toBe("summary_preview");
    if (preview.outcome !== "summary_preview") throw new Error("fixture");
    expect(preview.summary.text).toBe(`${publicText}\n\nTEST_ONLY_PUBLIC_APPLICATION`);
    expect(preview.summary.disclosure).toBe(source === "timed" || source === "full"
      ? "아래 내용은 설교 영상의 공개 자막을 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다."
      : "아래 내용은 관리자가 제공한 설교 자료를 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다.");
    expect(Object.keys(preview.summary).sort()).toEqual(["disclosure", "text"]);
    expect(publicSermonSchema.shape.summary.safeParse(preview.summary).success).toBe(true);
    for (const privateValue of [raw, "합성 근거", "TEST_ONLY_PRIVATE", human.adminId, summaryId,
      state.currentRevisionId, state.revisions.at(-1)!.transcriptSha256, "intentClaimIds", "evidence", "binding"]) {
      expect(JSON.stringify(preview)).not.toContain(privateValue);
    }
    expect(transcriptRevisionDiagnosticForCopy(preview)).toEqual({ outcome: "summary_preview" });
    const final = await run(h, summary(state, { kind: "review", summaryId }));
    expect(await h.service.readSummary(sermonId, true)).toMatchObject({ view: { status: "reviewed",
      reviewId: final.summaryEvents.at(-1)!.id, current: { evidenceReviewIds: [] } } });
    expect(final.summaryEvents.at(-1)).toMatchObject({ actorId: human.adminId, createdAt: human.now });
    expect(await h.service.readSummaryPreview(sermonId, true)).toEqual(preview);
    expect(Object.isFrozen(final.summaryEvents[0]!.operation)).toBe(true);
  });

  it("retains partial YouTube drafts while refusing an invented full-transcript or notes disclosure", async () => {
    const { h } = await reviewed("partial");
    expect(await h.service.readSummary(sermonId, true)).toMatchObject({ view: { status: "reviewed" } });
    expect(await h.service.readSummaryPreview(sermonId)).toMatchObject({ code: "SERMON_SUMMARY_DISCLOSURE_UNSUPPORTED" });
  });

  it("keeps edited and reviewed selection when regeneration returns, and restores as a new unreviewed snapshot", async () => {
    const { h, state, summaryId } = await reviewed();
    const nextDraft = draft(); nextDraft.paragraphs[0]!.text = "TEST_ONLY_HUMAN_EDIT";
    const edit = await run(h, summary(state, { kind: "edit", binding: await binding(h), baseSummaryId: summaryId, draft: nextDraft }));
    nextDraft.paragraphs[0]!.text = "TEST_ONLY_MUTATED_CALLER";
    const editId = edit.summaryEvents.at(-1)!.id;
    expect(await h.service.readSummary(sermonId, true)).toMatchObject({ code: "SERMON_SUMMARY_NOT_REVIEWED" });
    const approved = await run(h, summary(edit, { kind: "review", summaryId: editId }));
    const another = await run(h, summary(approved, { kind: "generate", binding: await binding(h), draft: draft() }));
    const candidateId = another.summaryEvents.at(-1)!.id;
    expect(await h.service.readSummary(sermonId, true)).toMatchObject({ view: { current: { id: editId } } });
    expect((await h.service.readSummaryPreview(sermonId))).toMatchObject({ summary: { text: "TEST_ONLY_HUMAN_EDIT\n\nTEST_ONLY_PUBLIC_APPLICATION" } });
    const selected = await run(h, summary(another, { kind: "select", summaryId: candidateId }));
    expect(await h.service.readSummary(sermonId)).toMatchObject({ view: { status: "awaiting_review" } });
    const restored = await run(h, summary(selected, { kind: "restore", summaryId: editId }));
    expect(await h.service.readSummary(sermonId)).toMatchObject({ view: { status: "awaiting_review", current: {
      id: restored.summaryEvents.at(-1)!.id, kind: "restore", restoredFromSummaryId: editId } } });
    expect(restored.summaryEvents.slice(0, state.summaryEvents.length)).toEqual(state.summaryEvents);
    expect(restored.intentEvents).toEqual(state.intentEvents);
    expect(restored.sources).toEqual(state.sources);
  });

  it.each(["edit", "restore", "import_source", "merge_corrections", "reconfirm"] as const)("closes stale summaries after transcript %s while preserving old revisions", async (action) => {
    const { h, state: before, summaryId } = await reviewed();
    let state = before;
    let command: TranscriptCommand;
    if (action === "import_source") command = { action, expectedVersion: state.version, payload: await payload() };
    else if (action === "restore") command = { action, ...head(state), restoreRevisionId: state.revisions[0]!.id };
    else if (action === "reconfirm") command = { action: "confirm", ...head(state), reviewed: true };
    else if (action === "edit") command = { action, ...head(state), content: { format: "plain_text", text: raw } };
    else {
      const from = raw.indexOf("합성");
      state = await run(h, { action: "propose_corrections", ...head(state), proposal: {
        sourceId: state.currentSourceId, sourceSha256: (await binding(h)).transcript.sourceSha256,
        baseRevisionId: state.currentRevisionId, baseTranscriptSha256: head(state).transcriptSha256,
        items: [{ id: "correction", segmentId: null, start: null, duration: null, from, to: from + 2,
          originalText: "합성", proposedText: "가상", changeType: "spelling", reason: "TEST_ONLY_REASON", confidence: 0.5,
          riskFlags: [], contextBefore: raw.slice(0, from), contextAfter: raw.slice(from + 2) }],
      } });
      state = await run(h, { action: "decide_corrections", ...head(state), proposalId: state.correctionProposals[0]!.id,
        decisions: [{ itemId: "correction", decision: "accepted" }], reviewed: true });
      expect(await h.service.readSummary(sermonId, true)).toMatchObject({ view: { status: "reviewed" } });
      command = { action, ...head(state), proposalId: state.correctionProposals[0]!.id };
    }
    const changed = await run(h, command);
    expect(changed.summaryEvents).toEqual(before.summaryEvents);
    expect(await h.service.readSummary(sermonId)).toMatchObject({ view: { status: "needs_review", reviewId: null } });
    expect(await h.service.readSummaryPreview(sermonId)).toMatchObject({ code: "SERMON_SUMMARY_NOT_REVIEWED" });
    expect(await h.service.execute(sermonId, summary(changed, { kind: "review", summaryId }), human))
      .toMatchObject({ code: "SERMON_INTENT_NOT_CONFIRMED" });
    if (action !== "merge_corrections") {
      const reconfirmed = await run(h, { action: "confirm", ...head(changed), reviewed: true });
      const ready = await confirmIntent(h, reconfirmed);
      expect(await h.service.readSummary(sermonId)).toMatchObject({ view: { status: "needs_review" } });
      expect(await h.service.execute(sermonId, summary(ready, { kind: "select", summaryId }), human))
        .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
      const revised = await run(h, summary(ready, { kind: "edit", binding: await binding(h), baseSummaryId: summaryId, draft: draft() }));
      expect(await h.service.readSummary(sermonId)).toMatchObject({ view: { status: "awaiting_review" } });
      await run(h, summary(revised, { kind: "review", summaryId: revised.summaryEvents.at(-1)!.id }));
      expect(await h.service.readSummaryPreview(sermonId, true)).toMatchObject({ outcome: "summary_preview" });
    }
  });

  it.each(["edit", "select", "confirm"] as const)("requires summary re-review after upstream intent %s", async (kind) => {
    const { h, state, summaryId } = await reviewed();
    const input = await binding(h);
    const op: IntentOperation = kind === "edit" ? { kind, baseAnalysisId: input.analysisId, analysis: analysis() }
      : { kind, analysisId: input.analysisId };
    let changed = await run(h, intent(state, op));
    expect(await h.service.readSummary(sermonId)).toMatchObject({ view: { status: "needs_review", reviewId: null } });
    if (kind !== "confirm") changed = await run(h, intent(changed,
      { kind: "confirm", analysisId: kind === "edit" ? changed.intentEvents.at(-1)!.id : input.analysisId }));
    expect(await h.service.execute(sermonId, summary(changed, { kind: "restore", summaryId }), human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    const revised = await run(h, summary(changed, { kind: "edit", binding: await binding(h), baseSummaryId: summaryId, draft: draft() }));
    await run(h, summary(revised, { kind: "review", summaryId: revised.summaryEvents.at(-1)!.id }));
    expect(await h.service.readSummary(sermonId, true)).toMatchObject({ view: { status: "reviewed" } });
  });

  it("keeps current eligibility for comparison-only intent analysis but rejects delayed input version", async () => {
    const { h, state } = await reviewed();
    const oldBinding = await binding(h);
    const next = await run(h, intent(state, { kind: "analysis", binding: currentIntentBinding(state)!, analysis: analysis() }));
    expect(await h.service.readSummary(sermonId, true)).toMatchObject({ view: { status: "reviewed" } });
    expect(await h.service.execute(sermonId, summary(next, { kind: "generate", binding: oldBinding, draft: draft() }), human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    await run(h, summary(next, { kind: "generate", binding: await binding(h), draft: draft() }));
  });

  it.each(["sourceId", "sourceRevision", "sourceSha256", "revisionId", "transcriptSha256", "confirmationId", "version", "analysisId", "intentConfirmationId"] as const)("rejects a mismatched input binding: %s", async (field) => {
    const { h, state } = await setup();
    const input = await binding(h);
    if (field === "analysisId" || field === "intentConfirmationId") input[field] = "unknown";
    else if (field === "sourceRevision" || field === "version") input.transcript[field]++;
    else if (field === "sourceSha256" || field === "transcriptSha256") input.transcript[field] = "0".repeat(64);
    else input.transcript[field] = "unknown";
    expect(await h.service.execute(sermonId, summary(state, { kind: "generate", binding: input, draft: draft() }), human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    expect(h.snapshot()).toEqual(state);
  });

  it("accepts a different exact source quotation without requiring analysis-quote duplication", async () => {
    const { h, state } = await setup("timed"), data = draft(true);
    data.paragraphs[0]!.evidence = [{ segmentId: "segment-2", start: 1, duration: 3, from: 0, to: 16, quote: "TEST_ONLY_SECOND" }];
    await run(h, summary(state, { kind: "generate", binding: await binding(h), draft: data }));
    expect(await h.service.readSummary(sermonId)).toMatchObject({ view: { status: "awaiting_review" } });
  });
  it.each(["quote", "range", "time", "segment", "duplicate_evidence", "duplicate_paragraph", "duplicate_claim", "missing_claim"] as const)("rejects unsupported or malformed evidence: %s", async (mode) => {
    const { h, state } = await setup("timed");
    const data = draft(true), p = data.paragraphs[0]!, e = p.evidence[0]!;
    if (mode === "quote") e.quote = "TEST_ONLY_FORGED";
    if (mode === "range") e.to = e.from;
    if (mode === "time") e.start = 999;
    if (mode === "segment") e.segmentId = "segment-2";
    if (mode === "duplicate_evidence") p.evidence.push(structuredClone(e));
    if (mode === "duplicate_paragraph") data.paragraphs.push(structuredClone(p));
    if (mode === "duplicate_claim") p.intentClaimIds.push("centralMessage");
    if (mode === "missing_claim") p.intentClaimIds = ["other-analysis-claim"];
    expect(await h.service.execute(sermonId, summary(state, { kind: "generate", binding: await binding(h), draft: data }), human))
      .toMatchObject({ code: "SERMON_SUMMARY_INVALID" });
    expect(h.snapshot()).toEqual(state);
  });

  it.each(["unresolved", "admin_context"] as const)("never promotes private %s claims into summary conclusions", async (origin) => {
    const { h, state } = await setup();
    const input = await binding(h), a = analysis();
    a.centralMessage = [{ id: "centralMessage", text: "TEST_ONLY_PRIVATE_CONTEXT", origin, evidence: [] }];
    const edit = await run(h, intent(state, { kind: "edit", baseAnalysisId: input.analysisId, analysis: a }));
    const approved = await run(h, intent(edit, { kind: "confirm", analysisId: edit.intentEvents.at(-1)!.id }));
    expect(await h.service.execute(sermonId, summary(approved, { kind: "generate", binding: await binding(h), draft: draft() }), human))
      .toMatchObject({ code: "SERMON_SUMMARY_INVALID" });
  });

  it.each(["empty", "blank", "no_evidence", "no_intent", "secret", "bible_text", "disclosure", "model", "actor", "status"])("strictly rejects generated or client authority fields: %s", async (mode) => {
    const { h, state } = await setup();
    const data = draft();
    const operation: SummaryOperation = { kind: "generate", binding: await binding(h), draft: data };
    if (mode === "empty") data.paragraphs = [];
    else if (mode === "blank") data.paragraphs[0]!.text = "\uFEFF \t\u200B";
    else if (mode === "no_evidence") data.paragraphs[0]!.evidence = [];
    else if (mode === "no_intent") data.paragraphs[0]!.intentClaimIds = [];
    else if (mode === "actor" || mode === "status") Object.assign(operation, { [mode]: "TEST_ONLY_PRIVATE" });
    else Object.assign(data, { [mode]: "TEST_ONLY_PRIVATE" });
    expect(await h.service.execute(sermonId, summary(state, operation), human)).toMatchObject({ code: "INVALID_TRANSCRIPT_REQUEST" });
    expect(h.snapshot()).toEqual(state);
  });

  it("allows large structured drafts without silently truncating them, but enforces the existing public text limit", async () => {
    const { h, state } = await setup();
    const data = draft(); data.paragraphs[0]!.text = "가".repeat(20001);
    expect(sermonSummaryDraftSchema.safeParse(data).success).toBe(true);
    await run(h, summary(state, { kind: "generate", binding: await binding(h), draft: data }));
    expect(await h.service.readSummary(sermonId)).toMatchObject({ outcome: "summary" });
    expect(await h.service.readSummaryPreview(sermonId)).toMatchObject({ code: "SERMON_SUMMARY_INVALID" });
  });

  it.each(["generate_edit", "generate_intent", "generate_generate", "edit_edit", "review_edit", "review_review", "select_review", "restore_edit"] as const)("commits exactly once for concurrent operations: %s", async (mode) => {
    const { h, state, summaryId } = await generated();
    const input = await binding(h);
    const generate = summary(state, { kind: "generate", binding: input, draft: draft() });
    const edit = summary(state, { kind: "edit", binding: input, baseSummaryId: summaryId, draft: draft() });
    const review = summary(state, { kind: "review", summaryId });
    let first = generate, second: TranscriptCommand = { action: "edit", ...head(state), content: { format: "plain_text", text: raw } };
    if (mode === "generate_intent") second = intent(state, { kind: "edit", baseAnalysisId: input.analysisId, analysis: analysis() });
    if (mode === "generate_generate") second = generate;
    if (mode === "edit_edit") { first = edit; second = edit; }
    if (mode === "review_edit") { first = review; second = edit; }
    if (mode === "review_review") { first = review; second = review; }
    if (mode === "select_review") { first = summary(state, { kind: "select", summaryId }); second = review; }
    if (mode === "restore_edit") { first = summary(state, { kind: "restore", summaryId }); second = edit; }
    const originalRead = h.port.read;
    let arrivals = 0, release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(h.port, "read").mockImplementation(async (id) => {
      const snapshot = await originalRead(id);
      if (++arrivals === 2) release();
      await gate; return snapshot;
    });
    const before = h.commits();
    const results = await Promise.all([h.service.execute(sermonId, first, human), h.service.execute(sermonId, second, human)]);
    spy.mockRestore();
    expect(results.filter((r) => r.outcome === "updated")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "failed")).toEqual([expect.objectContaining({ code: "TRANSCRIPT_REVISION_CONFLICT" })]);
    expect(h.commits() - before).toBe(1);
    expect(h.snapshot().version).toBe(state.version + 1);
    expect(await h.service.readSummary(sermonId)).toMatchObject({ outcome: "summary" });
  });

  it.each(["binding", "quote", "intent_id", "review_target", "event_version", "duplicate_id", "unknown_field"])("fails closed on stored summary corruption: %s", async (mode) => {
    const { h, state } = await reviewed();
    const corrupt = structuredClone(state) as TranscriptState;
    const first = corrupt.summaryEvents[0]!, last = corrupt.summaryEvents.at(-1)!;
    if (first.operation.kind !== "generate" || last.operation.kind !== "review") throw new Error("fixture");
    if (mode === "binding") first.operation.binding.transcript.version++;
    if (mode === "quote") first.operation.draft.paragraphs[0]!.evidence[0]!.quote = "TEST_ONLY_CORRUPT";
    if (mode === "intent_id") first.operation.binding.analysisId = "unknown";
    if (mode === "review_target") last.operation.summaryId = "unknown";
    if (mode === "event_version") first.version = corrupt.intentEvents.at(-1)!.version;
    if (mode === "duplicate_id") last.id = first.id;
    if (mode === "unknown_field") Object.assign(first, { public: true });
    h.corrupt(corrupt);
    expect(await h.service.readSummary(sermonId)).toMatchObject({ outcome: "failed" });
    expect(await h.service.readSummaryPreview(sermonId)).toMatchObject({ outcome: "failed" });
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ outcome: "failed" });
    expect(await h.service.execute(sermonId, { action: "confirm", ...head(state), reviewed: true }, human)).toMatchObject({ outcome: "failed" });
  });

  it("requires confirmed inputs and human authority; accepts legacy states without summary events", async () => {
    const { h, state, imported, transcript } = await setup();
    const command = summary(state, { kind: "generate", binding: await binding(h), draft: draft() });
    expect(await h.service.execute(sermonId, command, { ...human, kind: "ai" })).toMatchObject({ code: "HUMAN_REVIEW_REQUIRED" });
    for (const old of [imported, transcript]) {
      h.corrupt(old);
      expect(await h.service.execute(sermonId, { ...command, ...head(old) }, human)).toMatchObject({ code: "SERMON_INTENT_NOT_CONFIRMED" });
    }
    const legacy = structuredClone(state); Reflect.deleteProperty(legacy, "summaryEvents"); h.corrupt(legacy);
    expect(privateTranscriptStateSchema.parse(legacy).summaryEvents).toEqual([]);
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ outcome: "intent" });
    expect(await h.service.readSummary(sermonId)).toMatchObject({ view: { status: "absent" } });
    await run(h, command);
  });

  it("validates identities before storage and exposes only fixed diagnostics on private store failures", async () => {
    const empty = harness(), read = vi.spyOn(empty.port, "read");
    expect(await empty.service.readSummary("../bad")).toMatchObject({ code: "INVALID_TRANSCRIPT_REQUEST" });
    expect(await empty.service.readSummaryPreview("../bad")).toMatchObject({ code: "INVALID_TRANSCRIPT_REQUEST" });
    expect(read).not.toHaveBeenCalled();
    expect(await empty.service.readSummary(sermonId)).toMatchObject({ view: { status: "absent", version: 0 } });
    expect(await empty.service.readSummaryPreview(sermonId)).toMatchObject({ code: "SERMON_SUMMARY_NOT_REVIEWED" });
    const { h, state } = await setup();
    const command = summary(state, { kind: "generate", binding: await binding(h), draft: draft() });
    vi.spyOn(h.port, "compareAndSwap").mockRejectedValueOnce(new Error(`${raw} ${human.adminId}`));
    const failed = await h.service.execute(sermonId, command, human);
    expect(failed).toMatchObject({ code: "TRANSCRIPT_VALIDATION_FAILED" });
    expect(JSON.stringify(failed)).not.toContain("TEST_ONLY");
    expect(h.snapshot()).toEqual(state);
    expect(transcriptRevisionDiagnosticForCopy({ outcome: "failed", code: "SERMON_SUMMARY_INVALID", message: raw }).message).not.toContain("TEST_ONLY");
    await run(h, command);
    expect(transcriptRevisionDiagnosticForCopy(await h.service.readSummary(sermonId))).toEqual({ outcome: "summary" });
    vi.spyOn(h.port, "read").mockRejectedValueOnce(new Error(raw));
    expect(await h.service.readSummaryPreview(sermonId)).toMatchObject({ code: "TRANSCRIPT_VALIDATION_FAILED" });
  });
});
