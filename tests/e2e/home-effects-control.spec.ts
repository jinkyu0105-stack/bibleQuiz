import { expect, test, type Page } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";

async function home(page: Page) {
  await page.route("**/api/quizzes/**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/me") ? { data: { submission: null } } : publicResponse("child") }));
  await page.goto("/?video=off");
  await expect(page.locator("#home-title")).toBeVisible();
}
async function expand(page: Page, touch: boolean) {
  const trigger = page.getByRole("button", { name: "배경 효과", exact: true });
  if (touch) await trigger.tap(); else await trigger.hover();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

test("effect capsule opens without choosing an effect and preserves independent choices", async ({ page, isMobile }) => {
  await home(page);
  const trigger = page.getByRole("button", { name: "배경 효과", exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expand(page, isMobile);
  const reflection = page.getByRole("button", { name: "물결 반사 (Mercury)", exact: true });
  const rays = page.getByRole("button", { name: "빛줄기 (Veil Rays)", exact: true });
  await expect(reflection).toHaveAttribute("aria-pressed", "true");
  await expect(rays).toHaveAttribute("aria-pressed", "false");
  await rays.click();
  await expect(page.locator("body")).toHaveAttribute("data-hero-veil", "on");
  await expect(page.getByRole("slider", { name: "광원 너비", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "빛줄기 조절", exact: true })).toHaveCount(0);
  await expect(reflection).toHaveAttribute("aria-pressed", "true");
  await reflection.click();
  await expect(page.getByRole("group", { name: "반사 조절", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "빛줄기 조절", exact: true })).toHaveCount(0);
  await expect(reflection).toHaveAttribute("aria-pressed", "true");
  await reflection.click();
  await expect(page.locator("body")).toHaveAttribute("data-hero-mercury", "off");
  await expect(rays).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("#home-title")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-hero-mercury", "off");
  await expect(page.locator("body")).toHaveAttribute("data-hero-veil", "on");
  await page.goto("/privacy-requests");
  await expect(trigger).toHaveCount(0);
  await expect(page.locator(".hero-effects")).toHaveCount(0);
  await page.goto("/?video=off");
  await expand(page, isMobile);
  await expect(reflection).toHaveAttribute("aria-pressed", "false");
  await expect(rays).toHaveAttribute("aria-pressed", "true");
  await rays.click();
  await expect(rays).toHaveAttribute("aria-expanded", "true");
  await expect(rays).toHaveAttribute("aria-pressed", "true");
  await rays.click();
  await expect(rays).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".hero-light-panel")).toHaveCount(0);
});

test("effect disclosure supports keyboard, escape, outside dismissal and reduced motion", async ({ page, isMobile }) => {
  await home(page);
  const trigger = page.getByRole("button", { name: "배경 효과", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  const reflection = page.getByRole("button", { name: "물결 반사 (Mercury)", exact: true });
  await expect(reflection).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("slider", { name: "밝기", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(reflection).toBeFocused();
  await expect(reflection).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await reflection.click();
  await expect(reflection).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Tab");
  const rays = page.getByRole("button", { name: "빛줄기 (Veil Rays)", exact: true });
  await expect(rays).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rays).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(rays).toBeFocused();
  await expect(rays).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Tab");
  await expect(page.locator("#glass-clarity")).toBeFocused();
  await expand(page, isMobile);
  await page.locator("#home-title").click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".hero-effect-control")).toHaveCSS("transition-duration", "0s");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(rays).toBeVisible();
  await expect(rays).toHaveCSS("outline-style", "solid");
});

test("effect controls fit narrow and short screens and report unavailable storage", async ({ page, isMobile }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("Blocked for test"); } }); });
  await page.setViewportSize({ width: isMobile ? 320 : 1280, height: isMobile ? 740 : 600 });
  await home(page);
  await expand(page, isMobile);
  const rays = page.getByRole("button", { name: "빛줄기 (Veil Rays)", exact: true });
  await rays.click();
  await expect(rays).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "효과 설정은 이 화면에서만 유지됩니다." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of [rays, page.locator("#motion"), page.locator("#glass-clarity"), page.locator("#grass-toggle")]) {
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual((page.viewportSize()!).width + 1);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual((page.viewportSize()!).height + 1);
  }
});

