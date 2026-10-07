import { expect, test } from "@playwright/test";

for (const difficulty of ["child", "adult"] as const) {
  test(`${difficulty}: English guidance preserves answers and keyboard focus`, async ({ page }) => {
    await page.clock.install({ time: new Date("2026-09-01T00:00:00.000Z") });
    await page.goto(`/dev/quiz?level=${difficulty}`);
    await page.clock.pauseAt(new Date("2026-09-01T01:00:00.000Z"));
    const input = page.getByRole("textbox", { name: /^낱말 입력:/ });
    const setBuffer = async (value: string) => input.evaluate((element, text) => {
      const native = element as HTMLInputElement;
      native.value = text;
      native.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    }, value);
    await input.focus();
    await setBuffer("가");
    const toast = page.getByTestId("latin-input-notice");
    await page.keyboard.type("abc");
    await expect(toast).toHaveText("영문이 입력됐어요. 한/영 키로 한글로 바꿔 주세요.");
    await expect(page.locator("#input-status")).toHaveText("영문이 입력됐어요. 한/영 키로 한글로 바꿔 주세요.");
    await expect(input).toBeFocused();
    await expect(page.locator('[data-cell="r0c0"]')).toContainText("가");
    await expect(page.getByTestId("progress")).toContainText("1 /");
    const draft = await page.evaluate((level) => JSON.parse(localStorage.getItem(`bibleQuiz:draft:preview-${level}-${level === "child" ? 5 : 8}:1`)!), difficulty);
    expect(draft.cells).toEqual([{ id: "r0c0", value: "가" }]);
    const box = await toast.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: test.info().outputPath(`${difficulty}-english-notice.png`) });
    await page.clock.runFor(3999);
    await expect(toast).toBeVisible();
    await page.clock.runFor(1);
    await expect(toast).toBeHidden();
    await expect(input).toBeFocused();
    await page.keyboard.type("d");
    await expect(toast).toBeVisible();
    await setBuffer("가나");
    await expect(toast).toBeHidden();
    await expect(input).toBeFocused();
    await expect(page.locator('[data-cell="r0c1"]')).toContainText("나");
    await expect(page.getByTestId("progress")).toContainText("2 /");
  });
}
