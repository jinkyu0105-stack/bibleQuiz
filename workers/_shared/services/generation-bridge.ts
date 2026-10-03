import { z } from "zod";
import {
  authorityQuerySchema, authorityReadSchema, generationAuthoritySnapshotSchema,
  generationDomainEnvelopeSchema, generationFinalCaptureSchema, generationScopeSchema, generationStageSchema, generationWaitSchema,
  type BridgeDecision, type GenerationAssemblyAuthorityPort, type GenerationAuthoritySnapshot,
  type GenerationBridgeFailure, type GenerationDomainPair, type GenerationDomainValidationPort,
  type GenerationScope, type GenerationStage,
} from "./generation-bridge-contract";
import { sameTranscript } from "./sermon-intent";
import type { IntentBinding } from "./sermon-intent-contract";
import type { SummaryBinding } from "./sermon-summary-contract";

function fail(outcome: GenerationBridgeFailure["outcome"], reason: GenerationBridgeFailure["reason"]): GenerationBridgeFailure {
  return { outcome, reason };
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const entries = Object.entries(a);
  return entries.length === Object.keys(b).length && entries.every(([key, value]) =>
    Object.hasOwn(b, key) && same(value, Reflect.get(b, key)));
}
function eventCount(s: GenerationAuthoritySnapshot): number {
  return s.content.state === "present" ? s.content.eventCount : 0;
}
export function generationAggregateVersion(s: GenerationAuthoritySnapshot): number | null {
  if (s.input.state !== "present") return null;
  const version = s.input.version + eventCount(s);
  return Number.isSafeInteger(version) ? version : null;
}
function transcriptBinding(s: GenerationAuthoritySnapshot): IntentBinding | null {
  const input = s.input, version = generationAggregateVersion(s);
  if (input.state !== "present" || !input.confirmationId || version === null) return null;
  return { sourceId: input.sourceId, sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256,
    revisionId: input.documentId, transcriptSha256: input.documentSha256, checksumFormat: input.checksumFormat,
    confirmationId: input.confirmationId, version };
}
function currentBinding(s: GenerationAuthoritySnapshot): SummaryBinding | null {
  const transcript = transcriptBinding(s), intent = s.content.state === "present" ? s.content.intent : null;
  if (!transcript || !intent || !intent.critique || !intent.confirmation ||
    !sameTranscript(intent.binding, transcript) || intent.binding.version > transcript.version ||
    intent.critique.rootAnalysisId !== intent.rootAnalysisId ||
    intent.confirmation.targetId !== intent.selectedId || intent.confirmation.critiqueId !== intent.critique.id) return null;
  return { transcript, analysisId: intent.selectedId, intentConfirmationId: intent.confirmation.id };
}
function sameBinding(a: SummaryBinding, b: SummaryBinding) {
  return sameTranscript(a.transcript, b.transcript) && a.analysisId === b.analysisId && a.intentConfirmationId === b.intentConfirmationId;
}
function contentReviewed(s: GenerationAuthoritySnapshot): boolean {
  const binding = currentBinding(s);
  if (!binding || s.content.state !== "present") return false;
  return [s.content.summary, s.content.child, s.content.adult].every((slot) => slot &&
    slot.binding.transcript.version <= binding.transcript.version && sameBinding(slot.binding, binding) &&
    slot.review?.targetId === slot.id && slot.review.intentConfirmationId === binding.intentConfirmationId);
}

export function classifyGenerationAuthority(raw: unknown):
  | { outcome: "captured"; snapshot: GenerationAuthoritySnapshot } | GenerationBridgeFailure {
  const parsed = authorityReadSchema.safeParse(raw);
  if (!parsed.success) return fail("corrupt", "storage_corrupt");
  const value = parsed.data;
  switch (value.outcome) {
    case "captured":
      if (value.snapshot.input.state === "present" && generationAggregateVersion(value.snapshot) === null) {
        return fail("corrupt", "storage_corrupt");
      }
      return value;
    case "absent": return fail("not_ready", "absent");
    case "changed": return fail("stale", "read_changed");
    case "corrupt": return fail("corrupt", "storage_corrupt");
    case "unavailable": return fail("unavailable", "storage_unavailable");
    case "limit_exceeded": return fail("not_ready", "limit_exceeded");
  }
}
export async function readGenerationAuthority(port: GenerationAssemblyAuthorityPort, query: unknown) {
  const parsed = authorityQuerySchema.safeParse(query);
  if (!parsed.success) return fail("not_ready", "limit_exceeded");
  try {
    const read = classifyGenerationAuthority(await port.read(parsed.data));
    if (read.outcome === "captured" && (read.snapshot.jobId !== parsed.data.jobId ||
      read.snapshot.sermonId !== parsed.data.sermonId || read.snapshot.quizSetId !== parsed.data.quizSetId)) {
      return fail("corrupt", "storage_corrupt");
    }
    return read;
  } catch { return fail("unavailable", "storage_unavailable"); }
}

