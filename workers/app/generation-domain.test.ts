import { describe, expect, it, vi } from "vitest";
import { prepareDomainResult, prepareHumanCommand, preparedDomainFingerprint, validateDomainBasis, domainCurrentEligibility, createDomainValidationPort } from "../_shared/services/generation-domain";
import { appendIntentEvent, verifyIntentHistory } from "../_shared/services/sermon-intent";
import { appendSummaryEvent, verifySummaryHistory } from "../_shared/services/sermon-summary";
import { appendCandidateEvent, verifyCandidateHistory } from "../_shared/services/sermon-candidates";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { privateTranscriptStateSchema } from "../_shared/services/transcript-revision-contract";
import { domainBasisSchema, type DomainBasis, type DomainPrepared } from "../_shared/services/generation-domain-contract";
import { assessDomainFinalCapture, assessDomainIntentWait, projectDomainHistoricalOutcome } from "../_shared/services/generation-domain-evidence";
import { assessGenerationDomain, assessGenerationWait } from "../_shared/services/generation-bridge";
import { budget, basis, pair, append, identity, analysis, evidence, raw, hash, sha, version, rehashSnapshot } from "./test/generation-domain-fixture";
import { snapshot, ticket, historical } from "./test/generation-lifecycle-fixture";
import type { GenerationWait } from "../_shared/services/generation-bridge-contract";

async function ai(b: DomainBasis, task: Parameters<typeof pair>[1], id: string, timed = false) {
  const r = await prepareDomainResult(b, pair(b, task, timed), identity(id), budget);
  expect(r.outcome).toBe("prepared");
  if (r.outcome !== "prepared") throw new Error("fixture prepare failed");
  return r.value;
}
async function human(b: DomainBasis, operation: DomainPrepared["operation"], id: string) {
  const r = await prepareHumanCommand(b, { operation }, identity(id), budget);
  expect(r.outcome).toBe("prepared");
  if (r.outcome !== "prepared") throw new Error("fixture human failed");
  return r.value;
}
async function ready(timed = false) {
  let b = await basis(timed);
  b = append(b, await ai(b, "intent_analysis", "root", timed));
  b = append(b, await ai(b, "intent_critique", "critique", timed));
  b = append(b, await human(b, { family: "intent", operation: { kind: "select", analysisId: "critique" } }, "select"));
  b = append(b, await human(b, { family: "intent", operation: { kind: "confirm", analysisId: "critique" } }, "confirmation"));
  return b;
}
async function reviewed() {
  let b = await ready();
  b = append(b, await ai(b, "summary", "summary"));
  b = append(b, await ai(b, "child_candidates", "child"));
  b = append(b, await ai(b, "adult_candidates", "adult"));
  b = append(b, await human(b, { family: "summary", operation: { kind: "review", summaryId: "summary" } }, "summary_review"));
  for (const d of ["child", "adult"] as const) b = append(b, await human(b, { family: "candidate", operation: { kind: "review", difficulty: d, poolId: d } }, `${d}_review`));
  return b;
}

