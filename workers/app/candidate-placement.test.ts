import { describe, expect, it, vi } from "vitest";
import { publicPuzzleGridSchema } from "../../shared/api/public-quiz";
import { validateLayout } from "../../shared/puzzle/layout";
import { createCandidatePlacementService, placementTicketFromCandidates, placementTicketSchema, type PlacementTicket } from "../_shared/services/candidate-placement";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { candidateBindingFromIntent } from "../_shared/services/sermon-candidates";
import type { CandidateDifficulty, CandidateOperation, SermonCandidateDraft } from "../_shared/services/sermon-candidates-contract";
import { currentIntentBinding } from "../_shared/services/sermon-intent";
import { intentFields, type IntentAnalysis, type IntentOperation } from "../_shared/services/sermon-intent-contract";
import type { PrivateTranscriptState, TranscriptCommand, TranscriptRevisionStore, TranscriptState } from "../_shared/services/transcript-revision-contract";
import { createTranscriptRevisionService } from "../_shared/services/transcript-revisions";

const sermonId = "test-placement-sermon";
const human = { kind: "human", adminId: "TEST_ONLY_PRIVATE_PLACEMENT_ADMIN", now: "2026-09-09T00:00:00.000Z" };
const raw = "TEST_ONLY_PRIVATE_PLACEMENT_CANARY 합성 근거";
const evidence = { segmentId: null, start: null, duration: null, from: raw.indexOf("합성"), to: raw.length, quote: "합성 근거" };
const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
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
async function setup(difficulty: CandidateDifficulty = "child") {
  let state: unknown = null, writes = 0;
  const store: TranscriptRevisionStore = {
    async read() { return structuredClone(state); },
    async compareAndSwap(_id, expected, next) {
      if (((state as TranscriptState | null)?.version ?? null) !== expected) return false;
      state = structuredClone(next); writes++; return true;
    },
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
  const source = await prepareManualTranscriptSource({ sourceMode: "sermon_notes", manualSourceKind: "sermon_summary",
    sourceCoverage: "partial_notes", rawTranscriptText: raw });
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
  return { store, service, placement, snapshot, run, intent, candidate, binding, pool, review, ticket, writes: () => writes,
    corrupt: (value: unknown) => { state = value; } };
}

describe("P5-12 current reviewed candidates to variable placement", () => {
  it.each(["child", "adult"] as const)("reproduces actual %s grids with private solution and provenance separated", async (difficulty) => {
    const h = await setup(difficulty), ticket = await h.ticket(), before = h.snapshot(), writes = h.writes();
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      const result = await h.placement.trial(sermonId, ticket);
      expect(result.outcome).toBe("placement_trial");
      if (result.outcome !== "placement_trial") throw new Error(result.code);
      expect(result.trial.ticket).toEqual(ticket);
      expect(result.trial.result.layouts.length).toBeGreaterThan(0);
      expect(Object.isFrozen(result.trial.provenance[0]!.candidate.grounding)).toBe(true);
      const layout = result.trial.result.layouts[0]!;
      expect(layout.puzzle.report.wordCount).toBe(4);
      expect(layout.puzzle.solution.entries).toMatchObject({ "entry-1": "가나다" });
      expect(layout.puzzle.entries.map((e) => e.entryId)).toContain("entry-1");
      expect(layout.puzzle.entries.map((e) => e.entryId)).not.toContain("entry-5");
      expect(validateLayout(layout.puzzle.gridSize, layout.puzzle.entries).publishable).toBe(true);
      expect(await h.placement.trial(sermonId, ticket)).toEqual(result);
      const preview = await h.placement.readPreview(sermonId, ticket);
      if (preview.outcome !== "placement_preview") throw new Error(preview.code);
      expect(publicPuzzleGridSchema.safeParse(preview.preview.grid).success).toBe(true);
      for (const entry of preview.preview.grid.entries) expect(layout.puzzle.solution.entries[entry.id]).toBeDefined();
      for (const secret of [raw, "PRIVATE", "grounding", "solution", "gridAnswer", "displayAnswer", "binding", "checksum", "poolId",
        ticket.poolId, ticket.reviewId, ticket.binding.analysisId, ...draft().candidates.map((c) => c.gridAnswer)]) {
        expect(JSON.stringify(preview)).not.toContain(secret);
      }
      expect(h.snapshot()).toEqual(before); expect(h.writes()).toBe(writes); expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it.each(["expectedVersion", "poolId", "reviewId", "analysisId", "intentConfirmationId", "sourceId", "revisionId", "transcriptSha256", "sourceSha256", "confirmationId", "sourceRevision", "version"])("rejects stale or substituted %s", async (field) => {
    const h = await setup(), ticket = await h.ticket();
    const mutated = structuredClone(ticket) as unknown as Record<string, unknown>;
    if (field === "expectedVersion") mutated[field] = ticket.expectedVersion - 1;
    else if (field === "poolId" || field === "reviewId") mutated[field] = "wrong-id";
    else {
      const binding = mutated.binding as Record<string, unknown>;
      const target = field === "analysisId" || field === "intentConfirmationId" ? binding : binding.transcript as Record<string, unknown>;
      target[field] = field === "sourceRevision" || field === "version" ? Number(target[field]) + 1
        : field.endsWith("Sha256") ? "0".repeat(64) : "wrong-id";
    }
    expect((await h.placement.trial(sermonId, mutated)).outcome).toBe("failed");
  });

  it("rejects extra authority, coordinates, results and invalid scopes without writes", async () => {
    const h = await setup(), ticket = await h.ticket(), before = h.snapshot();
    for (const extra of [{ solution: {} }, { actorId: human.adminId }, { layout: {} }, { publish: true }, { model: "external" }]) {
      expect(placementTicketSchema.safeParse({ ...ticket, ...extra }).success).toBe(false);
      expect(await h.placement.trial(sermonId, { ...ticket, ...extra })).toEqual({ outcome: "failed", code: "PLACEMENT_INVALID" });
    }
    expect(await h.placement.trial("other-sermon", ticket)).toEqual({ outcome: "failed", code: "PLACEMENT_INVALID" });
    expect(await h.placement.trial(sermonId, { ...ticket, difficulty: "adult" })).toMatchObject({ outcome: "failed" });
    for (const index of [-1, 3, 0.5, "0", null]) expect(await h.placement.readPreview(sermonId, ticket, index)).toMatchObject({ code: "PLACEMENT_INVALID" });
    expect(h.snapshot()).toEqual(before);
  });

  it.each(["answer", "clue", "status", "restore", "transcript", "intent"])("invalidates previous results after %s changes", async (mode) => {
    const h = await setup(), ticket = await h.ticket();
    const previousPreview = await h.placement.readPreview(sermonId, ticket);
    expect(previousPreview.outcome).toBe("placement_preview");
    if (mode === "transcript") {
      await h.run({ action: "edit", ...head(h.snapshot()), content: { format: "plain_text", text: `${raw} 수정` } });
    } else if (mode === "intent") {
      await h.intent({ kind: "select", analysisId: ticket.binding.analysisId });
    } else if (mode === "status") {
      await h.candidate({ kind: "set_status", difficulty: "child", poolId: ticket.poolId, candidateId: "PRIVATE_candidate_0", status: "excluded" });
    } else if (mode === "restore") {
      await h.candidate({ kind: "restore", difficulty: "child", poolId: ticket.poolId });
    } else {
      const data = draft();
      if (mode === "answer") { data.candidates[0]!.displayAnswer = "하허호"; data.candidates[0]!.gridAnswer = "하허호"; }
      else data.candidates[0]!.clue = "수정한 합성 단서";
      await h.candidate({ kind: "edit", difficulty: "child", basePoolId: ticket.poolId, binding: await h.binding(), draft: data });
    }
    expect((await h.placement.readPreview(sermonId, ticket)).outcome).toBe("failed");
    expect(placementTicketFromCandidates(sermonId, await h.pool(), options)).toBeNull();
    if (mode === "answer" || mode === "clue" || mode === "restore") {
      await h.review();
      expect(await h.placement.readPreview(sermonId, ticket)).toMatchObject({ code: "PLACEMENT_STALE" });
      const fresh = await h.placement.trial(sermonId, await h.ticket());
      if (fresh.outcome !== "placement_trial") throw new Error(fresh.code);
      expect(fresh.trial.result.layouts.length > 0).toBe(mode !== "answer");
      if (mode === "clue" && previousPreview.outcome === "placement_preview") {
        const next = await h.placement.readPreview(sermonId, await h.ticket());
        if (next.outcome !== "placement_preview") throw new Error(next.code);
        expect(next.preview.grid.cells).toEqual(previousPreview.preview.grid.cells);
        const geometry = (grid: typeof next.preview.grid) => grid.entries.map((entry) => ({
          id: entry.id, number: entry.number, direction: entry.direction, start: entry.start, length: entry.length,
        }));
        expect(geometry(next.preview.grid)).toEqual(geometry(previousPreview.preview.grid));
        expect(next.preview.grid.entries.find((entry) => entry.id === "entry-1")?.clue).toBe("수정한 합성 단서");
      }
      if (mode === "answer") expect(await h.placement.readPreview(sermonId, await h.ticket())).toMatchObject({ code: "PLACEMENT_NOT_FOUND" });
    }
  });

  it("does not overwrite comparison pools or unrelated summary/intent paths", async () => {
    const h = await setup(), old = await h.ticket(), previous = h.snapshot();
    await h.candidate({ kind: "generate", difficulty: "child", binding: await h.binding(), draft: draft() });
    expect((await h.pool()).reviewId).toBe(old.reviewId);
    expect(await h.placement.trial(sermonId, old)).toMatchObject({ code: "PLACEMENT_STALE" });
    expect((await h.placement.readPreview(sermonId, await h.ticket())).outcome).toBe("placement_preview");
    expect(h.snapshot().candidateEvents.slice(0, previous.candidateEvents.length)).toEqual(previous.candidateEvents);
    expect(await h.service.readIntent(sermonId, true)).toMatchObject({ outcome: "intent" });
    expect(await h.service.readSummary(sermonId)).toMatchObject({ outcome: "summary" });
    expect(await h.service.readCandidateClues(sermonId, "child")).toMatchObject({ outcome: "candidate_clues" });
  });

  it("rejects a race during search, corrupted storage and storage exceptions with safe errors", async () => {
    const h = await setup(), ticket = await h.ticket(), original = h.store.read.bind(h.store);
    let reads = 0;
    const race = vi.spyOn(h.store, "read").mockImplementation(async (id) => {
      const state = await original(id) as TranscriptState;
      if (++reads === 2) return null;
      return state;
    });
    expect(await h.placement.trial(sermonId, ticket)).toMatchObject({ outcome: "failed" });
    race.mockRestore();
    const damaged = structuredClone(h.snapshot()) as TranscriptState;
    damaged.candidateEvents[0]!.version = 1;
    h.corrupt(damaged);
    expect(await h.placement.trial(sermonId, ticket)).toEqual({ outcome: "failed", code: "PLACEMENT_INVALID" });
    const broken = vi.spyOn(h.store, "read").mockRejectedValue(new Error(raw));
    expect(await h.placement.trial(sermonId, ticket)).toEqual({ outcome: "failed", code: "PLACEMENT_INVALID" });
    broken.mockRestore();
  });

  it("changes trial options without writes, returns diagnostics and no preview when no layout exists", async () => {
    const h = await setup(), ticket: PlacementTicket = await h.ticket(), before = h.snapshot();
    ticket.options = { ...ticket.options, gridSizes: [5], targetWordCounts: [4], searchBudgetPerTrial: 1 };
    const result = await h.placement.trial(sermonId, ticket);
    expect(result).toMatchObject({ outcome: "placement_trial", trial: { result: { layouts: [], searchIncomplete: true } } });
    expect(await h.placement.readPreview(sermonId, ticket)).toMatchObject({ code: "PLACEMENT_NOT_FOUND" });
    expect(h.snapshot()).toEqual(before);
  });
});
