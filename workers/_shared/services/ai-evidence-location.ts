import { z } from "zod";
import type { AiDraftTask } from "./ai-draft-provider-contract";
import { intentEvidenceSchema, intentFields, type IntentEvidence } from "./sermon-intent-contract";
import type { DeepReadonly, TranscriptContent } from "./transcript-revision-contract";

// New responses contain only a quote. Accept old wire coordinates for archive
// replay, but never use them to select a source or break a tie.
const generatedEvidence = z.strictObject({
  quote: intentEvidenceSchema.options[0].shape.quote,
  segmentId: z.unknown().optional(), start: z.unknown().optional(), duration: z.unknown().optional(),
  from: z.unknown().optional(), to: z.unknown().optional(),
});

/** Exact search across the fixed input; never alter a quote or guess a match. */
export function locateEvidenceQuote(transcript: DeepReadonly<TranscriptContent>, quote: string): IntentEvidence {
  const sources = transcript.format === "plain_text"
    ? [{ segmentId: null, start: null, duration: null, text: transcript.text }]
    : transcript.segments;
  let match: IntentEvidence | null = null;
  for (const source of sources) {
    const from = source.text.indexOf(quote);
    if (from < 0) continue;
    if (match || source.text.indexOf(quote, from + 1) !== -1)
      return { quote, locationStatus: "unverified", reason: "ambiguous",
        segmentId: null, start: null, duration: null, from: null, to: null };
    match = { quote, segmentId: source.segmentId, start: source.start, duration: source.duration,
      from, to: from + quote.length };
  }
  return match ?? { quote, locationStatus: "unverified", reason: "not_found",
    segmentId: null, start: null, duration: null, from: null, to: null };
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** New generated content only. Stored revisions and human edits never pass here. */
export function locateGeneratedEvidence(task: AiDraftTask, transcript: DeepReadonly<TranscriptContent>, content: unknown): unknown {
  if (task === "correction" || task === "final_audit") return content;
  const locate = (raw: unknown) => {
    const evidence = generatedEvidence.parse(raw);
    return locateEvidenceQuote(transcript, evidence.quote);
  };
  const withEvidence = (value: unknown): unknown => object(value) && Array.isArray(value.evidence)
    ? { ...value, evidence: value.evidence.map(locate) } : value;
  const analysis = (value: unknown): unknown => object(value)
    ? Object.fromEntries(Object.entries(value).map(([key, claims]) => [key,
      (intentFields as readonly string[]).includes(key) && Array.isArray(claims) ? claims.map(withEvidence) : claims])) : value;
  if (task === "intent_analysis") return analysis(content);
  if (!object(content)) return content;
  if (task === "intent_critique") return { ...content, analysis: analysis(content.analysis) };
  if (task === "summary") return { ...content, paragraphs: Array.isArray(content.paragraphs) ? content.paragraphs.map(withEvidence) : content.paragraphs };
  return { ...content, candidates: Array.isArray(content.candidates) ? content.candidates.map(candidate =>
    object(candidate) ? { ...candidate, grounding: withEvidence(candidate.grounding) } : candidate) : content.candidates };
}
