import { z } from "zod";
import { parseYouTubeVideoId } from "../../../shared/sermon-registration";
import { sha256Bytes } from "../storage/sha256";
import { isWellFormedText } from "./text-well-formed";
import {
  privateTranscriptSchema, supadataTranscriptProvider, transcriptFailureMessages,
  type AccountlessTranscriptResult, type TranscriptDiagnostic, type TranscriptFailureCode,
} from "./accountless-transcript-contract";
import {
  createAccountlessPublicTranscriptProvider, readPublicVideoTitle,
  type AccountlessPublicTranscriptProvider,
} from "./accountless-youtube-transcript";

const inputSchema = z.strictObject({ video: z.string().min(1).max(2_048) });
const language = z.enum(["ko", "ko-KR"]);
const responseSchema = z.object({
  lang: language,
  content: z.array(z.object({
    text: z.string().min(1).max(20_000).refine(isWellFormedText).refine(text => Boolean(text.trim())),
    offset: z.number().finite().nonnegative(), duration: z.number().finite().nonnegative(), lang: language,
  })).min(1).max(20_000),
});
const pendingSchema = z.object({ jobId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u) });
const statusSchema = z.object({ status: z.enum(["queued", "active", "completed", "failed"]) });
class TranscriptFailure extends Error {
  constructor(readonly code: TranscriptFailureCode, readonly reason: TranscriptDiagnostic["reason"]) { super(code); }
}
function fail(code: TranscriptFailureCode, reason: TranscriptDiagnostic["reason"]): never {
  throw new TranscriptFailure(code, reason);
}
function inputVideoId(input: unknown) {
  const request = inputSchema.safeParse(input);
  return request.success ? parseYouTubeVideoId(request.data.video) : null;
}

