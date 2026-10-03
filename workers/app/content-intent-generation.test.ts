import { readDisplaySnapshots } from "../_shared/repositories/generation-display-store";
import { prepareDisplayEvent } from "../_shared/services/content-display-preparation";
import { readContentGenerationParts } from "../_shared/services/content-generation-parts";
import { saveContentQualityReview, readLatestContentQuality } from "../_shared/services/content-quality-review";
import { registerSermonDraft, readSermonDraft, saveSermonDraft, listSermonDrafts } from "../_shared/services/sermon-drafts";
import { createSubmissionRepository } from "../_shared/repositories/submission-repository";
import { scoreSubmission } from "../_shared/services/submission-scoring";
import { readPublishedWording, correctPublishedWording } from "../_shared/services/published-wording";
import { readQuizDeadline, previewQuizDeadline, changeQuizDeadline } from "../_shared/services/quiz-deadline";
import { executeQuizRevision } from "../_shared/services/quiz-revision";
import { revisionViewSchema } from "../../shared/api/admin-quiz-revision";
import { readWithdrawalEdits, saveWithdrawalEdits } from "../_shared/services/withdrawal-edits";
import { previewWithdrawalEdits } from "../_shared/services/withdrawal-preview";
import { withdrawPublishedQuiz, readWithdrawalReview } from "../_shared/services/quiz-withdrawal";
import { correctPublishedDisplayText, readPublishedDisplayText } from "../_shared/services/published-display-text";
import { listDraftCleanup, purgeExpiredDraft } from "../_shared/services/draft-cleanup";
import { discardIntentRegeneration, requestContentRegeneration } from "../_shared/services/content-regeneration";
import { trialContentPlacement, selectContentPlacement } from "../_shared/services/content-placement";
import { readContentGenerationView } from "../_shared/services/content-generation-view";
import { readContentDisplay } from "../_shared/services/content-generation-display";
import { sha256Bytes } from "../_shared/storage/sha256";
import { ContentWorkflow } from "../content/index";
import { displayPreparationInstanceId } from "../_shared/services/content-final-check-workflow";
import * as poolSearch from "../../shared/puzzle/pool-search";
import { readAdminAiCosts } from "../_shared/services/admin-ai-costs";
import { exports } from "cloudflare:workers";
import { createAccessFixture } from "./test/access-fixture";
import { adminContentRequestSchema } from "../../shared/api/admin-content-generation";
import { finishContentGeneration } from "../_shared/services/content-generation-final";
import { createArchiveRepository } from "../_shared/repositories/archive-repository";
import { publishReviewedQuiz } from "../_shared/services/quiz-publication";
import { createPublicQuizRepository } from "../_shared/repositories/public-quiz-repository";
import { createDatabase } from "../_shared/db/client";
import { executeContentHumanCommand } from "../_shared/services/content-human-generation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generationDb as db, seedGenerationContext } from "./test/generation-storage-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { createGenerationLifecycleStore } from "../_shared/repositories/generation-lifecycle-store";
import { requestIntent, requestFullGeneration, requestContentResume } from "../_shared/services/content-intent-generation";
import { resumeStoredContent } from "../_shared/services/content-stored-continuation";
import { runContentGeneration, sendContentDispatch } from "../_shared/services/content-generation";
import { readIntentDomain, prepareReadIntentResult } from "../_shared/services/generation-domain-reader";
import { prepareHumanCommand } from "../_shared/services/generation-domain";
import { DOMAIN_STORAGE_BUDGET } from "../_shared/repositories/generation-domain-storage";
import { readVerifiedEvents } from "../_shared/repositories/human-content-runtime-store";
import { prepareLifecycleArtifact } from "../_shared/repositories/generation-lifecycle-artifact";
import { hash } from "../_shared/services/transcript-content";
import { raw, analysis, clearCritique, evidence, hash as actor } from "./test/generation-domain-fixture";
// Integration assertions compare stored timestamps, not elapsed wall time.
// Host/WSL clock corrections can move Date backwards during a test. Freeze only
// Date per test; real timers, explicit dates, SQL guards and provider timeouts stay active.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });

const bindings = { DB: db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic-key" };
async function fixture(timed = false, full = false, registered?: { sermonId: string; quizSetId: string }) {
  const owner = registered ?? await seedGenerationContext(), store = createSermonInputStore(db), service = createSermonInputService(store);
  const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript",
    sourceCoverage: "full_transcript", rawTranscriptText: raw });
  if (source.outcome !== "validated") throw new Error("source");
  if (timed) {
    const segments = [{ text: raw, start: 1.25, duration: 2.5 }];
    expect((await service.execute(owner.sermonId, { action: "import_source", expectedVersion: 0, payload: {
      sourceMode: "public_unofficial", videoId: "abcdefghijk", language: "ko", trackId: "synthetic", generated: true,
      retrievedAt: new Date().toISOString(), providerId: "accountless-youtube-spike", providerVersion: "0.1.0",
      sourceSha256: await hash(JSON.stringify(segments)), segments } },
    { adminId: actor, kind: "human", now: new Date().toISOString() })).outcome).toBe("saved");
  } else expect((await service.importPreparedManual(owner.sermonId, 0, source.source,
    { adminId: actor, kind: "human", now: new Date().toISOString() })).outcome).toBe("saved");
  const head = (await store.head(owner.sermonId))!;
  expect((await service.execute(owner.sermonId, { action: "confirm", expectedVersion: head.version, sourceId: head.source_id,
    documentId: head.document_id, documentSha256: head.document_sha256, reviewed: true },
  { adminId: actor, kind: "human", now: new Date().toISOString() })).outcome).toBe("saved");
  const command = { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId, expectedVersion: 2 };
  const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
  const requested = full ? await requestFullGeneration(db, owner.sermonId, { ...command, selection: { child: { options, index: 0 }, adult: { options, index: 0 } } }, actor) : await requestIntent(db, owner.sermonId, command, actor);
  expect((await sendContentDispatch(db, { create: async () => ({}) } as never, requested.dispatchId)).outcome).toBe("sent");
  return { ...owner, store, service, command, requested };
}
const complete = (draft: unknown) => Response.json({ id: "synthetic-response", model: "gpt-5.6-terra", status: "completed",
  usage: { input_tokens: 100, output_tokens: 30, input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 10 } },
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft }) }] }] });
const execute = (f: Awaited<ReturnType<typeof fixture>>, fetcher: typeof fetch) =>
  runContentGeneration(bindings, { dispatchId: f.requested.dispatchId }, f.requested.jobId, { fetch: fetcher });
