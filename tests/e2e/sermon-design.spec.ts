import { expect, test } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";

test("adult and child have distinct desktop compositions with functional reading and quiz links", async ({ page }) => {
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
    await expect(hero.locator("img")).toHaveJSProperty("complete", true);
    const title = await page.locator("#sermon-heading").boundingBox();
    expect(title).not.toBeNull();
    expect(level === "adult" ? title!.x > 720 : title!.x < 360).toBe(true);
    if (level === "child") {
      const metadata = await hero.locator(".sermon-meta").boundingBox();
      expect(metadata!.y).toBeGreaterThan(title!.y + title!.height);
    }
    await expect(page.locator(".summary-copy")).toHaveText(fullSummary);
    await hero.getByRole("link", { name: level === "adult" ? "퀴즈 풀기" : "함께 퀴즈 풀기" }).click();
    await expect(page).toHaveURL(/#quiz-panel$/);
    await expect(page.getByRole("grid", { name: "낱말 퀴즈 격자" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
