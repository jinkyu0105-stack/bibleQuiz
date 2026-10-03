import { env, exports } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { transcriptFailureMessages, transcriptProvider, type AccountlessTranscriptResult } from "../_shared/services/accountless-transcript-contract";
import type { AccountlessPublicTranscriptProvider } from "../_shared/services/accountless-youtube-transcript";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { importPublicSermonCaptions, previewPublicSermonVideo } from "../_shared/services/public-sermon-video";
import { registerSermonDraft } from "../_shared/services/sermon-drafts";
import { sha256Bytes } from "../_shared/storage/sha256";
import { createAccessFixture } from "./test/access-fixture";

const db = (env as Env).DB;
const actor = "synthetic-video-admin@example.invalid";
const videoId = "TESTVIDEO01";
const fields = { title: "직접 입력 제목", sermonDate: "2026-09-20", referenceInput: "요한복음 3:16", confirmed: true };
const diagnostic = {
  providerId: transcriptProvider.id, providerVersion: transcriptProvider.version,
  attempt: 1 as const, startedAt: "2026-09-23T00:00:00.000Z", elapsedMs: 2,
  stage: "parse" as const, reason: "none" as const, httpStatus: 200,
  contentType: "json" as const, responseBytes: 64, trackCount: 1, selectedTrack: "manual" as const,
  timeline: [{ stage: "parse" as const, elapsedMs: 2 }],
};
async function transcript(id = videoId, segments = [{ text: "합성 공개 자막 첫 구간", start: 0, duration: 1 }]) {
  return {
    sourceMode: "public_unofficial" as const, videoId: id, language: "ko" as const,
    trackId: ".ko", generated: false, retrievedAt: "2026-09-23T00:00:00.000Z",
    providerId: transcriptProvider.id, providerVersion: transcriptProvider.version,
    sourceSha256: await sha256Bytes(new TextEncoder().encode(JSON.stringify(segments))), segments,
  };
}
function provider(result: AccountlessTranscriptResult): AccountlessPublicTranscriptProvider {
  return {
    descriptor: transcriptProvider,
    inspectVideo: vi.fn(async () => ({
      video: { videoId, title: "260920 합성 영상 제목", publishedDate: "2026-09-21" },
      result,
    })),
    fetchTranscript: vi.fn(async () => result),
  };
}
afterEach(() => vi.restoreAllMocks());

it("previews without writing, skips duplicate fetch, imports the immutable timed source and requires human confirmation", async () => {
  const source = await transcript();
  const fake = provider({ outcome: "fetched", transcript: source, diagnostic });
  const preview = await previewPublicSermonVideo(db, { video: videoId }, fake);
  expect(preview).toMatchObject({ outcome: "inspected", title: "260920 합성 영상 제목", publishedDate: "2026-09-21",
    caption: { status: "available", segmentCount: 1 } });
  expect(JSON.stringify(preview)).not.toContain(source.segments[0]!.text);
  expect(await db.prepare("SELECT id FROM sermons WHERE youtube_video_id=?").bind(videoId).first()).toBeNull();

  const registered = await registerSermonDraft(db, { video: videoId, ...fields }, actor);
  expect((await previewPublicSermonVideo(db, { video: videoId }, fake))).toMatchObject({
    outcome: "existing", sermonId: registered.sermonId, destination: "draft",
  });
  expect(fake.inspectVideo).toHaveBeenCalledTimes(1);
  expect(await importPublicSermonCaptions(db, registered.sermonId, { expectedVersion: 0 }, actor, fake)).toEqual({ outcome: "imported" });
  const service = createSermonInputService(createSermonInputStore(db));
  const loaded = await service.current(registered.sermonId);
  expect(loaded.outcome).toBe("loaded");
  if (loaded.outcome !== "loaded" || !loaded.input) return;
  expect(loaded.input).toMatchObject({ sourceType: "caption_timed", confirmationId: null,
    source: { sourceMode: "public_unofficial", videoId }, content: { format: "timed_segments" } });
  const current = loaded.input;
  const confirmed = await service.execute(registered.sermonId, {
    action: "confirm", expectedVersion: current.version, sourceId: current.sourceId,
    documentId: current.documentId, documentSha256: current.documentSha256, reviewed: true,
  }, { kind: "human", adminId: "synthetic", now: "2026-09-23T00:01:00.000Z" });
  expect(confirmed.outcome).toBe("saved");
  await expect(importPublicSermonCaptions(db, registered.sermonId, { expectedVersion: 0 }, actor, fake))
    .rejects.toMatchObject({ code: "VIDEO_CONFLICT" });
  expect(fake.fetchTranscript).toHaveBeenCalledTimes(1);
});

