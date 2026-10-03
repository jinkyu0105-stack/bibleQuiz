import { publicSermonSchema } from "../../../shared/api/public-quiz";
import { intentFields } from "./sermon-intent-contract";
import { currentIntentBinding, intentSelectionAtVersion, sameTranscript, verifyIntentAnalysisContent,
  verifyIntentHistory, type IntentView } from "./sermon-intent";
import type { SermonSummaryDraft, SummaryBinding, SummaryEvent, SummaryOperation } from "./sermon-summary-contract";
import type { DeepReadonly, TranscriptContent, TranscriptHumanContext, TranscriptState } from "./transcript-revision-contract";

type State = DeepReadonly<TranscriptState>;
type Binding = DeepReadonly<SummaryBinding>;
type Draft = DeepReadonly<SermonSummaryDraft>;
type Reject = () => never;
export type SummaryRevision = {
  id: string; kind: "generate" | "edit" | "restore"; binding: Binding; draft: Draft;
  restoredFromSummaryId: string | null; evidenceReviewIds: string[];
};
export type SummaryView = {
  status: "absent" | "needs_review" | "awaiting_review" | "reviewed";
  version: number; current: SummaryRevision | null; reviewId: string | null;
};
/** Use only the authoritative result of readIntent(..., true). Capture before any external work. */
export function summaryBindingFromIntent(view: DeepReadonly<IntentView>): SummaryBinding | null {
  if (view.status !== "confirmed" || !view.current || !view.confirmationId) return null;
  return { transcript: { ...view.current.binding, version: view.version },
    analysisId: view.current.id, intentConfirmationId: view.confirmationId };
}
function currentBinding(state: State, reject: Reject) {
  return summaryBindingFromIntent(verifyIntentHistory(state, reject));
}
function sameInput(a: Binding, b: Binding) {
  return sameTranscript(a.transcript, b.transcript) && a.analysisId === b.analysisId &&
    a.intentConfirmationId === b.intentConfirmationId;
}
export function verifySummaryDraft(state: State, binding: Binding, draft: Draft, beforeVersion: number, reject: Reject) {
  const selection = intentSelectionAtVersion(state, beforeVersion, reject);
  const content = state.revisions.find((r) => r.id === binding.transcript.revisionId)?.content;
  if (!content) return reject();
  verifySummaryDraftBasis(content, selection, binding, draft, beforeVersion, reject);
}

export type ConfirmedIntentBasis = DeepReadonly<{
  current: { id: string; binding: import("./sermon-intent-contract").IntentBinding;
    analysis: import("./sermon-intent-contract").IntentAnalysis } | null;
  confirmationId: string | null;
}>;
/** Validate against the selection at generation time, never today's selection. */
export function verifySummaryDraftBasis(content: DeepReadonly<TranscriptContent>, selection: ConfirmedIntentBasis,
  binding: Binding, draft: Draft, beforeVersion: number, reject: Reject) {
  if (binding.transcript.version !== beforeVersion) reject();
  if (!selection.current || selection.current.id !== binding.analysisId ||
    selection.confirmationId !== binding.intentConfirmationId ||
    !sameTranscript(selection.current.binding, binding.transcript)) return reject();
  const analysis = selection.current.analysis;
  const claims = new Map(intentFields.flatMap((field) => analysis[field]).map((claim) => [claim.id, claim]));
  for (const paragraph of draft.paragraphs) {
    if (new Set(paragraph.intentClaimIds).size !== paragraph.intentClaimIds.length) reject();
    for (const claimId of paragraph.intentClaimIds) {
      const claim = claims.get(claimId);
      // Private admin context and unresolved claims are never promoted to an AI-backed conclusion.
      if (!claim || claim.origin !== "transcript") return reject();
    }
  }
  // A summary can cite a different passage from the same fixed source. Requiring
  // the analysis's exact quotation neither proves meaning nor validates a summary.
  // Check claim identities above and each quotation against the source below.
  // Reuse P5-09's exact quote, UTF-16 boundary, unique ID/range and timed/plain checks.
  verifyIntentAnalysisContent(content, {
    centralMessage: draft.paragraphs.map((p) => ({ id: p.id, text: p.text, origin: "transcript", evidence: p.evidence })),
    purpose: [], bibleRelationship: [], argumentFlow: [], repeatedEmphasis: [], illustrations: [],
    audienceResponse: [], warnings: [], uncertainties: [],
  }, false, reject);
}

export function reduceSummarySnapshot(event: DeepReadonly<Pick<SummaryEvent, "id" | "operation">>, current: SummaryRevision | null,
  reviewId: string | null, target: SummaryRevision | null, reject: Reject) {
  let created: SummaryRevision | null = null;
  const op = event.operation;
  if ("summaryId" in op && target?.id !== op.summaryId) return reject();
  if (op.kind === "generate" || op.kind === "edit") {
    if (op.kind === "edit" && current?.id !== op.baseSummaryId) reject();
    const revision: SummaryRevision = { id: event.id, kind: op.kind, binding: op.binding, draft: op.draft,
      restoredFromSummaryId: null, evidenceReviewIds: op.draft.paragraphs.map((p) => p.id) };
    created = revision;
    if (op.kind === "edit" || current === null) { current = revision; reviewId = null; }
  } else {
    if (!target) return reject();
    if (op.kind === "review") {
      if (current?.id !== target.id) reject();
      reviewId = event.id;
      current = { ...target, evidenceReviewIds: [] };
    } else {
      current = { ...target, evidenceReviewIds: target.draft.paragraphs.map((p) => p.id) };
      reviewId = null;
      if (op.kind === "restore") {
        current = { ...current, id: event.id, kind: "restore", restoredFromSummaryId: target.id };
        created = current;
      }
    }
  }
  return { current, reviewId, created };
}

