import * as domainReader from "../_shared/services/generation-domain-reader";
import { sha } from "./test/generation-domain-fixture";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { archivedRecoveryFixture } from "./test/archived-intent-recovery-fixture";
import { analysis, clearCritique, evidence } from "./test/generation-domain-fixture";
import { commitArchivedIntentRecovery } from "../_shared/services/commit-archived-intent-recovery";
import { requestFullGeneration, requestContentResume } from "../_shared/services/content-intent-generation";
import { requestContentRegeneration } from "../_shared/services/content-regeneration";
import { runContentGeneration, sendContentDispatch } from "../_shared/services/content-generation";
import { executeContentHumanCommand } from "../_shared/services/content-human-generation";
import { readContentGenerationView } from "../_shared/services/content-generation-view";
import { finishContentGeneration } from "../_shared/services/content-generation-final";
import { publishReviewedQuiz } from "../_shared/services/quiz-publication";
import { createPublicQuizRepository } from "../_shared/repositories/public-quiz-repository";
import { createDatabase } from "../_shared/db/client";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function fixture() {
  const f = await archivedRecoveryFixture();
  const restored = await commitArchivedIntentRecovery(f.db, f.pin, f.requestText, f.responseText, f.actor, new Date().toISOString());
  if (!("eventId" in restored)) throw new Error("recovery fixture");
  vi.setSystemTime(Date.now() + 1000);
  const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
  const command = { requestKey: crypto.randomUUID(), quizSetId: f.owner.quizSetId, expectedVersion: 3,
    recoveredAnalysisId: restored.eventId, selection: { child: { options, index: 0 }, adult: { options, index: 0 } } };
  return { ...f, command, restored };
}
function response(draft: unknown) {
  return Response.json({ id: "synthetic", model: "gpt-5.6-terra", status: "completed", usage: { input_tokens: 100, output_tokens: 30 },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft }) }] }] });
}

