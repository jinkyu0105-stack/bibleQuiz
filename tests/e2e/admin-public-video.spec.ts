import { expect, test } from "@playwright/test";
import { adminPublicVideoPreviewSchema } from "../../shared/api/admin-public-video";
import { draftMetadataViewSchema } from "../../shared/api/admin-sermon-drafts";
import { parseBibleReference } from "../../shared/bible-reference";

test("administrator confirms fetched video fields and imports public captions after a visible paste fallback", async ({ page }) => {
  const reference = parseBibleReference("요한복음 3:16");
  if (!reference.ok) throw new Error("synthetic reference");
  const draft = draftMetadataViewSchema.parse({
    sermonId: "video-sermon", quizSetId: "video-quiz", youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    metadataRevision: 1, title: "합성 영상 제목", sermonDate: "2026-09-20",
    bibleReference: reference.value, referenceLabel: reference.value.canonicalLabel, slugPreview: "2026-09-20-abc234",
  });
  const preview = adminPublicVideoPreviewSchema.parse({
    outcome: "inspected", videoId: "abcdefghijk", title: "260920 합성 영상 제목", publishedDate: "2026-09-21",
    caption: { status: "available", language: "ko", generated: false, segmentCount: 1, characterCount: 9 },
  });
  let registered = false, imported = false, attempts = 0;
  await page.route("**/api/admin/sermon-drafts**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/video-preview")) return route.fulfill({ json: { data: preview } });
    if (request.method() === "POST") { registered = true; return route.fulfill({ json: { data: { outcome: "created", sermonId: draft.sermonId, destination: "draft" } } }); }
    if (path.endsWith("/sermon-drafts")) return route.fulfill({ json: { data: { items: registered ? [{
      sermonId: draft.sermonId, quizSetId: draft.quizSetId, title: draft.title, sermonDate: draft.sermonDate,
      status: "draft", expired: false,
    }] : [] } } });
    return route.fulfill({ json: { data: draft } });
  });
  const timed = {
    version: 1, sourceType: "caption_timed", sourceId: "source-1", documentId: "source-1",
    documentSha256: "a".repeat(64), confirmationId: null,
    source: { sourceMode: "public_unofficial", videoId: "abcdefghijk", language: "ko", trackId: ".ko",
      generated: false, retrievedAt: "2026-09-23T00:00:00.000Z", providerId: "accountless-youtube-spike", providerVersion: "0.1.0" },
    content: { format: "timed_segments", segments: [{ segmentId: "segment-1", text: "합성 공개 자막", start: 0.1, duration: 1 }] },
  };
  const history = {
    head: { version: 1, sourceType: "caption_timed", sourceId: "source-1", documentId: "source-1", confirmationId: null },
    events: [{ eventId: "source-1", version: 1, kind: "source", documentId: "source-1",
      parentDocumentId: null, relatedId: null, createdAt: "2026-09-23T00:00:00.000Z" }],
  };
  await page.route("**/api/admin/sermons/video-sermon/input**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/public-captions")) {
      attempts++;
      if (attempts === 1) return route.fulfill({ json: { data: { outcome: "failed", code: "KOREAN_TRANSCRIPT_NOT_FOUND",
        message: "공개 자막은 있지만 한국어 자막을 찾지 못했습니다.", fallback: "manual_paste",
        diagnostic: { providerId: "accountless-youtube-spike", providerVersion: "0.1.0", attempt: 1,
          startedAt: "2026-09-23T00:00:00.000Z", elapsedMs: 3, stage: "tracks", reason: "no_korean",
          httpStatus: 200, contentType: "json", responseBytes: 32, trackCount: 1, selectedTrack: null,
          timeline: [{ stage: "tracks", elapsedMs: 3 }] } } } });
      imported = true;
      return route.fulfill({ json: { data: { outcome: "imported" } } });
    }
    if (path.endsWith("/history")) return route.fulfill({ json: { data: { history: imported ? history : null } } });
    return route.fulfill({ json: { data: { input: imported ? timed : null } } });
  });
  await page.goto("/admin/tools");
  const drafts = page.getByRole("region", { name: "설교 작업 선택", exact: true });
  await drafts.getByRole("button", { name: "새 설교 등록" }).click();
  await drafts.getByLabel("YouTube 영상 링크").fill("https://youtu.be/abcdefghijk");
  await drafts.getByRole("button", { name: "영상 정보·공개 자막 확인" }).click();
  await expect(drafts.getByLabel("설교 제목", { exact: true })).toHaveValue(draft.title);
  await expect(drafts.getByLabel("설교 일자(주일)")).toHaveValue("2026-09-20");
  await expect(drafts.getByText(/게시일: 2026-09-21/)).toBeVisible();
  await drafts.getByLabel("성경 장절", { exact: true }).fill("요 3:16");
  await drafts.getByLabel("제목·설교일·성경 장절을 확인했습니다.").check();
  await drafts.getByRole("button", { name: "새 작업 등록", exact: true }).click();
  const captions = page.getByRole("region", { name: "공개 자막 가져오기" });
  await expect(captions).toBeVisible();
  await captions.getByRole("button", { name: "공개 자막 가져와 원본 저장" }).click();
  await expect(captions.getByRole("alert")).toContainText("텍스트를 직접 붙여넣어 주세요.");
  await expect(page.getByLabel("입력자료 본문")).toBeVisible();
  await expect(captions.getByText("기술 정보")).toBeVisible();
  await captions.getByRole("button", { name: "공개 자막 가져와 원본 저장" }).click();
  await expect(page.getByRole("heading", { name: "시간 정보가 있는 자막" })).toBeVisible();
  await expect(page.getByText("공개 자막 원본을 저장했습니다")).toBeVisible();
  expect(attempts).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test("new video inspection automatically fills registration fields and clears the previous passage on a different video", async ({ page }) => {
  let inspections = 0;
  let registration: Record<string, unknown> | null = null;
  await page.route("**/api/admin/sermon-drafts**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/video-preview")) {
      inspections++;
      return route.fulfill({ json: { data: {
        outcome: "inspected", videoId: "abcdefghijk",
        title: inspections === 1 ? "260927 주일예배 - 합성 자동 등록 제목(시편 147:1~20)" : "261004 주일예배 - 다른 합성 제목",
        publishedDate: null,
        caption: { status: "available", language: "ko", generated: true, segmentCount: 1, characterCount: 10 },
      } } });
    }
    if (request.method() === "POST") {
      registration = request.postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 409, json: { error: { message: "합성 등록 내용 확인" } } });
    }
    return route.fulfill({ json: { data: { items: [] } } });
  });
  await page.route("**/api/admin/dashboard", route => route.fulfill({ json: { data: { items: [], unansweredCount: 0 } } }));
  await page.goto("/admin/new");
  const form = page.getByRole("region", { name: "설교 작업 선택", exact: true });
  await form.getByLabel("YouTube 영상 링크").fill("https://youtu.be/abcdefghijk");
  await form.getByRole("button", { name: "영상 정보·공개 자막 확인", exact: true }).click();
  await expect(form.getByLabel("설교 제목", { exact: true })).toHaveValue("합성 자동 등록 제목");
  await expect(form.getByLabel("설교 일자(주일)")).toHaveValue("2026-09-27");
  await expect(form.getByLabel("성경 장절", { exact: true })).toHaveValue("시편 147:1–20");
  await expect(form.getByRole("combobox", { name: "성경 책", exact: true })).toHaveValue("PSA");
  await expect(form.getByRole("combobox", { name: "장", exact: true })).toHaveValue("147");
  await expect(form.getByRole("combobox", { name: "시작 절", exact: true })).toHaveValue("1");
  await expect(form.getByRole("combobox", { name: "끝 절", exact: true })).toHaveValue("20");
  await expect(form.getByLabel("제목·설교일·성경 장절을 확인했습니다.")).not.toBeChecked();
  await form.getByLabel("제목·설교일·성경 장절을 확인했습니다.").check();
  await form.getByRole("button", { name: "새 작업 등록", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("합성 등록 내용 확인");
  expect(registration).toMatchObject({ title: "합성 자동 등록 제목", sermonDate: "2026-09-27", referenceInput: "시편 147:1–20", confirmed: true });
  await form.getByLabel("YouTube 영상 링크").fill("https://youtu.be/lmnopqrstuv");
  await form.getByRole("button", { name: "영상 정보·공개 자막 확인", exact: true }).click();
  await expect(form.getByLabel("성경 장절", { exact: true })).toHaveValue("");
  await expect(form.getByRole("combobox", { name: "성경 책", exact: true })).toHaveValue("");
  await expect(form.getByLabel("제목·설교일·성경 장절을 확인했습니다.")).toBeDisabled();
  await expect(form.getByRole("button", { name: "새 작업 등록", exact: true })).toBeDisabled();
  expect(inspections).toBe(2);
});