function responses() {
  return vi.fn<typeof fetch>().mockImplementationOnce(async () => complete(analysis()))
    .mockImplementationOnce(async () => complete({ analysis: analysis(), critique: clearCritique }));
}
describe("actual domain intent storage and Workflow execution", { timeout: 30_000 }, () => {
  it("stores and rereads actual analysis/critique with separate digest roles, then waits without implicit confirmation", async () => {
    const f = await fixture(), fetcher = responses();
    const result = await execute(f, fetcher);
    expect(result).toEqual({ outcome: "awaiting_intent_review" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const captured = await readIntentDomain(db, { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId });
    expect(Object.isFrozen(captured.basis.documents[0]!.content)).toBe(true);
    expect(await prepareReadIntentResult(structuredClone(captured.basis), captured.basis.context, {}, {})).toEqual({ outcome: "invalid" });
    expect(captured.basis.snapshots).toHaveLength(2);
    expect(captured.basis.authority.content).toMatchObject({ eventCount: 2,
      intent: { selectedId: `result-${f.requested.jobId}-intent_analysis`, critique: null, confirmation: null } });
    const critique = captured.basis.snapshots.find(s => s.value.kind === "critique")!;
    expect(critique.value).toMatchObject({ critiqueId: critique.value.id, analysis: analysis() });
    const reference = captured.basis.references.references.find(r => r.eventId === critique.value.id)!;
    expect(reference.kind === "content" && reference.snapshotSha256).toBe(critique.provenance.payloadSha256);
    expect(reference.payloadSha256).not.toBe(critique.provenance.payloadSha256);
    expect(await prepareHumanCommand(captured.basis, { operation: { family: "intent", operation: {
      kind: "confirm", analysisId: `result-${f.requested.jobId}-intent_analysis` } } },
    { id: "not-confirmed", actorDigest: actor, createdAt: new Date().toISOString() }, DOMAIN_STORAGE_BUDGET)).toEqual({ outcome: "invalid" });
    expect((await execute(f, fetcher)).outcome).toBe("awaiting_intent_review");
    expect((await requestIntent(db, f.sermonId, f.command, actor)).outcome).toBe("replayed");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await db.prepare("SELECT count(*) n,sum(estimated_cost_micro_usd) cost FROM ai_usage_events WHERE generation_job_id=?")
      .bind(f.requested.jobId).first()).toEqual({ n: 2, cost: 1048 });
    expect((await f.store.head(f.sermonId))?.version).toBe(2);
  });
  it("selects the critique, confirms it, and rereads immutable human lineage", async () => {
    const f = await fixture(), fetcher = responses();
    expect((await execute(f, fetcher)).outcome).toBe("awaiting_intent_review");
    const owner = { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId };
    const critiqueId = `result-${owner.jobId}-intent_critique`;
    const select = { requestKey: crypto.randomUUID(), expectedVersion: 4, operation: { family: "intent", operation: { kind: "select", analysisId: critiqueId } } };
    expect((await executeContentHumanCommand(db, owner, select, actor)).outcome).toBe("saved");
    expect((await executeContentHumanCommand(db, owner, select, actor)).outcome).toBe("replayed");
    const selected = await readIntentDomain(db, owner);
    expect(selected.basis.authority.content).toMatchObject({ eventCount: 3, intent: { selectedId: critiqueId, critique: { id: critiqueId }, confirmation: null } });
    const confirm = { requestKey: crypto.randomUUID(), expectedVersion: 5, operation: { family: "intent", operation: { kind: "confirm", analysisId: critiqueId } } };
    expect((await executeContentHumanCommand(db, owner, confirm, actor)).outcome).toBe("saved");
    expect((await executeContentHumanCommand(db, owner, confirm, actor)).outcome).toBe("replayed");
    const confirmed = await readIntentDomain(db, owner);
    expect(confirmed.basis.authority.content).toMatchObject({ eventCount: 4, intent: { selectedId: critiqueId, confirmation: { id: confirm.requestKey } } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps private quality history and blocks a regenerate-rated intent until a human changes the rating", async () => {
    const f = await fixture(false, true), fetcher = responses();
    expect(await execute(f, fetcher)).toEqual({ outcome: "awaiting_intent_review" });
    const owner = { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId };
    const critiqueId = `result-${owner.jobId}-intent_critique`;
    await executeContentHumanCommand(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 4,
      operation: { family: "intent", operation: { kind: "select", analysisId: critiqueId } } }, actor);
    const criteria = { centralTheme: "confirmed", illustrationDistinction: "needs_review", audienceApplication: "confirmed",
      unsupportedConclusion: "confirmed", repeatedEmphasis: "not_checked" } as const;
    const regenerate = { requestKey: crypto.randomUUID(), expectedVersion: 5, targetSnapshotId: critiqueId,
      scope: "intent", status: "regenerate", criteria, adminNote: "예화와 중심 주장의 구분을 다시 확인" };
    expect((await saveContentQualityReview(db, owner, regenerate, actor)).outcome).toBe("saved");
    expect((await saveContentQualityReview(db, owner, regenerate, actor)).outcome).toBe("replayed");
    await expect(executeContentHumanCommand(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 5,
      operation: { family: "intent", operation: { kind: "confirm", analysisId: critiqueId } } }, actor)).rejects.toThrow();
    const good = { ...regenerate, requestKey: crypto.randomUUID(), status: "good", adminNote: "원문을 다시 확인함" };
    expect((await saveContentQualityReview(db, owner, good, actor)).review.revision).toBe(2);
    expect((await readLatestContentQuality(db, owner.sermonId, [critiqueId]))[critiqueId]?.status).toBe("good");
    await expect(db.prepare("UPDATE sermon_content_quality_reviews SET status='regenerate' WHERE request_key=?")
      .bind(good.requestKey).run()).rejects.toThrow();
    expect((await executeContentHumanCommand(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 5,
      operation: { family: "intent", operation: { kind: "confirm", analysisId: critiqueId } } }, actor)).outcome).toBe("saved");
    expect((await saveContentQualityReview(db, owner, { ...regenerate, requestKey: crypto.randomUUID(), expectedVersion: 6 }, actor)).review.revision).toBe(3);
    await expect(requestContentResume(db, owner)).rejects.toThrow("CONTENT_REGENERATION_REQUIRED");
    expect((await saveContentQualityReview(db, owner, { ...good, requestKey: crypto.randomUUID(), expectedVersion: 6 }, actor)).review.revision).toBe(4);
    expect((await requestContentResume(db, owner)).outcome).toBe("saved");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=?").bind(owner.jobId).first()).toEqual({ n: 2 });
  });
  it("requires an explicit new request to replace a regenerate-rated intent wait and keeps old usage", async () => {
    const f = await fixture(false, true), firstFetch = responses();
    expect(await execute(f, firstFetch)).toEqual({ outcome: "awaiting_intent_review" });
    const owner = { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId };
    const critiqueId = `result-${owner.jobId}-intent_critique`;
    await executeContentHumanCommand(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 4,
      operation: { family: "intent", operation: { kind: "select", analysisId: critiqueId } } }, actor);
    await saveContentQualityReview(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 5,
      targetSnapshotId: critiqueId, scope: "intent", status: "regenerate", criteria: {
        centralTheme: "needs_review", illustrationDistinction: "confirmed", audienceApplication: "not_checked",
        unsupportedConclusion: "needs_review", repeatedEmphasis: "not_checked" }, adminNote: "중심 메시지 재분석 필요" }, actor);
    const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
    const next = await requestFullGeneration(db, owner.sermonId, { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId,
      expectedVersion: 5, supersedesJobId: owner.jobId,
      selection: { child: { options, index: 0 }, adult: { options, index: 0 } } }, actor);
    expect(next.outcome).toBe("created");
    const previous = await createGenerationLifecycleStore(db).readJob(owner.jobId);
    expect(previous.outcome === "present" && previous.value.status).toBe("stale");
    expect(await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=?").bind(owner.jobId).first()).toEqual({ n: 2 });
    expect((await sendContentDispatch(db, { create: async () => ({}) } as never, next.dispatchId)).outcome).toBe("sent");
    const secondFetch = responses();
    expect((await runContentGeneration(bindings, { dispatchId: next.dispatchId }, next.jobId, { fetch: secondFetch })).outcome).toBe("awaiting_intent_review");
    expect(secondFetch).toHaveBeenCalledTimes(2);
  });
  it("counts quality review as draft activity and forbids a late review after cleanup", async () => {
    const f = await fixture(false, true), fetcher = responses();
    expect((await execute(f, fetcher)).outcome).toBe("awaiting_intent_review");
    const owner = { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId };
    const critiqueId = `result-${owner.jobId}-intent_critique`;
    await executeContentHumanCommand(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 4,
      operation: { family: "intent", operation: { kind: "select", analysisId: critiqueId } } }, actor);
    const firstKey = crypto.randomUUID();
    await saveContentQualityReview(db, owner, { requestKey: firstKey, expectedVersion: 5, targetSnapshotId: critiqueId,
      scope: "intent", status: "good", criteria: { centralTheme: "confirmed", illustrationDistinction: "not_checked",
        audienceApplication: "not_checked", unsupportedConclusion: "not_checked", repeatedEmphasis: "not_checked" }, adminNote: null }, actor);
    const copyWithSyntheticTime = (fromKey: string, toKey: string, createdAt: string) => db.prepare(`INSERT INTO sermon_content_quality_reviews
      (sermon_id,snapshot_event_id,revision,quiz_set_id,request_key,request_sha256,scope,status,criteria_json,admin_note,edited_revision_id,actor_digest,created_at)
      SELECT sermon_id,snapshot_event_id,revision+1,quiz_set_id,?,request_sha256,scope,status,criteria_json,admin_note,edited_revision_id,actor_digest,?
      FROM sermon_content_quality_reviews WHERE request_key=?`).bind(toKey, createdAt, fromKey).run();
    const futureKey = crypto.randomUUID();
    await copyWithSyntheticTime(firstKey, futureKey, "2099-01-01T00:00:00.000Z");
    expect((await listDraftCleanup(db, "2099-01-02T00:00:00.000Z")).items.some(item => item.sermonId === owner.sermonId)).toBe(false);
    expect((await purgeExpiredDraft(db, owner.sermonId, "2099-01-08T00:00:00.000Z")).outcome).toBe("purged");
    await expect(copyWithSyntheticTime(futureKey, crypto.randomUUID(), "2099-01-08T00:00:01.000Z")).rejects.toThrow();
  });
  it("runs full v3 through human confirmation and resumes summary and both candidate pools", async () => {
    const f = await fixture(false, true), fetcher = responses();
    expect(await execute(f, fetcher)).toEqual({ outcome: "awaiting_intent_review" });
    const owner = { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId };
    const critiqueId = `result-${owner.jobId}-intent_critique`;
    expect((await executeContentHumanCommand(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 4,
      operation: { family: "intent", operation: { kind: "select", analysisId: critiqueId } } }, actor)).outcome).toBe("saved");
    expect((await executeContentHumanCommand(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 5,
      operation: { family: "intent", operation: { kind: "confirm", analysisId: critiqueId } } }, actor)).outcome).toBe("saved");
    const resume = await requestContentResume(db, owner);
    expect(resume.outcome).toBe("saved");
    if (!("dispatchId" in resume)) throw new Error("resume");
    const events = vi.fn(async () => undefined);
    expect((await sendContentDispatch(db, { create: vi.fn(), get: async () => ({ sendEvent: events }) } as never, resume.dispatchId)).outcome).toBe("sent");
    expect(events).toHaveBeenCalledTimes(1);
    const candidate = { candidates: [{ id: "word", displayAnswer: "합성", gridAnswer: "합성", clue: "합성 설명", phraseDescription: "설명",
      selectionReason: "근거", sermonImportance: "핵심", difficultyReason: "난도", grounding: { origin: "transcript", intentClaimIds: ["centralMessage"], evidence: [evidence()] } }] };
    candidate.candidates = ["가나다", "라마바", "가사라", "다아바", "허호"].map((answer, i) => ({ ...candidate.candidates[0]!, id: `word-${i}`, displayAnswer: answer, gridAnswer: answer, clue: `어린이 단서 ${i}` }));
    const after = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete({ paragraphs: [{ id: "paragraph", text: "합성 요약", intentClaimIds: ["centralMessage"], evidence: [evidence()] }] }))
      .mockImplementationOnce(async () => complete(candidate)).mockImplementationOnce(async () => complete({ candidates: candidate.candidates.map((c, i) => ({ ...c, clue: `장년용 합성 설명 ${i}` })) }));
    const resumedResult = await runContentGeneration(bindings, { dispatchId: resume.dispatchId }, owner.jobId, { fetch: after });
    expect(resumedResult).toEqual({ outcome: "awaiting_content_review" });
    const read = await readIntentDomain(db, owner);
    expect(read.basis.authority.content).toMatchObject({ eventCount: 7, summary: { review: null }, child: { review: null }, adult: { review: null } });
    expect(after).toHaveBeenCalledTimes(3);
    expect((await runContentGeneration(bindings, { dispatchId: resume.dispatchId }, owner.jobId, { fetch: after })).outcome).toBe("awaiting_content_review");
    expect(after).toHaveBeenCalledTimes(3);
    const summaryId = `result-${owner.jobId}-summary`;
    const summaryQuality = { requestKey: crypto.randomUUID(), expectedVersion: 9, targetSnapshotId: summaryId,
      scope: "summary", status: "regenerate", criteria: {}, adminNote: "요약 근거를 다시 확인" };
    expect((await saveContentQualityReview(db, owner, summaryQuality, actor)).outcome).toBe("saved");
    await expect(executeContentHumanCommand(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 9,
      operation: { family: "summary", operation: { kind: "review", summaryId } } }, actor)).rejects.toThrow("CONTENT_REGENERATION_REQUIRED");
    expect((await saveContentQualityReview(db, owner, { ...summaryQuality, requestKey: crypto.randomUUID(),
      status: "good" }, actor)).review.revision).toBe(2);
    for (const [index, family] of (["summary", "child", "adult"] as const).entries()) {
      const operation = family === "summary" ? { family: "summary", operation: { kind: "review", summaryId: `result-${owner.jobId}-summary` } }
        : { family: "candidate", operation: { kind: "review", difficulty: family, poolId: `result-${owner.jobId}-${family}_candidates` } };
      expect((await executeContentHumanCommand(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 9 + index, operation }, actor)).outcome).toBe("saved");
    }
    expect(await finishContentGeneration(db, owner)).toMatchObject({ outcome: "review_ready" });
    expect(await finishContentGeneration(db, owner)).toMatchObject({ outcome: "review_ready" });
    expect(after).toHaveBeenCalledTimes(3);
    expect(await db.prepare("SELECT status FROM quiz_sets WHERE id=?").bind(owner.quizSetId).first()).toEqual({ status: "draft" });
    expect((await saveContentQualityReview(db, owner, { ...summaryQuality, requestKey: crypto.randomUUID(),
      expectedVersion: 12 }, actor)).review.revision).toBe(3);
    expect((await readContentGenerationView(db, owner.sermonId, false)).preview).toBeNull();
    expect((await saveContentQualityReview(db, owner, { ...summaryQuality, requestKey: crypto.randomUUID(),
      expectedVersion: 12, status: "good" }, actor)).review.revision).toBe(4);
    expect((await readContentGenerationView(db, owner.sermonId, false)).preview).not.toBeNull();
    const next = await requestFullGeneration(db, owner.sermonId, { ...f.command, requestKey: crypto.randomUUID(), expectedVersion: 12,
      selection: { child: { options: { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 }, index: 0 },
        adult: { options: { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 }, index: 0 } } }, actor);
    expect((await sendContentDispatch(db, { create: async () => ({}) } as never, next.dispatchId)).outcome).toBe("sent");
    expect(await runContentGeneration(bindings, { dispatchId: next.dispatchId }, next.jobId, { fetch: responses() })).toEqual({ outcome: "awaiting_intent_review" });
    const nextOwner = { ...owner, jobId: next.jobId };
    const beforeSelection = (await readIntentDomain(db, nextOwner)).basis.authority.content;
    expect(beforeSelection).toMatchObject({ intent: { selectedId: critiqueId }, summary: { id: `result-${owner.jobId}-summary` } });
    expect((await executeContentHumanCommand(db, nextOwner, { requestKey: crypto.randomUUID(), expectedVersion: 14,
      operation: { family: "intent", operation: { kind: "select", analysisId: `result-${next.jobId}-intent_critique` } } }, actor)).outcome).toBe("saved");
    const edited = crypto.randomUUID(), editedAnalysis = analysis(); editedAnalysis.centralMessage[0]!.text = "사람이 수정한 중심 메시지";
    expect((await executeContentHumanCommand(db, nextOwner, { requestKey: edited, expectedVersion: 15,
      operation: { family: "intent", operation: { kind: "edit", baseAnalysisId: `result-${next.jobId}-intent_critique`, analysis: editedAnalysis } } }, actor)).outcome).toBe("saved");
    expect((await executeContentHumanCommand(db, nextOwner, { requestKey: crypto.randomUUID(), expectedVersion: 16,
      operation: { family: "intent", operation: { kind: "confirm", analysisId: edited } } }, actor)).outcome).toBe("saved");
    const nextResume = await requestContentResume(db, nextOwner);
    expect(nextResume.outcome).toBe("saved");
    if (!("dispatchId" in nextResume)) throw new Error("resume");
    await sendContentDispatch(db, { create: vi.fn(), get: async () => ({ sendEvent: async () => undefined }) } as never, nextResume.dispatchId);
    const regenerate = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete({ paragraphs: [{ id: "p2", text: "새 요약", intentClaimIds: ["centralMessage"], evidence: [evidence()] }] }))
      .mockImplementationOnce(async () => complete(candidate)).mockImplementationOnce(async () => complete({ candidates: candidate.candidates.map((c, i) => ({ ...c, clue: `장년용 새 설명 ${i}` })) }));
    expect(await runContentGeneration(bindings, { dispatchId: nextResume.dispatchId }, next.jobId, { fetch: regenerate })).toEqual({ outcome: "awaiting_content_review" });
    expect((await readIntentDomain(db, nextOwner)).basis.authority.content).toMatchObject({ summary: { id: `result-${owner.jobId}-summary`, review: null } });
    let version = 20;
    for (const family of ["summary", "child", "adult"] as const) for (const kind of ["select", "review"] as const) {
      const operation = family === "summary" ? { family: "summary", operation: { kind, summaryId: `result-${next.jobId}-summary` } } :
        { family: "candidate", operation: { kind, difficulty: family, poolId: `result-${next.jobId}-${family}_candidates` } };
      expect((await executeContentHumanCommand(db, nextOwner, { requestKey: crypto.randomUUID(), expectedVersion: version++, operation }, actor)).outcome).toBe("saved");
    }
    expect(await finishContentGeneration(db, nextOwner)).toMatchObject({ outcome: "review_ready" });
    expect(regenerate).toHaveBeenCalledTimes(3);
    expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(owner.jobId).first()).toEqual({ n: 5 });

  }, 180_000);
  it.each([[false, false, false], [true, false, false], [false, true, false], [true, true, false], [false, true, true]])("publishes reviewed grids atomically and serves a draft-independent public snapshot (selected=%s, withdrawal=%s, deferredCleanup=%s)", async (selected, withdrawal, deferredCleanup) => {
    const f = await fixture(false, true);
    await db.prepare("UPDATE sermons SET slug_suffix=? WHERE id=?").bind(crypto.randomUUID().slice(0, 6), f.sermonId).run();
    const olderSermonId = crypto.randomUUID(), olderQuizId = crypto.randomUUID();
    await seedMetadataSermon(createDatabase(db), olderSermonId);
    await db.prepare(`INSERT INTO quiz_sets(id,sermon_id,status,created_by,created_at,updated_at,published_at,opens_at,closes_at)
      VALUES(?,?,'published','TEST_ONLY_ACTOR',?,?,?,?,?)`).bind(olderQuizId, olderSermonId, "2026-09-20T00:00:00.000Z",
      "2026-09-20T00:00:00.000Z", "2026-09-20T00:00:00.000Z", "2026-09-20T00:00:00.000Z", "2026-09-27T00:00:00.000Z").run();
    await db.prepare("INSERT INTO site_state(key,value,updated_at) VALUES('featured_quiz_set_id',?,'2026-09-20T00:00:00.000Z') ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(olderQuizId).run();
    await execute(f, responses());
    const owner = { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId };
    const command = (version: number, operation: unknown) => executeContentHumanCommand(db, owner,
      { requestKey: crypto.randomUUID(), expectedVersion: version, operation }, actor);
    const critiqueId = `result-${owner.jobId}-intent_critique`;
    await command(4, { family: "intent", operation: { kind: "select", analysisId: critiqueId } });
    await command(5, { family: "intent", operation: { kind: "confirm", analysisId: critiqueId } });
    const resume = await requestContentResume(db, owner);
    if (!("dispatchId" in resume)) throw new Error("resume");
    await sendContentDispatch(db, { get: async () => ({ sendEvent: async () => undefined }) } as never, resume.dispatchId);
    const candidate = { candidates: ["가나다", "라마바", "가사라", "다아바", "허호"].map((answer, i) => ({ id: `word-${i}`,
      displayAnswer: answer, gridAnswer: answer, clue: `합성 단서 ${i}`, phraseDescription: "명사구", selectionReason: "근거",
      sermonImportance: "핵심", difficultyReason: "난도", grounding: { origin: "transcript", intentClaimIds: ["centralMessage"], evidence: [evidence()] } })) };
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete({ paragraphs: [{ id: "p", text: "발행 요약", intentClaimIds: ["centralMessage"], evidence: [evidence()] }] }))
      .mockImplementationOnce(async () => complete(candidate))
      .mockImplementationOnce(async () => complete({ candidates: candidate.candidates.map(c => ({ ...c, clue: `장년 ${c.clue}` })) }));
    await runContentGeneration(bindings, { dispatchId: resume.dispatchId }, owner.jobId, { fetch: fetcher });
    for (const [index, family] of (["summary", "child", "adult"] as const).entries()) await command(9 + index,
      family === "summary" ? { family: "summary", operation: { kind: "review", summaryId: `result-${owner.jobId}-summary` } } :
        { family: "candidate", operation: { kind: "review", difficulty: family, poolId: `result-${owner.jobId}-${family}_candidates` } });
    expect((await finishContentGeneration(db, owner)).outcome).toBe("review_ready");
    expect((await readContentGenerationView(db, owner.sermonId, false)).placement).toMatchObject({ current: true, selected: false });
    if (selected) {
      const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
      await selectContentPlacement(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 12, expectedMetadataRevision: 1,
        expectedSelectionRevision: 1, selection: { child: { options, index: 1 }, adult: { options, index: 0 } } }, actor);
    }

    const request = { requestKey: crypto.randomUUID(), jobId: owner.jobId, expectedVersion: 12,
      expectedMetadataRevision: 1, expectedSelectionRevision: selected ? 2 : 1, confirmation: "publish" };
    await expect(publishReviewedQuiz(db, owner.quizSetId, { ...request, expectedVersion: 11 }, actor)).rejects.toThrow("PUBLICATION_STALE");
    expect(await db.prepare("SELECT count(*) n FROM quiz_variants WHERE quiz_set_id=?").bind(owner.quizSetId).first()).toEqual({ n: 0 });
    await db.prepare("CREATE TRIGGER publication_test_failure BEFORE UPDATE ON site_state BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();
    await expect(publishReviewedQuiz(db, owner.quizSetId, request, actor, new Date("2026-09-22T00:00:00.000Z"))).rejects.toThrow();
    expect(await db.prepare("SELECT count(*) n FROM quiz_variants WHERE quiz_set_id=?").bind(owner.quizSetId).first()).toEqual({ n: 0 });
    expect(await db.prepare("SELECT count(*) n FROM published_quiz_content WHERE quiz_set_id=?").bind(owner.quizSetId).first()).toEqual({ n: 0 });
    expect(await db.prepare("SELECT value FROM site_state WHERE key='featured_quiz_set_id'").first()).toEqual({ value: olderQuizId });
    await db.prepare("DROP TRIGGER publication_test_failure").run();
    const published = await publishReviewedQuiz(db, owner.quizSetId, request, actor, new Date("2026-09-22T00:00:00.000Z"));
    expect(published).toMatchObject({ outcome: "published", quizSetId: owner.quizSetId, closesAt: "2026-09-29T00:00:00.000Z" });
    expect((await publishReviewedQuiz(db, owner.quizSetId, request, actor)).outcome).toBe("replayed");
    for (const changed of [{ expectedVersion: 11 }, { expectedMetadataRevision: 2 }, { expectedSelectionRevision: 99 }, { requestKey: crypto.randomUUID() }]) {
      await expect(publishReviewedQuiz(db, owner.quizSetId, { ...request, ...changed }, actor)).rejects.toThrow("PUBLICATION_CONFLICT");
    }
    await expect(publishReviewedQuiz(db, owner.quizSetId, request, "c".repeat(64))).rejects.toThrow("PUBLICATION_CONFLICT");
    expect(await readContentGenerationView(db, owner.sermonId, false)).toMatchObject({ status: "published", jobId: null,
      publication: { slug: published.slug, publishedAt: published.publishedAt, closesAt: published.closesAt }, snapshots: [] });
    await expect(db.prepare("UPDATE published_quiz_content SET title='bad' WHERE quiz_set_id=?").bind(owner.quizSetId).run()).rejects.toThrow();
    await expect(db.prepare("DELETE FROM published_quiz_content WHERE quiz_set_id=?").bind(owner.quizSetId).run()).rejects.toThrow();

    expect(await db.prepare("SELECT value FROM site_state WHERE key='featured_quiz_set_id'").first()).toEqual({ value: owner.quizSetId });
    expect(await db.prepare("SELECT status,closes_at closesAt FROM quiz_sets WHERE id=?").bind(olderQuizId).first()).toEqual({ status: "published", closesAt: "2026-09-27T00:00:00.000Z" });
    expect(await db.prepare("SELECT count(*) n FROM quiz_variants WHERE quiz_set_id=?").bind(owner.quizSetId).first()).toEqual({ n: 2 });
    const publicRepository = createPublicQuizRepository(createDatabase(db));
    const child = await publicRepository.read({ slug: published.slug }, "child", new Date("2026-09-22T01:00:00.000Z"));
    const adult = await publicRepository.read("latest", "adult", new Date("2026-09-22T01:00:00.000Z"));
    expect(child.quiz).toMatchObject({ slug: published.slug, status: "published", variant: { difficulty: "child" }, sermon: { title: "TEST_ONLY_PRIVATE_METADATA", summary: { text: "발행 요약" } } });
    expect(adult.quiz?.variant.difficulty).toBe("adult");
    if (selected) expect(child.quiz?.variant.grid.gridSize).toBe(6);
    expect(JSON.stringify(child)).not.toMatch(/solutionCells|entryAnswers|publishedByDigest|sourceSha256|가나다/u);
    await db.prepare("UPDATE sermons SET sermon_title='변경된 초안 제목',ai_summary='변경된 초안 요약' WHERE id=?").bind(owner.sermonId).run();
    expect((await publicRepository.read({ slug: published.slug }, "child", new Date("2026-09-22T01:00:00.000Z"))).quiz?.sermon)
      .toMatchObject({ title: "TEST_ONLY_PRIVATE_METADATA", summary: { text: "발행 요약" } });
    if (withdrawal) {
      // An extended, still-open synthetic publication can outlive its seven-day draft retention.
      await db.prepare("UPDATE quiz_sets SET closes_at='2026-10-02T00:00:00.000Z' WHERE id=?").bind(owner.quizSetId).run();
      const display = await readPublishedDisplayText(db, owner.quizSetId);
      const corrected = { title: "철회 시작점 제목", sermonDate: "2026-09-13" };
      await correctPublishedDisplayText(db, owner.quizSetId, { requestKey: crypto.randomUUID(), expectedRevision: 0,
        before: display.quiz.metadata, after: corrected, reason: "철회 전 합성 정정" }, "synthetic-admin@example.invalid");
      if (!deferredCleanup) expect((await purgeExpiredDraft(db, owner.sermonId, "2026-09-29T00:00:00.000Z")).outcome).toBe("purged");
      const tables = ["published_quiz_content", "published_display_corrections", "quiz_solutions", "quiz_entries_public",
        "submissions", "leaderboard_snapshots", "leaderboard_snapshot_entries", "ai_provider_calls", "ai_usage_events",
        "ai_usage_observations", "ai_usage_settlements", "generation_final_validation_proofs", "generation_jobs"];
      const capture = () => Promise.all(tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().then(r => r.results)));
      const before = await capture();
      const variants = (await db.prepare("SELECT * FROM quiz_variants WHERE quiz_set_id=? ORDER BY id").bind(owner.quizSetId).all()).results;
      const cmd = { requestKey: crypto.randomUUID(), expectedPublishedAt: published.publishedAt, expectedDisplayRevision: 1,
        confirmation: "withdraw", reason: "초안 정리 뒤 합성 철회" };
      expect((await withdrawPublishedQuiz(db, owner.quizSetId, cmd, "synthetic-admin@example.invalid", new Date("2026-09-29T01:00:00.000Z"))).outcome).toBe("withdrawn");
      expect(await capture()).toEqual(before);
      expect(await readContentGenerationView(db, owner.sermonId, true)).toMatchObject({ status: "withdrawn", enabled: false,
        jobId: null, quizSetId: owner.quizSetId, snapshots: [], content: { state: "absent" }, preview: null });
      const review = await readWithdrawalReview(db, owner.quizSetId);
      expect(review.review).toMatchObject({ metadata: corrected, summary: "발행 요약", slug: published.slug });
      expect(review.review.variants).toHaveLength(2);
      const previewEntry = review.review.variants.find(v => v.difficulty === "child")!.entries[0]!;
      const preview = await previewWithdrawalEdits(db, owner.quizSetId, { expectedReviewRevision: review.reviewRevision,
        edits: [{ difficulty: "child", entryId: previewEntry.id, clue: "초안 정리 뒤 수정한 합성 단서" }] });
      expect(preview).toMatchObject({ codeChecksPassed: true, persisted: false, requiresHumanReview: true });
      expect(preview.variants.find(v => v.difficulty === "child")!.preview!.grid.entries.find(e => e.id === previewEntry.id)!.clue)
        .toBe("초안 정리 뒤 수정한 합성 단서");
      expect(await readWithdrawalReview(db, owner.quizSetId)).toEqual(review);
      const editCommand = { requestKey: crypto.randomUUID(), expectedReviewRevision: review.reviewRevision, expectedEditRevision: 0,
        edits: [{ difficulty: "child", entryId: previewEntry.id, clue: "초안 정리 후 저장한 합성 단서" }] };
      const savedEdit = await saveWithdrawalEdits(db, owner.quizSetId, editCommand, "synthetic-admin@example.invalid", new Date("2026-10-01T00:00:00.000Z"));
      expect(await readWithdrawalEdits(db, owner.quizSetId)).toEqual(savedEdit.revision);
      const savedPreview = await previewWithdrawalEdits(db, owner.quizSetId, { expectedReviewRevision: review.reviewRevision, expectedEditRevision: 1, edits: [] });
      expect(savedPreview).toMatchObject({ codeChecksPassed: true, editRevision: 1, requiresHumanReview: true });
      expect(savedPreview.variants.find(v => v.difficulty === "child")!.preview!.grid.entries.find(e => e.id === previewEntry.id)!.clue)
        .toBe("초안 정리 후 저장한 합성 단서");
      expect((await purgeExpiredDraft(db, owner.sermonId, "2026-10-07T23:59:59.999Z")).outcome).toBe("not_due");
      expect((await purgeExpiredDraft(db, owner.sermonId, "2026-10-08T00:00:00.000Z")).outcome).toBe("purged");
      await expect(readWithdrawalEdits(db, owner.quizSetId)).rejects.toThrow("DRAFT_EXPIRED");
      expect(await readWithdrawalReview(db, owner.quizSetId)).toEqual(review);
      expect(await capture()).toEqual(before);
      for (const variant of review.review.variants) {
        const solution = await db.prepare("SELECT solution_cells_json,entry_answers_json FROM quiz_solutions WHERE quiz_variant_id=?").bind(variant.sourceVariantId).first<{ solution_cells_json: string; entry_answers_json: string }>();
        expect(variant.solutionCells).toEqual(JSON.parse(solution!.solution_cells_json));
        expect(variant.entryAnswers).toEqual(JSON.parse(solution!.entry_answers_json));
      }
      expect((await db.prepare("SELECT * FROM quiz_variants WHERE quiz_set_id=? ORDER BY id").bind(owner.quizSetId).all()).results)
        .toEqual(variants.map(v => ({ ...v, lifecycle_status: "withdrawn", lifecycle_reason: cmd.reason, lifecycle_changed_at: "2026-09-29T01:00:00.000Z" })));
      for (const level of ["child", "adult"] as const) expect((await publicRepository.read({ slug: published.slug }, level)).quiz).toBeNull();
      await expect(publishReviewedQuiz(db, owner.quizSetId, request, actor)).rejects.toThrow("PUBLICATION_CONFLICT");
      const revisionActor="synthetic-admin@example.invalid", revisionAt=new Date("2026-10-09T00:00:00.000Z");
      let revision=revisionViewSchema.parse(await executeQuizRevision(db,owner.quizSetId,{action:"start",requestKey:crypto.randomUUID(),expectedCycle:0},revisionActor,revisionAt));
      const edited=structuredClone(revision.body!.content);edited.summary="정리 뒤 검토한 새 발행 요약";
      revision=revisionViewSchema.parse(await executeQuizRevision(db,owner.quizSetId,{action:"save",requestKey:crypto.randomUUID(),sessionId:revision.sessionId,expectedRevision:revision.revision,content:edited},revisionActor,revisionAt));
      for (const area of ["summary","child","adult"]) revision=revisionViewSchema.parse(await executeQuizRevision(db,owner.quizSetId,{action:"review",requestKey:crypto.randomUUID(),sessionId:revision.sessionId,expectedRevision:revision.revision,area,confirmed:true},revisionActor,revisionAt));
      revision=revisionViewSchema.parse(await executeQuizRevision(db,owner.quizSetId,{action:"publish",requestKey:crypto.randomUUID(),sessionId:revision.sessionId,expectedRevision:revision.revision,confirmation:"publish"},revisionActor,revisionAt));
      expect(revision.state).toBe("published");
      for(const level of ["child","adult"] as const) {
        const current=await publicRepository.read({slug:published.slug},level,revisionAt);
        expect(current.quiz?.sermon.summary?.text).toBe(edited.summary);expect(current.quiz?.variant.revision).toBe(2);
      }
      // All pre-existing rows survive. The publication adds only new variant/entry/solution rows.
      const after=await capture();
      for (let i=0;i<tables.length;i++) expect(after[i]).toEqual(expect.arrayContaining(before[i]!));
      expect((await purgeExpiredDraft(db,owner.sermonId,"2026-10-16T00:00:00.000Z")).outcome).toBe("purged");
      expect((await publicRepository.read({slug:published.slug},"child",revisionAt)).quiz?.sermon.summary?.text).toBe(edited.summary);
      expect(await db.prepare("SELECT 1 present FROM draft_cleanup_records WHERE sermon_id=?").bind(owner.sermonId).first()).toEqual({present:1});
      expect(await db.prepare("SELECT count(*) n FROM sermon_content_chunks WHERE sermon_id=?").bind(owner.sermonId).first()).toEqual({n:0});
      expect(await db.prepare("PRAGMA foreign_key_check").all()).toMatchObject({ results: [] });
      return;
    }
    await db.prepare("UPDATE quiz_sets SET status='archived',archived_at='2026-09-29T00:00:00.000Z' WHERE id=?").bind(owner.quizSetId).run();
    const archive = await createArchiveRepository(createDatabase(db), "test-only-archive-secret-at-least-32-characters").read({
      q: "TEST_ONLY_PRIVATE_METADATA", year: null, month: null, limit: 12, cursor: null });
    expect(archive.items).toEqual(expect.arrayContaining([expect.objectContaining({ slug: published.slug, title: "TEST_ONLY_PRIVATE_METADATA" })]));
    const sourceKeys = await db.prepare("PRAGMA foreign_key_list(published_quiz_content)").all<{ table: string }>();
    expect(sourceKeys.results.map(row => row.table)).toEqual(["quiz_sets"]);
    // P5-57: actual local generation/publication followed by payload cleanup.
    // Capture every permanent table, including participation, ranks, usage and provenance.
    const permanentTables = ["sermons", "quiz_sets", "quiz_variants", "quiz_entries_public", "quiz_solutions",
      "published_quiz_content", "submissions", "leaderboard_snapshots", "leaderboard_snapshot_entries",
      "ai_provider_calls", "ai_usage_events", "ai_usage_observations", "ai_usage_settlements", "generation_jobs",
      "generation_job_events", "generation_step_result_links", "generation_final_validation_proofs"];
    const capture = async () => Promise.all(permanentTables.map(async table => (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results));
    const variant = await db.prepare("SELECT id FROM quiz_variants WHERE quiz_set_id=? AND difficulty='child'").bind(owner.quizSetId).first<{ id: string }>();
    const session = await hash(crypto.randomUUID()), submission = crypto.randomUUID(), rankSnapshot = crypto.randomUUID();
    await db.prepare("INSERT INTO anonymous_sessions(session_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?)").bind(session,"2026-09-22T00:00:00.000Z","2026-09-22T00:00:00.000Z","2026-12-22T00:00:00.000Z").run();
    await db.prepare(`INSERT INTO submissions(id,quiz_variant_id,quiz_revision,session_hash,idempotency_key,request_hash,display_name,
      comment,answers_json,correctness_mask,correct_cells,total_cells,correct_words,total_words,score_basis_points,is_fully_correct,status,submitted_at)
      VALUES(?,?,1,?,'01924f8e-7b2a-7f1c-8f3a-123456789abc',?,'합성 참여자','보존할 합성 코멘트','{"r0c0":"가"}','1',1,1,1,1,10000,1,'visible','2026-09-22T01:00:00.000Z')`)
      .bind(submission,variant!.id,session,actor).run();
    await db.prepare("INSERT INTO leaderboard_snapshots(id,quiz_variant_id,winner_count,finalized_at) VALUES(?,?,3,'2026-09-29T00:00:00.000Z')").bind(rankSnapshot,variant!.id).run();
    await db.prepare("INSERT INTO leaderboard_snapshot_entries(snapshot_id,rank,submission_id) VALUES(?,1,?)").bind(rankSnapshot,submission).run();
    const inputSource = (await f.store.head(owner.sermonId))!;
    const nativeId = crypto.randomUUID();
    await db.prepare(`INSERT INTO sermon_transcripts(id,sermon_id,source_revision,language,provider,source_mode,manual_source_kind,
      source_coverage,raw_text,raw_sha256,confirmed_text,confirmed_sha256,status,confirmed_revision_id,confirmed_by,confirmed_at,retention_mode,fetched_at)
      VALUES(?,?,1,'ko','synthetic','manual_paste','youtube_visible_transcript','full_transcript',?, ?, ?, ?,'confirmed',?,'synthetic-actor','2026-09-22T00:00:00.000Z',?,'2026-09-22T00:00:00.000Z')`)
      .bind(nativeId,owner.sermonId,raw,inputSource.document_sha256,raw,inputSource.document_sha256,inputSource.document_id,
        selected ? "delete_text_after_publish" : "keep_private").run();
    const nativeBefore = await db.prepare("SELECT * FROM sermon_transcripts WHERE id=?").bind(nativeId).first();
    const permanent = await capture();
    const publicBefore = await publicRepository.read({ slug: published.slug }, "child", new Date("2026-09-30T00:00:00.000Z"));
    expect((await purgeExpiredDraft(db, owner.sermonId, "2026-09-28T23:59:59.999Z")).outcome).toBe("not_due");
    expect((await purgeExpiredDraft(db, owner.sermonId, "2026-09-29T00:00:00.000Z")).outcome).toBe("purged");
    expect(await capture()).toEqual(permanent);
    const nativeAfter = await db.prepare("SELECT * FROM sermon_transcripts WHERE id=?").bind(nativeId).first();
    expect(nativeAfter).toEqual(selected ? { ...nativeBefore, raw_text: "", confirmed_text: "", raw_segments_json: null } : nativeBefore);
    expect(await db.prepare("SELECT count(*) n FROM sermon_input_chunks WHERE sermon_id=? AND event_id=?").bind(owner.sermonId,inputSource.source_id).first())
      .toEqual({ n: selected ? 0 : 1 });

    expect(await publicRepository.read({ slug: published.slug }, "child", new Date("2026-09-30T00:00:00.000Z"))).toEqual(publicBefore);
    expect(await createArchiveRepository(createDatabase(db), "test-only-archive-secret-at-least-32-characters").read({
      q: "TEST_ONLY_PRIVATE_METADATA", year: null, month: null, limit: 12, cursor: null })).toEqual(archive);
    for (const query of ["SELECT count(*) n FROM sermon_content_chunks WHERE sermon_id=?",
      "SELECT count(*) n FROM generation_context_chunks WHERE context_id IN (SELECT id FROM generation_contexts WHERE sermon_id=?)",
      "SELECT count(*) n FROM final_check_ticket_chunks WHERE ticket_id IN (SELECT id FROM final_check_tickets WHERE sermon_id=?)"])
      expect(await db.prepare(query).bind(owner.sermonId).first()).toEqual({ n: 0 });
    // P5-58: correct display metadata after real synthetic publication and draft purge.
    const originalView = await readPublishedDisplayText(db, owner.quizSetId);
    const correction = { requestKey: crypto.randomUUID(), expectedRevision: 0, before: originalView.quiz.metadata,
      after: { title: `정정된 합성 설교 ${owner.quizSetId}`, sermonDate: "2025-12-28" }, reason: "합성 표시 정정 보존 검사" };
    await correctPublishedDisplayText(db, owner.quizSetId, correction, "synthetic-admin@example.invalid");
    expect(await capture()).toEqual(permanent);
    const corrected = await publicRepository.read({ slug: published.slug }, "child", new Date("2026-09-30T00:00:00.000Z"));
    expect(corrected).toEqual({ ...publicBefore, quiz: { ...publicBefore.quiz!, sermon: { ...publicBefore.quiz!.sermon,
      title: correction.after.title, date: correction.after.sermonDate } } });
    expect((await publicRepository.read({ slug: published.slug }, "adult", new Date("2026-09-30T00:00:00.000Z"))).quiz?.sermon.title).toBe(correction.after.title);
    const correctedArchive = await createArchiveRepository(createDatabase(db), "test-only-archive-secret-at-least-32-characters").read({
      q: correction.after.title, year: 2025, month: 12, limit: 12, cursor: null });
    expect(correctedArchive.items).toEqual([expect.objectContaining({ slug: published.slug, title: correction.after.title, sermonDate: "2025-12-28" })]);
    expect(correctedArchive.availableYears).toContain(2025);
    expect(correctedArchive.availableMonths).toContain(12);
    expect(JSON.stringify(corrected)).not.toMatch(/합성 표시 정정 보존 검사|example.invalid|actorDigest|requestKey/u);
    expect((await readPublishedDisplayText(db, owner.quizSetId)).history).toHaveLength(1);
    expect(await db.prepare("PRAGMA foreign_key_check").all()).toMatchObject({ results: [] });

  }, 90_000);

  it("selects and persists actual alternative grids, finishes with that selection, and invalidates stale review", async () => {
    const f = await fixture(false, true), fetcher = responses();
    await execute(f, fetcher);
    const owner = { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId };
    const command = async (version: number, operation: unknown) => executeContentHumanCommand(db, owner,
      { requestKey: crypto.randomUUID(), expectedVersion: version, operation }, actor);
    const critiqueId = `result-${owner.jobId}-intent_critique`;
    await command(4, { family: "intent", operation: { kind: "select", analysisId: critiqueId } });
    await command(5, { family: "intent", operation: { kind: "confirm", analysisId: critiqueId } });
    const resume = await requestContentResume(db, owner);
    if (!("dispatchId" in resume)) throw new Error("resume");
    await sendContentDispatch(db, { get: async () => ({ sendEvent: async () => undefined }) } as never, resume.dispatchId);
    const candidate = { candidates: ["가나다", "라마바", "가사라", "다아바", "허호"].map((answer, i) => ({ id: `word-${i}`, displayAnswer: answer, gridAnswer: answer,
      clue: `합성 설명 ${i}`, phraseDescription: "명사구", selectionReason: "근거", sermonImportance: "핵심", difficultyReason: "난도",
      grounding: { origin: "transcript", intentClaimIds: ["centralMessage"], evidence: [evidence()] } })) };
    const contentFetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete({ paragraphs: [{ id: "p", text: "합성 요약", intentClaimIds: ["centralMessage"], evidence: [evidence()] }] }))
      .mockImplementationOnce(async () => complete(candidate)).mockImplementationOnce(async () => complete({ candidates: candidate.candidates.map(c => ({ ...c, clue: `장년 ${c.clue}` })) }));
    await runContentGeneration(bindings, { dispatchId: resume.dispatchId }, owner.jobId, { fetch: contentFetcher });
    const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
    const basis = { expectedVersion: 12, expectedMetadataRevision: 1, expectedSelectionRevision: 1 };
    await expect(trialContentPlacement(db, owner, { ...basis, expectedVersion: 9, difficulty: "child", options })).rejects.toThrow("PLACEMENT_STALE");
    for (const [index, family] of (["summary", "child", "adult"] as const).entries()) await command(9 + index,
      family === "summary" ? { family: "summary", operation: { kind: "review", summaryId: `result-${owner.jobId}-summary` } } :
        { family: "candidate", operation: { kind: "review", difficulty: family, poolId: `result-${owner.jobId}-${family}_candidates` } });
    const beforeUsage = await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(owner.jobId).all();
    const trial = await trialContentPlacement(db, owner, { ...basis, difficulty: "child", options });
    expect(trial.layouts.map(l => l.grid.gridSize)).toEqual([5, 6]);
    expect(trial.layouts[1]?.omitted).toEqual(["허호"]);
    expect(JSON.stringify(trial.layouts[0]?.grid)).not.toMatch(/solution|gridAnswer|displayAnswer|grounding|가나다/u);
    expect(trial.layouts[0]?.solution.entries).toBeTruthy();
    const empty = await trialContentPlacement(db, owner, { ...basis, difficulty: "child", options: { ...options, targetWordCounts: [7] } });
    expect(empty.layouts).toEqual([]); expect(empty.reasons.length).toBeGreaterThan(0);
    const pick = { ...basis, requestKey: crypto.randomUUID(), selection: { child: { options, index: 1 }, adult: { options, index: 0 } } };
    await expect(selectContentPlacement(db, owner, { ...pick, selection: { ...pick.selection, child: { options, index: 2 } } }, actor)).rejects.toThrow("PLACEMENT_NOT_READY");
    expect(await selectContentPlacement(db, owner, pick, actor)).toEqual({ outcome: "saved", current: true });
    expect(await selectContentPlacement(db, owner, pick, actor)).toEqual({ outcome: "replayed", current: true });
    await expect(selectContentPlacement(db, owner, { ...pick, requestKey: crypto.randomUUID() }, actor)).rejects.toThrow("PLACEMENT_STALE");
    await expect(selectContentPlacement(db, owner, { ...pick, selection: { child: { options, index: 0 }, adult: pick.selection.adult } }, actor)).rejects.toThrow("PLACEMENT_REQUEST_CONFLICT");
    await expect(selectContentPlacement(db, { ...owner, quizSetId: "foreign" }, pick, actor)).rejects.toThrow();
    expect(await finishContentGeneration(db, owner)).toMatchObject({ outcome: "review_ready", preview: { variants: { child: { gridSize: 6 }, adult: { gridSize: 5 } } } });
    const proof = await db.prepare("SELECT * FROM generation_final_validation_proofs WHERE job_id=?").bind(owner.jobId).first();
    let view = await readContentGenerationView(db, owner.sermonId, false);
    expect(view.placement).toMatchObject({ revision: 2, current: true });
    expect(view.preview?.variants.child.gridSize).toBe(6);
    expect(view.reviewLayouts?.child.solution).toEqual(trial.layouts[1]?.solution);
    expect(JSON.stringify(view.preview)).not.toMatch(/solution|gridAnswer|displayAnswer|grounding|actor|가나다/u);
    const second = { ...pick, requestKey: crypto.randomUUID(), expectedSelectionRevision: 2,
      selection: { child: { options, index: 0 }, adult: { options, index: 1 } } };
    expect(await selectContentPlacement(db, owner, second, actor)).toEqual({ outcome: "saved", current: true });
    expect(await selectContentPlacement(db, owner, pick, actor)).toEqual({ outcome: "replayed", current: false });
    const third = { ...pick, requestKey: crypto.randomUUID(), expectedSelectionRevision: 3 };
    expect(await selectContentPlacement(db, owner, third, actor)).toEqual({ outcome: "saved", current: true });
    expect(await db.prepare("SELECT * FROM generation_final_validation_proofs WHERE job_id=?").bind(owner.jobId).first()).toEqual(proof);
    // Real HTTP boundary, with Access keys mocked and AI disabled.
    const access = await createAccessFixture(new Date());
    const accessFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    try {
      const path = `https://example.com/api/admin/sermons/${owner.sermonId}/generation/${owner.jobId}/placement-trial`;
      const request = (body: unknown, origin = "https://example.com", auth = true) => exports.default.fetch(new Request(path, {
        method: "POST", body: JSON.stringify(body), headers: { Origin: origin, "Content-Type": "application/json", ...(auth ? { "Cf-Access-Jwt-Assertion": access.token } : {}) } }));
      const trialBody = { ...basis, expectedSelectionRevision: 4, difficulty: "adult", options };
      expect((await request(trialBody, "https://example.com", false)).status).toBe(401);
      expect((await request(trialBody, "https://foreign.invalid")).status).toBe(403);
      expect((await request({ ...trialBody, grid: trial.layouts[0]!.grid })).status).toBe(409);
      expect((await request({ ...trialBody, options: { ...options, gridSizes: [5, 5] } })).status).toBe(409);
      const response = await request(trialBody);
      expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ data: { difficulty: "adult", layouts: [{ grid: { gridSize: 5 } }, { grid: { gridSize: 6 } }] } });
    } finally { accessFetch.mockRestore(); }
    // Candidate state change invalidates the old review and preview, but never deletes choices or charges AI.
    const lockedPool = await command(12, { family: "candidate", operation: { kind: "set_status", difficulty: "child", poolId: `result-${owner.jobId}-child_candidates`, candidateId: "word-4", status: "locked" } });
    view = await readContentGenerationView(db, owner.sermonId, false);
    expect(view.preview).toBeNull(); expect(view.reviewLayouts).toBeNull(); expect(view.placement?.current).toBe(false);
    await command(13, { family: "candidate", operation: { kind: "review", difficulty: "child", poolId: lockedPool.eventId } });
    const locked = await trialContentPlacement(db, owner, { ...basis, expectedVersion: 14, expectedSelectionRevision: 4, difficulty: "child", options });
    expect(locked.layouts).toEqual([]);
    expect(await db.prepare("SELECT count(*) n FROM generation_placement_selections WHERE job_id=?").bind(owner.jobId).first()).toEqual({ n: 3 });
    expect((await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(owner.jobId).all()).results).toEqual(beforeUsage.results);
    expect(await db.prepare("SELECT status FROM quiz_sets WHERE id=?").bind(owner.quizSetId).first()).toEqual({ status: "draft" });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(contentFetcher).toHaveBeenCalledTimes(3);
  }, 90_000);
  it("keeps unlocated evidence visibly unverified and continues to critique without a retry", async () => {
    const logs = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = await fixture(), draft = analysis();
    draft.centralMessage[0]!.evidence[0]!.quote = "없는 근거";
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete(draft))
      .mockImplementationOnce(async () => complete({ analysis: draft, critique: clearCritique }));
    expect((await execute(f, fetcher)).outcome).toBe("awaiting_intent_review");
    expect((await execute(f, fetcher)).outcome).toBe("awaiting_intent_review");
    const domain = await readIntentDomain(db, { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId });
    expect(domain.basis.snapshots.filter(s => s.kind === "intent").every(s =>
      s.kind === "intent" && s.value.analysis.centralMessage[0]?.evidence[0]?.locationStatus === "unverified")).toBe(true);
    expect(JSON.stringify(logs.mock.calls)).not.toContain("없는 근거");
    logs.mockRestore();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await db.prepare("SELECT count(*) n FROM sermon_content_events WHERE sermon_id=?").bind(f.sermonId).first()).toEqual({ n: 2 });
    expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(f.requested.jobId).first()).toEqual({ n: 2 });
  });
  it("distinguishes provider schema rejection and preserves its cost without critique", async () => {
    const logs = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const f = await fixture(), fetcher = vi.fn<typeof fetch>(async () => complete({ privateSecret: "not-for-logs" }));
      expect((await execute(f, fetcher)).outcome).toBe("rejected");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(logs.mock.calls.map(([line]) => JSON.parse(String(line)))).toContainEqual({
        code: "CONTENT_VALIDATION_DIAGNOSTIC", callId: `call-${f.requested.jobId}-intent_analysis`,
        stage: "provider", task: "intent_analysis", reason: "AI_DRAFT_OUTPUT_INVALID", evidence: null,
      });
      expect(JSON.stringify(logs.mock.calls)).not.toContain("not-for-logs");
      expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(f.requested.jobId).first()).toEqual({ n: 1 });
    } finally { logs.mockRestore(); }
  });
  it("keeps completed analysis and does not repeat an uncertain critique", async () => {
    const f = await fixture(), fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete(analysis()))
      .mockImplementationOnce(async () => { throw new Error("response lost"); });
    expect((await execute(f, fetcher)).outcome).toBe("uncertain");
    expect((await execute(f, fetcher)).outcome).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const captured = await readIntentDomain(db, { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId });
    expect(captured.basis.snapshots).toHaveLength(1);
    expect((await createGenerationLifecycleStore(db).readOutcome(f.requested.jobId, "intent_critique", 1)).outcome).toBe("present");
  });
  it("replaces an uncertain full request only explicitly and preserves its calls and costs", async () => {
    const f = await fixture(false, true), lifecycle = createGenerationLifecycleStore(db);
    const request = await lifecycle.readContext(`request-${f.requested.jobId}`);
    if (request.outcome !== "present" || request.value.context.kind !== "request" || request.value.context.authority.selection.state !== "present") throw new Error("fixture");
    const selection = request.value.context.authority.selection.value;
    await expect(requestFullGeneration(db, f.sermonId, { ...f.command, requestKey: crypto.randomUUID(), selection,
      supersedesJobId: f.requested.jobId }, actor)).rejects.toThrow("GENERATION_RETRY_CONFLICT");
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete(analysis())).mockRejectedValueOnce(new Error("lost"));
    expect((await execute(f, fetcher)).outcome).toBe("uncertain");
    expect((await execute(f, fetcher)).outcome).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const retry = { ...f.command, requestKey: crypto.randomUUID(), expectedVersion: 3, selection, supersedesJobId: f.requested.jobId };
    const next = await requestFullGeneration(db, f.sermonId, adminContentRequestSchema.parse(retry), actor);
    expect(next.outcome).toBe("created");
    expect((await requestFullGeneration(db, f.sermonId, adminContentRequestSchema.parse(retry), actor)).outcome).toBe("replayed");
    expect(await db.prepare("SELECT status FROM generation_jobs WHERE id=?").bind(f.requested.jobId).first()).toEqual({ status: "stale" });
    expect(await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=?").bind(f.requested.jobId).first()).toEqual({ n: 2 });
    expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(f.requested.jobId).first()).toEqual({ n: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("preserves observed cost if the confirmed transcript changes during analysis", async () => {
    const f = await fixture(), head = (await f.store.head(f.sermonId))!;
    const fetcher = vi.fn<typeof fetch>(async () => {
      await f.service.execute(f.sermonId, { action: "edit", expectedVersion: 2, sourceId: head.source_id,
        documentId: head.document_id, documentSha256: head.document_sha256, content: { format: "plain_text", text: "새 본문" } },
      { adminId: actor, kind: "human", now: new Date().toISOString() });
      return complete(analysis());
    });
    expect((await execute(f, fetcher)).outcome).toBe("stale");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(f.requested.jobId).first()).toEqual({ n: 1 });
    expect(await db.prepare("SELECT count(*) n FROM sermon_content_events WHERE sermon_id=?").bind(f.sermonId).first()).toEqual({ n: 0 });
  });
  it("preserves decimal evidence and intent payloads larger than the old synthetic 128KiB ceiling", async () => {
    const f = await fixture(true), draft = analysis(true);
    for (const claims of Object.values(draft)) for (const claim of claims) for (const evidence of claim.evidence) evidence.segmentId = "segment-1";
    draft.centralMessage[0]!.text = "합성 분석 ".repeat(20_000);
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete(draft))
      .mockImplementationOnce(async () => complete({ analysis: draft, critique: clearCritique }));
    expect((await execute(f, fetcher)).outcome).toBe("awaiting_intent_review");
    const captured = await readIntentDomain(db, { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId });
    for (const s of captured.basis.snapshots) expect(s.kind === "intent" && s.value.analysis).toEqual(draft);
    expect(await db.prepare("SELECT min(payload_byte_length) bytes FROM sermon_content_events WHERE sermon_id=?")
      .bind(f.sermonId).first<{ bytes: number }>().then(row => row!.bytes)).toBeGreaterThan(131072);
    expect((await execute(f, fetcher)).outcome).toBe("awaiting_intent_review");
    const owner = { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId };
    const edited = await executeContentHumanCommand(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: 4,
      operation: { family: "intent", operation: { kind: "edit", baseAnalysisId: `result-${owner.jobId}-intent_analysis`, analysis: draft } } }, actor);
    expect(edited.outcome).toBe("saved");
    const beforeEvents = (await db.prepare("SELECT * FROM sermon_content_events WHERE sermon_id=? ORDER BY content_sequence").bind(f.sermonId).all()).results;
    const beforeUsage = (await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(owner.jobId).all()).results;
    const eventIds = beforeEvents.map(event => String(event.event_id));
    const beforeView = await readDisplaySnapshots(db, owner, eventIds);
    await db.prepare("DELETE FROM generation_display_snapshots WHERE sermon_id=?").bind(f.sermonId).run();
    await expect(readDisplaySnapshots(db, owner, eventIds)).rejects.toThrow("CONTENT_DISPLAY_NOT_PREPARED");
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_DISABLED_IN_DISPLAY_PREPARATION"));
    try {
      for (const event of beforeEvents) await expect(prepareDisplayEvent(db, owner, String(event.event_id))).resolves.toEqual({ outcome: "prepared" });
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
    expect(await readDisplaySnapshots(db, owner, eventIds)).toEqual(beforeView);
    for (const { snapshot } of await readDisplaySnapshots(db, owner, eventIds)) {
      expect(snapshot?.kind === "intent" && snapshot.value.analysis).toEqual(draft);
    }
    expect((await db.prepare("SELECT * FROM sermon_content_events WHERE sermon_id=? ORDER BY content_sequence").bind(f.sermonId).all()).results).toEqual(beforeEvents);
    expect((await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(owner.jobId).all()).results).toEqual(beforeUsage);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not treat a persisted-looking payload as a new write permit", async () => {
    const f = await fixture();
    expect((await execute(f, responses())).outcome).toBe("awaiting_intent_review");
    const eventId = `result-${f.requested.jobId}-intent_analysis`;
    const [event] = await readVerifiedEvents(db, f.sermonId, [eventId]);
    const contextId = `step-${f.requested.jobId}-intent_analysis`;
    const sealed = await createGenerationLifecycleStore(db).readContext(contextId);
    if (sealed.outcome !== "present" || sealed.value.context.kind !== "step") throw new Error("fixture");
    await expect(prepareLifecycleArtifact(db, sealed.value.context, { id: eventId, actorDigest: null, payload: event!.payload },
      new Date().toISOString(), contextId)).rejects.toThrow("DOMAIN_STORAGE_INVALID");
    await expect(readIntentDomain(db, { sermonId: f.sermonId, quizSetId: "foreign-quiz", jobId: f.requested.jobId })).rejects.toThrow();
  });
  it("refuses changed heads and tampered stored bytes while preserving the real records", async () => {
    const f = await fixture();
    expect((await execute(f, responses())).outcome).toBe("awaiting_intent_review");
    const owner = { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId };
    function intercepted(mode: "head" | "chunk") {
      let reads = 0;
      return new Proxy(db, { get(target, property) {
        if (property !== "prepare") return Reflect.get(target, property);
        return (query: string) => {
          const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(statement, property) {
            if (property === "bind") return (...args: unknown[]) => wrap(statement.bind(...args));
            if (mode === "head" && property === "first" && query.includes("FROM sermon_content_heads h")) return async () => {
              const row = await statement.first<Record<string, unknown>>();
              return ++reads === 2 ? { ...row, last_event_id: "changed-head" } : row;
            };
            if (mode === "chunk" && property === "all" && query.includes("FROM sermon_content_chunks WHERE")) return async () => {
              const result = await statement.all<Record<string, unknown>>();
              return { ...result, results: result.results.map((row, index) => index === 0 ? { ...row, body_hex: "01" } : row) };
            };
            const value: unknown = Reflect.get(statement, property);
            return typeof value === "function" ? value.bind(statement) : value;
          } });
          return wrap(target.prepare(query));
        };
      } });
    }
    await expect(readIntentDomain(intercepted("head"), owner)).rejects.toThrow("GENERATION_AUTHORITY_CHANGED");
    await expect(readIntentDomain(intercepted("chunk"), owner)).rejects.toThrow("HUMAN_CONTENT_STORAGE_CORRUPT");
    expect((await readIntentDomain(db, owner)).basis.snapshots).toHaveLength(2);
  });
});