it("reuses a rejected summary without buying it again, then saves each remaining difficulty exactly once", async () => {
  const f = await fixture(), original = await f.ledger();
  const bindings = { DB: f.db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic" };
  const requested = await requestFullGeneration(f.db, f.owner.sermonId, f.command, f.actor);
  const owner = { ...f.owner, jobId: requested.jobId };
  await sendContentDispatch(f.db, { create: async () => ({}) } as never, requested.dispatchId);
  const correctedAnalysis = analysis(); correctedAnalysis.warnings[0]!.id = "warning-1";
  correctedAnalysis.uncertainties[0]!.origin = "unresolved"; correctedAnalysis.uncertainties[0]!.evidence = [];
  const critique = vi.fn<typeof fetch>(async () => response({ analysis: correctedAnalysis, critique: clearCritique }));
  expect(await runContentGeneration(bindings, { dispatchId: requested.dispatchId }, owner.jobId, { fetch: critique }))
    .toEqual({ outcome: "awaiting_intent_review" });
  for (const kind of ["select", "confirm"] as const) {
    const view = await readContentGenerationView(f.db, owner.sermonId, false);
    expect((await executeContentHumanCommand(f.db, owner, { requestKey: crypto.randomUUID(), expectedVersion: view.version,
      operation: { family: "intent", operation: { kind, analysisId: `result-${owner.jobId}-intent_critique` } } }, f.actor)).outcome).toBe("saved");
  }
  const resume = await requestContentResume(f.db, owner);
  if (!("dispatchId" in resume)) throw new Error("resume");
  await sendContentDispatch(f.db, { get: async () => ({ sendEvent: async () => undefined }) } as never, resume.dispatchId);
  const summary = { paragraphs: [{ id: "p", text: "보존할 합성 요약", intentClaimIds: ["warnings-1", "uncertainties"], evidence: [{ quote: "합성 근거" }] }] };
  let requestText = "", responseText = "";
  const actualPrepare = domainReader.prepareReadIntentResult;
  const oldValidator = vi.spyOn(domainReader, "prepareReadIntentResult").mockImplementation((basis, ...args) =>
    basis.authority.jobId === owner.jobId ? Promise.resolve({ outcome: "invalid" }) : actualPrepare(basis, ...args));
  try {
    expect(await runContentGeneration(bindings, { dispatchId: resume.dispatchId }, owner.jobId, { fetch: async (_url, init) => {
      requestText = JSON.stringify({ body: String(init?.body) });
      const reply = response(summary); responseText = JSON.stringify({ status: 200, body: await reply.clone().text() }); return reply;
    } })).toMatchObject({ outcome: "rejected" });
  } finally { oldValidator.mockRestore(); }
  const oldUsage = (await f.db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(owner.jobId).all()).results;
  const pin = { ...f.pin, sourceJobId: owner.jobId, requestSha256: await sha(requestText), responseSha256: await sha(responseText),
    instructionsSha256: await sha(JSON.parse(JSON.parse(requestText).body).instructions) };
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NO_EXTERNAL_CALLS"));
  const recovered = await commitArchivedIntentRecovery(f.db, pin, requestText, responseText, f.actor, new Date().toISOString());
  expect(recovered.outcome).toBe("saved");
  expect(await commitArchivedIntentRecovery(f.db, pin, requestText, responseText, f.actor, new Date().toISOString()))
    .toMatchObject({ outcome: "replayed", providerCalls: 0 });
  const recoveryView = await readContentGenerationView(f.db, owner.sermonId, false);
  const snapshot = recoveryView.snapshots.find(s => s.kind === "summary");
  if (snapshot?.kind !== "summary") throw new Error("summary missing");
  expect(snapshot.value.draft.paragraphs[0]).toMatchObject({ text: summary.paragraphs[0]!.text,
    intentClaimIds: ["warning-1"], evidence: [{ quote: "합성 근거" }] });
  for (const scope of ["child", "adult"] as const) {
    vi.setSystemTime(Date.now() + 1000);
    const view = await readContentGenerationView(f.db, owner.sermonId, false);
    const partial = await requestContentRegeneration(f.db, owner.sermonId,
      { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId, expectedVersion: view.version, scope }, f.actor);
    await sendContentDispatch(f.db, { create: async () => ({}) } as never, partial.dispatchId);
    const candidate = { id: `${scope}-1`, displayAnswer: "합성", gridAnswer: "합성", clue: `${scope === "child" ? "합쳐서 만든" : "여러 요소를 결합한"} 것을 뜻하는 말`, phraseDescription: "명사",
      selectionReason: "합성", sermonImportance: "합성", difficultyReason: "합성", grounding: { origin: "transcript",
        intentClaimIds: ["warning-1"], evidence: [{ quote: "합성 근거" }] } };
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(JSON.parse(String(init?.body)).text.format.name).toBe(`${scope}_candidates_v4`);
      return response({ candidates: [candidate] });
    });
    const run = () => runContentGeneration(bindings, { dispatchId: partial.dispatchId }, partial.jobId, { fetch: fetcher });
    expect(await run()).toMatchObject({ outcome: "saved" });
    await run(); expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const view = await readContentGenerationView(f.db, owner.sermonId, false);
  expect(view.snapshots.filter(s => s.kind === "candidate").map(s => s.kind === "candidate" && s.value.difficulty).sort()).toEqual(["adult", "child"]);
  expect((await f.db.prepare("SELECT * FROM ai_usage_events WHERE generation_job_id=? ORDER BY id").bind(owner.jobId).all()).results).toEqual(oldUsage);
  expect(await f.ledger()).toEqual(original);
  expect(critique).toHaveBeenCalledTimes(1); expect(network).not.toHaveBeenCalled();
}, 90_000);

