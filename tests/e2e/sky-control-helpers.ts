import { expect, type Page } from "@playwright/test";

/** Enter the same controls through the mobile dock; desktop keeps its right rail. */
export async function openSkySettings(page: Page) {
  await expect(page.locator(".time-rail")).toBeAttached();
  const trigger = page.locator(".mobile-settings-trigger");
  if (await page.evaluate(() => matchMedia("(max-width: 700px)").matches)) {
    await expect(trigger).toBeVisible();
    if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    const popup = page.getByRole("dialog", { name: "화면 설정", exact: true });
    await expect(popup).toBeVisible();
    await expect.poll(() => popup.evaluate(node => node.getAnimations().every(animation => animation.playState === "finished"))).toBe(true);
  }
}

/** Select through the visible UI, then return to the page being inspected. */
export async function selectSkyTime(page: Page, name: string, keepOpen = false) {
  await openSkySettings(page);
  await page.getByRole("button", { name, exact: true }).click();
  if (!keepOpen && await page.evaluate(() => matchMedia("(max-width: 700px)").matches)) {
    await page.getByRole("button", { name: "화면 설정 닫기", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "화면 설정", exact: true })).toBeHidden();
  }
}
