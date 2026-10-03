import { expect, test, type Page } from '@playwright/test';
import { participationBoardDataSchema } from '../../shared/api/participation-board';
import { publicResponse } from '../fixtures/public-response';

async function archivedBoard(page: Page) {
  const response = publicResponse();
  const quiz = response.data.quiz!;
  Object.assign(quiz, { status: 'archived', availability: 'archived', mode: 'practice', acceptingSubmissions: false, solutionAccess: 'public', closesAt: '2026-09-07T00:00:00.000Z' });
  const ids = quiz.variant.grid.cells.map(cell => cell.id);
  const board = participationBoardDataSchema.parse({ winnerCount: 1, participants: [
    { submissionOrder: 1, displayName: '부분답안', submittedAt: '2026-09-01T00:00:00.000Z', comment: '한줄평', answers: { [ids[0]!]: '나' }, correctCellIds: [], isFullyCorrect: false, isMine: false },
    ...[2, 3].map(order => ({ submissionOrder: order, displayName: `정답자${order}`, submittedAt: `2026-09-01T00:0${order}:00.000Z`, comment: null, answers: Object.fromEntries(ids.map(id => [id, '가'])), correctCellIds: ids, isFullyCorrect: true, isMine: false })),
  ], winners: [{ rank: 1, submissionOrder: 2 }] });
  await page.route('**/api/quizzes/**', route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/board') ? { data: board } : response }));
  await page.goto('/');
  await page.getByRole('button', { name: '참여 현황 보기', exact: true }).click();
  return page.getByTestId('participation-board');
}

test('native viewport events reveal the focused cell without changing an IME buffer', async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, height: 900 });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
    const scrolls: ScrollToOptions[] = [];
    Object.defineProperty(window, '__viewportProbe', { value: { viewport, scrolls } });
    window.scrollBy = ((options: ScrollToOptions) => scrolls.push(options)) as typeof window.scrollBy;
  });
  await page.goto('/dev/quiz?level=child');
  const input = page.getByRole('textbox', { name: /^낱말 입력:/ });
  await input.focus();
  await input.dispatchEvent('compositionstart');
  await input.evaluate(element => { (element as HTMLInputElement).value = 'ㄱ'; element.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'ㄱ', isComposing: true })); });
  await page.evaluate(() => {
    const probe = (window as unknown as { __viewportProbe: { viewport: EventTarget & { height: number }; scrolls: ScrollToOptions[] } }).__viewportProbe;
    probe.scrolls.length = 0; probe.viewport.height = 160; probe.viewport.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __viewportProbe: { scrolls: ScrollToOptions[] } }).__viewportProbe.scrolls.some(value => (value.top ?? 0) > 0))).toBe(true);
  await expect(input).toBeFocused(); await expect(input).toHaveValue('ㄱ');
  await expect(page.getByTestId('progress')).toHaveText('0 / 21칸 작성');
});

test('board switches immediately with decorative FLIP copies, and reduced motion cancels every animation', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    const calls: number[] = [];
    Object.defineProperty(window, '__motionCalls', { value: calls });
    Element.prototype.animate = function(...args) { calls.push(1); return original.apply(this, args); };
  });
  const board = await archivedBoard(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await board.getByRole('button', { name: 'Top N', exact: true }).click();
  await expect(board.getByRole('article', { name: '부분답안' })).toHaveCount(0);
  await expect(board.getByRole('article')).toHaveCount(2);
  await expect(board.getByRole('article', { name: '정답자3' }).getByText(/\d+위/)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __motionCalls: number[] }).__motionCalls.length)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => board.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  await page.evaluate(() => { (window as unknown as { __motionCalls: number[] }).__motionCalls.length = 0; });
  await board.getByRole('button', { name: '전체 참여', exact: true }).click();
  await board.getByRole('button', { name: 'Top N', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __motionCalls: number[] }).__motionCalls.length)).toBe(0);
  await page.setViewportSize({ width: 320, height: 720 });
  const art = board.locator('img'); await expect(art).toBeVisible();
  expect(await art.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  for (const width of [320, 360, 375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await board.screenshot({ path: test.info().outputPath('top-n-final.png') });
});

test('both hero tracks select separate mobile images and retain input when all images fail', async ({ page }) => {
  for (const level of ['child', 'adult']) {
    await page.goto(`/dev/quiz?level=${level}&size=10`);
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const art = page.locator('.sermon-artwork img');
      await expect.poll(() => art.evaluate(image => (image as HTMLImageElement).currentSrc)).toMatch(new RegExp(`${level}-${width < 768 ? 'mobile' : 'desktop'}-`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 320 || width === 1440) {
        for (const theme of ['light', 'dark']) {
          await page.getByLabel('화면 테마').selectOption(theme);
          await page.screenshot({ path: test.info().outputPath(`hero-${level}-${width}-${theme}.png`), fullPage: true });
        }
      }
    }
  }
  await page.route('**/images/**', route => route.abort());
  await page.goto('/dev/quiz?level=child');
  await page.getByRole('textbox', { name: /^낱말 입력:/ }).focus();
  await page.getByRole('textbox', { name: /^낱말 입력:/ }).evaluate(element => { (element as HTMLInputElement).value = '값'; element.dispatchEvent(new InputEvent('input', { bubbles: true })); });
  await expect(page.getByTestId('progress')).toHaveText('1 / 21칸 작성');
});

test('public forms and archive reflow at 320px and equivalent doubled CSS text size', async ({ page }) => {
  for (const url of ['/dev/quiz?level=adult&size=10', '/archive', '/privacy-requests', '/admin']) {
    await page.goto(url);
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), url).toBe(true);
    // Reflow probe, deliberately not reported as a real browser zoom action.
    await page.addStyleTag({ content: 'html { font-size: 32px; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${url} doubled text`).toBe(true);
  }
});

test('actual control and focus colors meet non-text contrast in both themes', async ({ page }) => {
  await page.goto('/dev/quiz?level=child');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('화면 테마').selectOption(theme);
    const ratios = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const light = (name: string) => {
        const hex = css.getPropertyValue(name).trim().slice(1);
        const values = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return values[0]! * .2126 + values[1]! * .7152 + values[2]! * .0722;
      };
      return [['--control-border','--input-bg'], ['--control-border','--surface'], ['--focus','--cell'], ['--focus','--selection']].map(([a,b]) => (Math.max(light(a!),light(b!))+.05)/(Math.min(light(a!),light(b!))+.05));
    });
    for (const ratio of ratios) expect(ratio, theme).toBeGreaterThanOrEqual(3);
  }
});
