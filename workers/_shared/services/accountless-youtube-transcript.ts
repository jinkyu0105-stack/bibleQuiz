import { parseYouTubeVideoId } from "../../../shared/sermon-registration";
import { z } from "zod";
import { isWellFormedText } from "./text-well-formed";

import {
  privateTranscriptSchema,
  transcriptFailureMessages,
  transcriptProvider,
  type AccountlessTranscriptResult,
  type TranscriptDiagnostic,
  type TranscriptFailureCode,
  type TranscriptStage,
} from "./accountless-transcript-contract";

const requestSchema = z.strictObject({ video: z.string().min(1).max(2_048) });
const trackSchema = z.object({
  baseUrl: z.string().min(1).max(8_192),
  languageCode: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u).max(32),
  kind: z.literal("asr").optional(),
  vssId: z.string().regex(/^[.A-Za-z0-9_-]{1,128}$/u),
});
const playerSchema = z.object({
  playabilityStatus: z.object({ status: z.string(), reason: z.string().max(4_096).optional() }),
  videoDetails: z.object({ videoId: z.string(), title: z.string().optional() }).optional(),
  microformat: z.object({ playerMicroformatRenderer: z.object({ publishDate: z.string().optional() }) }).optional(),
  captions: z.object({
    playerCaptionsTracklistRenderer: z.object({
      captionTracks: z.array(trackSchema).max(200),
    }),
  }).optional(),
});
const json3Schema = z.object({
  wireMagic: z.literal("pb3"),
  events: z.array(z.object({
    tStartMs: z.number().finite().nonnegative().max(86_400_000),
    dDurationMs: z.number().finite().nonnegative().max(86_400_000).optional(),
    id: z.int().nonnegative().optional(),
    wpWinPosId: z.int().nonnegative().optional(),
    wsWinStyleId: z.int().nonnegative().optional(),
    segs: z.array(z.object({ utf8: z.string().max(20_000) })).max(2_000).optional(),
  })).max(20_000),
});

class SpikeFailure extends Error {
  constructor(
    readonly code: TranscriptFailureCode,
    readonly reason: TranscriptDiagnostic["reason"],
  ) {
    super(code);
  }
}
function fail(code: TranscriptFailureCode, reason: TranscriptDiagnostic["reason"]): never {
  throw new SpikeFailure(code, reason);
}

function videoIdFromInput(input: unknown): string {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_YOUTUBE_URL", "invalid_input");
  const id = parseYouTubeVideoId(parsed.data.video);
  if (!id) return fail("INVALID_YOUTUBE_URL", "invalid_input");
  return id;
}

function timedTextUrl(track: z.infer<typeof trackSchema>, videoId: string): string {
  let url: URL;
  try { url = new URL(track.baseUrl); } catch { return fail("TRANSCRIPT_FORMAT_CHANGED", "unsafe_track"); }
  if (url.protocol !== "https:" || url.hostname !== "www.youtube.com"
    || url.port || url.username || url.password || url.hash
    || url.pathname !== "/api/timedtext"
    || url.searchParams.getAll("v").length !== 1 || url.searchParams.get("v") !== videoId
    || url.searchParams.getAll("lang").length !== 1 || url.searchParams.get("lang") !== track.languageCode
    || url.searchParams.has("tlang") || url.searchParams.getAll("fmt").length > 1
    || url.searchParams.getAll("kind").length > 1
    || (url.searchParams.get("kind") ?? undefined) !== track.kind) {
    return fail("TRANSCRIPT_FORMAT_CHANGED", "unsafe_track");
  }
  url.searchParams.set("fmt", "json3");
  return url.toString();
}

function parseJson(body: string): unknown {
  try { return JSON.parse(body); } catch { return fail("TRANSCRIPT_FORMAT_CHANGED", "schema"); }
}

