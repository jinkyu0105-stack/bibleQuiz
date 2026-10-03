// Explicit single Cloudflare browser experiment. No deployment or app DB writes.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [video, output] = process.argv.slice(2);
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!/^[A-Za-z0-9_-]{11}$/.test(video ?? '') || !output || !/^[a-f0-9]{32}$/.test(account ?? '') || !token) throw Error('Missing explicit probe inputs');
await mkdir(output, { mode: 0o700 });
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/browser-rendering/devtools`;
const started = Date.now();
const report = { runtime: 'Cloudflare Browser Run via CDP', startedAt: new Date().toISOString(), timeline: [], outcome: 'pending', closed: false };
let session, browser, page, watchdog, stage = 'session';
const mark = name => { stage = name; report.timeline.push({ stage, elapsedMs: Date.now() - started }); };
async function api(path, method) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    report.apiFailure = { status: response.status, codes: data?.errors?.map(e => e.code) ?? [] };
    throw Error('CLOUDFLARE_API_FAILED');
  }
  return data;
}
try {
  session = await api('/browser?keep_alive=60000&targets=true', 'POST');
  await writeFile(resolve(output, 'session-private.json'), JSON.stringify(session), { mode: 0o600, flag: 'wx' });
  if (!session.sessionId) throw Error('MISSING_SESSION_ID');
  browser = await chromium.connectOverCDP(`wss://api.cloudflare.com/client/v4/accounts/${account}/browser-rendering/devtools/browser/${session.sessionId}`, {
    headers: { Authorization: `Bearer ${token}` }, timeout: 20000,
  });
  watchdog = setTimeout(() => { void browser.close().catch(() => {}); }, 60000);
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(12000);
  mark('watch');
  const response = await page.goto(`https://www.youtube.com/watch?v=${video}&hl=ko`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  report.watchStatus = response?.status() ?? null;
  const body = await page.locator('body').innerText();
  const challenged = /Sign in to confirm you.?re not a bot|로그인하여 봇이 아님|로봇이 아님을 확인/.test(body);
  if (challenged) { report.outcome = 'youtube_challenge'; }
  else {
    mark('description');
    await page.getByRole('button', { name: /더보기|\.\.\.more|Show more/i }).first().click();
    mark('transcript_button');
    await page.getByRole('button', { name: /^(스크립트 표시|Show transcript)$/ }).click();
    mark('transcript_rows');
    // eslint-disable-next-line no-undef -- This function runs inside the browser page.
    await page.waitForFunction(() => document.querySelectorAll('ytd-transcript-segment-renderer .segment-text').length > 0 || Array.from(document.querySelectorAll('button,[role=button]')).some(e => /^\d{1,2}:\d{2}(?::\d{2})?\n/.test(e.innerText || '')));
    const legacyRows = await page.locator('ytd-transcript-segment-renderer').allInnerTexts();
    const rows = legacyRows.length ? legacyRows : await page.getByRole('button').evaluateAll(es => es.map(e => e.innerText).filter(s => /^\d{1,2}:\d{2}(?::\d{2})?\n/.test(s)));
    report.renderer = legacyRows.length ? 'legacy' : 'button';
    report.rows = rows.length;
    report.charactersWithTimestamps = [...rows.join('\n')].length;
    await writeFile(resolve(output, 'rows-private.json'), JSON.stringify(rows), { mode: 0o600, flag: 'wx' });
    report.outcome = 'transcript_read';
  }
  await page.screenshot({ path: resolve(output, 'screen-private.png') });
} catch (error) {
  report.outcome = report.outcome === 'pending' ? 'failed' : report.outcome;
  report.failedStage = stage;
  // Never print Playwright messages: they can include signed URLs or headers.
  report.errorType = error?.name ?? 'Error';
  if (page && !page.isClosed()) {
    try {
      const text = await page.locator('body').innerText({ timeout: 3000 });
      report.visibleTranscriptError = /Unable to load|Error loading|Something went wrong|스크립트를 불러올 수|자막을 불러올 수|문제가 발생/.test(text);
      await writeFile(resolve(output, 'failed-page-private.txt'), text, { mode: 0o600, flag: 'wx' });
      await page.screenshot({ path: resolve(output, 'failed-screen-private.png'), timeout: 5000 });
    } catch { report.failureCaptureUnavailable = true; }
  }
} finally {
  if (watchdog) clearTimeout(watchdog);
  if (browser) await browser.close().catch(() => {});
  if (session?.sessionId) {
    try { await api(`/browser/${session.sessionId}`, 'DELETE'); report.closed = true; }
    catch { report.closeFailed = true; }
  }
  report.elapsedMs = Date.now() - started;
  report.browserWallTimeUpperBoundMs = session ? report.elapsedMs : null;
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(report));
}
