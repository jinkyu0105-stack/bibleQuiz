import { z } from "zod";

import { verifyManualTranscriptSource } from "../services/manual-transcript-source";
import { privateTranscriptStateSchema, type TranscriptState } from "../services/transcript-revision-contract";
import { decodeHistoryJson, encodeHistoryJson, historySha256, invalidHistory,
  sameHistoryValue, type HistoryPayload } from "./history-json-codec";

export const historyStreams = ["sources", "revisions", "confirmations", "correctionProposals",
  "correctionDecisions", "intentEvents", "summaryEvents", "candidateEvents"] as const;
export type HistoryStream = typeof historyStreams[number];
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
export const historyEnvelopeSchema = z.strictObject({
  storageFormatVersion: z.literal(1), sermonId: id, recordId: id,
  stream: z.enum(historyStreams), streamPosition: z.int().positive(),
  commitVersion: z.int().positive(), commitSlot: z.union([z.literal(0), z.literal(1)]),
  sourceRevision: z.int().positive().nullable(), difficulty: z.enum(["child", "adult"]).nullable(),
});
export type HistoryEnvelope = z.infer<typeof historyEnvelopeSchema>;
export type HistoryRecord = { [S in HistoryStream]: {
  envelope: HistoryEnvelope & { stream: S }; payload: TranscriptState[S][number];
} }[HistoryStream];
const shape = privateTranscriptStateSchema.shape;
const payloadSchemas = {
  sources: shape.sources.element, revisions: shape.revisions.element,
  confirmations: shape.confirmations.element,
  correctionProposals: shape.correctionProposals.unwrap().element,
  correctionDecisions: shape.correctionDecisions.unwrap().element,
  intentEvents: shape.intentEvents.unwrap().element,
  summaryEvents: shape.summaryEvents.unwrap().element,
  candidateEvents: shape.candidateEvents.unwrap().element,
};

/** No default arrays or repaired payloads at the storage boundary. */
export function parseHistoryRecord(input: unknown): HistoryRecord {
  try {
    const outer = z.strictObject({ envelope: historyEnvelopeSchema, payload: z.unknown() }).parse(input);
    const e = outer.envelope;
    const payload = payloadSchemas[e.stream].parse(outer.payload);
    if (!sameHistoryValue(payload, outer.payload) || payload.id !== e.recordId) invalidHistory();
    if (e.sourceRevision !== ("sourceRevision" in payload ? payload.sourceRevision : null) ||
      e.difficulty !== (e.stream === "candidateEvents" && "operation" in payload && "difficulty" in payload.operation
        ? payload.operation.difficulty : null)) invalidHistory();
    if (("version" in payload && payload.version !== e.commitVersion) ||
      ("registeredVersion" in payload && payload.registeredVersion !== e.commitVersion)) invalidHistory();
    const imported = e.stream === "revisions" && "kind" in payload && payload.kind === "imported";
    if (e.commitSlot !== (imported ? 1 : 0)) invalidHistory();
    // Schema dispatch above establishes this discriminated stream/payload association.
    return { envelope: e, payload } as HistoryRecord;
  } catch { return invalidHistory(); }
}

/** The existing source verifier and exact P5-07 working-text format stay separate. */
async function verifyRecordChecksum(record: HistoryRecord) {
  if (record.envelope.stream === "sources" && "payload" in record.payload) {
    const source = record.payload.payload;
    if (source.sourceMode !== "public_unofficial") {
      if ((await verifyManualTranscriptSource(source)).outcome !== "validated") invalidHistory();
    } else {
      const canonical = source.segments.map(({ text, start, duration }) => ({ text, start, duration }));
      if (await historySha256(new TextEncoder().encode(JSON.stringify(canonical))) !== source.sourceSha256) invalidHistory();
    }
  }
  if (record.envelope.stream === "revisions" && "content" in record.payload) {
    const content = record.payload.content;
    const text = content.format === "plain_text" ? content.text : content.segments.map((s) => s.text).join("\n");
    if (await historySha256(new TextEncoder().encode(text)) !== record.payload.transcriptSha256) invalidHistory();
  }
}
export async function encodeHistoryRecord(input: unknown): Promise<HistoryPayload> {
  try {
    const record = parseHistoryRecord(input);
    // encode rejects lossy JSON/Unicode, even in fields outside the text checksums.
    const encoded = await encodeHistoryJson(record.payload);
    await verifyRecordChecksum(record);
    return encoded;
  } catch { return invalidHistory(); }
}
export async function decodeHistoryRecord(envelope: unknown, encoded: unknown): Promise<HistoryRecord> {
  try {
    // Snapshot envelope before awaiting any hashes.
    const parsedEnvelope = historyEnvelopeSchema.parse(envelope);
    const record = parseHistoryRecord({ envelope: parsedEnvelope, payload: await decodeHistoryJson(encoded) });
    await verifyRecordChecksum(record);
    return record;
  } catch { return invalidHistory(); }
}
