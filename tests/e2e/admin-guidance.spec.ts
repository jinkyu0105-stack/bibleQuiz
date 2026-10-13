import { expect, test, type Page } from "@playwright/test";
import { openAdminTool } from "../fixtures/admin-tools";

async function emptyAdmin(page: Page) {
  const writes: string[] = [];
  await page.route("**/api/admin/**", route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      writes.push(path);
      return route.fulfill({ status: 405, json: { error: { message: "안내 탐색은 저장하지 않습니다." } } });
    }
    if (path.endsWith("/usage-summary")) return route.fulfill({ status: 503, json: { error: { message: "합성 사용량 미연결" } } });
    const data = path.endsWith("/dashboard") ? { items: [], unansweredCount: 0 }
      : path.endsWith("/backups") ? { enabled: false, weeklyVerifiedCount: 0, items: [], manifestUpdatedAt: null }
      : path.endsWith("/manual") ? { markdown: "# 운영 안내\n\n합성 운영 안내 본문입니다.", updatedAt: "2026-10-12", verification: "합성 검사", deployment: "local" }
      : { items: [] };
    return route.fulfill({ json: { data } });
  });
  return writes;
}

test("operators choose a tool by purpose and retain unfinished input when closing it", async ({ page }, info) => {
  const writes = await emptyAdmin(page);
  await page.goto("/admin/tools");
  await page.getByRole("button", { name: "낮", exact: true }).click();
  await expect(page.locator("details[data-admin-tool]")).toHaveCount(6);
  await expect(page.locator("details[data-admin-tool][open]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "퀴즈 목록으로" })).toHaveAttribute("href", "/admin");
  await page.locator(".admin-main").screenshot({ path: info.outputPath("tools-overview-day.png") });

  const bible = page.locator('[data-admin-tool="bible"]');
  const toggle = bible.locator(":scope > summary");
  await toggle.focus();
  await page.keyboard.press("Enter");
  const field = bible.getByRole("textbox", { name: "성경 장절", exact: true });
  await field.fill("요한복음 3:16");
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(field).toBeHidden();
  await expect(toggle).toBeFocused();
  await openAdminTool(page, "metadata");
  await expect(page.getByRole("region", { name: "발행 정보 정정", exact: true })).toBeVisible();
  await toggle.click();
  await expect(field).toHaveValue("요한복음 3:16");
  await expect(page.locator("details[data-admin-tool][open]")).toHaveCount(2);
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "밤", exact: true }).click();
  await bible.screenshot({ path: info.outputPath("tool-open-night.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.keyboard.press("Tab");
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveCSS("outline-style", "solid");
});

test("admin destinations explain their next action and empty states without mutations", async ({ page }, info) => {
  test.setTimeout(60_000);
  const writes = await emptyAdmin(page);
  const destinations = [
    ["/admin", "퀴즈 관리"],
    ["/admin/moderation", "이름·문구 필터 관리"],
    ["/admin/privacy-requests", "문의·삭제 요청"],
    ["/admin/submissions", "참여 기록"],
    ["/admin/operations", "비용·백업 상태"],
    ["/admin/manual", "운영 매뉴얼"],
  ];
  for (const [path, title] of destinations) {
    await page.goto(path!);
    await expect(page.getByRole("heading", { name: title!, exact: true }).last()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".admin-main").screenshot({ path: info.outputPath(`${path!.split("/").pop()}-guide.png`) });
  }
  await expect(page.getByRole("navigation", { name: "자주 찾는 운영 작업" })).toHaveCount(0);
  await page.goto("/admin/privacy-requests");
  await page.locator("summary").filter({hasText:"사용 방법"}).click();
  await expect(page.getByText(/상태 변경만으로 기록은 삭제되지 않습니다/)).toBeVisible();
  await page.goto("/admin/submissions");
  await expect(page.getByText("관리할 퀴즈를 선택하면 제출 기록이 표시됩니다.", { exact: true })).toBeVisible();
  await page.locator("summary").filter({ hasText: "숨김·복원·삭제는 어떻게 다른가요?" }).click();
  await expect(page.getByText("공개 참여 현황과 Top N에서 제외합니다. 기록은 남습니다.", { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});
