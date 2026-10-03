import { describe, expect, it, vi } from "vitest";
import { createBibleReference } from "../../shared/bible-reference";
import {
  generationAuthoritySnapshotSchema, type GenerationAuthoritySnapshot, type GenerationDomainValidationPort,
  type GenerationScope, type GenerationWait,
} from "../_shared/services/generation-bridge-contract";
import {
  assessFinalCapture as assessCapture, assessGenerationDomain, assessGenerationStage, assessGenerationWait,
  assessOwnContentAdvance, classifyGenerationAuthority, generationAggregateVersion,
  nextGenerationStage, readGenerationAuthority,
} from "../_shared/services/generation-bridge";
import { finalCheckTicketSchema, type FinalCheckTicket } from "../_shared/services/final-check-contract";
import { intentAnalysisSchema, intentFields, type IntentBinding } from "../_shared/services/sermon-intent-contract";
import type { SummaryBinding } from "../_shared/services/sermon-summary-contract";

// All fixtures were captured with these explicit durable revisions.
function assessFinalCapture(s: unknown, ticket: unknown) {
  return assessCapture(s, { ticket, settingsRevision: 1, selectionRevision: 1 });
}
const hash = "a".repeat(64);
const privateCanary = "TEST_ONLY_PRIVATE_BRIDGE_CANARY";
function transcript(version: number): IntentBinding {
  return { sourceId: "source", sourceRevision: 1, sourceSha256: hash, revisionId: "document",
    transcriptSha256: hash, checksumFormat: "sha256:utf8-working-text:v1", confirmationId: "confirmed", version };
}
function binding(version: number): SummaryBinding {
  return { transcript: transcript(version), analysisId: "analysis", intentConfirmationId: "intent-confirmed" };
}
function snapshot(scope: GenerationScope = "full"): GenerationAuthoritySnapshot {
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
function content(s: GenerationAuthoritySnapshot) {
  if (s.content.state !== "present") throw new Error("Missing fixture content");
  return s.content;
}
function input(s: GenerationAuthoritySnapshot) {
  if (s.input.state !== "present") throw new Error("Missing fixture input");
  return s.input;
}
function ticket(s: GenerationAuthoritySnapshot): FinalCheckTicket {
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
function waiting(kind: GenerationWait["kind"]) {
  const s = snapshot();
  s.status = kind === "transcript_review" ? "awaiting_transcript_review" : "awaiting_intent_review";
  s.wait = { kind, generation: 2 };
  const wait: GenerationWait = { contractVersion: 1, jobId: s.jobId, sermonId: s.sermonId, quizSetId: s.quizSetId,
    kind, generation: 2, jobStateVersion: s.jobStateVersion, input: structuredClone(input(s)), content: structuredClone(s.content),
    metadataRevision: s.metadata.metadataRevision, selection: structuredClone(s.selection), rootAnalysisId: kind === "intent_review" ? "root" : null };
  return { s, wait };
}
const fullPrefix = ["input_resolve", "transcript_review", "intent_analysis", "intent_critique", "intent_review", "summary", "child_candidates", "adult_candidates"];

describe("P40-G01 authority and domain bridge (no D1 or provider)", () => {
  it.each([
    ["full", "input_resolve"], ["transcript_correction", "correction"], ["intent", "transcript_review"],
    ["summary", "summary"], ["child", "child_candidates"], ["adult", "adult_candidates"], ["final_audit", "content_review"],
  ])("P40-02 starts %s only at %s", (scope, stage) => {
    expect(nextGenerationStage(scope, [])).toEqual({ outcome: "next", stage });
    expect(assessGenerationStage(snapshot(scope as GenerationScope), [])).toEqual({ outcome: "ready", stage });
  });
  it("P40-02 rejects unsupported scope, skipped/reordered/repeated stages and absent durable selection", () => {
    expect(nextGenerationStage("single_entry", [])).toMatchObject({ reason: "scope_unsupported" });
    for (const prefix of [["summary"], [...fullPrefix, "final_audit"], ["input_resolve", "input_resolve"]]) {
      expect(nextGenerationStage("full", prefix)).toMatchObject({ reason: "stage_mismatch" });
    }
    expect(nextGenerationStage("child", ["child_candidates", "finish"])).toEqual({ outcome: "complete" });
    const s = snapshot(); s.selection = { state: "unavailable" };
    expect(assessGenerationStage(s, [])).toMatchObject({ reason: "selection_unavailable" });
    s.scope = "summary";
    expect(assessGenerationStage(s, [])).toMatchObject({ outcome: "ready" });
  });
  it("P5-50 keeps v2 audit history while v3 full ends after final validation", () => {
    const ready = [...fullPrefix, "content_review", "place_child", "place_adult", "final_validate"];
    expect(nextGenerationStage("full", ready, 3)).toEqual({ outcome: "next", stage: "finish" });
    expect(nextGenerationStage("full", ready, 2)).toEqual({ outcome: "next", stage: "final_audit" });
    expect(nextGenerationStage("full", [...ready, "final_audit"], 3)).toMatchObject({ reason: "stage_mismatch" });
    expect(nextGenerationStage("final_audit", [], 3)).toMatchObject({ reason: "scope_unsupported" });
  });
  it("does not invent zero-count content, and distinguishes missing input from missing content", () => {
    const s = snapshot(); s.input = { state: "absent" }; s.content = { state: "absent" };
    expect(assessGenerationStage(s, [])).toMatchObject({ stage: "input_resolve" });
    s.scope = "summary";
    expect(assessGenerationStage(s, [])).toMatchObject({ reason: "input_required" });
    expect(generationAuthoritySnapshotSchema.safeParse({ ...snapshot(), content: { ...content(snapshot()), eventCount: 0 } }).success).toBe(false);
  });
  it.each(["sermon_manuscript", "sermon_summary"] as const)("blocks correction of %s", (kind) => {
    const s = snapshot("transcript_correction"); input(s).sourceKind = kind;
    expect(assessGenerationStage(s, [])).toMatchObject({ reason: "input_read_only" });
  });
  it.each(["queued", "dispatch_pending", "awaiting_transcript_review", "awaiting_intent_review", "review_ready", "needs_revision", "stale", "failed"] as const)("does not execute a stage for %s", (status) => {
    const s = snapshot(); s.status = status;
    expect(assessGenerationStage(s, [])).toMatchObject({ reason: "job_not_running" });
  });
  it("requires exact confirmed transcript and intent, and never manufactures a human review", () => {
    const s = snapshot("summary"), original = structuredClone(s);
    input(s).confirmationId = null;
    expect(assessGenerationStage(s, [])).toMatchObject({ reason: "input_unconfirmed" });
    input(s).confirmationId = "confirmed"; content(s).intent!.confirmation = null;
    expect(assessGenerationStage(s, [])).toMatchObject({ reason: "intent_unconfirmed" });
    expect(content(s).intent!.confirmation).toBeNull();
    expect(assessGenerationStage(original, [])).toMatchObject({ outcome: "ready" });
  });
  it.each(["summary", "child", "adult"] as const)("P40-15 requires current %s review and preserves the other reviews", (slot) => {
    const s = snapshot("final_audit"), saved = structuredClone(s);
    content(s)[slot]!.review = null;
    expect(assessGenerationStage(s, [])).toMatchObject({ outcome: "needs_revision", reason: "content_review" });
    for (const other of ["summary", "child", "adult"] as const) if (other !== slot) expect(content(s)[other]).toEqual(content(saved)[other]);
    content(s)[slot]!.review = { ...content(saved)[slot]!.review!, targetId: "old-target" };
    expect(assessFinalCapture(s, ticket(saved))).toMatchObject({ reason: "content_review" });
  });
  it("P40-16 accepts differing original generation versions and rejects rewriting them", () => {
    const s = snapshot(), t = ticket(s), before = structuredClone({ s, t });
    expect([t.summary.binding.transcript.version, t.placements.child.ticket.binding.transcript.version, t.placements.adult.ticket.binding.transcript.version]).toEqual([5, 6, 7]);
    expect(t.expectedVersion).toBe(12);
    expect(assessFinalCapture(s, t)).toEqual({ outcome: "ready" });
    expect({ s, t }).toEqual(before);
    t.summary.binding.transcript.version = 12;
    expect(assessFinalCapture(s, t)).toMatchObject({ reason: "capture_changed" });
  });
  it("P40-15 comparison append preserves reviews but invalidates old capture", () => {
    const s = snapshot(), old = ticket(s), reviews = structuredClone(s.content);
    content(s).eventCount++; content(s).lastEventId = "comparison";
    expect(assessGenerationStage(s, fullPrefix)).toMatchObject({ outcome: "ready" });
    expect(assessFinalCapture(s, old)).toMatchObject({ outcome: "stale" });
    expect(assessFinalCapture(s, ticket(s))).toEqual({ outcome: "ready" });
    expect(content(s).summary).toEqual(reviews.state === "present" ? reviews.summary : null);
  });
  it.each(["metadata", "input", "selection", "settings_aba", "selection_aba", "intent", "options", "index"])("P40-16 detects changed %s capture including ABA counters", (kind) => {
    const s = snapshot(), t = ticket(s);
    if (kind === "metadata") s.metadata.metadataRevision++;
    if (kind === "input") input(s).version++;
    if (kind === "selection" && s.selection.state === "present") s.selection.value.child.index = 1;
    if (kind === "settings_aba" && s.selection.state === "present") s.selection.settingsRevision++;
    if (kind === "selection_aba" && s.selection.state === "present") s.selection.selectionRevision++;
    if (kind === "intent") content(s).intent!.confirmation!.id = "new-confirmation";
    if (kind === "options") t.placements.child.ticket.options.seed = "other";
    if (kind === "index") t.placements.adult.index = 1;
    expect(assessFinalCapture(s, t).outcome).not.toBe("ready");
  });
  it("rejects wrong difficulty, future original binding and unsupported partial disclosure", () => {
    const s = snapshot("final_audit"), t = ticket(s);
    expect(assessFinalCapture(s, { ...t, placements: { child: t.placements.adult, adult: t.placements.child } }).outcome).toBe("corrupt");
    content(s).child!.binding.transcript.version = 99;
    expect(assessGenerationStage(s, [])).toMatchObject({ reason: "content_review" });
    content(s).child!.binding.transcript.version = 6; input(s).coverage = "partial";
    expect(assessGenerationStage(s, [])).toMatchObject({ reason: "partial_disclosure" });
    expect(assessFinalCapture(s, t)).toMatchObject({ reason: "partial_disclosure" });
  });
  it("P40-08 accepts summary → child → adult own commits with a fresh capture each time", () => {
    let s = snapshot(); content(s).summary = null; content(s).child = null; content(s).adult = null;
    for (const task of ["summary", "child_candidates", "adult_candidates"] as const) {
      const next = structuredClone(s), oldVersion = generationAggregateVersion(s)!;
      content(next).eventCount++; content(next).lastEventId = task; next.jobStateVersion++;
      const selected = { id: task, binding: binding(oldVersion), review: null };
      if (task === "summary") content(next).summary = selected;
      if (task === "child_candidates") content(next).child = { ...selected, difficulty: "child" };
      if (task === "adult_candidates") content(next).adult = { ...selected, difficulty: "adult" };
      expect(assessOwnContentAdvance(s, next, { jobId: "job", task, eventId: task, beforeVersion: oldVersion,
        resultVersion: oldVersion + 1, expectedContentEventCount: content(s).eventCount })).toEqual({ outcome: "ready" });
      s = next;
    }
    expect([content(s).summary!.binding.transcript.version, content(s).child!.binding.transcript.version,
      content(s).adult!.binding.transcript.version]).toEqual([12, 13, 14]);
  });
  it.each(["extra_append", "foreign_event", "input", "metadata", "review", "job", "version"])("P40-08 rejects competing %s without rebasing", (kind) => {
    const before = snapshot(), after = structuredClone(before);
    content(after).eventCount++; content(after).lastEventId = "comparison"; after.jobStateVersion++;
    const proof = { jobId: "job", task: "summary", eventId: "comparison", beforeVersion: 12, resultVersion: 13, expectedContentEventCount: 10 };
    if (kind === "extra_append") content(after).eventCount++;
    if (kind === "foreign_event") content(after).lastEventId = "foreign";
    if (kind === "input") input(after).version++;
    if (kind === "metadata") after.metadata.metadataRevision++;
    if (kind === "review") content(after).adult!.review = null;
    if (kind === "job") proof.jobId = "foreign";
    if (kind === "version") proof.beforeVersion++;
    expect(assessOwnContentAdvance(before, after, proof)).toMatchObject({ outcome: "stale" });
    expect(generationAggregateVersion(before)).toBe(12);
  });
  it("wait allows same-source caption edit/merge/confirm and confirmation already present", () => {
    const { s, wait } = waiting("transcript_review");
    expect(assessGenerationWait(wait, s)).toEqual({ outcome: "ready" });
    input(s).version++; input(s).documentId = "merged"; input(s).documentSha256 = "b".repeat(64); input(s).confirmationId = null;
    expect(assessGenerationWait(wait, s)).toMatchObject({ reason: "input_unconfirmed" });
    input(s).version++; input(s).confirmationId = "new-confirmation";
    expect(assessGenerationWait(wait, s)).toEqual({ outcome: "ready" });
  });
  it.each(["source", "metadata", "generation", "job", "content", "same_version", "backwards"])("wait refuses changed %s", (kind) => {
    const { s, wait } = waiting("transcript_review");
    if (kind === "source") input(s).sourceId = "new-source";
    if (kind === "metadata") s.metadata.metadataRevision++;
    if (kind === "generation") s.wait!.generation++;
    if (kind === "job") s.jobId = "other";
    if (kind === "content") content(s).eventCount++;
    if (kind === "same_version") input(s).documentId = "changed";
    if (kind === "backwards") input(s).version--;
    expect(assessGenerationWait(wait, s)).toMatchObject({ outcome: "stale" });
  });
  it("intent wait accepts same-root human edit/confirm, requires critique, and rejects input/other lineage", () => {
    const { s, wait } = waiting("intent_review");
    content(s).eventCount += 2; content(s).lastEventId = "new-confirmation";
    content(s).intent!.selectedId = "edited-analysis"; content(s).intent!.confirmation!.targetId = "edited-analysis";
    expect(assessGenerationWait(wait, s)).toEqual({ outcome: "ready" });
    const changed = structuredClone(s); input(changed).version++;
    expect(assessGenerationWait(wait, changed)).toMatchObject({ outcome: "stale" });
    content(s).intent!.critique = null;
    expect(assessGenerationWait(wait, s)).toMatchObject({ reason: "intent_unconfirmed" });
    content(s).intent!.rootAnalysisId = "unrelated";
    expect(assessGenerationWait(wait, s)).toMatchObject({ outcome: "stale" });
  });
  it.each([
    ["absent", "not_ready"], ["changed", "stale"], ["corrupt", "corrupt"],
    ["unavailable", "unavailable"], ["limit_exceeded", "not_ready"],
  ])("P40-20 keeps %s distinct as %s", (outcome, expected) => {
    expect(classifyGenerationAuthority({ outcome }).outcome).toBe(expected);
  });
  it("P40-20 rejects malformed/extra private fields, overflow and wrong owner", async () => {
    expect(classifyGenerationAuthority({ outcome: "unavailable", cause: privateCanary })).toEqual({ outcome: "corrupt", reason: "storage_corrupt" });
    const s = snapshot(); input(s).version = Number.MAX_SAFE_INTEGER;
    expect(classifyGenerationAuthority({ outcome: "captured", snapshot: s }).outcome).toBe("corrupt");
    const query = { jobId: "job", sermonId: "sermon", quizSetId: "quiz", targetEventIds: [], maxBytes: 1000 };
    expect(await readGenerationAuthority({ read: async () => { throw new Error(privateCanary); } }, query)).toEqual({ outcome: "unavailable", reason: "storage_unavailable" });
    const foreign = snapshot(); foreign.jobId = "foreign";
    expect(await readGenerationAuthority({ read: async () => ({ outcome: "captured", snapshot: foreign }) }, query)).toMatchObject({ outcome: "corrupt" });
    const read = vi.fn();
    expect(await readGenerationAuthority({ read }, { ...query, targetEventIds: Array.from({ length: 11 }, (_, i) => `e${i}`) })).toMatchObject({ reason: "limit_exceeded" });
    expect(read).not.toHaveBeenCalled();
  });
  it("P40-09 composes strict task/context and an explicit semantic verdict; never treats shape as domain validity", () => {
    const analysis = intentAnalysisSchema.parse(Object.fromEntries(intentFields.map((f) => [f, []])));
    analysis.centralMessage = [{ id: "claim", text: "TEST_ONLY", origin: "transcript", evidence: [
      { segmentId: null, start: null, duration: null, from: 0, to: privateCanary.length, quote: privateCanary },
    ] }];
    const request = { task: "intent_analysis", context: { sermonId: "sermon", binding: transcript(12) }, input: { transcript: { format: "plain_text", text: privateCanary } } };
    const result = { task: "intent_analysis", context: request.context, content: analysis };
    // Synthetic semantic port only. Existing domain regressions below test the
    // real quote/offset/status validators; no partial TranscriptState is fabricated.
    const port: GenerationDomainValidationPort = { validate: vi.fn<GenerationDomainValidationPort["validate"]>((pair) => {
      if (pair.task !== "intent_analysis" || pair.request.input.transcript.format !== "plain_text") return { outcome: "invalid" };
      const text = pair.request.input.transcript.text;
      return { outcome: pair.result.content.centralMessage.every((c) => c.evidence.every((e) => text.slice(e.from!, e.to!) === e.quote)) ? "valid" : "invalid" };
    }) };
    expect(assessGenerationDomain(port, { request, result })).toEqual({ outcome: "ready" });
    result.content.centralMessage[0]!.evidence[0]!.quote = "fabricated quote";
    expect(assessGenerationDomain(port, { request, result })).toMatchObject({ reason: "domain_invalid" });
    const changed = { ...result, context: { ...request.context, binding: transcript(13) } };
    expect(assessGenerationDomain(port, { request, result: changed })).toMatchObject({ reason: "context_mismatch" });
    expect(assessGenerationDomain(port, { request, result: { ...result, actor: privateCanary } })).toMatchObject({ reason: "domain_invalid" });
    expect(assessGenerationDomain({ validate: () => { throw new Error(privateCanary); } }, { request, result })).toEqual({ outcome: "unavailable", reason: "domain_unavailable" });
  });
  it("P40-09 rejects model-authored candidate difficulty/status and mismatched task before semantic port", () => {
    const validate = vi.fn(() => ({ outcome: "valid" as const }));
    const analysis = intentAnalysisSchema.parse(Object.fromEntries(intentFields.map((f) => [f, []])));
    const request = { task: "child_candidates", context: { sermonId: "sermon", binding: binding(12) }, input: { transcript: { format: "plain_text", text: privateCanary }, intent: analysis } };
    const candidate = { id: "candidate", displayAnswer: "가나", gridAnswer: "가나", clue: "TEST_ONLY", phraseDescription: "TEST_ONLY", selectionReason: "TEST_ONLY", sermonImportance: "TEST_ONLY", difficultyReason: "TEST_ONLY", grounding: { origin: "transcript", intentClaimIds: ["claim"], evidence: [{ segmentId: null, start: null, duration: null, from: 0, to: 1, quote: "T" }] } };
    for (const extra of [{ difficulty: "adult" }, { status: "approved" }]) {
      expect(assessGenerationDomain({ validate }, { request, result: { task: "child_candidates", context: request.context, content: { candidates: [{ ...candidate, ...extra }] } } })).toMatchObject({ reason: "domain_invalid" });
    }
    expect(assessGenerationDomain({ validate }, { request, result: { task: "adult_candidates", context: request.context, content: { candidates: [candidate] } } })).toMatchObject({ reason: "context_mismatch" });
    expect(validate).not.toHaveBeenCalled();
  });
});
