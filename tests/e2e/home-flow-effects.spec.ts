import { expect, test, type Page } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";

test.describe.configure({ timeout: 90_000 });
test.use({ launchOptions: { args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });
const choices = [
  { kind: "veil", name: "빛줄기 (Veil Rays)", scale: "광원 너비", uniform: "uVeilTime" },
  { kind: "silk", name: "비단결 (Silk Flow)", scale: "주름 크기", uniform: "uSilkSettings" },
  { kind: "aurora", name: "오로라 (Aurora Spire)", scale: "기둥 너비", uniform: "uAuroraSettings" },
] as const;
async function home(page: Page) {
  await page.route("**/api/quizzes/**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/me") ? { data: { submission: null } } : publicResponse("child") }));
  await page.addInitScript(() => localStorage.setItem("bibleQuiz:mercury-hidden", "true"));
  await page.goto("/?video=off");
  await expect(page.locator("#home-title")).toBeVisible();
  const trigger = page.getByRole("button", { name: "배경 효과", exact: true });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

test("four effect choices preserve independent settings, focus and stationary narrow-screen controls", async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: isMobile ? 320 : 1280, height: isMobile ? 667 : 600 });
  await home(page);
  const pauseBefore = await page.locator("#motion").boundingBox();
  for (const choice of choices) {
    const button = page.getByRole("button", { name: choice.name, exact: true });
    await button.click();
    const speed = page.getByRole("slider", { name: "흐름 속도", exact: true });
    await speed.focus(); await speed.press("Home"); await speed.press("ArrowRight");
    await expect(speed).toHaveValue("1");
    await expect(page.locator("body")).toHaveAttribute(`data-${choice.kind}-speed`, "1");
    const panel = (await page.locator(".hero-light-panel").boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(panel.y + panel.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    if (isMobile) {
      // The panel enters by 5px; verify the settled gap without disabling motion.
      await expect.poll(async () => {
        const panelBox = (await page.locator(".hero-light-panel").boundingBox())!;
        const choicesBox = (await page.locator(".hero-effect-surface").boundingBox())!;
        return choicesBox.y - panelBox.y - panelBox.height;
      }).toBeGreaterThanOrEqual(8);
    }
    await page.keyboard.press("Escape"); await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  if (isMobile) expect(await page.locator("#motion").boundingBox()).toEqual(pauseBefore);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "배경 효과", exact: true }).focus(); await page.keyboard.press("Enter");
  for (const choice of choices) {
    const button = page.getByRole("button", { name: choice.name, exact: true });
    await expect(button).toHaveAttribute("aria-pressed", "true"); await button.click();
    const speed = page.getByRole("slider", { name: "흐름 속도", exact: true });
    await expect(speed).toHaveValue("1");
    await page.getByRole("button", { name: "기본값으로", exact: true }).click();
    await expect(speed).toHaveValue("50");
    await button.click(); await expect(button).toHaveAttribute("aria-pressed", "false");
  }
  await expect(page.locator(".hero-effects")).toHaveAttribute("data-state", "disabled");
  expect(errors).toEqual([]);
});

for (const choice of choices) test(`${choice.kind} renders adjustable pixels and freezes flow at zero speed`, async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Actual GPU pixels use Chromium SwiftShader.");
  await home(page);
  await page.getByRole("button", { name: choice.name, exact: true }).click();
  const canvas = page.locator(".hero-effects");
  await expect(canvas).toHaveAttribute("data-state", "running");
  const sample = () => canvas.evaluate((node, name) => {
    const c = node as HTMLCanvasElement, gl = c.getContext("webgl")!;
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let alpha = 0, hash = 2166136261;
    for (let i = 0; i < pixels.length; i++) { hash = Math.imul(hash ^ pixels[i]!, 16777619); if (i % 4 === 3) alpha += pixels[i]!; }
    const uniform = gl.getUniform(program, gl.getUniformLocation(program, name));
    return { hash, alpha, elapsed: Number(c.dataset.time), time: typeof uniform === "number" ? uniform : uniform[2] as number, error: gl.getError() };
  }, choice.uniform);
  const speed = page.getByRole("slider", { name: "흐름 속도", exact: true });
  await speed.focus(); await speed.press("Home");
  const frozen = await sample(); await page.waitForTimeout(220);
  expect((await sample()).hash).toBe(frozen.hash);
  expect(frozen.alpha).toBeGreaterThan(0); expect(frozen.error).toBe(0);
  await speed.press("ArrowRight");
  await expect.poll(async () => (await sample()).time).toBeGreaterThan(frozen.time);
  // One percent speed resumes from the same phase instead of jumping to wall time.
  expect((await sample()).time - frozen.time).toBeLessThan(.2);
  await speed.press("Home");
  const brightness = page.getByRole("slider", { name: "밝기", exact: true });
  await brightness.focus(); await brightness.press("End"); const bright = await sample();
  await brightness.press("Home");
  await expect.poll(async () => (await sample()).alpha).toBeLessThan(bright.alpha * .5);
  const scale = page.getByRole("slider", { name: choice.scale, exact: true });
  await scale.focus(); await scale.press("Home"); const small = await sample();
  await scale.press("End"); await expect.poll(async () => (await sample()).hash).not.toBe(small.hash);
  await speed.focus(); await speed.press("End");
  const moving = await sample(); await expect.poll(async () => (await sample()).hash).not.toBe(moving.hash);
  if (choice.kind === "veil") {
    // Check the actual renderer clock: the former 2x ceiling looked static.
    // A full-speed slider must now advance at least 12 animation seconds per
    // active render second, independently of a slow CI machine's frame rate.
    await expect.poll(async () => (await sample()).elapsed - moving.elapsed).toBeGreaterThan(.12);
    const fast = await sample();
    expect((fast.time - moving.time) / (fast.elapsed - moving.elapsed)).toBeGreaterThan(12);
  }
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.locator("#motion").click(); await expect(canvas).toHaveAttribute("data-state", "paused");
  const stopped = await sample(); await page.waitForTimeout(160); expect((await sample()).hash).toBe(stopped.hash);
  await page.locator("#glass-clarity").click(); await expect(canvas).toHaveAttribute("data-state", "clear");
  await expect(canvas).toHaveCSS("visibility", "hidden");
  expect(await canvas.count()).toBe(1);
});
