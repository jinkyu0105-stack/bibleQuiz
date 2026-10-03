import { createBibleReference } from "../../../shared/bible-reference";
import { generationAuthoritySnapshotSchema, type GenerationAuthoritySnapshot, type GenerationScope, type GenerationWait } from "../../_shared/services/generation-bridge-contract";
import { generationAggregateVersion } from "../../_shared/services/generation-bridge";
import { finalCheckTicketSchema, type FinalCheckTicket } from "../../_shared/services/final-check-contract";
import type { IntentBinding } from "../../_shared/services/sermon-intent-contract";
import type { SummaryBinding } from "../../_shared/services/sermon-summary-contract";
export const hash = "a".repeat(64);
export function transcript(version: number): IntentBinding {
  return { sourceId: "source", sourceRevision: 1, sourceSha256: hash, revisionId: "document",
    transcriptSha256: hash, checksumFormat: "sha256:utf8-working-text:v1", confirmationId: "confirmed", version };
}
export function binding(version: number): SummaryBinding {
  return { transcript: transcript(version), analysisId: "analysis", intentConfirmationId: "intent-confirmed" };
}
export function snapshot(scope: GenerationScope = "full"): GenerationAuthoritySnapshot {
  const reference = createBibleReference({ bookId: "GEN", chapter: 1, verseStart: 1, verseEnd: 1 });
  if (!reference.ok) throw new Error("Invalid test reference");
  const options = { gridSizes: [5], targetWordCounts: [3], seed: "synthetic", maxTrials: 1, searchBudgetPerTrial: 10 };
  return generationAuthoritySnapshotSchema.parse({
    contractVersion: 1, jobId: "job", sermonId: "sermon", quizSetId: "quiz", jobStateVersion: 5,
    scope, status: "running", wait: null,
    input: { state: "present", version: 2, sourceId: "source", sourceRevision: 1, sourceSha256: hash,
      documentId: "document", documentSha256: hash, checksumFormat: "sha256:utf8-working-text:v1",
      confirmationId: "confirmed", sourceKind: "caption", coverage: "full" },
    content: { state: "present", eventCount: 10, lastEventId: "adult-review",
      intent: { selectedId: "analysis", rootAnalysisId: "root", binding: transcript(2),
        critique: { id: "critique", rootAnalysisId: "root" },
        confirmation: { id: "intent-confirmed", targetId: "analysis", critiqueId: "critique", origin: "human" } },
      summary: { id: "summary", binding: binding(5), review: { id: "summary-review", targetId: "summary", intentConfirmationId: "intent-confirmed", origin: "human" } },
      child: { id: "child", difficulty: "child", binding: binding(6), review: { id: "child-review", targetId: "child", intentConfirmationId: "intent-confirmed", origin: "human" } },
      adult: { id: "adult", difficulty: "adult", binding: binding(7), review: { id: "adult-review", targetId: "adult", intentConfirmationId: "intent-confirmed", origin: "human" } } },
    metadata: { contractVersion: 1, sermonId: "sermon", metadataRevision: 1, title: "TEST_ONLY_TITLE", sermonDate: "2026-09-17", bibleReference: reference.value },
    selection: { state: "present", settingsRevision: 1, selectionRevision: 1,
      value: { child: { options, index: 0 }, adult: { options, index: 0 } } },
  });
}
export function content(s: GenerationAuthoritySnapshot) {
  if (s.content.state !== "present") throw new Error("Missing fixture content");
  return s.content;
}
export function input(s: GenerationAuthoritySnapshot) {
  if (s.input.state !== "present") throw new Error("Missing fixture input");
  return s.input;
}
export function ticket(s: GenerationAuthoritySnapshot): FinalCheckTicket {
  const c = content(s), version = generationAggregateVersion(s)!;
  if (!c.summary || !c.child || !c.adult || s.selection.state !== "present") throw new Error("Missing fixture selection");
  const place = (difficulty: "child" | "adult") => ({
    ticket: { sermonId: s.sermonId, difficulty, expectedVersion: version,
      poolId: c[difficulty]!.id, reviewId: c[difficulty]!.review!.id,
      binding: c[difficulty]!.binding, options: s.selection.state === "present" ? s.selection.value[difficulty].options : {} }, index: 0,
  });
  return finalCheckTicketSchema.parse({ sermonId: s.sermonId, expectedVersion: version,
    metadata: s.metadata, binding: binding(version),
    summary: { summaryId: c.summary.id, reviewId: c.summary.review!.id, binding: c.summary.binding },
    placements: { child: place("child"), adult: place("adult") } });
}
export function waiting(kind: GenerationWait["kind"]) {
  const s = snapshot();
  s.status = kind === "transcript_review" ? "awaiting_transcript_review" : "awaiting_intent_review";
  s.wait = { kind, generation: 2 };
  const wait: GenerationWait = { contractVersion: 1, jobId: s.jobId, sermonId: s.sermonId, quizSetId: s.quizSetId,
    kind, generation: 2, jobStateVersion: s.jobStateVersion, input: structuredClone(input(s)), content: structuredClone(s.content),
    metadataRevision: s.metadata.metadataRevision, selection: structuredClone(s.selection), rootAnalysisId: kind === "intent_review" ? "root" : null };
  return { s, wait };
}