const finalStages = ["content_review", "place_child", "place_adult", "final_validate", "final_audit", "finish"] as const;
const currentFinalStages = ["content_review", "place_child", "place_adult", "final_validate", "finish"] as const;
const plans: Record<Exclude<GenerationScope, "single_entry">, readonly GenerationStage[]> = {
  full: ["input_resolve", "transcript_review", "intent_analysis", "intent_critique", "intent_review",
    "summary", "child_candidates", "adult_candidates", ...finalStages],
  transcript_correction: ["correction", "finish"],
  intent: ["transcript_review", "intent_analysis", "intent_critique", "intent_review", "finish"],
  summary: ["summary", "finish"], child: ["child_candidates", "finish"], adult: ["adult_candidates", "finish"],
  final_audit: finalStages,
};
/** Completed prefix must come from verified receipts/wait transitions. This
 * function neither proves persisted success nor reclaims a past receipt. */
export function nextGenerationStage(scope: unknown, completed: unknown, requestContractVersion: 2 | 3 = 2):
  | { outcome: "next"; stage: GenerationStage } | { outcome: "complete" } | GenerationBridgeFailure {
  const parsed = generationScopeSchema.safeParse(scope);
  const prefix = z.array(generationStageSchema).max(15).safeParse(completed);
  if (!parsed.success || !prefix.success) return fail("not_ready", "stage_mismatch");
  if (parsed.data === "single_entry") return fail("not_ready", "scope_unsupported");
  if (requestContractVersion === 3 && parsed.data === "final_audit") return fail("not_ready", "scope_unsupported");
  const plan = requestContractVersion === 3 && parsed.data === "full"
    ? [...plans.full.slice(0, -finalStages.length), ...currentFinalStages] : plans[parsed.data];
  if (prefix.data.some((stage, index) => plan[index] !== stage)) return fail("not_ready", "stage_mismatch");
  const stage = plan[prefix.data.length];
  return stage ? { outcome: "next", stage } : { outcome: "complete" };
}

/** Planning eligibility only: ready never authorizes a write, network call or publish. */
export function assessGenerationStage(raw: unknown, completed: unknown, requestContractVersion: 2 | 3 = 2): BridgeDecision | { outcome: "ready"; stage: GenerationStage } {
  const parsed = generationAuthoritySnapshotSchema.safeParse(raw);
  if (!parsed.success) return fail("corrupt", "storage_corrupt");
  const s = parsed.data, next = nextGenerationStage(s.scope, completed, requestContractVersion);
  if (next.outcome !== "next") return next.outcome === "complete" ? fail("not_ready", "stage_mismatch") : next;
  if (s.status !== "running" || s.wait !== null) return fail("not_ready", "job_not_running");
  const stage = next.stage;
  if ((s.scope === "full" || s.scope === "final_audit") && s.selection.state !== "present") {
    return fail("not_ready", "selection_unavailable");
  }
  if (stage === "input_resolve") return { outcome: "ready", stage };
  if (s.input.state !== "present") return fail("not_ready", "input_required");
  if (generationAggregateVersion(s) === null) return fail("corrupt", "storage_corrupt");
  if (stage === "correction") return s.input.sourceKind === "caption" ? { outcome: "ready", stage } : fail("not_ready", "input_read_only");
  if (stage === "finish" && s.scope === "transcript_correction") return { outcome: "ready", stage };
  const binding = transcriptBinding(s);
  if (!binding) return fail("not_ready", "input_unconfirmed");
  if (stage === "transcript_review" || stage === "intent_analysis") return { outcome: "ready", stage };
  if (stage === "intent_critique") {
    const intent = s.content.state === "present" ? s.content.intent : null;
    return intent && sameTranscript(intent.binding, binding) && intent.binding.version <= binding.version
      ? { outcome: "ready", stage } : fail("not_ready", "intent_unconfirmed");
  }
  if (!currentBinding(s)) return fail("not_ready", "intent_unconfirmed");
  if ((s.scope === "full" || s.scope === "final_audit") && (finalStages as readonly string[]).includes(stage)) {
    if (!contentReviewed(s)) return fail("needs_revision", "content_review");
    if (s.input.sourceKind === "caption" && s.input.coverage === "partial") return fail("needs_revision", "partial_disclosure");
  }
  return { outcome: "ready", stage };
}

