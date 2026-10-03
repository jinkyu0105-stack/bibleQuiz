import { expect, test } from "@playwright/test";
import type { DisplayTextView } from "../../shared/api/admin-display-text";

test("corrects published metadata, retries the same request, preserves links and shows audit after refresh", async ({ page }, testInfo) => {
  let listFails = true, detailFails = true;
  const view: DisplayTextView = { quiz: { quizSetId: "synthetic", slug: "2026-09-20-abc123", status: "archived", revision: 0,
    metadata: { title: "합성 원제목", sermonDate: "2026-09-20" }, publishedAt: "2026-09-21T00:00:00.000Z", closesAt: "2026-09-28T00:00:00.000Z" }, history: [] };
  await page.route("**/api/admin/published-quizzes", route => listFails
    ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { data: { items: [view.quiz] } } }));
  const commands: Record<string, unknown>[] = [];
  await page.route("**/api/admin/quiz-sets/synthetic/display-text", route => {
    if (route.request().method() === "GET") return detailFails ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { data: view } });
    const body = route.request().postDataJSON(); commands.push(body);
    // First request commits, but its response is lost. The next exact request replays it.
    if (commands.length === 1) {
      view.history = [{ revision: 1, before: view.quiz.metadata, after: body.after, reason: body.reason, createdAt: "2026-09-23T00:00:00.000Z" }];
      view.quiz.metadata = body.after; view.quiz.revision = 1;
      return route.fulfill({ status: 503, json: {} });
    }
    return route.fulfill({ json: { data: { outcome: "replayed", quizSetId: "synthetic", revision: 1 } } });
  });
  await page.goto("/admin/tools");
  const panel = page.getByRole("region", { name: "발행 정보 정정" });
  await expect(panel.getByRole("alert")).toContainText("목록을 불러오지 못했습니다");
  listFails = false; await panel.getByRole("button", { name: "목록 다시 확인" }).click();
  await panel.getByLabel("정정할 퀴즈").selectOption("synthetic");
  await expect(panel.getByRole("alert")).toContainText("현재 표시 정보를 불러오지 못했습니다");
  detailFails = false; await panel.getByRole("button", { name: "최신 내용 불러오기" }).click();
  await expect(panel.getByLabel("설교 제목", { exact: true })).toHaveValue("합성 원제목");
  await panel.getByLabel("설교 제목", { exact: true }).fill("정정한 합성 제목");
  await panel.getByLabel("설교 일자", { exact: true }).fill("2026-09-19");
  await expect(panel).toContainText("특별예배 등 의도한 날짜");
  await panel.getByLabel("정정 사유", { exact: true }).fill("제목과 날짜의 오탈자 정정");
  await panel.getByRole("button", { name: "정정 저장", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("입력한 내용은 유지됩니다");
  await expect(panel.getByLabel("설교 제목", { exact: true })).toHaveValue("정정한 합성 제목");
  await panel.getByRole("button", { name: "정정 저장", exact: true }).click();
  await expect(panel.getByRole("status").filter({ hasText: "정정을 저장했습니다" })).toBeVisible();
  expect(commands).toHaveLength(2); expect(commands[0]).toEqual(commands[1]);
  await expect(panel.getByRole("link", { name: "공개된 퀴즈 보기" })).toHaveAttribute("href", "/quiz/2026-09-20-abc123");
  await panel.getByText("정정 이력 (1)", { exact: true }).click();
  await expect(panel).toContainText("합성 원제목 → 정정한 합성 제목");
  await expect(panel).toContainText("오전 9:00");
  await panel.screenshot({ path: testInfo.outputPath("display-light.png") });
  await page.getByLabel("화면 테마").selectOption("dark");
  await panel.screenshot({ path: testInfo.outputPath("display-dark.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await panel.getByLabel("정정할 퀴즈").selectOption("synthetic");
  await expect(panel.getByLabel("설교 제목", { exact: true })).toHaveValue("정정한 합성 제목");
});

test("handles a concurrent correction by retaining edits and explicitly loading current metadata", async ({ page }) => {
  const view: DisplayTextView = { quiz: { quizSetId: "synthetic", slug: "2026-09-20-abc123", status: "published", revision: 0,
    metadata: { title: "합성 원제목", sermonDate: "2026-09-20" }, publishedAt: "2026-09-21T00:00:00.000Z", closesAt: "2026-09-28T00:00:00.000Z" }, history: [] };
  await page.route("**/api/admin/published-quizzes", route => route.fulfill({ json: { data: { items: [view.quiz] } } }));
  await page.route("**/api/admin/quiz-sets/synthetic/display-text", route => route.request().method() === "GET"
    ? route.fulfill({ json: { data: view } }) : route.fulfill({ status: 409, json: {} }));
  await page.goto("/admin/tools"); const panel = page.getByRole("region", { name: "발행 정보 정정" });
  await panel.getByLabel("정정할 퀴즈").selectOption("synthetic");
  await panel.getByLabel("설교 제목", { exact: true }).fill("아직 저장 안 된 제목");
  await panel.getByLabel("정정 사유", { exact: true }).fill("합성 사유");
  await panel.getByRole("button", { name: "정정 저장", exact: true }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.getByLabel("설교 제목", { exact: true })).toHaveValue("아직 저장 안 된 제목");
  view.quiz.metadata.title = "다른 화면에서 정정한 제목"; view.quiz.revision = 1;
  await panel.getByRole("button", { name: "최신 내용 불러오기" }).click();
  await expect(panel.getByLabel("설교 제목", { exact: true })).toHaveValue("다른 화면에서 정정한 제목");
});

test("shows an empty published list", async ({ page }) => {
  await page.route("**/api/admin/published-quizzes", route => route.fulfill({ json: { data: { items: [] } } }));
  await page.goto("/admin/tools");
  await expect(page.getByRole("region", { name: "발행 정보 정정" })).toContainText("아직 발행된 퀴즈가 없습니다");
});
