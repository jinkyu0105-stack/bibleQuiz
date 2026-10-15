import { expect, test, type Page } from "@playwright/test";
import type { ArchiveItem } from "../../shared/api/archive";
import { publicResponse } from "../fixtures/public-response";

const items: ArchiveItem[] = Array.from({ length: 26 }, (_, index) => ({
  slug: `2026-08-30-${String(26 - index).padStart(6, "0")}`, title: `함께 나눈 말씀 ${26 - index} (시험)`,
  sermonDate: index < 14 ? "2026-08-30" : "2025-07-27", bibleReferenceLabel: "마태복음 5:1-12",
  availableDifficulties: index === 1 ? ["child"] : ["child", "adult"],
}));
const cards = (page: Page) => page.getByTestId("archive-card");
function bodyFor(url: URL) {
  const params = url.searchParams;
  const q = (params.get("q") ?? "").trim().normalize("NFKC");
  const year = params.get("year"), month = params.get("month");
  const matches = items.filter((item) => (!q || `${item.title} ${item.bibleReferenceLabel}`.includes(q)) && (!year || item.sermonDate.startsWith(year)) && (!month || Number(item.sermonDate.slice(5, 7)) === Number(month)));
  const offset = Number(params.get("cursor")?.split(".")[1] ?? 0), limit = Number(params.get("limit") ?? 12);
  return { data: { items: matches.slice(offset, offset + limit), nextCursor: offset + limit < matches.length ? `page.${offset + limit}` : null,
    ...(offset ? {} : { availableYears: [2026, 2025], availableMonths: year === "2026" ? [8] : year === "2025" ? [7] : [7, 8] }) } };
}
async function mocks(page: Page) {
  await page.route("**/api/archive?**", (route) => route.fulfill({ json: bodyFor(new URL(route.request().url())) }));
  await page.route("**/api/quizzes/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/me")) {
      return route.fulfill({ json: { data: { submission: null } } });
    }
    const body = publicResponse(url.searchParams.get("difficulty") === "adult" ? "adult" : "child");
    body.data.otherOpenQuizzes = [{ slug: "2026-08-24-open01", title: "다른 참여 중인 퀴즈", sermonDate: "2026-08-24", bibleReferenceLabel: "마태복음 5:1-12", closesAt: "2099-09-07T00:00:00.000Z", availableDifficulties: ["child", "adult"] }];
    if (!url.pathname.endsWith("latest")) body.data.quiz!.slug = url.pathname.split("/").at(-1)!;
    return route.fulfill({ json: body });
  });
}
test("12-item pagination restores expanded count/scroll on Back and refresh without changing URL", async ({ page }) => {
  await mocks(page); await page.goto("/archive");
  await page.evaluate(() => history.replaceState({ ...history.state, foreignState: "preserved" }, ""));
  await expect(cards(page)).toHaveCount(12);
  const initialUrl = page.url();
  await page.getByRole("button", { name: "더 보기", exact: true }).click();
  await expect(cards(page)).toHaveCount(24); expect(page.url()).toBe(initialUrl);
  const target = cards(page).nth(20).getByRole("link", { name: /^장년용/ });
  await target.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  await target.click(); await expect(page).toHaveURL(/level=adult/);
  await expect(page.getByRole("grid")).toBeVisible();
  await page.goBack(); await expect(cards(page)).toHaveCount(24);
  await expect.poll(() => page.evaluate((previous) => Math.abs(window.scrollY - previous), scroll)).toBeLessThan(8);
  await page.reload(); await expect(cards(page)).toHaveCount(24);
  await expect.poll(() => page.evaluate((previous) => Math.abs(window.scrollY - previous), scroll)).toBeLessThan(8);
  const state = await page.evaluate(() => history.state);
  expect(state.bibleQuizArchive.count).toBe(24); expect(state.foreignState).toBe("preserved"); expect(JSON.stringify(state)).not.toContain("함께 나눈 말씀");
  await page.getByRole("button", { name: "더 보기", exact: true }).click();
  await expect(cards(page)).toHaveCount(26); await expect(page.getByRole("button", { name: "더 보기", exact: true })).toHaveCount(0);
});
test("search/year/month persist in URL and reset pagination, with real date choices and empty reset", async ({ page }) => {
  await mocks(page); await page.goto("/archive");
  await expect(page.getByRole("combobox", { name: "월", exact: true }).locator("option")).toHaveCount(3);
  await page.getByRole("combobox", { name: "월", exact: true }).selectOption("7");
  await expect(page).toHaveURL(/month=7/); await expect(cards(page)).toHaveCount(12);
  await page.getByRole("combobox", { name: "연도", exact: true }).selectOption("2025");
  await expect(page).toHaveURL(/year=2025&month=7/); await expect(cards(page)).toHaveCount(12);
  await page.getByLabel("설교 제목 · 성경 장절", { exact: true }).fill("  함께 나눈 말씀 1  ");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(cards(page)).toHaveCount(4); await page.reload(); await expect(cards(page)).toHaveCount(4);
  await expect(page.getByLabel("설교 제목 · 성경 장절", { exact: true })).toHaveValue("함께 나눈 말씀 1");
  await page.getByLabel("설교 제목 · 성경 장절", { exact: true }).fill("없는 검색어");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(page.getByRole("heading", { name: "찾는 지난 퀴즈가 없습니다" })).toBeVisible();
  await page.getByRole("link", { name: "검색 조건 지우기" }).click(); await expect(page).toHaveURL(/\/archive$/); await expect(cards(page)).toHaveCount(12);
  await page.goBack(); await expect(page.getByLabel("설교 제목 · 성경 장절", { exact: true })).toHaveValue("없는 검색어");
  await page.goto("/archive?month=13"); await expect(page.getByRole("alert")).toContainText("올바르지");
});
test("initial and next-page failures retry safely and reject private response fields", async ({ page }) => {
  let mode = "failure";
  await page.route("**/api/archive?**", (route) => {
    const url = new URL(route.request().url());
    if (mode === "failure" || (mode === "more-failure" && url.searchParams.has("cursor"))) return route.fulfill({ status: 503, json: { error: { message: "PRIVATE_CANARY" } } });
    const body = bodyFor(url);
    return route.fulfill({ json: mode === "private" ? { data: { ...body.data, solution: "PRIVATE_CANARY" } } : body });
  });
  await page.goto("/archive"); await expect(page.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PRIVATE_CANARY");
  mode = "more-failure"; await page.getByRole("button", { name: "다시 시도", exact: true }).click(); await expect(cards(page)).toHaveCount(12);
  await page.getByRole("button", { name: "더 보기", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("기존 목록은 남아"); await expect(cards(page)).toHaveCount(12);
  mode = "ok"; await page.getByRole("button", { name: "더 보기 다시 시도" }).click(); await expect(cards(page)).toHaveCount(24);
  mode = "private"; await page.reload(); await expect(cards(page)).toHaveCount(0); await expect(page.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
});
test("late search responses cannot overwrite new filters; loading is announced", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/archive?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("q") === "old") await gate;
    await route.fulfill({ json: bodyFor(url) }).catch(() => {});
  });
  await page.goto("/archive?q=old", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status")).toContainText("불러오고");
  await page.getByLabel("설교 제목 · 성경 장절", { exact: true }).fill("말씀");
  await page.getByRole("button", { name: "검색", exact: true }).click(); await expect(cards(page)).toHaveCount(12);
  release(); await expect(page.getByLabel("설교 제목 · 성경 장절", { exact: true })).toHaveValue("말씀"); await expect(cards(page)).toHaveCount(12);
});
test("main shows recent3, explicit difficulty links, and responsive archive in both themes", async ({ page }) => {
  await mocks(page); await page.goto("/"); await expect(cards(page)).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "아직 참여할 수 있는 퀴즈" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "다른 참여 중인 퀴즈" })).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const row = cards(page).first();
    const title = (await row.getByRole("heading").boundingBox())!;
    for (const link of await row.getByRole("link").all()) {
      const box = (await link.boundingBox())!;
      expect(box.width).toBe(44); expect(box.height).toBe(44);
      expect(box.x).toBeGreaterThanOrEqual(title.x + title.width);
      expect(box.y).toBeLessThan(title.y + title.height);
      await expect(link.locator("svg")).toHaveCount(1);
      await expect(link).toHaveText("");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("link", { name: "지난 퀴즈 전체 보기" }).click(); await expect(cards(page)).toHaveCount(12);
  await expect(cards(page).nth(1).getByRole("link", { name: /^장년용/ })).toHaveCount(0);
  await expect(cards(page).first().getByRole("link", { name: /^어린이용/ })).toHaveAttribute("href", "/quiz/2026-08-30-000026?level=child");
  for (const theme of ["light", "dark"]) {
    await page.getByRole("button", { name: (theme) === "dark" ? "밤" : "낮", exact: true }).click();
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await cards(page).first().getByRole("link").first().evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: test.info().outputPath(`archive-${theme}.png`), fullPage: true });
  }
});

