import { expect, test } from "@playwright/test";
import type { AdminContentView } from "../../shared/api/admin-content-generation";
import { searchCandidatePool } from "../../shared/puzzle/pool-search";
import { presentPlacement } from "../../workers/_shared/services/placement-presentation";
const hash = "a".repeat(64);
const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
const candidates = ["가나다", "라마바", "가사라", "다아바", "허호"].map((answer, i) => ({ id: `entry-${i + 1}`, displayAnswer: answer, gridAnswer: answer, clue: `합성 단서 ${i}`, status: "use" as const, phrase: "명사구" }));
const makeTrial = (settings: typeof options) => { const result = searchCandidatePool({ ...settings, candidates });
  return { layouts: result.layouts.map((layout, i) => presentPlacement(layout, i, candidates)), searchIncomplete: result.searchIncomplete,
    reasons: [...new Set(result.attempts.flatMap(a => a.reasons.map(r => r.message)))] }; };
for (const selected of [false, true]) test(`administrator publishes ${selected ? "selected" : "default"} layouts, retries one request and reloads its public link`, async ({ page }, testInfo) => {
  const layouts = makeTrial(options).layouts;
  const view: AdminContentView = { enabled: false, quizSetId: "quiz", jobId: "job", version: 12, status: "running", stage: "content_review",
    content: { state: "present", intent: { selectedId: "intent", rootAnalysisId: "intent", confirmation: { id: "confirmed-intent" } },
      summary: { id: "summary", review: { id: "rs" } }, child: { id: "child", review: { id: "rc" } }, adult: { id: "adult", review: { id: "ra" } } }, snapshots: [], historyCursor: null, regenerations: [],
    weekCostMicroUsd: 400000, weekUnknownCalls: 0, jobCostMicroUsd: 400000, jobUnknownCalls: 0,
    placement: { revision: 1, metadataRevision: 1, selected: false, current: false, selection: { child: { options, index: 0 }, adult: { options, index: 0 } } },
    reviewLayouts: { child: layouts[0]!, adult: layouts[0]! }, preview: { metadata: { title: "배치 검토용 합성 설교", date: "2026-09-20", bibleReferenceLabel: "요한복음 3:16", translation: "개역개정", bibleReadingUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php" },
      summary: { text: "첫 문단\n\n두 번째 문단", disclosure: "공개 자막을 바탕으로 AI가 요약한 것으로 설교자의 원문이 아닙니다." }, variants: { child: layouts[0]!.grid, adult: layouts[0]!.grid } } };

  view.status = "review_ready"; view.stage = "finish";
  view.placement!.selected = selected; view.placement!.current = true;
  view.quizCostMicroUsd = 520000; view.quizUnknownCalls = 1;
  await page.route("**/api/admin/sermons/sermon-1/input**", async route => {
    if (route.request().url().endsWith("/history")) return route.fulfill({ json: { data: { history: { head: { version: 2, sourceType: "caption_plain", sourceId: "source", documentId: "source", confirmationId: "confirmed" }, events: [
      { eventId: "source", version: 1, kind: "source", documentId: "source", parentDocumentId: null, relatedId: null, createdAt: "2026-09-22T00:00:00.000Z" },
      { eventId: "confirmed", version: 2, kind: "confirm", documentId: "source", parentDocumentId: "source", relatedId: null, createdAt: "2026-09-22T00:01:00.000Z" } ] } } } });
    return route.fulfill({ json: { data: { input: { version: 2, sourceType: "caption_plain", sourceId: "source", documentId: "source", documentSha256: hash,
      confirmationId: "confirmed", source: { sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript" }, content: { format: "plain_text", text: "합성 입력 자료" } } } } });
  });

  await page.route("**/api/admin/sermons/sermon-1/generation/**", route => route.fulfill({
    json: { data: route.request().url().endsWith("/correction") ? { enabled: false, quizSetId: "quiz", latestJobId: null } : view },
  }));
  const requests: unknown[] = [];
  await page.route("**/api/admin/quiz-sets/quiz/publish", async route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) return route.fulfill({ status: 503, json: { error: { code: "PUBLICATION_UNAVAILABLE",
      message: "저장 응답을 확인하지 못했습니다.", requestId: "11111111-1111-4111-8111-111111111111" } } });
    view.publication = { slug: "2026-09-20-abc123", publishedAt: "2026-09-22T00:00:00.000Z", closesAt: "2026-09-29T00:00:00.000Z" };
    view.status = "published"; view.stage = "published"; view.jobId = null; view.placement = null; view.preview = null; view.snapshots = [];
    return route.fulfill({ json: { data: { outcome: "replayed", quizSetId: "quiz", ...view.publication } } });
  });
  const load = async () => { await page.goto("/admin/tools"); await page.getByLabel("설교 ID").fill("sermon-1");
    await page.getByRole("button", { name: "입력자료 불러오기" }).click(); };
  await load();
  const launch = page.getByRole("button", { name: "지금 발행", exact: true });
  await expect(launch).toBeEnabled(); await launch.click();
  const dialog = page.getByRole("dialog", { name: "지금 발행 확인" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByRole("button")).toHaveCount(2);
  await expect(dialog.getByText(/USD 0.5200/)).toBeVisible();
  await expect(dialog.getByText(/사용량 미확인 1회/)).toBeVisible();
  await expect(dialog.getByText(/정확히 7일 뒤/)).toBeVisible();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(launch).toBeFocused();
  expect(requests).toHaveLength(0);
  await launch.click();
  await dialog.getByRole("button", { name: "취소" }).click();
  expect(requests).toHaveLength(0);
  await page.getByLabel("화면 테마").selectOption("dark"); await launch.click();
  await dialog.screenshot({ path: testInfo.outputPath("publication-dark.png") });
  await dialog.getByRole("button", { name: "지금 발행", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("같은 요청");
  await dialog.getByRole("button", { name: "지금 발행", exact: true }).click();
  await expect(page.getByRole("region", { name: "발행 완료" })).toBeVisible();
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).toMatchObject({ expectedVersion: 12, expectedMetadataRevision: 1, expectedSelectionRevision: 1, confirmation: "publish" });
  expect(JSON.stringify(requests)).not.toMatch(/solution|gridAnswer|cost|cells/u);
  await load();
  const done = page.getByRole("region", { name: "발행 완료" });
  await expect(done.getByRole("link", { name: "공개된 퀴즈 보기" })).toHaveAttribute("href", "/quiz/2026-09-20-abc123");
  await expect(done.getByText(/마감 시각/)).toContainText("2026. 9. 29.");
  await expect(page.getByRole("button", { name: "분석·비판 검토 시작" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "지금 발행", exact: true })).toHaveCount(0);
  await page.getByLabel("화면 테마").selectOption("light");
  await done.screenshot({ path: testInfo.outputPath("publication-light.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