it.each([null, "not_found", "ambiguous", "archived_critique"] as const)("continues through storage, review and publication with location %s, preserving original cost", async reason => {
  const f = await fixture(), original = await f.ledger();
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NO_EXTERNAL_CALLS"));
  expect((await readContentGenerationView(f.db, f.owner.sermonId, false)).recoveredAnalysisId).toBe(f.restored.eventId);
  let recoveredCritiqueId: string | null = null;
  let failedCritiqueJob: string | null = null;
  let failedCritiqueLedger: unknown = null;
  const ledger = async (jobId: string) => Promise.all(["generation_jobs", "generation_step_outcomes", "generation_step_receipts",
    "ai_provider_calls", "ai_usage_observations", "ai_usage_events", "ai_usage_settlements"].map(async table =>
    (await f.db.prepare(`SELECT * FROM ${table} WHERE ${table === "generation_jobs" ? "id" :
      ["generation_step_outcomes", "ai_usage_observations", "ai_usage_settlements"].includes(table) ? "job_id" : "generation_job_id"}=?`)
      .bind(jobId).all()).results));
  let command: typeof f.command & { recoveredCritiqueId?: string } = f.command;
  if (reason === "archived_critique") {
    const old = await requestFullGeneration(f.db, f.owner.sermonId, f.command, f.actor);
    failedCritiqueJob = old.jobId;
    await sendContentDispatch(f.db, { create: async () => ({}) } as never, old.dispatchId);
    const originalPrepare = domainReader.prepareReadIntentResult;
    const oldValidator = vi.spyOn(domainReader, "prepareReadIntentResult").mockImplementation((basis, ...args) =>
      basis.authority.jobId === old.jobId ? Promise.resolve({ outcome: "invalid" }) : originalPrepare(basis, ...args));
    let requestText = "", responseText = "";
    try {
      expect(await runContentGeneration({ DB: f.db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic" },
        { dispatchId: old.dispatchId }, old.jobId, { fetch: async (_url, init) => {
          requestText = JSON.stringify({ body: String(init?.body) });
          const reply = response({ analysis: analysis(), critique: clearCritique });
          responseText = JSON.stringify({ status: 200, body: await reply.clone().text() });
          return reply;
        } })).toMatchObject({ outcome: "rejected" });
    } finally { oldValidator.mockRestore(); }
    failedCritiqueLedger = await ledger(old.jobId);
    const pin = { ...f.pin, sourceJobId: old.jobId, requestSha256: await sha(requestText), responseSha256: await sha(responseText),
      instructionsSha256: await sha(JSON.parse(JSON.parse(requestText).body).instructions) };
    const recovered = await commitArchivedIntentRecovery(f.db, pin, requestText, responseText, f.actor, new Date().toISOString());
    expect(recovered.outcome).toBe("saved");
    if (!("eventId" in recovered)) throw new Error("critique not recovered");
    recoveredCritiqueId = recovered.eventId;
    expect(await commitArchivedIntentRecovery(f.db, pin, requestText, responseText, f.actor, new Date().toISOString()))
      .toMatchObject({ outcome: "replayed", eventId: recoveredCritiqueId, providerCalls: 0 });
    const latest = await readContentGenerationView(f.db, f.owner.sermonId, false);
    expect(latest.recoveredCritiqueId).toBe(recoveredCritiqueId);
    vi.setSystemTime(Date.now() + 1000);
    command = { ...f.command, requestKey: crypto.randomUUID(), expectedVersion: latest.version, recoveredCritiqueId };
    await expect(requestFullGeneration(f.db, f.owner.sermonId, { ...command, recoveredCritiqueId: "wrong" }, f.actor)).rejects.toThrow();
  }
  const requested = await requestFullGeneration(f.db, f.owner.sermonId, command, f.actor);
  expect(requested.outcome).toBe("created");
  expect((await requestFullGeneration(f.db, f.owner.sermonId, command, f.actor)).outcome).toBe("replayed");
  await expect(requestFullGeneration(f.db, f.owner.sermonId, { ...command, recoveredAnalysisId: undefined, recoveredCritiqueId: undefined }, f.actor))
    .rejects.toThrow("GENERATION_REQUEST_CONFLICT");
  const owner = { ...f.owner, jobId: requested.jobId };
  const bindings = { DB: f.db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic" };
  await sendContentDispatch(f.db, { create: async () => ({}) } as never, requested.dispatchId);
  const requests: string[] = [];
  const candidates = { candidates: ["가나다", "라마바", "가사라", "다아바"].map((answer, i) => ({ id: `word-${i}`,
    displayAnswer: answer, gridAnswer: answer, clue: `합성 설명 ${i}`, phraseDescription: "명사구", selectionReason: "근거",
    sermonImportance: "핵심", difficultyReason: "난도", grounding: { origin: "transcript", intentClaimIds: ["centralMessage"], evidence: [evidence()] } })) };
  const replies = [{ analysis: analysis(), critique: clearCritique },
    { paragraphs: [{ id: "p", text: "합성 요약", intentClaimIds: ["centralMessage"], evidence: [evidence()] }] },
    candidates, { candidates: candidates.candidates.map(c => ({ ...c, clue: `장년 ${c.clue}` })) }];
  if (recoveredCritiqueId) replies.shift();
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const wire = JSON.parse(String(init?.body)); requests.push(wire.text.format.name);
    if (requests.length > 4) throw new Error("UNEXPECTED_EXTRA_CALL");
    const draft = reason && reason !== "archived_critique" ? JSON.parse(JSON.stringify(replies[requests.length - 1]), (key, value) =>
      key === "quote" ? reason === "not_found" ? "합성 원문에 없는 문구" : "T" : value) : replies[requests.length - 1];
    return response(draft);
  });
  const run = (dispatchId: string) => runContentGeneration(bindings, { dispatchId }, owner.jobId, { fetch: fetcher });
  expect(await run(requested.dispatchId)).toEqual({ outcome: "awaiting_intent_review" });
  expect(await run(requested.dispatchId)).toEqual({ outcome: "awaiting_intent_review" });
  expect(fetcher).toHaveBeenCalledTimes(recoveredCritiqueId ? 0 : 1);
  expect((await readContentGenerationView(f.db, f.owner.sermonId, false)).recoveredAnalysisId).toBeNull();
  const human = async (operation: unknown) => {
    const view = await readContentGenerationView(f.db, owner.sermonId, false);
    return executeContentHumanCommand(f.db, owner, { requestKey: crypto.randomUUID(), expectedVersion: view.version, operation }, f.actor);
  };
  const critiqueId = recoveredCritiqueId ?? `result-${owner.jobId}-intent_critique`;
  expect((await human({ family: "intent", operation: { kind: "select", analysisId: critiqueId } })).outcome).toBe("saved");
  expect((await human({ family: "intent", operation: { kind: "confirm", analysisId: critiqueId } })).outcome).toBe("saved");
  const resume = await requestContentResume(f.db, owner);
  if (!("dispatchId" in resume)) throw new Error("resume");
  await sendContentDispatch(f.db, { get: async () => ({ sendEvent: async () => undefined }) } as never, resume.dispatchId);
  expect(await run(resume.dispatchId)).toEqual({ outcome: "awaiting_content_review" });
  expect(await run(resume.dispatchId)).toEqual({ outcome: "awaiting_content_review" });
  expect(fetcher).toHaveBeenCalledTimes(recoveredCritiqueId ? 3 : 4);
  expect(requests).toEqual([...(recoveredCritiqueId ? [] : [expect.stringContaining("intent_critique")]), expect.stringContaining("summary"),
    expect.stringContaining("child_candidates"), expect.stringContaining("adult_candidates")]);
  for (const scope of ["summary", "child", "adult"] as const) {
    expect((await human(scope === "summary" ? { family: "summary", operation: { kind: "review", summaryId: `result-${owner.jobId}-summary` } }
      : { family: "candidate", operation: { kind: "review", difficulty: scope, poolId: `result-${owner.jobId}-${scope}_candidates` } })).outcome).toBe("saved");
  }
  expect(await finishContentGeneration(f.db, owner)).toMatchObject({ outcome: "review_ready" });
  const view = await readContentGenerationView(f.db, owner.sermonId, false);
  expect(view.preview).not.toBeNull();
  if (reason && reason !== "archived_critique") {
    const stored = view.snapshots.find(s => s.kind === "intent" && s.value.id === critiqueId);
    if (stored?.kind !== "intent") throw new Error("missing saved critique");
    expect(stored.value.analysis.centralMessage[0]!.evidence[0]).toMatchObject({ locationStatus: "unverified", reason, from: null, to: null });
  }
  await f.db.prepare("UPDATE sermons SET slug_suffix=? WHERE id=?").bind(crypto.randomUUID().slice(0, 6), owner.sermonId).run();
  const published = await publishReviewedQuiz(f.db, owner.quizSetId, { requestKey: crypto.randomUUID(), jobId: owner.jobId,
    expectedVersion: view.version, expectedMetadataRevision: view.placement!.metadataRevision,
    expectedSelectionRevision: view.placement!.revision, confirmation: "publish" }, f.actor);
  const publicQuiz = await createPublicQuizRepository(createDatabase(f.db)).read({ slug: published.slug }, "child", new Date());
  expect(publicQuiz.quiz).not.toBeNull();
  expect(JSON.stringify(publicQuiz)).not.toMatch(/locationStatus|합성 원문에 없는 문구|TEST_ONLY_DOMAIN_PRIVATE/u);
  expect(await f.ledger()).toEqual(original);
  expect(await f.db.prepare("SELECT task FROM ai_provider_calls WHERE generation_job_id=? ORDER BY rowid").bind(owner.jobId).all())
    .toMatchObject({ results: [...(recoveredCritiqueId ? [] : [{ task: "intent_critique" }]), { task: "summary" }, { task: "child_candidates" }, { task: "adult_candidates" }] });
  if (failedCritiqueJob) expect(await ledger(failedCritiqueJob)).toEqual(failedCritiqueLedger);
  expect(await f.db.prepare("PRAGMA foreign_key_check").all()).toMatchObject({ results: [] });
  expect(network).not.toHaveBeenCalled();
}, 90_000);

