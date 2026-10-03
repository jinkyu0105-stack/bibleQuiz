import { manualTranscriptMaxBytes, verifyManualTranscriptSource } from "./manual-transcript-source";
import { transcriptContentSchema, type TranscriptContent, type TranscriptSourcePayload } from "./transcript-input-contract";
import type { TranscriptRevisionFailureCode } from "./transcript-revision-contract";

export class TranscriptContentError extends Error {
  constructor(readonly code: TranscriptRevisionFailureCode) { super(code); }
}
function reject(code: TranscriptRevisionFailureCode): never { throw new TranscriptContentError(code); }

export async function hash(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function validText(text: string) {
  // Reject lossy UTF-16 and invisible-only input without changing any bytes.
  // eslint-disable-next-line no-control-regex -- Permit only tabs and CR/LF among C0 controls.
  return /[^\s\u200B-\u200D\u2060\uFEFF]/u.test(text) && !/[\uD800-\uDFFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text);
}
export function textOf(content: TranscriptContent): string {
  return content.format === "plain_text" ? content.text : content.segments.map((s) => s.text).join("\n");
}
export function originalContent(payload: TranscriptSourcePayload): TranscriptContent {
  return payload.sourceMode === "public_unofficial"
    ? { format: "timed_segments", segments: payload.segments.map((s, index) => ({ segmentId: `segment-${index + 1}`, ...s })) }
    : { format: "plain_text", text: payload.rawTranscriptText };
}
export async function verifySource(payload: TranscriptSourcePayload) {
  if (payload.sourceMode !== "public_unofficial") {
    const result = await verifyManualTranscriptSource(payload);
    if (result.outcome === "failed") {
      reject(result.code === "MANUAL_CHECKSUM_MISMATCH" ? "TRANSCRIPT_CHECKSUM_MISMATCH" : "TRANSCRIPT_CONTENT_INVALID");
    }
    return;
  }
  // Match P5-05 exactly, irrespective of the caller's object key insertion order.
  const canonical = payload.segments.map(({ text, start, duration }) => ({ text, start, duration }));
  for (let i = 0; i < canonical.length; i++) {
    const s = canonical[i]!;
    if (!validText(s.text) || !Number.isFinite(s.start + s.duration) ||
      (i > 0 && s.start < canonical[i - 1]!.start)) reject("TRANSCRIPT_CONTENT_INVALID");
  }
  if (await hash(JSON.stringify(canonical)) !== payload.sourceSha256) reject("TRANSCRIPT_CHECKSUM_MISMATCH");
}
export function verifyContent(content: TranscriptContent, source: TranscriptSourcePayload) {
  // Internally merged content must pass the same bounds as a direct edit request.
  if (!transcriptContentSchema.safeParse(content).success) reject("TRANSCRIPT_CONTENT_INVALID");
  const original = originalContent(source);
  if (content.format !== original.format) reject("TRANSCRIPT_CONTENT_INVALID");
  if (content.format === "plain_text") {
    if (!validText(content.text) || new TextEncoder().encode(content.text).byteLength > manualTranscriptMaxBytes) {
      reject("TRANSCRIPT_CONTENT_INVALID");
    }
  } else if (original.format === "timed_segments") {
    if (content.segments.length !== original.segments.length) reject("TRANSCRIPT_CONTENT_INVALID");
    content.segments.forEach((s, index) => {
      const raw = original.segments[index]!;
      if (!validText(s.text) || s.segmentId !== raw.segmentId || s.start !== raw.start || s.duration !== raw.duration) {
        reject("TRANSCRIPT_CONTENT_INVALID");
      }
    });
  }
}
