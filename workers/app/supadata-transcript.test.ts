import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { createPublicTranscriptProvider, createSupadataTranscriptProvider } from "../_shared/services/supadata-transcript";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { importPublicSermonCaptions, previewPublicSermonVideo } from "../_shared/services/public-sermon-video";
import { registerSermonDraft } from "../_shared/services/sermon-drafts";
import { requestCorrection, sendContentDispatch, runContentGeneration } from "../_shared/services/content-generation";
import { seedGenerationContext } from "./test/generation-storage-fixture";
import { app, type AppBindings } from "./app";
import { createAccessFixture } from "./test/access-fixture";

const db = (env as Env).DB;
const apiKey = "TEST_ONLY_SECRET";
const caption = "합성 비공개 자막";
const body = () => ({ lang: "ko", content: [{ text: caption, offset: 1_200, duration: 2_300, lang: "ko" }] });
const videoId = "TESTVIDEO01";
const make = (fetcher: typeof fetch, timeoutMs = 30_000) => createSupadataTranscriptProvider({ apiKey, fetcher, timeoutMs });
afterEach(() => vi.restoreAllMocks());

it("uses native canonical YouTube only and preserves source timing, hash and unknown track classification", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(body()));
  const result = await make(fetcher).fetchTranscript({ video: "https://youtu.be/" + videoId });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [request, init] = fetcher.mock.calls[0]!;
  const url = new URL(String(request));
  expect(url.origin + url.pathname).toBe("https://api.supadata.ai/v1/transcript");
  expect(Object.fromEntries(url.searchParams)).toEqual({ url: "https://www.youtube.com/watch?v=" + videoId, mode: "native", lang: "ko", text: "false" });
  expect(init).toMatchObject({ headers: { "x-api-key": apiKey }, redirect: "manual" });
  expect(result).toMatchObject({ outcome: "fetched", transcript: { videoId, providerId: "supadata-native", generated: null,
    trackId: "supadata-ko", segments: [{ text: caption, start: 1.2, duration: 2.3 }] } });
  expect(JSON.stringify(result)).not.toContain(apiKey);
  if (result.outcome === "fetched") expect(result.transcript.sourceSha256).toMatch(/^[0-9a-f]{64}$/u);
});

it.each(["https://example.invalid/file.mp4", "invalid", "https://youtube.com.evil.invalid/watch?v=" + videoId])("rejects non-video input before any external call: %s", async video => {
  const fetcher = vi.fn<typeof fetch>();
  expect(await make(fetcher).fetchTranscript({ video })).toMatchObject({ outcome: "failed", code: "INVALID_YOUTUBE_URL" });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([301, 401, 402, 403, 429, 500])("does not follow redirects, retry errors or leak upstream values: %s", async status => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ secret: apiKey, transcript: caption }, { status, headers: { Location: "https://evil.invalid" } }));
  const result = await make(fetcher).fetchTranscript({ video: videoId });
  expect(result.outcome).toBe("failed");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain(apiKey);
  expect(JSON.stringify(result)).not.toContain(caption);
});

it.each([
  { lang: "en", content: [{ text: caption, offset: 0, duration: 1, lang: "en" }] },
  { lang: "ko", content: [{ text: caption, offset: 0, duration: 1, lang: "en" }] },
  { lang: "ko", content: [] },
  { lang: "ko", content: [{ text: "   ", offset: 0, duration: 1, lang: "ko" }] },
  { lang: "ko", content: [{ text: caption, offset: 2, duration: 1, lang: "ko" }, { text: caption, offset: 1, duration: 1, lang: "ko" }] },
])("rejects unusable or other-language source without fallback", async invalid => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(invalid));
  expect((await make(fetcher).fetchTranscript({ video: videoId })).outcome).toBe("failed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("caps response size and 30,000 Unicode characters", async () => {
  const huge = make(async () => new Response('x'.repeat(1_048_577), { headers: { "Content-Type": "application/json" } }));
  expect(await huge.fetchTranscript({ video: videoId })).toMatchObject({ outcome: "failed", diagnostic: { reason: "size_limit" } });
  const long = make(async () => Response.json({ lang: "ko", content: [0, 1].map(n => ({ text: "가".repeat(15_001), offset: n, duration: 1, lang: "ko" })) }));
  expect(await long.fetchTranscript({ video: videoId })).toMatchObject({ code: "TRANSCRIPT_TOO_LARGE" });
});

it("stops stalled fetch and body reads at the total deadline", async () => {
  const stalledFetch = vi.fn<typeof fetch>(() => new Promise(() => {}));
  expect(await make(stalledFetch, 10).fetchTranscript({ video: videoId })).toMatchObject({ code: "TRANSCRIPT_TIMEOUT" });
  const cancel = vi.fn();
  const stalledBody = make(async () => new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } }), 10);
  expect(await stalledBody.fetchTranscript({ video: videoId })).toMatchObject({ code: "TRANSCRIPT_TIMEOUT" });
  expect(cancel).toHaveBeenCalled();
});

