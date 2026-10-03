import { afterEach, describe, expect, it, vi } from "vitest";

import { transcriptProvider } from "../_shared/services/accountless-transcript-contract";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import type { CorrectionItem } from "../_shared/services/transcript-correction-contract";
import { correctionItemDecisions } from "../_shared/services/transcript-corrections";
import { privateTranscriptStateSchema, transcriptContentSchema, type PrivateTranscriptState, type TranscriptCommand,
  type TranscriptRevisionStore, type TranscriptState } from "../_shared/services/transcript-revision-contract";
import { createTranscriptRevisionService, transcriptRevisionDiagnosticForCopy } from "../_shared/services/transcript-revisions";

const human = { kind: "human", adminId: "synthetic-admin", now: "2026-09-08T00:00:00.000Z" };
const sermonId = "synthetic-sermon";
const raw = "TEST_ONLY_PRIVATE_CORRECTION_CANARY aa bb cc 😀\r\n";
async function digest(text: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
function head(state: PrivateTranscriptState) {
  return { expectedVersion: state.version, sourceId: state.currentSourceId,
    revisionId: state.currentRevisionId, transcriptSha256: state.revisions.at(-1)!.transcriptSha256 };
}
async function payload(timed = false) {
  if (timed) {
    const segments = [{ text: raw, start: 0.5, duration: 2 }, { text: "TEST_ONLY_OTHER", start: 1, duration: 3 }];
    return { sourceMode: "public_unofficial" as const, videoId: "aaaaaaaaaaa", language: "ko" as const,
      trackId: "synthetic-track", generated: true, retrievedAt: human.now,
      providerId: transcriptProvider.id, providerVersion: transcriptProvider.version,
      sourceSha256: await digest(JSON.stringify(segments)), segments };
  }
  const prepared = await prepareManualTranscriptSource({ sourceMode: "sermon_notes", manualSourceKind: "sermon_summary",
    sourceCoverage: "partial_notes", rawTranscriptText: raw });
  if (prepared.outcome !== "validated") throw new Error("Invalid fixture");
  return prepared.source;
}
function harness() {
  let stored: unknown = null;
  let attempts = 0;
  const port: TranscriptRevisionStore = {
    async read() { return structuredClone(stored); },
    async compareAndSwap(_id, version, next) {
      attempts++;
      if (((stored as TranscriptState | null)?.version ?? null) !== version) return false;
      stored = structuredClone(next);
      return true;
    },
  };
  const service = createTranscriptRevisionService(port);
  return { service, port, snapshot: () => structuredClone(stored) as TranscriptState,
    corrupt: (state: unknown) => { stored = state; }, attempts: () => attempts };
}
type Harness = ReturnType<typeof harness>;
async function run(h: Harness, command: TranscriptCommand) {
  const result = await h.service.execute(sermonId, command, human);
  expect(result.outcome).toBe("updated");
  if (result.outcome !== "updated") throw new Error(JSON.stringify(result));
  return result.state;
}
async function setup(timed = false) {
  const h = harness();
  const state = await run(h, { action: "import_source", expectedVersion: 0, payload: await payload(timed) });
  return { h, state };
}
function item(text: string, original: string, proposed: string, id: string, timed = false): CorrectionItem {
  const from = text.indexOf(original);
  const to = from + original.length;
  return { id, segmentId: timed ? "segment-1" : null, start: timed ? 0.5 : null, duration: timed ? 2 : null,
    from, to, originalText: original, proposedText: proposed, changeType: "spelling",
    reason: "TEST_ONLY_REASON", confidence: 0.8, riskFlags: proposed.length < original.length ? ["deletion"] : [],
    contextBefore: text.slice(Math.max(0, from - 120), from), contextAfter: text.slice(to, to + 120) };
}
function propose(state: PrivateTranscriptState, items?: CorrectionItem[]): Extract<TranscriptCommand, { action: "propose_corrections" }> {
  const source = state.sources.at(-1)!.payload;
  const timed = source.sourceMode === "public_unofficial";
  return { action: "propose_corrections", ...head(state), proposal: {
    sourceId: state.currentSourceId, sourceSha256: timed ? source.sourceSha256 : source.rawTranscriptSha256,
    baseRevisionId: state.currentRevisionId, baseTranscriptSha256: head(state).transcriptSha256,
    items: items ?? [item(raw, "aa", "AAAA", "a", timed), item(raw, "bb", "B", "b", timed), item(raw, "cc", "C", "c", timed)],
  } };
}
function decide(state: PrivateTranscriptState,
  decisions: { itemId: string; decision: "accepted" | "rejected" }[] = [{ itemId: "a", decision: "accepted" }],
): Extract<TranscriptCommand, { action: "decide_corrections" }> {
  return { action: "decide_corrections", ...head(state), proposalId: state.correctionProposals.at(-1)!.id, decisions, reviewed: true };
}
function merge(state: PrivateTranscriptState): Extract<TranscriptCommand, { action: "merge_corrections" }> {
  return { action: "merge_corrections", ...head(state), proposalId: state.correctionProposals.at(-1)!.id };
}
function confirm(state: PrivateTranscriptState): TranscriptCommand { return { action: "confirm", ...head(state), reviewed: true }; }
function edit(state: PrivateTranscriptState): TranscriptCommand {
  return { action: "edit", ...head(state), content: transcriptContentSchema.parse(state.revisions.at(-1)!.content) };
}
async function ready(timed = false) {
  const { h, state } = await setup(timed);
  return { h, state: await run(h, propose(state)) };
}
afterEach(() => vi.restoreAllMocks());

describe("optional transcript corrections: synthetic server contracts", () => {
  it.each([false, true])("preserves the original and confirmation until explicit merge (timed=%s)", async (timed) => {
    const { h, state: initial } = await setup(timed);
    const confirmed = await run(h, confirm(initial));
    const command = propose(confirmed);
    const proposed = await run(h, command);
    command.proposal.items[0]!.proposedText = "TEST_ONLY_MUTATION";
    expect(proposed.revisions).toEqual(confirmed.revisions);
    expect(proposed.currentConfirmationId).toBe(confirmed.currentConfirmationId);
    expect(correctionItemDecisions(proposed, proposed.correctionProposals[0]!)).toEqual([
      { itemId: "a", decision: "pending" }, { itemId: "b", decision: "pending" }, { itemId: "c", decision: "pending" },
    ]);
    const decided = await run(h, { action: "decide_corrections", ...head(proposed), proposalId: proposed.correctionProposals[0]!.id,
      decisions: [{ itemId: "a", decision: "accepted" }, { itemId: "b", decision: "rejected" }], reviewed: true });
    expect(decided.currentConfirmationId).toBe(confirmed.currentConfirmationId);
    expect((await h.service.readConfirmed(sermonId)).outcome).toBe("confirmed");
    const merged = await run(h, merge(decided));
    expect(merged.currentConfirmationId).toBeNull();
    expect(merged.sources).toEqual(initial.sources);
    expect(merged.revisions.slice(0, -1)).toEqual(initial.revisions);
    expect(merged.confirmations).toEqual(confirmed.confirmations);
    expect(merged.correctionProposals).toEqual(proposed.correctionProposals);
    expect(merged.correctionDecisions).toEqual(decided.correctionDecisions);
    const expected = transcriptContentSchema.parse(initial.revisions[0]!.content);
    if (expected.format === "plain_text") expected.text = raw.replace("aa", "AAAA");
    else expected.segments[0]!.text = raw.replace("aa", "AAAA");
    expect(merged.revisions.at(-1)).toMatchObject({ kind: "merged", content: expected,
      parentRevisionId: initial.currentRevisionId,
      mergedCorrection: { proposalId: proposed.correctionProposals[0]!.id, decisionVersion: decided.version } });
    expect(Object.isFrozen(merged.correctionProposals[0]!.items[0])).toBe(true);
    expect(Object.isFrozen(merged.correctionDecisions[0]!.decisions)).toBe(true);
    expect(await h.service.readConfirmed(sermonId)).toMatchObject({ code: "TRANSCRIPT_NOT_CONFIRMED" });
    const final = await run(h, confirm(merged));
    expect((await h.service.readConfirmed(sermonId)).outcome).toBe("confirmed");
    expect(final.confirmations.at(-1)!.revisionId).toBe(merged.currentRevisionId);
  });

  it("reproduces length-changing edits regardless of proposal and decision order", async () => {
    const results = [];
    for (const reversed of [false, true]) {
      const { h, state } = await setup();
      const command = propose(state);
      if (reversed) command.proposal.items.reverse();
      const proposed = await run(h, command);
      const decisions = ["a", "b", "c"].map((itemId) => ({ itemId, decision: "accepted" as const }));
      if (reversed) decisions.reverse();
      let decided = proposed;
      for (const decision of decisions) decided = await run(h, decide(decided, [decision]));
      const merged = await run(h, merge(decided));
      results.push(merged.revisions.at(-1)!);
    }
    expect(results[0]!.content).toEqual({ format: "plain_text", text: raw.replace("aa", "AAAA").replace("bb", "B").replace("cc", "C") });
    expect(results[0]!.content).toEqual(results[1]!.content);
    expect(results[0]!.transcriptSha256).toBe(results[1]!.transcriptSha256);
  });

  it("supports insertions and deletions at stable base offsets", async () => {
    const { h, state } = await setup();
    const insertion = item(raw, "aa", "INSERT", "insert");
    insertion.to = insertion.from;
    insertion.originalText = "";
    insertion.contextAfter = raw.slice(insertion.to, insertion.to + 120);
    const proposed = await run(h, propose(state, [insertion, item(raw, "bb", "", "delete")]));
    const decided = await run(h, decide(proposed, ["insert", "delete"].map((itemId) => ({ itemId, decision: "accepted" }))));
    const merged = await run(h, merge(decided));
    expect(merged.revisions.at(-1)!.content).toEqual({ format: "plain_text", text: raw.replace("aa", "INSERTaa").replace("bb", "") });
  });

  it.each(["edit", "restore", "source", "merged"])("rejects stale proposals after %s even if text checksum matches", async (action) => {
    const { h, state } = await ready();
    const decided = await run(h, decide(state));
    const next = await run(h, action === "edit" ? edit(decided) : action === "restore"
      ? { action: "restore", ...head(decided), restoreRevisionId: decided.currentRevisionId }
      : action === "source" ? { action: "import_source", expectedVersion: decided.version, payload: await payload() } : merge(decided));
    for (const command of [decide(decided, [{ itemId: "b", decision: "accepted" }]), merge(decided)]) {
      expect(await h.service.execute(sermonId, { ...command, ...head(next) }, human)).toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
    }
    expect(h.snapshot()).toEqual(next);
  });

  it("binds proposals to the edited base, while retaining the distinct original checksum", async () => {
    const { h, state } = await setup();
    const text = raw.replace("aa", "EDITED");
    const edited = await run(h, { action: "edit", ...head(state), content: { format: "plain_text", text } });
    const proposal = propose(edited, [item(text, "EDITED", "CORRECTED", "a")]);
    expect(proposal.proposal.baseTranscriptSha256).not.toBe(proposal.proposal.sourceSha256);
    const proposed = await run(h, proposal);
    const merged = await run(h, merge(await run(h, decide(proposed))));
    expect(merged.revisions.at(-1)!.content).toEqual({ format: "plain_text", text: text.replace("EDITED", "CORRECTED") });
    expect(merged.sources).toEqual(state.sources);
  });

  it.each(["sourceId", "sourceSha256", "baseRevisionId", "baseTranscriptSha256"] as const)("rejects mismatched proposal %s", async (field) => {
    const { h, state } = await setup();
    const command = propose(state);
    command.proposal[field] = field.includes("Sha256") ? "f".repeat(64) : "wrong-id";
    expect((await h.service.execute(sermonId, command, human)).outcome).toBe("failed");
    expect(h.snapshot()).toEqual(state);
  });

  it.each(["overlap", "duplicate_id", "from", "original", "context", "segment", "start", "duration", "no_op", "unicode", "surrogate_boundary", "risk", "extra", "confidence"])("rejects malformed proposal %s before writing", async (fault) => {
    const { h, state } = await setup(true);
    const command = propose(state);
    const first = command.proposal.items[0]!;
    if (fault === "overlap") command.proposal.items.push({ ...first, id: "overlap" });
    if (fault === "duplicate_id") command.proposal.items[1]!.id = first.id;
    if (fault === "from") first.from++;
    if (fault === "original") first.originalText = "TEST_ONLY_WRONG";
    if (fault === "context") first.contextAfter = "TEST_ONLY_WRONG";
    if (fault === "segment") first.segmentId = "segment-2";
    if (fault === "start") first.start = 2;
    if (fault === "duration") first.duration = 0;
    if (fault === "no_op") first.proposedText = first.originalText;
    if (fault === "unicode") first.proposedText = "\uD800";
    if (fault === "surrogate_boundary") {
      const replacement = item(raw, "😀", "X", "a", true);
      replacement.from++;
      replacement.originalText = raw.slice(replacement.from, replacement.to);
      replacement.contextBefore = raw.slice(0, replacement.from);
      command.proposal.items[0] = replacement;
    }
    if (fault === "risk") command.proposal.items[1]!.riskFlags = [];
    if (fault === "extra") Object.assign(first, { decision: "accepted" });
    if (fault === "confidence") first.confidence = 2;
    expect((await h.service.execute(sermonId, command, human)).outcome).toBe("failed");
    expect(h.snapshot()).toEqual(state);
  });

  it.each(["no_acceptance", "unknown_item", "duplicate", "unreviewed", "forged_human", "repeat_decision"])("rejects invalid decisions or merge: %s", async (fault) => {
    const { h, state } = await ready();
    let command: unknown = decide(state);
    let context: unknown = human;
    let before = state;
    if (fault === "no_acceptance") command = merge(state);
    if (fault === "unknown_item") command = decide(state, [{ itemId: "unknown", decision: "accepted" }]);
    if (fault === "duplicate") command = decide(state, [{ itemId: "a", decision: "accepted" }, { itemId: "a", decision: "accepted" }]);
    if (fault === "unreviewed") command = { ...decide(state), reviewed: false };
    if (fault === "forged_human") context = { ...human, kind: "ai" };
    if (fault === "repeat_decision") {
      before = await run(h, decide(state));
      command = { ...decide(before), decisions: [{ itemId: "a", decision: "rejected" }] };
    }
    expect((await h.service.execute(sermonId, command, context)).outcome).toBe("failed");
    expect(h.snapshot()).toEqual(before);
  });

  it.each(["decision", "edit", "merge"])("atomically rejects one of two competing %s requests", async (other) => {
    const { h, state } = await ready();
    const base = other === "merge" ? await run(h, decide(state)) : state;
    const command = other === "merge" ? merge(base) : decide(base);
    const second = other === "edit" ? edit(base) : other === "decision"
      ? { ...decide(base), decisions: [{ itemId: "a", decision: "rejected" }] } : merge(base);
    const attempts = h.attempts();
    const results = await Promise.all([h.service.execute(sermonId, command, human), h.service.execute(sermonId, second, human)]);
    expect(results.filter((r) => r.outcome === "updated")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "failed")).toEqual([expect.objectContaining({ code: "TRANSCRIPT_REVISION_CONFLICT" })]);
    expect(h.attempts() - attempts).toBe(2);
    expect(h.snapshot().version).toBe(base.version + 1);
  });

  it("rejects a delayed proposal result after an intervening edit", async () => {
    const { h, state } = await setup();
    const command = propose(state);
    const edited = await run(h, edit(state));
    expect(await h.service.execute(sermonId, { ...command, ...head(edited) }, human)).toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
  });

  it("allows direct edit, restore and human confirmation with outstanding or rejected proposals", async () => {
    const { h, state } = await ready();
    const rejected = await run(h, { ...decide(state), decisions: [{ itemId: "a", decision: "rejected" }] });
    const edited = await run(h, edit(rejected));
    const restored = await run(h, { action: "restore", ...head(edited), restoreRevisionId: state.currentRevisionId });
    const confirmed = await run(h, confirm(restored));
    expect((await h.service.readConfirmed(sermonId)).outcome).toBe("confirmed");
    expect(confirmed.correctionDecisions).toEqual(rejected.correctionDecisions);
  });

  it.each(["merged_text", "merged_link", "decision", "source_hash", "proposal_time", "decision_version", "duplicate_decision"])("revalidates corrupt stored history on readConfirmed: %s", async (fault) => {
    const { h, state } = await ready();
    await run(h, confirm(await run(h, merge(await run(h, decide(state))))));
    const corrupt = h.snapshot();
    if (fault === "merged_text") {
      const revision = corrupt.revisions.at(-1)!;
      revision.content = { format: "plain_text", text: raw };
      revision.transcriptSha256 = await digest(raw);
      corrupt.confirmations.at(-1)!.transcriptSha256 = revision.transcriptSha256;
    }
    if (fault === "merged_link") corrupt.revisions.at(-1)!.mergedCorrection = null;
    if (fault === "decision") corrupt.correctionDecisions[0]!.decisions[0]!.decision = "rejected";
    if (fault === "source_hash") corrupt.correctionProposals[0]!.sourceSha256 = "f".repeat(64);
    if (fault === "proposal_time") corrupt.correctionProposals[0]!.items[0]!.start = 1;
    if (fault === "decision_version") corrupt.correctionDecisions[0]!.version = corrupt.version + 1;
    if (fault === "duplicate_decision") corrupt.correctionDecisions[0]!.decisions.push({ itemId: "a", decision: "rejected" });
    h.corrupt(corrupt);
    expect((await h.service.readConfirmed(sermonId)).outcome).toBe("failed");
  });

  it("rejects accepted changes that would empty a segment without losing decisions", async () => {
    const { h, state } = await setup(true);
    const proposed = await run(h, propose(state, [item(raw, raw, "", "a", true)]));
    const decided = await run(h, decide(proposed));
    expect(await h.service.execute(sermonId, merge(decided), human)).toMatchObject({ code: "TRANSCRIPT_CONTENT_INVALID" });
    expect(h.snapshot()).toEqual(decided);
  });

  it("rejects merged segment growth beyond the direct editor limit", async () => {
    const { h, state } = await setup(true);
    const proposed = await run(h, propose(state, [item(raw, "aa", "X".repeat(20_000), "a", true)]));
    const decided = await run(h, decide(proposed));
    expect(await h.service.execute(sermonId, merge(decided), human)).toMatchObject({ code: "TRANSCRIPT_CONTENT_INVALID" });
    expect(h.snapshot()).toEqual(decided);
  });

  it("keeps different proposals separate and preserves a merged revision through later edit/restore", async () => {
    const { h, state } = await ready();
    const second = await run(h, propose(state));
    const firstId = state.correctionProposals[0]!.id;
    const decided = await run(h, { ...decide(second), proposalId: firstId });
    expect(await h.service.execute(sermonId, merge(decided), human)).toMatchObject({ code: "TRANSCRIPT_CORRECTION_INVALID" });
    const merged = await run(h, { ...merge(decided), proposalId: firstId });
    const edited = await run(h, edit(await run(h, confirm(merged))));
    const restored = await run(h, { action: "restore", ...head(edited), restoreRevisionId: merged.currentRevisionId });
    expect(restored.revisions.at(-1)!.content).toEqual(merged.revisions.at(-1)!.content);
    expect(restored.currentConfirmationId).toBeNull();
    await run(h, confirm(restored));
    expect((await h.service.readConfirmed(sermonId)).outcome).toBe("confirmed");
  });

  it("retains the P5-07 state shape with absent optional correction history", async () => {
    const { h, state } = await setup();
    const legacy = JSON.parse(JSON.stringify(state));
    delete legacy.correctionProposals;
    delete legacy.correctionDecisions;
    delete legacy.revisions[0].mergedCorrection;
    h.corrupt(legacy);
    const confirmed = await run(h, confirm(state));
    expect(confirmed.correctionProposals).toEqual([]);
    expect((await h.service.readConfirmed(sermonId)).outcome).toBe("confirmed");
  });

  it("returns fixed safe diagnostics for private results and thrown dependencies", async () => {
    const { h, state } = await ready();
    expect(transcriptRevisionDiagnosticForCopy({ outcome: "updated", state })).toEqual({ outcome: "updated" });
    vi.spyOn(h.port, "read").mockRejectedValueOnce(new Error(raw));
    const result = await h.service.execute(sermonId, decide(state), human);
    expect(result).toEqual({ outcome: "failed", code: "TRANSCRIPT_VALIDATION_FAILED", message: "자막 검증을 완료하지 못했습니다." });
    expect(JSON.stringify(transcriptRevisionDiagnosticForCopy(result))).not.toContain(raw);
    expect(privateTranscriptStateSchema.safeParse(state).success).toBe(true);
  });
});
