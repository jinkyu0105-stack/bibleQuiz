import { publicPuzzleGridSchema } from "../../../shared/api/public-quiz";
import { validateLayout } from "../../../shared/puzzle/layout";
import { serializePublicPuzzle } from "../../../shared/puzzle/serialization";
import { createCandidatePlacementService, placementTicketFromCandidates } from "./candidate-placement";
import { finalCheckPreviewSchema, finalCheckSelectionSchema, finalCheckTicketSchema,
  type FinalCheckSelection } from "./final-check-contract";
import {
  finalCheckMetadataSnapshotSchema,
  finalCheckPublicMetadataSchema,
  type FinalCheckMetadataSnapshot,
  type FinalCheckMetadataStore,
} from "./final-check-metadata-contract";
import { summaryBindingFromIntent } from "./sermon-summary";
import { validateScoringSource } from "./submission-scoring";
import type { DeepReadonly, PrivateTranscriptState, TranscriptRevisionStore } from "./transcript-revision-contract";
import { createTranscriptRevisionService } from "./transcript-revisions";

type ErrorCode = "FINAL_CHECK_INVALID" | "FINAL_CHECK_NOT_READY" | "FINAL_CHECK_STALE" |
  "FINAL_CHECK_LAYOUT_UNAVAILABLE" | "FINAL_CHECK_DISCLOSURE_UNSUPPORTED";
class FinalCheckError extends Error { constructor(readonly code: ErrorCode) { super(code); } }
function reject(code: ErrorCode): never { throw new FinalCheckError(code); }
function failure(error: unknown) {
  return { outcome: "failed" as const, code: error instanceof FinalCheckError ? error.code : "FINAL_CHECK_INVALID" as const };
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = Object.entries(a), right = Object.entries(b);
  return left.length === right.length && left.every(([key, value]) => Object.hasOwn(b, key) &&
    equal(value, (b as Record<string, unknown>)[key]));
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value as DeepReadonly<T>;
}

/** Read-only composition over the existing contracts. No cache, writes, routes or AI calls.
 * All component reads use one validated snapshot; authoritative storage is checked again last.
 * Future persistence/publishing still needs atomic version CAS at its own write boundary.
 */
