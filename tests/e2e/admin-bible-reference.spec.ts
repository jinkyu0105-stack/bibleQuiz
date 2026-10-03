import { expect, test } from "@playwright/test";

const reference = {
  canonicalLabel: "요한복음 3:1–3",
  mode: "reference_only",
  readingPortalUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE",
  reference: {
    bookId: "JHN",
    end: { chapter: 3, verse: 3 },
    start: { chapter: 3, verse: 1 },
  },
  translation: "개역개정",
  verseCount: 3,
};

test("administrator verifies the same reference through natural input and 66-book selection", async ({ page }) => {
  const requests: Array<{ method: string; url: URL; body: unknown }> = [];
  await page.route("**/api/admin/bible/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({
      method: request.method(),
      url,
      body: request.method() === "POST" ? request.postDataJSON() : null,
    });
    await route.fulfill({ json: { data: reference } });
  });

  await page.goto("/admin/tools");
  await expect(page.getByRole("heading", { name: "성경 장절 확인" })).toBeVisible();
  await expect(page.getByText("이 단계에서는 장절을 저장하거나 설교 내용을 편집하지 않습니다.")).toBeVisible();

  const bibleTool = page.locator("section").filter({ has: page.getByRole("heading", { name: "성경 장절 확인" }) });
  const naturalForm = bibleTool.locator("form").first();
  await naturalForm.getByLabel("성경 장절").fill("요한복음 3:1-3");
  await naturalForm.getByRole("button", { name: "입력 확인" }).click();
  await expect(naturalForm.getByRole("heading", { name: "요한복음 3:1–3" })).toBeVisible();

  const selectedForm = bibleTool.locator("form").nth(1);
  await selectedForm.getByLabel("성경 책").selectOption("JHN");
  await selectedForm.getByLabel("장").selectOption("3");
  await selectedForm.getByLabel("시작 절").selectOption("1");
  await selectedForm.getByLabel("마지막 절").selectOption("3");
  await selectedForm.getByRole("button", { name: "선택 확인" }).click();
  await expect(selectedForm.getByRole("heading", { name: "요한복음 3:1–3" })).toBeVisible();
  await expect(selectedForm.getByRole("link", { name: "대한성서공회 읽기 포털 열기" })).toHaveAttribute("href", reference.readingPortalUrl);

  expect(requests).toEqual([
    expect.objectContaining({
      method: "POST",
      body: { input: "요한복음 3:1-3" },
    }),
    expect.objectContaining({ method: "GET", body: null }),
  ]);
  expect(requests[1]?.url.search).toBe("?book=JHN&chapter=3&verseEnd=3&verseStart=1");
  await expect(page.locator("body")).not.toContainText("PRIVATE_CANARY");
});

test("administrator UI replaces malformed server data with a safe error", async ({ page }) => {
  await page.route("**/api/admin/bible/parse-reference", (route) => route.fulfill({
    json: { data: { ...reference, text: "PRIVATE_CANARY" } },
  }));
  await page.goto("/admin/tools");
  const bibleTool = page.locator("section").filter({ has: page.getByRole("heading", { name: "성경 장절 확인" }) });
  const naturalForm = bibleTool.locator("form").first();
  await naturalForm.getByLabel("성경 장절").fill("요한복음 3:1-3");
  await naturalForm.getByRole("button", { name: "입력 확인" }).click();
  await expect(naturalForm.getByRole("alert")).toContainText("응답을 확인하지 못했습니다");
  await expect(page.locator("body")).not.toContainText("PRIVATE_CANARY");
});
