import { expect, test } from "@playwright/test";

test("loads the SPA and keeps quiz routes on refresh", async ({ page }) => {
  await page.goto("/quiz/test-slug");

  await expect(page.getByRole("heading", { name: "퀴즈 화면" })).toBeVisible();
  await expect(page.getByText("현재 시험 주소: test-slug")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "퀴즈 화면" })).toBeVisible();
});

test("serves API errors as JSON instead of SPA HTML", async ({ request }) => {
  const response = await request.get("/api/unknown");

  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "NOT_FOUND" },
  });
});
