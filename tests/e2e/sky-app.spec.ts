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

test("sky choice and clarity persist, respect reduced motion, and do not change on hover", async ({ page, isMobile }) => {
  await mockQuiz(page);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
  await page.clock.setFixedTime(new Date("2026-06-21T15:00:00Z"));
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
  await page.getByRole("button", { name: "낮", exact: true }).click();
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
  await page.clock.setFixedTime(new Date("2026-06-21T03:00:00Z"));
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

test("Seoul time is automatic on a fresh tab and manual choices last for the current tab", async ({ page, context }) => {
  await mockQuiz(page);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("bibleQuiz:theme", "dark");
    localStorage.setItem("bibleQuiz:sky", "night");
  });
  await page.clock.setFixedTime(new Date("2026-06-20T21:00:00Z")); // Summer 06:00 KST: already daytime.
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-time", "day");
  await expect(page.getByLabel("화면 테마")).toHaveCount(0);
  await page.clock.setFixedTime(new Date("2026-12-20T21:00:00Z")); // Winter 06:00 KST: still night.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("body")).toHaveAttribute("data-time", "night");
  await page.getByRole("button", { name: "노을", exact: true }).click();
  await page.clock.setFixedTime(new Date("2026-12-21T03:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("body")).toHaveAttribute("data-time", "dusk");
  await page.getByRole("navigation", { name: "빠른 이동" }).getByRole("link", { name: "퀴즈", exact: true }).click();
  await expect(page).toHaveURL(/\?level=child$/);
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-time", "dusk");
  const fresh = await context.newPage();
  await mockQuiz(fresh);
  await fresh.clock.setFixedTime(new Date("2026-12-21T03:00:00Z"));
  await fresh.goto("/");
  await expect(fresh.locator("body")).toHaveAttribute("data-time", "day");
  await fresh.close();
});

test("grass switches to the original photo and the dock links use the real pages", async ({ page }) => {
  await mockQuiz(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect(page.locator("#origin-grass")).toHaveAttribute("data-active", "true");
  await expect(page.locator(".distant-mountains")).toBeVisible();
  await page.getByRole("button", { name: "잔디 끄기", exact: true }).click();
  await expect(page.locator("#origin-grass")).toBeHidden();
  await expect(page.locator(".meadow")).toHaveCSS("opacity", "1");
  await expect(page.locator(".distant-mountains")).toBeHidden();
  await expect(page.locator("#grass-toggle")).toHaveText("");
  await page.reload();
  await expect(page.getByRole("button", { name: "잔디 켜기", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#grass-toggle .grass-state[data-on=false]")).toBeVisible();
  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect(page.locator("#origin-grass")).toBeHidden();
  const footer = page.locator("footer");
  await expect(footer).not.toContainText("로컬 개발");
  await expect(footer).toContainText("다사랑교회 성경퀴즈");
  const dock = page.getByRole("navigation", { name: "빠른 이동" });
  await expect(dock.getByRole("link", { name: "홈", exact: true }).locator("svg")).toBeVisible();
  await dock.getByRole("link", { name: "문의", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy-requests$/);
});

test("home snaps to sections and its weekly anchor, short-screen buttons and footer stay reachable", async ({ page, isMobile }) => {
  await mockQuiz(page);
  await page.goto("/?video=off");
  await expect(page.locator("html")).toHaveCSS("scroll-snap-type", isMobile ? "y mandatory" : "none");
  if (!isMobile) {
    await page.locator(".sky-home-hero").hover({ position: { x: 400, y: 400 } });
    await page.mouse.wheel(0, 550);
    await expect.poll(() => page.locator("#weekly").evaluate(node => Math.abs(node.getBoundingClientRect().top))).toBeLessThan(2);
    await page.mouse.wheel(0, -550);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  }
  await page.locator("#home-view").getByRole("link", { name: "이번 주 퀴즈", exact: true }).click();
  await expect.poll(() => page.locator("#weekly").evaluate(node => Math.abs(node.getBoundingClientRect().top))).toBeLessThan(2);
  await expect(page).toHaveURL(/\?video=off#weekly$/);
  const heading = await page.locator("#weekly-title").boundingBox();
  const header = await page.locator(".site-header").boundingBox();
  expect(heading!.y).toBeGreaterThan(header!.y + header!.height);
  await page.setViewportSize({ width: 320, height: 667 });
  await page.goto("/?video=off");
  await page.locator("#home-view").getByRole("link", { name: "이번 주 퀴즈", exact: true }).click();
  await expect.poll(() => page.locator("#weekly").evaluate(node => Math.abs(node.getBoundingClientRect().top))).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.locator("footer").scrollIntoViewIfNeeded();
  await page.locator("footer").getByRole("link", { name: "맨 위로 ↑", exact: true }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page).toHaveURL(/\?video=off#main-content$/);
  await page.locator("footer").scrollIntoViewIfNeeded();
  await page.getByRole("navigation", { name: "빠른 이동" }).getByRole("link", { name: "문의", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy-requests$/);
  await page.goto("/");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveCSS("scroll-snap-type", "none");
});

test("separate clouds keep drifting while the weekly section is stationary", async ({ page }) => {
  await mockQuiz(page);
  await page.goto("/?video=off");
  await page.getByRole("button", { name: "낮", exact: true }).click();
  await page.locator("#home-view").getByRole("link", { name: "이번 주 퀴즈", exact: true }).click();
  await expect(page.locator("#clouds")).toHaveAttribute("data-renderer", "webgl-billboards");
  await expect.poll(() => page.locator("#weekly").evaluate(node => Math.abs(node.getBoundingClientRect().top))).toBeLessThan(2);
  await expect.poll(() => page.evaluate(() => {
    const target = scrollY / (document.querySelector<HTMLElement>("#home-view")!.offsetHeight - innerHeight);
    return Math.abs(Number(document.querySelector<HTMLElement>("#clouds")!.dataset.progress) - target);
  })).toBeLessThan(0.0001);
  // Read the actual rendered layer, so an advancing timer alone cannot pass this check.
  const pixels = () => page.evaluate(() => new Promise<{ hash: number; visible: number }>(resolve => {
    requestAnimationFrame(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#clouds")!;
      const gl = canvas.getContext("webgl")!;
      const data = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let hash = 0, visible = 0;
      for (let i = 3; i < data.length; i += 4) { hash = (hash * 31 + data[i]!) | 0; if (data[i]) visible++; }
      resolve({ hash, visible });
    });
  }));
  const first = await pixels();
  expect(first.visible).toBeGreaterThan(1000);
  await expect.poll(async () => (await pixels()).hash).not.toBe(first.hash);
  await page.getByRole("button", { name: "배경 움직임 멈춤", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-motion", "off");
  const stopped = await page.locator("#clouds").getAttribute("data-time");
  await page.waitForTimeout(150);
  expect(await page.locator("#clouds").getAttribute("data-time")).toBe(stopped);
});
