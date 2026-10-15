/* global document, requestAnimationFrame, innerWidth */
// Independent design-review regression checks. No Worker, DB or external API.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, expect } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
    if (!path.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = `${origin}/docs/design/phase-9/sky-v2/`;
const reports = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [], outside = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) outside.push(request.url()); });
      await page.goto(`${base}components/example.html`);
      await page.evaluate(() => document.fonts.ready);
      const menu = page.getByRole('group', { name: '퀴즈 선택' });
      await expect(menu).toHaveAttribute('data-selection-ready', 'true');
      await menu.getByRole('button', { name: '장년' }).hover();
      await expect(menu).toHaveAttribute('data-dock-previewing', '');
      await expect(menu.getByRole('button', { name: '어린이' })).toHaveAttribute('aria-pressed', 'true');
      await menu.getByRole('button', { name: '장년' }).focus();
      await page.keyboard.press('Enter');
      await expect(menu.getByRole('button', { name: '장년' })).toHaveAttribute('aria-pressed', 'true');
      await page.locator('#example-note').fill('재연결해도 남아야 하는 메모');
      for (let i = 0; i < 3; i++) await page.locator('#example-remount').click();
      await expect(page.locator('.glass-indicator')).toHaveCount(2);
      await expect(page.locator('.glass-reading-core')).toHaveCount(1);
      await expect(page.locator('.glass-rim-glow')).toHaveCount(2);
      await expect(page.locator('#example-note')).toHaveValue('재연결해도 남아야 하는 메모');
      await expect(menu.getByRole('button', { name: '장년' })).toHaveAttribute('aria-pressed', 'true');
      // Independent roots, root-as-panel, globally unique filters, and cleanup.
      const lifecycle = await page.evaluate(async chromiumOptics => {
        const { mountGlassComponents } = await import('./glass.js?v=20261010-components-1');
        const panel = document.createElement('article');
        panel.className = 'glass'; panel.dataset.glassPanel = 'reading';
        panel.style.cssText = 'position:fixed;top:20px;left:20px;width:320px';
        panel.textContent = '별도 위치에 재사용한 박스'; document.body.append(panel);
        const first = mountGlassComponents(panel);
        const second = mountGlassComponents(panel); // Same root replaces its own mount.
        first.destroy(); // A stale controller cannot destroy the replacement.
        second.refresh();
        // Optical maps are now prepared on visibility, after the observer fires.
        // Check the visible panel's readiness instead of assuming two frames.
        for (let frame = 0; frame < 120; frame++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          if (!chromiumOptics || panel.dataset.lensReady === 'true') break;
        }
        const ids = [...document.querySelectorAll('filter[id]')].map(node => node.id);
        const count = panel.querySelectorAll('.glass-reading-core').length;
        const ready = panel.dataset.lensReady;
        panel.style.marginTop = '3px';
        second.destroy(); second.destroy();
        const clean = !panel.querySelector('span') && !panel.hasAttribute('data-lens-ready') && !panel.style.getPropertyValue('--glass-optics');
        const preserved = panel.style.marginTop === '3px' && panel.textContent === '별도 위치에 재사용한 박스';
        panel.remove();
        const empty = document.createElement('nav');
        empty.className = 'glass-segmented'; empty.dataset.glassMotion = 'elastic'; document.body.append(empty);
        const emptyMount = mountGlassComponents(empty); emptyMount.refresh();
        await new Promise(resolve => requestAnimationFrame(resolve));
        emptyMount.destroy(); empty.remove();
        return { count, unique: new Set(ids).size === ids.length, clean, preserved, ready, remaining: document.querySelectorAll('.liquid-filter-definitions').length };
      }, name === 'chromium');
      assert.equal(lifecycle.count, 1); assert(lifecycle.unique && lifecycle.clean && lifecycle.preserved);
      assert.equal(lifecycle.remaining, 1);
      assert.equal(lifecycle.ready, name === 'chromium' ? 'true' : undefined);
      const reading = page.locator('[data-glass-panel=reading]');
      await reading.locator('h2').hover();
      await expect(reading).toHaveAttribute('data-glint-active', '');
      await page.locator('.example-action').hover();
      await expect(page.locator('.example-action')).toHaveAttribute('data-glint-active', '');
      await expect(reading).not.toHaveAttribute('data-glint-active');
      await page.locator('#example-motion').click();
      await reading.locator('h2').hover();
      await expect(reading).not.toHaveAttribute('data-glint-active');
      await menu.getByRole('button', { name: '어린이' }).hover();
      await expect(menu).not.toHaveAttribute('data-dock-previewing');
      await page.locator('#example-motion').click();
      await page.locator('#example-clarity').click();
      await expect(page.locator('.glass-reading-core')).toBeHidden();
      await page.locator('#example-clarity').click();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await menu.getByRole('button', { name: '어린이' }).hover();
      await expect(menu).not.toHaveAttribute('data-dock-previewing');
      await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' });
      await expect(menu.getByRole('button', { name: '장년' })).toHaveCSS('outline-style', 'solid');
      await page.emulateMedia({ forcedColors: 'none' });

      await page.goto(`${base}?view=admin&time=dawn&video=off`);
      const tabs = page.locator('.content-tabs');
      await page.locator('#review-title').fill('보존할 요약 제목');
      await page.locator('#review-check').check();
      await tabs.locator('[data-content=children]').hover();
      await expect(page.locator('#review-title')).toHaveValue('보존할 요약 제목');
      await expect(page.locator('#review-next')).toBeEnabled();
      await tabs.locator('[data-content=children]').click();
      await page.locator('#review-title').fill('어린이 초안');
      await tabs.locator('[data-content=summary]').click();
      await expect(page.locator('#review-title')).toHaveValue('보존할 요약 제목');
      await expect(page.locator('#review-next')).toBeDisabled();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('[data-admin-page=manual]').hover();
      await expect(page.locator('[data-admin-page=manual]')).toHaveAttribute('data-dock-preview', '');
      await page.locator('[data-admin-page=backup]').click();
      await expect(page.locator('#review-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.admin-sidebar [aria-current=page]')).toHaveAttribute('data-admin-page', 'weekly');

      await page.goto(`${base}?view=quiz&time=night&video=off&menu-glass=on`);
      await page.locator('#word-input').fill('창세기');
      await page.locator('#word-form button').click();
      await expect(page.locator('#word-count')).toHaveText('1 / 3 단어');
      await page.locator('.level-switch [data-level=adults]').hover();
      await expect(page.locator('.level-switch [data-level=children]')).toHaveAttribute('aria-current', 'page');
      await page.locator('.level-switch [data-level=adults]').focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/level=adults/);
      await expect(page.locator('#quiz-level')).toHaveText('장년 성경퀴즈');
      for (const time of ['dawn','day','dusk','night']) {
        await page.locator(`button[data-time=${time}]`).click();
        await expect(page.locator('body')).toHaveAttribute('data-time', time);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      for (const material of ['soft','off']) {
        await page.goto(`${base}?view=quiz&glass=${material}&video=off`);
        await expect(page.locator('.glass-reading-core')).toHaveCount(0);
        await expect(page.locator('[data-dock-motion]')).toHaveCount(0);
        await expect(page.locator('.level-switch .glass-indicator')).toHaveCount(material === 'soft' ? 1 : 0);
      }
      await page.goto(`${base}?view=admin&menu-glass=off&video=off`);
      await expect(page.locator('.admin-sidebar nav .glass-indicator')).toHaveCount(0);
      await expect(page.locator('.content-tabs')).not.toHaveAttribute('data-dock-motion');
      assert.deepEqual(errors, []); assert.deepEqual(outside, []);
      reports.push({ browser: name, standalone: true, lifecycle, editorAndQuiz: true, comparisons: true, errors, outside });
    } finally { await browser.close(); }
  }
  // Touch must activate a choice without leaving a hover preview behind.
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`${base}components/example.html`);
    const menu = page.getByRole('group', { name: '퀴즈 선택' });
    await menu.getByRole('button', { name: '장년' }).tap();
    await expect(menu.getByRole('button', { name: '장년' })).toHaveAttribute('aria-pressed', 'true');
    await expect(menu).not.toHaveAttribute('data-dock-previewing');
    reports.push({ touch: true });
  } finally { await browser.close(); }
  console.log(JSON.stringify(reports, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }
