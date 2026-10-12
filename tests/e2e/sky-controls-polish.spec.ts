import { expect, test, type Page } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";

async function home(page: Page) {
  await page.route("**/api/quizzes/**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/me") ? { data: { submission: null } } : publicResponse("child") }));
  await page.goto("/?video=off");
  await expect(page.locator("#home-title")).toBeVisible();
}

test("all three circular controls have pointer light and grass restores both ground choices", async ({ page, isMobile }) => {
  await home(page);
  if (!isMobile) {
    for (const id of ["motion", "glass-clarity", "grass-toggle"]) {
      const control = page.locator(`#${id}`);
      await control.hover({ position: { x: 12, y: 12 } });
      await expect(control).toHaveAttribute("data-glint-active", "");
      const first = await control.evaluate(node => (node as HTMLElement).style.getPropertyValue("--glint-x"));
      await control.hover({ position: { x: 30, y: 25 } });
      await expect.poll(() => control.evaluate(node => (node as HTMLElement).style.getPropertyValue("--glint-x"))).not.toBe(first);
      await page.mouse.move(400, 350);
      await expect(control).not.toHaveAttribute("data-glint-active");
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("footer").scrollIntoViewIfNeeded();
  await expect(page.locator("#grass-toggle .grass-off-mark")).not.toBeVisible();
  await page.getByRole("button", { name: "잔디 끄기", exact: true }).click();
  await expect(page.locator("#grass-toggle .grass-off-mark")).toBeVisible();
  await expect(page.locator("#grass-toggle svg")).toHaveCSS("opacity", "1");
  await expect(page.locator("body")).toHaveAttribute("data-ground", "photo");
  await expect(page.locator(".meadow")).toHaveCSS("opacity", "1");
  await expect.poll(() => page.locator(".meadow img").evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await page.locator(".meadow img").evaluate(node => (node as HTMLImageElement).currentSrc)).toContain("meadow");
  await page.getByRole("button", { name: "잔디 켜기", exact: true }).click();
  await expect(page.locator("#grass-toggle .grass-off-mark")).not.toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-ground", "grass");
  await expect(page.locator("#origin-grass")).toBeVisible();
  await expect(page.locator(".meadow")).toHaveCSS("opacity", "0");
  await expect(page.locator("#grass-toggle")).not.toHaveAttribute("data-glint-active");
});

type SampleWindow = Window & { scrollSamples?: { y: number; time: number }[] };
async function observeScroll(page: Page) {
  await page.evaluate(() => {
    const samples: { y: number; time: number }[] = [];
    (window as SampleWindow).scrollSamples = samples;
    window.addEventListener("scroll", () => samples.push({ y: scrollY, time: performance.now() }), { passive: true });
  });
}
async function expectGradual(page: Page) {
  await expect.poll(() => page.locator("#weekly").evaluate(node => Math.abs(node.getBoundingClientRect().top))).toBeLessThan(2);
  const duration = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>("#weekly")!.offsetTop;
    const samples = (window as SampleWindow).scrollSamples!.filter(sample => sample.y > target * .05 && sample.y < target * .95);
    return samples.length > 1 ? samples.at(-1)!.time - samples[0]!.time : 0;
  });
  expect(duration).toBeGreaterThan(450);
}

test("wheel and weekly links take time to travel and manual input can interrupt", async ({ page, isMobile }) => {
  await home(page);
  await observeScroll(page);
  await page.getByRole("link", { name: "이번 주 퀴즈", exact: true }).click();
  await expectGradual(page);
  await expect(page).toHaveURL(/\?video=off#weekly$/);
  if (!isMobile) {
    await page.goto("/?video=off");
    await observeScroll(page);
    await page.locator(".sky-home-hero").hover({ position: { x: 400, y: 350 } });
    await page.mouse.wheel(0, 80);
    await expectGradual(page);
    await page.mouse.wheel(0, -80);
    await expect(page.locator("html")).toHaveAttribute("data-home-scroll-animating", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).not.toHaveAttribute("data-home-scroll-animating");
    const stopped = await page.evaluate(() => scrollY);
    await page.waitForTimeout(180);
    expect(await page.evaluate(() => scrollY)).toBe(stopped);
  }
  await page.goto("/?video=off");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "이번 주 퀴즈", exact: true }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-home-scroll-animating");
  await expect.poll(() => page.locator("#weekly").evaluate(node => Math.abs(node.getBoundingClientRect().top))).toBeLessThan(2);
});

test("long sections remain readable and route restoration stays independent", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await home(page);
  await page.getByRole("link", { name: "이번 주 퀴즈", exact: true }).click();
  await expect.poll(() => page.locator("#weekly").evaluate(node => Math.abs(node.getBoundingClientRect().top))).toBeLessThan(2);
  const top = await page.evaluate(() => scrollY);
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 60);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(top);
  // Wheel dispatch finishes before the browser's native snap settles on mobile.
  await expect.poll(() => page.locator("#weekly").evaluate(node =>
    Math.abs(node.getBoundingClientRect().bottom - innerHeight),
  )).toBeLessThan(2);
  await page.getByRole("link", { name: /어린이 퀴즈/ }).click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "quiz");
  await expect(page.locator("html")).not.toHaveAttribute("data-home-scroll");
  await page.goBack();
  await expect(page.locator("body")).toHaveAttribute("data-view", "home");
  await expect(page.locator("html")).not.toHaveAttribute("data-home-scroll-animating");
  await expect(page.locator("#weekly")).toBeInViewport();
  await page.goto("/?video=off");
  await expect(page.locator("#home-title")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 이동", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(page.locator("html")).not.toHaveAttribute("data-home-scroll-animating");
});
