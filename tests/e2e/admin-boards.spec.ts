import { expect, test, type Locator } from '@playwright/test';
import { mockAdminGuide } from './fixtures/admin-guide';

async function circularRefresh(button: Locator) {
  await expect(button).toBeVisible();
  const shape = await button.evaluate(node => {
    const box=node.getBoundingClientRect(), svg=node.querySelector('svg')!, icon=svg.getBoundingClientRect(), drawing=svg.getBBox();
    return {expectedSize:matchMedia("(pointer: coarse)").matches?44:36,width:box.width,height:box.height,radius:getComputedStyle(node).borderRadius,dx:icon.x+icon.width/2-box.x-box.width/2,dy:icon.y+icon.height/2-box.y-box.height/2,inkX:drawing.x+drawing.width/2,inkY:drawing.y+drawing.height/2};
  });
  expect(shape.width).toBe(shape.expectedSize);expect(shape.height).toBe(shape.expectedSize);expect(shape.radius).toBe('50%');
  expect(Math.abs(shape.dx)).toBeLessThan(.5);expect(Math.abs(shape.dy)).toBeLessThan(.5);
  expect(shape.inkX).toBeCloseTo(12,1);expect(shape.inkY).toBeCloseTo(12,1);
  await expect(button).toHaveText('');
}

test('record boards open answers beside management and preserve drafts when collapsed',async({page},info)=>{
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/submissions?quiz=published-example');
  const row=page.locator('[data-admin-record]').first();await expect(row).toContainText('연습 참여자');
  await circularRefresh(page.getByRole('button',{name:'제출 목록 새로고침',exact:true}));
  const category=row.getByText('어린이',{exact:true}),state=row.getByText('공개',{exact:true});
  const a=await category.boundingBox(),b=await state.boundingBox();expect(a&&b&&Math.abs(a.y-b.y)).toBeLessThan(2);
  expect((await row.boundingBox())!.height).toBeLessThan(info.project.name.includes('mobile')?130:90);
  const summary=row.locator('summary').first(),disclosure=row.locator('details').first();
  await expect(row.getByLabel('처리 사유')).toBeHidden();
  await summary.focus();await page.keyboard.press('Enter');await expect(disclosure).toHaveAttribute('open','');
  await row.getByLabel('처리 사유').fill('입력 유지 확인');
  const answers=row.getByRole('region',{name:'실제 제출 답안'}),manage=row.getByRole('region',{name:'공개 상태·개인정보 관리'});
  await expect(answers).toContainText('연습');await expect(manage).toBeVisible();
  const left=await answers.boundingBox(),right=await manage.boundingBox();
  if(info.project.name.includes('mobile'))expect(right!.y).toBeGreaterThan(left!.y+left!.height);
  else expect(right!.x).toBeGreaterThan(left!.x+left!.width);
  await summary.focus();await page.keyboard.press('Space');await expect(disclosure).not.toHaveAttribute('open','');
  await expect(row.getByLabel('처리 사유')).toBeHidden();
  await page.keyboard.press('Enter');await expect(row.getByLabel('처리 사유')).toHaveValue('입력 유지 확인');
  await page.setViewportSize({width:320,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(writes).toEqual([]);
});

test('quiz and inbox filters share a full-width baseline and circular refresh',async({page})=>{
  const writes=await mockAdminGuide(page);
  for(const [path,label,refresh] of [['/admin','퀴즈 상태','운영 상태 새로고침'],['/admin/privacy-requests','문의 상태 필터','문의 목록 새로고침']]){
    await page.goto(path!);await circularRefresh(page.getByRole('button',{name:refresh!,exact:true}));
    const tabs=page.getByRole('group',{name:label!});const toolbar=page.locator('[data-admin-list-toolbar]');
    const layout=await toolbar.evaluate(n=>({width:n.getBoundingClientRect().width,parent:n.parentElement!.getBoundingClientRect().width,border:getComputedStyle(n).borderBottomWidth}));
    expect(layout.width).toBeGreaterThan(layout.parent-2);expect(layout.border).toBe('1px');
    const selected=tabs.locator('[aria-pressed=true]');await expect(selected).toHaveCSS('border-top-left-radius','4px');
    await tabs.getByRole('button').last().click();await expect(tabs.getByRole('button').last()).toHaveAttribute('aria-pressed','true');
  }
  const row=page.locator('[data-admin-record]').first(),reply=row.locator('summary').first();
  await reply.click();await row.getByLabel('관리자 답변').fill('입력한 답변 유지');await reply.click();await reply.click();await expect(row.getByLabel('관리자 답변')).toHaveValue('입력한 답변 유지');
  await page.setViewportSize({width:320,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(writes).toEqual([]);
});


test('quiz board uses sermon dates, compact named icons and above-first tooltips', async ({page,isMobile}) => {
  const writes=await mockAdminGuide(page);
  await page.goto('/admin');
  const row=page.locator('[data-admin-quiz-row]').filter({has:page.getByRole('heading',{name:'함께 걷는 기쁨 · 연습',exact:true})});
  await expect(row.locator('time')).toHaveAttribute('datetime','2026-10-11');
  expect(await row.locator('time').ariaSnapshot()).toContain('설교일 2026-10-11');
  const child=row.getByRole('img',{name:'어린이 3명 참여',exact:true});
  await expect(child.locator('svg')).toHaveCount(1);
  await expect(row.getByRole('img',{name:'장년 4명 참여',exact:true})).toBeVisible();
  const action=row.getByRole('link',{name:'퀴즈 설정',exact:true});
  await expect(action).toHaveAttribute('href','/admin/quiz/published-example');
  await expect(action).toHaveText('');
  const box=await action.boundingBox();expect(box!.width).toBe(isMobile?44:36);expect(box!.height).toBe(box!.width);
  if(!isMobile){const title=await row.getByRole('heading').boundingBox(),count=await child.boundingBox();expect(count!.x).toBeGreaterThan(title!.x+title!.width);expect((await row.boundingBox())!.height).toBeLessThan(90);}
  await action.focus();const tip=page.getByRole('tooltip',{name:'퀴즈 설정',exact:true});await expect(tip).toBeVisible();await expect(tip).toHaveAttribute('data-side','above');
  await page.keyboard.press('Escape');await expect(tip).toBeHidden();
  await action.evaluate(n=>{const anchor=n.parentElement!;anchor.style.transform=`translateY(${2-anchor.getBoundingClientRect().top}px)`;});
  await action.evaluate(n=>{n.blur();n.focus({preventScroll:true});});expect((await action.boundingBox())!.y).toBeLessThan(12);await expect(tip).toHaveAttribute('data-side','below');
  await page.keyboard.press('Escape');
  await expect(page.locator('.site-header').getByRole('link',{name:'이번 주 퀴즈',exact:true})).toHaveAttribute('href','/');
  await expect(page.locator('aside').getByRole('link',{name:'사이트 보기',exact:true})).toHaveCount(0);
  await page.goto('/admin/tools');const tool=page.locator('[data-admin-tool]').first(),summary=tool.locator('summary').first();
  await expect(summary.locator('svg')).toHaveCount(1);await expect(summary).not.toContainText('열기');
  await summary.focus();await page.keyboard.press('Enter');await expect(tool).toHaveAttribute('open','');
  await page.keyboard.press('Space');await expect(tool).not.toHaveAttribute('open','');
  expect(writes).toEqual([]);
});
