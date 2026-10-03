import { z } from "zod";
import { measureDomainEnvelope } from "./generation-domain-resources";
import { sha256Bytes } from "../storage/sha256";
import { generationDomainEnvelopeSchema, type GenerationDomainPair, type GenerationDomainValidationPort } from "./generation-bridge-contract";
import { generationAggregateVersion } from "./generation-bridge";
import { domainBasisSchema, domainEventIdentitySchema, domainOperationSchema, domainSnapshotPayload, domainPreparedSchema, intentSnapshotSchema, summarySnapshotSchema, candidateSnapshotSchema,
  type DomainBasis, type DomainPrepared, type DomainSnapshot } from "./generation-domain-contract";
import { canonicalDomainJson, DomainContractError, invalidDomain as invalid, domainLimit, type DomainResourceBudget } from "./generation-domain-codec";
import { reduceIntentSnapshot, sameTranscript, verifyIntentAnalysisContent, verifyIntentCritique } from "./sermon-intent";
import { reduceSummarySnapshot, verifySummaryDraftBasis, type ConfirmedIntentBasis } from "./sermon-summary";
import { reduceCandidateSnapshot, verifyCandidateDraftBasis, verifyDistinctClues } from "./sermon-candidates";
import { verifyCorrectionItems } from "./transcript-corrections";
import { materializeCorrectionDocument } from "./transcript-correction-document";
import type { IntentBinding } from "./sermon-intent-contract";

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && same(Reflect.get(a, k), Reflect.get(b, k)));
}
export function domainTranscriptBinding(input: DomainBasis["documents"][number]["input"], version: number): IntentBinding {
  if (!input.confirmationId) return invalid();
  return { sourceId: input.sourceId, sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256,
    revisionId: input.documentId, transcriptSha256: input.documentSha256, checksumFormat: input.checksumFormat,
    confirmationId: input.confirmationId, version };
}
function snapshot(b: DomainBasis, id: string | null | undefined) { return b.snapshots.find(s => s.value.id === id) ?? null; }
function intent(b: DomainBasis, id: string | null | undefined) { const s = snapshot(b, id); return s?.kind === "intent" ? s : null; }
function summary(b: DomainBasis, id: string | null | undefined) { const s = snapshot(b, id); return s?.kind === "summary" ? s : null; }
function candidate(b: DomainBasis, id: string | null | undefined) { const s = snapshot(b, id); return s?.kind === "candidate" ? s : null; }
function document(b: DomainBasis, binding: IntentBinding) {
  const d = b.documents.find(d => d.input.documentId === binding.revisionId && sameTranscript(domainTranscriptBinding(d.input, binding.version), binding));
  if (!d) return invalid();
  return d.content;
}
function selection(b: DomainBasis, version: number): ConfirmedIntentBasis {
  const s = b.intentSelections.find(s => s.atVersion === version), selected = intent(b, s?.selectedId);
  if (!s || !selected || !selected.value.critiqueId || selected.value.analysis.centralMessage.length === 0 || selected.value.analysis.purpose.length === 0 || !b.humanRecords.some(r => r.id === s.confirmationId && r.kind === "confirmation" && r.targetId === selected.value.id)) return invalid();
  return { current: selected.value, confirmationId: s.confirmationId };
}
/** Validates injected basis semantics/digests. It does NOT verify D1 seals, H0/H1,
 * authentication or historical selection persistence. That is a reader gate. */