it("does not reuse the analysis after replacing and confirming the transcript", async () => {
  const f = await fixture(), original = await f.ledger();
  const store = createSermonInputStore(f.db), service = createSermonInputService(store);
  const actor = { adminId: f.actor, kind: "human" as const, now: new Date().toISOString() };
  const old = (await store.head(f.owner.sermonId))!;
  await service.execute(f.owner.sermonId, { action: "edit", expectedVersion: old.version, sourceId: old.source_id,
    documentId: old.document_id, documentSha256: old.document_sha256, content: { format: "plain_text", text: "변경한 합성 설교 본문" } }, actor);
  const edited = (await store.head(f.owner.sermonId))!;
  await service.execute(f.owner.sermonId, { action: "confirm", expectedVersion: edited.version, sourceId: edited.source_id,
    documentId: edited.document_id, documentSha256: edited.document_sha256, reviewed: true }, actor);
  const view = await readContentGenerationView(f.db, f.owner.sermonId, false);
  expect(view.recoveredAnalysisId).toBeNull();
  await expect(requestFullGeneration(f.db, f.owner.sermonId, { ...f.command, expectedVersion: view.version }, f.actor))
    .rejects.toThrow("GENERATION_RECOVERY_CONFLICT");
  expect(await f.ledger()).toEqual(original);
}, 90_000);

