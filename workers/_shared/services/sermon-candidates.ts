import { validateAndNormalizeAnswer } from "../../../shared/puzzle/hangul";
import { MAX_GRID_SIZE } from "../../../shared/puzzle/types";
import { intentSelectionAtVersion, sameTranscript, verifyIntentHistory, type IntentView } from "./sermon-intent";
import { summaryBindingFromIntent, verifySummaryDraftBasis, type ConfirmedIntentBasis } from "./sermon-summary";
import { publicCandidateCluesSchema, type CandidateBinding, type CandidateDifficulty, type CandidateEvent,
  type CandidateOperation, type CandidateStatus, type SermonCandidateDraft } from "./sermon-candidates-contract";
import type { DeepReadonly, TranscriptContent, TranscriptHumanContext, TranscriptState } from "./transcript-revision-contract";

type State = DeepReadonly<TranscriptState>;
type Binding = DeepReadonly<CandidateBinding>;
type Draft = DeepReadonly<SermonCandidateDraft>;
type Reject = () => never;
export type CandidateRevision = {
  id: string; kind: "generate" | "edit" | "restore" | "set_status"; difficulty: CandidateDifficulty;
  binding: Binding; draft: Draft; statuses: Readonly<Record<string, CandidateStatus>>;
  restoredFromPoolId: string | null; evidenceReviewIds: string[];
};
export type CandidatePoolView = {
  status: "absent" | "needs_review" | "awaiting_review" | "reviewed";
  version: number; difficulty: CandidateDifficulty; current: CandidateRevision | null; reviewId: string | null;
};
/** Capture the authoritative readIntent(..., true) result BEFORE external work. */
export function candidateBindingFromIntent(view: DeepReadonly<IntentView>): CandidateBinding | null {
  return summaryBindingFromIntent(view);
}
function sameInput(a: Binding, b: Binding) {
  return sameTranscript(a.transcript, b.transcript) && a.analysisId === b.analysisId &&
    a.intentConfirmationId === b.intentConfirmationId;
}
function clueKey(clue: string) { return clue.normalize("NFC").replace(/\s/gu, ""); }
function verifyDraft(state: State, binding: Binding, draft: Draft, beforeVersion: number, human: boolean, reject: Reject) {
  const content = state.revisions.find((r) => r.id === binding.transcript.revisionId)?.content;
  if (!content) return reject();
  verifyCandidateDraftBasis(content, intentSelectionAtVersion(state, beforeVersion, reject), binding, draft, beforeVersion, human, reject);
}
export function verifyCandidateDraftBasis(content: DeepReadonly<TranscriptContent>, selection: ConfirmedIntentBasis,
  binding: Binding, draft: Draft, beforeVersion: number, human: boolean, reject: Reject) {
  const ids = new Set<string>(); const answers = new Set<string>(); const clues = new Set<string>();
  for (const candidate of draft.candidates) {
    const answer = validateAndNormalizeAnswer(candidate, MAX_GRID_SIZE);
    // The old engine's normalization remains unchanged. Store the display's original spacing,
    // but require the supplied grid to already be canonical NFC; never strip particles.
    if (!answer.ok || candidate.gridAnswer !== answer.value.gridAnswer || ids.has(candidate.id) ||
      answers.has(candidate.gridAnswer) || clues.has(clueKey(candidate.clue))) reject();
    ids.add(candidate.id); answers.add(candidate.gridAnswer); clues.add(clueKey(candidate.clue));
    if (!human && candidate.grounding.origin === "admin_context") reject();
  }
  // Same confirmed intent/quote rules as P5-10. Empty transcript paragraphs are intentional
  // for a fully human-grounded pool; binding is still checked against confirmed intent.
  verifySummaryDraftBasis(content, selection, binding, { paragraphs: draft.candidates.flatMap((candidate) =>
    candidate.grounding.origin === "transcript" ? [{ id: candidate.id, text: candidate.clue,
      intentClaimIds: candidate.grounding.intentClaimIds, evidence: candidate.grounding.evidence }] : []) }, beforeVersion, reject);
}
function pending(revision: Pick<CandidateRevision, "draft" | "statuses">) {
  return revision.draft.candidates.filter((c) => revision.statuses[c.id] !== "excluded").map((c) => c.id);
}
export function verifyDistinctClues(a: Pick<CandidateRevision, "binding" | "draft" | "statuses"> | null, b: Pick<CandidateRevision, "binding" | "draft" | "statuses"> | null, reject: Reject) {
  if (!a || !b || !sameInput(a.binding, b.binding)) return;
  const clues = new Set(a.draft.candidates.filter((c) => a.statuses[c.id] !== "excluded").map((c) => clueKey(c.clue)));
  if (b.draft.candidates.some((c) => b.statuses[c.id] !== "excluded" && clues.has(clueKey(c.clue)))) reject();
}
export function reduceCandidateSnapshot(event: DeepReadonly<Pick<CandidateEvent, "id" | "operation">>,
  previous: Readonly<Record<CandidateDifficulty, CandidateRevision | null>>,
  previousReviews: Readonly<Record<CandidateDifficulty, string | null>>, target: CandidateRevision | null, reject: Reject) {
  const current = { ...previous }, reviews = { ...previousReviews };
  let created: CandidateRevision | null = null;
  const op = event.operation; const difficulty = op.difficulty;
  if ("poolId" in op && target?.id !== op.poolId) return reject();
  if (op.kind === "generate" || op.kind === "edit") {
    const base = current[difficulty];
    if (op.kind === "edit" && base?.id !== op.basePoolId) reject();
    const replacement = op.kind === "generate" ? op.replacement : undefined;
    if (replacement && (!base || base.id !== replacement.basePoolId || !sameInput(base.binding, op.binding) ||
      !base.draft.candidates.some(c => c.id === replacement.candidateId) || op.draft.candidates.length !== base.draft.candidates.length ||
      op.draft.candidates.some((c, i) => c.id !== base.draft.candidates[i]?.id ||
        (c.id === replacement.candidateId ? c.grounding.origin !== "transcript" : JSON.stringify(c) !== JSON.stringify(base.draft.candidates[i]))))) reject();
    const statuses = Object.fromEntries(op.draft.candidates.map((c) =>
      [c.id, (op.kind === "edit" || replacement) && base && Object.hasOwn(base.statuses, c.id) ? base.statuses[c.id]! : "use"])) as Record<string, CandidateStatus>;
    const revision: CandidateRevision = { id: event.id, kind: op.kind, difficulty, binding: op.binding, draft: op.draft,
      statuses, restoredFromPoolId: null, evidenceReviewIds: [] };
    revision.evidenceReviewIds = pending(revision);
    created = revision;
    verifyDistinctClues(revision, current[difficulty === "child" ? "adult" : "child"], reject);
    // Regeneration is only a comparison revision once this difficulty has a selection.
    if (op.kind === "edit" || base === null) { current[difficulty] = revision; reviews[difficulty] = null; }
  } else {
    
    if (!target || target.difficulty !== difficulty) return reject();
    if (op.kind === "review") {
      if (current[difficulty]?.id !== target.id) reject();
      reviews[difficulty] = event.id;
      current[difficulty] = { ...target, evidenceReviewIds: [] };
    } else {
      let revision: CandidateRevision = { ...target, evidenceReviewIds: pending(target) };
      if (op.kind === "set_status") {
        if (current[difficulty]?.id !== target.id || !target.draft.candidates.some((c) => c.id === op.candidateId) ||
          target.statuses[op.candidateId] === op.status) reject();
        revision = { ...revision, id: event.id, kind: "set_status", restoredFromPoolId: null,
          statuses: { ...target.statuses, [op.candidateId]: op.status } };
        revision.evidenceReviewIds = pending(revision);
        created = revision;
      } else if (op.kind === "restore") {
        revision = { ...revision, id: event.id, kind: "restore", restoredFromPoolId: target.id };
        created = revision;
      }
      current[difficulty] = revision; reviews[difficulty] = null;
      verifyDistinctClues(current.child, current.adult, reject);
    }
  }
  return { current, reviews, created };
}

