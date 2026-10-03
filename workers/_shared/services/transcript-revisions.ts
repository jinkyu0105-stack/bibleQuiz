import { hash, textOf, originalContent, verifySource, verifyContent, TranscriptContentError } from "./transcript-content";
export { hash, validText, textOf, originalContent, verifySource, verifyContent } from "./transcript-content";
import { correctionItemDecisions, mergeCorrectionContent, verifyCorrectionHistory, verifyCorrectionProposal } from "./transcript-corrections";
import { appendIntentEvent, verifyIntentHistory, type IntentView } from "./sermon-intent";
import { candidateDifficultySchema, type PublicCandidateClues } from "./sermon-candidates-contract";
import { appendCandidateEvent, projectCandidateClues, verifyCandidateHistory, type CandidatePoolView } from "./sermon-candidates";
import { appendSummaryEvent, projectSummaryPreview, verifySummaryHistory, type SummaryView } from "./sermon-summary";
import {
  privateTranscriptStateSchema, transcriptCommandSchema, transcriptHumanContextSchema,
  transcriptRevisionFailureMessages,
  type DeepReadonly, type PrivateTranscriptState, type TranscriptContent,
  type TranscriptRevisionFailure, type TranscriptRevisionFailureCode,
  type TranscriptRevisionStore, type TranscriptState,
} from "./transcript-revision-contract";