it("polls the same 202 job without issuing a second native request", async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ jobId: "test-job" }, { status: 202 }))
    .mockResolvedValueOnce(Response.json({ status: "completed", ...body() }));
  expect((await make(fetcher).fetchTranscript({ video: videoId })).outcome).toBe("fetched");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(String(fetcher.mock.calls[1]![0])).toBe("https://api.supadata.ai/v1/transcript/test-job");
});

it("does not fetch when an opted-in provider lacks a key or configuration is unknown", async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const value of ["supadata", "typo"]) {
    expect(await createPublicTranscriptProvider({ PUBLIC_TRANSCRIPT_PROVIDER: value }, fetcher).fetchTranscript({ video: videoId }))
      .toMatchObject({ code: "TRANSCRIPT_PROVIDER_UNAVAILABLE" });
  }
  expect(fetcher).not.toHaveBeenCalled();
  expect(createPublicTranscriptProvider({ SUPADATA_API_KEY: apiKey }, fetcher).descriptor.id).toBe("accountless-youtube-spike");
});

it("keeps title metadata independent, imports once and loads the new provenance from D1", async () => {
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 11);
  const fetcher = vi.fn<typeof fetch>(async input => String(input).startsWith("https://www.youtube.com/oembed")
    ? Response.json({ type: "video", version: "1.0", provider_name: "YouTube", title: "260927 주일예배 - 합성 제목(시편 147:1~20)" }) : Response.json(body()));
  const provider = make(fetcher);
  const preview = await previewPublicSermonVideo(db, { video: id }, provider);
  expect(preview).toMatchObject({ title: "260927 주일예배 - 합성 제목(시편 147:1~20)", caption: { status: "available", generated: null } });
  expect(JSON.stringify(preview)).not.toContain(caption);
  const { sermonId } = await registerSermonDraft(db, { video: id, title: "합성 제목", sermonDate: "2026-09-27", referenceInput: "시편 147:1~20", confirmed: true }, "synthetic@example.invalid");
  const calls = fetcher.mock.calls.length;
  expect(await previewPublicSermonVideo(db, { video: id }, provider)).toMatchObject({ outcome: "existing" });
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(await importPublicSermonCaptions(db, sermonId, { expectedVersion: 0 }, "synthetic@example.invalid", provider)).toEqual({ outcome: "imported" });
  expect(await createSermonInputService(createSermonInputStore(db)).current(sermonId)).toMatchObject({ outcome: "loaded", input: {
    source: { providerId: "supadata-native", generated: null }, content: { format: "timed_segments" }, confirmationId: null,
  } });
  await expect(importPublicSermonCaptions(db, sermonId, { expectedVersion: 0 }, "synthetic@example.invalid", provider)).rejects.toMatchObject({ code: "VIDEO_CONFLICT" });
  expect(fetcher).toHaveBeenCalledTimes(calls + 1);
});

it("accepts Supadata source through content generation using only a mocked AI response", async () => {
  const owner = await seedGenerationContext();
  const result = await make(async () => Response.json(body())).fetchTranscript({ video: videoId });
  if (result.outcome !== "fetched") throw Error("synthetic source");
  const service = createSermonInputService(createSermonInputStore(db));
  expect(await service.execute(owner.sermonId, { action: "import_source", expectedVersion: 0, payload: result.transcript },
    { adminId: "a".repeat(64), kind: "human", now: new Date().toISOString() })).toMatchObject({ outcome: "saved" });
  const requested = await requestCorrection(db, owner.sermonId, { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId, expectedInputVersion: 1 }, "a".repeat(64));
  await sendContentDispatch(db, { create: async () => ({ id: requested.jobId }) } as never, requested.dispatchId);
  const current = await service.current(owner.sermonId);
  if (current.outcome !== "loaded" || current.input?.content.format !== "timed_segments") throw Error("synthetic input");
  const draft = { format: "timed_segments", segments: current.input.content.segments.map(({ segmentId, text }) => ({ segmentId, text })) };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "synthetic", model: "gpt-5.6-terra", status: "completed",
    usage: { input_tokens: 10, output_tokens: 10 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft }) }] }] }));
  const generated = await runContentGeneration({ DB: db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic" },
    { dispatchId: requested.dispatchId }, requested.jobId, { fetch: fetcher });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(generated.outcome).toBe("saved");
});

it("selects Supadata in the authenticated app route while excluding raw captions and keys", async () => {
  const fixture = await createAccessFixture(new Date());
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 11);
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    if (String(input).startsWith("https://test-team.cloudflareaccess.com/")) return Response.json(fixture.jwks);
    if (String(input).startsWith("https://www.youtube.com/oembed")) return Response.json({ type: "video", version: "1.0", provider_name: "YouTube", title: "합성 제목" });
    if (String(input).startsWith("https://api.supadata.ai/v1/transcript?")) return Response.json(body());
    throw Error("unexpected external call");
  });
  const bindings = { ...env, PUBLIC_TRANSCRIPT_PROVIDER: "supadata", SUPADATA_API_KEY: apiKey } as unknown as AppBindings;
  const response = await app.request("https://example.com/api/admin/sermon-drafts/video-preview", {
    method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": fixture.token }, body: JSON.stringify({ video: id }),
  }, bindings);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain('"status":"available"');
  expect(text).not.toContain(caption); expect(text).not.toContain(apiKey);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes("youtubei"))).toBe(false);
});