function replay(state: State, reject: Reject) {
  const revisions = new Map<string, CandidateRevision>();
  const current: Record<CandidateDifficulty, CandidateRevision | null> = { child: null, adult: null };
  const reviews: Record<CandidateDifficulty, string | null> = { child: null, adult: null };
  let previousVersion = 1;
  const occupied = new Set([
    ...state.intentEvents.map((e) => e.version), ...state.summaryEvents.map((e) => e.version),
    ...state.correctionProposals.map((p) => p.registeredVersion), ...state.correctionDecisions.map((d) => d.version),
    ...state.revisions.flatMap((r) => r.mergedCorrection ? [r.mergedCorrection.decisionVersion + 1] : []),
  ]);
  for (const event of state.candidateEvents) {
    if (event.version <= previousVersion || event.version > state.version || occupied.has(event.version)) reject();
    previousVersion = event.version;
    const op = event.operation;
    const target = "poolId" in op ? revisions.get(op.poolId) ?? null : null;
    if (op.kind === "generate" || op.kind === "edit") verifyDraft(state, op.binding, op.draft, event.version - 1, op.kind === "edit" || op.kind === "generate" && !!op.replacement, reject);
    else {
      const selection = intentSelectionAtVersion(state, event.version - 1, reject);
      if (!target || selection.current?.id !== target.binding.analysisId || selection.confirmationId !== target.binding.intentConfirmationId) reject();
    }
    const next = reduceCandidateSnapshot(event, current, reviews, target, reject);
    Object.assign(current, next.current); Object.assign(reviews, next.reviews);
    if (next.created) revisions.set(next.created.id, next.created);
  }
  const binding = candidateBindingFromIntent(verifyIntentHistory(state, reject));
  function view(difficulty: CandidateDifficulty): CandidatePoolView {
    const revision = current[difficulty];
    const status: CandidatePoolView["status"] = !revision ? "absent"
      : !binding || !sameInput(revision.binding, binding) ? "needs_review"
        : reviews[difficulty] === null ? "awaiting_review" : "reviewed";
    return { status, version: state.version, difficulty, current: revision,
      reviewId: status === "reviewed" ? reviews[difficulty] : null };
  }
  return { revisions, views: { child: view("child"), adult: view("adult") } };
}
export function verifyCandidateHistory(state: State, reject: Reject) { return replay(state, reject).views; }