describe("P5-47 bounded basis and actual semantic validators", () => {
  it("supports a single source=document event with distinct digest roles, finite timing and original versions", async () => {
    const b = await ready(true);
    expect(b.references.references.filter(r => r.eventId === "original")).toHaveLength(1);
    expect(b.documents[0]!.input.sourceSha256).not.toBe(b.documents[0]!.input.documentSha256);
    const p = await ai(b, "summary", "summary", true);
    expect(p.materializedSnapshot?.provenance.generationVersion).toBe(version(b));
    expect(Object.isFrozen(p)).toBe(true);
    expect(await validateDomainBasis(append(b, p), budget)).toBeDefined();
  });
  it.each(["owner", "source_hash", "document_hash", "source_revision", "duplicate_reference", "legacy_version", "body", "extra_field"])("rejects malformed basis %s", async kind => {
    const b = await basis();
    if (kind === "owner") b.references.references[0]!.sermonId = "other";
    if (kind === "source_hash" && b.references.references[0]!.kind === "input") b.references.references[0]!.sourceSha256 = hash;
    if (kind === "document_hash" && b.references.references[0]!.kind === "input") b.references.references[0]!.documentSha256 = hash;
    if (kind === "source_revision") b.documents[0]!.input.sourceRevision++;
    if (kind === "duplicate_reference") b.references.references.push(b.references.references[0]!);
    if (kind === "legacy_version") Reflect.set(b.references, "referenceVersion", 1);
    if (kind === "body" && b.documents[0]!.content.format === "plain_text") b.documents[0]!.content.text += "private";
    if (kind === "extra_field") Reflect.set(b, "verified", true);
    await expect(validateDomainBasis(b, budget)).rejects.toThrow("DOMAIN_INVALID");
  });
  it("enforces 32 unique expanded references and 10 explicit targets", async () => {
    const b = await basis();
    while (b.references.references.length < 32) b.references.references.push({ kind: "content", sermonId: "sermon", eventId: `ref_${b.references.references.length}`, eventVersion: 1, payloadSha256: hash });
    expect(await validateDomainBasis(b, budget)).toBeDefined();
    b.references.references.push({ kind: "content", sermonId: "sermon", eventId: "excess", eventVersion: 1, payloadSha256: hash });
    expect(domainBasisSchema.safeParse(b).success).toBe(false);
    b.targetIds = Array.from({ length: 11 }, (_, n) => `target_${n}`);
    expect(domainBasisSchema.safeParse(b).success).toBe(false);
  });
  it.each(["quote", "range", "duplicate_id", "admin_context", "wrong_context", "wrong_input"])("rejects analysis %s through real P5-41 port", async kind => {
    const b = await basis(), p = pair(b, "intent_analysis");
    if (p.result.task !== "intent_analysis") throw new Error("fixture");
    const c = p.result.content.centralMessage[0]!;
    if (kind === "quote") c.evidence[0]!.quote = "TEST_ONLY_FALSE_PRIVATE";
    if (kind === "range") c.evidence[0]!.from = 1000;
    if (kind === "duplicate_id") p.result.content.purpose[0]!.id = c.id;
    if (kind === "admin_context") p.result.content.centralMessage[0] = { id: c.id, text: c.text, origin: "admin_context", evidence: [] };
    if (kind === "wrong_context") p.result.context.sermonId = "other";
    if (kind === "wrong_input" && p.request.task === "intent_analysis" && p.request.input.transcript.format === "plain_text") p.request.input.transcript.text += "OTHER";
    const port = await createDomainValidationPort(b, budget);
    expect(assessGenerationDomain(port, p).outcome).not.toBe("ready");
    expect(await prepareDomainResult(b, p, identity("result"), budget)).toEqual({ outcome: "invalid" });
  });
  it("preserves correction confidence and checks overlaps, context, risk and read-only inputs", async () => {
    const b = await basis(), i = b.documents[0]!.input;
    const context = { sermonId: "sermon", expectedVersion: 2, sourceId: i.sourceId, sourceSha256: i.sourceSha256, baseRevisionId: i.documentId, baseTranscriptSha256: i.documentSha256 };
    const item = { id: "item", segmentId: null, start: null, duration: null, from: 0, to: 4, originalText: raw.slice(0, 4), proposedText: "TESTS",
      changeType: "recognition", reason: "TEST_ONLY", confidence: 0.8, riskFlags: [], contextBefore: "", contextAfter: raw.slice(4) };
    const p = { request: { task: "correction", context, input: { transcript: b.documents[0]!.content } }, result: { task: "correction", context, content: { items: [item] } } };
    const r = await prepareDomainResult(b, p, identity("proposal"), budget);
    expect(r.outcome).toBe("prepared");
    if (r.outcome === "prepared") expect(r.value.operation).toMatchObject({ family: "correction", operation: { baseDocumentId: "original", items: [{ confidence: 0.8 }] } });
    for (const bad of [ { ...item, contextAfter: "wrong" }, { ...item, proposedText: "T" }, { ...item, originalText: "wrong" } ]) {
      expect(await prepareDomainResult(b, { ...p, result: { ...p.result, content: { items: [bad] } } }, identity("proposal"), budget)).toEqual({ outcome: "invalid" });
    }
    expect(await prepareDomainResult(b, { ...p, result: { ...p.result, content: { items: [item, { ...item, id: "overlap" }] } } }, identity("proposal"), budget)).toEqual({ outcome: "invalid" });
    b.documents[0]!.input.sourceKind = "sermon_manuscript";
    expect(await prepareDomainResult(b, p, identity("proposal"), budget)).toEqual({ outcome: "invalid" });
  });
  it("validates one corrected document and reconstructs timed segments from the source", async () => {
    for (const timed of [false, true]) {
      const b = await basis(timed), input = b.documents[0]!.input, base = b.documents[0]!.content;
      const context = { sermonId: "sermon", expectedVersion: 2, sourceId: input.sourceId,
        sourceSha256: input.sourceSha256, baseRevisionId: input.documentId,
        baseTranscriptSha256: input.documentSha256 };
      const content = base.format === "plain_text"
        ? { format: "plain_text", text: base.text.replace("TEST", "TESTS") }
        : { format: "timed_segments", segments: base.segments.map((segment) => ({
          segmentId: segment.segmentId, text: segment.text.replace("TEST", "TESTS"),
        })) };
      const p = { request: { task: "correction", context, input: { transcript: base } },
        result: { task: "correction", context, content } };
      const result = await prepareDomainResult(b, p, identity(`document_${timed}`), budget);
      expect(result.outcome).toBe("prepared");
      if (result.outcome === "prepared") {
        expect(result.value.operation).toMatchObject({ family: "correction", operation: {
          kind: "correction_document_v1", sourceId: input.sourceId, baseDocumentId: input.documentId,
        } });
        if (timed && result.value.operation.family === "correction" && "kind" in result.value.operation.operation) {
          const materialized = result.value.operation.operation.content;
          if (materialized.format !== "timed_segments" || base.format !== "timed_segments") throw new Error("Expected timed document");
          expect(materialized.segments.map(({ segmentId, start, duration }) => ({ segmentId, start, duration })))
            .toEqual(base.segments.map(({ segmentId, start, duration }) => ({ segmentId, start, duration })));
        }
      }
      const malformed = base.format === "plain_text" ? { format: "plain_text", text: "" }
        : { format: "timed_segments", segments: [{ segmentId: "wrong", text: "TEST_ONLY" }] };
      expect(await prepareDomainResult(b, { ...p, result: { ...p.result, content: malformed } },
        identity(`bad_${timed}`), budget)).toEqual({ outcome: "invalid" });
    }
  });
  it("rejects unrelated critique concern root and confirmation of original analysis", async () => {
    let b = await basis(); b = append(b, await ai(b, "intent_analysis", "root"));
    const p = pair(b, "intent_critique");
    if (p.result.task !== "intent_critique") throw new Error("fixture");
    p.result.content.critique.exaggeratedIntent = { assessment: "needs_review", concerns: [{ field: "purpose", claimId: "centralMessage", note: "TEST_ONLY" }] };
    expect(await prepareDomainResult(b, p, identity("bad"), budget)).toEqual({ outcome: "invalid" });
    b = append(b, await ai(b, "intent_critique", "critique"));
    expect(await prepareHumanCommand(b, { operation: { family: "intent", operation: { kind: "confirm", analysisId: "root" } } }, identity("bad"), budget)).toEqual({ outcome: "invalid" });
  });
  it.each(["missing_claim", "unresolved", "admin_context", "wrong_confirmation", "quote"])("refuses summary provenance %s", async kind => {
    const b = await ready(), p = pair(b, "summary");
    if (p.result.task !== "summary" || p.request.task !== "summary") throw new Error("fixture");
    if (kind === "missing_claim") p.result.content.paragraphs[0]!.intentClaimIds = ["missing"];
    if (kind === "quote") p.result.content.paragraphs[0]!.evidence[0]!.quote = "FALSE";
    if (kind === "wrong_confirmation") p.request.context.binding.intentConfirmationId = "other";
    if (kind === "unresolved" || kind === "admin_context") {
      p.request.input.intent.centralMessage[0] = { id: "centralMessage", text: "TEST_ONLY", origin: kind, evidence: [] };
    }
    expect(await prepareDomainResult(b, p, identity("bad"), budget)).toEqual({ outcome: "invalid" });
  });
  it.each(["answer", "duplicate_answer", "duplicate_clue", "opposite_clue", "status_in_output", "difficulty_in_output"])("refuses candidate %s", async kind => {
    let b = await ready(); b = append(b, await ai(b, "child_candidates", "child"));
    const p = pair(b, "adult_candidates");
    if (p.result.task !== "adult_candidates") throw new Error("fixture");
    const c = p.result.content.candidates[0]!;
    if (kind === "answer") c.gridAnswer = "abc";
    if (kind === "duplicate_answer") p.result.content.candidates.push({ ...c, id: "second", clue: "different" });
    if (kind === "duplicate_clue") p.result.content.candidates.push({ ...c, id: "second", displayAnswer: "가상", gridAnswer: "가상", clue: c.clue + " " });
    if (kind === "opposite_clue") c.clue = "TEST_ONLY_child_candidates ";
    if (kind === "status_in_output") Reflect.set(c, "status", "locked");
    if (kind === "difficulty_in_output") Reflect.set(p.result.content, "difficulty", "child");
    expect(await prepareDomainResult(b, p, identity("bad"), budget)).toEqual({ outcome: "invalid" });
  });
});

