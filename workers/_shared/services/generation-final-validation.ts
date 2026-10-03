import { readTogether } from "../repositories/generation-read-session";
import { assertContentQualityUsable } from "./content-quality-review";
import { presentPlacement } from "./placement-presentation";
import type { AdminPlacementLayout } from "../../../shared/api/admin-placement";
import { publicPuzzleGridSchema } from "../../../shared/api/public-quiz";
import { validateLayout } from "../../../shared/puzzle/layout";
import { searchCandidatePool } from "../../../shared/puzzle/pool-search";
import { serializePublicPuzzle } from "../../../shared/puzzle/serialization";
import { createDatabase } from "../db/client";
import { createHumanContentRuntimeStore } from "../repositories/human-content-runtime-store";
import { createSermonInputStore } from "../repositories/sermon-input-store";
import { createSermonMetadataRepository } from "../repositories/sermon-metadata-repository";
import { sameLifecycleValue as same } from "./generation-context-codec";
import { domainSnapshotSchema, domainPreparedSchema, type DomainSnapshot } from "./generation-domain-contract";
import { finalCheckPreviewSchema, finalCheckTicketSchema, type FinalCheckTicket } from "./final-check-contract";
import { sameTranscript } from "./sermon-intent";
import { validateScoringSource } from "./submission-scoring";
import { transcriptSourcePayloadSchema } from "./transcript-input-contract";

/** Rechecks the current D1 content and reproduces both grids from reviewed
 * candidate snapshots. This reads only current references and makes no AI call. */
export async function validateCurrentGenerationFinal(db: D1Database, raw: unknown) {
  const parsed = finalCheckTicketSchema.safeParse(raw);
  if (!parsed.success) return { outcome: "not_ready" as const };
  const ticket: FinalCheckTicket = parsed.data;
  try {
    const runtime = createHumanContentRuntimeStore(db);
    const current = await runtime.readCurrent(ticket.sermonId);
    if (!current || current.status !== "current" ||
      current.input.version + current.current.eventCount !== ticket.expectedVersion ||
      current.current.intentConfirmationEventId !== ticket.binding.intentConfirmationId ||
      current.current.selectedAnalysisEventId !== ticket.binding.analysisId ||
      current.current.summarySnapshotEventId !== ticket.summary.summaryId ||
      current.current.summaryReviewEventId !== ticket.summary.reviewId ||
      current.current.childPoolEventId !== ticket.placements.child.ticket.poolId ||
      current.current.childReviewEventId !== ticket.placements.child.ticket.reviewId ||
      current.current.adultPoolEventId !== ticket.placements.adult.ticket.poolId ||
      current.current.adultReviewEventId !== ticket.placements.adult.ticket.reviewId) return { outcome: "not_ready" as const };
    const inputStore = createSermonInputStore(db);
    const [, metadata, sourceRecord] = await readTogether([
      assertContentQualityUsable(db, ticket.sermonId, [ticket.binding.analysisId, ticket.summary.summaryId,
        ticket.placements.child.ticket.poolId, ticket.placements.adult.ticket.poolId]),
      createSermonMetadataRepository(createDatabase(db)).read(ticket.sermonId),
      inputStore.event(ticket.sermonId, current.input.sourceId),
    ]);
    if (!metadata || !same(metadata, ticket.metadata) || !sourceRecord || sourceRecord.kind !== "source" || sourceRecord.state !== "sealed") return { outcome: "not_ready" as const };
    const source = transcriptSourcePayloadSchema.parse(await inputStore.payload(sourceRecord));
    const publicCaption = source.sourceMode === "public_unofficial" ||
      source.sourceMode === "manual_paste" && source.manualSourceKind === "youtube_visible_transcript" &&
      source.sourceCoverage === "full_transcript";
    const suppliedNotes = source.sourceMode === "sermon_notes";
    if (!publicCaption && !suppliedNotes) return { outcome: "not_ready" as const };
    const event = (id: string) => current.events.find((value) => value.eventId === id);
    const snapshot = (id: string) => {
      const record = event(id);
      if (!record) return null;
      const rawValue = record.origin === "human" && typeof record.payload === "object" && record.payload !== null &&
        "materializedSnapshot" in record.payload ? record.payload.materializedSnapshot : record.payload;
      const prepared = domainPreparedSchema.safeParse(rawValue);
      const value = domainSnapshotSchema.safeParse(prepared.success ? prepared.data.materializedSnapshot : rawValue);
      return value.success && value.data.value.id === id ? value.data : null;
    };
    const displayed = await presentGenerationFinal(ticket, snapshot, publicCaption);
    if (displayed.outcome !== "passed") return displayed;
    const [again, latestMetadata] = await readTogether([runtime.readCurrent(ticket.sermonId), createSermonMetadataRepository(createDatabase(db)).read(ticket.sermonId)]);
    if (!again || again.status !== "current" || !same(again.current, current.current) || !same(again.input, current.input) ||
      !same(latestMetadata, metadata)) {
      return { outcome: "not_ready" as const };
    }
    return displayed;
  } catch { return { outcome: "not_ready" as const }; }
}

