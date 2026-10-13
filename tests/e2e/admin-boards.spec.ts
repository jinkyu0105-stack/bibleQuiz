import { expect, test, type Locator } from '@playwright/test';
import { mockAdminGuide } from './fixtures/admin-guide';

async function circularRefresh(button: Locator) {
  await expect(button).toBeVisible();
  const shape = await button.evaluate(node => {
    const box=node.getBoundingClientRect(), svg=node.querySelector('svg')!, icon=svg.getBoundingClientRect(), drawing=svg.getBBox();
    return {width:box.width,height:box.height,radius:getComputedStyle(node).borderRadius,dx:icon.x+icon.width/2-box.x-box.width/2,dy:icon.y+icon.height/2-box.y-box.height/2,inkX:drawing.x+drawing.width/2,inkY:drawing.y+drawing.height/2};
  });
  expect(shape.width).toBe(44);expect(shape.height).toBe(44);expect(shape.radius).toBe('50%');
  expect(Math.abs(shape.dx)).toBeLessThan(.5);expect(Math.abs(shape.dy)).toBeLessThan(.5);
  expect(shape.inkX).toBeCloseTo(12,1);expect(shape.inkY).toBeCloseTo(12,1);
  await expect(button).toHaveText('');
}

test('record boards keep metadata compact, expose one tool and preserve a reason across switches',async({page},info)=>{
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/submissions?quiz=published-example');
  const row=page.locator('[data-admin-record]').first();await expect(row).toContainText('연습 참여자');
  await circularRefresh(page.getByRole('button',{name:'제출 목록 새로고침',exact:true}));
  const category=row.getByText('어린이',{exact:true}),state=row.getByText('공개',{exact:true});
  const a=await category.boundingBox(),b=await state.boundingBox();expect(a&&b&&Math.abs(a.y-b.y)).toBeLessThan(2);
  expect((await row.boundingBox())!.height).toBeLessThan(info.project.name.includes('mobile')?280:190);
  const manage=row.getByRole('button',{name:'공개 상태·개인정보 관리',exact:true});
  await manage.focus();await page.keyboard.press('Enter');await expect(manage).toHaveAttribute('aria-expanded','true');
  await row.getByLabel('처리 사유').fill('입력 유지 확인');
  await row.getByRole('button',{name:'실제 제출 답안',exact:true}).click();
  await expect(row.getByLabel('처리 사유')).toBeHidden();await expect(row.getByRole('region',{name:'실제 제출 답안'})).toContainText('연습');
  await manage.click();await expect(row.getByLabel('처리 사유')).toHaveValue('입력 유지 확인');
  await expect(row.getByRole('region',{name:'실제 제출 답안'})).toBeHidden();
  await expect(row.getByRole('region')).toHaveCount(1);
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
  const row=page.locator('[data-admin-record]').first(),reply=row.getByRole('button',{name:'답변 작성',exact:true});
  await reply.click();await row.getByLabel('관리자 답변').fill('입력한 답변 유지');await reply.click();await reply.click();await expect(row.getByLabel('관리자 답변')).toHaveValue('입력한 답변 유지');
  await page.setViewportSize({width:320,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(writes).toEqual([]);
});
