import { describe, expect, it, vi } from "vitest";

import {
  privateTranscriptSchema,
  transcriptDiagnosticForCopy,
  transcriptDiagnosticSchema,
  type AccountlessTranscriptResult,
  type TranscriptFailureCode,
} from "../_shared/services/accountless-transcript-contract";
import { createAccountlessPublicTranscriptProvider } from "../_shared/services/accountless-youtube-transcript";

// Entirely synthetic: no video retrieval, real transcript, account or API key.
const videoId = "TESTONLY001";
const canary = "TEST_ONLY_PRIVATE_TRANSCRIPT";
const secret = "TEST_ONLY_SIGNED_QUERY";
const watch = () => new Response('<script>{"INNERTUBE_API_KEY":"TEST_ONLY_PUBLIC_CONFIG"}</script>', {
  headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": "TEST_ONLY_COOKIE" },
});
function track(languageCode = "ko", generated = false) {
  return {
    languageCode,
    vssId: `${generated ? "a" : ""}.${languageCode}`,
    baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${languageCode}&signature=${secret}${generated ? "&kind=asr" : ""}`,
    ...(generated ? { kind: "asr" } : {}),
    name: { simpleText: "TEST_ONLY_TRACK_NAME" },
  };
}
function player(tracks: unknown[] = [track()]) {
  return {
    playabilityStatus: { status: "OK" },
    videoDetails: { videoId, title: "TEST_ONLY_PRIVATE_TITLE" },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
    responseContext: { visitorData: "TEST_ONLY_VISITOR" },
  };
}
function timedText() {
  return {
    wireMagic: "pb3",
    events: [
      { tStartMs: 0, id: 1, wpWinPosId: 1, wsWinStyleId: 1 },
      { tStartMs: 125, dDurationMs: 1_250, segs: [{ utf8: canary }, { utf8: " 합성 가" }] },
      { tStartMs: 1_200, dDurationMs: 800, segs: [{ utf8: " 합성 나 & <b>text</b> " }] },
      { tStartMs: 2_100, dDurationMs: 500, segs: [{ utf8: "\n" }] },
    ],
  };
}
type TransportStep = Response | (() => Promise<Response>);
function transport(steps: TransportStep[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const step = steps[calls.length - 1];
    if (!step) throw new Error("Unexpected synthetic request");
    return typeof step === "function" ? step() : step;
  };
  return { fetcher, calls };
}
async function run(steps: TransportStep[], input: unknown = { video: videoId }, timeoutMs?: number) {
  const mock = transport(steps);
  const provider = createAccountlessPublicTranscriptProvider({
    fetcher: mock.fetcher, ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { result: await provider.fetchTranscript(input), calls: mock.calls };
}
function failure(result: AccountlessTranscriptResult, code: TranscriptFailureCode) {
  expect(result.outcome).toBe("failed");
  if (result.outcome !== "failed") throw new Error("Expected synthetic failure");
  expect(result.code).toBe(code);
  expect(result.fallback).toBe("manual_paste");
  expect(transcriptDiagnosticSchema.safeParse(result.diagnostic).success).toBe(true);
  const copied = JSON.stringify(transcriptDiagnosticForCopy(result));
  for (const value of [canary, secret, "TEST_ONLY_PUBLIC_CONFIG", "TEST_ONLY_COOKIE", "TEST_ONLY_VISITOR", "TEST_ONLY_PRIVATE_TITLE", "TEST_ONLY_TRACK_NAME", "https://", "signedUrl", "Authorization", "stack", "cause"]) {
    expect(JSON.stringify(result)).not.toContain(value);
    expect(copied).not.toContain(value);
  }
}

describe("accountless YouTube transcript technical spike", () => {
  it("uses native Workers fetch with a valid receiver for injected transport", async () => {
    // data: GET responses exercise native workerd receiver checks without a
    // live YouTube request, private transcript or provider credential.
    const nativeFetch = fetch;
    await expect(Promise.resolve().then(() => nativeFetch.call({}, "data:text/plain,synthetic")))
      .rejects.toThrow("Illegal invocation");
    const calls: string[] = [];
    const fetcher: typeof fetch = function (this: unknown, input, init) {
      const url = String(input);
      calls.push(url);
      const payload = calls.length === 1
        ? 'data:text/html,' + encodeURIComponent('<script>{"INNERTUBE_API_KEY":"TEST_ONLY_PUBLIC_CONFIG"}</script>')
        : 'data:application/json,' + encodeURIComponent(JSON.stringify({
          playabilityStatus: { status: "OK" },
          videoDetails: { videoId, title: "TEST_ONLY_NATIVE_TITLE" },
        }));
      return nativeFetch.call(this, payload, {
        ...(init?.signal ? { signal: init.signal } : {}),
        ...(init?.redirect ? { redirect: init.redirect } : {}),
      });
    };
    const inspected = await createAccountlessPublicTranscriptProvider({ fetcher }).inspectVideo({ video: videoId });
    expect(inspected.result.outcome).toBe("failed");
    if (inspected.result.outcome === "failed") expect(inspected.result.code).toBe("TRANSCRIPTS_DISABLED");
    expect(inspected.video?.title).toBe("TEST_ONLY_NATIVE_TITLE");
    expect(calls).toHaveLength(2);
  });
  it("prefers manual Korean; preserves private text/overlap/seconds and hashes canonical segments", async () => {
    const { result, calls } = await run([watch(), Response.json(player([track("en"), track("ko", true), track()])), Response.json(timedText())]);
    expect(result.outcome).toBe("fetched");
    if (result.outcome !== "fetched") return;
    expect(privateTranscriptSchema.safeParse(result.transcript).success).toBe(true);
    expect(result.transcript).toMatchObject({ videoId, language: "ko", generated: false, trackId: ".ko", sourceMode: "public_unofficial" });
    expect(result.transcript.segments).toEqual([
      { text: `${canary} 합성 가`, start: 0.125, duration: 1.25 },
      { text: " 합성 나 & <b>text</b> ", start: 1.2, duration: 0.8 },
    ]);
    const expectedHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(result.transcript.segments)));
    expect(result.transcript.sourceSha256).toBe(Array.from(new Uint8Array(expectedHash), (b) => b.toString(16).padStart(2, "0")).join(""));
    expect(result.diagnostic.timeline.map((entry) => entry.stage)).toEqual(["input", "watch", "player", "tracks", "timed_text", "parse"]);
    expect(transcriptDiagnosticSchema.safeParse(result.diagnostic).success).toBe(true);
    expect(calls).toHaveLength(3);
    const captionUrl = new URL(calls[2]!.url);
    expect(captionUrl.searchParams.get("fmt")).toBe("json3");
    expect(captionUrl.searchParams.has("kind")).toBe(false);
    for (const call of calls) {
      expect(call.init).toMatchObject({ redirect: "manual" });
      const headers = new Headers(call.init?.headers);
      expect(headers.has("cookie")).toBe(false);
      expect(headers.has("authorization")).toBe(false);
    }
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ videoId, context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" } } });
    const copy = JSON.stringify(transcriptDiagnosticForCopy(result));
    for (const value of [canary, secret, "segments", "TEST_ONLY_PUBLIC_CONFIG", "TEST_ONLY_VISITOR", "https://"]) expect(copy).not.toContain(value);
  });

  it.each(["ko", "ko-KR"])("uses already-published %s ASR when manual Korean is absent", async (language) => {
    const { result } = await run([watch(), Response.json(player([track("en"), track(language, true)])), Response.json(timedText())]);
    expect(result.outcome === "fetched" && result.transcript.generated).toBe(true);
    expect(result.diagnostic.selectedTrack).toBe("asr");
  });

  it.each([
    videoId, `https://youtu.be/${videoId}?si=TEST_ONLY_TRACKING`,
    `https://www.youtube.com/watch?v=${videoId}&list=TEST_ONLY_PLAYLIST`,
    `https://m.youtube.com/shorts/${videoId}`, `https://youtube.com/live/${videoId}`, `https://youtube.com/embed/${videoId}`,
  ])("normalizes supported input without forwarding extra query: %s", async (video) => {
    const { calls } = await run([new Response(null, { status: 403 })], { video });
    expect(calls[0]!.url).toBe(`https://www.youtube.com/watch?v=${videoId}&hl=en`);
  });

  it.each([
    null, { video: videoId, cookie: secret }, { video: "" }, { video: "too-short" },
    { video: `https://youtube.com.evil.example/watch?v=${videoId}` },
    { video: `https://user:password@youtube.com/watch?v=${videoId}` },
    { video: `https://youtube.com:444/watch?v=${videoId}` },
    { video: `http://youtube.com/watch?v=${videoId}` },
    { video: `https://youtube.com/watch?v=${videoId}&v=${videoId}` },
    { video: `https://127.0.0.1/watch?v=${videoId}` },
  ])("rejects malformed or unsafe input before transport %#", async (input) => {
    const { result, calls } = await run([], input);
    failure(result, "INVALID_YOUTUBE_URL");
    expect(calls).toHaveLength(0);
  });

  it.each([
    [{ playabilityStatus: { status: "OK" }, videoDetails: { videoId } }, "TRANSCRIPTS_DISABLED"],
    [player([]), "CAPTION_TRACKS_EMPTY"],
    [player([track("en")]), "KOREAN_TRANSCRIPT_NOT_FOUND"],
    [{ ...player(), captions: {} }, "TRANSCRIPT_FORMAT_CHANGED"],
    [{ ...player(), captions: null }, "TRANSCRIPT_FORMAT_CHANGED"],
    [{ ...player(), videoDetails: { videoId: "OTHERONLY01" } }, "TRANSCRIPT_FORMAT_CHANGED"],
    [{ captions: {} }, "TRANSCRIPT_FORMAT_CHANGED"],
    [{ playabilityStatus: { status: "NEW_UNKNOWN_STATUS" } }, "TRANSCRIPT_FORMAT_CHANGED"],
    [{ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" } }, "TRANSCRIPT_SOURCE_BLOCKED"],
    [{ playabilityStatus: { status: "LOGIN_REQUIRED", reason: secret } }, "VIDEO_UNAVAILABLE"],
    [{ playabilityStatus: { status: "UNPLAYABLE", reason: secret } }, "VIDEO_UNAVAILABLE"],
    [player([{ ...track(), kind: "NEW_UNKNOWN_KIND" }]), "TRANSCRIPT_FORMAT_CHANGED"],
  ] as const)("distinguishes player failures without copying upstream reasons %#", async (data, code) => {
    const { result, calls } = await run([watch(), Response.json(data)]);
    failure(result, code);
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["watch", 401, "TRANSCRIPT_SOURCE_BLOCKED"], ["watch", 403, "TRANSCRIPT_SOURCE_BLOCKED"],
    ["watch", 429, "TRANSCRIPT_SOURCE_BLOCKED"], ["watch", 404, "VIDEO_UNAVAILABLE"],
    ["watch", 503, "VIDEO_METADATA_FETCH_FAILED"], ["player", 403, "TRANSCRIPT_SOURCE_BLOCKED"],
    ["player", 429, "TRANSCRIPT_SOURCE_BLOCKED"], ["player", 500, "TRANSCRIPT_FETCH_FAILED"],
    ["timed_text", 401, "CAPTION_TRACK_FORBIDDEN"], ["timed_text", 403, "CAPTION_TRACK_FORBIDDEN"],
    ["timed_text", 429, "CAPTION_TRACK_RATE_LIMITED"], ["timed_text", 503, "TRANSCRIPT_FETCH_FAILED"],
    ["timed_text", 404, "TRANSCRIPT_FETCH_FAILED"],
  ] as const)("classifies %s HTTP %s without automatic retry", async (stage, status, code) => {
    const steps = stage === "watch" ? [] : stage === "player" ? [watch()] : [watch(), Response.json(player())];
    steps.push(new Response(`${canary} ${secret}`, { status, headers: { "Content-Type": `text/plain; secret=${secret}` } }));
    const { result, calls } = await run(steps);
    failure(result, code);
    expect(result.diagnostic).toMatchObject({ stage, httpStatus: status, reason: "http", responseBytes: 0 });
    expect(calls).toHaveLength(steps.length);
  });

  it.each(["watch", "player", "timed_text"])("does not follow %s redirects or echo Location", async (stage) => {
    const steps = stage === "watch" ? [] : stage === "player" ? [watch()] : [watch(), Response.json(player())];
    steps.push(new Response(null, { status: 302, headers: { Location: `https://127.0.0.1/?token=${secret}` } }));
    const { result, calls } = await run(steps);
    failure(result, "TRANSCRIPT_SOURCE_BLOCKED");
    expect(result.diagnostic.reason).toBe("redirect");
    expect(calls).toHaveLength(steps.length);
  });

  it.each([
    "https://evil.example/api/timedtext", "http://www.youtube.com/api/timedtext",
    "https://user:password@www.youtube.com/api/timedtext", "https://www.youtube.com:444/api/timedtext",
    "https://www.youtube.com/redirect", "https://www.youtube.com/api/timedtext#secret",
  ])("refuses unsafe selected track origin/path before fetch: %s", async (url) => {
    const unsafe = { ...track(), baseUrl: `${url}${url.includes("#") ? "" : `?v=${videoId}&lang=ko`}` };
    const { result, calls } = await run([watch(), Response.json(player([unsafe]))]);
    failure(result, "TRANSCRIPT_FORMAT_CHANGED");
    expect(result.diagnostic.reason).toBe("unsafe_track");
    expect(calls).toHaveLength(2);
  });

  it.each(["&v=OTHERONLY01", "&lang=en", "&tlang=ko", "&kind=asr", "&fmt=vtt&fmt=json3"])("rejects track identity/translation ambiguity: %s", async (suffix) => {
    const { result, calls } = await run([watch(), Response.json(player([{ ...track(), baseUrl: track().baseUrl + suffix }]))]);
    failure(result, "TRANSCRIPT_FORMAT_CHANGED");
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["", "CAPTION_TRACK_EMPTY"], [" ", "CAPTION_TRACK_EMPTY"],
    [JSON.stringify({ wireMagic: "pb3", events: [] }), "CAPTION_TRACK_EMPTY"],
    [JSON.stringify({ wireMagic: "pb3", events: [{ tStartMs: 0, segs: [{ utf8: "\n" }] }] }), "CAPTION_TRACK_EMPTY"],
    [canary, "TRANSCRIPT_FORMAT_CHANGED"],
    [JSON.stringify({ wireMagic: "new", events: [] }), "TRANSCRIPT_FORMAT_CHANGED"],
    [JSON.stringify({ wireMagic: "pb3", events: [{ tStartMs: 0, segs: [{ utf8: canary }] }] }), "TRANSCRIPT_FORMAT_CHANGED"],
    [JSON.stringify({ wireMagic: "pb3", events: [{ tStartMs: -1, dDurationMs: 2, segs: [{ utf8: canary }] }] }), "TRANSCRIPT_FORMAT_CHANGED"],
    [JSON.stringify({ wireMagic: "pb3", events: [{ tStartMs: 0, dDurationMs: -2, segs: [{ utf8: canary }] }] }), "TRANSCRIPT_FORMAT_CHANGED"],
    [JSON.stringify({ wireMagic: "pb3", events: [{ tStartMs: "1", dDurationMs: 2, segs: [{ utf8: canary }] }] }), "TRANSCRIPT_FORMAT_CHANGED"],
    [JSON.stringify({ wireMagic: "pb3", events: [{ tStartMs: 0, unknownText: canary }] }), "TRANSCRIPT_FORMAT_CHANGED"],
    [JSON.stringify({ wireMagic: "pb3", events: [2, 1].map((tStartMs) => ({ tStartMs, dDurationMs: 1, segs: [{ utf8: canary }] })) }), "TRANSCRIPT_FORMAT_CHANGED"],
  ] as const)("fails empty/malformed segments atomically without partial private data %#", async (body, code) => {
    const { result } = await run([watch(), Response.json(player()), new Response(body, { headers: { "Content-Type": "application/json" } })]);
    failure(result, code);
  });

  it("treats unknown player HTML/schema as format change or missing, not no captions", async () => {
    failure((await run([new Response(canary, { headers: { "Content-Type": "text/html" } })])).result, "PLAYER_RESPONSE_MISSING");
    failure((await run([watch(), new Response("", { headers: { "Content-Type": "application/json" } })])).result, "PLAYER_RESPONSE_MISSING");
    failure((await run([watch(), Response.json({ reason: secret })])).result, "TRANSCRIPT_FORMAT_CHANGED");
    failure((await run([watch(), new Response(`<html>${canary}</html>`, { headers: { "Content-Type": "text/html" } })])).result, "TRANSCRIPT_FORMAT_CHANGED");
    for (const markup of ['<div class="g-recaptcha">', '<form action="https://consent.youtube.com/s">']) {
      failure((await run([new Response(markup + canary, { headers: { "Content-Type": "text/html" } })])).result, "TRANSCRIPT_SOURCE_BLOCKED");
    }
  });

  it("bounds streamed response bytes and cancels the body without trusting Content-Length", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(2_097_153).fill(65)); }, cancel,
    }), { headers: { "Content-Type": "text/html", "Content-Length": "1" } });
    const { result } = await run([response]);
    failure(result, "TRANSCRIPT_FORMAT_CHANGED");
    expect(result.diagnostic.reason).toBe("size_limit");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects invalid UTF-8 instead of silently replacing caption text", async () => {
    const { result } = await run([watch(), Response.json(player()), new Response(new Uint8Array([0xff]), { headers: { "Content-Type": "application/json" } })]);
    failure(result, "TRANSCRIPT_FORMAT_CHANGED");
  });

  it("contains network exceptions, rejected body reads and logs no private values", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    try {
      for (const step of [
        async () => { throw new Error(`${canary} ${secret}`, { cause: { Authorization: secret } }); },
        new Response(new ReadableStream({ start(controller) { controller.error(new Error(secret)); } })),
      ]) failure((await run([step])).result, "TRANSCRIPT_NETWORK_FAILED");
      expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    } finally { log.mockRestore(); error.mockRestore(); warn.mockRestore(); }
  });

  it("times out header fetch even when transport ignores abort", async () => {
    const { result, calls } = await run([() => new Promise<Response>(() => {})], { video: videoId }, 10);
    failure(result, "TRANSCRIPT_TIMEOUT");
    expect(calls[0]!.init?.signal?.aborted).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("times out a stalled body and cancels it", async () => {
    const cancel = vi.fn();
    const { result } = await run([new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "text/html" } })], { video: videoId }, 10);
    failure(result, "TRANSCRIPT_TIMEOUT");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("exposes only bounded title and published date to the admin inspection path, including caption failure", async () => {
    const video = { ...player(), microformat: { playerMicroformatRenderer: { publishDate: "2026-09-21" } } };
    const available = transport([watch(), Response.json(video), Response.json(timedText())]);
    const provider = createAccountlessPublicTranscriptProvider({ fetcher: available.fetcher });
    const inspected = await provider.inspectVideo({ video: videoId });
    expect(inspected.video).toEqual({ videoId, title: "TEST_ONLY_PRIVATE_TITLE", publishedDate: "2026-09-21" });
    expect(inspected.result.outcome).toBe("fetched");

    const missing = transport([watch(), Response.json({ ...video, captions: undefined })]);
    const noCaptions = await createAccountlessPublicTranscriptProvider({ fetcher: missing.fetcher }).inspectVideo({ video: videoId });
    expect(noCaptions.video).toEqual(inspected.video);
    expect(noCaptions.result.outcome).toBe("failed");
    if (noCaptions.result.outcome === "failed") expect(noCaptions.result.code).toBe("TRANSCRIPTS_DISABLED");
    expect(JSON.stringify(noCaptions.result)).not.toContain("TEST_ONLY_PRIVATE_TITLE");
  });

  it("uses the existing watch player for metadata and captions with no extra player POST", async () => {
    const value = { ...player(), videoDetails: { videoId, title: 'TEST_ONLY_PRIVATE_TITLE } " { \\ text' },
      microformat: { playerMicroformatRenderer: { publishDate: "2026-09-27" } } };
    const response = new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify(value)}; var other = {};</script>`, { headers: { "Content-Type": "text/html" } });
    const mock = transport([response, Response.json(timedText())]);
    const inspected = await createAccountlessPublicTranscriptProvider({ fetcher: mock.fetcher }).inspectVideo({ video: videoId });
    expect(inspected.result.outcome).toBe("fetched");
    expect(inspected.video).toEqual({ videoId, title: value.videoDetails.title, publishedDate: "2026-09-27" });
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[1]?.url).toContain("/api/timedtext?");
    expect(mock.calls.some(call => call.init?.method === "POST")).toBe(false);
  });

  it("preserves matching metadata on an embedded challenge and stops without extra requests", async () => {
    const value = { ...player(), playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you're not a bot" } };
    const response = new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify(value)};</script>`, { headers: { "Content-Type": "text/html" } });
    const mock = transport([response]);
    const inspected = await createAccountlessPublicTranscriptProvider({ fetcher: mock.fetcher }).inspectVideo({ video: videoId });
    failure(inspected.result, "TRANSCRIPT_SOURCE_BLOCKED");
    expect(inspected.video).toEqual({ videoId, title: "TEST_ONLY_PRIVATE_TITLE", publishedDate: null });
    expect(mock.calls).toHaveLength(1);
  });

  it.each([
    'var ytInitialPlayerResponse = {"playabilityStatus":',
    'var ytInitialPlayerResponse = function () { throw new Error("should never execute"); };',
    `var ytInitialPlayerResponse = ${JSON.stringify({ ...player(), videoDetails: { videoId: "OTHERONLY01", title: secret } })};`,
  ])("rejects invalid embedded player JSON or another video without a fallback request %#", async html => {
    const { result, calls } = await run([new Response(`<script>${html}</script>`, { headers: { "Content-Type": "text/html" } })]);
    failure(result, "TRANSCRIPT_FORMAT_CHANGED");
    expect(calls).toHaveLength(1);
  });

  it("strict diagnostics reject extras and arbitrary upstream strings", () => {
    expect(transcriptDiagnosticSchema.safeParse({ signedUrl: secret }).success).toBe(false);
    expect(() => createAccountlessPublicTranscriptProvider({ fetcher: transport([]).fetcher, timeoutMs: Infinity })).toThrow("INVALID_TRANSCRIPT_SPIKE_TIMEOUT");
  });
});

