import { intentFields, type IntentAnalysis, type IntentBinding, type IntentEvent, type IntentOperation } from "./sermon-intent-contract";
import type { DeepReadonly, TranscriptContent, TranscriptHumanContext, TranscriptState } from "./transcript-revision-contract";
import { locateEvidenceQuote } from "./ai-evidence-location";

type State = DeepReadonly<TranscriptState>;
type Binding = DeepReadonly<IntentBinding>;
type Analysis = DeepReadonly<IntentAnalysis>;
type Reject = () => never;
export type IntentRevision = {
  id: string; kind: "analysis" | "critique" | "edit"; binding: Binding; analysis: Analysis;
  critiqueId: string | null; evidenceReviewIds: string[];
};
export type IntentView = {
  status: "absent" | "needs_review" | "awaiting_critique" | "awaiting_confirmation" | "confirmed";
  version: number; current: IntentRevision | null; confirmationId: string | null;
  unresolvedClaimIds: string[];
};
function claims(analysis: Analysis) { return intentFields.flatMap((field) => analysis[field]); }
export function sameTranscript(a: Binding, b: Binding) {
  return a.sourceId === b.sourceId && a.sourceRevision === b.sourceRevision && a.sourceSha256 === b.sourceSha256 &&
    a.revisionId === b.revisionId && a.transcriptSha256 === b.transcriptSha256 &&
    a.checksumFormat === b.checksumFormat && a.confirmationId === b.confirmationId;
}
/** Call only with validated, authoritative state. No transcript text is duplicated. */
export function currentIntentBinding(state: State): IntentBinding | null {
  if (state.currentConfirmationId === null) return null;
  const source = state.sources.at(-1)!;
  const revision = state.revisions.at(-1)!;
  return {
    sourceId: source.id, sourceRevision: source.sourceRevision,
    sourceSha256: source.payload.sourceMode === "public_unofficial" ? source.payload.sourceSha256 : source.payload.rawTranscriptSha256,
    revisionId: revision.id, transcriptSha256: revision.transcriptSha256, checksumFormat: revision.checksumFormat,
    confirmationId: state.currentConfirmationId, version: state.version,
  };
}
function verifyBinding(state: State, binding: Binding, beforeVersion: number, reject: Reject) {
  const source = state.sources.find((s) => s.id === binding.sourceId);
  const revision = state.revisions.find((r) => r.id === binding.revisionId);
  const confirmation = state.confirmations.find((c) => c.id === binding.confirmationId);
  if (!source || !revision || !confirmation || binding.version !== beforeVersion ||
    binding.sourceRevision !== source.sourceRevision || revision.sourceId !== source.id ||
    binding.transcriptSha256 !== revision.transcriptSha256 || binding.checksumFormat !== revision.checksumFormat ||
    confirmation.sourceId !== source.id || confirmation.revisionId !== revision.id ||
    confirmation.transcriptSha256 !== binding.transcriptSha256) return reject();
  const rawHash = source.payload.sourceMode === "public_unofficial" ? source.payload.sourceSha256 : source.payload.rawTranscriptSha256;
  if (rawHash !== binding.sourceSha256) reject();
  return revision.content;
}
function validBoundary(text: string, offset: number) {
  // An exact substring must not cut a Unicode surrogate pair in half.
  return !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/u.test(text[offset]!));
}
export function verifyIntentAnalysis(state: State, binding: Binding, analysis: Analysis, human: boolean, reject: Reject) {
  const content = state.revisions.find((r) => r.id === binding.revisionId)?.content;
  if (!content) return reject();
  verifyIntentAnalysisContent(content, analysis, human, reject);
}

export type IntentEvidenceIssue = {
  code: "duplicate_claim_id" | "human_origin_in_ai" | "plain_text_location" | "segment_missing" | "segment_time" |
    "duplicate_evidence" | "evidence_range" | "unicode_boundary" | "quote_mismatch" | "unverified_location";
  claimIndex: number;
  evidenceIndex: number | null;
};

