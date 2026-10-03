import { placementOptionsSchema } from "../../../shared/api/placement-options";
export { placementOptionsSchema } from "../../../shared/api/placement-options";
import { z } from "zod";

import { publicPuzzleGridSchema } from "../../../shared/api/public-quiz";
import { searchCandidatePool } from "../../../shared/puzzle/pool-search";
import { serializePublicPuzzle } from "../../../shared/puzzle/serialization";
import { candidateBindingSchema, candidateDifficultySchema } from "./sermon-candidates-contract";
import type { CandidatePoolView } from "./sermon-candidates";
import type { DeepReadonly, TranscriptRevisionStore } from "./transcript-revision-contract";
import { createTranscriptRevisionService } from "./transcript-revisions";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
export const placementTicketSchema = z.strictObject({
  sermonId: id, difficulty: candidateDifficultySchema, expectedVersion: z.int().positive(),
  poolId: id, reviewId: id, binding: candidateBindingSchema, options: placementOptionsSchema,
});
export type PlacementTicket = z.infer<typeof placementTicketSchema>;
const publicPlacementSchema = z.strictObject({ difficulty: candidateDifficultySchema, grid: publicPuzzleGridSchema });

type ErrorCode = "PLACEMENT_INVALID" | "PLACEMENT_NOT_REVIEWED" | "PLACEMENT_STALE" | "PLACEMENT_NOT_FOUND";
class PlacementError extends Error { constructor(readonly code: ErrorCode) { super(code); } }
function reject(code: ErrorCode): never { throw new PlacementError(code); }
function failure(error: unknown) {
  return { outcome: "failed" as const, code: error instanceof PlacementError ? error.code : "PLACEMENT_INVALID" as const };
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value as DeepReadonly<T>;
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = Object.entries(a), right = Object.entries(b);
  return left.length === right.length && left.every(([key, value]) => Object.hasOwn(b, key) && equal(value, (b as Record<string, unknown>)[key]));
}
/** Server captures a ticket from a validated current readCandidates(..., true) before the trial.
 * This is a private input reference, never a human approval or a public DTO.
 */
export function placementTicketFromCandidates(sermonId: string, view: DeepReadonly<CandidatePoolView>, options: unknown): PlacementTicket | null {
  if (view.status !== "reviewed" || !view.current || !view.reviewId) return null;
  const result = placementTicketSchema.safeParse({ sermonId, difficulty: view.difficulty,
    expectedVersion: view.version, poolId: view.current.id, reviewId: view.reviewId,
    binding: view.current.binding, options });
  return result.success ? result.data : null;
}

/** No writes, network, AI, route or publishing. Every use checks current authoritative history.
 * A future persistence/publish adapter must CAS the returned version at its own commit boundary.
 */
export function createCandidatePlacementService(store: TranscriptRevisionStore) {
  const revisions = createTranscriptRevisionService(store);
  async function current(ticket: PlacementTicket) {
    const read = await revisions.readCandidates(ticket.sermonId, ticket.difficulty, true);
    if (read.outcome !== "candidates") {
      reject(read.code === "SERMON_CANDIDATES_NOT_REVIEWED" ? "PLACEMENT_NOT_REVIEWED" : "PLACEMENT_INVALID");
    }
    const view = read.view;
    if (view.version !== ticket.expectedVersion || view.current?.id !== ticket.poolId ||
      view.reviewId !== ticket.reviewId || !equal(view.current.binding, ticket.binding)) reject("PLACEMENT_STALE");
    return view.current;
  }
  async function run(sermonId: string, input: unknown) {
    const parsed = placementTicketSchema.safeParse(input);
    if (!parsed.success || parsed.data.sermonId !== sermonId) reject("PLACEMENT_INVALID");
    const ticket = parsed.data;
    const pool = await current(ticket);
    // Candidate IDs are private and caller-controlled. Public entry IDs are generated here;
    // solution.entries and public geometry use the same safe IDs.
    const provenance = [...pool.draft.candidates].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map((candidate, i) => ({ entryId: `entry-${i + 1}`, candidate, status: pool.statuses[candidate.id]! }));
    const result = searchCandidatePool({ ...ticket.options, candidates: provenance.map(({ entryId, candidate, status }) => ({
      id: entryId, displayAnswer: candidate.displayAnswer, gridAnswer: candidate.gridAnswer, clue: candidate.clue, status,
    })) });
    // Search is read-only; catch an edit between the first read and result delivery.
    await current(ticket);
    return freeze({ ticket, result, provenance });
  }
  return {
    async trial(sermonId: string, input: unknown) {
      try { return { outcome: "placement_trial" as const, trial: await run(sermonId, input) }; }
      catch (error) { return failure(error); }
    },
    /** Reproduce from a current ticket, never accept supplied coordinates, answers or reports.
     * No layout cache/storage exists yet. Index 0 is the recommended actual layout.
     */
    async readPreview(sermonId: string, input: unknown, index: unknown = 0) {
      try {
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 2) reject("PLACEMENT_INVALID");
        const trial = await run(sermonId, input);
        const layout = trial.result.layouts[index];
        if (!layout) reject("PLACEMENT_NOT_FOUND");
        const preview = publicPlacementSchema.parse({ difficulty: trial.ticket.difficulty, grid: serializePublicPuzzle(layout.puzzle) });
        return { outcome: "placement_preview" as const, preview: freeze(preview) };
      } catch (error) { return failure(error); }
    },
  };
}
