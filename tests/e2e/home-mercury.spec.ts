import { expect, test, type Locator, type Page } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";

test.use({ launchOptions: { args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });
test.skip(({ browserName }) => browserName !== "chromium", "GPU rendering uses Chromium SwiftShader; shared navigation also runs in sky-app.");

async function home(page: Page) {
  await page.route("**/api/quizzes/**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/me") ? { data: { submission: null } } : publicResponse("child") }));
  await page.goto("/?video=off");
  await expect(page.locator("#home-title")).toBeVisible();
  return page.locator(".hero-mercury");
}

async function expectStill(canvas: Locator) {
  const time = await canvas.getAttribute("data-time");
  await new Promise(resolve => setTimeout(resolve, 180));
  expect(await canvas.getAttribute("data-time")).toBe(time);
}

test("mercury stays behind the home introduction and stops after the weekly link", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const canvas = await home(page);
  await expect(canvas).toHaveAttribute("data-state", "running");
  await expect(canvas).toHaveAttribute("aria-hidden", "true");
  await expect(canvas).toHaveCSS("pointer-events", "none");
  const first = await canvas.getAttribute("data-time");
  await expect.poll(() => canvas.getAttribute("data-time")).not.toBe(first);
  const heroBox = (await page.locator(".sky-home-hero").boundingBox())!;
  const canvasBox = (await canvas.boundingBox())!;
  expect(canvasBox).toEqual(heroBox);
  const dimensions = await canvas.evaluate(node => ({ width: (node as HTMLCanvasElement).width, height: (node as HTMLCanvasElement).height }));
  expect(dimensions.width).toBeLessThanOrEqual(960);
  expect(dimensions.height).toBeLessThanOrEqual(720);
  const link = page.locator(".hero-content").getByRole("link", { name: "이번 주 퀴즈", exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#weekly$/);
  await expect(page.locator("#weekly")).toBeInViewport();
  await expect(canvas).toHaveAttribute("data-state", "offscreen");
  await expectStill(canvas);
  await page.getByRole("link", { name: /어린이 퀴즈/ }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(canvas).toHaveCount(0);
  await page.getByRole("link", { name: "← 이번 주 말씀" }).click();
  await expect(canvas).toHaveCount(1);
  await page.goto("/privacy-requests");
  await expect(canvas).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("mercury follows pause, reduced motion, clarity and hidden-tab settings", async ({ page }) => {
  const canvas = await home(page);
  await expect(canvas).toHaveAttribute("data-state", "running");
  await page.locator("#motion").click();
  await expect(canvas).toHaveAttribute("data-state", "paused");
  await expectStill(canvas);
  await page.locator("#motion").click();
  await expect(canvas).toHaveAttribute("data-state", "running");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(canvas).toHaveAttribute("data-state", "paused");
  await expectStill(canvas);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator("#glass-clarity").click();
  await expect(canvas).toHaveCSS("visibility", "hidden");
  await expect(canvas).toHaveAttribute("data-state", "clear");
  await expectStill(canvas);
  await page.locator("#glass-clarity").click();
  await expect(canvas).toHaveAttribute("data-state", "running");
  // Simulate the browser visibility event; headless focus is not an OS tab switch.
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(canvas).toHaveAttribute("data-state", "offscreen");
  await expectStill(canvas);
  await page.evaluate(() => { Reflect.deleteProperty(document, "hidden"); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(canvas).toHaveAttribute("data-state", "running");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(canvas).toHaveAttribute("data-state", "clear");
  await expect(canvas).toHaveCSS("visibility", "hidden");
});

test("mercury releases a lost graphics context and restores without blocking content", async ({ page }) => {
  const canvas = await home(page);
  await expect(canvas).toHaveAttribute("data-state", "running");
  await canvas.evaluate(node => {
    const gl = (node as HTMLCanvasElement).getContext("webgl")!;
    const extension = gl.getExtension("WEBGL_lose_context")!;
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 250);
  });
  await expect(canvas).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator("#home-title")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-state", "running");
  const first = await canvas.getAttribute("data-time");
  await expect.poll(() => canvas.getAttribute("data-time")).not.toBe(first);
  expect(await canvas.evaluate(node => (node as HTMLCanvasElement).getContext("webgl")!.getError())).toBe(0);
});

test("the original home and quiz remain usable when the decorative GPU layer is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, options?: object) {
      if (this.classList.contains("hero-mercury")) return null;
      return original.call(this, contextId, options);
    } as typeof original;
  });
  const canvas = await home(page);
  await expect(canvas).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator("#home-title")).toBeVisible();
  await page.locator(".hero-content").getByRole("link", { name: "이번 주 퀴즈", exact: true }).click();
  await page.getByRole("link", { name: /어린이 퀴즈/ }).click();
  await expect(page.getByRole("grid")).toBeVisible();
});
