import { expect, test } from "@playwright/test";

const at = "2026-10-10T00:00:00.000Z";
test("admin menus keep one hover lens and action buttons share square glass without per-button filters", async ({ page, isMobile }) => {
  test.setTimeout(60_000);
  const requests: string[] = [];
  await page.route("**/api/admin/**", route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path.endsWith("/usage-summary")) return route.fulfill({ status: 503, json: { error: { message: "합성 조회 대기" } } });
    if (path.endsWith("/manual")) return route.fulfill({ json: { data: { markdown: "# 운영 안내", updatedAt: at, verification: "합성 검사", deployment: "local" } } });
    return route.fulfill({ json: { data: path.endsWith("/dashboard") ? { items: [], unansweredCount: 0 } : { items: [] } } });
  });
  await page.goto("/admin");
  const refresh = page.getByRole("button", { name: "운영 상태 새로고침", exact: true });
  await expect(refresh).toBeVisible();
  const before = requests.filter(path => path.endsWith("/dashboard")).length;
  await refresh.click();
  await expect.poll(() => requests.filter(path => path.endsWith("/dashboard")).length).toBeGreaterThan(before);
  for (const name of ["운영 상태 새로고침", "비용·백업 상세 열기", "사용량 다시 조회"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toHaveCSS("border-radius", "10px");
    await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(button).not.toHaveAttribute("data-lens-ready");
    await button.focus();
    await expect(button).toBeFocused();
  }
  if (isMobile) await page.locator("summary").filter({ hasText: "관리자 운영 메뉴" }).click();
  const navigation = page.getByRole("navigation", { name: "관리자 운영 메뉴" });
  if (!isMobile) {
    const target = navigation.getByRole("link", { name: "이름·문구 필터", exact: true });
    await target.hover();
    await expect(target).toHaveAttribute("data-dock-preview", "");
    await expect(target).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(navigation.getByRole("link", { name: "주간 운영", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(navigation.locator(":scope > .glass-indicator")).toHaveCount(1);
  }
  // Existing actions across all sidebar destinations use the same component,
  // including controls that start disabled inside a fieldset or dialog.
  for (const path of ["/admin/moderation", "/admin/privacy-requests", "/admin/tools", "/admin/operations", "/admin/manual"]) {
    await page.goto(path);
    const buttons = page.locator(".admin-main button");
    await expect(buttons.first()).toBeVisible();
    const classes = await buttons.evaluateAll(nodes => nodes.map(node => node.classList.contains("glass-button")));
    expect(classes.every(Boolean)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "밤", exact: true }).click();
  await expect(page.locator(".admin-main button.glass-button").first()).toHaveCSS("color", "rgb(240, 246, 255)");
  await page.getByRole("button", { name: "투명도 줄이기", exact: true }).click();
  expect(await page.locator(".admin-main button.glass-button").first().evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.locator(".admin-main button.glass-button").first()).toBeVisible();
});