describe("P5-47 comparison/current and human transitions", () => {
  it.each(["intent_analysis", "intent_critique", "summary", "child_candidates", "adult_candidates"] as const)("preserves selected/reviewed slots on comparison %s", async task => {
    const b = await reviewed(), p = await ai(b, task, "comparison");
    expect(p.after).toEqual({ ...p.before, eventCount: version(b) - 2 + 1, lastEventId: "comparison" });
    expect(domainCurrentEligibility(await validateDomainBasis(append(b, p), budget))).toEqual({ intent: true, summary: true, child: true, adult: true });
  });
  it("selects critique, inherits its root on edits, and clears downstream reviews only", async () => {
    const b = await reviewed(), operation = { family: "intent" as const, operation: { kind: "edit" as const, baseAnalysisId: "critique", analysis: analysis() } };
    operation.operation.analysis.centralMessage[0]!.text = "TEST_ONLY_CHANGED";
    const p = await human(b, operation, "edit");
    expect(p.after).toMatchObject({ intent: { selectedId: "edit", rootAnalysisId: "root", critique: { id: "critique" }, confirmation: null },
      summary: { id: "summary", review: null }, child: { id: "child", review: null }, adult: { id: "adult", review: null } });
    expect(p.materializedSnapshot).toMatchObject({ value: { evidenceReviewIds: ["centralMessage"] } });
    const next = append(b, p), confirmed = await human(next, { family: "intent", operation: { kind: "confirm", analysisId: "edit" } }, "reconfirm");
    expect(confirmed.after).toMatchObject({ intent: { confirmation: { targetId: "edit" } }, summary: { review: null } });
  });
  it("recomputes status/restore snapshots and rejects missing targets, supplied actor/snapshot", async () => {
    const b = await reviewed(), op = { family: "candidate" as const, operation: { kind: "set_status" as const, difficulty: "child" as const, poolId: "child", candidateId: "child_word", status: "excluded" as const } };
    const p = await human(b, op, "exclude");
    expect(p.materializedSnapshot).toMatchObject({ value: { statuses: { child_word: "excluded" }, evidenceReviewIds: [] } });
    expect(p.after).toMatchObject({ child: { review: null }, adult: { review: { id: "adult_review" } } });
    for (const command of [{ operation: { ...op, operation: { ...op.operation, candidateId: "missing" } } },
      { operation: op, materializedSnapshot: b.snapshots[0] }, { operation: op, actorDigest: hash }]) {
      expect(await prepareHumanCommand(b, command, identity("bad"), budget)).toEqual({ outcome: "invalid" });
    }
    const restored = await human(append(b, p), { family: "candidate", operation: { kind: "restore", difficulty: "child", poolId: "child" } }, "restore");
    expect(restored.materializedSnapshot).toMatchObject({ value: { id: "restore", restoredFromPoolId: "child", statuses: { child_word: "use" } } });
  });
  it("keeps mixed-lineage history valid and requires explicit new selection", async () => {
    const b = await reviewed(), original = b.documents[0]!, text = "NEW_TEST_ONLY_DOMAIN_PRIVATE";
    const input = { ...original.input, version: 4, sourceId: "new_source", sourceRevision: 3, documentId: "new_source", documentSha256: await sha(text), sourceSha256: await sha("NEW_SOURCE"), confirmationId: "new_confirm" };
    b.authority.input = input; b.documents.push({ input, content: { format: "plain_text", text } });
    b.references.references.push({ kind: "input", sermonId: "sermon", eventId: "new_source", eventVersion: 3, sourceSha256: input.sourceSha256, documentSha256: input.documentSha256, payloadSha256: hash },
      { kind: "input", sermonId: "sermon", eventId: "new_confirm", eventVersion: 4, sourceSha256: null, documentSha256: null, payloadSha256: hash });
    expect(domainCurrentEligibility(await validateDomainBasis(b, budget))).toEqual({ intent: false, summary: false, child: false, adult: false });
    const p = pair(b, "intent_analysis");
    if (p.result.task !== "intent_analysis") throw new Error("fixture");
    for (const claims of Object.values(p.result.content)) for (const c of claims) c.evidence = [{ ...evidence(), quote: text.slice(0, 9) }];
    const r = await prepareDomainResult(b, p, identity("new_analysis"), budget);
    expect(r.outcome).toBe("prepared");
    if (r.outcome === "prepared") {
      expect(r.value.after).toMatchObject({ intent: { selectedId: "critique" }, summary: { id: "summary" } });
      expect(domainCurrentEligibility(await validateDomainBasis(append(b, r.value), budget)).summary).toBe(false);
    }
  });
  it("requires a proved intent-wait invalidation chain instead of broadening old bridge", async () => {
    let b = await reviewed();
    b.authority.status = "awaiting_intent_review"; b.authority.wait = { kind: "intent_review", generation: 1 };
    const a = b.authority;
    if (a.input.state !== "present") throw new Error("fixture");
    const wait: GenerationWait = { contractVersion: 1, jobId: a.jobId, sermonId: a.sermonId, quizSetId: a.quizSetId,
      kind: "intent_review", generation: 1, jobStateVersion: a.jobStateVersion, input: a.input, content: a.content, metadataRevision: a.metadata.metadataRevision, selection: a.selection, rootAnalysisId: "root" };
    const p = await human(b, { family: "intent", operation: { kind: "edit", baseAnalysisId: "critique", analysis: analysis() } }, "edit");
    b = append(b, p);
    const q = await human(b, { family: "intent", operation: { kind: "confirm", analysisId: "edit" } }, "confirm_again");
    b = append(b, q);
    expect(assessGenerationWait(wait, b.authority).outcome).toBe("stale");
    expect(assessDomainIntentWait(wait, b.authority, [p, q])).toEqual({ outcome: "ready" });
    expect(assessDomainIntentWait(wait, b.authority, [structuredClone(p), q]).outcome).toBe("stale");
    expect(assessDomainIntentWait(wait, b.authority, [q]).outcome).toBe("stale");
  });
  it("detects inconsistent digest/root/selection provenance without leaking private payload", async () => {
    const b = await ready();
    const s = b.snapshots.find(s => s.value.id === "critique")!;
    s.provenance.rootAnalysisId = "critique";
    await rehashSnapshot(b, s.value.id);
    const result = await prepareHumanCommand(b, { operation: { family: "intent", operation: { kind: "confirm", analysisId: "critique" } } }, identity("bad"), budget);
    expect(result).toEqual({ outcome: "invalid" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});

describe("P5-47 nested capture and historical outcome projection", () => {
  it("retains generation versions 7/8/9 and final capture12; refuses ABA/rewritten nested bindings", () => {
    const a = snapshot(); if (a.content.state !== "present") throw new Error("fixture");
    for (const [slot, v] of [["summary", 7], ["child", 8], ["adult", 9]] as const) a.content[slot]!.binding.transcript.version = v;
    const t = { ticket: ticket(a), settingsRevision: 1, selectionRevision: 1 };
    expect(t.ticket.expectedVersion).toBe(12);
    expect(assessDomainFinalCapture(a, t)).toEqual({ outcome: "ready" });
    const bad = structuredClone(t); bad.ticket.summary.binding.transcript.version = 12;
    expect(assessDomainFinalCapture(a, bad).outcome).toBe("stale");
    if (a.selection.state === "present") a.selection.settingsRevision++;
    expect(assessDomainFinalCapture(a, t).outcome).toBe("stale");
  });
  it("refuses counts-only/raw legacy projection and binds failure after to its own full witness", () => {
    const o = historical("stale"), original = snapshot();
    original.input = o.before.input; original.content = o.before.content; original.jobStateVersion = o.evidence.before!.stateVersion;
    const physical = { identity: o.identity, beforeInputVersion: o.before.input.state === "present" ? o.before.input.version : null,
      beforeContentCount: o.before.content.state === "present" ? o.before.content.eventCount : 0,
      afterInputVersion: o.after.input.state === "present" ? o.after.input.version : null, afterContentCount: o.after.content.state === "present" ? o.after.content.eventCount : 0 };
    expect(projectDomainHistoricalOutcome({ legacy: true })).toEqual({ outcome: "not_ready" });
    expect(projectDomainHistoricalOutcome({ physical, original, outcome: o, failureAuthority: null })).toEqual({ outcome: "not_ready" });
    const v = { physical, original, outcome: o, failureAuthority: { identity: o.identity, authority: structuredClone(o.after) } };
    expect(projectDomainHistoricalOutcome(v)).toMatchObject({ outcome: "projected", value: o });
    const bad = structuredClone(v); bad.failureAuthority.identity.attempt++;
    expect(projectDomainHistoricalOutcome(bad)).toEqual({ outcome: "corrupt" });
    const changed = structuredClone(v); if (changed.outcome.after.content.state === "present") changed.outcome.after.content.lastEventId = "later";
    expect(projectDomainHistoricalOutcome(changed)).toEqual({ outcome: "corrupt" });
  });
});

describe("P5-47 differential full-history regression", () => {
  it("matches the existing memory domain across generation, critique selection, confirmation, review, status, restore and edit", async () => {
    let b = await basis();
    const manual = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript", rawTranscriptText: raw });
    if (manual.outcome !== "validated") throw new Error("fixture");
    const input = b.documents[0]!.input; input.sourceSha256 = input.documentSha256;
    const ref = b.references.references[0]!; if (ref.kind === "input") ref.sourceSha256 = input.sourceSha256;
    const humanContext = { kind: "human" as const, adminId: hash, now: identity("x").createdAt };
    const state = privateTranscriptStateSchema.parse({ contractVersion: 1, sermonId: "sermon", version: 2,
      sources: [{ id: "original", sourceRevision: 1, payload: manual.source }],
      revisions: [{ id: "original", sourceId: "original", parentRevisionId: null, kind: "imported", restoredFromRevisionId: null,
        mergedCorrection: null, content: b.documents[0]!.content, checksumFormat: input.checksumFormat, transcriptSha256: input.documentSha256,
        createdBy: hash, createdAt: humanContext.now }],
      confirmations: [{ id: "confirmed", sourceId: "original", revisionId: "original", transcriptSha256: input.documentSha256, confirmedBy: hash, confirmedAt: humanContext.now }],
      currentSourceId: "original", currentRevisionId: "original", currentConfirmationId: "confirmed" });
    const reject = (): never => { throw new Error("fixture rejected"); };
    async function apply(p: DomainPrepared) {
      const mock = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(p.event.id as ReturnType<Crypto["randomUUID"]>);
      try {
        const op = p.operation;
        if (op.family === "intent") appendIntentEvent(state, op.operation, humanContext, reject, reject, reject);
        else if (op.family === "summary") appendSummaryEvent(state, op.operation, humanContext, reject, reject, reject);
        else if (op.family === "candidate") appendCandidateEvent(state, op.operation, humanContext, reject, reject, reject);
        else throw new Error("fixture");
      } finally { mock.mockRestore(); }
      b = append(b, p);
      expect(state.version).toBe(version(b));
      const oldIntent = verifyIntentHistory(state, reject), oldSummary = verifySummaryHistory(state, reject), oldCandidates = verifyCandidateHistory(state, reject);
      const c = b.authority.content; if (c.state !== "present") throw new Error("fixture");
      expect(oldIntent.current?.id ?? null).toBe(c.intent?.selectedId ?? null);
      expect(oldIntent.confirmationId).toBe(c.intent?.confirmation?.id ?? null);
      expect(oldSummary.current?.id ?? null).toBe(c.summary?.id ?? null);
      expect(oldSummary.reviewId).toBe(c.summary?.review?.id ?? null);
      for (const d of ["child", "adult"] as const) {
        expect(oldCandidates[d].current?.id ?? null).toBe(c[d]?.id ?? null);
        expect(oldCandidates[d].reviewId).toBe(c[d]?.review?.id ?? null);
      }
      if (p.materializedSnapshot?.kind === "candidate") expect(oldCandidates[p.materializedSnapshot.value.difficulty].current?.statuses).toEqual(p.materializedSnapshot.value.statuses);
    }
    await apply(await ai(b, "intent_analysis", "root"));
    await apply(await ai(b, "intent_critique", "critique"));
    await apply(await human(b, { family: "intent", operation: { kind: "select", analysisId: "critique" } }, "select"));
    await apply(await human(b, { family: "intent", operation: { kind: "confirm", analysisId: "critique" } }, "confirmation"));
    await apply(await ai(b, "summary", "summary"));
    await apply(await ai(b, "child_candidates", "child"));
    await apply(await ai(b, "adult_candidates", "adult"));
    await apply(await human(b, { family: "summary", operation: { kind: "review", summaryId: "summary" } }, "review"));
    await apply(await ai(b, "summary", "comparison"));
    await apply(await human(b, { family: "summary", operation: { kind: "restore", summaryId: "summary" } }, "restored"));
    await apply(await human(b, { family: "candidate", operation: { kind: "set_status", difficulty: "child", poolId: "child", candidateId: "child_word", status: "excluded" } }, "excluded"));
    await apply(await human(b, { family: "candidate", operation: { kind: "restore", difficulty: "child", poolId: "child" } }, "restored_pool"));
    await apply(await human(b, { family: "intent", operation: { kind: "edit", baseAnalysisId: "critique", analysis: analysis() } }, "edited"));
  });
  it("projects a real prepared success only with its original binding, full after refs and payload fingerprint", async () => {
    const b = await ready(), p = await ai(b, "summary", "summary"), o = historical();
    o.identity.context = b.context; o.identity.event.stateVersion = b.authority.jobStateVersion + 1;
    o.evidence.before!.stateVersion = b.authority.jobStateVersion; o.evidence.after.stateVersion = b.authority.jobStateVersion + 1;
    o.before = { input: b.authority.input, content: b.authority.content };
    o.after = { input: structuredClone(b.authority.input), content: structuredClone(p.after) };
    o.result = { kind: "content", id: p.event.id, version: version(b) + 1, fingerprint: preparedDomainFingerprint(p)! };
    const inputVersion = b.documents[0]!.input.version;
    const physical = { identity: o.identity, beforeInputVersion: inputVersion, beforeContentCount: version(b) - inputVersion,
      afterInputVersion: inputVersion, afterContentCount: version(b) - inputVersion + 1 };
    const v = { physical, original: b.authority, outcome: o, failureAuthority: null };
    expect(projectDomainHistoricalOutcome(v, p)).toMatchObject({ outcome: "projected" });
    expect(projectDomainHistoricalOutcome(v, structuredClone(p))).toEqual({ outcome: "not_ready" });
    const corrupt = structuredClone(v); corrupt.outcome.result!.fingerprint = hash;
    expect(projectDomainHistoricalOutcome(corrupt, p)).toEqual({ outcome: "corrupt" });
    const forged = structuredClone(v);
    if (forged.outcome.after.content.state === "present") forged.outcome.after.content.intent!.rootAnalysisId = "wrong";
    expect(projectDomainHistoricalOutcome(forged, p)).toEqual({ outcome: "corrupt" });
  });
});

describe("P5-47 immutable materialization consistency", () => {
  it.each(["status", "restore", "pending", "operation", "base_cycle"])("rejects rehashed %s forgery", async fault => {
    let b = await ready(); b = append(b, await ai(b, "child_candidates", "child"));
    const s = b.snapshots.find(s => s.value.id === "child")!;
    if (s.kind !== "candidate") throw new Error("fixture");
    if (fault === "status") s.value.statuses.child_word = "locked";
    if (fault === "restore") s.value.restoredFromPoolId = "child";
    if (fault === "pending") s.value.evidenceReviewIds = [];
    if (fault === "operation" && s.operation.kind === "generate") s.operation.draft.candidates[0]!.clue = "OTHER";
    if (fault === "base_cycle") s.operation = { kind: "set_status", difficulty: "child", poolId: "child", candidateId: "child_word", status: "locked" };
    await rehashSnapshot(b, "child");
    await expect(validateDomainBasis(b, budget)).rejects.toThrow("DOMAIN_INVALID");
  });
  it("invalidates only summary review on edit and refuses same-status/wrong-difficulty selection", async () => {
    let b = await reviewed();
    const q = pair(b, "summary"); if (q.request.task !== "summary" || q.result.task !== "summary") throw new Error("fixture");
    const p = await human(b, { family: "summary", operation: { kind: "edit", binding: q.request.context.binding, baseSummaryId: "summary", draft: q.result.content } }, "summary_edit");
    expect(p.after).toMatchObject({ summary: { id: "summary_edit", review: null }, child: { review: { id: "child_review" } }, adult: { review: { id: "adult_review" } } });
    b = append(b, p);
    for (const operation of [
      { kind: "set_status", difficulty: "child", poolId: "child", candidateId: "child_word", status: "use" },
      { kind: "select", difficulty: "adult", poolId: "child" },
    ]) expect(await prepareHumanCommand(b, { operation: { family: "candidate", operation } }, identity("bad"), budget)).toEqual({ outcome: "invalid" });
  });
});