/** Shared semantic core. Optional diagnostics contain positions/codes, never IDs or text. */
export function verifyIntentAnalysisContent(content: DeepReadonly<TranscriptContent>, analysis: Analysis, human: boolean, reject: Reject,
  diagnose?: (issue: IntentEvidenceIssue) => void) {
  const ids = new Set<string>();
  for (const [claimIndex, claim] of claims(analysis).entries()) {
    const fail = (code: IntentEvidenceIssue["code"], evidenceIndex: number | null = null): never => {
      try { diagnose?.({ code, claimIndex, evidenceIndex }); } catch { /* Diagnostics cannot change validation. */ }
      return reject();
    };
    if (ids.has(claim.id)) fail("duplicate_claim_id");
    if (!human && claim.origin === "admin_context") fail("human_origin_in_ai");
    ids.add(claim.id);
    const evidenceKeys = new Set<string>();
    for (const [evidenceIndex, evidence] of claim.evidence.entries()) {
      if (evidence.locationStatus === "unverified") {
        const located = locateEvidenceQuote(content, evidence.quote);
        if (located.locationStatus !== "unverified" || located.reason !== evidence.reason)
          fail("unverified_location", evidenceIndex);
        // Missing/ambiguous locations are informational, not approval gates.
        continue;
      }
      let text: string;
      if (content.format === "plain_text") {
        if (evidence.segmentId !== null || evidence.start !== null || evidence.duration !== null) fail("plain_text_location", evidenceIndex);
        text = content.text;
      } else {
        const segment = content.segments.find((s) => s.segmentId === evidence.segmentId);
        if (!segment) return fail("segment_missing", evidenceIndex);
        if (segment.start !== evidence.start || segment.duration !== evidence.duration) fail("segment_time", evidenceIndex);
        text = segment.text;
      }
      const key = JSON.stringify([evidence.segmentId, evidence.from, evidence.to]);
      if (evidenceKeys.has(key)) fail("duplicate_evidence", evidenceIndex);
      if (evidence.from >= evidence.to || evidence.to > text.length) fail("evidence_range", evidenceIndex);
      if (!validBoundary(text, evidence.from) || !validBoundary(text, evidence.to)) fail("unicode_boundary", evidenceIndex);
      if (text.slice(evidence.from, evidence.to) !== evidence.quote) fail("quote_mismatch", evidenceIndex);
      evidenceKeys.add(key);
    }
  }
}

/** Reuse the exact acceptance checks for private runtime/offline diagnostics. */
export function diagnoseIntentEvidence(content: DeepReadonly<TranscriptContent>, analysis: Analysis): IntentEvidenceIssue | null {
  let issue: IntentEvidenceIssue | null = null;
  const rejected = Symbol("intent-evidence-invalid");
  try { verifyIntentAnalysisContent(content, analysis, false, () => { throw rejected; }, value => { issue = value; }); }
  catch (error) { if (error !== rejected) throw error; }
  return issue;
}

/** Concerns refer to the original root, not the critique's revised analysis. */
export function verifyIntentCritique(base: Analysis, critique: DeepReadonly<import("./sermon-intent-contract").IntentOperation & { kind: "critique" }>["critique"], reject: Reject) {
  for (const check of Object.values(critique)) for (const concern of check.concerns) {
    if (concern.claimId !== null && !base[concern.field].some((c) => c.id === concern.claimId)) reject();
  }
}

/** One operation over explicit validated snapshots; no history or IO. */
export function reduceIntentSnapshot(event: DeepReadonly<Pick<IntentEvent, "id" | "operation">>, current: IntentRevision | null,
  confirmationId: string | null, target: IntentRevision | null, content: DeepReadonly<TranscriptContent>, reject: Reject) {
  let created: IntentRevision | null = null;
  const op = event.operation;
  const targetId = op.kind === "analysis" ? null : "baseAnalysisId" in op ? op.baseAnalysisId : op.analysisId;
  if (targetId !== null && target?.id !== targetId) return reject();
  if (op.kind === "analysis" || op.kind === "critique") {
    verifyIntentAnalysisContent(content, op.analysis, false, reject);
    if (op.kind === "critique") {
      const base = target;
      if (!base || base.kind !== "analysis" || !sameTranscript(base.binding, op.binding)) return reject();
      verifyIntentCritique(base.analysis, op.critique, reject);
    }
    const revision: IntentRevision = { id: event.id, kind: op.kind, binding: op.binding, analysis: op.analysis,
      critiqueId: op.kind === "critique" ? event.id : null, evidenceReviewIds: [] };
    created = revision;
    // Regeneration and critique create comparison candidates, never overwrite an edit.
    if (current === null) current = revision;
  } else if (op.kind === "edit") {
    const base = target;
    if (!base || current?.id !== base.id) return reject();
    verifyIntentAnalysisContent(content, op.analysis, true, reject);
    const pending = intentFields.flatMap((field) => op.analysis[field].filter((claim) => {
      if (claim.origin !== "transcript") return false;
      const old = base.analysis[field].find((c) => c.id === claim.id);
      return base.evidenceReviewIds.includes(claim.id) || JSON.stringify(old) !== JSON.stringify(claim);
    }).map((claim) => claim.id));
    current = { id: event.id, kind: "edit", binding: base.binding, analysis: op.analysis,
      critiqueId: base.critiqueId, evidenceReviewIds: pending };
    created = current;
    confirmationId = null;
  } else {
    const revision = target;
    if (!revision) return reject();
    if (op.kind === "select") {
      current = revision;
      confirmationId = null;
    } else {
      if (current?.id !== revision.id || revision.critiqueId === null ||
        revision.analysis.centralMessage.length === 0 || revision.analysis.purpose.length === 0) reject();
      // Final human confirmation is the explicit review action; no extra questionnaire.
      confirmationId = event.id;
      current = { ...revision, evidenceReviewIds: [] };
      created = current;
    }
  }
  return { current, confirmationId, created };
}