import type { GenerationContext, HistoricalOutcome, TransitionEvidence, UsageObservation } from "../../_shared/services/generation-lifecycle-contract";
export const now = "2026-09-17T00:00:00.000Z";
export const later = "2026-09-17T00:01:00.000Z";
export const contextRef = { contextId: "context", fingerprint: hash };
export function references(): GenerationContext["references"] {
  return ["source", "document", "confirmed", "analysis", "root", "critique", "intent-confirmed", "summary", "summary-review", "child", "child-review", "adult", "adult-review"]
    .map((eventId) => ({ sermonId: "sermon", eventId, kind: ["source", "document", "confirmed"].includes(eventId) ? "input" : "content", sha256: hash }));
}
export function requestContext(): Extract<GenerationContext, { kind: "request" }> {
  const authority = snapshot(); authority.jobStateVersion = 0; authority.status = "dispatch_pending";
  return { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "request", references: references(), authority, actorDigest: hash, guidance: null };
}
export function stepContext(): Extract<GenerationContext, { kind: "step" }> {
  return { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "step", references: references(),
    authority: snapshot("summary"), request: structuredClone(contextRef), stepKey: "summary", execution: { task: "summary", context: { sermonId: "sermon", binding: binding(12) } },
    predecessor: { kind: "outcome", eventNo: 6, stateVersion: 5 }, command: null, guidance: null };
}
export function waitContext(): Extract<GenerationContext, { kind: "wait" }> {
  return { contractVersion: 2, validatorVersion: 1, assemblyVersion: 1, kind: "wait", references: references(),
    request: structuredClone(contextRef), wait: waiting("transcript_review").wait, enter: { eventNo: 6, stateVersion: 5 }, parent: null };
}
export function evidence(stage: TransitionEvidence["after"]["stage"] = "summary", version = 5): TransitionEvidence {
  return { jobId: "job", eventNo: version + 1,
    before: { stateVersion: version - 1, status: "running", stage, waitGeneration: null },
    after: { stateVersion: version, status: "running", stage, waitGeneration: null },
    reason: "step_succeeded", context: structuredClone(contextRef), stepKey: stage, attempt: 1, dispatchKey: null, commandKey: null };
}
export function usage(): UsageObservation {
  return { contractVersion: 2, callId: "call", usageId: "usage", jobId: "job", sermonId: "sermon", quizSetId: "quiz", stepKey: "summary", attempt: 1, task: "summary",
    context: structuredClone(contextRef), inputFingerprint: hash, provider: "synthetic", model: "synthetic_model", reasoningEffort: null, providerRequestIdOpaque: null,
    inputTokens: 100, cachedInputTokens: null, reasoningTokens: null, outputTokens: 20, audioInputTokens: null, audioSeconds: null,
    pricingVersion: "synthetic_price", estimatedCostMicroUsd: 2, usageSource: "provider_partial", startedAt: now, observedAt: later };
}
export function historical(outcome: HistoricalOutcome["outcome"] = "success"): HistoricalOutcome {
  const s = snapshot(), e = evidence();
  e.reason = ({ success: "step_succeeded", rejected: "step_rejected", stale: "step_stale", uncertain: "step_uncertain" } as const)[outcome];
  if (outcome === "rejected") e.after.status = "failed";
  if (outcome === "stale") e.after.status = "stale";
  return { identity: { jobId: "job", sermonId: "sermon", quizSetId: "quiz", stepKey: "summary", task: "summary", attempt: 1,
    inputFingerprint: hash, context: structuredClone(contextRef), event: { eventNo: e.eventNo, stateVersion: e.after.stateVersion } },
    outcome, reason: ({ success: "none", rejected: "domain_invalid", stale: "authority_changed", uncertain: "usage_unknown" } as const)[outcome],
    before: { input: structuredClone(s.input), content: structuredClone(s.content) }, after: { input: structuredClone(s.input), content: structuredClone(s.content) },
    result: outcome === "success" ? { kind: "content", id: "result", version: 12, fingerprint: hash } : null,
    callId: "call", usage: outcome === "uncertain" ? null : usage(), evidence: e };
}
