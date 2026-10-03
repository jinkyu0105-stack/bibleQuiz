import { afterEach, describe, expect, it, vi } from "vitest";
import { publicPuzzleGridSchema } from "../../shared/api/public-quiz";
import { createBibleReference } from "../../shared/bible-reference";
import { createCandidatePlacementService, placementTicketFromCandidates } from "../_shared/services/candidate-placement";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { candidateBindingFromIntent } from "../_shared/services/sermon-candidates";
import type { CandidateDifficulty, CandidateOperation, SermonCandidateDraft } from "../_shared/services/sermon-candidates-contract";
import { currentIntentBinding } from "../_shared/services/sermon-intent";
import { intentFields, type IntentAnalysis, type IntentOperation } from "../_shared/services/sermon-intent-contract";
import type { PrivateTranscriptState, TranscriptCommand, TranscriptRevisionStore, TranscriptState } from "../_shared/services/transcript-revision-contract";
import { createTranscriptRevisionService } from "../_shared/services/transcript-revisions";

import { createFinalCheckService } from "../_shared/services/final-check";
import { finalCheckTicketSchema, finalCheckPreviewSchema } from "../_shared/services/final-check-contract";
import { createFinalAuditService } from "../_shared/services/final-audit";
import {
  finalAuditInputSchema,
  finalAuditOutputSchema,
  finalAuditReportSchema,
} from "../_shared/services/final-audit-contract";
import {
  finalCheckMetadataSnapshotSchema,
  type FinalCheckMetadataSnapshot,
  type FinalCheckMetadataStore,
} from "../_shared/services/final-check-metadata-contract";
import { summaryBindingFromIntent } from "../_shared/services/sermon-summary";
import type { SummaryOperation } from "../_shared/services/sermon-summary-contract";
import * as poolSearch from "../../shared/puzzle/pool-search";
import { createAiDraftProvider } from "../_shared/services/ai-draft-provider";
import { transcriptContentSchema } from "../_shared/services/transcript-revision-contract";
import { env } from "cloudflare:workers";
import { createDatabase } from "../_shared/db/client";
import { createSermonMetadataRepository } from "../_shared/repositories/sermon-metadata-repository";
import { metadataCommand, seedMetadataSermon } from "./test/sermon-metadata-fixture";

const sermonId = "test-final-check-sermon";
const human = { kind: "human", adminId: "TEST_ONLY_PRIVATE_PLACEMENT_ADMIN", now: "2026-09-09T00:00:00.000Z" };
const raw = "TEST_ONLY_PRIVATE_PLACEMENT_CANARY 합성 근거";
const evidence = { segmentId: null, start: null, duration: null, from: raw.indexOf("합성"), to: raw.length, quote: "합성 근거" };
const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
const canonicalReference = (() => {
  const result = createBibleReference({ bookId: "JHN", chapter: 3, verseStart: 16, verseEnd: 18 });
  if (!result.ok) throw new Error("fixture reference");
  return result.value;
})();
function metadataFixture(): FinalCheckMetadataSnapshot {
  return finalCheckMetadataSnapshotSchema.parse({
    contractVersion: 1,
    sermonId,
    metadataRevision: 1,
    title: "TEST_ONLY_PUBLIC_SERMON_TITLE",
    sermonDate: "2026-09-06",
    bibleReference: canonicalReference,
  });
}
function head(state: PrivateTranscriptState) {
  return { expectedVersion: state.version, sourceId: state.currentSourceId, revisionId: state.currentRevisionId,
    transcriptSha256: state.revisions.at(-1)!.transcriptSha256 };
}
function draft(difficulty: CandidateDifficulty = "child"): SermonCandidateDraft {
  return { candidates: ["가나다", "라마바", "가사라", "다아바", "허호"].map((answer, i) => ({
    id: `PRIVATE_candidate_${i}`, displayAnswer: answer, gridAnswer: answer, clue: `${difficulty} 합성 단서 ${i}`,
    phraseDescription: "TEST_ONLY_PRIVATE_PHRASE", selectionReason: "TEST_ONLY_PRIVATE_REASON",
    sermonImportance: "TEST_ONLY_PRIVATE_IMPORTANCE", difficultyReason: "TEST_ONLY_PRIVATE_DIFFICULTY",
    grounding: { origin: "transcript", intentClaimIds: ["centralMessage"], evidence: [evidence] },
  })) };
}
async function setup(sourceMode: "notes" | "full" | "partial" = "notes",
  ready: "all" | "no_summary" | "unreviewed_summary" | "no_adult" | "unreviewed_adult" = "all") {
  const difficulty = "child";
  let state: unknown = null, writes = 0;
  let metadata: unknown = metadataFixture();
  const store: TranscriptRevisionStore = {
    async read() { return structuredClone(state); },
    async compareAndSwap(_id, expected, next) {
      if (((state as TranscriptState | null)?.version ?? null) !== expected) return false;
      state = structuredClone(next); writes++; return true;
    },
  };
  const metadataStore: FinalCheckMetadataStore = {
    async read() { return metadata === null ? null : structuredClone(metadata); },
  };
  const service = createTranscriptRevisionService(store);
  const placement = createCandidatePlacementService(store);
  const snapshot = () => structuredClone(state) as PrivateTranscriptState;
  async function run(command: TranscriptCommand) {
    const result = await service.execute(sermonId, command, human);
    if (result.outcome !== "updated") throw new Error(result.code);
    return result.state;
  }
  async function intent(operation: IntentOperation) { return run({ action: "intent", ...head(snapshot()), operation }); }
  async function summary(operation: SummaryOperation) { return run({ action: "summary", ...head(snapshot()), operation }); }
  async function candidate(operation: CandidateOperation) { return run({ action: "candidates", ...head(snapshot()), operation }); }
  async function binding() {
    const read = await service.readIntent(sermonId, true);
    if (read.outcome !== "intent") throw new Error(read.code);
    return candidateBindingFromIntent(read.view)!;
  }
  async function pool() {
    const read = await service.readCandidates(sermonId, difficulty);
    if (read.outcome !== "candidates") throw new Error(read.code);
    return read.view;
  }
  async function review() { return candidate({ kind: "review", difficulty, poolId: (await pool()).current!.id }); }
  async function ticket() { return placementTicketFromCandidates(sermonId, await pool(), options)!; }
  const source = await prepareManualTranscriptSource({ sourceMode: sourceMode === "notes" ? "sermon_notes" : "manual_paste",
    manualSourceKind: sourceMode === "notes" ? "sermon_summary" : "youtube_visible_transcript",
    sourceCoverage: sourceMode === "full" ? "full_transcript" : "partial_notes", rawTranscriptText: raw });
  if (source.outcome !== "validated") throw new Error("fixture source");
  await run({ action: "import_source", expectedVersion: 0, payload: source.source });
  await run({ action: "confirm", ...head(snapshot()), reviewed: true });
  const analysis = Object.fromEntries(intentFields.map((field) => [field, [{ id: field, text: `TEST_ONLY_PRIVATE_${field}`,
    origin: "transcript", evidence: [evidence] }]])) as IntentAnalysis;
  await intent({ kind: "analysis", binding: currentIntentBinding(snapshot())!, analysis });
  const clear = { assessment: "clear" as const, concerns: [] };
  await intent({ kind: "critique", binding: currentIntentBinding(snapshot())!, baseAnalysisId: snapshot().intentEvents.at(-1)!.id,
    analysis, critique: { exaggeratedIntent: clear, unsupportedConclusion: clear, illustrationAsMainClaim: clear, reversedMeaning: clear } });
  const analysisId = snapshot().intentEvents.at(-1)!.id;
  await intent({ kind: "select", analysisId });
  await intent({ kind: "confirm", analysisId });
  await candidate({ kind: "generate", difficulty, binding: await binding(), draft: draft(difficulty) });
  await candidate({ kind: "set_status", difficulty, poolId: (await pool()).current!.id, candidateId: "PRIVATE_candidate_0", status: "locked" });
  await candidate({ kind: "set_status", difficulty, poolId: (await pool()).current!.id, candidateId: "PRIVATE_candidate_4", status: "excluded" });
  await review();
  if (ready !== "no_adult") {
    await candidate({ kind: "generate", difficulty: "adult", binding: await binding(), draft: draft("adult") });
    const adult = await service.readCandidates(sermonId, "adult");
    if (adult.outcome !== "candidates") throw new Error(adult.code);
    if (ready !== "unreviewed_adult") await candidate({ kind: "review", difficulty: "adult", poolId: adult.view.current!.id });
  }
  if (ready !== "no_summary") {
    await summary({ kind: "generate", binding: await binding(), draft: summaryDraft() });
    if (ready !== "unreviewed_summary") await summary({ kind: "review", summaryId: snapshot().summaryEvents.at(-1)!.id });
  }
  const final = createFinalCheckService(store, metadataStore);
  async function finalTicket() {
    const result = await final.capture(sermonId, selections);
    if (result.outcome !== "final_check_ticket") throw new Error(result.code);
    return finalCheckTicketSchema.parse(result.ticket);
  }
  return { final, finalTicket, summary, store, metadataStore, service, placement, snapshot, run, intent, candidate, binding, pool, review,
    ticket, writes: () => writes, metadata: () => structuredClone(metadata) as FinalCheckMetadataSnapshot,
    setMetadata: (value: unknown) => { metadata = structuredClone(value); },
    corrupt: (value: unknown) => { state = value; } };
}

