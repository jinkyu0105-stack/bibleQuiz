import { describe, expect, it } from "vitest";
import { locateGeneratedEvidence } from "../_shared/services/ai-evidence-location";
import { intentFields } from "../_shared/services/sermon-intent-contract";
import { diagnoseIntentEvidence } from "../_shared/services/sermon-intent";
import { aiDraftTaskSchemas } from "../_shared/services/ai-draft-provider-contract";

const quote = "합성 근거";
const draft = (e: unknown) => ({ ...Object.fromEntries(intentFields.map(f => [f, []])),
  centralMessage: [{ id: "c", text: "합성 분석", origin: "transcript", evidence: [e] }] });
const plain = (text: string) => ({ format: "plain_text" as const, text });
const timed = { format: "timed_segments" as const, segments: [
  { segmentId: "first", start: 0.359, duration: 1.231, text: "다른 구간" },
  { segmentId: "second", start: 2.5, duration: 2, text: "😀\r\n" + quote + ", 끝" },
] };
const parse = (source: Parameters<typeof locateGeneratedEvidence>[1], e: unknown) =>
  aiDraftTaskSchemas.intent_analysis.output.parse(locateGeneratedEvidence("intent_analysis", source, draft(e)));

describe("whole-input evidence location", () => {
  it.each([{}, { segmentId: "first", start: 0.359, duration: 1.231 },
    { segmentId: "missing", start: -1, duration: "wrong", from: 900, to: 1 }])("derives segment, time and UTF-16 offsets regardless of AI coordinates %j", old => {
    const input = { quote, ...old }, before = structuredClone(input);
    const result = parse(timed, input);
    expect(result.centralMessage[0]!.evidence[0]).toEqual({ quote, segmentId: "second", start: 2.5, duration: 2, from: 4, to: 9 });
    expect(diagnoseIntentEvidence(timed, result)).toBeNull();
    expect(input).toEqual(before);
  });
  it.each([quote + " / " + quote, "가가가"])("marks multiple and overlapping matches without trusting a legacy offset (%s)", text => {
    const q = text === "가가가" ? "가가" : quote;
    const result = parse(plain(text), { quote: q, from: 0, to: 2 });
    expect(result.centralMessage[0]!.evidence[0]).toEqual({ quote: q, locationStatus: "unverified", reason: "ambiguous",
      segmentId: null, start: null, duration: null, from: null, to: null });
    expect(diagnoseIntentEvidence(plain(text), result)).toBeNull();
  });
  it("marks duplicate matches across segments instead of choosing the AI-labelled segment", () => {
    const source = { ...timed, segments: timed.segments.map(s => ({ ...s, text: quote })) };
    expect(parse(source, { quote, segmentId: "second", start: 2.5, duration: 2 }).centralMessage[0]!.evidence[0])
      .toMatchObject({ locationStatus: "unverified", reason: "ambiguous", segmentId: null });
  });
  it.each(["합성  근거", "합성근거", "합성 근거.", "가"])("preserves an unmatched quote and flags it without normalization (%s)", text => {
    const source = plain(quote + " 가"), result = parse(source, { quote: text });
    expect(result.centralMessage[0]!.evidence[0]).toMatchObject({ quote: text, locationStatus: "unverified", reason: "not_found", from: null, to: null });
    expect(diagnoseIntentEvidence(source, result)).toBeNull();
  });
  it("does not join captions or invent a location spanning separate segments", () => {
    expect(parse(timed, { quote: "다른 구간😀\r\n" + quote }).centralMessage[0]!.evidence[0])
      .toMatchObject({ locationStatus: "unverified", reason: "not_found" });
  });
  it("keeps malformed output rejection and does not let the AI declare its own location status", () => {
    for (const value of [{ quote: "" }, { quote: "\ud800" }, { quote, locationStatus: "verified" }, { quote, arbitrary: true }])
      expect(() => parse(timed, value)).toThrow();
  });
  it("keeps duplicate verified evidence rejection", () => {
    const input = draft({ quote }); input.centralMessage[0]!.evidence.push({ quote });
    const source = plain(quote);
    const result = aiDraftTaskSchemas.intent_analysis.output.parse(locateGeneratedEvidence("intent_analysis", source, input));
    expect(diagnoseIntentEvidence(source, result)?.code).toBe("duplicate_evidence");
  });
  it("validates stored and human-selected locations without relocating historical records", () => {
    const invalid = aiDraftTaskSchemas.intent_analysis.output.parse(draft({ quote, segmentId: null, start: null, duration: null, from: 0, to: 99 }));
    expect(diagnoseIntentEvidence(plain(quote), invalid)?.code).toBe("evidence_range");
    const historical = aiDraftTaskSchemas.intent_analysis.output.parse(draft({ quote, segmentId: "second", start: 2.5, duration: 2, from: 4, to: 9 }));
    expect(diagnoseIntentEvidence(timed, historical)).toBeNull();
    const forged = aiDraftTaskSchemas.intent_analysis.output.parse(draft({ quote, locationStatus: "unverified", reason: "not_found",
      segmentId: null, start: null, duration: null, from: null, to: null }));
    expect(diagnoseIntentEvidence(timed, forged)?.code).toBe("unverified_location");
  });
});
