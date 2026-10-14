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
  await expect(reflection).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Tab");
  const rays = page.getByRole("button", { name: "빛줄기 (Veil Rays)", exact: true });
  await expect(rays).toBeFocused();
  await page.keyboard.press("Enter");
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
