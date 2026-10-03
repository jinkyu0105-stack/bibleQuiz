import { z } from "zod";

import { transcriptContentSchema, type TranscriptContent } from "./transcript-input-contract";
import { validText } from "./transcript-content";
import { withinTranscriptCharacterLimit } from "./transcript-character-limit";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const sha = z.string().regex(/^[0-9a-f]{64}$/u);

/** The model supplies one corrected document, never identities, times or decisions. */
export const correctionDocumentOutputSchema = z.discriminatedUnion("format", [
  z.strictObject({ format: z.literal("plain_text"), text: z.string().max(1_048_576) }),
  z.strictObject({ format: z.literal("timed_segments"), segments: z.array(z.strictObject({
    segmentId: id, text: z.string().min(1).max(20_000),
  })).min(1).max(20_000) }),
]);
export type CorrectionDocumentOutput = z.infer<typeof correctionDocumentOutputSchema>;

export const correctionDocumentProposalSchema = z.strictObject({
  kind: z.literal("correction_document_v1"),
  sourceId: id, sourceSha256: sha, baseDocumentId: id, baseDocumentSha256: sha,
  content: transcriptContentSchema,
});

export function materializeCorrectionDocument(base: TranscriptContent, raw: unknown): TranscriptContent | null {
  const parsed = correctionDocumentOutputSchema.safeParse(raw);
  if (!parsed.success || parsed.data.format !== base.format) return null;
  let content: TranscriptContent;
  if (base.format === "plain_text" && parsed.data.format === "plain_text") {
    content = parsed.data;
  } else if (base.format === "timed_segments" && parsed.data.format === "timed_segments") {
    const correctedSegments = parsed.data.segments;
    if (base.segments.length !== correctedSegments.length ||
      base.segments.some((segment, index) => segment.segmentId !== correctedSegments[index]?.segmentId)) return null;
    content = { format: "timed_segments", segments: base.segments.map((segment, index) => ({
      ...segment, text: correctedSegments[index]!.text,
    })) };
  } else return null;
  const texts = content.format === "plain_text" ? [content.text] : content.segments.map((segment) => segment.text);
  if (texts.some((value) => !validText(value)) ||
    !withinTranscriptCharacterLimit(content.format === "plain_text" ? content.text : content.segments)) return null;
  return content;
}