const selections = { child: { options, index: 0 }, adult: { options, index: 0 } };

it("P5-18 connects real isolated D1 metadata to P5-14 and closes stale/ABA/concurrent tickets", async () => {
  const database = createDatabase((env as Env).DB);
  await seedMetadataSermon(database, sermonId);
  const metadata = createSermonMetadataRepository(database);
  const h = await setup(), service = createFinalCheckService(h.store, metadata);
  expect(await service.capture(sermonId, selections)).toMatchObject({ outcome: "failed", code: "FINAL_CHECK_NOT_READY" });
  await metadata.save(metadataCommand(sermonId));
  const captured = await service.capture(sermonId, selections);
  if (captured.outcome !== "final_check_ticket") throw new Error("D1 capture fixture");
  expect(await service.check(sermonId, captured.ticket)).toMatchObject({ outcome: "input_validated" });
  await metadata.save({ ...metadataCommand(sermonId, 1), title: "합성 B" });
  await metadata.save(metadataCommand(sermonId, 2));
  expect(await service.check(sermonId, captured.ticket)).toMatchObject({ outcome: "failed", code: "FINAL_CHECK_STALE" });
  const current = await service.capture(sermonId, selections);
  if (current.outcome !== "final_check_ticket") throw new Error("D1 current fixture");
  const original = metadata.read.bind(metadata);
  let reads = 0;
  vi.spyOn(metadata, "read").mockImplementation(async (id) => {
    const snapshot = await original(id);
    if (++reads === 1) await metadata.save({ ...metadataCommand(sermonId, 3), title: "반환 중 합성 변경" });
    return snapshot;
  });
  expect(await service.check(sermonId, current.ticket)).toMatchObject({ outcome: "failed", code: "FINAL_CHECK_STALE" });
  expect(h.snapshot().version).toBe(captured.ticket.expectedVersion);
});
function summaryDraft(text = "TEST_ONLY_PUBLIC_FINAL_SUMMARY") {
  return { paragraphs: [{ id: "summary-paragraph", text, intentClaimIds: ["centralMessage"], evidence: [evidence] }] };
}
afterEach(() => vi.restoreAllMocks());