test("light tuning supports live input, saved values, reset and returning focus", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: isMobile ? 320 : 1280, height: isMobile ? 667 : 600 });
  await home(page);
  await expand(page, isMobile);
  const trigger = page.getByRole("button", { name: "배경 효과", exact: true });
  await expect(trigger).toHaveText("");
  const tune = page.getByRole("button", { name: "빛줄기 (Veil Rays)", exact: true });
  await tune.click();
  const width = page.getByRole("slider", { name: "광원 너비", exact: true });
  await expect(width).toBeFocused();
  await width.press("End");
  await expect(width).toHaveValue("100");
  await expect(page.locator("body")).toHaveAttribute("data-veil-width", "100");
  await page.keyboard.press("Tab");
  const strength = page.getByRole("slider", { name: "밝기", exact: true });
  await expect(strength).toBeFocused();
  await strength.press("Home");
  await strength.press("ArrowRight");
  await expect(strength).toHaveValue("11");
  const spread = page.getByRole("slider", { name: "퍼짐", exact: true });
  const track = (await spread.boundingBox())!;
  if (isMobile) await page.touchscreen.tap(track.x + track.width * .25, track.y + track.height / 2);
  else {
    await page.mouse.move(track.x + track.width * .6, track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * .25, track.y + track.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  const value = Number(await spread.inputValue());
  expect(value).toBeGreaterThanOrEqual(15); expect(value).toBeLessThanOrEqual(35);
  if (!isMobile) { await page.mouse.move(0, 0); await page.waitForTimeout(250); }
  await expect(tune).toHaveAttribute("aria-expanded", "true");
  const box = (await page.locator(".hero-light-panel").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await spread.focus(); await page.keyboard.press("Escape");
  await expect(tune).toBeFocused(); await expect(tune).toHaveAttribute("aria-expanded", "false");
  await page.reload(); await expand(page, isMobile); await tune.click();
  await expect(width).toHaveValue("100"); await expect(strength).toHaveValue("11"); await expect(spread).toHaveValue(String(value));
  await page.getByRole("button", { name: "기본값으로", exact: true }).click();
  await expect(width).toHaveValue("65"); await expect(strength).toHaveValue("55"); await expect(spread).toHaveValue("60");
  await page.mouse.click(4, 150);
  await expect(page.locator(".hero-light-panel")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("light controls recover from invalid storage and keep the time bar's spring hover", async ({ page, isMobile }) => {
  await page.addInitScript(() => localStorage.setItem("bibleQuiz:veil-settings", '{"width":1000,"strength":"bad","spread":null}'));
  await home(page); await expand(page, isMobile);
  await page.getByRole("button", { name: "빛줄기 (Veil Rays)", exact: true }).click();
  await expect(page.getByRole("slider", { name: "광원 너비", exact: true })).toHaveValue("100");
  await expect(page.getByRole("slider", { name: "밝기", exact: true })).toHaveValue("55");
  await expect(page.getByRole("slider", { name: "퍼짐", exact: true })).toHaveValue("60");
  await page.keyboard.press("Escape");
  if (!isMobile) {
    const rays = page.getByRole("button", { name: "빛줄기 (Veil Rays)", exact: true });
    const reflection = page.getByRole("button", { name: "물결 반사 (Mercury)", exact: true });
    await reflection.hover();
    const lens = page.locator(".hero-effect-surface > .glass-indicator");
    await expect(lens).toBeVisible();
    await expect(lens).toHaveClass(/convex-lens/);
    const target = (await reflection.boundingBox())!;
    await expect.poll(async () => Math.abs((await lens.boundingBox())!.y - target.y)).toBeLessThan(2);
    const start = await lens.boundingBox();
    await rays.hover();
    await expect(rays).toHaveAttribute("data-dock-preview", "");
    await expect.poll(async () => (await lens.boundingBox())!.y).toBeGreaterThan(start!.y + 20);
    await expect(rays).toHaveAttribute("aria-pressed", "true");
  }
});

test("reflection tuning saves independent values, resets and fits the small screen", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: isMobile ? 320 : 1280, height: isMobile ? 667 : 600 });
  await home(page); await expand(page, isMobile);
  const reflection = page.getByRole("button", { name: "물결 반사 (Mercury)", exact: true });
  await reflection.click();
  const brightness = page.getByRole("slider", { name: "밝기", exact: true });
  const scale = page.getByRole("slider", { name: "물결 크기", exact: true });
  const speed = page.getByRole("slider", { name: "흐름 속도", exact: true });
  await expect(brightness).toBeFocused();
  await brightness.press("Home"); await brightness.press("ArrowRight");
  await scale.press("End"); await speed.press("Home");
  await expect(brightness).toHaveValue("11"); await expect(scale).toHaveValue("100"); await expect(speed).toHaveValue("0");
  const box = (await page.getByRole("group", { name: "반사 조절", exact: true }).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.keyboard.press("Escape");
  await expect(reflection).toBeFocused(); await expect(reflection).toHaveAttribute("aria-pressed", "true");
  await page.reload(); await expand(page, isMobile); await reflection.click();
  await expect(brightness).toHaveValue("11"); await expect(scale).toHaveValue("100"); await expect(speed).toHaveValue("0");
  const rays = page.getByRole("button", { name: "빛줄기 (Veil Rays)", exact: true });
  await rays.click();
  await expect(page.getByRole("slider", { name: "광원 너비", exact: true })).toHaveValue("65");
  await expect(brightness).toHaveValue("55");
  await reflection.click(); await expect(brightness).toHaveValue("11");
  await page.getByRole("button", { name: "기본값으로", exact: true }).click();
  await expect(brightness).toHaveValue("50"); await expect(scale).toHaveValue("50"); await expect(speed).toHaveValue("50");
  await reflection.click();
  await expect(reflection).toHaveAttribute("aria-pressed", "false");
  await expect(rays).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".hero-light-panel")).toHaveCount(0);
});
