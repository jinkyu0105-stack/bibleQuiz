import { afterEach, describe, expect, it, vi } from "vitest";
import { createBibleReference } from "../../shared/bible-reference";
import { aiDraftRequestSchema, aiDraftTaskSchema, type AiDraftTask } from "../_shared/services/ai-draft-provider-contract";
import { aiDraftDiagnosticForCopy, createAiDraftProvider, type AiDraftTransport } from "../_shared/services/ai-draft-provider";
import { intentAnalysisSchema, intentFields } from "../_shared/services/sermon-intent-contract";

const privateText = "TEST_ONLY_PRIVATE_AI_DRAFT_CANARY 합성 근거\r\n😀";
const transcript = { format: "plain_text", text: privateText };
const binding = { sourceId: "source", sourceRevision: 1, sourceSha256: "a".repeat(64), revisionId: "revision",
  transcriptSha256: "b".repeat(64), checksumFormat: "sha256:utf8-working-text:v1", confirmationId: "confirmation", version: 7 };
const confirmed = { transcript: binding, analysisId: "analysis", intentConfirmationId: "intent-confirmation" };
const evidence = { segmentId: null, start: null, duration: null, from: 0, to: privateText.length, quote: privateText };
const analysis = intentAnalysisSchema.parse(Object.fromEntries(intentFields.map((field) => [field,
  [{ id: field, text: `TEST_ONLY_${field}`, origin: "transcript", evidence: [evidence] }],
])));
const clear = { assessment: "clear", concerns: [] };
const summary = { paragraphs: [{ id: "paragraph", text: "TEST_ONLY_SUMMARY", intentClaimIds: ["centralMessage"], evidence: [evidence] }] };
const candidate = { id: "candidate", displayAnswer: "가나다", gridAnswer: "가나다", clue: "TEST_ONLY_CLUE",
  phraseDescription: "TEST_ONLY_PHRASE", selectionReason: "TEST_ONLY_REASON", sermonImportance: "TEST_ONLY_IMPORTANCE",
  difficultyReason: "TEST_ONLY_DIFFICULTY", grounding: { origin: "transcript", intentClaimIds: ["centralMessage"], evidence: [evidence] } };
