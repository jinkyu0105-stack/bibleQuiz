import { string, union, strictObject, number, discriminatedUnion, literal, array, iso, type z } from "zod";
import { privateTranscriptSchema } from "./accountless-transcript-contract";
import { manualTranscriptMaxBytes, manualTranscriptSourceSchema } from "./manual-transcript-source";
import { prepareInputSchema } from "./prepare-input-schema";

// Lightweight shared input boundary, without downstream AI/history schemas.
const id = string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
export const transcriptSourcePayloadSchema = union([
  manualTranscriptSourceSchema, privateTranscriptSchema,
]);
const segmentSchema = strictObject({
  segmentId: id,
  text: string().min(1).max(20_000),
  start: number().finite().nonnegative(),
  duration: number().finite().nonnegative(),
});
export const transcriptContentSchema = discriminatedUnion("format", [
  strictObject({ format: literal("plain_text"), text: string().max(manualTranscriptMaxBytes) }),
  strictObject({ format: literal("timed_segments"), segments: array(segmentSchema).min(1).max(20_000) }),
]);
// Supplied exclusively by the authenticated server caller, never by request JSON.
export const transcriptHumanContextSchema = strictObject({
  kind: literal("human"), adminId: id, now: iso.datetime(),
});

prepareInputSchema(transcriptSourcePayloadSchema);
prepareInputSchema(transcriptContentSchema);
prepareInputSchema(transcriptHumanContextSchema);

export type TranscriptContent = z.infer<typeof transcriptContentSchema>;
export type TranscriptSourcePayload = z.infer<typeof transcriptSourcePayloadSchema>;
