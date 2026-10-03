import { z } from "zod";
import { adminSermonIdSchema } from "./admin-sermon-input";

export const adminPublicVideoRequestSchema = z.strictObject({
  video: z.string().trim().min(1).max(2_048),
});

export const safeTranscriptDiagnosticSchema = z.strictObject({
  providerId: z.string().min(1).max(64),
  providerVersion: z.string().min(1).max(32),
  attempt: z.int().positive(),
  startedAt: z.iso.datetime(),
  elapsedMs: z.number().finite().nonnegative(),
  stage: z.enum(["input", "watch", "player", "tracks", "timed_text", "parse"]),
  reason: z.enum([
    "none", "invalid_input", "http", "redirect", "challenge", "unavailable",
    "missing", "schema", "unsafe_track", "empty", "no_korean", "size_limit",
    "timeout", "network", "unexpected",
  ]),
  httpStatus: z.int().min(100).max(599).nullable(),
  contentType: z.enum(["html", "json", "other", "missing"]),
  responseBytes: z.int().nonnegative(),
  trackCount: z.int().min(0).max(200).nullable(),
  selectedTrack: z.enum(["manual", "asr"]).nullable(),
  timeline: z.array(z.strictObject({
    stage: z.enum(["input", "watch", "player", "tracks", "timed_text", "parse"]),
    elapsedMs: z.number().finite().nonnegative(),
  })).max(6),
});

const captionFailure = {
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(500),
  fallback: z.literal("manual_paste"),
  diagnostic: safeTranscriptDiagnosticSchema,
};
export const adminPublicVideoPreviewSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("existing"),
    sermonId: adminSermonIdSchema,
    destination: z.enum(["draft", "published", "expired"]),
  }),
  z.strictObject({
    outcome: z.literal("inspected"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
    title: z.string().min(1).max(300).nullable(),
    publishedDate: z.iso.date().nullable(),
    caption: z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("available"),
        language: z.enum(["ko", "ko-KR"]),
        generated: z.boolean(),
        segmentCount: z.int().positive(),
        characterCount: z.int().nonnegative(),
      }),
      z.strictObject({ status: z.literal("unavailable"), ...captionFailure }),
    ]),
  }),
]);

export const adminPublicCaptionImportRequestSchema = z.strictObject({
  expectedVersion: z.literal(0),
});
export const adminPublicCaptionImportDataSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("imported") }),
  z.strictObject({ outcome: z.literal("failed"), ...captionFailure }),
]);

export type AdminPublicVideoPreview = z.infer<typeof adminPublicVideoPreviewSchema>;
export type AdminPublicCaptionImportData = z.infer<typeof adminPublicCaptionImportDataSchema>;
