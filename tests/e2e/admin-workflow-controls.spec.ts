import {expect,test} from '@playwright/test';
import {mockAdminGuide} from './fixtures/admin-guide';
import {selectSkyTime} from './sky-control-helpers';

test('workflow keys keep number order, glass controls and one-row keys and no overflow at desktop and narrow mobile widths',async({page},info)=>{
  test.skip(info.project.name!=='chromium','Viewport matrix runs once.');
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/quiz/weekly?step=3');
  for(const width of [2560,1440,768,425,375,320]) {
    await page.setViewportSize({width,height:1000});
    for(const [theme,label] of [['dawn','새벽'],['day','낮'],['sunset','노을'],['night','밤']]) {
      await selectSkyTime(page,label!);
      const nav=page.getByRole('navigation',{name:'초안 편집 단계'});
      await nav.scrollIntoViewIfNeeded();
      const keys=nav.getByRole('button');await expect(keys).toHaveCount(6);
      const boxes=await keys.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:Math.round(r.y),width:r.width,height:r.height};}));
      for(let i=1;i<boxes.length;i++){
        expect(boxes[i]!.y).toBe(boxes[0]!.y);
        expect(Math.abs(boxes[i]!.x-boxes[i-1]!.x-boxes[i-1]!.width-1)).toBeLessThan(.1);
      }
      if(width<=425) expect(boxes[0]!.height).toBeLessThanOrEqual(76);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await expect(keys.nth(2)).toHaveAttribute('aria-current','step');await expect(keys.nth(3)).toBeDisabled();
      if(process.env.CAPTURE_WORKFLOW==='1' && [1440,375].includes(width)) await page.locator('[data-admin-workflow]').screenshot({path:`docs/design/phase-9/workflow-controls/connected-actual-${theme}-${width}.png`});
    }
  }
  expect(writes).toEqual([]);
});


test('stage help stays beside the heading and opens an accessible modal on desktop and mobile',async({page},info)=>{
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/quiz/weekly?step=3');
  const help=page.getByRole('button',{name:'문제 검토 도움말',exact:true});
  await expect(help).toBeVisible();await expect(page.locator('summary').filter({hasText:'용어·화면 안내'})).toHaveCount(0);
  expect((await help.boundingBox())!.width).toBe(44);
  expect((await help.locator('span').boundingBox())!.width).toBe(24);
  const heading=page.getByRole('heading',{name:'문제 검토',exact:true});
  const h=await heading.boundingBox(),b=await help.boundingBox();expect(Math.abs(h!.y+h!.height/2-b!.y-b!.height/2)).toBeLessThan(1);
  await help.click();const dialog=page.getByRole('dialog',{name:'문제 검토 도움말',exact:true});
  await expect(dialog).toBeVisible();await expect(dialog).toContainText('다음 단계');
  for(let i=0;i<8;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
  await dialog.getByRole('button',{name:'도움말 닫기',exact:true}).focus();await expect(page.getByRole('tooltip').filter({visible:true})).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(help).toBeFocused();
  await help.click();await dialog.getByRole('button',{name:'도움말 닫기',exact:true}).click();await expect(help).toBeFocused();
  await help.click();
  await dialog.locator('summary').filter({hasText:'화면 예시로 살펴보기'}).click();
  await dialog.getByRole('button',{name:/화면 확대/}).click();
  const screenshot=page.getByRole('dialog',{name:'요약과 두 난도를 각각 검수하기',exact:true});
  await expect(screenshot).toBeVisible();await screenshot.getByRole('button',{name:/닫기/}).click();
  await expect(screenshot).toBeHidden();await expect(dialog).toBeVisible();
  if(process.env.CAPTURE_WORKFLOW==='1')await page.screenshot({path:`docs/design/phase-9/workflow-controls/connected-help-${info.project.name}.png`});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');expect(writes).toEqual([]);
});

test('new workflow shows five distinct lock placements without adding work',async({page})=>{
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/new');
  await expect(page.getByRole('link',{name:'← 퀴즈 목록',exact:true})).toHaveCount(0);
  const keys=page.getByRole('navigation',{name:'초안 편집 단계'}).getByRole('button');
  await expect(keys).toHaveCount(6);
  for(let i=1;i<6;i++)await expect(keys.nth(i)).toBeDisabled();
  const placements=await keys.evaluateAll(nodes=>nodes.map(n=>{
    const box=(el:Element)=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};};
    const visibleText=Array.from(n.querySelectorAll('span > span,span > b')).find(el=>el.getBoundingClientRect().width);
    return {key:box(n),number:box(n.querySelector('span')!),label:visibleText?box(visibleText):null,lock:n.querySelector('svg')?box(n.querySelector('svg')!):null};
  }));
  const two=placements[1]!,three=placements[2]!,four=placements[3]!;
  expect(Math.abs(two.label!.cx-two.key.cx)).toBeLessThan(1);
  expect(two.lock!.x+two.lock!.w).toBeLessThan(two.label!.x);
  expect(Math.abs((three.lock!.x+three.label!.x+three.label!.w)/2-three.key.cx)).toBeLessThan(1);
  expect(Math.abs(four.lock!.cy-four.number.cy)).toBeLessThan(1);
  expect(four.lock!.x+four.lock!.w).toBeLessThan(four.number.x);
  for(const index of [4,5]){
    const p=placements[index]!;
    expect(p.lock!.y-p.key.y).toBeLessThanOrEqual(10);
    expect(index===4?p.lock!.cx<p.key.cx:p.lock!.cx>p.key.cx).toBe(true);
  }
  expect(writes).toEqual([]);
});