it("preserves a blank input on provider failure, wrong video and over-30,000-character source", async () => {
  const registered = await registerSermonDraft(db, { video: crypto.randomUUID().replaceAll("-", "").slice(0, 11), ...fields }, actor);
  const failed = provider({ outcome: "failed", code: "KOREAN_TRANSCRIPT_NOT_FOUND",
    message: transcriptFailureMessages.KOREAN_TRANSCRIPT_NOT_FOUND, fallback: "manual_paste",
    diagnostic: { ...diagnostic, reason: "no_korean", stage: "tracks" } });
  const unavailable = await importPublicSermonCaptions(db, registered.sermonId, { expectedVersion: 0 }, actor, failed);
  expect(unavailable).toMatchObject({ outcome: "failed", fallback: "manual_paste", code: "KOREAN_TRANSCRIPT_NOT_FOUND" });
  expect(await createSermonInputStore(db).head(registered.sermonId)).toBeNull();

  const id = new URL((await db.prepare("SELECT youtube_url FROM sermons WHERE id=?").bind(registered.sermonId).first<{ youtube_url: string }>())!.youtube_url).searchParams.get("v")!;
  const wrong = provider({ outcome: "fetched", transcript: await transcript("OTHERONLY01"), diagnostic });
  await expect(importPublicSermonCaptions(db, registered.sermonId, { expectedVersion: 0 }, actor, wrong))
    .rejects.toMatchObject({ code: "VIDEO_INVALID" });
  expect(await createSermonInputStore(db).head(registered.sermonId)).toBeNull();

  const oversized = provider({ outcome: "fetched", transcript: await transcript(id, [
    { text: "가".repeat(15_001), start: 0, duration: 1 },
    { text: "나".repeat(15_000), start: 1, duration: 1 },
  ]), diagnostic });
  await expect(importPublicSermonCaptions(db, registered.sermonId, { expectedVersion: 0 }, actor, oversized))
    .rejects.toMatchObject({ code: "VIDEO_TOO_LARGE" });
  expect(await createSermonInputStore(db).head(registered.sermonId)).toBeNull();
});

it("Access route uses only synthetic YouTube responses and keeps captions out of the preview", async () => {
  const fixture = await createAccessFixture(new Date());
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 11);
  const canary = "TEST_ONLY_PRIVATE_CAPTION";
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = String(input);
    if (url.startsWith("https://test-team.cloudflareaccess.com/")) return Response.json(fixture.jwks);
    if (url.startsWith("https://www.youtube.com/watch?")) return new Response('<script>{"INNERTUBE_API_KEY":"TEST_ONLY_KEY"}</script>', { headers: { "Content-Type": "text/html" } });
    if (url.startsWith("https://www.youtube.com/youtubei/v1/player?")) return Response.json({
      playabilityStatus: { status: "OK" }, videoDetails: { videoId: id, title: "260920 합성 영상" },
      microformat: { playerMicroformatRenderer: { publishDate: "2026-09-21" } },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{
        baseUrl: "https://www.youtube.com/api/timedtext?v=" + id + "&lang=ko",
        languageCode: "ko", vssId: ".ko",
      }] } },
    });
    if (url.startsWith("https://www.youtube.com/api/timedtext?")) return Response.json({
      wireMagic: "pb3", events: [{ tStartMs: 100, dDurationMs: 800, segs: [{ utf8: canary }] }],
    });
    throw new Error("external call forbidden");
  });
  const call = (path: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) =>
    exports.default.fetch(new Request("https://example.com/api/admin/" + path, {
      method, headers: { Origin: "https://example.com", "Content-Type": "application/json",
        "Cf-Access-Jwt-Assertion": fixture.token, ...extra },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
  expect((await call("sermon-drafts/video-preview", "POST", { video: id }, { "Cf-Access-Jwt-Assertion": "" })).status).toBe(401);
  expect((await call("sermon-drafts/video-preview", "POST", { video: id }, { Origin: "https://evil.invalid" })).status).toBe(403);
  expect((await call("sermon-drafts/video-preview", "GET")).status).toBe(405);
  expect((await call("sermon-drafts/video-preview?extra=1", "POST", { video: id })).status).toBe(400);
  const response = await call("sermon-drafts/video-preview", "POST", { video: id });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const preview = JSON.stringify(await response.json());
  expect(preview).toContain("260920 합성 영상");
  expect(preview).toContain("2026-09-21");
  expect(preview).not.toContain(canary);
  const registered = await call("sermon-drafts", "POST", { video: id, ...fields });
  const { data } = await registered.json() as { data: { sermonId: string } };
  const path = "sermons/" + data.sermonId + "/input/public-captions";
  expect((await call(path, "GET")).status).toBe(405);
  const imported = await call(path, "POST", { expectedVersion: 0 });
  expect(imported.status).toBe(200);
  expect(await imported.json()).toEqual({ data: { outcome: "imported" } });
  expect((await call(path, "POST", { expectedVersion: 0 })).status).toBe(409);
  const current = await (await call("sermons/" + data.sermonId + "/input")).json() as { data: { input: { content: { segments: { text: string }[] } } } };
  expect(current.data.input.content.segments[0]!.text).toBe(canary);
  expect(fetcher.mock.calls.filter(([url]) => String(url).startsWith("https://www.youtube.com/"))).toHaveLength(6);
});
