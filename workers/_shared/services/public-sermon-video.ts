import {
  adminPublicCaptionImportDataSchema,
  adminPublicCaptionImportRequestSchema,
  adminPublicVideoPreviewSchema,
  adminPublicVideoRequestSchema,
} from "../../../shared/api/admin-public-video";
import { parseYouTubeVideoId } from "../../../shared/sermon-registration";
import { createSermonInputStore } from "../repositories/sermon-input-store";
import {
  privateTranscriptSchema,
  transcriptDiagnosticSchema,
  transcriptFailureMessages,
  type AccountlessTranscriptResult,
} from "./accountless-transcript-contract";
import type { AccountlessPublicTranscriptProvider } from "./accountless-youtube-transcript";
import { findExistingSermonVideo, readSermonDraft } from "./sermon-drafts";
import { createSermonInputService } from "./sermon-input";
import { sha256Bytes } from "../storage/sha256";

export class PublicVideoError extends Error {
  constructor(readonly code: "VIDEO_INVALID" | "VIDEO_CONFLICT" | "VIDEO_TOO_LARGE" | "VIDEO_SAVE_UNCERTAIN") {
    super(code);
  }
}

function safeFailure(result: Extract<AccountlessTranscriptResult, { outcome: "failed" }>) {
  const code = Object.hasOwn(transcriptFailureMessages, result.code)
    ? result.code : "TRANSCRIPT_FETCH_FAILED";
  return {
    code,
    message: transcriptFailureMessages[code],
    fallback: "manual_paste" as const,
    diagnostic: transcriptDiagnosticSchema.parse(result.diagnostic),
  };
}

export async function previewPublicSermonVideo(
  db: D1Database,
  raw: unknown,
  provider: AccountlessPublicTranscriptProvider,
) {
  const request = adminPublicVideoRequestSchema.safeParse(raw);
  if (!request.success) throw new PublicVideoError("VIDEO_INVALID");
  const videoId = parseYouTubeVideoId(request.data.video);
  if (!videoId) throw new PublicVideoError("VIDEO_INVALID");
  const existing = await findExistingSermonVideo(db, videoId);
  if (existing) return adminPublicVideoPreviewSchema.parse(existing);

  const inspected = await provider.inspectVideo({ video: videoId });
  if (inspected.video && inspected.video.videoId !== videoId) throw new PublicVideoError("VIDEO_INVALID");
  const result = inspected.result;
  if (result.outcome === "fetched" && result.transcript.videoId !== videoId) throw new PublicVideoError("VIDEO_INVALID");
  return adminPublicVideoPreviewSchema.parse({
    outcome: "inspected", videoId,
    title: inspected.video?.title ?? null,
    publishedDate: inspected.video?.publishedDate ?? null,
    caption: result.outcome === "fetched"
      ? {
          status: "available", language: result.transcript.language,
          generated: result.transcript.generated, segmentCount: result.transcript.segments.length,
          characterCount: [...result.transcript.segments.map(segment => segment.text).join("\n")].length,
        }
      : { status: "unavailable", ...safeFailure(result) },
  });
}

export async function importPublicSermonCaptions(
  db: D1Database,
  sermonId: string,
  raw: unknown,
  actorEmail: string,
  provider: AccountlessPublicTranscriptProvider,
) {
  const request = adminPublicCaptionImportRequestSchema.safeParse(raw);
  if (!request.success) throw new PublicVideoError("VIDEO_INVALID");
  const draft = await readSermonDraft(db, sermonId);
  const store = createSermonInputStore(db);
  if (await store.head(sermonId)) throw new PublicVideoError("VIDEO_CONFLICT");
  const videoId = parseYouTubeVideoId(draft.youtubeUrl);
  if (!videoId) throw new PublicVideoError("VIDEO_INVALID");
  const result = await provider.fetchTranscript({ video: videoId });
  if (result.outcome === "failed") {
    return adminPublicCaptionImportDataSchema.parse({ outcome: "failed", ...safeFailure(result) });
  }
  const transcript = privateTranscriptSchema.parse(result.transcript);
  if (transcript.videoId !== videoId) throw new PublicVideoError("VIDEO_INVALID");
  const saved = await createSermonInputService(store).execute(sermonId, {
    action: "import_source", expectedVersion: request.data.expectedVersion, payload: transcript,
  }, {
    kind: "human", adminId: await sha256Bytes(new TextEncoder().encode(actorEmail)), now: new Date().toISOString(),
  });
  if (saved.outcome === "failed") {
    throw new PublicVideoError(saved.code === "INPUT_CONFLICT" ? "VIDEO_CONFLICT"
      : saved.code === "INPUT_TOO_LARGE" ? "VIDEO_TOO_LARGE" : "VIDEO_SAVE_UNCERTAIN");
  }
  return adminPublicCaptionImportDataSchema.parse({ outcome: "imported" });
}
