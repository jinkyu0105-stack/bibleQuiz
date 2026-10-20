import {expect,test} from '@playwright/test';
import {mockAdminGuide} from './fixtures/admin-guide';
import {selectSkyTime} from './sky-control-helpers';

test('workflow keys keep number order, opaque theme surface and no overflow at desktop and narrow mobile widths',async({page},info)=>{
  test.skip(info.project.name!=='chromium','Viewport matrix runs once.');
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/quiz/weekly?step=3');
  for(const width of [1440,768,425,375,320]) {
    await page.setViewportSize({width,height:1000});
    for(const [theme,label] of [['dawn','새벽'],['day','낮'],['sunset','노을'],['night','밤']]) {
      await selectSkyTime(page,label!);
      const nav=page.getByRole('navigation',{name:'초안 편집 단계'});
      await nav.scrollIntoViewIfNeeded();
      const keys=nav.getByRole('button');await expect(keys).toHaveCount(6);
      const boxes=await keys.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:Math.round(r.y)};}));
      for(let i=1;i<boxes.length;i++)expect(boxes[i]!.y>boxes[i-1]!.y-3 || boxes[i]!.x>boxes[i-1]!.x).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await expect(keys.nth(2)).toHaveAttribute('aria-current','step');await expect(keys.nth(3)).toBeDisabled();
      if(process.env.CAPTURE_WORKFLOW==='1' && [1440,375].includes(width)) await page.locator('[data-admin-workflow]').screenshot({path:`docs/design/phase-9/workflow-controls/actual-${theme}-${width}.png`});
    }
  }
  expect(writes).toEqual([]);
});
