import { z } from "zod";

import { intentFields, type IntentAnalysis, type IntentBinding } from "../services/sermon-intent-contract";
import { locateEvidenceQuote } from "../services/ai-evidence-location";
import type { SermonCandidateDraft } from "../services/sermon-candidates-contract";
import type { SermonSummaryDraft, SummaryBinding } from "../services/sermon-summary-contract";
import type { TranscriptState } from "../services/transcript-revision-contract";
import { invalidHistory, sameHistoryValue } from "./history-json-codec";
import { historyEnvelopeSchema, historyStreams, parseHistoryRecord,
  type HistoryEnvelope, type HistoryRecord, type HistoryStream } from "./history-record";

const count = z.int().nonnegative();
const scopeSchema = z.strictObject({
  sermonId: historyEnvelopeSchema.shape.sermonId, version: z.int().positive(),
  counts: z.strictObject({ sources: count, revisions: count, confirmations: count,
    correctionProposals: count, correctionDecisions: count, intentEvents: count,
    summaryEvents: count, candidateEvents: count }),
});
export type HistoryScope = z.infer<typeof scopeSchema>;
export type HistoryReference = {
  sermonId: string; ownerRecordId: string; referencePosition: number;
  relation: string; targetRecordId: string; targetStream: HistoryStream;
  targetMemberId: string | null; payloadPath: string;
};
type Payload<S extends HistoryStream> = TranscriptState[S][number];
type AnalysisSnapshot = { binding: IntentBinding; analysis: IntentAnalysis };
type PoolSnapshot = { binding: SummaryBinding; draft: SermonCandidateDraft; difficulty: "child" | "adult" };

/** Validates complete envelope order and projects references only. This is NOT a store,
 * head reader, CAS writer or replacement for the existing full domain validator.
 * The caller supplies authoritative counts/version; omitted tail records cannot look complete.
 */