/** Detached state only. The shared transcript/intent/summary CAS commits this event. */
export function appendCandidateEvent(state: TranscriptState, operation: CandidateOperation, human: TranscriptHumanContext,
  invalid: Reject, conflict: Reject, notConfirmed: Reject) {
  const binding = candidateBindingFromIntent(verifyIntentHistory(state, invalid));
  if (!binding) return notConfirmed();
  const { revisions, views } = replay(state, invalid);
  const view = views[operation.difficulty];
  if (operation.kind === "generate" || operation.kind === "edit") {
    if (!sameInput(binding, operation.binding) || operation.binding.transcript.version !== state.version) conflict();
    if (operation.kind === "edit" && view.current?.id !== operation.basePoolId) conflict();
  } else {
    const target = revisions.get(operation.poolId);
    if (!target || target.difficulty !== operation.difficulty || !sameInput(target.binding, binding)) return conflict();
    if ((operation.kind === "review" || operation.kind === "set_status") && view.current?.id !== target.id) conflict();
  }
  const event: CandidateEvent = { id: crypto.randomUUID(), version: state.version + 1,
    actorId: human.adminId, createdAt: human.now, operation };
  state.candidateEvents.push(event); state.version++;
  replay(state, invalid);
}
/** Explicit public-field allowlist for reviewed clues, not an API or publish connection.
 * Language semantics, including inadvertent answers inside clue prose, require human review.
 */
export function projectCandidateClues(view: CandidatePoolView, invalid: Reject) {
  if (view.status !== "reviewed" || !view.current) return invalid();
  const result = publicCandidateCluesSchema.safeParse({ difficulty: view.difficulty,
    clues: view.current.draft.candidates.filter((c) => view.current!.statuses[c.id] !== "excluded")
      .map((c) => ({ clue: c.clue })) });
  if (!result.success) return invalid();
  return result.data;
}
