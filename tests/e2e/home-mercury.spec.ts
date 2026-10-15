import { openSkySettings } from "./sky-control-helpers";
import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";

// SwiftShader shares CPU with Vite on CI. Wait for actual painted/visible states,
// including routes that recreate a GPU context, without weakening those states.
const expect = baseExpect.configure({ timeout: 20_000 });
test.describe.configure({ timeout: 90_000 });
test.use({ launchOptions: { args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });
test.skip(({ browserName }) => browserName !== "chromium", "GPU rendering uses Chromium SwiftShader; shared navigation also runs in sky-app.");

async function home(page: Page) {
  await page.route("**/api/quizzes/**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/me") ? { data: { submission: null } } : publicResponse("child") }));
  await page.goto("/?video=off");
  await expect(page.locator("#home-title")).toBeVisible();
  await openSkySettings(page);
  return page.locator(".hero-effects");
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
  expect(dimensions.width).toBeLessThanOrEqual(640);
  expect(dimensions.height).toBeLessThanOrEqual(480);
  const link = page.locator(".hero-content").getByRole("link", { name: "이번 주 퀴즈", exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#weekly$/);
  await expect(page.locator("#weekly")).toBeInViewport();
  // Router first restores the hash, then the deliberate scroll animates from
  // its captured origin. Wait for arrival, not that transient offscreen state.
  await expect.poll(() => page.locator("#weekly").evaluate(n => Math.abs(n.getBoundingClientRect().top))).toBeLessThan(2);
  await expect(page.locator("html")).not.toHaveAttribute("data-home-scroll-animating");
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

test("both hero effects can be mixed or stopped without adding a second canvas", async ({ page }) => {
  const canvas = await home(page);
  const trigger = page.getByRole("button", { name: "배경 효과", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const reflection = page.getByRole("button", { name: "물결 반사 (Mercury)", exact: true });
  const rays = page.getByRole("button", { name: "빛줄기 (Veil Rays)", exact: true });
  await reflection.click();
  await reflection.click();
  await expect(canvas).toHaveAttribute("data-state", "disabled");
  await expect(canvas).toHaveCSS("visibility", "hidden");
  await expectStill(canvas);
  await rays.click();
  await expect(canvas).toHaveAttribute("data-state", "running");
  await reflection.click();
  await expect(page.locator(".sky-home-hero canvas")).toHaveCount(1);
  await expect(canvas).toHaveAttribute("data-state", "running");
  await page.keyboard.press("Escape");
  await page.locator("#motion").click();
  await expect(canvas).toHaveAttribute("data-state", "paused");
  await expectStill(canvas);
  expect(await canvas.evaluate(node => (node as HTMLCanvasElement).getContext("webgl")!.getError())).toBe(0);
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
      if (this.classList.contains("hero-effects")) return null;
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

test("reflection tuning changes actual pixels and zero speed holds its flow", async ({ page }) => {
  const canvas = await home(page);
  await expect(canvas).toHaveAttribute("data-state", "running");
  await page.locator("#motion").focus(); await page.keyboard.press("Enter");
  const trigger = page.getByRole("button", { name: "배경 효과", exact: true });
  const reflection = page.getByRole("button", { name: "물결 반사 (Mercury)", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  await reflection.focus(); await page.keyboard.press("Enter");
  const pixels = () => canvas.evaluate(node => {
    const canvas = node as HTMLCanvasElement, gl = canvas.getContext("webgl")!;
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let alpha = 0, hash = 0;
    for (let i = 3; i < data.length; i += 4) { alpha += data[i]!; hash = (hash * 31 + data[i]!) | 0; }
    return { alpha, hash };
  });
  const brightness = page.getByRole("slider", { name: "밝기", exact: true });
  await brightness.press("Home"); const dim = await pixels();
  await brightness.press("End"); await expect.poll(async () => (await pixels()).alpha).toBeGreaterThan(dim.alpha * 2);
  const scale = page.getByRole("slider", { name: "물결 크기", exact: true });
  await scale.press("Home"); const small = await pixels();
  await scale.press("End"); await expect.poll(async () => (await pixels()).hash).not.toBe(small.hash);
  const speed = page.getByRole("slider", { name: "흐름 속도", exact: true });
  await speed.press("Home"); await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.locator("#motion").focus(); await page.keyboard.press("Enter");
  await expect(canvas).toHaveAttribute("data-state", "running");
  const held = await pixels(), time = await canvas.getAttribute("data-time");
  await expect.poll(() => canvas.getAttribute("data-time")).not.toBe(time);
  expect((await pixels()).hash).toBe(held.hash);
  await trigger.focus(); await page.keyboard.press("Enter");
  await reflection.focus(); await page.keyboard.press("Enter");
  await speed.press("End");
  await expect.poll(async () => (await pixels()).hash).not.toBe(held.hash);
  expect(await canvas.evaluate(node => (node as HTMLCanvasElement).getContext("webgl")!.getError())).toBe(0);
});

test("light width and brightness change the rendered light even while motion is paused", async ({ page }) => {
  const canvas = await home(page);
  await page.getByRole("button", { name: "낮", exact: true }).click();
  await page.locator("#motion").click();
  const trigger = page.getByRole("button", { name: "배경 효과", exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "물결 반사 (Mercury)", exact: true }).click();
  await page.getByRole("button", { name: "물결 반사 (Mercury)", exact: true }).click();
  await page.getByRole("button", { name: "빛줄기 (Veil Rays)", exact: true }).click();
  const width = page.getByRole("slider", { name: "광원 너비", exact: true });
  const brightness = page.getByRole("slider", { name: "밝기", exact: true });
  const light = () => canvas.evaluate(node => {
    const canvas = node as HTMLCanvasElement, gl = canvas.getContext("webgl")!;
    // Repaint the current paused frame so readPixels is independent of buffer discard.
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let alpha = 0;
    for (let i = 3; i < pixels.length; i += 4) alpha += pixels[i]!;
    return alpha;
  });
  await width.press("Home");
  const narrow = await light();
  await width.press("End");
  await expect.poll(light).toBeGreaterThan(narrow * 1.08);
  const wide = await light();
  await brightness.press("Home");
  await expect.poll(light).toBeLessThan(wide * .5);
  await expect(canvas).toHaveAttribute("data-state", "paused");
  await expectStill(canvas);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "밤", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-state", "paused");
  expect(await light()).toBeGreaterThan(0);
  expect(await canvas.evaluate(node => (node as HTMLCanvasElement).getContext("webgl")!.getError())).toBe(0);
});
