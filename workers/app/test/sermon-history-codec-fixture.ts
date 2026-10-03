import { transcriptProvider } from "../../_shared/services/accountless-transcript-contract";
import { prepareManualTranscriptSource } from "../../_shared/services/manual-transcript-source";
import { currentIntentBinding } from "../../_shared/services/sermon-intent";
import { intentFields, type IntentAnalysis } from "../../_shared/services/sermon-intent-contract";
import { summaryBindingFromIntent } from "../../_shared/services/sermon-summary";
import type { SermonCandidateDraft } from "../../_shared/services/sermon-candidates-contract";
import type { TranscriptCommand, TranscriptState, TranscriptRevisionStore } from "../../_shared/services/transcript-revision-contract";
import { createTranscriptRevisionService } from "../../_shared/services/transcript-revisions";
import { historySha256 } from "../../_shared/storage/history-json-codec";
import { historyStreams, parseHistoryRecord, type HistoryRecord } from "../../_shared/storage/history-record";
import type { HistoryScope } from "../../_shared/storage/history-references";

export const historyRaw = '\uFEFFTEST_ONLY_HISTORY_PRIVATE\r\n합성 근거 😀 e\u0301 가\t"\\ 끝';
export const historyHuman = { kind: "human", adminId: "test-private-actor", now: "2026-09-10T00:00:00.000Z" };
export async function historySource(timed = false, text = historyRaw) {
  if (timed) {
    const segments = [{ text, start: 0.125, duration: 2.75 }, { text: "TEST_ONLY_SECOND", start: 1.5, duration: 3.125 }];
    return { sourceMode: "public_unofficial", videoId: "aaaaaaaaaaa", language: "ko", trackId: "test-track",
      generated: true, retrievedAt: historyHuman.now, providerId: transcriptProvider.id,
      providerVersion: transcriptProvider.version, sourceSha256: await historySha256(new TextEncoder().encode(JSON.stringify(segments))), segments } as const;
  }
  const result = await prepareManualTranscriptSource({ sourceMode: "sermon_notes", manualSourceKind: "sermon_summary",
    sourceCoverage: "partial_notes", rawTranscriptText: text });
  if (result.outcome !== "validated") throw new Error("Invalid synthetic source");
  return result.source;
}
export function historyHarness() {
  let state: TranscriptState | null = null;
  const records: HistoryRecord[] = [];
  const store: TranscriptRevisionStore = {
    async read() { return structuredClone(state); },
    async compareAndSwap(sermonId, expected, next) {
      if (expected !== (state?.version ?? null)) return false;
      for (const stream of historyStreams) {
        const before = state?.[stream].length ?? 0;
        for (const [index, p] of next[stream].entries()) {
          if (index < before) continue;
          records.push(parseHistoryRecord({ envelope: {
            storageFormatVersion: 1, sermonId, recordId: p.id, stream, streamPosition: index + 1,
            commitVersion: next.version, commitSlot: stream === "revisions" && "kind" in p && p.kind === "imported" ? 1 : 0,
            sourceRevision: "sourceRevision" in p ? p.sourceRevision : null,
            difficulty: "operation" in p && "difficulty" in p.operation ? p.operation.difficulty : null,
          }, payload: p }));
        }
      }
      state = structuredClone(next) as TranscriptState;
      return true;
    },
  };
  const service = createTranscriptRevisionService(store);
  return { service, store, records, state: () => structuredClone(state)!,
    scope: (): HistoryScope => ({ sermonId: "test-history-sermon", version: state!.version,
      counts: Object.fromEntries(historyStreams.map((s) => [s, state![s].length])) as HistoryScope["counts"] }),
    async run(command: TranscriptCommand) {
      const result = await service.execute("test-history-sermon", command, historyHuman);
      if (result.outcome !== "updated") throw new Error(`Synthetic command: ${command.action}: ${result.code}`);
      return result.state;
    },
  };
}
export function historyHead(state: TranscriptState) {
  return { expectedVersion: state.version, sourceId: state.currentSourceId, revisionId: state.currentRevisionId,
    transcriptSha256: state.revisions.at(-1)!.transcriptSha256 };
}
export async function historyFixture(timed = false, replaceSource = true) {
  const h = historyHarness();
  await h.run({ action: "import_source", expectedVersion: 0, payload: await historySource(timed) });
  const imported = h.state().currentRevisionId;
  const original = h.state().revisions[0]!.content;
  // Two proposal batches deliberately reuse item IDs. Membership is proposal-scoped.
  const proposal = () => {
    const s = h.state(), p = s.sources[0]!.payload;
    return { sourceId: s.currentSourceId, sourceSha256: p.sourceMode === "public_unofficial" ? p.sourceSha256 : p.rawTranscriptSha256,
      baseRevisionId: s.currentRevisionId, baseTranscriptSha256: s.revisions.at(-1)!.transcriptSha256,
      items: [0, 1].map((i) => ({ id: `item-${i}`, segmentId: timed ? "segment-1" : null,
        start: timed ? 0.125 : null, duration: timed ? 2.75 : null,
        from: historyRaw.indexOf(i === 0 ? "끝" : "근거"), to: historyRaw.indexOf(i === 0 ? "끝" : "근거") + (i === 0 ? 1 : 2),
        originalText: i === 0 ? "끝" : "근거", proposedText: i === 0 ? "마침" : "증거", changeType: "spelling" as const,
        reason: "TEST_ONLY_REASON", confidence: 0.75, riskFlags: ["needs_review" as const],
        contextBefore: historyRaw.slice(Math.max(0, historyRaw.indexOf(i === 0 ? "끝" : "근거") - 120), historyRaw.indexOf(i === 0 ? "끝" : "근거")),
        contextAfter: historyRaw.slice(historyRaw.indexOf(i === 0 ? "끝" : "근거") + (i === 0 ? 1 : 2), historyRaw.indexOf(i === 0 ? "끝" : "근거") + (i === 0 ? 1 : 2) + 120) })) };
  };
  for (let n = 0; n < 2; n++) await h.run({ action: "propose_corrections", ...historyHead(h.state()), proposal: proposal() });
  const proposalId = h.state().correctionProposals.at(-1)!.id;
  for (const [itemId, decision] of [["item-0", "accepted"], ["item-1", "rejected"]] as const)
    await h.run({ action: "decide_corrections", ...historyHead(h.state()), proposalId, decisions: [{ itemId, decision }], reviewed: true });
  await h.run({ action: "merge_corrections", ...historyHead(h.state()), proposalId });
  await h.run({ action: "restore", ...historyHead(h.state()), restoreRevisionId: imported });
  await h.run({ action: "edit", ...historyHead(h.state()), content: original.format === "plain_text"
    ? { ...original, text: original.text + " TEST_ONLY_EDIT" }
    : { ...original, segments: original.segments.map((s, i) => ({ ...s, text: s.text + (i === 0 ? " TEST_ONLY_EDIT" : "") })) } });
  for (let n = 0; n < 2; n++) await h.run({ action: "confirm", ...historyHead(h.state()), reviewed: true });
  const ev = { segmentId: timed ? "segment-1" : null, start: timed ? 0.125 : null, duration: timed ? 2.75 : null,
    from: historyRaw.indexOf("합성"), to: historyRaw.indexOf("합성") + "합성 근거 😀".length, quote: "합성 근거 😀" };
  const analysis = Object.fromEntries(intentFields.map((field) => [field,
    [{ id: field, text: `TEST_ONLY_${field}`, origin: "transcript", evidence: [ev] }]])) as IntentAnalysis;
  await h.run({ action: "intent", ...historyHead(h.state()), operation: { kind: "analysis", binding: currentIntentBinding(h.state())!, analysis } });
  const baseAnalysisId = h.state().intentEvents.at(-1)!.id;
  const concern = { assessment: "needs_review" as const, concerns: [{ field: "centralMessage" as const, claimId: "centralMessage", note: "TEST_ONLY_CONCERN" }] };
  const clear = { assessment: "clear" as const, concerns: [] };
  await h.run({ action: "intent", ...historyHead(h.state()), operation: { kind: "critique", binding: currentIntentBinding(h.state())!,
    baseAnalysisId, analysis, critique: { exaggeratedIntent: concern, unsupportedConclusion: clear, illustrationAsMainClaim: clear, reversedMeaning: clear } } });
  let analysisId = h.state().intentEvents.at(-1)!.id;
  await h.run({ action: "intent", ...historyHead(h.state()), operation: { kind: "select", analysisId } });
  await h.run({ action: "intent", ...historyHead(h.state()), operation: { kind: "edit", baseAnalysisId: analysisId, analysis } });
  analysisId = h.state().intentEvents.at(-1)!.id;
  await h.run({ action: "intent", ...historyHead(h.state()), operation: { kind: "confirm", analysisId } });
  const binding = async () => {
    const result = await h.service.readIntent("test-history-sermon", true);
    if (result.outcome !== "intent") throw new Error("Synthetic intent invalid");
    return summaryBindingFromIntent(result.view)!;
  };
  const draft = { paragraphs: ["paragraph-b", "paragraph-a"].map((id) => ({ id, text: `TEST_ONLY_${id}`,
    intentClaimIds: ["purpose", "centralMessage"], evidence: [ev] })) };
  await h.run({ action: "summary", ...historyHead(h.state()), operation: { kind: "generate", binding: await binding(), draft } });
  let summaryId = h.state().summaryEvents.at(-1)!.id;
  await h.run({ action: "summary", ...historyHead(h.state()), operation: { kind: "edit", binding: await binding(), baseSummaryId: summaryId, draft } });
  summaryId = h.state().summaryEvents.at(-1)!.id;
  for (const kind of ["select", "review", "restore"] as const)
    await h.run({ action: "summary", ...historyHead(h.state()), operation: { kind, summaryId } });
  summaryId = h.state().summaryEvents.at(-1)!.id;
  await h.run({ action: "summary", ...historyHead(h.state()), operation: { kind: "review", summaryId } });
  // Alternate child/adult in ONE candidate stream, deliberately identical nested IDs.
  const poolIds = { child: "", adult: "" };
  for (const difficulty of ["child", "adult"] as const) {
    const candidateDraft: SermonCandidateDraft = { candidates: ["candidate-b", "candidate-a"].map((id, i) => ({
      id, displayAnswer: i ? "검증" : "합성", gridAnswer: i ? "검증" : "합성", clue: `TEST_ONLY_${difficulty}_${id}`,
      phraseDescription: "TEST_ONLY_PHRASE", selectionReason: "TEST_ONLY_REASON", sermonImportance: "TEST_ONLY_IMPORTANCE",
      difficultyReason: "TEST_ONLY_DIFFICULTY", grounding: { origin: "transcript", intentClaimIds: ["purpose"], evidence: [ev] },
    })) };
    await h.run({ action: "candidates", ...historyHead(h.state()), operation: { kind: "generate", difficulty, binding: await binding(), draft: candidateDraft } });
    poolIds[difficulty] = h.state().candidateEvents.at(-1)!.id;
  }
  for (const difficulty of ["child", "adult"] as const) {
    let poolId = poolIds[difficulty];
    await h.run({ action: "candidates", ...historyHead(h.state()), operation: { kind: "set_status", difficulty, poolId, candidateId: "candidate-b", status: "locked" } });
    poolId = h.state().candidateEvents.at(-1)!.id;
    await h.run({ action: "candidates", ...historyHead(h.state()), operation: { kind: "restore", difficulty, poolId } });
    poolId = h.state().candidateEvents.at(-1)!.id;
    await h.run({ action: "candidates", ...historyHead(h.state()), operation: { kind: "set_status", difficulty, poolId, candidateId: "candidate-a", status: "excluded" } });
    poolId = h.state().candidateEvents.at(-1)!.id;
    for (const kind of ["select", "review"] as const)
      await h.run({ action: "candidates", ...historyHead(h.state()), operation: { kind, difficulty, poolId } });
  }
  const view = await h.service.readCandidates("test-history-sermon", "child", true);
  if (view.outcome !== "candidates" || !view.view.current) throw new Error("Synthetic pool invalid");
  await h.run({ action: "candidates", ...historyHead(h.state()), operation: { kind: "edit", difficulty: "child",
    binding: await binding(), basePoolId: view.view.current.id, draft: structuredClone(view.view.current.draft) as SermonCandidateDraft } });
  // Source replacement preserves old records and invalidates only the current confirmation.
  if (replaceSource) await h.run({ action: "import_source", expectedVersion: h.state().version, payload: await historySource(!timed) });
  return h;
}