class InvalidTranscript extends Error {
  constructor(readonly code: TranscriptRevisionFailureCode) { super(code); }
}
function reject(code: TranscriptRevisionFailureCode): never { throw new InvalidTranscript(code); }
function failure(error: unknown): TranscriptRevisionFailure {
  const code = error instanceof InvalidTranscript || error instanceof TranscriptContentError ? error.code : "TRANSCRIPT_VALIDATION_FAILED";
  return { outcome: "failed", code, message: transcriptRevisionFailureMessages[code] };
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** Revalidate all checksums and relationships from trusted storage; never repair them. */
async function readState(store: TranscriptRevisionStore, sermonId: string): Promise<TranscriptState | null> {
  const raw = await store.read(sermonId);
  if (raw === null) return null;
  return validateTranscriptState(raw, sermonId);
}

/** Pure full-history validation shared by the service and private storage readers. */
export async function validateTranscriptState(raw: unknown, sermonId: string): Promise<TranscriptState> {
  const parsed = privateTranscriptStateSchema.safeParse(raw);
  if (!parsed.success) reject("TRANSCRIPT_STATE_INVALID");
  const state = parsed.data;
  if (state.sermonId !== sermonId || state.version !== state.revisions.length + state.confirmations.length +
    state.correctionProposals.length + state.correctionDecisions.length + state.intentEvents.length + state.summaryEvents.length + state.candidateEvents.length) {
    reject("TRANSCRIPT_STATE_INVALID");
  }
  const ids = [...state.sources, ...state.revisions, ...state.confirmations, ...state.correctionProposals, ...state.correctionDecisions, ...state.intentEvents, ...state.summaryEvents, ...state.candidateEvents].map((r) => r.id);
  if (new Set(ids).size !== ids.length) reject("TRANSCRIPT_STATE_INVALID");
  for (const [index, source] of state.sources.entries()) {
    if (source.sourceRevision !== index + 1) reject("TRANSCRIPT_STATE_INVALID");
    await verifySource(source.payload);
  }
  const revisions = new Map<string, TranscriptState["revisions"][number]>();
  let sourceIndex = -1;
  let previous: TranscriptState["revisions"][number] | undefined;
  for (const revision of state.revisions) {
    if (revision.kind === "imported") sourceIndex++;
    const source = state.sources[sourceIndex];
    if (!source || revision.sourceId !== source.id) reject("TRANSCRIPT_STATE_INVALID");
    if (revision.kind === "imported") {
      if (revision.parentRevisionId !== null || revision.restoredFromRevisionId !== null ||
        JSON.stringify(revision.content) !== JSON.stringify(originalContent(source.payload))) reject("TRANSCRIPT_STATE_INVALID");
    } else {
      if (!previous || previous.sourceId !== source.id || revision.parentRevisionId !== previous.id) reject("TRANSCRIPT_STATE_INVALID");
      if (revision.kind === "restored") {
        const restored = revisions.get(revision.restoredFromRevisionId ?? "");
        if (!restored || restored.sourceId !== source.id || JSON.stringify(restored.content) !== JSON.stringify(revision.content)) {
          reject("TRANSCRIPT_STATE_INVALID");
        }
      } else if (revision.restoredFromRevisionId !== null) reject("TRANSCRIPT_STATE_INVALID");
    }
    verifyContent(revision.content, source.payload);
    if (await hash(textOf(revision.content)) !== revision.transcriptSha256) reject("TRANSCRIPT_CHECKSUM_MISMATCH");
    revisions.set(revision.id, revision);
    previous = revision;
  }
  if (sourceIndex !== state.sources.length - 1 || state.currentSourceId !== state.sources.at(-1)!.id ||
    state.currentRevisionId !== previous?.id) reject("TRANSCRIPT_STATE_INVALID");
  verifyCorrectionHistory(state, () => reject("TRANSCRIPT_CORRECTION_INVALID"));
  for (const confirmed of state.confirmations) {
    const revision = revisions.get(confirmed.revisionId);
    if (!revision || revision.sourceId !== confirmed.sourceId) reject("TRANSCRIPT_STATE_INVALID");
    if (revision.transcriptSha256 !== confirmed.transcriptSha256) reject("TRANSCRIPT_CHECKSUM_MISMATCH");
  }
  if (state.currentConfirmationId !== null) {
    const current = state.confirmations.at(-1);
    if (!current || current.id !== state.currentConfirmationId || current.sourceId !== state.currentSourceId ||
      current.revisionId !== state.currentRevisionId) reject("TRANSCRIPT_STATE_INVALID");
  }
  verifyIntentHistory(state, () => reject("SERMON_INTENT_INVALID"));
  verifySummaryHistory(state, () => reject("SERMON_SUMMARY_INVALID"));
  verifyCandidateHistory(state, () => reject("SERMON_CANDIDATES_INVALID"));
  return state;
}

type UpdateResult = { outcome: "updated"; state: PrivateTranscriptState } | TranscriptRevisionFailure;
type ConfirmedResult = { outcome: "confirmed"; state: PrivateTranscriptState } | TranscriptRevisionFailure;
type IntentResult = { outcome: "intent"; view: DeepReadonly<IntentView> } | TranscriptRevisionFailure;
type SummaryResult = { outcome: "summary"; view: DeepReadonly<SummaryView> } | TranscriptRevisionFailure;
type CandidatesResult = { outcome: "candidates"; view: DeepReadonly<CandidatePoolView> } | TranscriptRevisionFailure;
type CluesResult = { outcome: "candidate_clues"; preview: DeepReadonly<PublicCandidateClues> } | TranscriptRevisionFailure;
type PreviewResult = { outcome: "summary_preview"; summary: Readonly<{ text: string; disclosure: string }> } | TranscriptRevisionFailure;

/** No default store, routes, DB writes, fetch, AI or logging. Only an explicit trusted port. */
export function createTranscriptRevisionService(store: TranscriptRevisionStore) {
  return {
    async execute(sermonId: string, commandInput: unknown, humanContext: unknown): Promise<UpdateResult> {
      try {
        // Reuse the state identity constraint without coercion, before accessing storage.
        if (typeof sermonId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(sermonId)) reject("INVALID_TRANSCRIPT_REQUEST");
        const context = transcriptHumanContextSchema.safeParse(humanContext);
        if (!context.success) reject("HUMAN_REVIEW_REQUIRED");
        const parsed = transcriptCommandSchema.safeParse(commandInput);
        if (!parsed.success) reject("INVALID_TRANSCRIPT_REQUEST");
        const command = parsed.data;
        const state = await readState(store, sermonId);
        if (command.expectedVersion !== (state?.version ?? 0)) reject("TRANSCRIPT_REVISION_CONFLICT");
        const next: TranscriptState = state ?? {
          contractVersion: 1, sermonId, version: 0, sources: [], revisions: [], confirmations: [],
          correctionProposals: [], correctionDecisions: [], intentEvents: [], summaryEvents: [], candidateEvents: [],
          currentSourceId: "", currentRevisionId: "", currentConfirmationId: null,
        };
        const expectedVersion = state?.version ?? null;
        let content: TranscriptContent;
        let kind: "imported" | "manual_edit" | "restored" | "merged";
        let restoredFromRevisionId: string | null = null;
        let mergedCorrection: TranscriptState["revisions"][number]["mergedCorrection"] = null;
        if (command.action === "import_source") {
          await verifySource(command.payload);
          const source = { id: crypto.randomUUID(), sourceRevision: next.sources.length + 1, payload: command.payload };
          next.sources.push(source);
          next.currentSourceId = source.id;
          content = originalContent(source.payload);
          kind = "imported";
        } else {
          const head = next.revisions.at(-1);
          if (!head || command.sourceId !== next.currentSourceId || command.revisionId !== head.id) {
            reject("TRANSCRIPT_REVISION_CONFLICT");
          }
          if (command.transcriptSha256 !== head.transcriptSha256) reject("TRANSCRIPT_CHECKSUM_MISMATCH");
          if (command.action === "candidates") {
            appendCandidateEvent(next, command.operation, context.data,
              () => reject("SERMON_CANDIDATES_INVALID"), () => reject("TRANSCRIPT_REVISION_CONFLICT"),
              () => reject("SERMON_INTENT_NOT_CONFIRMED"));
            if (!await store.compareAndSwap(sermonId, expectedVersion, freeze(next))) reject("TRANSCRIPT_REVISION_CONFLICT");
            return { outcome: "updated", state: freeze(next) };
          }
          if (command.action === "summary") {
            appendSummaryEvent(next, command.operation, context.data,
              () => reject("SERMON_SUMMARY_INVALID"), () => reject("TRANSCRIPT_REVISION_CONFLICT"),
              () => reject("SERMON_INTENT_NOT_CONFIRMED"));
            if (!await store.compareAndSwap(sermonId, expectedVersion, freeze(next))) reject("TRANSCRIPT_REVISION_CONFLICT");
            return { outcome: "updated", state: freeze(next) };
          }
          if (command.action === "intent") {
            appendIntentEvent(next, command.operation, context.data,
              () => reject("SERMON_INTENT_INVALID"), () => reject("TRANSCRIPT_REVISION_CONFLICT"),
              () => reject("TRANSCRIPT_NOT_CONFIRMED"));
            if (!await store.compareAndSwap(sermonId, expectedVersion, freeze(next))) reject("TRANSCRIPT_REVISION_CONFLICT");
            return { outcome: "updated", state: freeze(next) };
          }
          if (command.action === "propose_corrections") {
            const proposal = {
              ...command.proposal, id: crypto.randomUUID(), registeredVersion: next.version + 1,
              registeredBy: context.data.adminId, registeredAt: context.data.now,
            };
            if (proposal.sourceId !== head.sourceId || proposal.baseRevisionId !== head.id) reject("TRANSCRIPT_REVISION_CONFLICT");
            verifyCorrectionProposal(next, proposal, () => reject("TRANSCRIPT_CORRECTION_INVALID"));
            next.correctionProposals.push(proposal);
            next.version++;
            if (!await store.compareAndSwap(sermonId, expectedVersion, freeze(next))) reject("TRANSCRIPT_REVISION_CONFLICT");
            return { outcome: "updated", state: freeze(next) };
          }
          if (command.action === "decide_corrections" || command.action === "merge_corrections") {
            const proposal = next.correctionProposals.find((p) => p.id === command.proposalId);
            if (!proposal || proposal.sourceId !== head.sourceId || proposal.baseRevisionId !== head.id ||
              proposal.baseTranscriptSha256 !== head.transcriptSha256) reject("TRANSCRIPT_REVISION_CONFLICT");
            if (command.action === "decide_corrections") {
              const pending = new Set(correctionItemDecisions(next, proposal).filter((d) => d.decision === "pending").map((d) => d.itemId));
              for (const decision of command.decisions) {
                if (!pending.delete(decision.itemId)) reject("TRANSCRIPT_CORRECTION_INVALID");
              }
              next.correctionDecisions.push({
                id: crypto.randomUUID(), proposalId: proposal.id, version: next.version + 1,
                decisions: command.decisions, decidedBy: context.data.adminId, decidedAt: context.data.now,
              });
              next.version++;
              if (!await store.compareAndSwap(sermonId, expectedVersion, freeze(next))) reject("TRANSCRIPT_REVISION_CONFLICT");
              return { outcome: "updated", state: freeze(next) };
            }
            content = mergeCorrectionContent(next, proposal, () => reject("TRANSCRIPT_CORRECTION_INVALID"));
            mergedCorrection = { proposalId: proposal.id, decisionVersion: next.version };
            kind = "merged";
          } else if (command.action === "confirm") {
            // Confirm exactly the saved head; no client text or AI result can enter here.
            const confirmed = {
              id: crypto.randomUUID(), sourceId: head.sourceId, revisionId: head.id,
              transcriptSha256: head.transcriptSha256,
              confirmedBy: context.data.adminId, confirmedAt: context.data.now,
            };
            next.confirmations.push(confirmed);
            next.currentConfirmationId = confirmed.id;
            next.version++;
            if (!await store.compareAndSwap(sermonId, expectedVersion, freeze(next))) reject("TRANSCRIPT_REVISION_CONFLICT");
            return { outcome: "updated", state: freeze(next) };
          } else if (command.action === "restore") {
            const restored = next.revisions.find((r) => r.id === command.restoreRevisionId && r.sourceId === head.sourceId);
            if (!restored) reject("TRANSCRIPT_REVISION_CONFLICT");
            content = structuredClone(restored.content);
            restoredFromRevisionId = restored.id;
            kind = "restored";
          } else {
            content = command.content;
            kind = "manual_edit";
          }
        }
        verifyContent(content, next.sources.at(-1)!.payload);
        const revision = {
          id: crypto.randomUUID(), sourceId: next.currentSourceId,
          parentRevisionId: kind === "imported" ? null : next.currentRevisionId,
          kind, restoredFromRevisionId, mergedCorrection, content,
          checksumFormat: "sha256:utf8-working-text:v1" as const,
          transcriptSha256: await hash(textOf(content)),
          createdBy: context.data.adminId, createdAt: context.data.now,
        };
        next.revisions.push(revision);
        next.currentRevisionId = revision.id;
        next.currentConfirmationId = null;
        next.version++;
        if (!await store.compareAndSwap(sermonId, expectedVersion, freeze(next))) reject("TRANSCRIPT_REVISION_CONFLICT");
        return { outcome: "updated", state: freeze(next) };
      } catch (error) { return failure(error); }
    },

    /** Check against authoritative CURRENT state, never a historical confirmed snapshot.
     * This is a private eligibility check, not authentication or permission to call AI.
     * Future analysis/publish commits must CAS the returned version again.
     */
    async readConfirmed(sermonId: string): Promise<ConfirmedResult> {
      try {
        if (typeof sermonId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(sermonId)) reject("INVALID_TRANSCRIPT_REQUEST");
        const state = await readState(store, sermonId);
        if (!state || state.currentConfirmationId === null) reject("TRANSCRIPT_NOT_CONFIRMED");
        return { outcome: "confirmed", state: freeze(state) };
      } catch (error) { return failure(error); }
    },

    /** Private per-difficulty view. Review does not authorize placement or publishing. */
    async readCandidates(sermonId: string, difficultyInput: unknown, requireReviewed = false): Promise<CandidatesResult> {
      try {
        if (typeof sermonId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(sermonId)) reject("INVALID_TRANSCRIPT_REQUEST");
        const difficulty = candidateDifficultySchema.safeParse(difficultyInput);
        if (!difficulty.success) reject("INVALID_TRANSCRIPT_REQUEST");
        const state = await readState(store, sermonId);
        const view: CandidatePoolView = state ? verifyCandidateHistory(state, () => reject("SERMON_CANDIDATES_INVALID"))[difficulty.data]
          : { status: "absent", version: 0, difficulty: difficulty.data, current: null, reviewId: null };
        if (requireReviewed && view.status !== "reviewed") reject("SERMON_CANDIDATES_NOT_REVIEWED");
        return { outcome: "candidates", view: freeze(view) };
      } catch (error) { return failure(error); }
    },

    /** Re-read storage and project only reviewed current clues. No public route attached. */
    async readCandidateClues(sermonId: string, difficultyInput: unknown): Promise<CluesResult> {
      try {
        if (typeof sermonId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(sermonId)) reject("INVALID_TRANSCRIPT_REQUEST");
        const difficulty = candidateDifficultySchema.safeParse(difficultyInput);
        if (!difficulty.success) reject("INVALID_TRANSCRIPT_REQUEST");
        const state = await readState(store, sermonId);
        if (!state) reject("SERMON_CANDIDATES_NOT_REVIEWED");
        const view = verifyCandidateHistory(state, () => reject("SERMON_CANDIDATES_INVALID"))[difficulty.data];
        return { outcome: "candidate_clues", preview: freeze(projectCandidateClues(view,
          () => reject("SERMON_CANDIDATES_NOT_REVIEWED"))) };
      } catch (error) { return failure(error); }
    },

    /** Private summary view; review eligibility is not final audit or publishing authorization. */
    async readSummary(sermonId: string, requireReviewed = false): Promise<SummaryResult> {
      try {
        if (typeof sermonId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(sermonId)) reject("INVALID_TRANSCRIPT_REQUEST");
        const state = await readState(store, sermonId);
        const view: SummaryView = state ? verifySummaryHistory(state, () => reject("SERMON_SUMMARY_INVALID"))
          : { status: "absent", version: 0, current: null, reviewId: null };
        if (requireReviewed && view.status !== "reviewed") reject("SERMON_SUMMARY_NOT_REVIEWED");
        return { outcome: "summary", view: freeze(view) };
      } catch (error) { return failure(error); }
    },

    /** Same public text/disclosure shape for a future admin preview, with no route attached.
     * Always re-read authoritative input. A future publish commit must CAS its own version again.
     */
    async readSummaryPreview(sermonId: string, requireReviewed = false): Promise<PreviewResult> {
      try {
        if (typeof sermonId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(sermonId)) reject("INVALID_TRANSCRIPT_REQUEST");
        const state = await readState(store, sermonId);
        if (!state) reject("SERMON_SUMMARY_NOT_REVIEWED");
        const view = verifySummaryHistory(state, () => reject("SERMON_SUMMARY_INVALID"));
        if (view.status === "absent" || view.status === "needs_review" || (requireReviewed && view.status !== "reviewed")) {
          reject("SERMON_SUMMARY_NOT_REVIEWED");
        }
        return { outcome: "summary_preview", summary: freeze(projectSummaryPreview(state, view,
          () => reject("SERMON_SUMMARY_INVALID"), () => reject("SERMON_SUMMARY_DISCLOSURE_UNSUPPORTED"))) };
      } catch (error) { return failure(error); }
    },

    /** Private review/eligibility view. A downstream commit must compare this version
     * atomically again. This method neither generates content nor authorizes publishing.
     */
    async readIntent(sermonId: string, requireConfirmed = false): Promise<IntentResult> {
      try {
        if (typeof sermonId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(sermonId)) reject("INVALID_TRANSCRIPT_REQUEST");
        const state = await readState(store, sermonId);
        const view: IntentView = state ? verifyIntentHistory(state, () => reject("SERMON_INTENT_INVALID"))
          : { status: "absent", version: 0, current: null, confirmationId: null, unresolvedClaimIds: [] };
        if (requireConfirmed && view.status !== "confirmed") reject("SERMON_INTENT_NOT_CONFIRMED");
        return { outcome: "intent", view: freeze(view) };
      } catch (error) { return failure(error); }
    },
  };
}

/** Only safe fixed diagnostics may leave the private contract. */
export function transcriptRevisionDiagnosticForCopy(result: UpdateResult | ConfirmedResult | IntentResult | SummaryResult | PreviewResult | CandidatesResult | CluesResult) {
  if (result.outcome !== "failed") return { outcome: result.outcome };
  const code = Object.hasOwn(transcriptRevisionFailureMessages, result.code) ? result.code : "TRANSCRIPT_VALIDATION_FAILED";
  return { outcome: "failed" as const, code, message: transcriptRevisionFailureMessages[code] };
}