// Reuse the real full workflow setup; partial jobs must preserve its selected content.
async function regenerationFixture(registered?: { sermonId: string; quizSetId: string }) {
  const f = await fixture(false, true, registered);
  await execute(f, responses());
  const owner = { sermonId: f.sermonId, quizSetId: f.quizSetId, jobId: f.requested.jobId };
  const human = async (operation: unknown) => {
    const view = await readContentGenerationView(db, owner.sermonId, false);
    return executeContentHumanCommand(db, owner, { requestKey: crypto.randomUUID(), expectedVersion: view.version, operation }, actor);
  };
  const critiqueId = `result-${owner.jobId}-intent_critique`;
  await human({ family: "intent", operation: { kind: "select", analysisId: critiqueId } });
  await human({ family: "intent", operation: { kind: "confirm", analysisId: critiqueId } });
  const resume = await requestContentResume(db, owner);
  if (!("dispatchId" in resume)) throw new Error("resume");
  await sendContentDispatch(db, { get: async () => ({ sendEvent: async () => undefined }) } as never, resume.dispatchId);
  const summary = { paragraphs: [{ id: "p", text: "합성 요약", intentClaimIds: ["centralMessage"], evidence: [evidence()] }] };
  const candidate = { candidates: ["가나다", "라마바", "가사라", "다아바"].map((answer, i) => ({ id: `word-${i}`, displayAnswer: answer, gridAnswer: answer,
    clue: `합성 설명 ${i}`, phraseDescription: "명사구", selectionReason: "근거", sermonImportance: "핵심", difficultyReason: "난도",
    grounding: { origin: "transcript", intentClaimIds: ["centralMessage"], evidence: [evidence()] } })) };
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete(summary))
    .mockImplementationOnce(async () => complete(candidate)).mockImplementationOnce(async () => complete({ candidates: candidate.candidates.map(c => ({ ...c, clue: `장년 ${c.clue}` })) }));
  expect((await runContentGeneration(bindings, { dispatchId: resume.dispatchId }, owner.jobId, { fetch: fetcher })).outcome).toBe("awaiting_content_review");
  for (const scope of ["summary", "child", "adult"] as const) await human(scope === "summary"
    ? { family: "summary", operation: { kind: "review", summaryId: `result-${owner.jobId}-summary` } }
    : { family: "candidate", operation: { kind: "review", difficulty: scope, poolId: `result-${owner.jobId}-${scope}_candidates` } });
  return { ...f, owner, human, summary, candidate };
}
describe("P5-71 display without replaying generation", { timeout: 30_000 }, () => {
  it("reads saved content and both grids repeatedly without restoring original bytes or searching layouts", async () => {
    const f = await regenerationFixture();
    expect((await finishContentGeneration(db, f.owner)).outcome).toBe("review_ready");
    const original = await readContentGenerationView(db, f.owner.sermonId, false);
    expect(original.preview).not.toBeNull();
    const queries: string[] = [], search = vi.spyOn(poolSearch, "searchCandidatePool");
    const observed = new Proxy(db, { get(target, key) {
      if (key === "prepare") return (sql: string) => { queries.push(sql); return target.prepare(sql); };
      const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    try {
      for (let n = 0; n < 3; n++) {
        const content = await readContentGenerationView(observed, f.owner.sermonId, false, undefined, "content");
        const placement = await readContentGenerationView(observed, f.owner.sermonId, false, undefined, "placement");
        expect(content).toMatchObject({ content: original.content, snapshots: original.snapshots, quality: original.quality });
        expect(placement).toMatchObject({ preview: original.preview, reviewLayouts: original.reviewLayouts, placement: original.placement });
      }
      expect(search).not.toHaveBeenCalled();
      expect(queries.some(sql => /sermon_input_chunks|sermon_content_chunks|generation_context_chunks|final_check_ticket_chunks/u.test(sql))).toBe(false);
      expect(queries.some(sql => /^\s*(INSERT|UPDATE|DELETE)/iu.test(sql))).toBe(false);
      // A valid digest cannot bypass the saved grid's geometry check. The API
      // shape-only composition is reachable only after this boundary succeeds.
      const saved = await db.prepare("SELECT ticket_id,body_json FROM generation_display_finals WHERE sermon_id=? AND difficulty='adult'")
        .bind(f.owner.sermonId).first<{ ticket_id: string; body_json: string }>();
      const malformed = JSON.parse(saved!.body_json) as { layout: { grid: { cells: { id: string }[] } } };
      malformed.layout.grid.cells[0]!.id = "r9c9";
      const damagedBody = JSON.stringify(malformed);
      await db.prepare("UPDATE generation_display_finals SET body_json=?,body_sha256=? WHERE ticket_id=? AND difficulty='adult'")
        .bind(damagedBody, await sha256Bytes(new TextEncoder().encode(damagedBody)), saved!.ticket_id).run();
      await expect(readContentGenerationView(observed, f.owner.sermonId, false, undefined, "placement")).rejects.toThrow();
      await db.prepare("DELETE FROM generation_display_finals WHERE sermon_id=? AND difficulty='adult'").bind(f.owner.sermonId).run();
      await expect(readContentGenerationView(observed, f.owner.sermonId, false, undefined, "placement")).rejects.toThrow("CONTENT_DISPLAY_NOT_PREPARED");
      expect(search).not.toHaveBeenCalled();
    } finally { search.mockRestore(); }
  });

  it("reads one saved snapshot and one difficulty per request, recombines exactly, and rejects a damaged part", async () => {
    const f = await regenerationFixture();
    await finishContentGeneration(db, f.owner);
    const original = await readContentGenerationView(db, f.owner.sermonId, false);
    const costs = await readContentGenerationParts(db, f.owner.sermonId, false, "costs");
    for (const key of ["weekCostMicroUsd", "weekUnknownCalls", "jobCostMicroUsd", "jobUnknownCalls", "quizCostMicroUsd", "quizUnknownCalls"] as const) {
      expect(costs?.[key]).toEqual(original[key]);
    }
    const index = await readContentGenerationParts(db, f.owner.sermonId, false, "content");
    expect(index?.content).toEqual(original.content); expect(index?.snapshots).toEqual([]);
    const snapshots = [];
    for (const id of index!.snapshotIds!) {
      const part = await readContentGenerationParts(db, f.owner.sermonId, false, "content", undefined, id);
      expect(part?.viewRevision).toBe(index!.viewRevision); expect(part?.snapshots).toHaveLength(1);
      snapshots.push(...part!.snapshots);
    }
    expect(snapshots).toEqual(original.snapshots);
    const child = await readContentGenerationParts(db, f.owner.sermonId, false, "placement", undefined, undefined, "child");
    const adult = await readContentGenerationParts(db, f.owner.sermonId, false, "placement", undefined, undefined, "adult");
    expect(child?.placement).toEqual(original.placement); expect(adult?.placement).toEqual(original.placement);
    expect({ child: child!.layoutPart!.layout, adult: adult!.layoutPart!.layout }).toEqual(original.reviewLayouts);
    expect({ ...child!.layoutPart!.preview, variants: { child: child!.layoutPart!.layout!.grid, adult: adult!.layoutPart!.layout!.grid } }).toEqual(original.preview);
    const id = index!.snapshotIds![0]!;
    await db.prepare("UPDATE generation_display_snapshots SET body_json=body_json || ' ' WHERE sermon_id=? AND event_id=?").bind(f.owner.sermonId, id).run();
    await expect(readContentGenerationParts(db, f.owner.sermonId, false, "content", undefined, id)).rejects.toThrow("CONTENT_DISPLAY_CORRUPT");
    await db.prepare("DELETE FROM generation_display_finals WHERE sermon_id=? AND difficulty='adult'").bind(f.owner.sermonId).run();
    await expect(readContentGenerationParts(db, f.owner.sermonId, false, "placement", undefined, undefined, "adult")).rejects.toThrow("CONTENT_DISPLAY_NOT_PREPARED");
    expect((await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=?").bind(f.owner.jobId).first<{ n: number }>())!.n).toBe(5);
  });
  it("prepares existing data through Cloudflare steps, preserves every original table and verifies the saved preview proof", async () => {
    const f = await regenerationFixture();
    expect((await finishContentGeneration(db, f.owner)).outcome).toBe("review_ready");
    const original = await readContentGenerationView(db, f.owner.sermonId, false);
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name NOT LIKE 'generation_display_%' ORDER BY name").all<{name: string}>()).results;
    async function originalRows() {
      const rows: Record<string, unknown> = {};
      for (const { name } of tables) rows[name] = (await db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).results;
      return rows;
    }
    const before = await originalRows();
    await db.batch([db.prepare("DELETE FROM generation_display_finals WHERE sermon_id=?").bind(f.owner.sermonId),
      db.prepare("DELETE FROM generation_display_snapshots WHERE sermon_id=?").bind(f.owner.sermonId)]);
    const params = { kind: "display-prepare" as const, ...f.owner, requestKey: crypto.randomUUID() };
    const names: string[] = [], outputs: unknown[] = [];
    const step = { do: async (name: string, _options: unknown, action: () => Promise<unknown>) => {
      names.push(name); const result = await action(); outputs.push(result); return result;
    } };
    const transport = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_DISABLED_IN_TEST"));
    try {
      const instanceId = await displayPreparationInstanceId(f.owner.jobId, params.requestKey);
      const context = { env: { DB: db, CONTENT_DISPLAY_PREPARATION_ENABLED: "true", CONTENT_DISPLAY_PREPARATION_SERMON_IDS: JSON.stringify([f.owner.sermonId]) } };
      const result = await ContentWorkflow.prototype.run.call(context as never, { payload: params, instanceId } as never, step as never);
      expect(result).toEqual({ outcome: "prepared" });
      expect(names).toContain("display-grid-child"); expect(names).toContain("display-grid-adult"); expect(names).toContain("display-verify");
      expect(names.filter(name => name.startsWith("display-event-")).length).toBeGreaterThan(5);
      expect(JSON.stringify(outputs)).not.toContain("합성 요약");
      expect(transport).not.toHaveBeenCalled();
      expect(await originalRows()).toEqual(before);
      expect(await readContentGenerationView(db, f.owner.sermonId, false)).toEqual(original);
      // A fresh request repairs only the derived copies; original paid records stay intact.
      await ContentWorkflow.prototype.run.call(context as never, { payload: params, instanceId } as never, step as never);
      expect(await originalRows()).toEqual(before);
      await expect(ContentWorkflow.prototype.run.call({ env: { DB: db } } as never,
        { payload: params, instanceId } as never, step as never)).rejects.toThrow("DISPLAY_PREPARATION_DISABLED");
    } finally { transport.mockRestore(); }
  });
  it("serves state/costs/activity without content bytes and preserves the combined display", async () => {
    const f = await regenerationFixture();
    const aggregate = await readContentGenerationView(db, f.owner.sermonId, false);
    const queries: string[] = [];
    const observed = new Proxy(db, { get(target, key) {
      if (key === "prepare") return (sql: string) => { queries.push(sql); return target.prepare(sql); };
      const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const state = await readContentGenerationView(observed, f.owner.sermonId, false, undefined, "state");
    const costs = await readContentGenerationView(observed, f.owner.sermonId, false, undefined, "costs");
    const activity = await readContentGenerationView(observed, f.owner.sermonId, false, undefined, "activity");
    expect(queries.some(sql => /sermon_content_chunks|generation_context_chunks|final_check_tickets/u.test(sql))).toBe(false);
    expect(state).toMatchObject({ jobId: aggregate.jobId, version: aggregate.version, status: aggregate.status, snapshots: [], preview: null });
    const content = await readContentGenerationView(db, f.owner.sermonId, false, undefined, "content");
    const placement = await readContentGenerationView(db, f.owner.sermonId, false, undefined, "placement");
    for (const part of [costs, activity, content, placement]) expect(part.viewRevision).toBe(state.viewRevision);
    expect(content).toMatchObject({ content: aggregate.content, snapshots: aggregate.snapshots, quality: aggregate.quality,
      historyCursor: aggregate.historyCursor, preview: null, placement: null, regenerations: [] });
    expect(placement).toMatchObject({ placement: aggregate.placement, preview: aggregate.preview, reviewLayouts: aggregate.reviewLayouts, snapshots: [], content: { state: "absent" } });
    expect(costs).toMatchObject({ weekCostMicroUsd: aggregate.weekCostMicroUsd, jobCostMicroUsd: aggregate.jobCostMicroUsd,
      quizCostMicroUsd: aggregate.quizCostMicroUsd });
    expect(activity.regenerations).toEqual(aggregate.regenerations);
    const path = `https://example.com/api/admin/sermons/${f.owner.sermonId}/generation/content?section=state`;
    expect((await exports.default.fetch(new Request(path))).status).toBe(401);
    const access = await createAccessFixture(new Date());
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    try {
      const response = await exports.default.fetch(new Request(path, { headers: { "Cf-Access-Jwt-Assertion": access.token } }));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ data: { jobId: state.jobId, version: state.version, snapshots: [], preview: null } });
    } finally { network.mockRestore(); }
    await saveContentQualityReview(db, f.owner, { requestKey: crypto.randomUUID(), expectedVersion: aggregate.version,
      targetSnapshotId: `result-${f.owner.jobId}-summary`, scope: "summary", status: "good", criteria: {}, adminNote: "합성 평가" }, actor);
    const changed = await readContentGenerationView(db, f.owner.sermonId, false, undefined, "state");
    expect(changed.version).toBe(state.version);
    expect(changed.viewRevision).not.toBe(state.viewRevision);
    expect((await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=?").bind(f.owner.jobId).first<{ n: number }>())!.n).toBe(5);
  });

  it("shows the sealed reviewed content, checks its owner and rejects damaged display bytes", async () => {
    const f = await regenerationFixture();
    const read = await readContentDisplay(db, f.owner, []);
    const authoritative = await readIntentDomain(db, f.owner);
    expect(read.version).toBe(authoritative.basis.authority.input.state === "present"
      ? authoritative.basis.authority.input.version + (authoritative.basis.authority.content.state === "present" ? authoritative.basis.authority.content.eventCount : 0) : -1);
    expect(read.snapshots.map(s => s.value.id).sort()).toEqual(authoritative.basis.snapshots.map(s => s.value.id).sort());
    expect(read.content).toMatchObject({ state: "present", summary: { review: { id: expect.any(String) } },
      child: { review: { id: expect.any(String) } }, adult: { review: { id: expect.any(String) } } });
    expect(await db.prepare(`SELECT count(*) n FROM generation_display_snapshots WHERE sermon_id=? AND
      (json_type(body_json,'$.snapshot.operation.analysis') IS NOT NULL OR json_type(body_json,'$.snapshot.operation.draft') IS NOT NULL)`)
      .bind(f.owner.sermonId).first()).toEqual({ n: 0 });
    // A copy prepared before command compaction remains readable without
    // preparing its original source again or changing any provider/usage row.
    const original = authoritative.basis.snapshots.find(s => s.kind === "intent")!;
    const stored = await db.prepare("SELECT body_json FROM generation_display_snapshots WHERE sermon_id=? AND event_id=?")
      .bind(f.owner.sermonId, original.value.id).first<{ body_json: string }>();
    const oldCopy = JSON.stringify({ ...(JSON.parse(stored!.body_json) as Record<string, unknown>), snapshot: original });
    await db.prepare("UPDATE generation_display_snapshots SET body_json=?,body_sha256=? WHERE sermon_id=? AND event_id=?")
      .bind(oldCopy, await sha256Bytes(new TextEncoder().encode(oldCopy)), f.owner.sermonId, original.value.id).run();
    expect(await readContentDisplay(db, f.owner, [])).toEqual(read);
    await expect(readContentDisplay(db, { ...f.owner, quizSetId: "wrong-owner" }, [])).rejects.toThrow("CONTENT_DISPLAY_CORRUPT");
    let corrupted = false;
    const damaged = new Proxy(db, { get(target, prop) {
      if (prop === "prepare") return (sql: string) => {
        const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(stmt, key) {
          if (key === "bind") return (...args: unknown[]) => wrap(stmt.bind(...args));
          if (key === "all" && sql.includes("generation_display_snapshots")) return async () => {
            const result = await stmt.all<Record<string, unknown>>();
            const row = result.results[0];
            if (row && typeof row.body_json === "string") { corrupted = true; row.body_json = `${row.body_json} `; }
            return result;
          };
          const value: unknown = Reflect.get(stmt, key); return typeof value === "function" ? value.bind(stmt) : value;
        } });
        return wrap(target.prepare(sql));
      };
      const value: unknown = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(readContentDisplay(damaged, f.owner, [])).rejects.toThrow("CONTENT_DISPLAY_CORRUPT");
    expect(corrupted).toBe(true);
    expect((await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=?").bind(f.owner.jobId).first<{ n: number }>())!.n).toBe(5);
  });
});
describe("P5-71 atomic reviewed completion", { timeout: 90_000 }, () => {
  it("rolls back every lifecycle transition after a late failure and retries without another provider call", async () => {
    const f = await regenerationFixture();
    const prepared = await createGenerationLifecycleStore(db).prepareReviewedFull(f.owner.jobId);
    expect(Object.isFrozen(prepared.initial)).toBe(true);
    expect(Object.isFrozen(prepared.prefix)).toBe(true);
    const snapshot = async () => (await db.batch([
      db.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(f.owner.jobId),
      db.prepare("SELECT * FROM generation_transition_evidence WHERE job_id=? ORDER BY event_no").bind(f.owner.jobId),
      db.prepare("SELECT * FROM generation_job_events WHERE generation_job_id=? ORDER BY event_no").bind(f.owner.jobId),
      db.prepare("SELECT * FROM generation_final_validation_proofs WHERE job_id=?").bind(f.owner.jobId),
      db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(f.owner.jobId),
    ])).map(result => result.results);
    const before = await snapshot();
    await db.prepare(`CREATE TRIGGER p571_abort_finish BEFORE UPDATE OF status ON generation_jobs
      WHEN NEW.status='review_ready' BEGIN SELECT RAISE(ABORT,'synthetic final rollback'); END`).run();
    try {
      expect((await finishContentGeneration(db, f.owner)).outcome).toBe("conflict");
      expect(await snapshot()).toEqual(before);
    } finally { await db.prepare("DROP TRIGGER p571_abort_finish").run(); }
    expect((await finishContentGeneration(db, f.owner)).outcome).toBe("review_ready");
    expect((await snapshot())[4]).toEqual(before[4]);
    expect(await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=?").bind(f.owner.jobId).first()).toEqual({ n: 5 });
  });
  it.each(["metadata", "quality", "response-loss"])("checks the atomic completion boundary under %s", async mode => {
    const f = await regenerationFixture(), finalStatements = new WeakSet<object>();
    const before = await db.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(f.owner.jobId).first();
    let intercepted = false;
    const connection = new Proxy(db, { get(target, property) {
      if (property === "prepare") return (query: string) => {
        const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
          const wrapped = new Proxy(statement, { get(stmt, key) {
            if (key === "bind") return (...values: unknown[]) => wrap(stmt.bind(...values));
            const value: unknown = Reflect.get(stmt, key);
            return typeof value === "function" ? value.bind(stmt) : value;
          } });
          if (query.startsWith("INSERT INTO generation_final_validation_proofs")) finalStatements.add(wrapped);
          return wrapped;
        };
        return wrap(target.prepare(query));
      };
      if (property === "batch") return async (statements: D1PreparedStatement[]) => {
        const final = !intercepted && statements.some(statement => finalStatements.has(statement));
        if (final) {
          intercepted = true;
          if (mode === "metadata") await db.prepare("UPDATE sermon_metadata_drafts SET metadata_revision=metadata_revision+1 WHERE sermon_id=?").bind(f.sermonId).run();
          if (mode === "quality") await saveContentQualityReview(db, f.owner, { requestKey: crypto.randomUUID(), expectedVersion: 12,
            targetSnapshotId: `result-${f.owner.jobId}-summary`, scope: "summary", status: "regenerate", criteria: {} }, actor);
        }
        const result = await target.batch(statements);
        if (final && mode === "response-loss") throw new Error("synthetic response loss after commit");
        return result;
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    expect((await finishContentGeneration(connection, f.owner)).outcome).toBe(mode === "response-loss" ? "review_ready" : "conflict");
    expect(intercepted).toBe(true);
    if (mode !== "response-loss") {
      expect(await db.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(f.owner.jobId).first()).toEqual(before);
      expect(await db.prepare("SELECT count(*) n FROM generation_final_validation_proofs WHERE job_id=?").bind(f.owner.jobId).first()).toEqual({ n: 0 });
    } else expect((await finishContentGeneration(db, f.owner)).outcome).toBe("review_ready");
    expect(await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=?").bind(f.owner.jobId).first()).toEqual({ n: 5 });
    expect(await db.prepare("SELECT count(*) n FROM ai_usage_events WHERE generation_job_id=?").bind(f.owner.jobId).first()).toEqual({ n: 5 });
  });
});

describe("stored content continuation", { timeout: 90_000 }, () => {
  it("finishes and publishes stored content without repeating AI calls or changing the old job", async () => {
    const registered = await registerSermonDraft(db, { title: "보관 결과 시험", sermonDate: "2026-09-20",
      referenceInput: "요한복음 3:16-18", confirmed: true, video: crypto.randomUUID().replaceAll("-", "").slice(0, 11) }, "synthetic@example.invalid");
    const f = await regenerationFixture(await readSermonDraft(db, registered.sermonId)), lifecycle = createGenerationLifecycleStore(db);
    const previous = await lifecycle.readJob(f.owner.jobId);
    if (previous.outcome !== "present") throw new Error("job");
    expect((await lifecycle.markStale(f.owner.jobId, previous.value.state_version, previous.value.request_context_id, new Date().toISOString())).outcome).toBe("saved");
    const preserved = await db.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(f.owner.jobId).first();
    const ledger = async () => (await db.prepare("SELECT * FROM ai_provider_calls WHERE quiz_set_id=? ORDER BY id").bind(f.quizSetId).all()).results;
    const before = await ledger(), version = (await readContentGenerationView(db, f.sermonId, false)).version;
    vi.setSystemTime(Date.now() + 1_000);
    const command = { requestKey: crypto.randomUUID(), expectedVersion: version };
    const continued = await resumeStoredContent(db, f.owner, command, actor);
    expect(await resumeStoredContent(db, f.owner, command, actor)).toEqual(continued);
    const owner = { ...f.owner, jobId: continued.jobId };
    const never = vi.fn<typeof fetch>(() => { throw new Error("NO_PROVIDER_CALL_ALLOWED"); });
    expect((await runContentGeneration(bindings, { dispatchId: `dispatch-${owner.jobId}` }, owner.jobId, { fetch: never })).outcome).toBe("not_ready");
    expect(await finishContentGeneration(db, owner)).toMatchObject({ outcome: "review_ready" });
    expect(await finishContentGeneration(db, owner)).toMatchObject({ outcome: "review_ready" });
    expect(never).not.toHaveBeenCalled();
    expect(await ledger()).toEqual(before);
    expect(await db.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(f.owner.jobId).first()).toEqual(preserved);
    expect((await db.prepare("SELECT count(*) AS n FROM generation_step_receipts WHERE generation_job_id=?").bind(owner.jobId).first<{ n: number }>())?.n).toBe(0);
    const published = await publishReviewedQuiz(db, f.quizSetId, { requestKey: crypto.randomUUID(), jobId: owner.jobId,
      expectedVersion: version, expectedMetadataRevision: 1, expectedSelectionRevision: 1, confirmation: "publish" }, actor);
    expect(published.outcome).toBe("published");
  });
  it("rejects incomplete stored content before creating a continuation", async () => {
    const f = await fixture(false, true), store = createGenerationLifecycleStore(db);
    const job = await store.readJob(f.requested.jobId);
    if (job.outcome !== "present") throw new Error("job");
    await store.markStale(job.value.id, job.value.state_version, job.value.request_context_id, new Date().toISOString());
    await expect(resumeStoredContent(db, { jobId: job.value.id, sermonId: f.sermonId, quizSetId: f.quizSetId },
      { requestKey: crypto.randomUUID(), expectedVersion: 2 }, actor)).rejects.toThrow("GENERATION_DOMAIN_NOT_READY");
  });
});

describe("individual regeneration", { timeout: 90_000 }, () => {
  it("runs only the requested scope, preserves selections/reviews/costs, and connects explicit choice to placement invalidation", async () => {
    const f = await regenerationFixture();
    expect((await finishContentGeneration(db, f.owner)).outcome).toBe("review_ready");
    const original = await readContentGenerationView(db, f.sermonId, false);
    const proof = await db.prepare("SELECT * FROM generation_final_validation_proofs WHERE job_id=?").bind(f.owner.jobId).first();
    const usage = (await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(f.owner.jobId).all()).results;
    for (const scope of ["summary", "child", "adult"] as const) {
      const before = await readContentGenerationView(db, f.sermonId, false);
      const command = { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId, scope, expectedVersion: before.version };
      const job = await requestContentRegeneration(db, f.sermonId, command, actor);
      expect((await requestContentRegeneration(db, f.sermonId, command, actor)).outcome).toBe("replayed");
      await expect(requestContentRegeneration(db, f.sermonId, { ...command, scope: scope === "summary" ? "child" : "summary" }, actor)).rejects.toThrow("GENERATION_REQUEST_CONFLICT");
      await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
      const fetcher = vi.fn<typeof fetch>(async () => complete(scope === "summary" ? { ...f.summary, paragraphs: [{ ...f.summary.paragraphs[0]!, text: "새 요약" }] } : scope === "adult" ? { candidates: f.candidate.candidates.map(c => ({ ...c, clue: `장년 ${c.clue}` })) } : f.candidate));
      expect(await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).toMatchObject({ outcome: "saved" });
      expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("review_ready");
      expect(fetcher).toHaveBeenCalledTimes(1);
      const after = await readContentGenerationView(db, f.sermonId, false);
      expect(after.content).toEqual(before.content);
      expect(after.regenerations.find(j => j.jobId === job.jobId)).toMatchObject({ scope, status: "review_ready", costMicroUsd: 524, unknownCalls: 0 });
      const resultId = `result-${job.jobId}-${scope === "summary" ? "summary" : `${scope}_candidates`}`;
      expect(after.snapshots.some(s => s.value.id === resultId)).toBe(true);
      await f.human(scope === "summary" ? { family: "summary", operation: { kind: "select", summaryId: resultId } }
        : { family: "candidate", operation: { kind: "select", difficulty: scope, poolId: resultId } });
      const selected = await readContentGenerationView(db, f.sermonId, false);
      expect(selected.preview).toBeNull(); expect(selected.reviewLayouts).toBeNull();
      expect(selected.content).toMatchObject({ [scope]: { id: resultId, review: null } });
      for (const other of ["summary", "child", "adult"] as const) if (other !== scope && selected.content.state === "present" && before.content.state === "present")
        expect(selected.content[other]).toEqual(before.content[other]);
      await f.human(scope === "summary" ? { family: "summary", operation: { kind: "review", summaryId: resultId } }
        : { family: "candidate", operation: { kind: "review", difficulty: scope, poolId: resultId } });
    }
    expect(original.preview).not.toBeNull();
    expect(await db.prepare("SELECT * FROM generation_final_validation_proofs WHERE job_id=?").bind(f.owner.jobId).first()).toEqual(proof);
    expect((await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(f.owner.jobId).all()).results).toEqual(usage);
    expect(await db.prepare("SELECT status FROM quiz_sets WHERE id=?").bind(f.quizSetId).first()).toEqual({ status: "draft" });
  });
});

describe("intent-only regeneration", { timeout: 90_000 }, () => {
  it("preserves the first analysis and old selection when critique response is uncertain", async () => {
    const f = await regenerationFixture(), before = await readContentGenerationView(db, f.sermonId, false);
    const command = { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId, scope: "intent", expectedVersion: before.version };
    const job = await requestContentRegeneration(db, f.sermonId, command, actor);
    await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete(analysis()))
      .mockRejectedValue(new Error("lost critique response"));
    expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("uncertain");
    expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const after = await readContentGenerationView(db, f.sermonId, false);
    expect(after.content).toEqual(before.content);
    expect(after.snapshots.some(s => s.value.id === `result-${job.jobId}-intent_analysis`)).toBe(true);
    expect(after.regenerations.find(j => j.jobId === job.jobId)).toMatchObject({ scope: "intent", status: "uncertain", unknownCalls: 1 });
    const replacement = { ...command, requestKey: crypto.randomUUID(), expectedVersion: after.version,
      supersedesJobId: job.jobId, retryCritiqueOnly: true as const };
    const retried = await requestContentRegeneration(db, f.sermonId, replacement, actor);
    expect(retried.outcome).toBe("created");
    expect((await requestContentRegeneration(db, f.sermonId, replacement, actor)).outcome).toBe("replayed");
    expect(await db.prepare("SELECT source_job_id,analysis_event_id FROM generation_intent_analysis_reuse WHERE job_id=?")
      .bind(retried.jobId).first()).toEqual({ source_job_id: job.jobId, analysis_event_id: `result-${job.jobId}-intent_analysis` });
    await sendContentDispatch(db, { create: async () => ({}) } as never, retried.dispatchId);
    const retryFetch = vi.fn<typeof fetch>(async () => complete({ analysis: analysis(), critique: clearCritique }));
    expect(await runContentGeneration(bindings, { dispatchId: retried.dispatchId }, retried.jobId, { fetch: retryFetch })).toEqual({ outcome: "awaiting_intent_review" });
    expect(retryFetch).toHaveBeenCalledTimes(1);
    expect((await db.prepare("SELECT step_key FROM ai_provider_calls WHERE generation_job_id=?")
      .bind(retried.jobId).all()).results).toEqual([{ step_key: "intent_critique" }]);
    const critiqueId = `result-${retried.jobId}-intent_critique`;
    const compared = await readContentGenerationView(db, f.sermonId, false);
    expect(compared.content).toEqual(before.content);
    expect((await f.human({ family: "intent", operation: { kind: "select", analysisId: critiqueId } })).outcome).toBe("saved");
    expect((await f.human({ family: "intent", operation: { kind: "confirm", analysisId: critiqueId } })).outcome).toBe("saved");
    const resume = await requestContentResume(db, { ...f.owner, jobId: retried.jobId });
    expect(resume.outcome).toBe("saved");
    if (!("dispatchId" in resume)) throw new Error("resume");
    await sendContentDispatch(db, { get: async () => ({ sendEvent: async () => undefined }) } as never, resume.dispatchId);
    expect((await runContentGeneration(bindings, { dispatchId: resume.dispatchId }, retried.jobId, { fetch: retryFetch })).outcome).toBe("saved");
    expect(retryFetch).toHaveBeenCalledTimes(1);
    expect((await readContentGenerationView(db, f.sermonId, false)).regenerations.find(j => j.jobId === retried.jobId)?.status).toBe("review_ready");
  });
  it("retries only critique after a rejected second response and preserves the first call", async () => {
    const f = await regenerationFixture(), before = await readContentGenerationView(db, f.sermonId, false);
    const job = await requestContentRegeneration(db, f.sermonId, { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId,
      scope: "intent", expectedVersion: before.version }, actor);
    await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
    const first = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete(analysis()))
      .mockImplementationOnce(async () => complete({ invalid: "critique" }));
    expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: first })).outcome).toBe("rejected");
    expect(first).toHaveBeenCalledTimes(2);
    const failed = await readContentGenerationView(db, f.sermonId, false);
    expect(failed.content).toEqual(before.content);
    expect(failed.regenerations.find(j => j.jobId === job.jobId)).toMatchObject({ status: "failed", unknownCalls: 0 });
    const retry = await requestContentRegeneration(db, f.sermonId, { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId,
      scope: "intent", expectedVersion: failed.version, supersedesJobId: job.jobId, retryCritiqueOnly: true }, actor);
    await sendContentDispatch(db, { create: async () => ({}) } as never, retry.dispatchId);
    const second = vi.fn<typeof fetch>(async () => complete({ analysis: analysis(), critique: clearCritique }));
    expect((await runContentGeneration(bindings, { dispatchId: retry.dispatchId }, retry.jobId, { fetch: second })).outcome).toBe("awaiting_intent_review");
    expect(second).toHaveBeenCalledTimes(1);
    expect((await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=?")
      .bind(job.jobId).first<{ n: number }>())?.n).toBe(2);
  });
  it("ends a comparison while retaining the previously selected intent and releases the active slot", async () => {
    const f = await regenerationFixture(), before = await readContentGenerationView(db, f.sermonId, false);
    const oldUsage = (await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id")
      .bind(f.owner.jobId).all()).results;
    const job = await requestContentRegeneration(db, f.sermonId, { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId,
      scope: "intent", expectedVersion: before.version }, actor);
    await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
    const fetcher = responses();
    expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("awaiting_intent_review");
    const owner = { ...f.owner, jobId: job.jobId };
    expect((await discardIntentRegeneration(db, owner)).outcome).toBe("saved");
    expect((await discardIntentRegeneration(db, owner)).outcome).toBe("replayed");
    const after = await readContentGenerationView(db, f.sermonId, false);
    expect(after.content).toEqual(before.content);
    expect(after.regenerations.find(j => j.jobId === job.jobId)).toMatchObject({ status: "stale", costMicroUsd: 1048 });
    expect((await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id")
      .bind(f.owner.jobId).all()).results).toEqual(oldUsage);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await requestContentRegeneration(db, f.sermonId, { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId,
      scope: "intent", expectedVersion: after.version }, actor)).outcome).toBe("created");
  });
  it("keeps the selected intent until explicit choice, then invalidates dependent reviews and finishes without more AI calls", async () => {
    const f = await regenerationFixture(), before = await readContentGenerationView(db, f.sermonId, false);
    const priorUsage = (await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id")
      .bind(f.owner.jobId).all()).results;
    const command = { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId, scope: "intent", expectedVersion: before.version };
    const job = await requestContentRegeneration(db, f.sermonId, command, actor);
    expect((await requestContentRegeneration(db, f.sermonId, command, actor)).outcome).toBe("replayed");
    await expect(requestContentRegeneration(db, f.sermonId, { ...command, scope: "summary" }, actor)).rejects.toThrow("GENERATION_REQUEST_CONFLICT");
    await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
    const fetcher = responses();
    expect(await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).toEqual({ outcome: "awaiting_intent_review" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const compared = await readContentGenerationView(db, f.sermonId, false);
    expect(compared.content).toEqual(before.content);
    expect(compared.regenerations.find(j => j.jobId === job.jobId)).toMatchObject({ scope: "intent", status: "awaiting_intent_review", costMicroUsd: 1048 });
    expect(compared.snapshots.some(s => s.value.id === `result-${job.jobId}-intent_critique`)).toBe(true);
    await expect(requestContentRegeneration(db, f.sermonId, { ...command, requestKey: crypto.randomUUID(), scope: "summary", expectedVersion: compared.version }, actor)).rejects.toThrow();
    const critiqueId = `result-${job.jobId}-intent_critique`;
    expect((await f.human({ family: "intent", operation: { kind: "select", analysisId: critiqueId } })).outcome).toBe("saved");
    await expect(discardIntentRegeneration(db, { ...f.owner, jobId: job.jobId })).rejects.toThrow("GENERATION_DISCARD_CONFLICT");
    const selected = await readContentGenerationView(db, f.sermonId, false);
    expect(selected.content).toMatchObject({ intent: { selectedId: critiqueId, confirmation: null },
      summary: { id: before.content.state === "present" ? before.content.summary?.id : null, review: null }, child: { review: null }, adult: { review: null } });
    expect((await f.human({ family: "intent", operation: { kind: "confirm", analysisId: critiqueId } })).outcome).toBe("saved");
    const resume = await requestContentResume(db, { ...f.owner, jobId: job.jobId });
    expect(resume.outcome).toBe("saved");
    if (!("dispatchId" in resume)) throw new Error("resume");
    await sendContentDispatch(db, { get: async () => ({ sendEvent: async () => undefined }) } as never, resume.dispatchId);
    expect((await runContentGeneration(bindings, { dispatchId: resume.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("saved");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const after = await readContentGenerationView(db, f.sermonId, false);
    expect(after.regenerations.find(j => j.jobId === job.jobId)).toMatchObject({ status: "review_ready", costMicroUsd: 1048 });
    expect((await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(f.owner.jobId).all()).results).toEqual(priorUsage);
    expect(after.content).toMatchObject({ intent: { selectedId: critiqueId }, summary: { review: null }, child: { review: null }, adult: { review: null } });
  });
});

describe("individual regeneration boundaries", { timeout: 90_000 }, () => {
  it("regenerates during content review while blocking concurrent calls and finishes the original full job", async () => {
    const f = await regenerationFixture(), before = await readContentGenerationView(db, f.sermonId, false);
    const command = { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId, scope: "summary", expectedVersion: before.version };
    // The administrator endpoint keeps authentication, origin and strict request boundaries with AI disabled.
    const access = await createAccessFixture(new Date());
    const accessFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    try {
      const path = `https://example.com/api/admin/sermons/${f.sermonId}/generation/regenerate`;
      const http = (body: unknown, origin = "https://example.com", authenticated = true) => exports.default.fetch(new Request(path, {
        method: "POST", body: JSON.stringify(body), headers: { Origin: origin, "Content-Type": "application/json", ...(authenticated ? { "Cf-Access-Jwt-Assertion": access.token } : {}) } }));
      expect((await http(command, "https://example.com", false)).status).toBe(401);
      expect((await http(command, "https://foreign.invalid")).status).toBe(403);
      expect((await http({ ...command, result: {} })).status).toBe(409);
      expect((await http({ ...command, scope: "full" })).status).toBe(409);
      expect((await http({ ...command, target: { basePoolId: "pool", candidateId: "word" } })).status).toBe(409);
      expect((await http({ ...command, scope: "child", target: { basePoolId: "pool", candidateId: "word", draft: {} } })).status).toBe(409);
      const disabled = await http(command);
      expect(disabled.status).toBe(503); expect(disabled.headers.get("Cache-Control")).toBe("private, no-store");
    } finally { accessFetch.mockRestore(); }
    const partial = await requestContentRegeneration(db, f.sermonId, command, actor);
    await expect(requestContentRegeneration(db, f.sermonId, { ...command, requestKey: crypto.randomUUID(), scope: "child" }, actor)).rejects.toThrow();
    const parentRequest = await createGenerationLifecycleStore(db).readContext(`request-${f.owner.jobId}`);
    if (parentRequest.outcome !== "present" || parentRequest.value.context.kind !== "request" || parentRequest.value.context.authority.selection.state !== "present") throw new Error("request");
    await expect(requestFullGeneration(db, f.sermonId, { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId, expectedVersion: before.version,
      selection: parentRequest.value.context.authority.selection.value }, actor)).rejects.toThrow("GENERATION_LIFECYCLE_CONFLICT");
    // A pure parent transition cannot race a paid child job.
    await expect(db.prepare("UPDATE generation_jobs SET current_step='place_child' WHERE id=?").bind(f.owner.jobId).run()).rejects.toThrow();
    await sendContentDispatch(db, { create: async () => ({}) } as never, partial.dispatchId);
    const fetcher = vi.fn<typeof fetch>(async () => complete(f.summary));
    expect((await runContentGeneration(bindings, { dispatchId: partial.dispatchId }, partial.jobId, { fetch: fetcher })).outcome).toBe("saved");
    const resultId = `result-${partial.jobId}-summary`;
    await f.human({ family: "summary", operation: { kind: "select", summaryId: resultId } });
    await f.human({ family: "summary", operation: { kind: "review", summaryId: resultId } });
    expect((await finishContentGeneration(db, f.owner)).outcome).toBe("review_ready");
    const after = await readContentGenerationView(db, f.sermonId, false);
    expect(after.jobId).toBe(f.owner.jobId); expect(after.preview).not.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Page through old immutable results; no generated revision is silently hidden after six results.
    const seen = new Set(after.snapshots.map(s => s.value.id));
    let cursor = after.historyCursor;
    while (cursor) {
      const page = await readContentGenerationView(db, f.sermonId, false, cursor);
      page.snapshots.forEach(s => seen.add(s.value.id));
      if (page.historyCursor) expect(page.historyCursor).toBeLessThan(cursor);
      cursor = page.historyCursor;
    }
    expect(seen.has(`result-${f.owner.jobId}-summary`)).toBe(true);
  });
  it("keeps uncertain calls without automatic replay and accepts only explicit matching-scope replacement", async () => {
    const f = await regenerationFixture(), before = await readContentGenerationView(db, f.sermonId, false);
    const command = { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId, scope: "child", expectedVersion: before.version };
    const job = await requestContentRegeneration(db, f.sermonId, command, actor);
    await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("lost response"));
    expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("uncertain");
    expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const view = await readContentGenerationView(db, f.sermonId, false);
    expect(view.content).toEqual(before.content);
    expect(view.regenerations[0]).toMatchObject({ status: "uncertain", unknownCalls: 1, resultId: null });
    await expect(requestContentRegeneration(db, f.sermonId, { ...command, requestKey: crypto.randomUUID(), scope: "adult", supersedesJobId: job.jobId }, actor)).rejects.toThrow("GENERATION_RETRY_CONFLICT");
    const replacement = { ...command, requestKey: crypto.randomUUID(), supersedesJobId: job.jobId };
    expect((await requestContentRegeneration(db, f.sermonId, replacement, actor)).outcome).toBe("created");
    expect((await requestContentRegeneration(db, f.sermonId, replacement, actor)).outcome).toBe("replayed");
    expect(await db.prepare("SELECT count(*) n FROM ai_provider_calls WHERE generation_job_id=?").bind(job.jobId).first()).toEqual({ n: 1 });
  });
  it("preserves cost for rejected and stale partial results without replacing content", async () => {
    const f = await regenerationFixture();
    for (const mode of ["rejected", "stale"] as const) {
      const before = await readContentGenerationView(db, f.sermonId, false);
      const command = { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId, scope: "summary", expectedVersion: before.version };
      await expect(requestContentRegeneration(db, "foreign", command, actor)).rejects.toThrow();
      await expect(requestContentRegeneration(db, f.sermonId, { ...command, expectedVersion: 1 }, actor)).rejects.toThrow("GENERATION_AUTHORITY_CHANGED");
      const job = await requestContentRegeneration(db, f.sermonId, command, actor);
      await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (mode === "stale") await f.human({ family: "candidate", operation: { kind: "set_status", difficulty: "child",
          poolId: `result-${f.owner.jobId}-child_candidates`, candidateId: "word-0", status: "locked" } });
        return complete(mode === "rejected" ? { paragraphs: [{ ...f.summary.paragraphs[0]!, text: "" }] } : f.summary);
      });
      expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe(mode);
      const after = await readContentGenerationView(db, f.sermonId, false);
      expect(after.regenerations[0]).toMatchObject({ costMicroUsd: 524, unknownCalls: 0, resultId: null });
      if (after.content.state === "present" && before.content.state === "present") expect(after.content.summary).toEqual(before.content.summary);
      await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});

it("ends a partial job as stale when human content changes immediately after its result commit", async () => {
  const f = await regenerationFixture(), view = await readContentGenerationView(db, f.sermonId, false);
  const job = await requestContentRegeneration(db, f.sermonId, { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId,
    scope: "summary", expectedVersion: view.version }, actor);
  await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
  const outcomeStatements = new WeakSet<object>(); let changed = false;
  const intercepted = new Proxy(db, { get(target, property) {
    if (property === "prepare") return (query: string) => {
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
        const wrapped = new Proxy(statement, { get(stmt, key) {
          if (key === "bind") return (...values: unknown[]) => wrap(stmt.bind(...values));
          const value: unknown = Reflect.get(stmt, key);
          return typeof value === "function" ? value.bind(stmt) : value;
        } });
        if (query.includes("INSERT INTO generation_step_outcomes")) outcomeStatements.add(wrapped);
        return wrapped;
      };
      return wrap(target.prepare(query));
    };
    if (property === "batch") return async (statements: D1PreparedStatement[]) => {
      const results = await target.batch(statements);
      if (!changed && statements.some(stmt => outcomeStatements.has(stmt))) {
        changed = true;
        await f.human({ family: "summary", operation: { kind: "select", summaryId: `result-${job.jobId}-summary` } });
      }
      return results;
    };
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const fetcher = vi.fn<typeof fetch>(async () => complete(f.summary));
  expect((await runContentGeneration({ ...bindings, DB: intercepted }, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("stale");
  expect(changed).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
  const after = await readContentGenerationView(db, f.sermonId, false);
  expect(after.content).toMatchObject({ summary: { id: `result-${job.jobId}-summary`, review: null } });
  expect(after.regenerations[0]).toMatchObject({ status: "stale", resultId: `result-${job.jobId}-summary`, costMicroUsd: 524 });
  expect((await requestContentRegeneration(db, f.sermonId, { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId,
    scope: "summary", expectedVersion: after.version }, actor)).outcome).toBe("created");
}, 90_000);

describe("single answer and clue regeneration", { timeout: 90_000 }, () => {
  it.each(["child", "adult"] as const)("replaces only one %s item, preserving human content, statuses and old evidence until explicit selection", async scope => {
    const f = await regenerationFixture();
    expect((await finishContentGeneration(db, f.owner)).outcome).toBe("review_ready");
    const proof = await db.prepare("SELECT * FROM generation_final_validation_proofs WHERE job_id=?").bind(f.owner.jobId).first();
    const oldUsage = (await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(f.owner.jobId).all()).results;
    let view = await readContentGenerationView(db, f.sermonId, false);
    const original = view.snapshots.find(s => s.kind === "candidate" && s.value.difficulty === scope);
    if (original?.kind !== "candidate") throw new Error("pool");
    const draft = structuredClone(original.value.draft);
    draft.candidates[1]!.grounding = { origin: "admin_context", note: "관리자가 확인한 설명" };
    await f.human({ family: "candidate", operation: { kind: "edit", difficulty: scope, basePoolId: original.value.id,
      binding: { ...original.value.binding, transcript: { ...original.value.binding.transcript, version: view.version } }, draft } });
    for (const [candidateId, status] of [["word-0", "locked"], ["word-2", "excluded"]]) {
      view = await readContentGenerationView(db, f.sermonId, false);
      if (view.content.state !== "present") throw new Error("content");
      expect((await f.human({ family: "candidate", operation: { kind: "set_status", difficulty: scope, poolId: view.content[scope]!.id, candidateId, status } })).outcome).toBe("saved");
    }
    view = await readContentGenerationView(db, f.sermonId, false);
    if (view.content.state !== "present") throw new Error("content");
    await f.human({ family: "candidate", operation: { kind: "review", difficulty: scope, poolId: view.content[scope]!.id } });
    const before = await readContentGenerationView(db, f.sermonId, false);
    if (before.content.state !== "present") throw new Error("content");
    const base = before.snapshots.find(s => s.kind === "candidate" && before.content.state === "present" && s.value.id === before.content[scope]!.id);
    if (base?.kind !== "candidate") throw new Error("pool");
    const target = { basePoolId: base.value.id, candidateId: "word-0" };
    const command = { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId, scope, target, expectedVersion: before.version };
    const job = await requestContentRegeneration(db, f.sermonId, command, actor);
    expect((await requestContentRegeneration(db, f.sermonId, command, actor)).outcome).toBe("replayed");
    await expect(requestContentRegeneration(db, f.sermonId, { ...command, target: { ...target, candidateId: "word-1" } }, actor)).rejects.toThrow("GENERATION_REQUEST_CONFLICT");
    await expect(requestContentRegeneration(db, f.sermonId, { ...command, target: undefined }, actor)).rejects.toThrow("GENERATION_REQUEST_CONFLICT");
    await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
    const fresh = { ...base.value.draft.candidates[0]!, clue: `${scope} 새 단서`, displayAnswer: "마음", gridAnswer: "마음" };
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)), input = JSON.parse(body.input);
      expect(input.replacement.candidate).toEqual(base.value.draft.candidates[0]);
      expect(input.replacement.otherCandidates).toEqual(base.value.draft.candidates.slice(1));
      expect(body.text.format.schema.properties.draft.properties.candidates).toMatchObject({ minItems: 1, maxItems: 1 });
      expect(body.instructions).toContain("정확히 1개");
      return complete({ candidates: [fresh] });
    });
    expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("saved");
    expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("review_ready");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const after = await readContentGenerationView(db, f.sermonId, false);
    expect(after.content).toEqual(before.content);
    expect(after.regenerations.find(j => j.jobId === job.jobId)).toMatchObject({ target, costMicroUsd: 524, unknownCalls: 0 });
    expect((await readAdminAiCosts(db, f.quizSetId)).calls.find(call => call.jobId === job.jobId)).toMatchObject({ singleEntry: true, scope });
    const resultId = `result-${job.jobId}-${scope}_candidates`, result = after.snapshots.find(s => s.value.id === resultId);
    if (result?.kind !== "candidate") throw new Error("result");
    expect(result.value.replacement).toEqual(target);
    expect(result.value.draft.candidates).toEqual([fresh, ...base.value.draft.candidates.slice(1)]);
    expect(result.value.statuses).toEqual(base.value.statuses);
    expect(after.preview).toBeNull();
    expect((await f.human({ family: "candidate", operation: { kind: "select", difficulty: scope, poolId: resultId } })).outcome).toBe("saved");
    const selected = await readContentGenerationView(db, f.sermonId, false);
    expect(selected.content).toMatchObject({ [scope]: { id: resultId, review: null } });
    for (const other of ["summary", "child", "adult"] as const) if (other !== scope && selected.content.state === "present")
      expect(selected.content[other]).toEqual(before.content[other]);
    expect((await f.human({ family: "candidate", operation: { kind: "review", difficulty: scope, poolId: resultId } })).outcome).toBe("saved");
    expect(await db.prepare("SELECT * FROM generation_final_validation_proofs WHERE job_id=?").bind(f.owner.jobId).first()).toEqual(proof);
    expect((await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(f.owner.jobId).all()).results).toEqual(oldUsage);
    expect(await db.prepare("SELECT status FROM quiz_sets WHERE id=?").bind(f.quizSetId).first()).toEqual({ status: "draft" });
  });

  it("rejects missing or stale targets and malformed replacements while retaining charged usage", async () => {
    const f = await regenerationFixture();
    const before = await readContentGenerationView(db, f.sermonId, false);
    if (before.content.state !== "present") throw new Error("content");
    const target = { basePoolId: before.content.child!.id, candidateId: "word-0" };
    const command = { quizSetId: f.quizSetId, scope: "child", target, expectedVersion: before.version };
    for (const invalid of [{ ...target, candidateId: "missing" }, { ...target, basePoolId: before.content.adult!.id }])
      await expect(requestContentRegeneration(db, f.sermonId, { ...command, requestKey: crypto.randomUUID(), target: invalid }, actor)).rejects.toThrow("GENERATION_TARGET_CHANGED");
    await expect(requestContentRegeneration(db, f.sermonId, { ...command, requestKey: crypto.randomUUID(), scope: "summary" }, actor)).rejects.toThrow();
    const first = f.candidate.candidates[0]!;
    const badDrafts = [f.candidate, { candidates: [{ ...first, id: "wrong" }] },
      { candidates: [{ ...first, displayAnswer: "라마바", gridAnswer: "라마바" }] },
      { candidates: [{ ...first, grounding: { origin: "admin_context", note: "AI가 꾸민 근거" } }] },
      { candidates: [{ ...first, clue: "" }] }];
    for (const draft of badDrafts) {
      const job = await requestContentRegeneration(db, f.sermonId, { ...command, requestKey: crypto.randomUUID() }, actor);
      await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
      const fetcher = vi.fn<typeof fetch>(async () => complete(draft));
      expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("rejected");
      expect(fetcher).toHaveBeenCalledTimes(1);
      const after = await readContentGenerationView(db, f.sermonId, false);
      expect(after.content).toEqual(before.content);
      expect(after.regenerations.find(j => j.jobId === job.jobId)).toMatchObject({ costMicroUsd: 524, resultId: null });
    }
  });

  it("preserves a result for comparison but refuses to overwrite later edits when selecting it", async () => {
    const f = await regenerationFixture(), before = await readContentGenerationView(db, f.sermonId, false);
    if (before.content.state !== "present") throw new Error("content");
    const target = { basePoolId: before.content.child!.id, candidateId: "word-0" };
    const job = await requestContentRegeneration(db, f.sermonId, { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId,
      scope: "child", target, expectedVersion: before.version }, actor);
    await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
    const fetcher = vi.fn<typeof fetch>(async () => complete({ candidates: [{ ...f.candidate.candidates[0]!, clue: "새 비교 단서" }] }));
    expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe("saved");
    await f.human({ family: "candidate", operation: { kind: "set_status", difficulty: "child", poolId: target.basePoolId, candidateId: "word-1", status: "excluded" } });
    await expect(f.human({ family: "candidate", operation: { kind: "select", difficulty: "child", poolId: `result-${job.jobId}-child_candidates` } })).rejects.toThrow();
    const after = await readContentGenerationView(db, f.sermonId, false);
    const current = after.snapshots.find(s => s.kind === "candidate" && after.content.state === "present" && s.value.id === after.content.child?.id);
    expect(current?.kind === "candidate" && current.value.statuses["word-1"]).toBe("excluded");
    await expect(requestContentRegeneration(db, f.sermonId, { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId,
      scope: "child", target, expectedVersion: after.version }, actor)).rejects.toThrow("GENERATION_TARGET_CHANGED");
  });
});

it.each(["uncertain", "stale"] as const)("single-item %s response keeps the original and never retries automatically", { timeout: 90_000 }, async scenario => {
  const f = await regenerationFixture(), before = await readContentGenerationView(db, f.sermonId, false);
  if (before.content.state !== "present") throw new Error("content");
  const target = { basePoolId: before.content.child!.id, candidateId: "word-0" };
  const command = { requestKey: crypto.randomUUID(), quizSetId: f.quizSetId, scope: "child", target, expectedVersion: before.version };
  const job = await requestContentRegeneration(db, f.sermonId, command, actor);
  await sendContentDispatch(db, { create: async () => ({}) } as never, job.dispatchId);
  const fetcher = vi.fn<typeof fetch>(async () => {
    if (scenario === "uncertain") throw new Error("synthetic response loss");
    await f.human({ family: "candidate", operation: { kind: "set_status", difficulty: "child", poolId: target.basePoolId,
      candidateId: "word-1", status: "excluded" } });
    return complete({ candidates: [{ ...f.candidate.candidates[0]!, clue: "이전 자료 기준 제안" }] });
  });
  expect((await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher })).outcome).toBe(scenario);
  await runContentGeneration(bindings, { dispatchId: job.dispatchId }, job.jobId, { fetch: fetcher });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const after = await readContentGenerationView(db, f.sermonId, false);
  expect(after.regenerations.find(j => j.jobId === job.jobId)).toMatchObject({ target, resultId: null,
    costMicroUsd: scenario === "stale" ? 524 : 0, unknownCalls: scenario === "stale" ? 0 : 1 });
  if (scenario === "uncertain") {
    expect(after.content).toEqual(before.content);
    await expect(requestContentRegeneration(db, f.sermonId, { ...command,
      target: { ...target, candidateId: "word-1" } }, actor)).rejects.toThrow("GENERATION_REQUEST_CONFLICT");
    // A newly confirmed request may use the current pool after a human edit.
    await f.human({ family: "candidate", operation: { kind: "set_status", difficulty: "child", poolId: target.basePoolId,
      candidateId: "word-1", status: "excluded" } });
    const current = await readContentGenerationView(db, f.sermonId, false);
    if (current.content.state !== "present") throw new Error("content");
    const retry = await requestContentRegeneration(db, f.sermonId, { ...command, requestKey: crypto.randomUUID(),
      expectedVersion: current.version, target: { ...target, basePoolId: current.content.child!.id }, supersedesJobId: job.jobId }, actor);
    await sendContentDispatch(db, { create: async () => ({}) } as never, retry.dispatchId);
    const successful = vi.fn<typeof fetch>(async () => complete({ candidates: [{ ...f.candidate.candidates[0]!, clue: "명시적 재시도 제안" }] }));
    expect((await runContentGeneration(bindings, { dispatchId: retry.dispatchId }, retry.jobId, { fetch: successful })).outcome).toBe("saved");
    expect(successful).toHaveBeenCalledTimes(1);
  }
});

it("P5-64 connects confirmed input and generated publication to wording, submissions, deadline finalization and cleanup", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("P5-64 forbids external requests"));
  try {
    // Metadata/quiz creation is deliberately seeded: its administrator entrypoint is still missing.
    const f = await regenerationFixture();
    await db.prepare("UPDATE sermons SET slug_suffix=? WHERE id=?").bind(crypto.randomUUID().slice(0, 6), f.sermonId).run();
    expect((await finishContentGeneration(db, f.owner)).outcome).toBe("review_ready");
    const view = await readContentGenerationView(db, f.sermonId, false);
    const published = await publishReviewedQuiz(db, f.quizSetId, {
      requestKey: crypto.randomUUID(), jobId: f.owner.jobId, expectedVersion: view.version,
      expectedMetadataRevision: view.placement!.metadataRevision, expectedSelectionRevision: view.placement!.revision,
      confirmation: "publish",
    }, actor, new Date("2026-09-22T00:00:00.000Z"));
    const now = new Date("2026-09-23T00:00:00.000Z"), admin = "synthetic-admin@example.invalid";
    const secret = "a".repeat(64);
    const rows = async (sql: string, ...values: string[]) => (await db.prepare(sql).bind(...values).all()).results;
    const repository = createPublicQuizRepository(createDatabase(db));
    const submissions = createSubmissionRepository(createDatabase(db));
    const beforeQuiz = (await repository.read({ slug: published.slug }, "child", now)).quiz!;
    const originalTables = ["published_quiz_content", "quiz_solutions", "quiz_entries_public", "generation_jobs",
      "ai_usage_events", "ai_usage_observations", "ai_usage_settlements"];
    const capture = async () => Promise.all(originalTables.map(table => rows(`SELECT * FROM ${table} ORDER BY 1`)));
    const original = await capture();
    expect((await rows("SELECT * FROM ai_usage_events WHERE generation_job_id=?", f.owner.jobId))).toHaveLength(5);

    const display = await readPublishedDisplayText(db, f.quizSetId);
    await correctPublishedDisplayText(db, f.quizSetId, { requestKey: crypto.randomUUID(), expectedRevision: display.quiz.revision,
      before: display.quiz.metadata, after: { title: "P5-64 합성 통합 설교", sermonDate: "2026-09-20" }, reason: "합성 제목 정정" }, admin, now);
    for (const target of ["summary", beforeQuiz.variant.grid.entries[0]!.id]) {
      const wording = await readPublishedWording(db, f.quizSetId), text = wording.targets.find(item => item.target === target)!;
      await correctPublishedWording(db, f.quizSetId, { requestKey: crypto.randomUUID(), expectedRevision: wording.revision,
        contentRevision: wording.contentRevision, target, before: text.text, after: text.text + ".",
        assessment: "non_semantic_typo", confirmation: "meaning_and_answer_unchanged", reason: "합성 문장부호 정정" }, admin, now);
    }
    const quiz = (await repository.read({ slug: published.slug }, "child", now)).quiz!;
    expect(quiz.sermon.title).toBe("P5-64 합성 통합 설교");
    expect(quiz.sermon.summary!.text).toBe(beforeQuiz.sermon.summary!.text + ".");
    expect(quiz.variant.grid.entries[0]!.clue).toBe(beforeQuiz.variant.grid.entries[0]!.clue + ".");
    expect(quiz.variant.id).toBe(beforeQuiz.variant.id);
    expect(JSON.stringify(quiz)).not.toMatch(/entryAnswers|solutionCells|publishedByDigest|sourceSha256|가나다/u);

    const source = (await submissions.findScoringSolution(quiz.variant.id))!;
    const score = scoreSubmission({ grid: quiz.variant.grid, ...source }, source.solution.cells);
    const sessionHash = await hash(crypto.randomUUID());
    await db.prepare("INSERT INTO anonymous_sessions VALUES(?,?,?,'2027-01-01T00:00:00.000Z')")
      .bind(sessionHash, now.toISOString(), now.toISOString()).run();
    const submission = { id: crypto.randomUUID(), quizVariantId: quiz.variant.id, quizRevision: quiz.variant.revision,
      sessionHash, idempotencyKey: "01924f8e-7b2a-7f1c-8f3a-123456789abc", requestHash: await hash("synthetic submission"),
      displayName: "합성 참여자", comment: null, submittedAt: now.toISOString(), ...score };
    expect(await submissions.saveSubmission(submission, now.toISOString())).toMatchObject({ outcome: "inserted" });
    const savedSubmission = await rows("SELECT * FROM submissions WHERE id=?", submission.id);
    const deadline = async (closesAt: string) => {
      const proposal = { closesAt, reason: "합성 통합 마감 확인" };
      const preview = await previewQuizDeadline(db, f.quizSetId, proposal, admin, secret, now);
      expect(preview.impact.total).toBe(1);
      return { ...proposal, requestKey: crypto.randomUUID(), confirmationToken: preview.confirmationToken,
        confirmation: preview.immediate ? "close_now" : "change_deadline" };
    };
    await changeQuizDeadline(db, f.quizSetId, await deadline("2026-09-30T00:00:00.000Z"), admin, secret, now);
    expect((await repository.read({ slug: published.slug }, "child", now)).quiz!.closesAt).toBe("2026-09-30T00:00:00.000Z");
    const close = await deadline("2026-09-22T00:00:00.000Z");
    expect(await changeQuizDeadline(db, f.quizSetId, close, admin, secret, now)).toMatchObject({ archived: true, closesAt: now.toISOString() });
    expect((await changeQuizDeadline(db, f.quizSetId, close, admin, secret, now)).outcome).toBe("replayed");
    expect((await readQuizDeadline(db, f.quizSetId, now)).changeable).toBe(false);
    await expect(deadline("2026-10-01T00:00:00.000Z")).rejects.toThrow();
    expect(await rows("SELECT e.rank FROM leaderboard_snapshot_entries e JOIN leaderboard_snapshots s ON s.id=e.snapshot_id WHERE s.quiz_variant_id=?", quiz.variant.id)).toEqual([{ rank: 1 }]);
    expect(await rows("SELECT * FROM leaderboard_snapshots WHERE quiz_variant_id IN (SELECT id FROM quiz_variants WHERE quiz_set_id=?)", f.quizSetId)).toHaveLength(2);
    const laterSession = await hash(crypto.randomUUID());
    await db.prepare("INSERT INTO anonymous_sessions VALUES(?,?,?,'2027-01-01T00:00:00.000Z')")
      .bind(laterSession, now.toISOString(), now.toISOString()).run();
    expect(await submissions.saveSubmission({ ...submission, id: crypto.randomUUID(), sessionHash: laterSession }, now.toISOString())).toEqual({ outcome: "closed" });
    expect(await capture()).toEqual(original);
    expect(await rows("SELECT * FROM submissions WHERE id=?", submission.id)).toEqual(savedSubmission);

    const archive = await createArchiveRepository(createDatabase(db), secret).read({ q: "P5-64 합성 통합 설교", year: null, month: null, limit: 12, cursor: null });
    expect(archive.items).toEqual([expect.objectContaining({ slug: published.slug, title: "P5-64 합성 통합 설교" })]);
    const publicBeforeCleanup = await repository.read({ slug: published.slug }, "child", now);
    const ranksBeforeCleanup = await rows("SELECT * FROM leaderboard_snapshot_entries ORDER BY 1,2");
    const costBeforeCleanup = await readAdminAiCosts(db, f.quizSetId);
    expect(costBeforeCleanup.totalCalls).toBe(5);
    expect((await purgeExpiredDraft(db, f.sermonId, "2026-10-16T00:00:00.000Z")).outcome).toBe("purged");
    expect(await repository.read({ slug: published.slug }, "child", now)).toEqual(publicBeforeCleanup);
    expect(await capture()).toEqual(original);
    expect(await readAdminAiCosts(db, f.quizSetId)).toEqual(costBeforeCleanup);
    expect(await rows("SELECT * FROM submissions WHERE id=?", submission.id)).toEqual(savedSubmission);
    expect(await rows("SELECT * FROM leaderboard_snapshot_entries ORDER BY 1,2")).toEqual(ranksBeforeCleanup);
    expect(await db.prepare("PRAGMA foreign_key_check").all()).toMatchObject({ results: [] });
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
}, 90_000);


it("P5-65 registers new work through synthetic generation and protects metadata after publication and withdrawal", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no external requests"));
  try {
    const fields = { title: "새 합성 설교", sermonDate: "2026-09-20", referenceInput: "요한복음 3:16-18", confirmed: true };
    const video = crypto.randomUUID().replaceAll("-", "").slice(0, 11);
    const result = await registerSermonDraft(db, { ...fields, video }, "synthetic@example.invalid");
    const registered = await readSermonDraft(db, result.sermonId);
    const f = await regenerationFixture(registered);
    expect((await finishContentGeneration(db, f.owner)).outcome).toBe("review_ready");
    const before = await readContentGenerationView(db, f.sermonId, false);
    const oldPublish = { requestKey: crypto.randomUUID(), jobId: f.owner.jobId, expectedVersion: before.version,
      expectedMetadataRevision: before.placement!.metadataRevision, expectedSelectionRevision: before.placement!.revision, confirmation: "publish" };
    const cost = (await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(f.owner.jobId).all()).results;
    await saveSermonDraft(db, f.sermonId, { ...fields, title: "발행 전 수정 제목", expectedRevision: 1 });
    await expect(publishReviewedQuiz(db, f.quizSetId, oldPublish, actor)).rejects.toThrow();
    // Recheck and choose placement using the current metadata without any provider recall.
    const current = await readContentGenerationView(db, f.sermonId, false);
    const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
    const selection = { child: { options, index: 0 }, adult: { options, index: 0 } };
    const placement = { expectedVersion: current.version, expectedMetadataRevision: 2, expectedSelectionRevision: current.placement!.revision, selection };
    await selectContentPlacement(db, f.owner, { ...placement, requestKey: crypto.randomUUID() }, actor);
    const checked = await readContentGenerationView(db, f.sermonId, false);
    const publication = await publishReviewedQuiz(db, f.quizSetId, { ...oldPublish, requestKey: crypto.randomUUID(), expectedVersion: checked.version,
      expectedMetadataRevision: 2, expectedSelectionRevision: checked.placement!.revision }, actor);
    expect(publication.slug).toBe(registered.slugPreview);
    expect((await listSermonDrafts(db)).items.some(item => item.sermonId === f.sermonId)).toBe(false);
    expect((await registerSermonDraft(db, { ...fields, video }, "synthetic@example.invalid")).destination).toBe("published");
    await expect(saveSermonDraft(db, f.sermonId, { ...fields, expectedRevision: 2 })).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
    await withdrawPublishedQuiz(db, f.quizSetId, { requestKey: crypto.randomUUID(), reason: "합성 철회 확인", confirmation: "withdraw", expectedPublishedAt: publication.publishedAt, expectedDisplayRevision: 0 }, "synthetic@example.invalid");
    await expect(saveSermonDraft(db, f.sermonId, { ...fields, expectedRevision: 2 })).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
    expect((await db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(f.owner.jobId).all()).results).toEqual(cost);
    expect(network).not.toHaveBeenCalled();
  } finally { vi.restoreAllMocks(); }
});


it("P5-68 shows a quiz's observed and unknown calls through the Access-only cost API", async () => {
  const f = await fixture(false, true);
  expect(await readAdminAiCosts(db, f.quizSetId)).toMatchObject({ knownCostMicroUsd: 0, unknownCalls: 0, totalCalls: 0 });
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => complete(analysis()))
    .mockRejectedValueOnce(new Error("synthetic lost response"));
  expect((await execute(f, fetcher)).outcome).toBe("uncertain");
  expect(fetcher).toHaveBeenCalledTimes(2);
  const ledger = async () => Promise.all(["ai_provider_calls", "ai_usage_observations", "ai_usage_events"].map(async table =>
    (await db.prepare(`SELECT * FROM ${table} WHERE quiz_set_id=? ORDER BY 1`).bind(f.quizSetId).all()).results));
  const before = await ledger();
  const costs = await readAdminAiCosts(db, f.quizSetId);
  expect(costs).toMatchObject({ quizSetId: f.quizSetId, knownCostMicroUsd: 524, unknownCalls: 1, totalCalls: 2,
    models: [{ provider: "openai", model: "gpt-5.6-terra", knownCostMicroUsd: 524, unknownCalls: 1, totalCalls: 2 }] });
  expect(costs.calls.find(call => call.purpose === "intent_analysis")).toMatchObject({
    inputTokens: 100, cachedInputTokens: 20, reasoningTokens: 10, outputTokens: 30,
    pricingVersion: "openai-terra-2026-09-22", estimatedCostMicroUsd: 524,
  });
  expect(costs.calls.find(call => call.purpose === "intent_critique")).toMatchObject({
    pricingVersion: null, estimatedCostMicroUsd: null, inputTokens: null, outputTokens: null,
  });
  const path = `https://example.com/api/admin/quiz-sets/${f.quizSetId}/ai-costs`;
  expect((await exports.default.fetch(new Request(path))).status).toBe(401);
  const access = await createAccessFixture(new Date());
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
  try {
    const response = await exports.default.fetch(new Request(path, { headers: { "Cf-Access-Jwt-Assertion": access.token } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: costs });
  } finally { network.mockRestore(); }
  expect(await ledger()).toEqual(before);
}, 90_000);
