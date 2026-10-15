import { expect, test } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";

test("home introduction and navigation appear before quiz and submission requests finish", async ({ page }) => {
  let releaseQuiz = () => {};
  let releaseOwn = () => {};
  const quizGate = new Promise<void>(resolve => { releaseQuiz = resolve; });
  const ownGate = new Promise<void>(resolve => { releaseOwn = resolve; });
  let ownRequested = false;
  await page.route("**/api/quizzes/**", async route => {
    if (new URL(route.request().url()).pathname.endsWith("/me")) {
      ownRequested = true;
      await ownGate;
      await route.fulfill({ json: { data: { submission: null } } });
    } else {
      await quizGate;
      await route.fulfill({ json: publicResponse("child") });
    }
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#home-title")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible();
    await expect(page.locator(".app-loading, .loading-workspace, .loading-title, .loading-meta")).toHaveCount(0);
    const loading = page.getByRole("status", { name: "퀴즈를 불러오고 있습니다." });
    await expect(loading).toBeAttached();
    expect((await loading.boundingBox())!.y).toBeGreaterThan(page.viewportSize()!.height);
    await page.locator(".hero-cta").click();
    await expect(page).toHaveURL(/#weekly$/);
    await expect(loading).toBeInViewport();
    releaseQuiz();
    await expect.poll(() => ownRequested).toBe(true);
    await expect(loading).toBeVisible();
    releaseOwn();
    await expect(page.locator(".weekly-sheet h3")).toHaveText("함께 돌아보는 한 주 (테스트)");
    await expect(loading).toHaveCount(0);
    await page.getByRole("link", { name: /어린이 퀴즈/ }).click();
    await expect(page.getByRole("grid")).toBeVisible();
  } finally { releaseQuiz(); releaseOwn(); }
});

test("home retains its introduction through a failed request and weekly retry", async ({ page }) => {
  let fail = true;
  await page.route("**/api/quizzes/**", route => route.fulfill(fail
    ? { status: 503, json: { error: { message: "private error" } } }
    : { json: new URL(route.request().url()).pathname.endsWith("/me") ? { data: { submission: null } } : publicResponse("child") }));
  await page.goto("/");
  await expect(page.locator("#home-title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "퀴즈를 불러오지 못했습니다." })).toBeAttached();
  await expect(page.locator("body")).not.toContainText("private error");
  fail = false;
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.locator(".weekly-sheet h3")).toHaveText("함께 돌아보는 한 주 (테스트)");
  await expect(page.locator("#home-title")).toBeAttached();
});