describe("blocked preview independent public title", () => {
  const blocked = () => new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify({
    playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you're not a bot" },
  })};</script>`, { headers: { "Content-Type": "text/html" } });
  const metadata = (title = "260927 주일예배 - 합성 제목(시편 147:1~20)") => ({
    type: "video", version: "1.0", provider_name: "YouTube", title,
    html: '<iframe src="https://untrusted.invalid/private"></iframe>', author_name: "TEST_ONLY_AUTHOR",
  });

  it("keeps the caption challenge while filling only the oEmbed title without private embed fields", async () => {
    const mock = transport([blocked(), Response.json(metadata())]);
    const inspected = await createAccountlessPublicTranscriptProvider({ fetcher: mock.fetcher })
      .inspectVideo({ video: `https://youtu.be/${videoId}?si=TEST_ONLY_TRACKING` });
    expect(inspected.video).toEqual({ videoId, title: metadata().title, publishedDate: null });
    failure(inspected.result, "TRANSCRIPT_SOURCE_BLOCKED");
    expect(inspected.result.diagnostic).toMatchObject({ stage: "player", reason: "challenge", contentType: "html" });
    expect(mock.calls).toHaveLength(2);
    const request = mock.calls[1]!;
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe("https://www.youtube.com/oembed");
    expect([...url.searchParams]).toEqual([["url", `https://www.youtube.com/watch?v=${videoId}`], ["format", "json"]]);
    expect(request.init).toMatchObject({ redirect: "manual" });
    expect(request.init?.headers).toBeUndefined();
    expect(JSON.stringify(inspected)).not.toContain("untrusted.invalid");
    expect(JSON.stringify(inspected)).not.toContain("TEST_ONLY_AUTHOR");
  });

  it.each([
    () => new Response(null, { status: 403 }),
    () => new Response(null, { status: 302, headers: { Location: "https://untrusted.invalid" } }),
    () => new Response("<html>challenge</html>", { headers: { "Content-Type": "text/html" } }),
    () => Response.json(metadata("bad\u0000title")),
    () => Response.json({ ...metadata(), title: undefined }),
    () => Response.json({ ...metadata(), html: "x".repeat(16_384) }),
  ])("does not hide the original caption error when metadata is unavailable or unsafe %#", async response => {
    const mock = transport([blocked(), response()]);
    const inspected = await createAccountlessPublicTranscriptProvider({ fetcher: mock.fetcher }).inspectVideo({ video: videoId });
    expect(inspected.video).toBeNull();
    failure(inspected.result, "TRANSCRIPT_SOURCE_BLOCKED");
    expect(mock.calls).toHaveLength(2);
  });

  it("bounds a stalled metadata body and cancels it without retrying the captions", async () => {
    const cancel = vi.fn();
    const mock = transport([blocked(), new Response(new ReadableStream({ cancel }), {
      headers: { "Content-Type": "application/json" },
    })]);
    const inspected = await createAccountlessPublicTranscriptProvider({ fetcher: mock.fetcher, timeoutMs: 30 }).inspectVideo({ video: videoId });
    expect(inspected.video).toBeNull();
    failure(inspected.result, "TRANSCRIPT_SOURCE_BLOCKED");
    expect(mock.calls[1]!.init?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(mock.calls).toHaveLength(2);
  });

  it("does not make a metadata request during caption import or for an invalid preview", async () => {
    const mock = transport([blocked()]);
    const provider = createAccountlessPublicTranscriptProvider({ fetcher: mock.fetcher });
    failure(await provider.fetchTranscript({ video: videoId }), "TRANSCRIPT_SOURCE_BLOCKED");
    const invalid = await provider.inspectVideo({ video: "invalid" });
    failure(invalid.result, "INVALID_YOUTUBE_URL");
    expect(mock.calls).toHaveLength(1);
  });
});