/** Pure presentation from an already checked ticket and snapshots. It does not
 * read authority or permit publication; commands use validateCurrentGenerationFinal. */
type PresentationSnapshot = { [K in DomainSnapshot["kind"]]: Pick<Extract<DomainSnapshot, { kind: K }>, "kind" | "value"> }[DomainSnapshot["kind"]];
export async function presentGenerationFinalPart(ticket: FinalCheckTicket, snapshot: (id: string) => PresentationSnapshot | null, publicCaption: boolean, difficulty: "child" | "adult") {
  const metadata = ticket.metadata;
  const summary = snapshot(ticket.summary.summaryId);
  const sameBinding = (binding: typeof ticket.binding) => sameTranscript(binding.transcript, ticket.binding.transcript) &&
    binding.analysisId === ticket.binding.analysisId && binding.intentConfirmationId === ticket.binding.intentConfirmationId;
  if (!summary || summary.kind !== "summary" || !sameBinding(summary.value.binding) ||
    !sameBinding(ticket.summary.binding)) return { outcome: "not_ready" as const };
  const disclosure = publicCaption
    ? "아래 내용은 설교 영상의 공개 자막을 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다." as const
    : "아래 내용은 관리자가 제공한 설교 자료를 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다." as const;
  const summaryText = summary.value.draft.paragraphs.map((paragraph) => paragraph.text).join("\n\n");
  const layouts: Partial<Record<"child" | "adult", AdminPlacementLayout>> = {};
  async function variant(difficulty: "child" | "adult") {
    const selection = ticket.placements[difficulty];
    const chosen = snapshot(selection.ticket.poolId);
    if (!chosen || chosen.kind !== "candidate" || chosen.value.difficulty !== difficulty ||
      !sameBinding(chosen.value.binding) || !sameBinding(selection.ticket.binding)) return null;
    const candidates = [...chosen.value.draft.candidates].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map((candidate, index) => ({ id: `entry-${index + 1}`, displayAnswer: candidate.displayAnswer,
        gridAnswer: candidate.gridAnswer, clue: candidate.clue, phrase: candidate.phraseDescription, status: chosen.value.statuses[candidate.id] }));
    if (candidates.some((candidate) => !candidate.status)) return null;
    const trial = searchCandidatePool({ ...selection.ticket.options, candidates: candidates as Parameters<typeof searchCandidatePool>[0]["candidates"] });
    const layout = trial.layouts[selection.index];
    if (!layout || !selection.ticket.options.gridSizes.includes(layout.puzzle.gridSize) ||
      !selection.ticket.options.targetWordCounts.includes(layout.puzzle.entries.length) ||
      layout.targetWordCount !== layout.puzzle.entries.length ||
      !validateLayout(layout.puzzle.gridSize, layout.puzzle.entries).publishable) return null;
    const grid = publicPuzzleGridSchema.parse(serializePublicPuzzle(layout.puzzle));
    validateScoringSource({ grid, solution: layout.puzzle.solution, canonicalCellOrder: grid.cells.map((cell) => cell.id) });
    const placed = new Set(layout.puzzle.entries.map((entry) => entry.entryId));
    if (candidates.filter((candidate) => placed.has(candidate.id)).length !== layout.puzzle.entries.length ||
      candidates.some((candidate) => candidate.status === "locked" && !placed.has(candidate.id) ||
      candidate.status === "excluded" && placed.has(candidate.id))) return null;
    for (const entry of layout.puzzle.entries) {
      const candidate = candidates.find((item) => item.id === entry.entryId);
      if (!candidate || entry.displayAnswer !== candidate.displayAnswer || entry.gridAnswer !== candidate.gridAnswer ||
        entry.clue !== candidate.clue || layout.puzzle.solution.entries[entry.entryId] !== candidate.gridAnswer) return null;
    }
    layouts[difficulty] = presentPlacement(layout, selection.index, candidates);
    return grid;
  }
  const grid = await variant(difficulty), layout = layouts[difficulty];
  if (!grid || !layout) return { outcome: "not_ready" as const };
  return { outcome: "passed" as const, layout, preview: {
    metadata: { title: metadata.title, date: metadata.sermonDate,
      bibleReferenceLabel: metadata.bibleReference.canonicalLabel,
      translation: metadata.bibleReference.translation, bibleReadingUrl: metadata.bibleReference.readingPortalUrl },
    summary: { text: summaryText, disclosure },
  } };
}

/** Commands validate both variants; display preparation can run one per step. */
export async function presentGenerationFinal(ticket: FinalCheckTicket, snapshot: (id: string) => DomainSnapshot | null, publicCaption: boolean) {
  const child = await presentGenerationFinalPart(ticket, snapshot, publicCaption, "child");
  const adult = await presentGenerationFinalPart(ticket, snapshot, publicCaption, "adult");
  if (child.outcome !== "passed" || adult.outcome !== "passed") return { outcome: "not_ready" as const };
  return { outcome: "passed" as const, preview: finalCheckPreviewSchema.parse({ ...child.preview,
    variants: { child: child.layout.grid, adult: adult.layout.grid } }), layouts: { child: child.layout, adult: adult.layout } };
}
