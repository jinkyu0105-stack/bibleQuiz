import { createBibleReference } from "../../../shared/bible-reference";
import { canonicalDomainJson, type DomainResourceBudget } from "../../_shared/services/generation-domain-codec";
import { type DomainBasis, type DomainPrepared, domainSnapshotSchema, domainSnapshotPayload } from "../../_shared/services/generation-domain-contract";
import { sha256Bytes } from "../../_shared/storage/sha256";
import { domainTranscriptBinding } from "../../_shared/services/generation-domain";
import { intentFields, intentCritiqueSchema, type IntentAnalysis } from "../../_shared/services/sermon-intent-contract";
import type { AiDraftRequest, AiDraftResult } from "../../_shared/services/ai-draft-provider-contract";

// Test-only invocation budget. No product/storage limit is adopted by this fixture.
export const budget: DomainResourceBudget = { maxPayloadBytes: 4 * 1024 * 1024, chunkBytes: 65536, maxChunks: 64,
  maxReferences: 32, maxTargets: 10, maxDepth: 32, maxNodes: 100000, maxDecodedBytes: 32 * 1024 * 1024, maxBatchStatements: 40 };
export const now = "2026-09-19T00:00:00.000Z", hash = "a".repeat(64);
export const identity = (id: string) => ({ id, actorDigest: hash, createdAt: now });
export const raw = "TEST_ONLY_DOMAIN_PRIVATE 합성 근거";
export const sha = (text: string) => sha256Bytes(new TextEncoder().encode(text));
export function evidence(timed = false) { return { segmentId: timed ? "segment" : null, start: timed ? 1.25 : null,
  duration: timed ? 2.5 : null, from: 0, to: 9, quote: raw.slice(0, 9) }; }
export function analysis(timed = false): IntentAnalysis {
  return Object.fromEntries(intentFields.map(field => [field, [{ id: field, text: `TEST_ONLY_${field}`,
    origin: "transcript", evidence: [evidence(timed)] }]])) as IntentAnalysis;
}
export const clearCritique = { exaggeratedIntent: { assessment: "clear", concerns: [] }, unsupportedConclusion: { assessment: "clear", concerns: [] },
  illustrationAsMainClaim: { assessment: "clear", concerns: [] }, reversedMeaning: { assessment: "clear", concerns: [] } } as const;
