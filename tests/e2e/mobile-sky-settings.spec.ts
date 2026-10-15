import { expect, test, type Page } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";
import { openSkySettings } from "./sky-control-helpers";

async function home(page: Page) {
  await page.route("**/api/quizzes/**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/me") ? { data: { submission: null } } : publicResponse("child") }));
  await page.goto("/?video=off");
  await expect(page.locator("#home-title")).toBeVisible();
}

test("phone header stays in one row and the fourth dock button reveals all settings", async ({ page }) => {
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    await home(page);
    const header = (await page.locator(".site-header").boundingBox())!;
    expect(header.height).toBe(60);
    for (const item of [".brand", ".site-navigation", ".admin-link"]) {
      const box = (await page.locator(item).boundingBox())!;
      expect(Math.abs(box.y + box.height / 2 - header.y - header.height / 2)).toBeLessThan(2);
      expect(box.x).toBeGreaterThanOrEqual(header.x); expect(box.x + box.width).toBeLessThanOrEqual(header.x + header.width);
    }
    const admin = page.getByRole("link", { name: "관리 공간", exact: true });
    const adminBox = (await admin.boundingBox())!;
    expect(adminBox.width).toBe(44); expect(adminBox.height).toBe(44);
    const dock = page.getByRole("navigation", { name: "빠른 이동" });
    await expect(dock.locator(":scope > a, :scope > button")).toHaveCount(4);
    expect((await dock.boundingBox())!.width).toBeLessThanOrEqual(250);
    await expect(page.locator(".time-rail")).toBeHidden();
    await openSkySettings(page);
    const popup = page.getByRole("dialog", { name: "화면 설정", exact: true });
    await expect(popup).toBeVisible(); expect((await popup.boundingBox())!.width).toBe(236);
    for (const label of ["새벽", "낮", "노을", "밤", "배경 움직임 멈춤", "배경 효과", "투명도 줄이기", "잔디 끄기"]) {
      const button = popup.getByRole("button", { name: label, exact: true });
      await expect(button).toBeVisible(); const box = (await button.boundingBox())!;
      // Firefox may report 43.999992 for a 44 CSS-pixel target.
      expect(Number(box.width.toFixed(2))).toBeGreaterThanOrEqual(44); expect(Number(box.height.toFixed(2))).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "화면 설정 닫기", exact: true }).click();
    await expect(page.getByRole("button", { name: "화면 설정", exact: true })).toBeFocused();
  }
});

test("the mobile dock lends its glass lens to settings and returns it home on every close", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  const dock = page.getByRole("navigation", { name: "빠른 이동" });
  const homeLink = dock.getByRole("link", { name: "홈", exact: true });
  const settings = dock.getByRole("button", { name: "화면 설정", exact: true });
  const lens = dock.locator(":scope > .glass-indicator");
  async function at(target: typeof settings) {
    await expect(lens).toHaveCount(1);
    await expect.poll(async () => {
      const a = (await lens.boundingBox())!, b = (await target.boundingBox())!;
      return Math.abs(a.x + a.width / 2 - b.x - b.width / 2);
    }).toBeLessThan(1);
    await expect(homeLink).toHaveAttribute("aria-current", "page");
  }
  async function toggle() { if (isMobile) await settings.tap(); else await settings.click(); }
  await at(homeLink);
  const travel = page.evaluate(() => new Promise<number[]>(resolve => {
    const positions: number[] = [], end = performance.now() + 1000;
    function sample(time: number) {
      positions.push(document.querySelector(".page-dock > .glass-indicator")!.getBoundingClientRect().x);
      if (time < end) requestAnimationFrame(sample); else resolve(positions);
    }
    requestAnimationFrame(sample);
  }));
  await toggle(); await at(settings);
  expect(new Set((await travel).map(x => x.toFixed(1))).size).toBeGreaterThan(2);
  await expect(settings).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await toggle(); await at(homeLink);
  await expect(settings).toBeFocused();
  await settings.press("Enter"); await at(settings);
  await page.keyboard.press("Escape"); await at(homeLink);
  await expect(settings).toBeFocused();
  await toggle(); await at(settings);
  await page.mouse.click(4, 200); await at(homeLink);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await toggle(); await at(settings);
  await page.getByRole("button", { name: "화면 설정 닫기", exact: true }).click(); await at(homeLink);
  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(settings).toBeHidden(); await at(homeLink);
  await expect(page.locator(".admin-link-label")).toBeVisible();
  await expect(page.locator("#glass-clarity small")).toBeVisible();
});

test("nested controls close in order, retain values and ignore old aurora preferences", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 667 });
  await page.addInitScript(() => localStorage.setItem("bibleQuiz:aurora-spire", "true"));
  await home(page); await openSkySettings(page);
  const settings = page.getByRole("button", { name: "화면 설정", exact: true });
  const effects = page.getByRole("button", { name: "배경 효과", exact: true });
  await effects.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /오로라/ })).toHaveCount(0);
  expect(await page.locator("body").getAttribute("data-hero-aurora")).toBeNull();
  const silk = page.getByRole("button", { name: "비단결 (Silk Flow)", exact: true });
  await silk.click();
  const speed = page.getByRole("slider", { name: "흐름 속도", exact: true });
  await speed.press("End");
  await page.keyboard.press("Escape"); await expect(silk).toBeFocused();
  await expect(page.locator(".hero-light-panel")).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(effects).toBeFocused();
  await expect(settings).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape"); await expect(settings).toBeFocused();
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("body")).toHaveAttribute("data-hero-silk", "on");
  await openSkySettings(page); await effects.focus(); await page.keyboard.press("Enter"); await silk.click();
  await expect(speed).toHaveValue("100");
  await page.mouse.click(4, 200);
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".hero-light-panel")).toHaveCount(0);
  await page.reload(); await openSkySettings(page); await effects.focus(); await page.keyboard.press("Enter"); await silk.click();
  await expect(speed).toHaveValue("100");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.locator("#grass-toggle").focus(); await page.keyboard.press("Tab");
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test("landscape controller stays beside the popup and resizing restores the desktop rail", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await home(page); await openSkySettings(page);
  const effects = page.getByRole("button", { name: "배경 효과", exact: true });
  await effects.focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "빛줄기 (Veil Rays)", exact: true }).click();
  const panel = page.getByRole("group", { name: "빛줄기 조절", exact: true });
  await expect.poll(async () => (await panel.boundingBox())!.x - ((await page.locator(".time-rail").boundingBox())!.x + 236)).toBeGreaterThanOrEqual(10);
  await page.getByRole("slider", { name: "흐름 속도", exact: true }).press("End");
  await page.getByRole("button", { name: "기본값으로", exact: true }).click();
  const box = (await panel.boundingBox())!; expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(375);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".mobile-settings-trigger")).toBeHidden();
  await expect(page.getByRole("button", { name: "낮", exact: true })).toBeVisible();
  await expect(page.locator(".hero-light-panel")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".time-rail")).toBeHidden();
  await expect(page.getByRole("button", { name: "화면 설정", exact: true })).toBeFocused();
  await openSkySettings(page); await page.getByRole("button", { name: "밤", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-time", "night");
});