export async function validateDomainBasis(raw: unknown, budget: DomainResourceBudget): Promise<DomainBasis> {
  canonicalDomainJson(raw, { ...budget, maxPayloadBytes: budget.maxDecodedBytes,
    maxChunks: Math.ceil(budget.maxDecodedBytes / budget.chunkBytes) });
  const parsed = domainBasisSchema.safeParse(raw);
  if (!parsed.success) return invalid();
  const b = parsed.data, a = b.authority, refs = b.references.references;
  if (refs.length > budget.maxReferences || b.targetIds.length > budget.maxTargets) domainLimit();
  if (refs.some(r => r.sermonId !== a.sermonId) || b.targetIds.some(id => !snapshot(b, id)) ||
    new Set(b.humanRecords.map(r => r.id)).size !== b.humanRecords.length) return invalid();
  const has = (id: string | null) => id === null || refs.some(r => r.eventId === id);
  for (const d of b.documents) {
    const i = d.input, source = refs.find(r => r.eventId === i.sourceId), doc = refs.find(r => r.eventId === i.documentId);
    if (source?.kind !== "input" || doc?.kind !== "input" || source.eventVersion !== i.sourceRevision ||
      source.sourceSha256 !== i.sourceSha256 || doc.documentSha256 !== i.documentSha256 || !has(i.confirmationId)) return invalid();
    const text = d.content.format === "plain_text" ? d.content.text : d.content.segments.map(s => s.text).join("\n");
    if (await sha256Bytes(new TextEncoder().encode(text)) !== i.documentSha256) return invalid();
    if (d.content.format === "timed_segments" && new Set(d.content.segments.map(s => s.segmentId)).size !== d.content.segments.length) return invalid();
  }
  if (a.input.state === "present" && !b.documents.some(d => same(d.input, a.input))) return invalid();
  for (const s of b.snapshots) {
    const v = s.value, p = s.provenance, ref = refs.find(r => r.eventId === v.id);
    const binding = s.kind === "intent" ? s.value.binding : s.value.binding.transcript;
    if (ref?.kind !== "content" || p.generationVersion >= ref.eventVersion || (ref.snapshotSha256 ?? ref.payloadSha256) !== p.payloadSha256 ||
      await sha256Bytes(new TextEncoder().encode(canonicalDomainJson(domainSnapshotPayload(s), budget))) !== p.payloadSha256 ||
      !sameTranscript(domainTranscriptBinding(p.input, binding.version), binding) || binding.version !== p.generationVersion) return invalid();
    const content = document(b, binding);
    const operation = s.operation;
    const baseId = "baseAnalysisId" in operation ? operation.baseAnalysisId : "baseSummaryId" in operation ? operation.baseSummaryId :
      "basePoolId" in operation ? operation.basePoolId : "replacement" in operation && operation.replacement ? operation.replacement.basePoolId : "summaryId" in operation ? operation.summaryId : "poolId" in operation ? operation.poolId : null;
    const base = snapshot(b, baseId);
    if (baseId && (!base || !refs.some(r => r.eventId === baseId && r.eventVersion < ref.eventVersion))) return invalid();
    const event = { id: v.id };
    if (s.kind === "intent") {
      if (!["analysis", "critique", "edit"].includes(s.operation.kind)) return invalid();
      const target = base?.kind === "intent" ? base.value : null;
      const next = reduceIntentSnapshot({ ...event, operation: s.operation }, target, null, target, content, invalid);
      if (!same(next.created, s.value) || !same(s.critique, s.operation.kind === "critique" ? s.operation.critique : null) ||
        (s.operation.kind === "edit" && base?.provenance.rootAnalysisId !== s.provenance.rootAnalysisId)) return invalid();
      const root = intent(b, p.rootAnalysisId);
      if (!root || root.value.kind !== "analysis" || root.provenance.rootAnalysisId !== root.value.id ||
        !sameTranscript(root.value.binding, s.value.binding)) return invalid();
      verifyIntentAnalysisContent(content, s.value.analysis, s.value.kind === "edit", invalid);
      if (s.value.kind === "analysis" && (s.value.critiqueId !== null || s.critique !== null || root.value.id !== s.value.id)) return invalid();
      if (s.value.kind === "critique") {
        if (!s.critique || s.value.critiqueId !== s.value.id) return invalid();
        verifyIntentCritique(root.value.analysis, s.critique, invalid);
      }
      if (s.value.critiqueId) {
        const critique = intent(b, s.value.critiqueId);
        if (!critique || critique.value.kind !== "critique" || critique.provenance.rootAnalysisId !== p.rootAnalysisId) return invalid();
      }
    } else {
      const selected = selection(b, p.generationVersion);
      if (p.rootAnalysisId !== null) return invalid();
      if (s.kind === "summary") {
        if (!["generate", "edit", "restore"].includes(s.operation.kind)) return invalid();
        const target = base?.kind === "summary" ? base.value : null;
        const next = reduceSummarySnapshot({ ...event, operation: s.operation }, target, null, target, invalid);
        if (!same(next.created, s.value)) return invalid();
        verifySummaryDraftBasis(content, selected, s.value.binding, s.value.draft, p.generationVersion, invalid);
      } else {
        if (!["generate", "edit", "restore", "set_status"].includes(s.operation.kind)) return invalid();
        const target = base?.kind === "candidate" ? base.value : null, d = s.value.difficulty;
        const next = reduceCandidateSnapshot({ ...event, operation: s.operation },
          { child: d === "child" ? target : null, adult: d === "adult" ? target : null }, { child: null, adult: null }, target, invalid);
        if (!same(next.created, s.value)) return invalid();
        verifyCandidateDraftBasis(content, selected, s.value.binding, s.value.draft, p.generationVersion, s.value.kind !== "generate" || s.operation.kind === "generate" && !!s.operation.replacement, invalid);
        if (Object.keys(s.value.statuses).length !== s.value.draft.candidates.length || s.value.draft.candidates.some(c => !Object.hasOwn(s.value.statuses, c.id))) return invalid();
      }
    }
  }
  for (const r of b.humanRecords) if (!has(r.id) || !snapshot(b, r.targetId) || !has(r.intentConfirmationId)) return invalid();
  for (const s of b.intentSelections) {
    const ref = refs.find(r => r.eventId === s.confirmationId);
    if (!ref || ref.eventVersion > s.atVersion || s.atVersion > (generationAggregateVersion(a) ?? 0)) return invalid();
    selection(b, s.atVersion);
  }
  const c = a.content;
  if (c.state === "present") {
    if (!has(c.lastEventId)) return invalid();
    if (c.availableCritique) {
      const available = intent(b, c.availableCritique.id);
      if (!available || available.value.kind !== "critique" || available.provenance.rootAnalysisId !== c.availableCritique.rootAnalysisId ||
        c.intent?.rootAnalysisId !== c.availableCritique.rootAnalysisId) return invalid();
    }
    if (c.intent) {
      const s = intent(b, c.intent.selectedId);
      if (!s || !same(s.value.binding, c.intent.binding) || s.provenance.rootAnalysisId !== c.intent.rootAnalysisId ||
        s.value.critiqueId !== (c.intent.critique?.id ?? null) ||
        (c.intent.critique && c.intent.critique.rootAnalysisId !== s.provenance.rootAnalysisId)) return invalid();
      if (c.intent.confirmation && (!s.value.critiqueId || c.intent.confirmation.targetId !== s.value.id ||
        c.intent.confirmation.critiqueId !== s.value.critiqueId || !b.humanRecords.some(r => r.id === c.intent!.confirmation!.id && r.kind === "confirmation" && r.targetId === s.value.id))) return invalid();
    }
    for (const slot of ["summary", "child", "adult"] as const) {
      const value = c[slot]; if (!value) continue;
      const s = slot === "summary" ? summary(b, value.id) : candidate(b, value.id);
      if (!s || !same(s.value.binding, value.binding) || (s.kind === "candidate" && s.value.difficulty !== slot)) return invalid();
      if (value.review && (value.review.targetId !== value.id || value.review.intentConfirmationId !== value.binding.intentConfirmationId ||
        !b.humanRecords.some(r => r.id === value.review!.id && r.kind === "review" && r.targetId === value.id && r.intentConfirmationId === value.review!.intentConfirmationId))) return invalid();
    }
  }
  return b;
}
function pairMatches(b: DomainBasis, pair: GenerationDomainPair) {
  if (pair.task === "final_audit") return invalid();
  const a = b.authority, i = a.input, version = generationAggregateVersion(a);
  if (i.state !== "present" || version === null || pair.request.context.sermonId !== a.sermonId ||
    !same(pair.request.context, pair.result.context)) return invalid();
  const doc = b.documents.find(d => same(d.input, i));
  if (!doc || !same(doc.content, pair.request.input.transcript)) return invalid();
  if (pair.task === "correction") {
    const c = pair.request.context;
    if (i.sourceKind !== "caption" || [...(doc.content.format === "plain_text" ? doc.content.text : doc.content.segments.map(s => s.text).join("\n"))].length > 30000 ||
      c.expectedVersion !== version || c.sourceId !== i.sourceId || c.sourceSha256 !== i.sourceSha256 || c.baseRevisionId !== i.documentId || c.baseTranscriptSha256 !== i.documentSha256) return invalid();
    return;
  }
  const binding = domainTranscriptBinding(i, version);
  if (pair.task === "intent_analysis" || pair.task === "intent_critique") {
    if (!same(binding, pair.request.context.binding)) return invalid();
    if (pair.task === "intent_critique") {
      const root = intent(b, pair.request.context.baseAnalysisId);
      if (!root || root.value.kind !== "analysis" || !sameTranscript(root.value.binding, binding) || !same(root.value.analysis, pair.request.input.analysis)) return invalid();
    }
  } else {
    const selected = selection(b, version), c = a.content;
    if (c.state !== "present" || !c.intent || !selected.current || selected.current.id !== c.intent.selectedId || selected.confirmationId !== c.intent.confirmation?.id ||
      !same(pair.request.context.binding, { transcript: binding, analysisId: selected.current.id, intentConfirmationId: selected.confirmationId }) ||
      !same(selected.current.analysis, pair.request.input.intent)) return invalid();
    if (pair.task === "child_candidates" || pair.task === "adult_candidates") {
      const t = pair.request.context.target, replacement = pair.request.input.replacement;
      if (!!t !== !!replacement) return invalid();
      if (t && replacement) {
        const d = pair.task === "child_candidates" ? "child" : "adult", base = candidate(b, t.basePoolId);
        if (c[d]?.id !== t.basePoolId || !base || base.value.difficulty !== d ||
          !sameTranscript(base.value.binding.transcript, binding) || base.value.binding.analysisId !== selected.current.id ||
          base.value.binding.intentConfirmationId !== selected.confirmationId ||
          !same(replacement.candidate, base.value.draft.candidates.find(v => v.id === t.candidateId)) ||
          !same(replacement.otherCandidates, base.value.draft.candidates.filter(v => v.id !== t.candidateId)) ||
          pair.result.content.candidates.length !== 1 || pair.result.content.candidates[0]?.id !== t.candidateId) return invalid();
      }
    }
  }
}
function verifyPair(b: DomainBasis, pair: GenerationDomainPair) {
  pairMatches(b, pair);
  switch (pair.task) {
    case "correction": {
      if ("items" in pair.result.content) verifyCorrectionItems(pair.request.input.transcript, pair.result.content.items, invalid);
      else if (!materializeCorrectionDocument(pair.request.input.transcript, pair.result.content)) invalid();
      break;
    }
    case "intent_analysis": verifyIntentAnalysisContent(pair.request.input.transcript, pair.result.content, false, invalid); break;
    case "intent_critique":
      verifyIntentAnalysisContent(pair.request.input.transcript, pair.result.content.analysis, false, invalid);
      verifyIntentCritique(pair.request.input.analysis, pair.result.content.critique, invalid); break;
    case "summary": verifySummaryDraftBasis(pair.request.input.transcript, selection(b, pair.request.context.binding.transcript.version),
      pair.request.context.binding, pair.result.content, pair.request.context.binding.transcript.version, invalid); break;
    case "child_candidates": case "adult_candidates": {
      const binding = pair.request.context.binding, difficulty = pair.task === "child_candidates" ? "child" : "adult";
      verifyCandidateDraftBasis(pair.request.input.transcript, selection(b, binding.transcript.version), binding, pair.result.content, binding.transcript.version, false, invalid);
      const c = b.authority.content, opposite = c.state === "present" ? candidate(b, c[difficulty === "child" ? "adult" : "child"]?.id) : null;
      const target = pair.request.context.target, base = target ? candidate(b, target.basePoolId) : null;
      const draft = target && base ? { candidates: base.value.draft.candidates.map(v => v.id === target.candidateId ? pair.result.content.candidates[0]! : v) } : pair.result.content;
      const statuses = base?.value.statuses ?? Object.fromEntries(draft.candidates.map(c => [c.id, "use" as const]));
      verifyCandidateDraftBasis(pair.request.input.transcript, selection(b, binding.transcript.version), binding, draft, binding.transcript.version, !!target, invalid);
      verifyDistinctClues({ binding, draft, statuses }, opposite?.value ?? null, invalid); break;
    }
    default: return invalid();
  }
}
/** Only created after asynchronous basis validation. No caller verified flag. */
export async function createDomainValidationPort(rawBasis: unknown, budget: DomainResourceBudget): Promise<GenerationDomainValidationPort> {
  const basis = await validateDomainBasis(rawBasis, budget);
  return { validate(pair) {
    if (pair.task === "final_audit") return { outcome: "unavailable" };
    try {
      canonicalDomainJson(pair, budget);
      const p = generationDomainEnvelopeSchema.safeParse({ request: pair.request, result: pair.result });
      if (!p.success || pair.task !== p.data.request.task || pair.task !== p.data.result.task) return { outcome: "invalid" };
      verifyPair(basis, { task: pair.task, ...p.data } as GenerationDomainPair);
      return { outcome: "valid" };
    } catch { return { outcome: "invalid" }; }
  } };
}
function operationFromPair(pair: GenerationDomainPair, b: DomainBasis): DomainPrepared["operation"] {
  switch (pair.task) {
    case "correction": { const c = pair.request.context;
      const common = { sourceId: c.sourceId, sourceSha256: c.sourceSha256,
        baseDocumentId: c.baseRevisionId, baseDocumentSha256: c.baseTranscriptSha256 };
      return { family: "correction", operation: "items" in pair.result.content
        ? { ...common, items: pair.result.content.items }
        : { kind: "correction_document_v1", ...common,
          content: materializeCorrectionDocument(pair.request.input.transcript, pair.result.content)! } }; }
    case "intent_analysis": return { family: "intent", operation: { kind: "analysis", binding: pair.request.context.binding, analysis: pair.result.content } };
    case "intent_critique": return { family: "intent", operation: { kind: "critique", binding: pair.request.context.binding, baseAnalysisId: pair.request.context.baseAnalysisId, ...pair.result.content } };
    case "summary": return { family: "summary", operation: { kind: "generate", binding: pair.request.context.binding, draft: pair.result.content } };
    case "child_candidates": case "adult_candidates": {
      const replacement = pair.request.context.target;
      const draft = replacement ? { candidates: candidate(b, replacement.basePoolId)!.value.draft.candidates.map(c =>
        c.id === replacement.candidateId ? pair.result.content.candidates[0]! : c) } : pair.result.content;
      return { family: "candidate", operation: { kind: "generate", difficulty: pair.task === "child_candidates" ? "child" : "adult",
        binding: pair.request.context.binding, draft, ...(replacement ? { replacement } : {}) } };
    }
    default: return invalid();
  }
}

