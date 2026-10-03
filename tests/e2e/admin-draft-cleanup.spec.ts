import { expect, test } from "@playwright/test";
test("shows cleanup times, preserved-data notice, expired and blocked states; retries a read without offering deletion", async ({ page }, testInfo) => {
  let fail = true;
  await page.route("**/api/admin/draft-cleanup", route => {
    expect(route.request().method()).toBe("GET");
    if (fail) return route.fulfill({ status: 503, json: { error: { message: "synthetic" } } });
    return route.fulfill({ json: { data: { items: [
      { sermonId: "s1", title: "정리 예정 합성 설교", dueAt: "2026-09-27T00:00:00.000Z", state: "scheduled", reason: null },
      { sermonId: "s2", title: "완료된 합성 초안", dueAt: "2026-09-26T00:00:00.000Z", state: "purged", reason: "expired" },
      { sermonId: "s3", title: "확인할 합성 자료", dueAt: "2026-09-26T00:00:00.000Z", state: "blocked", reason: "publication_missing" },
    ] } } });
  });
  await page.goto("/admin/tools");
  const panel = page.getByRole("region", { name: "초안 정리 예정" });
  await expect(panel.getByRole("status")).toContainText("불러오지 못했습니다");
  fail = false;
  await panel.getByRole("button", { name: "다시 확인" }).click();
  await expect(panel).toContainText("정리 예정 합성 설교");
  await expect(panel).toContainText("오전 9:00");
  await expect(panel).toContainText("AI 비용은 보존");
  await expect(panel).toContainText("새 초안에서 시작");
  await expect(panel).toContainText("발행 자료의 보존 상태");
  await expect(panel.getByRole("button")).toHaveCount(0);
  await panel.screenshot({ path: testInfo.outputPath("cleanup-light.png") });
  await page.getByLabel("화면 테마").selectOption("dark");
  await panel.screenshot({ path: testInfo.outputPath("cleanup-dark.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await expect(panel).toContainText("정리 예정 합성 설교");
});

test("shows an empty cleanup list", async ({ page }) => {
  await page.route("**/api/admin/draft-cleanup", route => route.fulfill({ json: { data: { items: [] } } }));
  await page.goto("/admin/tools");
  await expect(page.getByRole("region", { name: "초안 정리 예정" })).toContainText("하루 안에 정리할 초안이 없습니다");
});
