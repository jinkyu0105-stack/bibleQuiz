import { expect, test, type Page } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";
import { openSkySettings } from "./sky-control-helpers";

test.use({ hasTouch: true });

async function home(page: Page) {
  await page.route("**/api/quizzes/**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/me") ? { data: { submission: null } } : publicResponse("child") }));
  await page.goto("/?video=off");
  await expect(page.locator("#home-title")).toBeVisible();
}

test("header lens remains on the current link during narrow resizing without reload", async ({ page }) => {
  await page.setViewportSize({ width: 425, height: 812 });
  await home(page);
  await page.evaluate(() => document.fonts.ready);
  const nav = page.getByRole("navigation", { name: "주요 메뉴" });
  async function aligned() {
    await expect.poll(async () => {
      const selected = (await nav.locator("[aria-current=page]").boundingBox())!;
      const lens = await nav.locator(".glass-indicator").boundingBox();
      return lens ? Math.max(Math.abs(lens.x - selected.x), Math.abs(lens.y - selected.y), Math.abs(lens.width - selected.width)) : Infinity;
    }).toBeLessThan(1);
  }
  await aligned();
  for (const width of [375, 320, 428]) { await page.setViewportSize({ width, height: 812 }); await aligned(); }
  await nav.getByRole("link", { name: "지난 퀴즈", exact: true }).tap();
  await expect(page).toHaveURL(/\/archive$/); await aligned();
  for (const width of [375, 320, 425]) { await page.setViewportSize({ width, height: 812 }); await aligned(); }
});

test("touch hero links stay at their destination after landing and delayed quiz content", async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/quizzes/**", async route => {
    await waiting;
    await route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/me") ? { data: { submission: null } } : publicResponse("child") });
  });
  await page.setViewportSize({ width: 428, height: 746 });
  await page.goto("/?video=off");
  const hero = page.locator(".hero-cta");
  await expect(hero).toBeVisible();
  await expect(hero.locator("span")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await hero.tap();
  const atWeekly = () => expect.poll(() => page.locator("#weekly").evaluate(el => Math.abs(el.getBoundingClientRect().top))).toBeLessThan(2);
  await atWeekly();
  release();
  await expect(page.locator(".weekly-sheet h3")).toBeVisible();
  await page.waitForTimeout(800);
  await atWeekly();
  await expect(page.locator("html")).not.toHaveAttribute("data-home-scroll-animating");
  await page.locator(".site-footer a").tap();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(2);
  await hero.tap(); await atWeekly();
  await page.waitForTimeout(800); await atWeekly();
  await page.goBack();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(2);
  await page.goForward(); await atWeekly();
});

test("mobile effect choices replace time controls while the star stays put and all touch toggles work", async ({ page }) => {
  // Three controllers, native sliders and repeated touch gestures also run on software WebKit.
  test.setTimeout(90_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 667 });
  await home(page); await openSkySettings(page);
  const star = page.getByRole("button", { name: "배경 효과", exact: true });
  const time = page.getByRole("group", { name: "하늘 시간대", exact: true });
  const timeBox = (await time.boundingBox())!, starBox = (await star.boundingBox())!;
  const choices = [
    { name: "물결 반사 (Mercury)", kind: "mercury", panel: "반사 조절" },
    { name: "빛줄기 (Veil Rays)", kind: "veil", panel: "빛줄기 조절" },
    { name: "비단결 (Silk Flow)", kind: "silk", panel: "비단결 조절" },
  ];
  for (const choice of choices) {
    await star.tap();
    await expect(time).toBeHidden();
    await expect(star).toBeVisible();
    expect(await star.boundingBox()).toEqual(starBox);
    const row = page.getByRole("group", { name: "효과 선택", exact: true });
    await expect.poll(async () => Math.abs((await row.boundingBox())!.y - timeBox.y)).toBeLessThan(1);
    const option = page.getByRole("button", { name: choice.name, exact: true });
    await option.tap();
    const panel = page.getByRole("group", { name: choice.panel, exact: true });
    await expect(panel).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute(`data-hero-${choice.kind}`, "on");
    // iOS can clear focus without moving it to the tapped button. That blur
    // must not dismiss the controller before the following click toggles it.
    await panel.getByRole("slider").first().evaluate(el => (el as HTMLElement).blur());
    await expect(panel).toBeVisible();
    await option.tap();
    await expect(page.locator("body")).toHaveAttribute(`data-hero-${choice.kind}`, "off");
    await expect(panel).toHaveCount(0);
    await option.tap();
    const speed = panel.getByRole("slider", { name: "흐름 속도", exact: true });
    await speed.press("End"); await expect(speed).toHaveValue("100");
    const power = panel.getByRole("switch", { name: "효과 사용", exact: true });
    await power.tap(); await expect(power).toHaveAttribute("aria-checked", "false");
    await expect(panel).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute(`data-hero-${choice.kind}`, "off");
    await power.tap(); await expect(power).toHaveAttribute("aria-checked", "true");
    await expect(speed).toHaveValue("100");
    const reset = panel.getByRole("button", { name: "기본값으로", exact: true });
    await expect(reset.locator("span")).toBeHidden();
    await expect(reset.locator("svg")).toBeVisible();
    await reset.tap(); await expect(speed).toHaveValue("50");
    await panel.getByRole("button", { name: `${choice.panel} 닫기`, exact: true }).tap();
    await expect(time).toBeVisible(); await expect(star).toBeFocused();
    expect(await star.boundingBox()).toEqual(starBox);
  }
  await star.tap(); await star.tap(); await expect(time).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await star.tap();
  await page.getByRole("navigation", { name: "빠른 이동" }).getByRole("link", { name: "문의", exact: true }).tap();
  await openSkySettings(page); await expect(time).toBeVisible();
  await expect(star).toHaveCount(0);
  expect(errors).toEqual([]);
});