const preparedHandles = new WeakSet<object>();
const preparedDigests = new WeakMap<object, string>();
export function preparedDomainFingerprint(value: unknown): string | null {
  return isPreparedDomain(value) ? preparedDigests.get(value) ?? null : null;
}
export function isPreparedDomain(value: unknown): value is DomainPrepared {
  return !!value && typeof value === "object" && preparedHandles.has(value);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
async function prepare(b: DomainBasis, rawIdentity: unknown, operation: DomainPrepared["operation"], origin: "ai" | "human", budget: DomainResourceBudget): Promise<DomainPrepared> {
  const event = domainEventIdentitySchema.parse(rawIdentity), a = b.authority, input = a.input;
  const version = generationAggregateVersion(a);
  if (input.state !== "present" || version === null || !Number.isSafeInteger(version + 1) || b.references.references.some(r => r.eventId === event.id)) return invalid();
  const before = a.content;
  let after = structuredClone(before), materialized: DomainSnapshot | null = null;
  const e = { id: event.id, actorId: event.actorDigest, createdAt: event.createdAt, version: version + 1 };
  if (operation.family !== "correction") {
    const binding = domainTranscriptBinding(input, version);
    after = before.state === "absent" ? { state: "present", eventCount: 1, lastEventId: event.id,
      intent: null, availableCritique: null, summary: null, child: null, adult: null } : { ...structuredClone(before), eventCount: before.eventCount + 1, lastEventId: event.id };
    if (!Number.isSafeInteger(after.eventCount)) return invalid();
    if (operation.family === "intent") {
      const op = operation.operation, current = before.state === "present" ? intent(b, before.intent?.selectedId) : null;
      const targetId = op.kind === "analysis" ? null : op.kind === "critique" || op.kind === "edit" ? op.baseAnalysisId : op.analysisId;
      const target = intent(b, targetId);
      if (targetId && (!target || !sameTranscript(target.value.binding, binding))) return invalid();
      if ((op.kind === "analysis" || op.kind === "critique") && !same(op.binding, binding)) return invalid();
      const next = reduceIntentSnapshot({ ...e, operation: op }, current?.value ?? null,
        before.state === "present" ? before.intent?.confirmation?.id ?? null : null, target?.value ?? null, document(b, binding), invalid);
      const root = op.kind === "analysis" ? event.id : target?.provenance.rootAnalysisId;
      if (!root) return invalid();
      if (op.kind === "critique" && after.intent?.selectedId === root && after.intent.critique === null) {
        after.availableCritique = { id: event.id, rootAnalysisId: root };
      }
      if (next.created && next.created.id === event.id) materialized = { kind: "intent", value: intentSnapshotSchema.parse(next.created), operation: op,
        critique: op.kind === "critique" ? op.critique : null,
        provenance: { version: 1, input: target && op.kind === "edit" ? target.provenance.input : input,
          generationVersion: next.created.binding.version, payloadSha256: "0".repeat(64), rootAnalysisId: root } };
      if (op.kind === "edit" || op.kind === "select" || op.kind === "confirm" || before.state === "absent" || before.intent === null) {
        const selected = next.current;
        if (!selected) return invalid();
        after.intent = { selectedId: selected.id, rootAnalysisId: root, binding: { ...selected.binding },
          critique: selected.critiqueId ? { id: selected.critiqueId, rootAnalysisId: root } : null,
          confirmation: op.kind === "confirm" && selected.critiqueId ? { id: event.id, targetId: selected.id, critiqueId: selected.critiqueId, origin: "human" } : null };
        if (after.availableCritique && after.availableCritique.rootAnalysisId !== root) after.availableCritique = null;
        if (selected.critiqueId) after.availableCritique = { id: selected.critiqueId, rootAnalysisId: root };
      }
      if (op.kind === "edit" || op.kind === "select") for (const slot of ["summary", "child", "adult"] as const) {
        if (after[slot]) after[slot].review = null;
      }
    } else {
      const currentIntent = before.state === "present" ? before.intent : null;
      if (!currentIntent?.confirmation || !sameTranscript(currentIntent.binding, binding)) return invalid();
      const expectedBinding = { transcript: binding, analysisId: currentIntent.selectedId, intentConfirmationId: currentIntent.confirmation.id };
      const op = operation.operation;
      const target = "summaryId" in op ? summary(b, op.summaryId) : "poolId" in op ? candidate(b, op.poolId) : null;
      if (target?.kind === "candidate" && target.operation.kind === "generate" && target.operation.replacement &&
        (op.kind === "select" || op.kind === "restore") && before.state === "present" &&
        before[target.value.difficulty]?.id !== target.operation.replacement.basePoolId && before[target.value.difficulty]?.id !== target.value.id) return invalid();
      if (target && (!sameTranscript(target.value.binding.transcript, binding) || target.value.binding.analysisId !== expectedBinding.analysisId || target.value.binding.intentConfirmationId !== expectedBinding.intentConfirmationId)) return invalid();
      if ("binding" in op && !same(op.binding, expectedBinding)) return invalid();
      const selected = { current: intent(b, currentIntent.selectedId)?.value ?? null, confirmationId: currentIntent.confirmation.id };
      if (operation.family === "summary") {
        const op = operation.operation;
        if (op.kind === "generate" || op.kind === "edit") verifySummaryDraftBasis(document(b, binding), selected, op.binding, op.draft, version, invalid);
        const next = reduceSummarySnapshot({ ...e, operation: op }, summary(b, after.summary?.id)?.value ?? null,
          after.summary?.review?.id ?? null, target?.kind === "summary" ? target.value : null, invalid);
        if (next.created) materialized = { kind: "summary", value: summarySnapshotSchema.parse(next.created), operation: op, provenance: {
          version: 1, input: op.kind === "restore" && target ? target.provenance.input : input,
          generationVersion: next.created.binding.transcript.version, payloadSha256: "0".repeat(64), rootAnalysisId: null } };
        if (next.current) after.summary = { id: next.current.id, binding: structuredClone(next.current.binding),
          review: next.reviewId ? { id: next.reviewId, targetId: next.current.id, intentConfirmationId: next.current.binding.intentConfirmationId, origin: "human" } : null };
      } else {
        const op = operation.operation;
        if (op.kind === "generate" || op.kind === "edit") verifyCandidateDraftBasis(document(b, binding), selected, op.binding, op.draft, version, origin === "human" || op.kind === "generate" && !!op.replacement, invalid);
        const next = reduceCandidateSnapshot({ ...e, operation: op }, {
          child: candidate(b, after.child?.id)?.value ?? null, adult: candidate(b, after.adult?.id)?.value ?? null,
        }, { child: after.child?.review?.id ?? null, adult: after.adult?.review?.id ?? null }, target?.kind === "candidate" ? target.value : null, invalid);
        if (next.created) materialized = { kind: "candidate", value: candidateSnapshotSchema.parse(next.created), operation: op, provenance: {
          version: 1, input: (op.kind === "restore" || op.kind === "set_status") && target ? target.provenance.input : input,
          generationVersion: next.created.binding.transcript.version, payloadSha256: "0".repeat(64), rootAnalysisId: null } };
        for (const slot of ["child", "adult"] as const) {
          const s = next.current[slot];
          if (s) {
            const value = { id: s.id, binding: structuredClone(s.binding), review: next.reviews[slot] ? {
              id: next.reviews[slot], targetId: s.id, intentConfirmationId: s.binding.intentConfirmationId, origin: "human" as const } : null };
            if (slot === "child") after.child = { ...value, difficulty: "child" };
            else after.adult = { ...value, difficulty: "adult" };
          }
        }
      }
    }
  }
  if (materialized) materialized.provenance.payloadSha256 = await sha256Bytes(new TextEncoder().encode(canonicalDomainJson(domainSnapshotPayload(materialized), budget)));
  const result = domainPreparedSchema.parse({ operationVersion: 1, validatorVersion: 1,
    owner: { jobId: a.jobId, sermonId: a.sermonId, quizSetId: a.quizSetId }, context: b.context,
    origin, event, expectedInput: input, before, after, operation, materializedSnapshot: materialized });
  measureDomainEnvelope(result.materializedSnapshot, result, b, b.references.references.length, b.targetIds.length, null, budget);
  const bytes = new TextEncoder().encode(canonicalDomainJson(result, budget));
  preparedDigests.set(result, await sha256Bytes(bytes));
  preparedHandles.add(result);
  return freeze(result);
}
function safeFailure(error: unknown) {
  return { outcome: error instanceof DomainContractError && error.code === "DOMAIN_LIMIT" ? "limit_exceeded" as const : "invalid" as const };
}
export async function prepareDomainResult(rawBasis: unknown, rawPair: unknown, identity: unknown, budget: DomainResourceBudget) {
  try {
    const b = await validateDomainBasis(rawBasis, budget);
    canonicalDomainJson(rawPair, budget);
    const p = generationDomainEnvelopeSchema.safeParse(rawPair);
    if (!p.success || p.data.request.task !== p.data.result.task) return { outcome: "invalid" as const };
    if (p.data.request.task === "final_audit") return { outcome: "unavailable" as const };
    // Discriminants checked together above; downstream switch keeps task-specific data.
    const pair = { task: p.data.request.task, ...p.data } as GenerationDomainPair;
    verifyPair(b, pair);
    return { outcome: "prepared" as const, value: await prepare(b, identity, operationFromPair(pair, b), "ai", budget) };
  } catch (error) { return safeFailure(error); }
}
const humanCommandSchema = z.strictObject({ operation: domainOperationSchema, materializedSnapshot: z.unknown().optional() });
export async function prepareHumanCommand(rawBasis: unknown, command: unknown, identity: unknown, budget: DomainResourceBudget) {
  try {
    const b = await validateDomainBasis(rawBasis, budget);
    if (b.purpose !== "current") return { outcome: "invalid" as const };
    canonicalDomainJson(command, budget);
    const c = humanCommandSchema.parse(command), op = c.operation;
    if (op.family === "correction" || (op.family === "intent" ? ["analysis", "critique"].includes(op.operation.kind) : op.operation.kind === "generate")) return { outcome: "invalid" as const };
    const value = await prepare(b, identity, op, "human", budget);
    if (c.materializedSnapshot !== undefined && !same(c.materializedSnapshot, value.materializedSnapshot)) return { outcome: "invalid" as const };
    return { outcome: "prepared" as const, value };
  } catch (error) { return safeFailure(error); }
}
/** Mixed historical lineage is valid. Eligibility is separate and never edits refs. */
export function domainCurrentEligibility(basis: DomainBasis) {
  const a = basis.authority, c = a.content;
  if (a.input.state === "absent" || c.state === "absent") return { intent: false, summary: false, child: false, adult: false };
  const validIntent = !!a.input.confirmationId && !!c.intent?.confirmation &&
    sameTranscript(c.intent.binding, domainTranscriptBinding(a.input, generationAggregateVersion(a)!));
  const result = { intent: validIntent, summary: false, child: false, adult: false };
  for (const slot of ["summary", "child", "adult"] as const) {
    const v = c[slot]; result[slot] = validIntent && !!v?.review && sameTranscript(v.binding.transcript, c.intent!.binding) &&
      v.binding.analysisId === c.intent!.selectedId && v.binding.intentConfirmationId === c.intent!.confirmation!.id;
  }
  return result;
}