describe("P5-16 adapter results retain existing domain gates", () => {
  it.each([false, true])("keeps original summary binding across a delayed completion (stale=%s)", async (stale) => {
    const h = await setup(), before = h.snapshot(), binding = await h.binding();
    const intent = await h.service.readIntent(sermonId, true);
    if (intent.outcome !== "intent" || !intent.view.current) throw new Error("fixture intent");
    const provider = createAiDraftProvider({ complete: async () => {
      if (stale) await h.run({ action: "edit", ...head(h.snapshot()), content: transcriptContentSchema.parse(before.revisions.at(-1)!.content) });
      return { outcome: "completed", task: "summary", output: { format: "structured", value: summaryDraft() } };
    } }, { timeoutMs: 1000 });
    const generated = await provider.generate({ task: "summary", context: { sermonId, binding },
      input: { transcript: before.revisions.at(-1)!.content, intent: intent.view.current.analysis } });
    if (generated.outcome !== "structured_output" || generated.result.task !== "summary") throw new Error("fixture output");
    expect(generated.result.context.binding).toEqual(binding);
    const writes = h.writes();
    const registered = await h.service.execute(sermonId, { action: "summary", ...head(before),
      operation: { kind: "generate", binding: generated.result.context.binding, draft: generated.result.content } }, human);
    if (stale) {
      expect(registered).toMatchObject({ code: "TRANSCRIPT_REVISION_CONFLICT" });
      expect(h.writes()).toBe(writes);
    } else expect(registered.outcome).toBe("updated");
  });

  it("requires semantic evidence validation after structured output succeeds", async () => {
    const h = await setup(), before = h.snapshot(), binding = await h.binding();
    const intent = await h.service.readIntent(sermonId, true);
    if (intent.outcome !== "intent" || !intent.view.current) throw new Error("fixture intent");
    const invalid = summaryDraft();
    invalid.paragraphs[0]!.intentClaimIds = ["unknown-claim"];
    const provider = createAiDraftProvider({ complete: async () => ({ outcome: "completed", task: "summary",
      output: { format: "json", text: JSON.stringify(invalid) } }) }, { timeoutMs: 1000 });
    const generated = await provider.generate({ task: "summary", context: { sermonId, binding },
      input: { transcript: before.revisions.at(-1)!.content, intent: intent.view.current.analysis } });
    if (generated.outcome !== "structured_output" || generated.result.task !== "summary") throw new Error("fixture output");
    const writes = h.writes();
    expect(await h.service.execute(sermonId, { action: "summary", ...head(before), operation: { kind: "generate",
      binding: generated.result.context.binding, draft: generated.result.content } }, human)).toMatchObject({ code: "SERMON_SUMMARY_INVALID" });
    expect(h.writes()).toBe(writes);
  });

  it.each(["current", "stale", "unknown-reference"] as const)("rechecks the original audit ticket and warning references: %s", async (condition) => {
    const h = await setup(), ticket = await h.finalTicket(), audit = createFinalAuditService(h.store, h.metadataStore);
    const prepared = await audit.prepare(sermonId, ticket);
    if (prepared.outcome !== "final_audit_input") throw new Error("fixture audit");
    const before = h.snapshot(), writes = h.writes();
    const provider = createAiDraftProvider({ complete: async () => {
      if (condition === "stale") h.setMetadata({ ...h.metadata(), metadataRevision: h.metadata().metadataRevision + 1 });
      return { outcome: "completed", task: "final_audit", output: { format: "structured", value: { contractVersion: 1,
        warnings: condition === "unknown-reference" ? [{ id: "warning", kind: "intent_summary_mismatch", message: "TEST_ONLY_WARNING",
          intentClaimIds: ["missing"], summaryParagraphIds: ["summary-paragraph"] }] : [] } } };
    } }, { timeoutMs: 1000 });
    const generated = await provider.generate({ task: "final_audit", context: prepared.ticket, input: prepared.input });
    if (generated.outcome !== "structured_output" || generated.result.task !== "final_audit") throw new Error("fixture output");
    expect(generated.result.context).toEqual(ticket);
    const result = await audit.validateWarnings(sermonId, generated.result.context, generated.result.content);
    if (condition === "current") expect(result).toMatchObject({ outcome: "final_audit_warnings", report: {
      effect: "advisory_only", publishDecision: "not_evaluated", warnings: [] } });
    else expect(result).toMatchObject({ code: condition === "stale" ? "FINAL_AUDIT_STALE" : "FINAL_AUDIT_OUTPUT_INVALID" });
    expect(h.snapshot()).toEqual(before);
    expect(h.writes()).toBe(writes);
  });
});