export function createFinalCheckService(
  store: TranscriptRevisionStore,
  metadataStore: FinalCheckMetadataStore,
) {
  const live = createTranscriptRevisionService(store);
  async function snapshot(sermonId: string) {
    const read = await live.readConfirmed(sermonId);
    if (read.outcome !== "confirmed") reject(read.code === "TRANSCRIPT_NOT_CONFIRMED" ? "FINAL_CHECK_NOT_READY" : "FINAL_CHECK_INVALID");
    return read.state;
  }
  async function metadataSnapshot(sermonId: string) {
    const raw = await metadataStore.read(sermonId);
    if (raw === null) reject("FINAL_CHECK_NOT_READY");
    const parsed = finalCheckMetadataSnapshotSchema.safeParse(raw);
    if (!parsed.success || parsed.data.sermonId !== sermonId) {
      reject("FINAL_CHECK_INVALID");
    }
    return parsed.data;
  }
  function pinned(state: PrivateTranscriptState): TranscriptRevisionStore {
    return {
      async read() { return structuredClone(state); },
      async compareAndSwap() { return reject("FINAL_CHECK_INVALID"); },
    };
  }
  async function unchanged(
    sermonId: string,
    state: PrivateTranscriptState,
    metadata: FinalCheckMetadataSnapshot,
  ) {
    const read = await live.readConfirmed(sermonId);
    const currentMetadata = await metadataSnapshot(sermonId);
    if (read.outcome !== "confirmed" || !equal(read.state, state) ||
      !equal(currentMetadata, metadata)) reject("FINAL_CHECK_STALE");
  }
  async function references(
    sermonId: string,
    state: PrivateTranscriptState,
    metadata: FinalCheckMetadataSnapshot,
    selections: FinalCheckSelection,
  ) {
    const revisions = createTranscriptRevisionService(pinned(state));
    const intent = await revisions.readIntent(sermonId, true);
    const summary = await revisions.readSummary(sermonId, true);
    const child = await revisions.readCandidates(sermonId, "child", true);
    const adult = await revisions.readCandidates(sermonId, "adult", true);
    if (intent.outcome !== "intent" || summary.outcome !== "summary" || child.outcome !== "candidates" ||
      adult.outcome !== "candidates" || !summary.view.current || !summary.view.reviewId) reject("FINAL_CHECK_NOT_READY");
    const ticket = finalCheckTicketSchema.parse({ sermonId, expectedVersion: state.version, metadata,
      binding: summaryBindingFromIntent(intent.view),
      summary: { summaryId: summary.view.current.id, reviewId: summary.view.reviewId, binding: summary.view.current.binding },
      placements: {
        child: { ticket: placementTicketFromCandidates(sermonId, child.view, selections.child.options), index: selections.child.index },
        adult: { ticket: placementTicketFromCandidates(sermonId, adult.view, selections.adult.options), index: selections.adult.index },
      },
    });
    return { ticket, intent: intent.view, summary: summary.view };
  }
  async function run(sermonId: string, input: unknown) {
    const parsed = finalCheckTicketSchema.safeParse(input);
    if (!parsed.success || parsed.data.sermonId !== sermonId) reject("FINAL_CHECK_INVALID");
    const ticket = parsed.data, state = await snapshot(sermonId);
    const metadata = await metadataSnapshot(sermonId);
    if (state.version !== ticket.expectedVersion) reject("FINAL_CHECK_STALE");
    if (!equal(ticket.metadata, metadata)) reject("FINAL_CHECK_STALE");
    const current = await references(sermonId, state, metadata, {
      child: { options: ticket.placements.child.ticket.options, index: ticket.placements.child.index },
      adult: { options: ticket.placements.adult.ticket.options, index: ticket.placements.adult.index },
    });
    if (!equal(ticket, current.ticket)) reject("FINAL_CHECK_STALE");
    const source = pinned(state);
    const summary = await createTranscriptRevisionService(source).readSummaryPreview(sermonId, true);
    if (summary.outcome !== "summary_preview") reject(summary.code === "SERMON_SUMMARY_DISCLOSURE_UNSUPPORTED"
      ? "FINAL_CHECK_DISCLOSURE_UNSUPPORTED" : "FINAL_CHECK_INVALID");
    const placement = createCandidatePlacementService(source);
    async function variant(difficulty: "child" | "adult") {
      const ref = ticket.placements[difficulty];
      const result = await placement.trial(sermonId, ref.ticket);
      if (result.outcome !== "placement_trial") reject("FINAL_CHECK_INVALID");
      const layout = result.trial.result.layouts[ref.index];
      if (!layout) reject("FINAL_CHECK_LAYOUT_UNAVAILABLE");
      const puzzle = layout.puzzle;
      // Recompute independent hard gates; never trust a stored/generated publishable flag.
      const report = validateLayout(puzzle.gridSize, puzzle.entries);
      if (!report.publishable || !ref.ticket.options.gridSizes.includes(puzzle.gridSize) ||
        !ref.ticket.options.targetWordCounts.includes(puzzle.entries.length) ||
        layout.targetWordCount !== puzzle.entries.length) reject("FINAL_CHECK_INVALID");
      const grid = publicPuzzleGridSchema.parse(serializePublicPuzzle(puzzle));
      validateScoringSource({ grid, solution: puzzle.solution, canonicalCellOrder: grid.cells.map((cell) => cell.id) });
      const selected = result.trial.provenance.filter((p) => puzzle.entries.some((e) => e.entryId === p.entryId));
      if (selected.length !== puzzle.entries.length || result.trial.provenance.some((p) =>
        (p.status === "locked" && !selected.includes(p)) || (p.status === "excluded" && selected.includes(p)))) reject("FINAL_CHECK_INVALID");
      for (const entry of puzzle.entries) {
        const candidate = selected.find((p) => p.entryId === entry.entryId)!.candidate;
        if (entry.gridAnswer !== candidate.gridAnswer || entry.displayAnswer !== candidate.displayAnswer ||
          entry.clue !== candidate.clue || puzzle.solution.entries[entry.entryId] !== candidate.gridAnswer) reject("FINAL_CHECK_INVALID");
      }
      return { grid, privateData: { solution: puzzle.solution, report, provenance: selected,
        omittedEntryIds: result.trial.provenance.filter((p) => !selected.includes(p)).map((p) => p.entryId),
        searchIncomplete: result.trial.result.searchIncomplete } };
    }
    const child = await variant("child"), adult = await variant("adult");
    const preview = finalCheckPreviewSchema.parse({
      metadata: finalCheckPublicMetadataSchema.parse({
        title: metadata.title,
        date: metadata.sermonDate,
        bibleReferenceLabel: metadata.bibleReference.canonicalLabel,
        translation: metadata.bibleReference.translation,
        bibleReadingUrl: metadata.bibleReference.readingPortalUrl,
      }),
      summary: summary.summary,
      variants: { child: child.grid, adult: adult.grid },
    });
    await unchanged(sermonId, state, metadata);
    return freeze({ ticket, preview, privateData: { intent: current.intent, summary: current.summary,
      metadata, variants: { child: child.privateData, adult: adult.privateData } } });
  }
  return {
    /** Captures current references and metadata. The caller must still run check/readPreview. */
    async capture(sermonId: string, input: unknown) {
      try {
        const selections = finalCheckSelectionSchema.parse(input), state = await snapshot(sermonId);
        const metadata = await metadataSnapshot(sermonId);
        const { ticket } = await references(sermonId, state, metadata, selections);
        await unchanged(sermonId, state, metadata);
        return { outcome: "final_check_ticket" as const, ticket: freeze(ticket) };
      } catch (error) { return failure(error); }
    },
    /** Entire result is private. input_validated means this contract only, never publish approval. */
    async check(sermonId: string, input: unknown) {
      try { return { outcome: "input_validated" as const, result: await run(sermonId, input) }; }
      catch (error) { return failure(error); }
    },
    /** Revalidates current storage and reproduces grids; never accepts an old check result. */
    async readPreview(sermonId: string, input: unknown) {
      try { return { outcome: "final_check_preview" as const, preview: (await run(sermonId, input)).preview }; }
      catch (error) { return failure(error); }
    },
  };
}
