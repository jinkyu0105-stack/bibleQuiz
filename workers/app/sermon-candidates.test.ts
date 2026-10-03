import { afterEach, describe, expect, it, vi } from "vitest";

import { transcriptProvider } from "../_shared/services/accountless-transcript-contract";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { currentIntentBinding } from "../_shared/services/sermon-intent";
import { intentFields, type IntentAnalysis, type IntentOperation } from "../_shared/services/sermon-intent-contract";
import { candidateBindingFromIntent } from "../_shared/services/sermon-candidates";
import { publicCandidateCluesSchema, sermonCandidateDraftSchema, type SermonCandidateDraft, type CandidateBinding, type CandidateOperation, type CandidateDifficulty } from "../_shared/services/sermon-candidates-contract";
import { privateTranscriptStateSchema, type PrivateTranscriptState, type TranscriptCommand,
  type TranscriptRevisionStore, type TranscriptState } from "../_shared/services/transcript-revision-contract";
import { createTranscriptRevisionService, transcriptRevisionDiagnosticForCopy } from "../_shared/services/transcript-revisions";

const sermonId = "test-candidates-sermon";
const human = { kind: "human", adminId: "test-candidates-private-admin", now: "2026-09-08T00:00:00.000Z" };
const raw = "\uFEFF TEST_ONLY_PRIVATE_CANDIDATES_CANARY\r\n합성 근거 😀\t";
const publicText = "TEST_ONLY_PUBLIC_CLUE";
type Source = "timed" | "full" | "partial" | "manuscript" | "notes";
async function payload(source: Source = "notes") {
  if (source === "timed") {
    const segments = [{ text: raw, start: 0.5, duration: 2 }, { text: "TEST_ONLY_SECOND", start: 1, duration: 3 }];
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(segments)));
    return { sourceMode: "public_unofficial" as const, videoId: "aaaaaaaaaaa", language: "ko" as const,
      trackId: "test-candidates-track", generated: true, retrievedAt: human.now,
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
function candidates(state: PrivateTranscriptState, operation: CandidateOperation): TranscriptCommand {
  return { action: "candidates", ...head(state), operation };
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
function draft(timed = false, difficulty: CandidateDifficulty = "child"): SermonCandidateDraft {
  return { candidates: [{ id: "candidate-1", displayAnswer: "합성 낱말", gridAnswer: "합성낱말",
    clue: `${publicText}_${difficulty}`, phraseDescription: "TEST_ONLY_PRIVATE_PHRASE",
    selectionReason: "TEST_ONLY_PRIVATE_REASON", sermonImportance: "TEST_ONLY_PRIVATE_IMPORTANCE",
    difficultyReason: difficulty === "child" ? "TEST_ONLY_DIRECT_SHORT" : "TEST_ONLY_ARGUMENT_APPLICATION",
    grounding: { origin: "transcript", intentClaimIds: ["centralMessage", "purpose"], evidence: [evidence(timed)] } }] };
}
async function run(h: Harness, command: TranscriptCommand) {
  const result = await h.service.execute(sermonId, command, human);
  expect(result.outcome).toBe("updated");
  if (result.outcome !== "updated") throw new Error(result.code);
  return result.state;
}
async function binding(h: Harness): Promise<CandidateBinding> {
  const result = await h.service.readIntent(sermonId, true);
  if (result.outcome !== "intent") throw new Error(result.code);
  const value = candidateBindingFromIntent(result.view);
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
async function generated(source: Source = "notes", difficulty: CandidateDifficulty = "child") {
  const fixture = await setup(source);
  const state = await run(fixture.h, candidates(fixture.state,
    { kind: "generate", difficulty, binding: await binding(fixture.h), draft: draft(source === "timed", difficulty) }));
  return { ...fixture, state, poolId: state.candidateEvents.at(-1)!.id };
}
async function reviewed(source: Source = "notes", difficulty: CandidateDifficulty = "child") {
  const fixture = await generated(source, difficulty);
  return { ...fixture, state: await run(fixture.h, candidates(fixture.state, { kind: "review", difficulty, poolId: fixture.poolId })) };
}
afterEach(() => vi.restoreAllMocks());

describe("P5-11 synthetic candidate contracts and server validation", () => {
  it.each(["timed", "full", "partial", "manuscript", "notes"] as const)("keeps private answers/evidence out of reviewed clues: %s", async (source) => {
    const { h, state, poolId } = await generated(source);
    expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ view: { status: "awaiting_review",
      current: { id: poolId, evidenceReviewIds: ["candidate-1"], statuses: { "candidate-1": "use" } } } });
    expect(await h.service.readCandidateClues(sermonId, "child")).toMatchObject({ code: "SERMON_CANDIDATES_NOT_REVIEWED" });
    const reviewed = await run(h, candidates(state, { kind: "review", difficulty: "child", poolId }));
    expect(await h.service.readCandidates(sermonId, "child", true)).toMatchObject({ view: { status: "reviewed",
      current: { evidenceReviewIds: [] }, reviewId: reviewed.candidateEvents.at(-1)!.id } });
    expect(reviewed.candidateEvents.at(-1)).toMatchObject({ actorId: human.adminId, createdAt: human.now });
    const result = await h.service.readCandidateClues(sermonId, "child");
    expect(result).toEqual({ outcome: "candidate_clues", preview: { difficulty: "child", clues: [{ clue: `${publicText}_child` }] } });
    if (result.outcome !== "candidate_clues") throw new Error("fixture");
    expect(publicCandidateCluesSchema.safeParse(result.preview).success).toBe(true);
    for (const secret of [raw, "합성낱말", "합성 낱말", "합성 근거", "TEST_ONLY_PRIVATE", human.adminId, poolId,
      "evidence", "grounding", "statuses", "gridAnswer", "intentClaimIds", state.currentRevisionId, head(state).transcriptSha256]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(transcriptRevisionDiagnosticForCopy(result)).toEqual({ outcome: "candidate_clues" });
    expect(Object.isFrozen(reviewed.candidateEvents[0]!.operation)).toBe(true);
    // Partial source disclosure remains P5-10's independent gate; clues invent no disclosure.
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ outcome: "intent" });
  });

  it("keeps difficulty jobs independent and permits shared answers with distinct clues", async () => {
    const { h, state, poolId } = await reviewed();
    const bad = draft(false, "adult"); bad.candidates[0]!.gridAnswer = "BAD";
    expect(await h.service.execute(sermonId, candidates(state,
      { kind: "generate", difficulty: "adult", binding: await binding(h), draft: bad }), human)).toMatchObject({ code: "SERMON_CANDIDATES_INVALID" });
    expect(h.snapshot()).toEqual(state);
    const adult = await run(h, candidates(state, { kind: "generate", difficulty: "adult", binding: await binding(h), draft: draft(false, "adult") }));
    expect(await h.service.readCandidates(sermonId, "child", true)).toMatchObject({ view: { current: { id: poolId } } });
    expect(await h.service.readCandidates(sermonId, "adult")).toMatchObject({ view: { status: "awaiting_review" } });
    await run(h, candidates(adult, { kind: "review", difficulty: "adult", poolId: adult.candidateEvents.at(-1)!.id }));
    expect(await h.service.readCandidateClues(sermonId, "adult")).toMatchObject({ preview: { clues: [{ clue: `${publicText}_adult` }] } });
  });

  it("preserves human edits, statuses and history through regeneration, selection and restoration", async () => {
    const { h, state, poolId } = await reviewed();
    const data = draft(); data.candidates[0]!.clue = "TEST_ONLY_EDITED_CLUE";
    const edited = await run(h, candidates(state, { kind: "edit", difficulty: "child", binding: await binding(h), basePoolId: poolId, draft: data }));
    const editId = edited.candidateEvents.at(-1)!.id;
    data.candidates[0]!.clue = "TEST_ONLY_CALLER_MUTATION";
    const approved = await run(h, candidates(edited, { kind: "review", difficulty: "child", poolId: editId }));
    const another = await run(h, candidates(approved, { kind: "generate", difficulty: "child", binding: await binding(h), draft: draft() }));
    expect(await h.service.readCandidateClues(sermonId, "child")).toMatchObject({ preview: { clues: [{ clue: "TEST_ONLY_EDITED_CLUE" }] } });
    const selected = await run(h, candidates(another, { kind: "select", difficulty: "child", poolId: another.candidateEvents.at(-1)!.id }));
    expect(await h.service.readCandidates(sermonId, "child", true)).toMatchObject({ code: "SERMON_CANDIDATES_NOT_REVIEWED" });
    const restored = await run(h, candidates(selected, { kind: "restore", difficulty: "child", poolId: editId }));
    expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ view: { status: "awaiting_review", current: {
      id: restored.candidateEvents.at(-1)!.id, kind: "restore", restoredFromPoolId: editId } } });
    expect(restored.candidateEvents.slice(0, state.candidateEvents.length)).toEqual(state.candidateEvents);
    expect(restored.intentEvents).toEqual(state.intentEvents); expect(restored.sources).toEqual(state.sources);
  });

  it("excludes, restores and locks candidates with fresh snapshots and review; edits retain status", async () => {
    const { h, state, poolId } = await reviewed();
    let current = state, id = poolId;
    for (const status of ["excluded", "use", "locked"] as const) {
      current = await run(h, candidates(current, { kind: "set_status", difficulty: "child", poolId: id, candidateId: "candidate-1", status }));
      id = current.candidateEvents.at(-1)!.id;
      expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ view: { status: "awaiting_review", current: { statuses: { "candidate-1": status } } } });
      current = await run(h, candidates(current, { kind: "review", difficulty: "child", poolId: id }));
      expect(await h.service.readCandidateClues(sermonId, "child")).toMatchObject({ preview: { clues: status === "excluded" ? [] : [{ clue: `${publicText}_child` }] } });
    }
    const data = draft(); data.candidates[0]!.displayAnswer = "다른  낱말"; data.candidates[0]!.gridAnswer = "다른낱말";
    current = await run(h, candidates(current, { kind: "edit", difficulty: "child", binding: await binding(h), basePoolId: id, draft: data }));
    expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ view: { status: "awaiting_review", current: {
      statuses: { "candidate-1": "locked" }, draft: { candidates: [{ displayAnswer: "다른  낱말", gridAnswer: "다른낱말" }] } } } });
    expect(current.candidateEvents.slice(0, state.candidateEvents.length)).toEqual(state.candidateEvents);
  });

  it("allows human-only admin notes without fabricated transcript evidence and resets review", async () => {
    const { h, state, poolId } = await reviewed();
    const data = draft(); data.candidates[0]!.grounding = { origin: "admin_context", note: "TEST_ONLY_PRIVATE_ADMIN_NOTE" };
    expect(await h.service.execute(sermonId, candidates(state,
      { kind: "generate", difficulty: "child", binding: await binding(h), draft: data }), human)).toMatchObject({ code: "SERMON_CANDIDATES_INVALID" });
    const edited = await run(h, candidates(state, { kind: "edit", difficulty: "child", binding: await binding(h), basePoolId: poolId, draft: data }));
    expect(await h.service.readCandidateClues(sermonId, "child")).toMatchObject({ code: "SERMON_CANDIDATES_NOT_REVIEWED" });
    await run(h, candidates(edited, { kind: "review", difficulty: "child", poolId: edited.candidateEvents.at(-1)!.id }));
    expect(JSON.stringify(await h.service.readCandidateClues(sermonId, "child"))).not.toContain("ADMIN_NOTE");
  });

  it.each(["single", "latin", "number", "punctuation", "emoji", "hanja", "jamo", "too_long", "mismatch", "non_nfc"])("rejects invalid answer format without partial writes: %s", async (mode) => {
    const { h, state } = await setup(); const data = draft(); const c = data.candidates[0]!;
    c.displayAnswer = ({ single: "말", latin: "합성A", number: "합성1", punctuation: "합성!", emoji: "합성😀", hanja: "합성字", jamo: "합성ㄱ", too_long: "가".repeat(11) } as Record<string, string>)[mode] ?? "합성 낱말";
    c.gridAnswer = c.displayAnswer.replace(/\s/gu, "");
    if (mode === "mismatch") c.gridAnswer = "다른정답";
    if (mode === "non_nfc") c.gridAnswer = c.gridAnswer.normalize("NFD");
    expect(await h.service.execute(sermonId, candidates(state, { kind: "generate", difficulty: "child", binding: await binding(h), draft: data }), human))
      .toMatchObject({ code: "SERMON_CANDIDATES_INVALID" });
    expect(h.snapshot()).toEqual(state);
  });

  it("retains spaced noun phrases and particles, and does not impose a five-cell or fifteen-candidate cap", async () => {
    const { h, state } = await setup(); const data = draft();
    data.candidates[0]!.displayAnswer = "하나님의  열심"; data.candidates[0]!.gridAnswer = "하나님의열심";
    for (let i = 0; i < 20; i++) data.candidates.push({ ...structuredClone(draft().candidates[0]!), id: `extra-${i}`,
      displayAnswer: `합성${String.fromCharCode(0xac00 + i)}`, gridAnswer: `합성${String.fromCharCode(0xac00 + i)}`, clue: `TEST_ONLY_CLUE_${i}` });
    expect(sermonCandidateDraftSchema.safeParse(data).success).toBe(true);
    await run(h, candidates(state, { kind: "generate", difficulty: "child", binding: await binding(h), draft: data }));
    const result = await h.service.readCandidates(sermonId, "child");
    if (result.outcome !== "candidates") throw new Error("fixture");
    expect(result.view.current!.draft.candidates).toHaveLength(21);
    expect(result.view.current!.draft.candidates[0]).toMatchObject({ displayAnswer: "하나님의  열심", gridAnswer: "하나님의열심" });
  });

  it.each(["id", "answer", "clue", "cross_difficulty_clue"])("rejects duplicate or copied candidates: %s", async (mode) => {
    const { h, state } = await generated(); const data = draft(false, "adult");
    if (mode === "cross_difficulty_clue") data.candidates[0]!.clue = `${publicText}_ child`;
    else {
      const copy = structuredClone(data.candidates[0]!);
      if (mode !== "id") copy.id = "second";
      if (mode !== "answer") { copy.displayAnswer = "다른 말"; copy.gridAnswer = "다른말"; }
      if (mode !== "clue") copy.clue = "OTHER_CLUE";
      data.candidates.push(copy);
    }
    expect(await h.service.execute(sermonId, candidates(state, { kind: "generate", difficulty: "adult", binding: await binding(h), draft: data }), human))
      .toMatchObject({ code: "SERMON_CANDIDATES_INVALID" });
    expect(h.snapshot()).toEqual(state);
  });
  it.each(["edit", "restore", "import_source", "merge_corrections", "reconfirm"] as const)("closes stale candidates after transcript %s while preserving old revisions", async (action) => {
    const { h, state: before, poolId } = await reviewed();
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
      expect(await h.service.readCandidates(sermonId, "child", true)).toMatchObject({ view: { status: "reviewed" } });
      command = { action, ...head(state), proposalId: state.correctionProposals[0]!.id };
    }
    const changed = await run(h, command);
    expect(changed.candidateEvents).toEqual(before.candidateEvents);
    expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ view: { status: "needs_review", reviewId: null } });
    expect(await h.service.readCandidateClues(sermonId, "child")).toMatchObject({ code: "SERMON_CANDIDATES_NOT_REVIEWED" });
    expect(await h.service.execute(sermonId, candidates(changed, { kind: "review", difficulty: "child", poolId }), human))
      .toMatchObject({ code: "SERMON_INTENT_NOT_CONFIRMED" });
    if (action !== "merge_corrections") {
      const reconfirmed = await run(h, { action: "confirm", ...head(changed), reviewed: true });
      const ready = await confirmIntent(h, reconfirmed);
      expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ view: { status: "needs_review" } });
      expect(await h.service.execute(sermonId, candidates(ready, { kind: "select", difficulty: "child", poolId }), human))
        .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
      const revised = await run(h, candidates(ready, { kind: "edit", difficulty: "child", binding: await binding(h), basePoolId: poolId, draft: draft() }));
      expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ view: { status: "awaiting_review" } });
      await run(h, candidates(revised, { kind: "review", difficulty: "child", poolId: revised.candidateEvents.at(-1)!.id }));
      expect(await h.service.readCandidateClues(sermonId, "child")).toMatchObject({ outcome: "candidate_clues" });
    }
  });

  it.each(["edit", "select", "confirm"] as const)("requires candidate re-review after upstream intent %s", async (kind) => {
    const { h, state, poolId } = await reviewed();
    const input = await binding(h);
    const op: IntentOperation = kind === "edit" ? { kind, baseAnalysisId: input.analysisId, analysis: analysis() }
      : { kind, analysisId: input.analysisId };
    let changed = await run(h, intent(state, op));
    expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ view: { status: "needs_review", reviewId: null } });
    if (kind !== "confirm") changed = await run(h, intent(changed,
      { kind: "confirm", analysisId: kind === "edit" ? changed.intentEvents.at(-1)!.id : input.analysisId }));
    expect(await h.service.execute(sermonId, candidates(changed, { kind: "restore", difficulty: "child", poolId }), human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    const revised = await run(h, candidates(changed, { kind: "edit", difficulty: "child", binding: await binding(h), basePoolId: poolId, draft: draft() }));
    await run(h, candidates(revised, { kind: "review", difficulty: "child", poolId: revised.candidateEvents.at(-1)!.id }));
    expect(await h.service.readCandidates(sermonId, "child", true)).toMatchObject({ view: { status: "reviewed" } });
  });

  it("keeps current eligibility for comparison-only intent analysis but rejects delayed input version", async () => {
    const { h, state } = await reviewed();
    const oldBinding = await binding(h);
    const next = await run(h, intent(state, { kind: "analysis", binding: currentIntentBinding(state)!, analysis: analysis() }));
    expect(await h.service.readCandidates(sermonId, "child", true)).toMatchObject({ view: { status: "reviewed" } });
    expect(await h.service.execute(sermonId, candidates(next, { kind: "generate", difficulty: "child", binding: oldBinding, draft: draft() }), human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    await run(h, candidates(next, { kind: "generate", difficulty: "child", binding: await binding(h), draft: draft() }));
  });

  it.each(["sourceId", "sourceRevision", "sourceSha256", "revisionId", "transcriptSha256", "confirmationId", "version", "analysisId", "intentConfirmationId"] as const)("rejects mismatched current input: %s", async (field) => {
    const { h, state } = await setup(); const input = await binding(h);
    if (field === "analysisId" || field === "intentConfirmationId") input[field] = "unknown";
    else if (field === "sourceRevision" || field === "version") input.transcript[field]++;
    else if (field === "sourceSha256" || field === "transcriptSha256") input.transcript[field] = "0".repeat(64);
    else input.transcript[field] = "unknown";
    expect(await h.service.execute(sermonId, candidates(state, { kind: "generate", difficulty: "child", binding: input, draft: draft() }), human))
      .toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    expect(h.snapshot()).toEqual(state);
  });

  it("accepts another source quote without requiring the analysis to quote the identical sentence", async () => {
    const { h, state } = await setup("timed"); const data = draft(true), g = data.candidates[0]!.grounding;
    if (g.origin !== "transcript") throw new Error("fixture");
    g.evidence = [{ segmentId: "segment-2", start: 1, duration: 3, from: 0, to: 16, quote: "TEST_ONLY_SECOND" }];
    await run(h, candidates(state, { kind: "generate", difficulty: "child", binding: await binding(h), draft: data }));
  });

  it.each(["quote", "range", "time", "segment", "duplicate_evidence", "duplicate_claim", "missing_claim", "surrogate"])("rejects bad or unrelated evidence: %s", async (mode) => {
    const { h, state } = await setup("timed"); const data = draft(true), g = data.candidates[0]!.grounding;
    if (g.origin !== "transcript") throw new Error("fixture"); const e = g.evidence[0]!;
    if (mode === "quote") e.quote = "TEST_ONLY_FORGED";
    if (mode === "range") e.to = e.from;
    if (mode === "time") e.start = 999;
    if (mode === "segment") e.segmentId = "segment-2";
    if (mode === "duplicate_evidence") g.evidence.push(structuredClone(e));
    if (mode === "duplicate_claim") g.intentClaimIds.push("centralMessage");
    if (mode === "missing_claim") g.intentClaimIds = ["unknown"];
    if (mode === "surrogate") e.to = e.to! - 1;
    expect(await h.service.execute(sermonId, candidates(state, { kind: "generate", difficulty: "child", binding: await binding(h), draft: data }), human))
      .toMatchObject({ code: "SERMON_CANDIDATES_INVALID" });
    expect(h.snapshot()).toEqual(state);
  });

  it.each(["unresolved", "admin_context"] as const)("does not present %s intent claims as transcript-backed answers", async (origin) => {
    const { h, state } = await setup(); const input = await binding(h), a = analysis();
    a.centralMessage = [{ id: "centralMessage", text: "TEST_ONLY_PRIVATE_CONTEXT", origin, evidence: [] }];
    const edited = await run(h, intent(state, { kind: "edit", baseAnalysisId: input.analysisId, analysis: a }));
    const confirmed = await run(h, intent(edited, { kind: "confirm", analysisId: edited.intentEvents.at(-1)!.id }));
    expect(await h.service.execute(sermonId, candidates(confirmed,
      { kind: "generate", difficulty: "child", binding: await binding(h), draft: draft() }), human)).toMatchObject({ code: "SERMON_CANDIDATES_INVALID" });
  });

  it.each(["empty", "blank", "no_evidence", "no_intent", "difficulty", "difficulty_reason", "model", "cost", "actor", "status", "bible_text", "geometry", "secret"])("rejects malformed data and injected authority: %s", async (mode) => {
    const { h, state } = await setup(); const data = draft(); const c = data.candidates[0]!;
    const operation: CandidateOperation = { kind: "generate", difficulty: "child", binding: await binding(h), draft: data };
    if (mode === "empty") data.candidates = [];
    else if (mode === "blank") c.clue = "\uFEFF \t\u200B";
    else if (mode === "no_evidence" && c.grounding.origin === "transcript") c.grounding.evidence = [];
    else if (mode === "no_intent" && c.grounding.origin === "transcript") c.grounding.intentClaimIds = [];
    else if (mode === "difficulty_reason") c.difficultyReason = "";
    else if (mode === "difficulty") Object.assign(operation, { difficulty: "easy" });
    else if (mode === "actor") Object.assign(operation, { actorId: human.adminId });
    else Object.assign(c, { [mode]: "TEST_ONLY_PRIVATE" });
    expect(await h.service.execute(sermonId, candidates(state, operation), human)).toMatchObject({ code: "INVALID_TRANSCRIPT_REQUEST" });
    expect(h.snapshot()).toEqual(state);
  });

  it.each(["generate_transcript", "generate_intent", "generate_summary", "two_difficulties", "edit_edit", "review_edit", "status_review", "select_review", "restore_edit"] as const)("commits exactly once under simultaneous changes: %s", async (mode) => {
    const { h, state, poolId } = await generated(); const input = await binding(h);
    const generate = candidates(state, { kind: "generate", difficulty: "child", binding: input, draft: draft() });
    const edit = candidates(state, { kind: "edit", difficulty: "child", binding: input, basePoolId: poolId, draft: draft() });
    const review = candidates(state, { kind: "review", difficulty: "child", poolId });
    let first = generate, second: TranscriptCommand = { action: "edit", ...head(state), content: { format: "plain_text", text: raw } };
    if (mode === "generate_intent") second = intent(state, { kind: "edit", baseAnalysisId: input.analysisId, analysis: analysis() });
    if (mode === "generate_summary") second = { action: "summary", ...head(state), operation: { kind: "generate", binding: input,
      draft: { paragraphs: [{ id: "paragraph", text: "TEST_ONLY_SUMMARY", intentClaimIds: ["centralMessage"], evidence: [evidence()] }] } } };
    if (mode === "two_difficulties") second = candidates(state, { kind: "generate", difficulty: "adult", binding: input, draft: draft(false, "adult") });
    if (mode === "edit_edit") { first = edit; second = edit; }
    if (mode === "review_edit") { first = review; second = edit; }
    if (mode === "status_review") { first = candidates(state, { kind: "set_status", difficulty: "child", poolId, candidateId: "candidate-1", status: "excluded" }); second = review; }
    if (mode === "select_review") { first = candidates(state, { kind: "select", difficulty: "child", poolId }); second = review; }
    if (mode === "restore_edit") { first = candidates(state, { kind: "restore", difficulty: "child", poolId }); second = edit; }
    const originalRead = h.port.read; let arrivals = 0, release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(h.port, "read").mockImplementation(async (id) => {
      const snapshot = await originalRead(id); if (++arrivals === 2) release(); await gate; return snapshot;
    });
    const before = h.commits();
    const results = await Promise.all([h.service.execute(sermonId, first, human), h.service.execute(sermonId, second, human)]);
    spy.mockRestore();
    expect(results.filter((r) => r.outcome === "updated")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "failed")).toEqual([expect.objectContaining({ code: "TRANSCRIPT_REVISION_CONFLICT" })]);
    expect(h.commits() - before).toBe(1); expect(h.snapshot().version).toBe(state.version + 1);
    expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ outcome: "candidates" });
  });

  it.each(["binding", "quote", "intent_id", "review_target", "event_version", "duplicate_id", "unknown_field", "wrong_difficulty", "grid", "status_target"])("fails closed on stored candidate corruption: %s", async (mode) => {
    const { h, state } = await reviewed(); const corrupt = structuredClone(state) as TranscriptState;
    const first = corrupt.candidateEvents[0]!, last = corrupt.candidateEvents.at(-1)!;
    if (first.operation.kind !== "generate" || last.operation.kind !== "review") throw new Error("fixture");
    if (mode === "binding") first.operation.binding.transcript.version++;
    if (mode === "quote" && first.operation.draft.candidates[0]!.grounding.origin === "transcript") first.operation.draft.candidates[0]!.grounding.evidence[0]!.quote = "TEST_ONLY_CORRUPT";
    if (mode === "intent_id") first.operation.binding.analysisId = "unknown";
    if (mode === "review_target") last.operation.poolId = "unknown";
    if (mode === "event_version") first.version = corrupt.intentEvents.at(-1)!.version;
    if (mode === "duplicate_id") last.id = first.id;
    if (mode === "unknown_field") Object.assign(first, { public: true });
    if (mode === "wrong_difficulty") last.operation.difficulty = "adult";
    if (mode === "grid") first.operation.draft.candidates[0]!.gridAnswer = "위조정답";
    if (mode === "status_target") last.operation = { kind: "set_status", difficulty: "child", poolId: first.id, candidateId: "unknown", status: "excluded" };
    h.corrupt(corrupt);
    expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ outcome: "failed" });
    expect(await h.service.readCandidateClues(sermonId, "child")).toMatchObject({ outcome: "failed" });
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ outcome: "failed" });
    expect(await h.service.readSummary(sermonId)).toMatchObject({ outcome: "failed" });
    expect(await h.service.execute(sermonId, { action: "confirm", ...head(state), reviewed: true }, human)).toMatchObject({ outcome: "failed" });
  });

  it("requires confirmed inputs and trusted human context, and preserves legacy P5-07 to P5-10 states", async () => {
    const { h, state, imported, transcript } = await setup();
    const command = candidates(state, { kind: "generate", difficulty: "child", binding: await binding(h), draft: draft() });
    expect(await h.service.execute(sermonId, command, { ...human, kind: "ai" })).toMatchObject({ code: "HUMAN_REVIEW_REQUIRED" });
    for (const old of [imported, transcript]) {
      h.corrupt(old);
      expect(await h.service.execute(sermonId, { ...command, ...head(old) }, human)).toMatchObject({ code: "SERMON_INTENT_NOT_CONFIRMED" });
    }
    const legacy = structuredClone(state); Reflect.deleteProperty(legacy, "candidateEvents"); h.corrupt(legacy);
    expect(privateTranscriptStateSchema.parse(legacy).candidateEvents).toEqual([]);
    expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ view: { status: "absent" } });
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ outcome: "intent" });
    expect(await h.service.readSummary(sermonId)).toMatchObject({ view: { status: "absent" } });
    await run(h, command);
  });

  it("validates identities before reading and reports fixed safe errors without private exception content", async () => {
    const empty = harness(), read = vi.spyOn(empty.port, "read");
    expect(await empty.service.readCandidates("../bad", "child")).toMatchObject({ code: "INVALID_TRANSCRIPT_REQUEST" });
    expect(await empty.service.readCandidateClues(sermonId, "easy")).toMatchObject({ code: "INVALID_TRANSCRIPT_REQUEST" });
    expect(read).not.toHaveBeenCalled();
    expect(await empty.service.readCandidates(sermonId, "child")).toMatchObject({ view: { status: "absent", version: 0 } });
    expect(await empty.service.readCandidateClues(sermonId, "child")).toMatchObject({ code: "SERMON_CANDIDATES_NOT_REVIEWED" });
    const { h, state } = await setup(); const command = candidates(state, { kind: "generate", difficulty: "child", binding: await binding(h), draft: draft() });
    vi.spyOn(h.port, "compareAndSwap").mockRejectedValueOnce(new Error(`${raw} ${human.adminId}`));
    const failed = await h.service.execute(sermonId, command, human);
    expect(failed).toMatchObject({ code: "TRANSCRIPT_VALIDATION_FAILED" }); expect(JSON.stringify(failed)).not.toContain("TEST_ONLY");
    expect(h.snapshot()).toEqual(state);
    expect(transcriptRevisionDiagnosticForCopy({ outcome: "failed", code: "SERMON_CANDIDATES_INVALID", message: raw }).message).not.toContain("TEST_ONLY");
    await run(h, command);
    expect(transcriptRevisionDiagnosticForCopy(await h.service.readCandidates(sermonId, "child"))).toEqual({ outcome: "candidates" });
    vi.spyOn(h.port, "read").mockRejectedValueOnce(new Error(raw));
    expect(await h.service.readCandidateClues(sermonId, "child")).toMatchObject({ code: "TRANSCRIPT_VALIDATION_FAILED" });
  });
  it.each(["toString", "__proto__"])("treats new candidate ID %s as data, preserving only own statuses", async (id) => {
    const { h, state, poolId } = await generated(); const data = draft(); data.candidates[0]!.id = id;
    const changed = await run(h, candidates(state, { kind: "edit", difficulty: "child", binding: await binding(h), basePoolId: poolId, draft: data }));
    const view = await h.service.readCandidates(sermonId, "child");
    if (view.outcome !== "candidates") throw new Error("fixture");
    expect(view.view.current!.statuses[id]).toBe("use");
    expect(Object.hasOwn(view.view.current!.statuses, id)).toBe(true);
    const excluded = await run(h, candidates(changed, { kind: "set_status", difficulty: "child", poolId: changed.candidateEvents.at(-1)!.id, candidateId: id, status: "excluded" }));
    await run(h, candidates(excluded, { kind: "review", difficulty: "child", poolId: excluded.candidateEvents.at(-1)!.id }));
    expect(await h.service.readCandidateClues(sermonId, "child")).toMatchObject({ preview: { clues: [] } });
  });

  it("rejects clue duplication when an excluded candidate or old comparison is restored", async () => {
    const { h, state, poolId } = await generated();
    const excluded = await run(h, candidates(state, { kind: "set_status", difficulty: "child", poolId, candidateId: "candidate-1", status: "excluded" }));
    const excludedId = excluded.candidateEvents.at(-1)!.id;
    const other = await run(h, candidates(excluded, { kind: "generate", difficulty: "adult", binding: await binding(h), draft: draft() }));
    for (const operation of [
      { kind: "set_status", difficulty: "child", poolId: excludedId, candidateId: "candidate-1", status: "use" },
      { kind: "select", difficulty: "child", poolId }, { kind: "restore", difficulty: "child", poolId },
    ] as const) {
      expect(await h.service.execute(sermonId, candidates(other, operation), human)).toMatchObject({ code: "SERMON_CANDIDATES_INVALID" });
      expect(h.snapshot()).toEqual(other);
    }
  });

  it.each(["wrong_pool", "wrong_difficulty", "missing_candidate", "unchanged_status"])("rejects stale or invalid human status requests: %s", async (mode) => {
    const { h, state, poolId } = await generated();
    const operation: CandidateOperation = { kind: "set_status", difficulty: mode === "wrong_difficulty" ? "adult" : "child",
      poolId: mode === "wrong_pool" ? "unknown" : poolId, candidateId: mode === "missing_candidate" ? "unknown" : "candidate-1",
      status: mode === "unchanged_status" ? "use" : "locked" };
    expect(await h.service.execute(sermonId, candidates(state, operation), human)).toMatchObject({ outcome: "failed" });
    expect(h.snapshot()).toEqual(state);
  });

  it("keeps reviewed summary and candidates independent while validating their shared event versions", async () => {
    const { h, state, poolId } = await reviewed();
    const summary = await run(h, { action: "summary", ...head(state), operation: { kind: "generate", binding: await binding(h),
      draft: { paragraphs: [{ id: "paragraph", text: "TEST_ONLY_SUMMARY", intentClaimIds: ["centralMessage"], evidence: [evidence()] }] } } });
    const approved = await run(h, { action: "summary", ...head(summary), operation: { kind: "review", summaryId: summary.summaryEvents.at(-1)!.id } });
    expect(await h.service.readCandidates(sermonId, "child", true)).toMatchObject({ view: { current: { id: poolId } } });
    const changed = await run(h, candidates(approved, { kind: "set_status", difficulty: "child", poolId, candidateId: "candidate-1", status: "locked" }));
    expect(await h.service.readSummary(sermonId, true)).toMatchObject({ view: { status: "reviewed" } });
    const corrupt = structuredClone(changed) as TranscriptState;
    corrupt.candidateEvents.at(-1)!.version = corrupt.summaryEvents.at(-1)!.version;
    h.corrupt(corrupt);
    expect(await h.service.readSummary(sermonId)).toMatchObject({ outcome: "failed" });
    expect(await h.service.readCandidates(sermonId, "child")).toMatchObject({ outcome: "failed" });
  });

});