describe("P5-13 final input composition (synthetic only)", () => {
  it.each(["notes", "full"] as const)("validates %s summary and both grids without IO, writes or disclosure leaks", async (source) => {
    const h = await setup(source), ticket = await h.finalTicket(), before = h.snapshot(), writes = h.writes();
    const fetch = vi.spyOn(globalThis, "fetch");
    const checked = await h.final.check(sermonId, ticket);
    if (checked.outcome !== "input_validated") throw new Error(checked.code);
    expect(checked.result.ticket).toEqual(ticket);
    expect(ticket.summary.binding.transcript.version).toBeLessThan(ticket.expectedVersion);
    expect(ticket.placements.child.ticket.binding.transcript.version).not.toBe(ticket.placements.adult.ticket.binding.transcript.version);
    for (const difficulty of ["child", "adult"] as const) {
      const data = checked.result.privateData.variants[difficulty];
      expect(data.report.publishable).toBe(true);
      expect(data.report.wordCount).toBe(4);
      expect(data.provenance).toHaveLength(4);
      expect(Object.isFrozen(data.provenance[0]!.candidate.grounding)).toBe(true);
      expect(publicPuzzleGridSchema.safeParse(checked.result.preview.variants[difficulty]).success).toBe(true);
      for (const entry of checked.result.preview.variants[difficulty].entries) expect(data.solution.entries[entry.id]).toBeDefined();
    }
    const preview = await h.final.readPreview(sermonId, ticket);
    if (preview.outcome !== "final_check_preview") throw new Error(preview.code);
    expect(preview.preview).toEqual(checked.result.preview);
    expect(finalCheckPreviewSchema.safeParse(preview.preview).success).toBe(true);
    expect(preview.preview.metadata).toEqual({
      title: "TEST_ONLY_PUBLIC_SERMON_TITLE",
      date: "2026-09-06",
      bibleReferenceLabel: "요한복음 3:16–18",
      translation: "개역개정",
      bibleReadingUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE",
    });
    expect(checked.result.privateData.metadata).toEqual(metadataFixture());
    expect(preview.preview.summary.disclosure).toContain(source === "notes" ? "관리자가 제공한" : "공개 자막");
    for (const secret of [raw, human.adminId, "PRIVATE", "solution", "gridAnswer", "grounding", "binding", "provenance",
      "reviewId", "ticket", "metadataRevision", "contractVersion", "bookId", "verseCount",
      ticket.summary.summaryId, ticket.binding.analysisId, ...draft().candidates.map((c) => c.gridAnswer)]) {
      expect(JSON.stringify(preview)).not.toContain(secret);
    }
    expect(h.snapshot()).toEqual(before); expect(h.writes()).toBe(writes); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["no_summary", "unreviewed_summary", "no_adult", "unreviewed_adult"] as const)("requires complete reviewed inputs: %s", async (ready) => {
    const h = await setup("notes", ready);
    expect(await h.final.capture(sermonId, selections)).toEqual({ outcome: "failed", code: "FINAL_CHECK_NOT_READY" });
  });

  it("preserves display spacing while matching grid answers to private solutions", async () => {
    const h = await setup(), old = await h.finalTicket(), data = draft();
    data.candidates[0]!.displayAnswer = "가 나 다";
    await h.candidate({ kind: "edit", difficulty: "child", basePoolId: old.placements.child.ticket.poolId, binding: await h.binding(), draft: data });
    await h.review();
    const checked = await h.final.check(sermonId, await h.finalTicket());
    if (checked.outcome !== "input_validated") throw new Error(checked.code);
    expect(checked.result.privateData.variants.child.solution.entries["entry-1"]).toBe("가나다");
    expect(checked.result.privateData.variants.child.provenance[0]!.candidate.displayAnswer).toBe("가 나 다");
  });

  it.each(["expectedVersion", "metadataRevision", "metadataTitle", "metadataLabel", "summaryId", "summaryReview", "summaryBinding", "rootBinding", "pool", "review", "candidateBinding", "sourceHash", "transcriptVersion"])("rejects substituted %s references", async (field) => {
    const h = await setup(), ticket = await h.finalTicket();
    if (field === "expectedVersion") ticket.expectedVersion++;
    if (field === "metadataRevision") ticket.metadata.metadataRevision++;
    if (field === "metadataTitle") ticket.metadata.title = "바꿔 끼운 제목";
    if (field === "metadataLabel") ticket.metadata.bibleReference.canonicalLabel = "요한복음 3:16";
    if (field === "summaryId") ticket.summary.summaryId = "wrong";
    if (field === "summaryReview") ticket.summary.reviewId = "wrong";
    if (field === "summaryBinding") ticket.summary.binding.intentConfirmationId = "wrong";
    if (field === "rootBinding") ticket.binding.analysisId = "wrong";
    if (field === "pool") ticket.placements.adult.ticket.poolId = ticket.placements.child.ticket.poolId;
    if (field === "review") ticket.placements.adult.ticket.reviewId = ticket.placements.child.ticket.reviewId;
    if (field === "candidateBinding") ticket.placements.child.ticket.binding.analysisId = "wrong";
    if (field === "sourceHash") ticket.binding.transcript.sourceSha256 = "0".repeat(64);
    if (field === "transcriptVersion") ticket.summary.binding.transcript.version++;
    expect((await h.final.check(sermonId, ticket)).outcome).toBe("failed");
    expect((await h.final.readPreview(sermonId, ticket)).outcome).toBe("failed");
  });

  it("requires exactly two difficulty references and strict private input fields", async () => {
    const h = await setup(), ticket = await h.finalTicket();
    for (const extra of [{ publish: true }, { model: "external" }, { actorId: human.adminId }, { solution: {} }, { report: {} }, { summaryText: raw }]) {
      expect(finalCheckTicketSchema.safeParse({ ...ticket, ...extra }).success).toBe(false);
      expect(await h.final.check(sermonId, { ...ticket, ...extra })).toEqual({ outcome: "failed", code: "FINAL_CHECK_INVALID" });
    }
    for (const placements of [{ child: ticket.placements.child }, { ...ticket.placements, adult: ticket.placements.child },
      { ...ticket.placements, extra: ticket.placements.child }]) {
      expect((await h.final.check(sermonId, { ...ticket, placements })).outcome).toBe("failed");
    }
    expect((await h.final.check("wrong-sermon", ticket)).outcome).toBe("failed");
    expect((await h.final.check(sermonId, await h.final.check(sermonId, ticket))).outcome).toBe("failed");
    for (const index of [-1, 3, 0.5, "0"]) {
      expect((await h.final.capture(sermonId, { ...selections, child: { options, index } })).outcome).toBe("failed");
    }
  });

  it("requires already-normalized title, real date, and a fully canonical P5-01 reference", () => {
    const base = metadataFixture();
    const wrongLabel = structuredClone(base);
    wrongLabel.bibleReference.canonicalLabel = "요한복음 3:16";
    const wrongCount = structuredClone(base);
    wrongCount.bibleReference.verseCount = 1;
    const outOfRange = structuredClone(base);
    outOfRange.bibleReference.reference.start.verse = 99;
    outOfRange.bibleReference.reference.end.verse = 99;
    outOfRange.bibleReference.canonicalLabel = "요한복음 3:99";
    const invalid = [
      { ...base, title: " 제목" },
      { ...base, title: "가" },
      { ...base, sermonDate: "2026-02-30" },
      { ...base, extra: true },
      wrongLabel,
      wrongCount,
      outOfRange,
      { ...base, bibleReference: { ...base.bibleReference, translation: "다른 판본" } },
      { ...base, bibleReference: { ...base.bibleReference, mode: "licensed_local" } },
      { ...base, bibleReference: { ...base.bibleReference, readingPortalUrl: "https://example.test" } },
    ];
    for (const value of invalid) {
      expect(finalCheckMetadataSnapshotSchema.safeParse(value).success).toBe(false);
    }
    expect(finalCheckMetadataSnapshotSchema.safeParse(base).success).toBe(true);
  });

  it.each(["title", "date", "reference", "revision"] as const)("invalidates the old ticket after a %s metadata change", async (field) => {
    const h = await setup(), old = await h.finalTicket();
    const changed = h.metadata();
    changed.metadataRevision++;
    if (field === "title") changed.title = "수정된 설교 제목";
    if (field === "date") changed.sermonDate = "2026-09-07";
    if (field === "reference") {
      const next = createBibleReference({ bookId: "GEN", chapter: 1, verseStart: 1, verseEnd: 3 });
      if (!next.ok) throw new Error("fixture reference");
      changed.bibleReference = next.value;
    }
    h.setMetadata(changed);
    expect(await h.final.check(sermonId, old)).toEqual({ outcome: "failed", code: "FINAL_CHECK_STALE" });
    const current = await h.finalTicket();
    const checked = await h.final.check(sermonId, current);
    expect(checked.outcome).toBe("input_validated");
    if (checked.outcome === "input_validated") {
      expect(checked.result.preview.metadata.title).toBe(changed.title);
      expect(checked.result.preview.metadata.date).toBe(changed.sermonDate);
      expect(checked.result.preview.metadata.bibleReferenceLabel).toBe(changed.bibleReference.canonicalLabel);
    }
  });

  it("does not revive an old check when visible metadata is restored", async () => {
    const h = await setup(), old = await h.finalTicket();
    const changed = h.metadata();
    changed.metadataRevision = 2;
    changed.title = "임시로 바꾼 제목";
    h.setMetadata(changed);
    expect((await h.final.check(sermonId, old)).outcome).toBe("failed");
    const restored = metadataFixture();
    restored.metadataRevision = 3;
    h.setMetadata(restored);
    expect(await h.final.check(sermonId, old)).toEqual({ outcome: "failed", code: "FINAL_CHECK_STALE" });
    expect((await h.final.check(sermonId, await h.finalTicket())).outcome).toBe("input_validated");
  });

  it.each(["capture", "check", "readPreview"] as const)("rejects concurrent metadata changes before %s delivery", async (operation) => {
    const h = await setup(), ticket = await h.finalTicket(), before = h.metadata();
    const after = structuredClone(before);
    after.metadataRevision++;
    after.title = "동시에 바뀐 제목";
    const read = vi.spyOn(h.metadataStore, "read").mockResolvedValueOnce(before).mockResolvedValue(after);
    expect(await h.final[operation](sermonId, operation === "capture" ? selections : ticket)).toEqual({
      outcome: "failed",
      code: "FINAL_CHECK_STALE",
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("fails closed for missing or corrupt current metadata without leaking it", async () => {
    const h = await setup(), ticket = await h.finalTicket();
    h.setMetadata(null);
    expect(await h.final.capture(sermonId, selections)).toEqual({ outcome: "failed", code: "FINAL_CHECK_NOT_READY" });
    h.setMetadata({ ...metadataFixture(), title: ` ${raw}` });
    expect(await h.final.check(sermonId, ticket)).toEqual({ outcome: "failed", code: "FINAL_CHECK_INVALID" });
    vi.spyOn(h.metadataStore, "read").mockRejectedValue(new Error(raw));
    expect(JSON.stringify(await h.final.readPreview(sermonId, ticket))).not.toContain(raw);
  });

  it.each(["transcript", "reconfirm", "intent", "summary", "summary_restore", "child_clue", "adult_answer", "candidate_status", "candidate_restore"])("invalidates old final results after %s changes", async (mode) => {
    const h = await setup(), ticket = await h.finalTicket();
    expect((await h.final.check(sermonId, ticket)).outcome).toBe("input_validated");
    if (mode === "transcript") await h.run({ action: "edit", ...head(h.snapshot()), content: { format: "plain_text", text: raw } });
    else if (mode === "reconfirm") await h.run({ action: "confirm", ...head(h.snapshot()), reviewed: true });
    else if (mode === "intent") await h.intent({ kind: "select", analysisId: ticket.binding.analysisId });
    else if (mode === "summary") await h.summary({ kind: "edit", baseSummaryId: ticket.summary.summaryId, binding: await h.binding(), draft: summaryDraft("수정 공개 요약") });
    else if (mode === "summary_restore") await h.summary({ kind: "restore", summaryId: ticket.summary.summaryId });
    else if (mode === "candidate_status") await h.candidate({ kind: "set_status", difficulty: "child", poolId: ticket.placements.child.ticket.poolId, candidateId: "PRIVATE_candidate_0", status: "excluded" });
    else if (mode === "candidate_restore") await h.candidate({ kind: "restore", difficulty: "child", poolId: ticket.placements.child.ticket.poolId });
    else {
      const difficulty = mode === "child_clue" ? "child" : "adult", data = draft(difficulty);
      if (mode === "child_clue") data.candidates[0]!.clue = "수정된 어린이 단서";
      else { data.candidates[0]!.displayAnswer = "하허호"; data.candidates[0]!.gridAnswer = "하허호"; }
      await h.candidate({ kind: "edit", difficulty, basePoolId: ticket.placements[difficulty].ticket.poolId, binding: await h.binding(), draft: data });
    }
    expect((await h.final.readPreview(sermonId, ticket)).outcome).toBe("failed");
    expect((await h.final.capture(sermonId, selections)).outcome).toBe("failed");
    if (mode === "child_clue" || mode === "adult_answer") {
      const difficulty = mode === "child_clue" ? "child" : "adult";
      const pool = await h.service.readCandidates(sermonId, difficulty);
      if (pool.outcome !== "candidates") throw new Error(pool.code);
      await h.candidate({ kind: "review", difficulty, poolId: pool.view.current!.id });
      const next = await h.final.check(sermonId, await h.finalTicket());
      if (mode === "child_clue") {
        if (next.outcome !== "input_validated") throw new Error(next.code);
        expect(next.result.preview.variants.child.entries.some((e) => e.clue === "수정된 어린이 단서")).toBe(true);
      } else expect(next).toMatchObject({ outcome: "failed", code: "FINAL_CHECK_LAYOUT_UNAVAILABLE" });
    }
    if (mode === "summary" || mode === "summary_restore") {
      const current = await h.service.readSummary(sermonId);
      if (current.outcome !== "summary") throw new Error(current.code);
      await h.summary({ kind: "review", summaryId: current.view.current!.id });
      expect((await h.final.check(sermonId, await h.finalTicket())).outcome).toBe("input_validated");
      expect((await h.final.check(sermonId, ticket)).outcome).toBe("failed");
    }
  });

  it("keeps valid human reviews after comparison generation but requires fresh final tickets", async () => {
    const h = await setup(), old = await h.finalTicket();
    await h.summary({ kind: "generate", binding: await h.binding(), draft: summaryDraft("비교용 공개 요약") });
    await h.candidate({ kind: "generate", difficulty: "adult", binding: await h.binding(), draft: draft("adult") });
    expect(await h.final.check(sermonId, old)).toMatchObject({ code: "FINAL_CHECK_STALE" });
    const next = await h.finalTicket();
    expect(next.summary.reviewId).toBe(old.summary.reviewId);
    expect(next.placements.adult.ticket.reviewId).toBe(old.placements.adult.ticket.reviewId);
    expect((await h.final.check(sermonId, next)).outcome).toBe("input_validated");
    expect(await h.service.readCandidateClues(sermonId, "child")).toMatchObject({ outcome: "candidate_clues" });
    expect(await h.service.readSummaryPreview(sermonId, true)).toMatchObject({ outcome: "summary_preview" });
    const intent = await h.service.readIntent(sermonId, true);
    if (intent.outcome !== "intent") throw new Error(intent.code);
    expect(summaryBindingFromIntent(intent.view)).not.toBeNull();
    expect((await h.placement.readPreview(sermonId, await h.ticket())).outcome).toBe("placement_preview");
  });

  it("preserves the partial-script disclosure gate", async () => {
    const h = await setup("partial"), ticket = await h.finalTicket();
    expect(await h.final.check(sermonId, ticket)).toEqual({ outcome: "failed", code: "FINAL_CHECK_DISCLOSURE_UNSUPPORTED" });
    expect((await h.service.readSummary(sermonId, true)).outcome).toBe("summary");
  });

  it.each(["budget", "missing_index", "impossible"])("does not pass when an actual adult layout is unavailable: %s", async (mode) => {
    const h = await setup();
    const settings = structuredClone(selections);
    if (mode === "budget") settings.adult.options.searchBudgetPerTrial = 1;
    else if (mode === "missing_index") settings.adult.index = 2;
    else settings.adult.options.targetWordCounts = [6];
    const captured = await h.final.capture(sermonId, settings);
    if (captured.outcome !== "final_check_ticket") throw new Error(captured.code);
    expect(await h.final.check(sermonId, captured.ticket)).toMatchObject({ outcome: "failed", code: "FINAL_CHECK_LAYOUT_UNAVAILABLE" });
  });

  it.each(["capture", "check", "readPreview"] as const)("rejects concurrent changes before %s delivery", async (operation) => {
    const h = await setup(), ticket = await h.finalTicket();
    const before = h.snapshot();
    await h.summary({ kind: "generate", binding: await h.binding(), draft: summaryDraft("비교본") });
    const after = h.snapshot();
    const read = vi.spyOn(h.store, "read").mockResolvedValueOnce(before).mockResolvedValue(after);
    expect(await h.final[operation](sermonId, operation === "capture" ? selections : ticket)).toEqual({ outcome: "failed", code: "FINAL_CHECK_STALE" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rejects corrupt storage and exceptions without leaking source or partial public output", async () => {
    const h = await setup(), ticket = await h.finalTicket();
    const damaged = structuredClone(h.snapshot()) as TranscriptState;
    damaged.summaryEvents[0]!.version = 1;
    h.corrupt(damaged);
    expect(await h.final.check(sermonId, ticket)).toEqual({ outcome: "failed", code: "FINAL_CHECK_INVALID" });
    vi.spyOn(h.store, "read").mockRejectedValue(new Error(raw));
    expect(await h.final.readPreview(sermonId, ticket)).toEqual({ outcome: "failed", code: "FINAL_CHECK_INVALID" });
  });

  it.each(["number", "letter", "answer", "disconnected", "locked", "clue", "size", "count"])("independently rejects a defective engine result: %s", async (mode) => {
    const h = await setup(), ticket = await h.finalTicket();
    const search = poolSearch.searchCandidatePool;
    vi.spyOn(poolSearch, "searchCandidatePool").mockImplementationOnce((input) => {
      const result = structuredClone(search(input));
      const puzzle = result.layouts[0]!.puzzle;
      if (mode === "size") puzzle.gridSize = 10;
      if (mode === "count") result.layouts[0]!.targetWordCount = 99;
      if (mode === "number") puzzle.entries[0]!.number = 99;
      if (mode === "letter") (puzzle.solution.cells as Record<string, string>)[Object.keys(puzzle.solution.cells)[0]!] = "하";
      if (mode === "answer") (puzzle.solution.entries as Record<string, string>)[puzzle.entries[0]!.entryId] = "하하하";
      if (mode === "disconnected") puzzle.entries[0]!.start = { row: 4, column: 4 };
      if (mode === "locked") puzzle.entries[0]!.entryId = "entry-5";
      if (mode === "clue") puzzle.entries[0]!.clue = "틀린 후보 단서";
      return result;
    });
    expect((await h.final.check(sermonId, ticket)).outcome).toBe("failed");
  });
});

describe("P5-15 final AI audit warning-only contract (synthetic only)", () => {
  it("derives the minimum current input from confirmed intent, reviewed summary and selected candidates", async () => {
    const h = await setup(), ticket = await h.finalTicket();
    const audit = createFinalAuditService(h.store, h.metadataStore);
    const before = h.snapshot(), writes = h.writes();
    const fetch = vi.spyOn(globalThis, "fetch");
    const prepared = await audit.prepare(sermonId, ticket);
    if (prepared.outcome !== "final_audit_input") throw new Error(prepared.code);

    expect(finalAuditInputSchema.safeParse(prepared.input).success).toBe(true);
    expect(prepared.input.metadata).toEqual({
      title: "TEST_ONLY_PUBLIC_SERMON_TITLE",
      date: "2026-09-06",
      bibleReferenceLabel: "요한복음 3:16–18",
      translation: "개역개정",
      bibleReadingUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE",
    });
    expect(prepared.input.transcript).toEqual({ format: "plain_text", text: raw });
    expect(prepared.input.intent.analysisId).toBe(ticket.binding.analysisId);
    expect(prepared.input.intent.confirmationId).toBe(ticket.binding.intentConfirmationId);
    expect(prepared.input.summary.summaryId).toBe(ticket.summary.summaryId);
    expect(prepared.input.summary.reviewId).toBe(ticket.summary.reviewId);
    expect(prepared.input.summary.draft.paragraphs[0]!.id).toBe("summary-paragraph");
    for (const difficulty of ["child", "adult"] as const) {
      expect(prepared.input.variants[difficulty].difficulty).toBe(difficulty);
      expect(prepared.input.variants[difficulty].candidates).toHaveLength(4);
      expect(prepared.input.variants[difficulty].candidates.map((item) => item.candidate.id))
        .not.toContain("PRIVATE_candidate_4");
    }
    const withWorkflowStatus = structuredClone(prepared.input) as unknown as Record<string, unknown>;
    const variants = withWorkflowStatus.variants as { child: { candidates: Array<Record<string, unknown>> } };
    variants.child.candidates[0]!.status = "locked";
    expect(finalAuditInputSchema.safeParse(withWorkflowStatus).success).toBe(false);

    const providerJson = JSON.stringify(prepared.input);
    for (const forbidden of [human.adminId, "metadataRevision", "expectedVersion", "sourceSha256",
      "transcriptSha256", "solution", "coordinates", "model", "cost", "publishable"]) {
      expect(providerJson).not.toContain(forbidden);
    }
    expect(Object.isFrozen(prepared.input.variants.child.candidates[0]!.candidate.grounding)).toBe(true);
    expect(h.snapshot()).toEqual(before);
    expect(h.writes()).toBe(writes);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts only the three pairwise warning kinds and returns a fixed advisory effect", async () => {
    const h = await setup(), ticket = await h.finalTicket();
    const audit = createFinalAuditService(h.store, h.metadataStore);
    const prepared = await audit.prepare(sermonId, ticket);
    if (prepared.outcome !== "final_audit_input") throw new Error(prepared.code);
    const child = prepared.input.variants.child.candidates[0]!;
    const adult = prepared.input.variants.adult.candidates[0]!;
    const output = {
      contractVersion: 1 as const,
      warnings: [
        { id: "warning-intent-summary", kind: "intent_summary_mismatch" as const,
          message: "의도와 요약을 함께 확인하세요.", intentClaimIds: ["centralMessage"],
          summaryParagraphIds: ["summary-paragraph"] },
        { id: "warning-intent-child", kind: "intent_candidate_mismatch" as const,
          message: "의도와 어린이 문제를 함께 확인하세요.", intentClaimIds: ["purpose"],
          candidateReferences: [{ difficulty: "child" as const, entryId: child.entryId, candidateId: child.candidate.id }] },
        { id: "warning-summary-adult", kind: "summary_candidate_mismatch" as const,
          message: "요약과 장년 문제를 함께 확인하세요.", summaryParagraphIds: ["summary-paragraph"],
          candidateReferences: [{ difficulty: "adult" as const, entryId: adult.entryId, candidateId: adult.candidate.id }] },
      ],
    };
    expect(finalAuditOutputSchema.safeParse(output).success).toBe(true);
    const validated = await audit.validateWarnings(sermonId, ticket, output);
    if (validated.outcome !== "final_audit_warnings") throw new Error(validated.code);
    expect(validated.report).toEqual({
      effect: "advisory_only",
      publishDecision: "not_evaluated",
      warnings: output.warnings,
    });
    expect(finalAuditReportSchema.safeParse(validated.report).success).toBe(true);
    expect(Object.isFrozen(validated.report.warnings[0])).toBe(true);
  });

  it("keeps an empty warning list advisory and does not turn it into approval", async () => {
    const h = await setup(), ticket = await h.finalTicket();
    const audit = createFinalAuditService(h.store, h.metadataStore);
    const validated = await audit.validateWarnings(sermonId, ticket, { contractVersion: 1, warnings: [] });
    expect(validated).toMatchObject({
      outcome: "final_audit_warnings",
      report: { effect: "advisory_only", publishDecision: "not_evaluated", warnings: [] },
    });
    expect(JSON.stringify(validated)).not.toContain("approved");
  });

  it.each([
    { approved: true },
    { publishable: false },
    { blocking: true },
    { correctedSummary: "자동 교체" },
    { replacement: { clue: "자동 교체" } },
    { model: "provider-model" },
    { usage: { outputTokens: 1 } },
  ])("rejects decision, replacement and provider metadata fields: %o", async (extra) => {
    const h = await setup(), ticket = await h.finalTicket();
    const audit = createFinalAuditService(h.store, h.metadataStore);
    const output = { contractVersion: 1, warnings: [], ...extra };
    expect(finalAuditOutputSchema.safeParse(output).success).toBe(false);
    expect(await audit.validateWarnings(sermonId, ticket, output)).toEqual({
      outcome: "failed", code: "FINAL_AUDIT_OUTPUT_INVALID",
    });
  });

  it("rejects warning-level severity, block and replacement fields", async () => {
    const h = await setup(), ticket = await h.finalTicket();
    const audit = createFinalAuditService(h.store, h.metadataStore);
    const base = { id: "warning", kind: "intent_summary_mismatch", message: "확인하세요.",
      intentClaimIds: ["centralMessage"], summaryParagraphIds: ["summary-paragraph"] };
    for (const extra of [{ severity: "critical" }, { blocking: true }, { replacement: "바꿀 문장" }, { approved: false }]) {
      const output = { contractVersion: 1, warnings: [{ ...base, ...extra }] };
      expect(finalAuditOutputSchema.safeParse(output).success).toBe(false);
      expect((await audit.validateWarnings(sermonId, ticket, output)).outcome).toBe("failed");
    }
  });

  it.each(["claim", "paragraph", "candidate", "entry", "difficulty"] as const)("rejects a warning with an unknown %s reference", async (field) => {
    const h = await setup(), ticket = await h.finalTicket();
    const audit = createFinalAuditService(h.store, h.metadataStore);
    const prepared = await audit.prepare(sermonId, ticket);
    if (prepared.outcome !== "final_audit_input") throw new Error(prepared.code);
    const selected = prepared.input.variants.child.candidates[0]!;
    const warning = field === "claim" ? {
      id: "warning", kind: "intent_summary_mismatch", message: "확인하세요.",
      intentClaimIds: ["unknown-claim"], summaryParagraphIds: ["summary-paragraph"],
    } : field === "paragraph" ? {
      id: "warning", kind: "intent_summary_mismatch", message: "확인하세요.",
      intentClaimIds: ["centralMessage"], summaryParagraphIds: ["unknown-paragraph"],
    } : {
      id: "warning", kind: "intent_candidate_mismatch", message: "확인하세요.",
      intentClaimIds: ["centralMessage"], candidateReferences: [{
        difficulty: field === "difficulty" ? "senior" : "child",
        entryId: field === "entry" ? "unknown-entry" : selected.entryId,
        candidateId: field === "candidate" ? "unknown-candidate" : selected.candidate.id,
      }],
    };
    expect(await audit.validateWarnings(sermonId, ticket, { contractVersion: 1, warnings: [warning] }))
      .toEqual({ outcome: "failed", code: "FINAL_AUDIT_OUTPUT_INVALID" });
  });

  it("rejects duplicate warning IDs and duplicate references", async () => {
    const h = await setup(), ticket = await h.finalTicket();
    const audit = createFinalAuditService(h.store, h.metadataStore);
    const warning = { id: "duplicate", kind: "intent_summary_mismatch", message: "확인하세요.",
      intentClaimIds: ["centralMessage"], summaryParagraphIds: ["summary-paragraph"] };
    for (const warnings of [
      [warning, warning],
      [{ ...warning, intentClaimIds: ["centralMessage", "centralMessage"] }],
      [{ ...warning, summaryParagraphIds: ["summary-paragraph", "summary-paragraph"] }],
    ]) {
      expect(finalAuditOutputSchema.safeParse({ contractVersion: 1, warnings }).success).toBe(false);
      expect((await audit.validateWarnings(sermonId, ticket, { contractVersion: 1, warnings })).outcome).toBe("failed");
    }
  });

  it("rejects old audit output after any aggregate change and accepts a fresh ticket", async () => {
    const h = await setup(), oldTicket = await h.finalTicket();
    const audit = createFinalAuditService(h.store, h.metadataStore);
    expect((await audit.prepare(sermonId, oldTicket)).outcome).toBe("final_audit_input");
    await h.summary({ kind: "generate", binding: await h.binding(), draft: summaryDraft("비교용 감사 입력") });
    expect(await audit.validateWarnings(sermonId, oldTicket, { contractVersion: 1, warnings: [] }))
      .toEqual({ outcome: "failed", code: "FINAL_AUDIT_STALE" });
    const currentTicket = await h.finalTicket();
    expect((await audit.validateWarnings(sermonId, currentTicket, { contractVersion: 1, warnings: [] })).outcome)
      .toBe("final_audit_warnings");
  });

  it("rejects old audit output after metadata revision changes even when visible values are restored", async () => {
    const h = await setup(), ticket = await h.finalTicket();
    const audit = createFinalAuditService(h.store, h.metadataStore);
    const restored = h.metadata();
    restored.metadataRevision++;
    h.setMetadata(restored);
    expect(await audit.validateWarnings(sermonId, ticket, { contractVersion: 1, warnings: [] }))
      .toEqual({ outcome: "failed", code: "FINAL_AUDIT_STALE" });
  });

  it("preserves existing hard-gate and partial disclosure failures instead of converting them to AI warnings", async () => {
    const h = await setup("partial"), ticket = await h.finalTicket();
    const audit = createFinalAuditService(h.store, h.metadataStore);
    expect(await audit.prepare(sermonId, ticket)).toEqual({ outcome: "failed", code: "FINAL_AUDIT_NOT_READY" });
    expect(await audit.validateWarnings(sermonId, ticket, { contractVersion: 1, warnings: [] }))
      .toEqual({ outcome: "failed", code: "FINAL_AUDIT_NOT_READY" });
  });

  it("performs no writes or provider calls while validating warnings", async () => {
    const h = await setup(), ticket = await h.finalTicket();
    const audit = createFinalAuditService(h.store, h.metadataStore);
    const before = h.snapshot(), writes = h.writes();
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await audit.validateWarnings(sermonId, ticket, { contractVersion: 1, warnings: [] });
    expect(result.outcome).toBe("final_audit_warnings");
    expect(h.snapshot()).toEqual(before);
    expect(h.writes()).toBe(writes);
    expect(fetch).not.toHaveBeenCalled();
  });
});