/** Wake payload is intentionally absent. Only an authoritative active wait and
 * validated source/analysis lineage can grant a new-step capture. */
export function assessGenerationWait(rawWait: unknown, rawCurrent: unknown): BridgeDecision {
  const w = generationWaitSchema.safeParse(rawWait), c = generationAuthoritySnapshotSchema.safeParse(rawCurrent);
  if (!w.success || !c.success) return fail("corrupt", "storage_corrupt");
  const wait = w.data, s = c.data;
  if (s.jobId !== wait.jobId || s.sermonId !== wait.sermonId || s.quizSetId !== wait.quizSetId ||
    s.wait?.kind !== wait.kind || s.wait.generation !== wait.generation || s.jobStateVersion !== wait.jobStateVersion ||
    s.status !== (wait.kind === "transcript_review" ? "awaiting_transcript_review" : "awaiting_intent_review")) {
    return fail("stale", "lineage_changed");
  }
  if (s.input.state !== "present" || s.metadata.metadataRevision !== wait.metadataRevision || !same(s.selection, wait.selection)) {
    return fail("stale", "lineage_changed");
  }
  if (wait.kind === "transcript_review") {
    const old = wait.input, now = s.input;
    if (now.version < old.version || now.sourceId !== old.sourceId || now.sourceRevision !== old.sourceRevision ||
      now.sourceSha256 !== old.sourceSha256 || now.sourceKind !== old.sourceKind || now.coverage !== old.coverage ||
      !same(s.content, wait.content) || (now.version === old.version && !same(now, old)) ||
      (now.sourceKind !== "caption" && (now.documentId !== old.documentId || now.documentSha256 !== old.documentSha256))) {
      return fail("stale", "lineage_changed");
    }
    return now.confirmationId ? { outcome: "ready" } : fail("not_ready", "input_unconfirmed");
  }
  if (!same(s.input, wait.input) || s.content.state !== "present" || wait.content.state !== "present" ||
    s.content.eventCount < wait.content.eventCount || s.content.intent?.rootAnalysisId !== wait.rootAnalysisId) return fail("stale", "lineage_changed");
  // Choosing a new intent clears downstream human reviews while preserving their
  // selected snapshots. That exact invalidation is allowed for intent-only work.
  const downstream = (["summary", "child", "adult"] as const).every(slot => {
    const before = wait.content.state === "present" ? wait.content[slot] : null;
    const after = s.content.state === "present" ? s.content[slot] : null;
    return s.scope === "intent" ? same(before && { ...before, review: null }, after && { ...after, review: null }) &&
      (after?.review === null || same(after?.review, before?.review)) : same(before, after);
  });
  if (!downstream || s.content.eventCount === wait.content.eventCount && !same(s.content, wait.content)) return fail("stale", "lineage_changed");
  return currentBinding(s) ? { outcome: "ready" } : fail("not_ready", "intent_unconfirmed");
}

/** Reconcile one verified own append before capturing the NEXT step. The proof
 * is a private port contract, not a replacement for an exact persisted bundle probe. */