const correction = { format: "plain_text", text: privateText.replace("TEST", "TESTS") };
const outputs = {
  correction, intent_analysis: analysis,
  intent_critique: { analysis, critique: { exaggeratedIntent: clear, unsupportedConclusion: clear, illustrationAsMainClaim: clear, reversedMeaning: clear } },
  summary, child_candidates: { candidates: [candidate] }, adult_candidates: { candidates: [candidate] },
  final_audit: { contractVersion: 1, warnings: [] },
};
function auditFixture() {
  const reference = createBibleReference({ bookId: "JHN", chapter: 3, verseStart: 1, verseEnd: 3 });
  if (!reference.ok) throw new Error("fixture reference");
  const placement = (difficulty: "child" | "adult") => ({ index: 0, ticket: { sermonId: "sermon", difficulty,
    expectedVersion: 7, poolId: `${difficulty}-pool`, reviewId: `${difficulty}-review`, binding: confirmed,
    options: { gridSizes: [5], targetWordCounts: [1], seed: "synthetic", maxTrials: 1, searchBudgetPerTrial: 100 } } });
  const variant = (difficulty: "child" | "adult") => ({ difficulty, candidates: [{ entryId: "entry", candidate }] });
  return { task: "final_audit", context: { sermonId: "sermon", expectedVersion: 7, binding: confirmed,
    metadata: { contractVersion: 1, sermonId: "sermon", metadataRevision: 1, title: "TEST_ONLY_TITLE", sermonDate: "2026-09-09", bibleReference: reference.value },
    summary: { summaryId: "summary", reviewId: "review", binding: confirmed }, placements: { child: placement("child"), adult: placement("adult") } },
  input: { contractVersion: 1, sermonId: "sermon", transcript,
    metadata: { title: "TEST_ONLY_TITLE", date: "2026-09-09", bibleReferenceLabel: reference.value.canonicalLabel,
      translation: "개역개정", bibleReadingUrl: reference.value.readingPortalUrl },
    intent: { analysisId: "analysis", confirmationId: "intent-confirmation", analysis },
    summary: { summaryId: "summary", reviewId: "review", draft: summary }, variants: { child: variant("child"), adult: variant("adult") } } };
}
function request(task: AiDraftTask) {
  if (task === "final_audit") return aiDraftRequestSchema.parse(auditFixture());
  if (task === "correction") return aiDraftRequestSchema.parse({ task, context: { sermonId: "sermon", expectedVersion: 7,
    sourceId: binding.sourceId, sourceSha256: binding.sourceSha256, baseRevisionId: binding.revisionId,
    baseTranscriptSha256: binding.transcriptSha256 }, input: { transcript } });
  if (task === "intent_analysis") return aiDraftRequestSchema.parse({ task, context: { sermonId: "sermon", binding }, input: { transcript } });
  if (task === "intent_critique") return aiDraftRequestSchema.parse({ task, context: { sermonId: "sermon", binding, baseAnalysisId: "analysis" }, input: { transcript, analysis } });
  return aiDraftRequestSchema.parse({ task, context: { sermonId: "sermon", binding: confirmed }, input: { transcript, intent: analysis } });
}
function completed(task: AiDraftTask, value: unknown, json = false) {
  return { outcome: "completed", task, output: json ? { format: "json", text: JSON.stringify(value) } : { format: "structured", value } };
}
async function generate(task: AiDraftTask, response: unknown) {
  return createAiDraftProvider({ complete: async () => response }, { timeoutMs: 1000 }).generate(request(task));
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("P5-16 provider-neutral structured boundary, synthetic only", () => {
  it("accepts unchanged document text and rejects legacy item reports for new corrections", async () => {
    expect(await generate("correction", completed("correction", { format: "plain_text", text: privateText })))
      .toMatchObject({ outcome: "structured_output", result: { content: { text: privateText } } });
    expect(await generate("correction", completed("correction", { items: [{ reason: "fabricated" }] })))
      .toEqual({ outcome: "failed", code: "AI_DRAFT_OUTPUT_INVALID" });
  });
  it.each(aiDraftTaskSchema.options)("dispatches %s JSON and structured content without leaking server context", async (task) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const json of [false, true]) {
      const input = request(task), before = structuredClone(input);
      const complete = vi.fn<AiDraftTransport["complete"]>(async (wire) => {
        expect(Object.keys(wire).sort()).toEqual(["input", "task"]);
        expect(wire).toEqual({ task, input: input.input });
        expect(JSON.stringify(wire)).not.toContain(binding.sourceSha256);
        expect(JSON.stringify(wire)).not.toContain("metadataRevision");
        expect(Object.isFrozen(wire.input)).toBe(true);
        return completed(task, outputs[task], json);
      });
      const result = await createAiDraftProvider({ complete }, { timeoutMs: 1000 }).generate(input);
      expect(result).toEqual({ outcome: "structured_output", validation: "requires_domain_validation",
        result: { task, context: before.context, content: outputs[task] } });
      expect(aiDraftDiagnosticForCopy(result)).toEqual({ outcome: "structured_output" });
      expect(complete).toHaveBeenCalledTimes(1);
      expect(input).toEqual(before);
      if (result.outcome === "structured_output") expect(Object.isFrozen(result.result.context)).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(aiDraftTaskSchema.options)("rejects extra top-level and nested generated fields for %s", async (task) => {
    for (const field of ["binding", "task", "difficulty", "adminId", "model", "cost", "bibleText", "approved", "blocking"]) {
      expect(await generate(task, completed(task, { ...outputs[task], [field]: privateText })))
        .toEqual({ outcome: "failed", code: "AI_DRAFT_OUTPUT_INVALID" });
    }
  });

  it.each(["correction", "intent_analysis", "intent_critique", "summary", "child_candidates", "adult_candidates"] as const)("rejects wrong content shape for %s", async (task) => {
    expect(await generate(task, completed(task, outputs.final_audit))).toEqual({ outcome: "failed", code: "AI_DRAFT_OUTPUT_INVALID" });
  });

  it.each(aiDraftTaskSchema.options)("rejects invalid inputs before invoking %s", async (task) => {
    const complete = vi.fn<AiDraftTransport["complete"]>();
    const provider = createAiDraftProvider({ complete }, { timeoutMs: 1000 });
    const valid = request(task);
    for (const invalid of [{ ...valid, extra: privateText }, { ...valid, context: { ...valid.context, adminId: privateText } },
      { ...valid, input: { ...valid.input, secret: privateText } }, { ...valid, task: "unknown" }]) {
      expect(await provider.generate(invalid)).toEqual({ outcome: "failed", code: "AI_DRAFT_INPUT_INVALID" });
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it("separates human edits from AI analysis and candidate output", async () => {
    const humanAnalysis = structuredClone(analysis);
    humanAnalysis.purpose[0] = { id: "purpose", text: privateText, origin: "admin_context", evidence: [] };
    expect(await generate("intent_analysis", completed("intent_analysis", humanAnalysis))).toMatchObject({ code: "AI_DRAFT_OUTPUT_INVALID" });
    const humanCandidate = { ...candidate, grounding: { origin: "admin_context", note: privateText } };
    expect(await generate("child_candidates", completed("child_candidates", { candidates: [humanCandidate] }))).toMatchObject({ code: "AI_DRAFT_OUTPUT_INVALID" });
    // Confirmed human context remains legitimate INPUT to summary/candidate work.
    const input = request("summary");
    if (input.task !== "summary") throw new Error("fixture task");
    input.input.intent = humanAnalysis;
    expect(await createAiDraftProvider({ complete: async () => completed("summary", summary) }, { timeoutMs: 1000 }).generate(input))
      .toMatchObject({ outcome: "structured_output" });
  });

  it.each(["{", "```json\n{}\n```", "{} trailing"])("rejects invalid JSON without repair or private diagnostics: %s", async (text) => {
    expect(await generate("summary", { outcome: "completed", task: "summary", output: { format: "json", text: text + privateText } }))
      .toEqual({ outcome: "failed", code: "AI_DRAFT_JSON_INVALID" });
  });
  it.each([null, [], "content", 1, {}, { paragraphs: [] }])("rejects structurally invalid parsed content %j", async (value) => {
    expect(await generate("summary", completed("summary", value, true))).toEqual({ outcome: "failed", code: "AI_DRAFT_OUTPUT_INVALID" });
  });
  it("rejects mismatched tasks, including structurally identical child/adult outputs", async () => {
    expect(await generate("child_candidates", completed("adult_candidates", outputs.adult_candidates)))
      .toEqual({ outcome: "failed", code: "AI_DRAFT_TASK_MISMATCH" });
    expect(await generate("final_audit", completed("final_audit", summary))).toMatchObject({ code: "AI_DRAFT_OUTPUT_INVALID" });
  });
  it.each([null, { outcome: "refused", text: privateText }, { ...completed("summary", summary), raw: privateText },
    { outcome: "failed", reason: "timeout", error: privateText }, { outcome: "completed", task: "summary", output: { format: "structured" } }])("closes malformed transport envelopes", async (response) => {
    expect(await generate("summary", response)).toEqual({ outcome: "failed", code: "AI_DRAFT_COMPLETION_INVALID" });
  });
  it.each([ ["timeout", "AI_DRAFT_TIMEOUT"], ["transport", "AI_DRAFT_TRANSPORT_FAILED"],
    ["refused", "AI_DRAFT_REFUSED"], ["incomplete", "AI_DRAFT_INCOMPLETE"] ])("classifies %s without accepting partial output", async (reason, code) => {
    expect(await generate("summary", { outcome: "failed", reason })).toEqual({ outcome: "failed", code });
  });
  it("sanitizes thrown errors and does not retry", async () => {
    const complete = vi.fn(() => { throw new Error(privateText, { cause: { secret: privateText } }); });
    const result = await createAiDraftProvider({ complete }, { timeoutMs: 1000 }).generate(request("summary"));
    expect(result).toEqual({ outcome: "failed", code: "AI_DRAFT_TRANSPORT_FAILED" });
    expect(aiDraftDiagnosticForCopy(result)).toEqual(result);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("times out, aborts, and ignores late completion without leaving a timer", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    let signal!: AbortSignal;
    const provider = createAiDraftProvider({ complete: (_input, abort) => {
      signal = abort; return new Promise((resolve) => { finish = resolve; });
    } }, { timeoutMs: 25 });
    const pending = provider.generate(request("summary"));
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toEqual({ outcome: "failed", code: "AI_DRAFT_TIMEOUT" });
    expect(signal.aborted).toBe(true);
    finish(completed("summary", summary));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("isolates concurrent calls and captures context before caller mutation", async () => {
    const pending: { task: AiDraftTask; resolve: (value: unknown) => void }[] = [];
    const provider = createAiDraftProvider({ complete: (wire) => new Promise((resolve) => { pending.push({ task: wire.task, resolve }); }) }, { timeoutMs: 1000 });
    const child = request("child_candidates"), adult = request("adult_candidates");
    const before = structuredClone(child.context);
    const childResult = provider.generate(child), adultResult = provider.generate(adult);
    if (child.task !== "child_candidates") throw new Error("fixture task");
    child.context.binding.transcript.version++;
    child.input.transcript = { format: "plain_text", text: "CHANGED" };
    await Promise.resolve();
    pending[1]!.resolve(completed("adult_candidates", outputs.adult_candidates));
    pending[0]!.resolve(completed("child_candidates", outputs.child_candidates));
    expect(await childResult).toMatchObject({ result: { task: "child_candidates", context: before } });
    expect(await adultResult).toMatchObject({ result: { task: "adult_candidates", context: adult.context } });
  });
  it.each([{}, { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 1, model: "forbidden" }])("requires an explicit valid timeout without hidden model policy", async (options) => {
    const complete = vi.fn<AiDraftTransport["complete"]>();
    expect(await createAiDraftProvider({ complete }, options).generate(request("summary"))).toMatchObject({ code: "AI_DRAFT_INPUT_INVALID" });
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("program-computed generated evidence positions", () => {
  const withoutOffsets = (value: unknown) => JSON.parse(JSON.stringify(value, (key, item) => key === "from" || key === "to" ? undefined : item));
  it.each(["intent_analysis", "intent_critique", "summary", "child_candidates", "adult_candidates"] as const)("computes %s positions from quotes without changing content or binding", async task => {
    const value = withoutOffsets(outputs[task]), before = structuredClone(value);
    expect(await generate(task, completed(task, value))).toEqual({ outcome: "structured_output", validation: "requires_domain_validation",
      result: { task, context: request(task).context, content: outputs[task] } });
    expect(value).toEqual(before);
  });
  it("recomputes old response offsets instead of trusting a syntactically valid guess", async () => {
    const value = structuredClone(analysis);
    value.centralMessage[0]!.evidence[0]!.from = 900;
    value.centralMessage[0]!.evidence[0]!.to = 1;
    expect(await generate("intent_analysis", completed("intent_analysis", value)))
      .toMatchObject({ outcome: "structured_output", result: { content: analysis } });
    expect(value.centralMessage[0]!.evidence[0]!.from).toBe(900);
  });
  it("preserves missing evidence as unverified without a provider failure", async () => {
    const value = structuredClone(analysis); value.centralMessage[0]!.evidence[0]!.quote = "PRIVATE_NOT_IN_SOURCE";
    const result = await generate("intent_analysis", completed("intent_analysis", value));
    expect(result).toMatchObject({ outcome: "structured_output", result: { content: { centralMessage: [
      { evidence: [{ quote: "PRIVATE_NOT_IN_SOURCE", locationStatus: "unverified", reason: "not_found", from: null, to: null }] },
    ] } } });
    expect(JSON.stringify(aiDraftDiagnosticForCopy(result))).not.toContain("PRIVATE_NOT_IN_SOURCE");
  });
});