/** Replay immutable intent events. The current review status is derived from the
 * CURRENT transcript, so edit/restore/import/merge cannot leave a stale approval.
 * Historical records are validated against their own original transcript.
 */
function replay(state: State, reject: Reject) {
  const revisions = new Map<string, IntentRevision>();
  let current: IntentRevision | null = null;
  let confirmationId: string | null = null;
  let previousVersion = 1;
  const occupiedVersions = new Set([
    ...state.correctionProposals.map((p) => p.registeredVersion),
    ...state.correctionDecisions.map((d) => d.version),
    ...state.summaryEvents.map((e) => e.version),
    ...state.candidateEvents.map((e) => e.version),
    ...state.revisions.flatMap((r) => r.mergedCorrection ? [r.mergedCorrection.decisionVersion + 1] : []),
  ]);
  for (const event of state.intentEvents) {
    if (event.version <= previousVersion || event.version > state.version || occupiedVersions.has(event.version)) reject();
    previousVersion = event.version;
    const op = event.operation;
    if (op.kind === "analysis" || op.kind === "critique") verifyBinding(state, op.binding, event.version - 1, reject);
    const targetId = op.kind === "analysis" ? null : op.kind === "critique" || op.kind === "edit" ? op.baseAnalysisId : op.analysisId;
    const target = targetId === null ? null : revisions.get(targetId) ?? null;
    const binding = op.kind === "analysis" || op.kind === "critique" ? op.binding : target?.binding;
    const content = state.revisions.find((r) => r.id === binding?.revisionId)?.content;
    if (!content) return reject();
    const next = reduceIntentSnapshot(event, current, confirmationId, target, content, reject);
    current = next.current; confirmationId = next.confirmationId;
    if (next.created) revisions.set(next.created.id, next.created);
  }
  const binding = currentIntentBinding(state);
  const status: IntentView["status"] = current === null ? "absent"
    : !binding || !sameTranscript(current.binding, binding) ? "needs_review"
      : confirmationId !== null ? "confirmed" : current.critiqueId === null ? "awaiting_critique" : "awaiting_confirmation";
  const view: IntentView = { status, version: state.version, current,
    confirmationId: status === "confirmed" ? confirmationId : null,
    unresolvedClaimIds: current ? claims(current.analysis).filter((c) => c.origin === "unresolved").map((c) => c.id) : [],
  };
  if (status === "confirmed" && current) view.current = { ...current, evidenceReviewIds: [] };
  return { revisions, view, selection: { current, confirmationId } };
}
export function verifyIntentHistory(state: State, reject: Reject): IntentView { return replay(state, reject).view; }

/** Historical selection for validating downstream provenance, never current eligibility. */
export function intentSelectionAtVersion(state: State, version: number, reject: Reject) {
  return replay({ ...state, intentEvents: state.intentEvents.filter((e) => e.version <= version) }, reject).selection;
}

/** Mutates only a detached candidate. Caller commits the entire aggregate with CAS. */
export function appendIntentEvent(
  state: TranscriptState, operation: IntentOperation, human: TranscriptHumanContext,
  invalid: Reject, conflict: Reject, notConfirmed: Reject,
) {
  const binding = currentIntentBinding(state);
  if (!binding) return notConfirmed();
  const { revisions, view } = replay(state, invalid);
  if (operation.kind === "analysis" || operation.kind === "critique") {
    if (!sameTranscript(binding, operation.binding) || operation.binding.version !== state.version) conflict();
  }
  if (operation.kind !== "analysis") {
    const targetId = operation.kind === "critique" || operation.kind === "edit" ? operation.baseAnalysisId : operation.analysisId;
    const target = revisions.get(targetId);
    if (!target || !sameTranscript(target.binding, binding)) return conflict();
    if ((operation.kind === "edit" || operation.kind === "confirm") && view.current?.id !== targetId) conflict();
  }
  const event: IntentEvent = { id: crypto.randomUUID(), version: state.version + 1,
    actorId: human.adminId, createdAt: human.now, operation };
  state.intentEvents.push(event);
  state.version++;
  replay(state, invalid);
}
