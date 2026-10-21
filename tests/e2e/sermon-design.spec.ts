import { expect, test } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";

test("adult and child share the sky composition with full reviewed summaries and functional links", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fullSummary = "관리자가 검토한 설교 요약입니다. ".repeat(20) + "전문 마지막 문장도 보존합니다.";
  await page.route("**/api/quizzes/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/me")) return route.fulfill({ json: { data: { submission: null } } });
    const response = publicResponse(url.searchParams.get("difficulty") === "adult" ? "adult" : "child");
    response.data.quiz!.sermon.summary!.text = fullSummary;
    return route.fulfill({ json: response });
  });
  for (const level of ["adult", "child"]) {
    await page.goto(`/?level=${level}`);
    const hero = page.getByRole("region", { name: "함께 돌아보는 한 주 (테스트)", exact: true });
    await expect(hero).toBeVisible();
    await expect(page.locator('#world .day-sky')).toHaveJSProperty('complete', true);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'quiz');
    const title = await page.locator("#sermon-heading").boundingBox();
    expect(title!.x).toBeGreaterThanOrEqual(0);
    expect(title!.x + title!.width).toBeLessThanOrEqual(1440);
    await expect(page.locator('.quiz-reader').first()).toHaveAttribute('data-glass-panel', 'standard');
    await expect(page.locator('#quiz-panel')).toHaveCSS('background-color', /^rgb\(/);
    const summary = page.locator('.sermon-summary > summary');
    await summary.click();
    await expect(page.locator(".summary-copy")).toHaveText(fullSummary);
    await expect(page.locator(".summary-copy")).toBeVisible();
    await summary.click();
    await expect(page.locator(".summary-copy")).toBeHidden();
    await hero.getByRole("button", { name: "설교일", exact: true }).click();
    await expect(page.getByRole("tooltip", { name: /설교일 ·/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "다사랑교회 성경퀴즈 처음으로", exact: true })).toHaveAttribute("href", "/");
    await expect(page.getByRole("grid", { name: "낱말 퀴즈 격자" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
