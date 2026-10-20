import {expect,test} from '@playwright/test';
import {mockAdminGuide} from './fixtures/admin-guide';
import {selectSkyTime} from './sky-control-helpers';

test('workflow keys keep number order, glass controls and one-row keys and no overflow at desktop and narrow mobile widths',async({page},info)=>{
  test.skip(info.project.name!=='chromium','Viewport matrix runs once.');
  test.setTimeout(90_000);
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
      if(process.env.CAPTURE_WORKFLOW==='1' && [1440,375].includes(width)) await page.locator('[data-admin-workflow]').screenshot({path:`docs/design/phase-9/workflow-controls/refined-actual-${theme}-${width}.png`});
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
  expect((await help.locator('span').boundingBox())!.width).toBe(22);
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
  if(process.env.CAPTURE_WORKFLOW==='1')await page.screenshot({path:`docs/design/phase-9/workflow-controls/refined-help-${info.project.name}.png`});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');expect(writes).toEqual([]);
});

test('new workflow centers every lock with its label without adding work',async({page})=>{
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
  for(const item of placements.slice(1)) {
    expect(item.number.cx).toBeCloseTo(item.key.cx,0);
    expect(item.lock!.x+item.lock!.w).toBeLessThan(item.label!.x);
    expect(Math.abs(item.lock!.cy-item.label!.cy)).toBeLessThan(1);
    expect(Math.abs((item.lock!.x+item.label!.x+item.label!.w)/2-item.key.cx)).toBeLessThan(1);
  }
  expect(writes).toEqual([]);
});


test('sermon fields form a separate subsection below the resume notice',async({page})=>{
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/new');
  const sermon=page.getByRole('region',{name:'설교 정보',exact:true});
  const reference=page.getByRole('region',{name:'성경 장절 입력',exact:true});
  const notice=page.getByText('입력은 이 브라우저에 임시 보관됩니다. ‘새 작업 등록’을 눌러야 만들던 퀴즈 목록에 추가됩니다.',{exact:true});
  await expect(sermon.getByLabel('YouTube 영상 링크')).toBeVisible();
  await expect(sermon.getByLabel('설교 제목',{exact:true})).toBeVisible();
  await expect(sermon.getByLabel('설교 일자(주일)')).toBeVisible();
  await expect(sermon.getByRole('button',{name:'제목에서 설교일 추천'})).toBeVisible();
  await expect(sermon.getByLabel('성경 장절',{exact:true})).toHaveCount(0);
  await expect(reference.getByLabel('성경 장절',{exact:true})).toBeVisible();
  const n=await notice.boundingBox(),s=await sermon.boundingBox(),r=await reference.boundingBox();
  expect(s!.y-n!.y-n!.height).toBeGreaterThanOrEqual(27);
  expect(r!.y-s!.y-s!.height).toBeGreaterThanOrEqual(23);
  const heading=sermon.getByRole('heading',{name:'설교 정보',exact:true});
  await expect(heading).toHaveCSS('font-size','15px');
  await expect(heading).toHaveCSS('margin-bottom','0px');
  await sermon.getByLabel('설교 제목',{exact:true}).fill('261018 연습 제목');
  await sermon.getByRole('button',{name:'제목에서 설교일 추천'}).click();
  await expect(sermon.getByLabel('설교 일자(주일)')).toHaveValue('2026-10-18');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(writes).toEqual([]);
});

test('workflow pointer focus stays quiet and hover sheen crosses diagonally once',async({page},info)=>{
  test.skip(info.project.name!=='chromium','Pointer motion uses a desktop browser.');
  await page.goto('/dev/design#workflow');
  const key=page.getByRole('navigation',{name:'초안 편집 단계'}).getByRole('button').nth(2);
  await key.scrollIntoViewIfNeeded();
  const initial=await key.boundingBox();
  await key.hover();
  // Freeze the native CSS animation at two points to inspect its direction without timing races.
  const positions=await key.evaluate(el=>{
    const animation=el.getAnimations({subtree:true}).find(a=>a instanceof CSSAnimation && a.animationName.includes('keySheen'))!;
    if(!animation)throw new Error('Hover sheen did not start');
    animation.pause();
    return [90,300].map(time=>{animation.currentTime=time;const m=new DOMMatrix(getComputedStyle(el,'::after').transform);return {x:m.m41,y:m.m42,iterations:animation.effect!.getTiming().iterations};});
  });
  expect(positions[1]!.x).toBeGreaterThan(positions[0]!.x);
  expect(positions[1]!.y).toBeGreaterThan(positions[0]!.y);
  expect(positions[0]!.iterations).toBe(1);
  await key.click();await expect(key).toHaveCSS('outline-style','none');
  expect(await key.boundingBox()).toEqual(initial);
  await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
  await expect(key).toBeFocused();await expect(key).toHaveCSS('outline-style','solid');
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await key.evaluate(el=>getComputedStyle(el,'::after').display)).toBe('none');
});
