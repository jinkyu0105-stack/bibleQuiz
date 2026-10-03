import { enum as zEnum, strictObject, literal, iso, number, int, array, string, boolean, type z } from "zod";

export const transcriptProvider = {
  id: "accountless-youtube-spike",
  version: "0.1.0",
} as const;

export const transcriptFailureMessages = {
  INVALID_YOUTUBE_URL: "YouTube 영상 주소나 video ID 형식을 확인해 주세요.",
  VIDEO_UNAVAILABLE: "영상의 공개 여부와 로그인·연령·지역 제한을 확인해 주세요.",
  VIDEO_METADATA_FETCH_FAILED: "영상 기본 정보를 가져오는 단계에서 실패했습니다.",
  PLAYER_RESPONSE_MISSING: "YouTube player 응답을 찾지 못했습니다.",
  TRANSCRIPTS_DISABLED: "확인한 player 응답에 공개 자막이 없습니다. 나중에 다시 확인해 주세요.",
  CAPTION_TRACKS_EMPTY: "공개 caption track 목록이 비어 있습니다.",
  KOREAN_TRANSCRIPT_NOT_FOUND: "공개 자막은 있지만 한국어 자막을 찾지 못했습니다.",
  CAPTION_TRACK_FORBIDDEN: "선택한 자막 요청이 거부되었습니다.",
  CAPTION_TRACK_RATE_LIMITED: "선택한 자막 요청이 일시적으로 제한되었습니다.",
  CAPTION_TRACK_EMPTY: "자막 응답이 비어 있습니다. 나중에 다시 확인해 주세요.",
  TRANSCRIPT_SOURCE_BLOCKED: "현재 요청 경로가 차단되거나 인증·동의가 필요합니다. 자막 없음으로 판단하지 않습니다.",
  TRANSCRIPT_FORMAT_CHANGED: "응답 형식이나 안전 조건이 예상과 달라 자막 가져오기를 중단했습니다.",
  TRANSCRIPT_TIMEOUT: "지정 시간 안에 YouTube 응답을 받지 못했습니다.",
  TRANSCRIPT_NETWORK_FAILED: "YouTube 연결 또는 응답 읽기에 실패했습니다.",
  TRANSCRIPT_FETCH_FAILED: "자막 가져오기에 실패했습니다. 안전한 진단 정보를 확인해 주세요.",
} as const;

export type TranscriptFailureCode = keyof typeof transcriptFailureMessages;
export const transcriptStageSchema = zEnum(["input", "watch", "player", "tracks", "timed_text", "parse"]);
export type TranscriptStage = z.infer<typeof transcriptStageSchema>;

// Only bounded numbers and locally chosen enums enter diagnostics. Never copy
// upstream strings, keys, Zod issues, exceptions, stack/cause, headers or URLs.
export const transcriptDiagnosticSchema = strictObject({
  providerId: literal(transcriptProvider.id),
  providerVersion: literal(transcriptProvider.version),
  attempt: literal(1),
  startedAt: iso.datetime(),
  elapsedMs: number().finite().nonnegative(),
  stage: transcriptStageSchema,
  reason: zEnum([
    "none", "invalid_input", "http", "redirect", "challenge", "unavailable",
    "missing", "schema", "unsafe_track", "empty", "no_korean", "size_limit",
    "timeout", "network", "unexpected",
  ]),
  httpStatus: int().min(100).max(599).nullable(),
  contentType: zEnum(["html", "json", "other", "missing"]),
  responseBytes: int().nonnegative(),
  trackCount: int().min(0).max(200).nullable(),
  selectedTrack: zEnum(["manual", "asr"]).nullable(),
  timeline: array(strictObject({
    stage: transcriptStageSchema,
    elapsedMs: number().finite().nonnegative(),
  })).max(6),
});
export type TranscriptDiagnostic = z.infer<typeof transcriptDiagnosticSchema>;

export const privateTranscriptSchema = strictObject({
  sourceMode: literal("public_unofficial"),
  videoId: string().regex(/^[A-Za-z0-9_-]{11}$/u),
  language: zEnum(["ko", "ko-KR"]),
  trackId: string().min(1).max(128),
  generated: boolean(),
  retrievedAt: iso.datetime(),
  providerId: literal(transcriptProvider.id),
  providerVersion: literal(transcriptProvider.version),
  // Hash of UTF-8 JSON.stringify(segments), not of the upstream transport body.
  sourceSha256: string().regex(/^[0-9a-f]{64}$/u),
  segments: array(strictObject({
    text: string().min(1).max(20_000),
    start: number().finite().nonnegative(),
    duration: number().finite().nonnegative(),
  })).min(1).max(20_000),
});

export type AccountlessTranscriptResult =
  | { outcome: "fetched"; transcript: z.infer<typeof privateTranscriptSchema>; diagnostic: TranscriptDiagnostic }
  | {
    outcome: "failed";
    code: TranscriptFailureCode;
    message: string;
    fallback: "manual_paste";
    diagnostic: TranscriptDiagnostic;
  };

/** Safe diagnostic-copy projection; the private success result is not an API DTO. */
export function transcriptDiagnosticForCopy(result: AccountlessTranscriptResult) {
  return {
    outcome: result.outcome,
    code: result.outcome === "failed" ? result.code : null,
    diagnostic: transcriptDiagnosticSchema.parse(result.diagnostic),
  };
}