test("blocked captions still allow automatic title date passage and registration without claiming a saved source", async ({ page }) => {
  let inspections = 0;
  let registration: Record<string, unknown> | null = null;
  await page.route("**/api/admin/sermon-drafts**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/video-preview")) {
      inspections++;
      return route.fulfill({ json: { data: {
        outcome: "inspected", videoId: "abcdefghijk", title: "260927 주일예배 - 합성 제목(시편 147:1~20)", publishedDate: null,
        caption: { status: "unavailable", code: "TRANSCRIPT_SOURCE_BLOCKED", message: "YouTube가 현재 서버의 자막 요청을 차단했습니다.", fallback: "manual_paste",
          diagnostic: { providerId: "accountless-youtube-spike", providerVersion: "0.1.0", attempt: 1,
            startedAt: "2026-10-03T00:00:00.000Z", elapsedMs: 10, stage: "player", reason: "challenge", httpStatus: 200,
            contentType: "html", responseBytes: 300, trackCount: null, selectedTrack: null,
            timeline: [{ stage: "watch", elapsedMs: 10 }, { stage: "player", elapsedMs: 0 }] } },
      } } });
    }
    if (request.method() === "POST") {
      registration = request.postDataJSON() as Record<string, unknown>;
      return route.fulfill({ status: 409, json: { error: { message: "합성 등록 내용 확인" } } });
    }
    return route.fulfill({ json: { data: { items: [] } } });
  });
  await page.route("**/api/admin/dashboard", route => route.fulfill({ json: { data: { items: [], unansweredCount: 0 } } }));
  await page.goto("/admin/new");
  const form = page.getByRole("region", { name: "설교 작업 선택", exact: true });
  await form.getByLabel("YouTube 영상 링크").fill("https://youtu.be/abcdefghijk");
  await form.getByRole("button", { name: "영상 정보·공개 자막 확인", exact: true }).click();
  await expect(form.getByLabel("설교 제목", { exact: true })).toHaveValue("합성 제목");
  await expect(form.getByLabel("설교 일자(주일)")).toHaveValue("2026-09-27");
  await expect(form.getByLabel("성경 장절", { exact: true })).toHaveValue("시편 147:1–20");
  await expect(form.getByRole("combobox", { name: "성경 책", exact: true })).toHaveValue("PSA");
  await expect(form.getByRole("combobox", { name: "장", exact: true })).toHaveValue("147");
  await expect(form.getByRole("combobox", { name: "끝 절", exact: true })).toHaveValue("20");
  await expect(form.getByText("영상 기본 정보는 확인했지만, 자막 원본은 아직 가져오지 못했습니다.")).toBeVisible();
  await expect(form.getByText(/반복 조회해도 계속 차단될 수 있습니다/)).toBeVisible();
  await expect(form.getByRole("button", { name: "새 작업 등록", exact: true })).toBeDisabled();
  await form.getByLabel("제목·설교일·성경 장절을 확인했습니다.").check();
  await form.getByRole("button", { name: "새 작업 등록", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("합성 등록 내용 확인");
  expect(registration).toMatchObject({ title: "합성 제목", sermonDate: "2026-09-27", referenceInput: "시편 147:1–20", confirmed: true });
  expect(inspections).toBe(1);
});