function parseSegments(body: string) {
  if (!body.trim()) return fail("CAPTION_TRACK_EMPTY", "empty");
  const parsed = json3Schema.safeParse(parseJson(body));
  if (!parsed.success) return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
  const segments: { text: string; start: number; duration: number }[] = [];
  for (const event of parsed.data.events) {
    if (!event.segs) {
      // JSON3 window-definition events contain no caption text.
      if (event.id !== undefined && event.wpWinPosId !== undefined && event.wsWinStyleId !== undefined) continue;
      return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
    }
    const text = event.segs.map((segment) => segment.utf8).join("");
    if (!text.trim()) continue;
    if (event.dDurationMs === undefined || text.length > 20_000) {
      return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
    }
    const start = event.tStartMs / 1_000;
    if (segments.length > 0 && start < segments[segments.length - 1]!.start) {
      return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
    }
    segments.push({ text, start, duration: event.dDurationMs / 1_000 });
  }
  if (!segments.length) return fail("CAPTION_TRACK_EMPTY", "empty");
  return segments;
}

export interface AccountlessPublicTranscriptProvider {
  readonly descriptor: typeof transcriptProvider;
  fetchTranscript(input: unknown): Promise<AccountlessTranscriptResult>;
  inspectVideo(input: unknown): Promise<{ video: PublicVideoMetadata | null; result: AccountlessTranscriptResult }>;
}

export interface PublicVideoMetadata {
  videoId: string;
  title: string | null;
  publishedDate: string | null;
}

// oEmbed supplies public link metadata only. It cannot fetch captions or
// resolve a player challenge, and its failure must not replace that diagnostic.
async function readPublicVideoTitle(videoId: string, fetcher: typeof fetch, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const deadline = new Promise<null>(resolve => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); resolve(null); }, Math.min(timeoutMs, 3_000));
  });
  try {
    return await Promise.race([deadline, (async () => {
      const url = new URL("https://www.youtube.com/oembed");
      url.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
      url.searchParams.set("format", "json");
      const response = await fetcher(url.toString(), {
        redirect: "manual", signal: controller.signal,
      });
      if (timedOut) { void response.body?.cancel().catch(() => {}); return null; }
      reader = response.body?.getReader();
      if (!response.ok || response.redirected
        || response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return null;
      const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
      let bytes = 0, body = "";
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (timedOut) return null;
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 16_384) return null;
          body += decoder.decode(chunk.value, { stream: true });
        }
      }
      body += decoder.decode();
      const parsed = z.object({
        type: z.literal("video"), version: z.literal("1.0"), provider_name: z.literal("YouTube"),
        title: z.string().trim().min(1).max(300).refine(isWellFormedText)
          // eslint-disable-next-line no-control-regex -- Public metadata is displayed as plain text.
          .refine(title => !/[\u0000-\u001F\u007F]/u.test(title)),
      }).safeParse(JSON.parse(body));
      // Deliberately ignore embed HTML, thumbnails, author information and URLs.
      return parsed.success ? parsed.data.title : null;
    })()]);
  } catch { return null; }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}

/**
 * The admin route supplies the transport explicitly. The adapter has no DB,
 * Workflow, logger, cookies or automatic retry. Live provider availability
 * remains a separate deployment gate in docs/spec/generation.md 11.3.
 */
