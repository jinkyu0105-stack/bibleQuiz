import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { mockAdminGuide } from './fixtures/admin-guide';

// Opt-in maintenance command: renders current components with synthetic GET responses only.
test('capture operator guide examples', async ({ page }) => {
  test.skip(process.env.BIBLEQUIZ_CAPTURE_ADMIN_GUIDE !== '1', 'Static guide assets are regenerated deliberately.');
  test.setTimeout(120_000);
  await page.setViewportSize({width:1440,height:1300});
  await page.emulateMedia({reducedMotion:'reduce'});
  const writes=await mockAdminGuide(page);
  mkdirSync('public/images/admin-guide',{recursive:true});
  const fontPath=process.env.BIBLEQUIZ_CAPTURE_EMOJI_FONT;
  const emojiFont=fontPath ? readFileSync(fontPath).toString('base64') : null;
  async function open(path:string) {
    await page.goto(path);
    await page.getByRole('button',{name:'낮',exact:true}).click();
    if(emojiFont) await page.addStyleTag({content:`@font-face {font-family:'Segoe UI Emoji'; src:url(data:font/ttf;base64,${emojiFont}) format('truetype');}`} );
    await page.evaluate(()=>document.fonts.ready);
  }
  async function shot(id:string, locator:Locator) {
    await expect(locator).toBeVisible();
    await locator.screenshot({path:`public/images/admin-guide/${id}.png`,animations:'disabled'});
  }
  async function between(id:string,start:Locator,end:Locator) {
    await start.scrollIntoViewIfNeeded();
    const a=await start.boundingBox(),b=await end.boundingBox();
    if(!a||!b)throw new Error(`Missing capture region: ${id}`);
    const scroll=await page.evaluate(()=>({x:scrollX,y:scrollY}));
    await page.screenshot({path:`public/images/admin-guide/${id}.png`,animations:'disabled',fullPage:true,clip:{x:a.x+scroll.x,y:a.y+scroll.y,width:a.width,height:b.y+b.height-a.y}});
  }
  const dashboardOnly=process.env.BIBLEQUIZ_CAPTURE_ADMIN_GUIDE_ONLY === 'dashboard';
  await open('/admin');
  await shot('dashboard',page.locator('section[aria-labelledby="quiz-library-heading"]'));
  if(dashboardOnly) { expect(writes).toEqual([]); return; }
  await open('/admin/quiz/weekly?step=1');
  await expect(page.getByRole('heading',{name:'설교 영상',exact:true})).toBeVisible();
  await between('input',page.locator('section[aria-labelledby="sermon-drafts-title"]'),page.getByRole('textbox',{name:'성경 장절',exact:true}));
  await open('/admin/quiz/weekly?step=3');
  await expect(page.getByRole('textbox',{name:'요약 문단 1',exact:true})).toBeVisible();
  await between('review',page.locator('#review-targets'),page.locator('#snapshot-summary'));
  await open('/admin/quiz/published-example');
  await between('settings',page.locator('[data-admin-tool="quiz-metadata"]'),page.locator('[data-admin-tool="quiz-correction"]'));
  await open('/admin/submissions?quiz=published-example');
  await page.locator('summary').filter({hasText:'공개 상태·개인정보 관리'}).click();
  await shot('submissions',recordFor(page,'연습 참여자'));
  await open('/admin/privacy-requests');
  await page.locator('summary').filter({hasText:'답변 작성'}).click();
  await shot('privacy',recordFor(page,'연습 요청자'));
  await open('/admin/moderation');
  await page.locator('[data-admin-tool="filter-test"] > summary').click();
  await expect(page.getByRole('button',{name:'저장 없이 시험'})).toBeEnabled();
  await shot('filters',page.locator('[data-admin-tool="filter-test"]'));
  await open('/admin/operations');
  await expect(page.locator('section[aria-labelledby="operations-title"] dd').last()).not.toHaveText('미확인');
  await shot('operations',page.locator('section[aria-labelledby="operations-title"]'));
  expect(writes).toEqual([]);
});
function recordFor(page:Page,name:string) { return page.locator('li').filter({has:page.getByRole('heading',{name,exact:true})}).first(); }