export async function basis(timed = false): Promise<DomainBasis> {
  const r = createBibleReference({ bookId: "GEN", chapter: 1, verseStart: 1, verseEnd: 1 });
  if (!r.ok) throw new Error("fixture");
  const documentSha256 = await sha(raw), sourceSha256 = await sha("TEST_ONLY_SOURCE_PAYLOAD");
  const input: DomainBasis["documents"][number]["input"] = { state: "present", version: 2, sourceId: "original", sourceRevision: 1,
    sourceSha256, documentId: "original", documentSha256, checksumFormat: "sha256:utf8-working-text:v1",
    confirmationId: "confirmed", sourceKind: "caption", coverage: "full" };
  return { basisVersion: 1, purpose: "current", sourceRevisionMode: "sealed_event_version", context: { contextId: "context", fingerprint: hash },
    authority: { contractVersion: 1, jobId: "job", sermonId: "sermon", quizSetId: "quiz", jobStateVersion: 5, scope: "full", status: "running", wait: null,
      input, content: { state: "absent" }, metadata: { contractVersion: 1, sermonId: "sermon", metadataRevision: 1, title: "TEST_ONLY_TITLE", sermonDate: "2026-09-19", bibleReference: r.value }, selection: { state: "unavailable" } },
    references: { referenceVersion: 2, references: [
      { kind: "input", sermonId: "sermon", eventId: "original", eventVersion: 1, sourceSha256, documentSha256, payloadSha256: hash },
      { kind: "input", sermonId: "sermon", eventId: "confirmed", eventVersion: 2, sourceSha256: null, documentSha256: null, payloadSha256: hash },
    ] }, targetIds: [], documents: [{ input, content: timed ? { format: "timed_segments", segments: [{ segmentId: "segment", text: raw, start: 1.25, duration: 2.5 }] } : { format: "plain_text", text: raw } }],
    snapshots: [], intentSelections: [], humanRecords: [] };
}
export function version(b: DomainBasis) { return b.authority.input.state === "present" ? b.authority.input.version + (b.authority.content.state === "present" ? b.authority.content.eventCount : 0) : 0; }
export function binding(b: DomainBasis) {
  if (b.authority.input.state !== "present") throw new Error("fixture");
  return domainTranscriptBinding(b.authority.input, version(b));
}
export function pair(b: DomainBasis, task: "intent_analysis" | "intent_critique" | "summary" | "child_candidates" | "adult_candidates", timed = false): { request: AiDraftRequest; result: AiDraftResult } {
  const transcript = structuredClone(b.documents.find(d => d.input.documentId === binding(b).revisionId)!.content);
  const content = b.authority.content, selectedId = content.state === "present" ? content.intent?.selectedId : null;
  const selected = b.snapshots.find(s => s.kind === "intent" && s.value.id === selectedId);
  if (task === "intent_analysis") {
    const context = { sermonId: "sermon", binding: binding(b) };
    return { request: { task, context, input: { transcript } }, result: { task, context, content: analysis(timed) } };
  }
  if (task === "intent_critique") {
    const root = b.snapshots.find(s => s.kind === "intent" && s.value.kind === "analysis")!;
    if (root.kind !== "intent") throw new Error("fixture");
    const context = { sermonId: "sermon", binding: binding(b), baseAnalysisId: root.value.id };
    return { request: { task, context, input: { transcript, analysis: root.value.analysis } }, result: { task, context,
      content: { analysis: analysis(timed), critique: intentCritiqueSchema.parse(clearCritique) } } };
  }
  if (content.state !== "present" || !content.intent?.confirmation || selected?.kind !== "intent") throw new Error("fixture");
  const context = { sermonId: "sermon", binding: { transcript: binding(b), analysisId: selected.value.id, intentConfirmationId: content.intent.confirmation.id } };
  const input = { transcript, intent: selected.value.analysis };
  if (task === "summary") return { request: { task, context, input }, result: { task, context,
    content: { paragraphs: [{ id: "paragraph", text: "TEST_ONLY_SUMMARY", intentClaimIds: ["centralMessage"], evidence: [evidence(timed)] }] } } };
  return { request: { task, context, input }, result: { task, context, content: { candidates: [{
    id: task === "child_candidates" ? "child_word" : "adult_word", displayAnswer: "합성", gridAnswer: "합성", clue: `TEST_ONLY_${task}`,
    phraseDescription: "TEST_ONLY", selectionReason: "TEST_ONLY", sermonImportance: "TEST_ONLY", difficultyReason: "TEST_ONLY",
    grounding: { origin: "transcript", intentClaimIds: ["centralMessage"], evidence: [evidence(timed)] },
  }] } } };
}
/** Synthetic append of prepared values. No DB witness or durability assertion. */
export function append(b: DomainBasis, p: DomainPrepared): DomainBasis {
  const next = structuredClone(b);
  next.authority.content = structuredClone(p.after);
  if (p.operation.family === "correction") throw new Error("fixture does not append input");
  if (p.materializedSnapshot) next.snapshots.push(domainSnapshotSchema.parse(p.materializedSnapshot));
  next.references.references.push({ kind: "content", sermonId: "sermon", eventId: p.event.id, eventVersion: version(b) + 1,
    payloadSha256: p.materializedSnapshot?.provenance.payloadSha256 ?? hash });
  const op = p.operation.operation;
  if (p.origin === "human" && (op.kind === "confirm" || op.kind === "review")) {
    const targetId = "analysisId" in op ? op.analysisId : "summaryId" in op ? op.summaryId : "poolId" in op ? op.poolId : "";
    const c = p.after;
    next.humanRecords.push({ id: p.event.id, kind: op.kind === "confirm" ? "confirmation" : "review", targetId,
      intentConfirmationId: op.kind === "review" && c.state === "present" ? c.intent!.confirmation!.id : null, actorDigest: p.event.actorDigest, createdAt: p.event.createdAt });
  }
  const c = next.authority.content;
  if (c.state === "present" && c.intent?.confirmation) next.intentSelections.push({ atVersion: version(next), selectedId: c.intent.selectedId, confirmationId: c.intent.confirmation.id });
  return next;
}
export async function rehashSnapshot(b: DomainBasis, id: string) {
  const s = b.snapshots.find(s => s.value.id === id)!;
  s.provenance.payloadSha256 = await sha(canonicalDomainJson(domainSnapshotPayload(s), budget));
  b.references.references.find(r => r.eventId === id)!.payloadSha256 = s.provenance.payloadSha256;
}
