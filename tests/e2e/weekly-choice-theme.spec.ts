import { expect, test } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";
import { mockAdminGuide } from "./fixtures/admin-guide";
import { selectSkyTime } from "./sky-control-helpers";

test("header opens the shared chooser in place, restores focus and opens the currently selected quiz", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/quizzes/**", route => {
    if (route.request().url().includes("/me")) return route.fulfill({ json: { data: { submission: null } } });
    requests++; const level = new URL(route.request().url()).searchParams.get("difficulty") === "adult" ? "adult" : "child";
    return route.fulfill({ json: publicResponse(level) });
  });
  await page.goto("/archive");
  expect(requests).toBe(0);
  const trigger = page.locator(".site-header").getByRole("button", { name: "이번 주 퀴즈", exact: true });
  for (const time of ["새벽", "낮", "노을", "밤"]) {
    await selectSkyTime(page, time);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "이번 주 퀴즈 선택" });
    await expect(dialog.getByRole("link", { name: "장년 퀴즈" })).toHaveAttribute("href", "/quiz/2026-08-31-test01?level=adult");
    await expect(page).toHaveURL(/\/archive$/);
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  }
  await trigger.click(); await page.getByRole("dialog", { name: "이번 주 퀴즈 선택" }).getByRole("link", { name: "장년 퀴즈" }).click();
  await expect(page).toHaveURL(/\/quiz\/2026-08-31-test01\?level=adult$/);
  await expect(page.getByRole("grid")).toBeVisible();
});
test("weekly choice handles retry, empty and adult-only results without leaving the current page", async ({ page }) => {
  let mode = "error";
  await page.route("**/api/quizzes/latest?**", route => {
    if (mode === "error") return route.fulfill({ status: 503, json: { error: {} } });
    if (mode === "empty") return route.fulfill({ json: { data: { quiz: null, otherOpenQuizzes: [] } } });
    if (route.request().url().endsWith("child")) return route.fulfill({ status: 404, json: { error: {} } });
    const data = publicResponse("adult"); data.data.quiz!.availableDifficulties = ["adult"];
    return route.fulfill({ json: data });
  });
  await page.goto("/archive"); const trigger = page.getByRole("button", { name: "이번 주 퀴즈", exact: true });
  await trigger.click(); const dialog = page.getByRole("dialog", { name: "이번 주 퀴즈 선택" });
  await expect(dialog.getByRole("button", { name: "다시 시도" })).toBeVisible(); mode = "empty";
  await dialog.getByRole("button", { name: "다시 시도" }).click(); await expect(dialog).toContainText("아직 공개된 퀴즈가 없습니다.");
  await dialog.getByRole("button", { name: "선택창 닫기" }).click(); mode = "adult";
  await trigger.click(); await expect(dialog.getByRole("link")).toHaveCount(1); await expect(dialog.getByRole("link", { name: "장년 퀴즈" })).toBeVisible();
});
test("monthly editor preserves failed input, handles a newer save and restores stored values after reload", async ({ page }) => {
  await mockAdminGuide(page);
  let theme = "", revision: string | null = null, fail = false;
  await page.route("**/api/admin/sermon-themes/*", async route => {
    const month = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (route.request().method() === "PATCH") {
      const command = route.request().postDataJSON() as { theme: string; expectedRevision: string | null };
      if (fail || command.expectedRevision !== revision) return route.fulfill({ status: 409, json: { error: { message: "다른 창에서 먼저 저장했습니다." } } });
      theme = command.theme; revision = new Date(Date.now()).toISOString();
    }
    return route.fulfill({ json: { data: { month, theme, revision } } });
  });
  await page.goto("/admin"); await page.getByText("월별 설교 주제", { exact: true }).click();
  const input = page.getByLabel("월별 주제", { exact: true }), save = page.getByRole("button", { name: "주제 저장" });
  await expect(input).toBeEnabled(); await input.fill("함께 자라는 믿음");
  await expect(page.getByLabel("설교 월", { exact: true })).toBeDisabled();
  fail = true; await save.click(); await expect(page.getByRole("alert")).toContainText("다른 창"); await expect(input).toHaveValue("함께 자라는 믿음");
  theme = "먼저 저장된 내용"; revision = "2026-10-19T00:00:00.000Z"; fail = false;
  await page.getByRole("button", { name: "최신 상태 확인" }).click(); await expect(input).toBeEnabled(); await expect(input).toHaveValue("함께 자라는 믿음");
  await save.click(); await expect(page.getByRole("form", { name: "월별 설교 주제" }).getByRole("status")).toContainText("저장했습니다");
  await page.reload(); await page.getByText("월별 설교 주제", { exact: true }).click(); await expect(input).toHaveValue("함께 자라는 믿음");
  for (const time of ["새벽", "낮", "노을", "밤"]) {
    await selectSkyTime(page, time);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await input.fill(""); await save.click(); await expect(page.getByRole("form", { name: "월별 설교 주제" }).getByRole("status")).toContainText("저장했습니다"); expect(theme).toBe("");
});
test("archive shows week and monthly theme above title/reference with compact date tiles", async ({ page }) => {
  await page.route("**/api/archive?**", route => route.fulfill({ json: { data: { items: [{slug:"2026-10-04-test01",title:"함께 걷는 길",sermonDate:"2026-10-04",bibleReferenceLabel:"요한복음 3:16",monthlyTheme:"서로 사랑하며 자라는 믿음",availableDifficulties:["child","adult"]}],nextCursor:null,availableYears:[2026],availableMonths:[10] } } }));
  await page.goto("/archive"); const row = page.getByTestId("archive-card");
  await expect(row).toContainText("주제: 서로 사랑하며 자라는 믿음");
  for (const width of [3440,2560,1440,1024,768,425,375,320]) {
    await page.setViewportSize({ width, height: 1000 });
    const week = (await row.getByText("10월 첫째 주", { exact: true }).boundingBox())!, title = (await row.getByRole("heading").boundingBox())!;
    expect(week.y + week.height).toBeLessThanOrEqual(title.y + 1);
    if (width >= 1024) expect((await row.boundingBox())!.height).toBeLessThanOrEqual(80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
