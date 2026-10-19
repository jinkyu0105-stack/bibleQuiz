import { expect, test } from '@playwright/test';
import { mockAdminGuide } from './fixtures/admin-guide';

test('mobile quiz actions keep destinations, dismiss safely and disappear on desktop', async ({ page }) => {
  const writes = await mockAdminGuide(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/admin');
  const draft = page.getByRole('button', { name: '서로 돕는 한 주 · 연습 관리 더보기' });
  const published = page.getByRole('button', { name: '함께 걷는 기쁨 · 연습 관리 더보기' });
  await draft.click();
  const draftMenu = page.getByRole('dialog', { name: '서로 돕는 한 주 · 연습 관리', exact: true });
  await expect(draftMenu.getByRole('link', { name: '초안 편집', exact: true })).toHaveAttribute('href', '/admin/quiz/weekly');
  await expect(draftMenu.getByRole('link', { name: '참여 기록' })).toHaveCount(0);
  await published.click();
  await expect(draftMenu).toBeHidden();
  const menu = page.getByRole('dialog', { name: '함께 걷는 기쁨 · 연습 관리', exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(published).toBeFocused();
  await published.click();
  await page.locator('.site-header').click({ position: { x: 10, y: 10 } });
  await expect(menu).toBeHidden();
  for (const width of [320, 425]) {
    await page.setViewportSize({ width, height: 900 });
    await published.click(); await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(12); expect(box.x + box.width).toBeLessThanOrEqual(width - 12);
    expect(box.y).toBeGreaterThanOrEqual(12); expect(box.y + box.height).toBeLessThanOrEqual(888);
    await page.keyboard.press('Escape');
  }
  await published.click(); await expect(menu).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(menu).toBeHidden(); await expect(published).toBeHidden();
  const row = page.locator('[data-admin-quiz-row]').filter({ has: page.getByRole('heading', { name: '함께 걷는 기쁨 · 연습', exact: true }) });
  await expect(row.getByRole('link', { name: '퀴즈 설정', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 900 });
  await draft.click(); await draftMenu.getByRole('link', { name: '초안 편집', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/quiz\/weekly$/);
  expect(writes).toEqual([]);
});