it("stops after an uncertain critique without buying analysis or retrying the paid call", async () => {
  const f = await fixture(), original = await f.ledger();
  const requested = await requestFullGeneration(f.db, f.owner.sermonId, f.command, f.actor);
  await sendContentDispatch(f.db, { create: async () => ({}) } as never, requested.dispatchId);
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    expect(JSON.parse(String(init?.body)).text.format.name).toContain("intent_critique");
    throw new TypeError("synthetic connection lost");
  });
  const run = () => runContentGeneration({ DB: f.db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic" },
    { dispatchId: requested.dispatchId }, requested.jobId, { fetch: fetcher });
  expect(await run()).toMatchObject({ outcome: "uncertain" });
  expect(await run()).toMatchObject({ outcome: "uncertain" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await f.ledger()).toEqual(original);
  expect(await f.db.prepare("SELECT task FROM ai_provider_calls WHERE generation_job_id=?").bind(requested.jobId).all())
    .toMatchObject({ results: [{ task: "intent_critique" }] });
}, 90_000);

it("refuses unverified recovery, changed metadata, wrong ownership and mismatched replay before dispatch or calls", async () => {
  const f = await fixture(), original = await f.ledger();
  for (const patch of [{ recoveredAnalysisId: "not-recovered" }, { quizSetId: "wrong-quiz" },
    { expectedVersion: 2 }, { supersedesJobId: f.owner.jobId }]) {
    await expect(requestFullGeneration(f.db, f.owner.sermonId, { ...f.command, ...patch }, f.actor)).rejects.toThrow();
  }
  await expect(requestFullGeneration(f.db, "wrong-sermon", f.command, f.actor)).rejects.toThrow();
  await f.db.prepare("UPDATE sermon_metadata_drafts SET metadata_revision=metadata_revision+1 WHERE sermon_id=?").bind(f.owner.sermonId).run();
  await expect(requestFullGeneration(f.db, f.owner.sermonId, f.command, f.actor)).rejects.toThrow("GENERATION_RECOVERY_CONFLICT");
  expect(await f.db.prepare("SELECT count(*) n FROM generation_jobs WHERE id=?").bind(f.command.requestKey).first()).toEqual({ n: 0 });
  expect(await f.ledger()).toEqual(original);
}, 90_000);

it("rechecks recovery authority in the SQL transaction when metadata changes after the application read", async () => {
  const f = await fixture(); let raced = false;
  const writes = new WeakSet<D1PreparedStatement>();
  const db = { prepare: (query: string) => {
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
      const wrapped = new Proxy(statement, { get(target, key) {
        if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values));
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      if (query.startsWith("INSERT INTO generation_jobs")) writes.add(wrapped);
      return wrapped;
    };
    return wrap(f.db.prepare(query));
  }, batch: async (statements: D1PreparedStatement[]) => {
    // Read coalescing also uses batch. Race the actual write transaction after
    // application validation, keeping this test's original boundary intact.
    if (statements.some(statement => writes.has(statement))) {
      raced = true;
      await f.db.prepare("UPDATE sermon_metadata_drafts SET metadata_revision=metadata_revision+1 WHERE sermon_id=?").bind(f.owner.sermonId).run();
    }
    return f.db.batch(statements);
  } } as D1Database;
  await expect(requestFullGeneration(db, f.owner.sermonId, f.command, f.actor)).rejects.toThrow("GENERATION_LIFECYCLE_CONFLICT");
  expect(raced).toBe(true);
  expect(await f.db.prepare("SELECT count(*) n FROM generation_jobs WHERE id=?").bind(f.command.requestKey).first()).toEqual({ n: 0 });
}, 90_000);