export function projectHistoryReferences(input: readonly unknown[], expected: unknown): HistoryReference[] {
  try { return project(input, scopeSchema.parse(expected)); }
  catch { return invalidHistory(); }
}
function project(input: readonly unknown[], scope: HistoryScope): HistoryReference[] {
  const records = input.map(parseHistoryRecord).sort((a, b) =>
    a.envelope.commitVersion - b.envelope.commitVersion || a.envelope.commitSlot - b.envelope.commitSlot);
  const seen = new Map<string, HistoryRecord>();
  const counts = Object.fromEntries(historyStreams.map((s) => [s, 0])) as Record<HistoryStream, number>;
  const analyses = new Map<string, AnalysisSnapshot>();
  const summaries = new Map<string, { binding: SummaryBinding; draft: SermonSummaryDraft }>();
  const pools = new Map<string, PoolSnapshot>();
  const decided = new Map<string, Set<string>>();
  const refs: HistoryReference[] = [];
  let currentSource: string | null = null, currentRevision: string | null = null, currentConfirmation: string | null = null;
  let previous: HistoryEnvelope | null = null;

  for (const record of records) {
    const e = record.envelope;
    if (e.sermonId !== scope.sermonId || seen.has(e.recordId) ||
      e.streamPosition !== ++counts[e.stream] || e.commitVersion > scope.version) invalidHistory();
    if (e.commitSlot === 1) {
      if (previous?.stream !== "sources" || previous.commitVersion !== e.commitVersion || e.stream !== "revisions") invalidHistory();
    } else if (e.commitVersion !== (previous?.commitVersion ?? 0) + 1 || previous?.stream === "sources") invalidHistory();
    if (e.stream === "sources" && e.sourceRevision !== e.streamPosition) invalidHistory();
    let referencePosition = 0;
    const payload = <S extends HistoryStream>(stream: S): Payload<S> => {
      if (e.stream !== stream) return invalidHistory();
      return record.payload as Payload<S>;
    };
    function target<S extends HistoryStream>(id: string, stream: S): Payload<S> {
      const found = seen.get(id);
      if (!found || found.envelope.stream !== stream || found.envelope.sermonId !== e.sermonId) return invalidHistory();
      return found.payload as Payload<S>;
    }
    function add<S extends HistoryStream>(id: string, stream: S, relation: string, path: string, member: string | null = null) {
      const result = target(id, stream);
      if (path.length > 512) invalidHistory();
      refs.push({ sermonId: e.sermonId, ownerRecordId: e.recordId, referencePosition: ++referencePosition,
        relation, targetRecordId: id, targetStream: stream, targetMemberId: member, payloadPath: path });
      return result;
    }
    function revisionSource(revisionId: string, sourceId: string) {
      if (target(revisionId, "revisions").sourceId !== sourceId) invalidHistory();
    }
    function binding(b: IntentBinding, path: string, fresh: boolean) {
      const source = add(b.sourceId, "sources", "source", `${path}/sourceId`);
      const revision = add(b.revisionId, "revisions", "revision", `${path}/revisionId`);
      const confirmation = add(b.confirmationId, "confirmations", "confirmation", `${path}/confirmationId`);
      const sourceHash = source.payload.sourceMode === "public_unofficial" ? source.payload.sourceSha256 : source.payload.rawTranscriptSha256;
      if (revision.sourceId !== source.id || confirmation.sourceId !== source.id || confirmation.revisionId !== revision.id ||
        confirmation.transcriptSha256 !== b.transcriptSha256 || revision.transcriptSha256 !== b.transcriptSha256 ||
        source.sourceRevision !== b.sourceRevision || b.sourceSha256 !== sourceHash ||
        (fresh && (b.version !== e.commitVersion - 1 || currentSource !== source.id || currentRevision !== revision.id ||
          currentConfirmation !== confirmation.id))) invalidHistory();
    }
    function downstream(b: SummaryBinding, path: string) {
      binding(b.transcript, `${path}/transcript`, true);
      add(b.analysisId, "intentEvents", "analysis", `${path}/analysisId`);
      const analysis = analyses.get(b.analysisId);
      const confirm = add(b.intentConfirmationId, "intentEvents", "intent_confirmation", `${path}/intentConfirmationId`);
      if (!analysis || confirm.operation.kind !== "confirm" || confirm.operation.analysisId !== b.analysisId ||
        !sameHistoryValue({ ...analysis.binding, version: b.transcript.version }, b.transcript)) invalidHistory();
    }
    function memberClaims(ids: string[], b: SummaryBinding, path: string) {
      const analysis = analyses.get(b.analysisId);
      if (!analysis || new Set(ids).size !== ids.length) invalidHistory();
      ids.forEach((id, i) => {
        const matches = intentFields.flatMap((field) => analysis.analysis[field]).filter((c) => c.id === id);
        if (matches.length !== 1 || matches[0]!.origin !== "transcript") invalidHistory();
        add(b.analysisId, "intentEvents", "intent_claim", `${path}/${i}`, id);
      });
    }
    function evidence(items: IntentAnalysis["centralMessage"][number]["evidence"], b: IntentBinding, path: string) {
      const revision = target(b.revisionId, "revisions");
      items.forEach((item, i) => {
        if (item.locationStatus === "unverified") {
          const located = locateEvidenceQuote(revision.content, item.quote);
          if (located.locationStatus !== "unverified" || located.reason !== item.reason) invalidHistory();
          // Preserve the fixed source reference without inventing a segment.
          add(b.revisionId, "revisions", "evidence", `${path}/${i}`, null);
          return;
        }
        let text: string;
        if (revision.content.format === "plain_text") {
          if (item.segmentId !== null || item.start !== null || item.duration !== null) invalidHistory();
          text = revision.content.text;
        } else {
          const matches = revision.content.segments.filter((s) => s.segmentId === item.segmentId);
          const segment = matches[0];
          if (matches.length !== 1 || !segment || segment.start !== item.start || segment.duration !== item.duration) return invalidHistory();
          text = segment.text;
        }
        if (item.from >= item.to || item.to > text.length || text.slice(item.from, item.to) !== item.quote ||
          /[\uD800-\uDFFF]/u.test(item.quote)) invalidHistory();
        add(b.revisionId, "revisions", "evidence", `${path}/${i}`, item.segmentId);
      });
    }
    function unique(ids: string[]) { if (new Set(ids).size !== ids.length) invalidHistory(); }

    switch (e.stream) {
      case "sources": {
        currentSource = e.recordId; currentConfirmation = null;
        break;
      }
      case "revisions": {
        const p = payload("revisions");
        const source = add(p.sourceId, "sources", "source", "/sourceId");
        if (p.sourceId !== currentSource) invalidHistory();
        if (p.kind === "imported") {
          if (previous?.recordId !== p.sourceId || p.parentRevisionId !== null || p.restoredFromRevisionId !== null || p.mergedCorrection !== null) invalidHistory();
          const content = source.payload.sourceMode === "public_unofficial"
            ? { format: "timed_segments", segments: source.payload.segments.map((s, i) => ({ segmentId: `segment-${i + 1}`, ...s })) }
            : { format: "plain_text", text: source.payload.rawTranscriptText };
          if (!sameHistoryValue(p.content, content)) invalidHistory();
        } else {
          if (p.parentRevisionId !== currentRevision || p.parentRevisionId === null) invalidHistory();
          add(p.parentRevisionId, "revisions", "parent_revision", "/parentRevisionId");
          revisionSource(p.parentRevisionId, p.sourceId);
          if (p.kind === "restored") {
            if (p.restoredFromRevisionId === null) invalidHistory();
            const restored = add(p.restoredFromRevisionId, "revisions", "restored_revision", "/restoredFromRevisionId");
            if (restored.sourceId !== p.sourceId || !sameHistoryValue(restored.content, p.content)) invalidHistory();
          } else if (p.restoredFromRevisionId !== null) invalidHistory();
          if (p.kind === "merged") {
            if (!p.mergedCorrection || p.mergedCorrection.decisionVersion !== e.commitVersion - 1) invalidHistory();
            const proposal = add(p.mergedCorrection.proposalId, "correctionProposals", "proposal", "/mergedCorrection/proposalId");
            if (proposal.sourceId !== p.sourceId || proposal.baseRevisionId !== p.parentRevisionId) invalidHistory();
          } else if (p.mergedCorrection !== null) invalidHistory();
        }
        // Text edits preserve the original segment topology and second-based timing.
        if (source.payload.sourceMode === "public_unofficial") {
          if (p.content.format !== "timed_segments" || p.content.segments.length !== source.payload.segments.length) invalidHistory();
          const content = p.content;
          source.payload.segments.forEach((s, i) => {
            const working = content.segments[i]!;
            if (working.segmentId !== `segment-${i + 1}` || working.start !== s.start || working.duration !== s.duration) invalidHistory();
          });
        } else if (p.content.format !== "plain_text") invalidHistory();
        currentRevision = p.id; currentConfirmation = null;
        break;
      }
      case "confirmations": {
        const p = payload("confirmations");
        add(p.sourceId, "sources", "source", "/sourceId");
        const r = add(p.revisionId, "revisions", "revision", "/revisionId");
        if (p.sourceId !== currentSource || p.revisionId !== currentRevision || r.sourceId !== p.sourceId || r.transcriptSha256 !== p.transcriptSha256) invalidHistory();
        currentConfirmation = p.id;
        break;
      }
      case "correctionProposals": {
        const p = payload("correctionProposals");
        const s = add(p.sourceId, "sources", "source", "/sourceId");
        const r = add(p.baseRevisionId, "revisions", "base_revision", "/baseRevisionId");
        const hash = s.payload.sourceMode === "public_unofficial" ? s.payload.sourceSha256 : s.payload.rawTranscriptSha256;
        if (p.sourceId !== currentSource || p.baseRevisionId !== currentRevision || r.sourceId !== p.sourceId ||
          r.transcriptSha256 !== p.baseTranscriptSha256 || hash !== p.sourceSha256) invalidHistory();
        unique(p.items.map((i) => i.id));
        p.items.forEach((item, i) => {
          // Original text may be empty for insertion proposals; context/merge validation remains domain-owned.
          if (r.content.format === "plain_text") {
            if (item.segmentId !== null || item.start !== null || item.duration !== null) invalidHistory();
          } else if (!r.content.segments.some((s) => s.segmentId === item.segmentId && s.start === item.start && s.duration === item.duration)) invalidHistory();
          add(r.id, "revisions", "correction_target", `/items/${i}`, item.segmentId);
        });
        break;
      }
      case "correctionDecisions": {
        const p = payload("correctionDecisions");
        const proposal = add(p.proposalId, "correctionProposals", "proposal", "/proposalId");
        const previousDecisions = decided.get(proposal.id) ?? new Set<string>();
        for (const [i, d] of p.decisions.entries()) {
          if (previousDecisions.has(d.itemId) || !proposal.items.some((item) => item.id === d.itemId)) invalidHistory();
          previousDecisions.add(d.itemId);
          add(proposal.id, "correctionProposals", "correction_item", `/decisions/${i}/itemId`, d.itemId);
        }
        decided.set(proposal.id, previousDecisions);
        break;
      }
      case "intentEvents": {
        const op = payload("intentEvents").operation;
        if (op.kind === "analysis" || op.kind === "critique" || op.kind === "edit") {
          let b: IntentBinding;
          if (op.kind === "edit" || op.kind === "critique") {
            const base = add(op.baseAnalysisId, "intentEvents", "base_analysis", "/operation/baseAnalysisId");
            const snapshot = analyses.get(base.id);
            if (!snapshot || (op.kind === "critique" && base.operation.kind !== "analysis")) invalidHistory();
            b = snapshot.binding;
            if (op.kind === "critique") {
              for (const [check, value] of Object.entries(op.critique)) {
                value.concerns.forEach((c, i) => {
                  if (c.claimId !== null) {
                    if (!snapshot.analysis[c.field].some((claim) => claim.id === c.claimId)) invalidHistory();
                    add(base.id, "intentEvents", "critique_claim", `/operation/critique/${check}/concerns/${i}/claimId`, c.claimId);
                  }
                });
              }
            }
          } else b = op.binding;
          if (op.kind !== "edit") { b = op.binding; binding(b, "/operation/binding", true); }
          unique(intentFields.flatMap((field) => op.analysis[field].map((c) => c.id)));
          for (const field of intentFields) op.analysis[field].forEach((c, i) => evidence(c.evidence, b, `/operation/analysis/${field}/${i}/evidence`));
          analyses.set(e.recordId, { binding: b, analysis: op.analysis });
        } else {
          add(op.analysisId, "intentEvents", "analysis", "/operation/analysisId");
          if (!analyses.has(op.analysisId)) invalidHistory();
        }
        break;
      }
      case "summaryEvents": {
        const op = payload("summaryEvents").operation;
        if (op.kind === "generate" || op.kind === "edit") {
          downstream(op.binding, "/operation/binding");
          if (op.kind === "edit") {
            add(op.baseSummaryId, "summaryEvents", "base_summary", "/operation/baseSummaryId");
            if (!summaries.has(op.baseSummaryId)) invalidHistory();
          }
          unique(op.draft.paragraphs.map((p) => p.id));
          op.draft.paragraphs.forEach((p, i) => {
            memberClaims(p.intentClaimIds, op.binding, `/operation/draft/paragraphs/${i}/intentClaimIds`);
            evidence(p.evidence, op.binding.transcript, `/operation/draft/paragraphs/${i}/evidence`);
          });
          summaries.set(e.recordId, { binding: op.binding, draft: op.draft });
        } else {
          add(op.summaryId, "summaryEvents", "summary", "/operation/summaryId");
          const snapshot = summaries.get(op.summaryId);
          if (!snapshot) invalidHistory();
          if (op.kind === "restore") summaries.set(e.recordId, snapshot);
        }
        break;
      }
      case "candidateEvents": {
        const op = payload("candidateEvents").operation;
        if (op.kind === "generate" || op.kind === "edit") {
          downstream(op.binding, "/operation/binding");
          if (op.kind === "edit") {
            add(op.basePoolId, "candidateEvents", "base_pool", "/operation/basePoolId");
            if (pools.get(op.basePoolId)?.difficulty !== op.difficulty) invalidHistory();
          }
          unique(op.draft.candidates.map((p) => p.id));
          op.draft.candidates.forEach((p, i) => {
            if (p.grounding.origin === "transcript") {
              memberClaims(p.grounding.intentClaimIds, op.binding, `/operation/draft/candidates/${i}/grounding/intentClaimIds`);
              evidence(p.grounding.evidence, op.binding.transcript, `/operation/draft/candidates/${i}/grounding/evidence`);
            }
          });
          pools.set(e.recordId, { binding: op.binding, draft: op.draft, difficulty: op.difficulty });
        } else {
          add(op.poolId, "candidateEvents", "pool", "/operation/poolId");
          const snapshot = pools.get(op.poolId);
          if (!snapshot || snapshot.difficulty !== op.difficulty) invalidHistory();
          if (op.kind === "set_status") {
            if (!snapshot.draft.candidates.some((c) => c.id === op.candidateId)) invalidHistory();
            add(op.poolId, "candidateEvents", "candidate", "/operation/candidateId", op.candidateId);
          }
          // Only these operations create new logical snapshots. select/review IDs are not pools.
          if (op.kind === "set_status" || op.kind === "restore") pools.set(e.recordId, snapshot);
        }
        break;
      }
    }
    seen.set(e.recordId, record); previous = e;
  }
  if (previous?.stream === "sources" || previous?.commitVersion !== scope.version || !sameHistoryValue(counts, scope.counts) ||
    scope.version !== historyStreams.filter((s) => s !== "sources").reduce((sum, s) => sum + counts[s], 0)) invalidHistory();
  return refs;
}

/** Compare all projected columns and positions. No repairing/dropping extra or missing rows. */
export function verifyHistoryReferences(records: readonly unknown[], scope: unknown, references: unknown): void {
  try {
    if (!sameHistoryValue(projectHistoryReferences(records, scope), references)) invalidHistory();
  } catch { invalidHistory(); }
}