export function createAccountlessPublicTranscriptProvider(options: {
  fetcher: typeof fetch;
  timeoutMs?: number;
}): AccountlessPublicTranscriptProvider {
  // Calling native Workers fetch as options.fetcher gives it the wrong receiver.
  // Keep the injected transport detached, just like a direct global fetch call.
  const fetcher = options.fetcher;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("INVALID_TRANSCRIPT_SPIKE_TIMEOUT");
  }

  async function fetchBundle(input: unknown): Promise<{ video: PublicVideoMetadata | null; result: AccountlessTranscriptResult }> {
      const started = Date.now();
      let video: PublicVideoMetadata | null = null;
      let stageStarted = started;
      const diagnostic: TranscriptDiagnostic = {
        providerId: transcriptProvider.id, providerVersion: transcriptProvider.version,
        attempt: 1, startedAt: new Date(started).toISOString(), elapsedMs: 0,
        stage: "input", reason: "none", httpStatus: null, contentType: "missing",
        responseBytes: 0, trackCount: null, selectedTrack: null, timeline: [],
      };
      function elapsed(since: number) { return Math.max(0, Date.now() - since); }
      function finishStage() {
        diagnostic.timeline.push({ stage: diagnostic.stage, elapsedMs: elapsed(stageStarted) });
        diagnostic.elapsedMs = elapsed(started);
      }
      function stage(next: TranscriptStage) {
        finishStage();
        diagnostic.stage = next;
        stageStarted = Date.now();
      }
      function requireContentType(expected: "html" | "json") {
        if (diagnostic.contentType !== expected) fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
      }

      async function read(url: string, init: RequestInit, maxBytes: number): Promise<string> {
        diagnostic.httpStatus = null;
        diagnostic.contentType = "missing";
        diagnostic.responseBytes = 0;
        const controller = new AbortController();
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        // Timeout covers headers AND streaming body, even if a test transport
        // ignores AbortSignal. No retry or alternate client on blocked requests.
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new SpikeFailure("TRANSCRIPT_TIMEOUT", "timeout"));
          }, timeoutMs);
        });
        try {
          return await Promise.race([deadline, (async () => {
            const response = await fetcher(url, {
              // Workers have no ambient browser cookie jar. Only our explicit
              // Content-Type header is sent; Set-Cookie is never replayed.
              ...init, redirect: "manual", signal: controller.signal,
            });
            if (timedOut) {
              void response.body?.cancel().catch(() => {});
              return fail("TRANSCRIPT_TIMEOUT", "timeout");
            }
            diagnostic.httpStatus = response.status;
            const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
            diagnostic.contentType = mime === "application/json" ? "json"
              : mime === "text/html" ? "html" : mime ? "other" : "missing";
            if (response.body) reader = response.body.getReader();
            if (response.redirected || (response.status >= 300 && response.status < 400)) {
              return fail("TRANSCRIPT_SOURCE_BLOCKED", "redirect");
            }
            if ([401, 403, 429].includes(response.status)) {
              return fail(diagnostic.stage === "timed_text"
                ? response.status === 429 ? "CAPTION_TRACK_RATE_LIMITED" : "CAPTION_TRACK_FORBIDDEN"
                : "TRANSCRIPT_SOURCE_BLOCKED", "http");
            }
            if (!response.ok) {
              return fail(diagnostic.stage !== "timed_text" && (response.status === 404 || response.status === 410) ? "VIDEO_UNAVAILABLE"
                : diagnostic.stage === "watch" ? "VIDEO_METADATA_FETCH_FAILED" : "TRANSCRIPT_FETCH_FAILED", "http");
            }
            const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
            let body = "";
            if (reader) {
              while (true) {
                const chunk = await reader.read();
                if (timedOut) return fail("TRANSCRIPT_TIMEOUT", "timeout");
                if (chunk.done) break;
                diagnostic.responseBytes += chunk.value.byteLength;
                if (diagnostic.responseBytes > maxBytes) return fail("TRANSCRIPT_FORMAT_CHANGED", "size_limit");
                try { body += decoder.decode(chunk.value, { stream: true }); }
                catch { return fail("TRANSCRIPT_FORMAT_CHANGED", "schema"); }
              }
            }
            try { body += decoder.decode(); } catch { return fail("TRANSCRIPT_FORMAT_CHANGED", "schema"); }
            if (/class=["']g-recaptcha["']|action=["']https:\/\/consent\.youtube\.com\/s["']/u.test(body)) {
              return fail("TRANSCRIPT_SOURCE_BLOCKED", "challenge");
            }
            return body;
          })()]);
        } catch (error) {
          if (error instanceof SpikeFailure) throw error;
          return fail("TRANSCRIPT_NETWORK_FAILED", "network");
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          controller.abort();
          void reader?.cancel().catch(() => {});
        }
      }

      try {
        const videoId = videoIdFromInput(input);
        stage("watch");
        const html = await read(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {}, 2_097_152);
        requireContentType("html");
        // The watch page's caption URLs can return an empty body even when
        // the explicit player request supplies a usable track. Keep the
        // original single player request; never retry a challenge.
        const apiKey = /"INNERTUBE_API_KEY"\s*:\s*"([A-Za-z0-9_-]{1,256})"/u.exec(html)?.[1];
        if (!apiKey) return fail("PLAYER_RESPONSE_MISSING", "missing");
        stage("player");
        const body = await read(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId, context: {
            client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" },
          } }),
        }, 2_097_152);
        if (!body.trim()) return fail("PLAYER_RESPONSE_MISSING", "missing");
        requireContentType("json");
        const data = parseJson(body);
        const parsed = playerSchema.safeParse(data);
        if (!parsed.success) return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
        const player = parsed.data;
        if (player.videoDetails && player.videoDetails.videoId !== videoId) return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
        if (player.videoDetails?.videoId === videoId) {
          const rawTitle = player.videoDetails.title?.trim();
          const rawPublishedDate = player.microformat?.playerMicroformatRenderer.publishDate;
          video = {
            videoId,
            title: rawTitle && rawTitle.length <= 300 && isWellFormedText(rawTitle)
              // eslint-disable-next-line no-control-regex -- Upstream text is displayed in an admin form.
              && !/[\u0000-\u001F\u007F]/u.test(rawTitle) ? rawTitle : null,
            publishedDate: rawPublishedDate && z.iso.date().safeParse(rawPublishedDate).success ? rawPublishedDate : null,
          };
        }
        if (player.playabilityStatus.status !== "OK") {
          if (player.playabilityStatus.status === "LOGIN_REQUIRED"
            && ["Sign in to confirm you’re not a bot", "Sign in to confirm you're not a bot"].includes(player.playabilityStatus.reason ?? "")) {
            return fail("TRANSCRIPT_SOURCE_BLOCKED", "challenge");
          }
          if (["LOGIN_REQUIRED", "UNPLAYABLE", "ERROR", "LIVE_STREAM_OFFLINE", "AGE_CHECK_REQUIRED", "CONTENT_CHECK_REQUIRED"].includes(player.playabilityStatus.status)) {
            return fail("VIDEO_UNAVAILABLE", "unavailable");
          }
          return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
        }
        if (player.videoDetails?.videoId !== videoId) return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
        stage("tracks");
        if (!player.captions) return fail("TRANSCRIPTS_DISABLED", "missing");
        const tracks = player.captions.playerCaptionsTracklistRenderer.captionTracks;
        diagnostic.trackCount = tracks.length;
        if (!tracks.length) return fail("CAPTION_TRACKS_EMPTY", "empty");
        const korean = tracks.filter((track) => track.languageCode === "ko" || track.languageCode === "ko-KR");
        const selected = korean.find((track) => track.kind !== "asr") ?? korean[0];
        if (!selected) return fail("KOREAN_TRANSCRIPT_NOT_FOUND", "no_korean");
        diagnostic.selectedTrack = selected.kind === "asr" ? "asr" : "manual";
        const url = timedTextUrl(selected, videoId);
        stage("timed_text");
        const timedText = await read(url, {}, 4_194_304);
        if (timedText.trim()) requireContentType("json");
        stage("parse");
        const segments = parseSegments(timedText);
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(segments)));
        const sourceSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const transcript = privateTranscriptSchema.parse({
          sourceMode: "public_unofficial", videoId, language: selected.languageCode,
          trackId: selected.vssId, generated: selected.kind === "asr", segments, sourceSha256,
          retrievedAt: new Date().toISOString(), providerId: transcriptProvider.id, providerVersion: transcriptProvider.version,
        });
        finishStage();
        return { video, result: { outcome: "fetched", transcript, diagnostic } };
      } catch (error) {
        const code = error instanceof SpikeFailure ? error.code : "TRANSCRIPT_FETCH_FAILED";
        diagnostic.reason = error instanceof SpikeFailure ? error.reason : "unexpected";
        finishStage();
        return { video, result: { outcome: "failed", code, message: transcriptFailureMessages[code], fallback: "manual_paste", diagnostic } };
      }
  }
  return {
    descriptor: transcriptProvider,
    async fetchTranscript(input) { return (await fetchBundle(input)).result; },
    async inspectVideo(input) {
      const inspected = await fetchBundle(input);
      // Only a blocked preview with no title needs independent link metadata.
      // Import, successful metadata and invalid/unavailable videos stay unchanged.
      if (inspected.video?.title || inspected.result.outcome !== "failed"
        || inspected.result.code !== "TRANSCRIPT_SOURCE_BLOCKED") return inspected;
      const title = await readPublicVideoTitle(videoIdFromInput(input), fetcher, timeoutMs);
      return title ? { ...inspected, video: {
        videoId: videoIdFromInput(input), title, publishedDate: inspected.video?.publishedDate ?? null,
      } } : inspected;
    },
  };
}