/** Existing Korean captions only: never auto/generate, arbitrary URLs or credential redirects. */
export function createSupadataTranscriptProvider(options: {
  apiKey?: string | undefined; fetcher?: typeof fetch; timeoutMs?: number; pollIntervalMs?: number;
}): AccountlessPublicTranscriptProvider {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = Math.min(30_000, Math.max(1, options.timeoutMs ?? 30_000));
  const pollIntervalMs = Math.max(1_000, options.pollIntervalMs ?? 1_000);
  async function fetchTranscript(input: unknown): Promise<AccountlessTranscriptResult> {
    const started = Date.now();
    const diagnostic: TranscriptDiagnostic = {
      providerId: supadataTranscriptProvider.id, providerVersion: supadataTranscriptProvider.version,
      attempt: 1, startedAt: new Date(started).toISOString(), elapsedMs: 0, stage: "input", reason: "none",
      httpStatus: null, contentType: "missing", responseBytes: 0, trackCount: null, selectedTrack: null,
      timeline: [{ stage: "input", elapsedMs: 0 }],
    };
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(() => {
        timedOut = true; controller.abort(); reject(new TranscriptFailure("TRANSCRIPT_TIMEOUT", "timeout"));
      }, timeoutMs);
    });
    const active = () => { if (timedOut) fail("TRANSCRIPT_TIMEOUT", "timeout"); };
    async function read(url: URL): Promise<{ body: unknown; status: number }> {
      active();
      const response = await fetcher(url.toString(), {
        headers: { "x-api-key": options.apiKey! }, redirect: "manual", signal: controller.signal,
      });
      if (timedOut) { void response.body?.cancel().catch(() => {}); active(); }
      diagnostic.httpStatus = response.status;
      diagnostic.contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
        ? "json" : response.headers.has("content-type") ? "other" : "missing";
      reader = response.body?.getReader();
      if (response.status >= 300 && response.status < 400 || response.redirected) fail("TRANSCRIPT_FORMAT_CHANGED", "redirect");
      if (response.status === 401 || response.status === 403) fail("TRANSCRIPT_PROVIDER_UNAVAILABLE", "http");
      if (response.status === 402) fail("TRANSCRIPT_QUOTA_EXCEEDED", "http");
      if (response.status === 429) fail("CAPTION_TRACK_RATE_LIMITED", "http");
      if (!response.ok) fail("TRANSCRIPT_FETCH_FAILED", "http");
      if (diagnostic.contentType !== "json" || !reader) fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
      const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
      let text = "", bytes = 0;
      while (true) {
        const part = await reader.read(); active();
        if (part.done) break;
        bytes += part.value.byteLength;
        diagnostic.responseBytes = bytes;
        if (bytes > 1_048_576) fail("TRANSCRIPT_FORMAT_CHANGED", "size_limit");
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      void reader.cancel().catch(() => {}); reader = undefined;
      try { return { body: JSON.parse(text) as unknown, status: response.status }; }
      catch { return fail("TRANSCRIPT_FORMAT_CHANGED", "schema"); }
    }
    try {
      const transcript = await Promise.race([deadline, (async () => {
        const videoId = inputVideoId(input);
        if (!videoId) return fail("INVALID_YOUTUBE_URL", "invalid_input");
        if (!options.apiKey) return fail("TRANSCRIPT_PROVIDER_UNAVAILABLE", "missing");
        diagnostic.stage = "timed_text";
        diagnostic.timeline.push({ stage: "timed_text", elapsedMs: Date.now() - started });
        const url = new URL("https://api.supadata.ai/v1/transcript");
        url.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
        url.searchParams.set("mode", "native"); url.searchParams.set("lang", "ko"); url.searchParams.set("text", "false");
        let result = await read(url);
        if (result.status === 202) {
          const pending = pendingSchema.safeParse(result.body);
          if (!pending.success) return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
          const statusUrl = new URL("https://api.supadata.ai/v1/transcript/" + pending.data.jobId);
          // Poll only this job within the overall deadline; never submit another transcript request.
          while (true) {
            await new Promise<void>(resolve => { pollTimer = setTimeout(resolve, pollIntervalMs); }); active();
            result = await read(statusUrl);
            const state = statusSchema.safeParse(result.body);
            if (!state.success) return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
            if (state.data.status === "completed") break;
            if (state.data.status === "failed") return fail("TRANSCRIPT_FETCH_FAILED", "unexpected");
          }
        }
        diagnostic.stage = "parse";
        diagnostic.timeline.push({ stage: "parse", elapsedMs: Date.now() - started });
        const declared = z.object({ lang: z.string() }).safeParse(result.body);
        if (declared.success && !language.safeParse(declared.data.lang).success) return fail("KOREAN_TRANSCRIPT_NOT_FOUND", "no_korean");
        const parsed = responseSchema.safeParse(result.body);
        if (!parsed.success) return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
        const segments = parsed.data.content.map(row => ({ text: row.text, start: row.offset / 1_000, duration: row.duration / 1_000 }));
        if (segments.some((row, i) => i > 0 && row.start < segments[i - 1]!.start)) return fail("TRANSCRIPT_FORMAT_CHANGED", "schema");
        if ([...segments.map(row => row.text).join("\n")].length > 30_000) return fail("TRANSCRIPT_TOO_LARGE", "size_limit");
        const sourceSha256 = await sha256Bytes(new TextEncoder().encode(JSON.stringify(segments))); active();
        return privateTranscriptSchema.parse({
          sourceMode: "public_unofficial", videoId, language: parsed.data.lang,
          // The API does not expose the YouTube track ID or manual/ASR classification.
          trackId: "supadata-" + parsed.data.lang, generated: null,
          retrievedAt: new Date().toISOString(), providerId: supadataTranscriptProvider.id,
          providerVersion: supadataTranscriptProvider.version, sourceSha256, segments,
        });
      })()]);
      diagnostic.elapsedMs = Date.now() - started;
      return { outcome: "fetched", transcript, diagnostic };
    } catch (error) {
      const failure = error instanceof TranscriptFailure ? error : new TranscriptFailure("TRANSCRIPT_NETWORK_FAILED", "network");
      diagnostic.elapsedMs = Date.now() - started; diagnostic.reason = failure.reason;
      return { outcome: "failed", code: failure.code, message: transcriptFailureMessages[failure.code], fallback: "manual_paste", diagnostic };
    } finally {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      controller.abort();
      void reader?.cancel().catch(() => {});
    }
  }
  return {
    descriptor: supadataTranscriptProvider, fetchTranscript,
    async inspectVideo(input) {
      const videoId = inputVideoId(input);
      const [result, title] = await Promise.all([
        fetchTranscript(input), videoId ? readPublicVideoTitle(videoId, fetcher, timeoutMs) : Promise.resolve(null),
      ]);
      return { result, video: videoId ? { videoId, title, publishedDate: null } : null };
    },
  };
}

export function createPublicTranscriptProvider(env: { PUBLIC_TRANSCRIPT_PROVIDER?: string; SUPADATA_API_KEY?: string }, fetcher: typeof fetch) {
  if (!env.PUBLIC_TRANSCRIPT_PROVIDER || env.PUBLIC_TRANSCRIPT_PROVIDER === "accountless") return createAccountlessPublicTranscriptProvider({ fetcher });
  return createSupadataTranscriptProvider({ apiKey: env.PUBLIC_TRANSCRIPT_PROVIDER === "supadata" ? env.SUPADATA_API_KEY : undefined, fetcher });
}
