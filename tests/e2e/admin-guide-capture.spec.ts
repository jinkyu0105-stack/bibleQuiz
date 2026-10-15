import { selectSkyTime } from "./sky-control-helpers";
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { mockAdminGuide } from './fixtures/admin-guide';
import { mockAdminWorkspace } from './fixtures/admin-workspace';

// Opt-in maintenance command: renders current components with synthetic GET responses only.
test('capture operator guide examples', async ({ page }) => {
  test.skip(process.env.BIBLEQUIZ_CAPTURE_ADMIN_GUIDE !== '1', 'Static guide assets are regenerated deliberately.');
  test.setTimeout(120_000);
  await page.setViewportSize({width:1440,height:1300});
  await page.emulateMedia({reducedMotion:'reduce'});
  const workspaceOnly=process.env.BIBLEQUIZ_CAPTURE_ADMIN_GUIDE_ONLY === 'workspace';
  const writes=workspaceOnly?await mockAdminWorkspace(page):await mockAdminGuide(page);
  const boardsOnly=process.env.BIBLEQUIZ_CAPTURE_ADMIN_GUIDE_ONLY === 'boards';
  if(boardsOnly) {
    const reply=(route:Route,items:unknown[])=> {
      if(route.request().method()!=='GET') { writes.push(new URL(route.request().url()).pathname); return route.abort('blockedbyclient'); }
      return route.fulfill({json:{data:{items}}});
    };
    const at='2026-10-11T06:30:00.000Z';
    const answers=Object.fromEntries(Array.from('함께배우고서로돕는즐거운연습시간').map((value,index)=>[`r${Math.floor(index/6)}c${index%6}`,value]));
    await page.route('**/api/admin/submissions?*',route=>reply(route,[
      {id:'capture-child',difficulty:'child',revision:1,status:'visible',displayName:'연습 참여자',comment:'함께 생각하며 풀어 보니 즐거웠어요. 다음 퀴즈도 기대돼요.',submittedAt:at,scorePercent:100,answers,actions:[]},
      {id:'capture-adult',difficulty:'adult',revision:1,status:'hidden',displayName:'연습 참여자 나무',comment:'연습으로 남긴 소감입니다.',submittedAt:at,scorePercent:85,answers,actions:[]},
      {id:'capture-child-2',difficulty:'child',revision:1,status:'visible',displayName:'연습 참여자 햇살',comment:null,submittedAt:at,scorePercent:90,answers,actions:[]},
    ]));
    await page.route('**/api/admin/privacy-requests',route=>reply(route,[
      {id:'11111111-1111-4111-8111-111111111111',requestType:'delete_submission',quizSlug:'2026-10-01-abc234',submittedName:'연습 요청자',message:'연습으로 제출한 이름과 답안, 코멘트를 삭제해 주세요.',status:'received',adminResponse:null,createdAt:at,updatedAt:at},
      {id:'22222222-2222-4222-8222-222222222222',requestType:'privacy_question',quizSlug:null,submittedName:'연습 요청자 나무',message:'제출한 기록이 어디에 공개되는지 알고 싶어요.',status:'reviewing',adminResponse:null,createdAt:at,updatedAt:at},
      {id:'33333333-3333-4333-8333-333333333333',requestType:'privacy_question',quizSlug:null,submittedName:'연습 요청자 햇살',message:'기록을 확인하는 방법을 알려 주세요.',status:'resolved',adminResponse:'내 참여 기록에서 확인할 수 있습니다.',createdAt:at,updatedAt:at},
    ]));
  }
  mkdirSync('public/images/admin-guide',{recursive:true});
  const fontPath=process.env.BIBLEQUIZ_CAPTURE_EMOJI_FONT;
  const emojiFont=fontPath ? readFileSync(fontPath).toString('base64') : null;
  async function open(path:string) {
    await page.goto(path);
    await selectSkyTime(page, '낮');
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
  async function boardShot(id:string) {
    const board=page.locator(id==='quiz'?'.admin-layout':'.admin-main');
    await board.screenshot({path:`docs/design/phase-9/admin-boards/${id}-actual.png`,animations:'disabled'});
    await selectSkyTime(page, '밤');
    await expect(page.locator('body')).toHaveAttribute('data-time','night');
    await board.screenshot({path:`docs/design/phase-9/admin-boards/${id}-night.png`,animations:'disabled'});
  }
  if(workspaceOnly) {
    mkdirSync('docs/design/phase-9/admin-workspace',{recursive:true});
    await page.setViewportSize({width:1440,height:1500});
    const names=['설교 영상','설교 의도','요약과 문제','격자 배치','최종 확인','발행'];
    for(let step=1;step<=6;step++) {
      await open(`/admin/quiz/weekly?step=${step}`);
      await expect(page.getByRole('heading',{name:names[step-1],exact:true})).toBeVisible();
      if(step===5)await expect(page.getByLabel('어린이 Top N')).toHaveValue('3');
      for(const [label,time] of [['낮','actual'],['밤','night'],...(step===3?[['노을','dusk']]:[])]) {
        await selectSkyTime(page, label!);
        await page.mouse.move(0,0);await page.evaluate(()=>scrollTo(0,0));
        await page.screenshot({path:`docs/design/phase-9/admin-workspace/step-${step}-${time}.png`,animations:'disabled'});
      }
    }
    await open('/admin/quiz/published-example');
    await page.locator('[data-admin-tool=quiz-metadata] > summary').click();
    await expect(page.getByRole('textbox',{name:'설교 제목',exact:true})).toHaveValue('함께 걷는 기쁨 · 연습');
    for(const [label,time] of [['낮','actual'],['밤','night'],['노을','dusk']]) {
      await selectSkyTime(page, label!);
      await page.mouse.move(0,0);await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:`docs/design/phase-9/admin-workspace/settings-${time}.png`,animations:'disabled'});
    }
    await open('/admin/manual');
    await selectSkyTime(page, '노을');
    await expect(page.locator('[data-admin-sheet]')).toBeVisible();
    await page.mouse.move(0,0);await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:'docs/design/phase-9/admin-workspace/manual-dusk.png',animations:'disabled'});
    await open('/admin/quiz/weekly?step=1');
    await expect(page.getByRole('textbox',{name:'설교 제목',exact:true})).toHaveValue('서로 돕는 한 주 · 연습');
    await between('input',page.locator('section[aria-labelledby="sermon-drafts-title"]'),page.getByRole('textbox',{name:'성경 장절',exact:true}));
    await open('/admin/quiz/weekly?step=3');
    await expect(page.getByRole('textbox',{name:'요약 문단 1',exact:true})).toBeVisible();
    await between('review',page.locator('#review-targets'),page.locator('#snapshot-summary'));
    await open('/admin/quiz/published-example');
    await between('settings',page.locator('[data-admin-tool=quiz-metadata]'),page.locator('[data-admin-tool=quiz-correction]'));
    expect(writes).toEqual([]); return;
  }
  if(process.env.BIBLEQUIZ_CAPTURE_ADMIN_GUIDE_ONLY === 'manual') {
    await page.setViewportSize({width:1440,height:1100});
    await open('/admin/manual');
    await expect(page.getByRole('article')).toBeVisible();
    async function readerShot(file:string) {
      await page.mouse.move(0,0);
      await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement) document.activeElement.blur();scrollTo(0,0);});
      // Preserve the viewport: clipping after topic scrolling can omit Chromium's sticky sidebar layer.
      await page.screenshot({path:`docs/design/phase-9/manual-reader/${file}.png`,animations:'disabled'});
    }
    await readerShot('layered-actual');
    await selectSkyTime(page, '밤');
    await readerShot('layered-night');
    await selectSkyTime(page, '낮');
    const topics=page.getByRole('navigation',{name:'매뉴얼 주제'});
    await topics.locator('summary').filter({hasText:'서비스 사전'}).click();
    await topics.getByRole('button',{name:'OpenAI API',exact:true}).click();
    await readerShot('layered-service');
    expect(writes).toEqual([]); return;
  }
  if(process.env.BIBLEQUIZ_CAPTURE_ADMIN_GUIDE_ONLY === 'tools') {
    mkdirSync('docs/design/phase-9/admin-tools',{recursive:true});
    await page.setViewportSize({width:1440,height:1300});
    for(const name of ['tools','moderation','operations']) {
      await open(`/admin/${name}`);
      if(name==='moderation') {
        await page.locator('[data-admin-tool="filter-add"] > summary').click();
        await expect(page.getByLabel('관리용 이름')).toBeEnabled();
      }
      if(name==='operations') await expect(page.locator('#operations-title + dl dd').last()).not.toHaveText('미확인');
      for(const [label,time] of [['낮','actual'],['밤','night']]) {
        await selectSkyTime(page, label!);
        await page.mouse.move(0,0);
        await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();scrollTo(0,0);});
        await page.screenshot({path:`docs/design/phase-9/admin-tools/${name}-${time}.png`,animations:'disabled'});
      }
    }
    await open('/admin/moderation');
    await page.locator('[data-admin-tool="filter-test"] > summary').click();
    await expect(page.getByRole('button',{name:'저장 없이 시험'})).toBeEnabled();
    await shot('filters',page.locator('[data-admin-tool="filter-test"]'));
    await open('/admin/operations');
    await expect(page.locator('#operations-title + dl dd').last()).not.toHaveText('미확인');
    await shot('operations',page.locator('section[aria-labelledby="operations-title"]'));
    expect(writes).toEqual([]); return;
  }
  const dashboardOnly=process.env.BIBLEQUIZ_CAPTURE_ADMIN_GUIDE_ONLY === 'dashboard';
  await open('/admin');
  await shot('dashboard',page.locator('section[aria-labelledby="quiz-library-heading"]'));
  if(boardsOnly||dashboardOnly)await boardShot('quiz');
  if(dashboardOnly) { expect(writes).toEqual([]); return; }
  if(!boardsOnly) {
    await open('/admin/quiz/weekly?step=1');
    await expect(page.getByRole('heading',{name:'설교 영상',exact:true})).toBeVisible();
    await between('input',page.locator('section[aria-labelledby="sermon-drafts-title"]'),page.getByRole('textbox',{name:'성경 장절',exact:true}));
    await open('/admin/quiz/weekly?step=3');
    await expect(page.getByRole('textbox',{name:'요약 문단 1',exact:true})).toBeVisible();
    await between('review',page.locator('#review-targets'),page.locator('#snapshot-summary'));
    await open('/admin/quiz/published-example');
    await between('settings',page.locator('[data-admin-tool="quiz-metadata"]'),page.locator('[data-admin-tool="quiz-correction"]'));
  }
  await open('/admin/submissions?quiz=published-example');
  await page.locator('[data-admin-record] > details > summary').first().click();
  await shot('submissions',recordFor(page,'연습 참여자'));
  if(boardsOnly)await boardShot('submissions');
  await open('/admin/privacy-requests');
  if(boardsOnly)await page.getByRole('group',{name:'문의 상태 필터'}).getByRole('button',{name:/전체/}).click();
  await page.locator('[data-admin-record] > details > summary').first().click();
  await shot('privacy',recordFor(page,'연습 요청자'));
  if(boardsOnly) { await boardShot('inquiries'); expect(writes).toEqual([]); return; }
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