function replay(state: State, reject: Reject) {
  const revisions = new Map<string, SummaryRevision>();
  let current: SummaryRevision | null = null;
  let reviewId: string | null = null;
  let previousVersion = 1;
  const occupied = new Set([
    ...state.intentEvents.map((e) => e.version),
    ...state.candidateEvents.map((e) => e.version),
    ...state.correctionProposals.map((p) => p.registeredVersion),
    ...state.correctionDecisions.map((d) => d.version),
    ...state.revisions.flatMap((r) => r.mergedCorrection ? [r.mergedCorrection.decisionVersion + 1] : []),
  ]);
  for (const event of state.summaryEvents) {
    if (event.version <= previousVersion || event.version > state.version || occupied.has(event.version)) reject();
    previousVersion = event.version;
    const op = event.operation;
    const target = "summaryId" in op ? revisions.get(op.summaryId) ?? null : null;
    if (op.kind === "generate" || op.kind === "edit") verifySummaryDraft(state, op.binding, op.draft, event.version - 1, reject);
    else {
      const selection = intentSelectionAtVersion(state, event.version - 1, reject);
      if (!target || selection.current?.id !== target.binding.analysisId || selection.confirmationId !== target.binding.intentConfirmationId) reject();
    }
    const next = reduceSummarySnapshot(event, current, reviewId, target, reject);
    current = next.current; reviewId = next.reviewId;
    if (next.created) revisions.set(next.created.id, next.created);
  }
  const binding = currentBinding(state, reject);
  const transcript = currentIntentBinding(state);
  const status: SummaryView["status"] = current === null ? "absent"
    : !binding || !transcript || !sameInput(current.binding, binding) || !sameTranscript(current.binding.transcript, transcript)
      ? "needs_review" : reviewId === null ? "awaiting_review" : "reviewed";
  const view: SummaryView = { status, version: state.version, current,
    reviewId: status === "reviewed" ? reviewId : null };
  return { revisions, view };
}
export function verifySummaryHistory(state: State, reject: Reject): SummaryView { return replay(state, reject).view; }

/** Detached candidate only; the caller commits with the transcript/intent aggregate CAS. */
export function appendSummaryEvent(state: TranscriptState, operation: SummaryOperation, human: TranscriptHumanContext,
  invalid: Reject, conflict: Reject, notConfirmed: Reject) {
  const binding = currentBinding(state, invalid);
  if (!binding) return notConfirmed();
  const { revisions, view } = replay(state, invalid);
  if (operation.kind === "generate" || operation.kind === "edit") {
    if (!sameInput(binding, operation.binding) || operation.binding.transcript.version !== state.version) conflict();
    if (operation.kind === "edit" && view.current?.id !== operation.baseSummaryId) conflict();
  } else {
    const target = revisions.get(operation.summaryId);
    if (!target || !sameInput(target.binding, binding)) return conflict();
    if (operation.kind === "review" && view.current?.id !== target.id) conflict();
  }
  const event: SummaryEvent = { id: crypto.randomUUID(), version: state.version + 1,
    actorId: human.adminId, createdAt: human.now, operation };
  state.summaryEvents.push(event);
  state.version++;
  replay(state, invalid);
}

/** Source is authoritative, never supplied by the generated draft. Partial YouTube
 * scripts remain an explicit policy gate; no invented full-transcript disclosure.
 */
export function projectSummaryPreview(state: State, view: SummaryView, invalid: Reject, unsupported: Reject) {
  if (!view.current || (view.status !== "awaiting_review" && view.status !== "reviewed")) return invalid();
  const source = state.sources.find((s) => s.id === view.current!.binding.transcript.sourceId);
  if (!source) return invalid();
  const payload = source.payload;
  const disclosure = payload.sourceMode === "public_unofficial" ||
    (payload.sourceMode === "manual_paste" && payload.manualSourceKind === "youtube_visible_transcript" && payload.sourceCoverage === "full_transcript")
    ? "아래 내용은 설교 영상의 공개 자막을 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다."
    : payload.sourceMode === "sermon_notes"
      ? "아래 내용은 관리자가 제공한 설교 자료를 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다." : null;
  if (disclosure === null) return unsupported();
  // Explicit allowlist, compatible with the existing public summary. No object spread of private data.
  const parsed = publicSermonSchema.shape.summary.unwrap().safeParse({
    text: view.current.draft.paragraphs.map((p) => p.text).join("\n\n"), disclosure,
  });
  if (!parsed.success) return invalid();
  return parsed.data;
}
