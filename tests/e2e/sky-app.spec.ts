import { expect, test } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";

const mockQuiz = async (page: import("@playwright/test").Page) => {
  await page.route("**/api/quizzes/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/me")) return route.fulfill({ json: { data: { submission: null } } });
    return route.fulfill({ json: publicResponse(url.searchParams.get("difficulty") === "adult" ? "adult" : "child") });
  });
};

test("home opens the real quiz, restores its draft and cleans glass on repeated navigation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockQuiz(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#home-title")).toHaveText("말씀을 가까이.일상에 깊이.");
  await expect(page.locator(".weekly-sheet")).toContainText("함께 돌아보는 한 주 (테스트)");
  await expect(page.locator("#home-view")).not.toContainText("화면 검토용 예시");
  await expect(page.getByRole("grid")).toHaveCount(0);
  const filters = await page.locator(".liquid-filter-definitions").count();
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.getByRole("link", { name: /어린이 퀴즈/ }).click();
    await expect(page).toHaveURL(/\/quiz\/2026-08-31-test01\?level=child$/);
    await expect(page.locator("body")).toHaveAttribute("data-view", "quiz");
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    const input = page.getByRole("textbox", { name: /^낱말 입력:/ });
    if (!cycle) await input.evaluate(element => {
      (element as HTMLInputElement).value = "값";
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    await expect(page.getByTestId("progress")).toHaveText("1 / 21칸 작성");
    await page.getByRole("tab", { name: "어린이용" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "장년용" })).toBeFocused();
    await expect(page.locator(".difficulty-tabs > .glass-indicator")).toHaveCount(1);
    await expect(page.getByTestId("progress")).toHaveText("0 / 40칸 작성");
    await page.getByRole("link", { name: "← 이번 주 말씀" }).click();
    await expect(page).toHaveURL(/\/#weekly$/);
    await expect(page.locator("#weekly")).toBeInViewport();
    await expect(page.locator(".liquid-filter-definitions")).toHaveCount(filters);
    await expect(page.locator("#world")).toHaveCount(1);
    const ids = await page.locator(".liquid-filter-definitions filter").evaluateAll(nodes => nodes.map(node => node.id));
    expect(new Set(ids).size).toBe(ids.length);
  }
  expect(errors).toEqual([]);
});

test("sky choice and clarity persist, respect device preferences, and do not change on hover", async ({ page, isMobile }) => {
  await mockQuiz(page);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
  await page.goto("/?video=off");
  await expect(page.locator("body")).toHaveAttribute("data-time", "night");
  for (const [label, time] of [["새벽", "dawn"], ["낮", "day"], ["노을", "dusk"], ["밤", "night"]]) {
    await page.getByRole("button", { name: label!, exact: true }).click();
    await expect(page.locator("body")).toHaveAttribute("data-time", time!);
    await expect(page.getByRole("button", { name: label!, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  if (!isMobile) {
    await page.getByRole("button", { name: "낮", exact: true }).hover();
    await expect(page.locator("body")).toHaveAttribute("data-time", "night");
    await expect(page.getByRole("button", { name: "밤", exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "투명도 줄이기", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-transparency", "reduced");
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-time", "night");
  await expect(page.locator("body")).toHaveAttribute("data-transparency", "reduced");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("body")).toHaveAttribute("data-motion", "off");
  await expect(page.locator("#motion")).toBeDisabled();
  await page.getByLabel("화면 테마").selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveAttribute("data-time", "day");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.locator("#world")).toBeHidden();
  await expect(page.getByRole("link", { name: /어린이 퀴즈/ })).toBeVisible();
});

test("selected movies pause offscreen and in reduced motion, with a readable media failure fallback", async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== "chromium", "Movie decoding is verified on Chromium; CSS fallback is covered on other engines.");
  test.setTimeout(60_000);
  await mockQuiz(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const movies: string[] = [];
  page.on("request", request => { if (request.url().endsWith(".mp4")) movies.push(request.url()); });
  await page.goto("/");
  await expect(page.locator(".sky-video img")).toHaveJSProperty("complete", true);
  expect(movies).toEqual([]);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const video = page.locator(".sky-video video");
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(false);
  await expect(video).toHaveAttribute("src", new RegExp(isMobile ? "1080p\\.mp4$" : "4k\\.mp4$"));
  await page.getByRole("button", { name: "밤", exact: true }).click();
  await expect(video).toHaveAttribute("src", new RegExp(isMobile ? "night-1080p\\.mp4$" : "night-4k-optimized\\.mp4$"));
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.locator("#archive").scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  await page.getByRole("link", { name: /어린이 퀴즈/ }).click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "quiz");
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).paused)).toBe(true);
  await page.route(/\.(mp4|webp)(\?.*)?$/, route => route.abort());
  await page.goto("/");
  await expect(page.locator("#home-title")).toBeVisible();
  await page.getByRole("link", { name: /어린이 퀴즈/ }).click();
  await expect(page.getByRole("grid", { name: "낱말 퀴즈 격자" })).toBeVisible();
});
