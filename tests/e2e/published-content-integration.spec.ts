import { expect, test } from "@playwright/test";

const privateCanary = "PRIVATE_E2E_CANARY";
const privateSolutionCanary = "비공개정답";

test("migrated isolated D1 serves a published fixture through the Worker and browser", async ({ page, request }) => {
  const response = await request.get("/api/quizzes/latest?difficulty=child");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const raw = await response.text();
  expect(raw).not.toContain(privateCanary);
  expect(raw).not.toContain(privateSolutionCanary);
  expect(JSON.parse(raw)).toMatchObject({
    data: {
      quiz: {
        slug: "2026-09-01-e2e001",
        sermon: { title: "통합 경로 검증용 설교 (테스트)", translation: "개역개정" },
        variant: { id: "e2e-child", difficulty: "child", revision: 1 },
      },
    },
  });

  const writes: string[] = [];
  page.on("request", (browserRequest) => {
    if (browserRequest.method() !== "GET") writes.push(browserRequest.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "통합 경로 검증용 설교 (테스트)" })).toBeVisible();
  await expect(page.getByRole("grid", { name: "낱말 퀴즈 격자" })).toBeVisible();
  await expect(page.getByText("가로 1번 통합 검사 단서", { exact: true }).first()).toBeVisible();
  await expect(page.locator('time[datetime="2099-09-07T00:00:00.000Z"]')).toContainText("한국 시간");
  await expect(page.getByTestId("remaining-time")).toContainText("남은 기간:");
  await expect(page.locator("body")).not.toContainText(privateCanary);
  await expect(page.locator("body")).not.toContainText(privateSolutionCanary);
  await page.getByRole("link", { name: "이 퀴즈의 고유 주소" }).click();
  await expect(page).toHaveURL(/\/quiz\/2026-09-01-e2e001\?level=child$/u);
  await page.reload();
  await expect(page.getByRole("grid", { name: "낱말 퀴즈 격자" })).toBeVisible();
  expect(writes).toEqual([]);
});
