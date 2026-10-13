import { openAdminTool } from "../fixtures/admin-tools";
import { expect, test } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";

const at = "2026-10-10T00:00:00.000Z";
test("admin menus group tasks, retain the glass hover and use compact shared actions", async ({ page, isMobile }, info) => {
  test.setTimeout(60_000);
  const requests: string[] = [];
  await page.route("**/api/admin/**", route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path.endsWith("/usage-summary")) return route.fulfill({ status: 503, json: { error: { message: "합성 조회 대기" } } });
    if (path.endsWith("/manual")) return route.fulfill({ json: { data: { markdown: "# 운영 안내", updatedAt: at, verification: "합성 검사", deployment: "local" } } });
    return route.fulfill({ json: { data: path.endsWith("/dashboard") ? { items: [], unansweredCount: 0 } : { items: [] } } });
  });
  const reference = publicResponse("child");
  Object.assign(reference.data.quiz!, { status: "archived", availability: "archived", mode: "practice", acceptingSubmissions: false, solutionAccess: "public" });
  await page.route("**/api/quizzes/**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/me") ? { data: { submission: null } } : reference }));
  await page.goto("/quiz/2026-08-31-test01?level=child");
  const solution = page.getByRole("button", { name: "정답보기", exact: true });
  await expect(solution).toHaveAttribute("aria-disabled", "false");
  await page.getByRole("button", { name: "낮", exact: true }).click();
  const material = await solution.evaluate(node => {
    const style = getComputedStyle(node);
    return Object.fromEntries(["background-color", "color", "border-color", "border-radius", "box-shadow", "backdrop-filter"].map(name => [name, style.getPropertyValue(name)]));
  });
  await page.goto("/admin");
  const refresh = page.getByRole("button", { name: "운영 상태 새로고침", exact: true });
  await expect(refresh).toBeEnabled();
  const before = requests.filter(path => path.endsWith("/dashboard")).length;
  await refresh.click();
  await expect.poll(() => requests.filter(path => path.endsWith("/dashboard")).length).toBeGreaterThan(before);
  for (const [name, value] of Object.entries(material)) await expect(refresh).toHaveCSS(name, value);
  await expect(refresh).toHaveCSS("min-height", "44px");
  expect(await refresh.evaluate(node => getComputedStyle(node, "::before").content)).toBe("none");
  await expect(refresh).not.toHaveAttribute("data-lens-ready");
  await expect(page.getByRole("heading",{name:"퀴즈 관리",exact:true})).toHaveCSS("font-family", /Noto Serif KR/);
  await page.locator(".admin-main").screenshot({ path: info.outputPath("admin-buttons-day.png") });
  const sidebar=page.locator("aside[data-glass-panel=standard]"),navigation=page.getByRole("navigation",{name:"관리자 운영 메뉴"});
  const toggle=sidebar.locator("summary").filter({hasText:"관리자 운영 메뉴"});
  if (isMobile) {
    await toggle.focus(); await page.keyboard.press("Enter"); await expect(navigation).toBeVisible();
    await page.keyboard.press("Space"); await expect(navigation).toBeHidden();
    await page.keyboard.press("Enter");
  } else {
    await expect(sidebar.getByRole("heading",{name:"관리 공간"})).toBeVisible();
    await expect(sidebar.getByRole("heading",{name:"관리 공간"})).toHaveCSS("font-family", /Noto Sans KR/);
    await expect(sidebar.getByRole("heading",{name:"관리 공간"})).toHaveCSS("font-weight", "700");
    await expect(sidebar).toHaveCSS("width","220px");
    const label = await sidebar.getByRole("heading", {name:"관리 공간",exact:true}).boundingBox();
    const firstLink = await navigation.getByRole("link", {name:"퀴즈 관리",exact:true}).boundingBox();
    expect(firstLink!.y - label!.y - label!.height).toBeLessThanOrEqual(12);
  }
  await expect(navigation.getByRole("link")).toHaveCount(3);
  await navigation.locator("summary").filter({hasText:"도구와 설정"}).click();
  await expect(navigation.getByRole("link")).toHaveCount(7);
  if (!isMobile) {
    const target=navigation.getByRole("link",{name:"이름·문구 필터",exact:true});
    await target.hover();
    await expect(target).toHaveAttribute("data-dock-preview", "");
    await expect(target).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(target.locator("..").locator(":scope > .glass-indicator")).toHaveCount(1);
  }
  await sidebar.screenshot({path:info.outputPath("sidebar-grouped.png")});
  const filterLink=navigation.getByRole("link",{name:"이름·문구 필터",exact:true});
  await filterLink.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/moderation$/);
  await expect(sidebar.locator("[aria-current=page]")).toHaveCount(1);
  await expect(sidebar.locator('a[href="/admin/moderation"]')).toHaveAttribute("aria-current","page");
  for (const path of ["/admin/moderation", "/admin/privacy-requests", "/admin/tools", "/admin/operations", "/admin/manual"]) {
    await page.goto(path);
    if (path === "/admin/tools") await openAdminTool(page, "metadata");
    if (path === "/admin/manual") {
      await expect(page.getByRole("heading", {name: "운영 매뉴얼", exact: true})).toBeVisible();
      await expect(page.locator(".admin-main .action-button")).toHaveCount(0);
    } else {
      const button=page.locator(".admin-main .action-button").first();
      await expect(button).toBeVisible();
      await expect(button).toHaveCSS("min-height","44px");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/admin/operations");
  await page.getByRole("button", { name: "밤", exact: true }).click();
  await expect(page.locator(".admin-main button.secondary-button").first()).toHaveCSS("color", "rgb(240, 246, 255)");
  await page.getByRole("button", { name: "투명도 줄이기", exact: true }).click();
  expect(await page.locator(".admin-main button.secondary-button").first().evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".admin-main").screenshot({ path: info.outputPath("admin-night-320.png") });
  await page.goto("/admin/manual");
  if (!await navigation.isVisible()) await toggle.click();
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  const manualLink=navigation.getByRole("link",{name:"도움말",exact:true});
  await manualLink.focus(); await expect(manualLink).toBeFocused();
  await expect(manualLink).toHaveAttribute("aria-current","page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