const ownAppendSchema = z.strictObject({
  jobId: z.string(), task: z.enum(["summary", "child_candidates", "adult_candidates"]),
  eventId: z.string(), beforeVersion: z.int().positive(), resultVersion: z.int().positive(),
  expectedContentEventCount: z.int().nonnegative(),
});
export function assessOwnContentAdvance(before: unknown, current: unknown, proof: unknown): BridgeDecision {
  const b = generationAuthoritySnapshotSchema.safeParse(before), c = generationAuthoritySnapshotSchema.safeParse(current), p = ownAppendSchema.safeParse(proof);
  if (!b.success || !c.success || !p.success) return fail("corrupt", "storage_corrupt");
  const old = b.data, now = c.data, own = p.data;
  if (!(old.scope === "full" || old.scope === (own.task === "child_candidates" ? "child" : own.task === "adult_candidates" ? "adult" : "summary")) ||
    old.jobId !== own.jobId || now.jobId !== own.jobId || old.sermonId !== now.sermonId || old.quizSetId !== now.quizSetId ||
    old.scope !== now.scope || old.status !== "running" || now.status !== "running" || old.wait || now.wait ||
    now.jobStateVersion !== old.jobStateVersion + 1 || !same(old.input, now.input) ||
    !same(old.metadata, now.metadata) || !same(old.selection, now.selection) ||
    own.beforeVersion !== generationAggregateVersion(old) || own.resultVersion !== own.beforeVersion + 1 ||
    generationAggregateVersion(now) !== own.resultVersion || eventCount(old) !== own.expectedContentEventCount ||
    now.content.state !== "present" || now.content.eventCount !== own.expectedContentEventCount + 1 || now.content.lastEventId !== own.eventId ||
    old.content.state !== "present" || !same(old.content.intent, now.content.intent)) return fail("stale", "capture_changed");
  const key = own.task === "summary" ? "summary" : own.task === "child_candidates" ? "child" : "adult";
  for (const slot of ["summary", "child", "adult"] as const) {
    const previous = old.content[slot], next = now.content[slot];
    if (slot !== key || previous !== null) {
      if (!same(previous, next)) return fail("stale", "capture_changed");
    } else {
      const binding = currentBinding(old);
      if (!next || !binding || next.id !== own.eventId || next.review !== null || !same(next.binding, binding)) {
        return fail("stale", "capture_changed");
      }
    }
  }
  return { outcome: "ready" };
}

/** Existing final schema already separates top-level/placement capture versions
 * from the original summary/pool bindings. Never rewrite nested versions. */
export function assessFinalCapture(raw: unknown, ticket: unknown): BridgeDecision {
  const s = generationAuthoritySnapshotSchema.safeParse(raw), t = generationFinalCaptureSchema.safeParse(ticket);
  if (!s.success || !t.success) return fail("corrupt", "storage_corrupt");
  const current = s.data, captured = t.data.ticket, binding = currentBinding(current);
  if (!contentReviewed(current) || current.content.state !== "present") return fail("needs_revision", "content_review");
  if (current.selection.state !== "present") return fail("not_ready", "selection_unavailable");
  if (current.input.state === "present" && current.input.sourceKind === "caption" && current.input.coverage === "partial") {
    return fail("needs_revision", "partial_disclosure");
  }
  if (t.data.settingsRevision !== current.selection.settingsRevision || t.data.selectionRevision !== current.selection.selectionRevision ||
    captured.sermonId !== current.sermonId || captured.expectedVersion !== generationAggregateVersion(current) ||
    !same(captured.metadata, current.metadata) || !same(captured.binding, binding) ||
    captured.summary.summaryId !== current.content.summary?.id || captured.summary.reviewId !== current.content.summary.review?.id ||
    !same(captured.summary.binding, current.content.summary.binding)) return fail("stale", "capture_changed");
  for (const difficulty of ["child", "adult"] as const) {
    const ref = captured.placements[difficulty], slot = current.content[difficulty], choice = current.selection.value[difficulty];
    if (!slot || ref.ticket.poolId !== slot.id || ref.ticket.reviewId !== slot.review?.id ||
      !same(ref.ticket.binding, slot.binding) || !same(ref.ticket.options, choice.options) || ref.index !== choice.index) {
      return fail("stale", "capture_changed");
    }
  }
  return { outcome: "ready" };
}

/** P40-G01 composes strict shape/context validation with an injected semantic
 * verdict only. It never creates a storage command or claims domain migration. */
export function assessGenerationDomain(port: GenerationDomainValidationPort, raw: unknown): BridgeDecision {
  const parsed = generationDomainEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return fail("not_ready", "domain_invalid");
  const { request, result } = parsed.data;
  if (request.task !== result.task || !same(request.context, result.context)) return fail("stale", "context_mismatch");
  try {
    // The discriminants were checked above; this pairs each task with its own schemas.
    const verdict = z.strictObject({ outcome: z.enum(["valid", "invalid", "unavailable"]) }).safeParse(
      port.validate({ task: request.task, request, result } as GenerationDomainPair));
    if (!verdict.success || verdict.data.outcome === "unavailable") return fail("unavailable", "domain_unavailable");
    return verdict.data.outcome === "valid" ? { outcome: "ready" } : fail("not_ready", "domain_invalid");
  } catch { return fail("unavailable", "domain_unavailable"); }
}