test("one final wheel reaches the footer and scrolling glass restores without changing preferences", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop section wheel; mobile keeps native touch scrolling");
  await page.setViewportSize({ width: 1440, height: 900 });
  await mocks(page); await page.goto("/?video=off"); await expect(cards(page)).toHaveCount(3);
  const before = await page.locator("body").getAttribute("data-transparency");
  await page.locator(".hero-cta").click();
  await expect.poll(() => page.locator("#weekly").evaluate(n => Math.abs(n.getBoundingClientRect().top))).toBeLessThan(2);
  await expect(page.locator("html")).not.toHaveAttribute("data-home-scrolling");
  const glass = page.locator(".archive-list");
  const optics = await glass.evaluate(n => getComputedStyle(n, "::before").backdropFilter);
  expect(optics).not.toBe("none");
  await page.mouse.move(600, 350); await page.mouse.wheel(0, 80);
  await expect(page.locator("html")).toHaveAttribute("data-home-scrolling", "true");
  await expect.poll(() => glass.evaluate(n => getComputedStyle(n, "::before").backdropFilter)).toBe("none");
  await expect.poll(() => page.evaluate(() => Math.abs(document.documentElement.scrollHeight - innerHeight - scrollY))).toBeLessThan(2);
  await expect(page.locator("footer")).toBeInViewport();
  await expect(page.locator("html")).not.toHaveAttribute("data-home-scrolling");
  await expect.poll(() => glass.evaluate(n => getComputedStyle(n, "::before").backdropFilter)).toBe(optics);
  await expect(page.locator("body")).toHaveAttribute("data-transparency", before!);
  await page.getByRole("link", { name: "지난 퀴즈 전체 보기" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-home-scrolling");
  await expect.poll(() => page.locator("html").evaluate(n => (n as HTMLElement).style.getPropertyValue("--home-footer-height"))).toBe("");
});
