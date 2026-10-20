import {expect,test} from '@playwright/test';
import {mockAdminWorkspace} from './fixtures/admin-workspace';
import {mockAdminGuide} from './fixtures/admin-guide';

test('cassette steps retain all six numbers, distinguish recessed current and locked states, and support keyboard',async({page})=>{
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/quiz/weekly?step=3');
  const menu=page.getByRole('navigation',{name:'초안 편집 단계'});
  const current=menu.getByRole('button',{name:/단계 문제 검토/});
  const previous=menu.getByRole('button',{name:/단계 설교 준비/});
  const locked=menu.getByRole('button',{name:/단계 격자 구성/});
  await expect(current).toHaveAttribute('aria-current','step');
  await expect(previous).toHaveAttribute('data-recessed','true');
  await expect(locked).toBeDisabled();await expect(locked).toContainText('대기');
  for(let index=0;index<6;index++) await expect(menu.getByRole('button').nth(index).locator('span').first()).toHaveText(String(index+1));
  await expect(current).not.toHaveAttribute('data-recessed');
  await previous.focus();await page.keyboard.press('Enter');await expect(previous).toHaveAttribute('aria-current','step');
  await expect(previous).toHaveCSS('outline-offset','-5px');
  await expect(previous).not.toHaveAttribute('data-recessed');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(previous).toHaveCSS('transition-duration','0s');
  await page.emulateMedia({forcedColors:'active'});await expect(previous).toBeEnabled();await expect(locked).toBeDisabled();
  expect(writes).toEqual([]);
});

test('workspace metadata shares one compact group beside the title with accessible date and icon tips',async({page})=>{
  const writes=await mockAdminWorkspace(page);
  await page.goto('/admin/quiz/weekly?step=1');
  const header=page.locator('[data-admin-workspace] > header');
  await expect(header.locator('time')).toHaveAttribute('datetime','2026-10-11');
  await expect(header.locator('time')).toHaveText('2026.10.11 · 일요일');
  const group=header.getByRole('group',{name:'퀴즈 정보'});
  await expect(group.getByRole('button')).toHaveCount(3);
  const titleBox=await header.getByRole('heading').boundingBox(),groupBox=await group.boundingBox();
  expect(titleBox&&groupBox&&groupBox.x>=titleBox.x+titleBox.width).toBe(true);
  expect(titleBox&&groupBox&&Math.abs(titleBox.y+titleBox.height/2-groupBox.y-groupBox.height/2)).toBeLessThan(1);
  const timeBox=await header.locator('time').boundingBox();expect(timeBox?.width).toBeLessThanOrEqual(1);
  for(const [name,detail] of [['설교일','2026.10.11 · 일요일'],['작성 중인 퀴즈','아직 공개되지 않은 초안'],['저장·초안 보관 정보','마지막 저장:']]) {
    const icon=header.getByRole('button',{name,exact:true});
    await expect(icon.locator('svg')).toHaveCount(1);await icon.focus();
    const tip=page.getByRole('tooltip').filter({hasText:detail});
    await expect(tip).toBeVisible();await expect(tip).toHaveAttribute('data-side','above');
    const borders=await tip.evaluate(el=>{const s=getComputedStyle(el);return ['Top','Right','Bottom','Left'].map(side=>[s.getPropertyValue(`border-${side.toLowerCase()}-width`),s.getPropertyValue(`border-${side.toLowerCase()}-color`)].join('/'));});
    expect(new Set(borders).size).toBe(1);
    await page.keyboard.press('Escape');await expect(tip).toBeHidden();
    await icon.click();await expect(tip).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(writes).toEqual([]);
});

test('six-stage workspace keeps selections, preview controls and publication confirmation usable',async({page})=>{
  const writes=await mockAdminWorkspace(page);
  await page.goto('/admin/quiz/weekly?step=1');
  const steps=page.getByRole('list',{name:'주간 발행 6단계'});
  const names=['설교 준비','핵심 정리','문제 검토','격자 구성','최종 점검','공개하기'];
  for(const [index,name] of names.entries()) {
    const button=steps.getByRole('button',{name:new RegExp(`단계 ${name}`)});
    await expect(button).toBeEnabled();await button.click();
    await expect(button).toHaveAttribute('aria-current','step');
    await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    await expect(page.locator('[data-admin-workflow] > [data-admin-sheet]:visible')).toHaveCount(1);
    if(index===0)await expect(page.getByRole('textbox',{name:'설교 제목',exact:true})).toHaveValue('서로 돕는 한 주 · 연습');
    if(index===1)await expect(page.getByRole('textbox',{name:'내용',exact:true}).first()).toHaveValue('서로 사랑하며 이웃을 돕는 삶을 생각합니다.');
    if(index===2) {
      const group=page.getByRole('group',{name:'검수할 내용'});
      for(const level of ['어린이','장년']) {
        await group.getByRole('button',{name:new RegExp(level)}).click();
        await expect(page.getByRole('textbox',{name:'단서 1',exact:true}).filter({visible:true})).toHaveValue('서로 아끼는 마음');
      }
    }
    if(index===3)await page.getByRole('region',{name:'어린이 배치 시험'}).getByLabel('목표 단어 수').fill('3');
    if(index===4) {
      await expect(page.getByRole('grid',{name:'어린이 문제 격자',exact:true})).toBeVisible();
      await expect(page.getByLabel('색상 미리보기')).toHaveValue('current');
      await page.getByLabel('색상 미리보기').selectOption('dark');
      await expect(page.locator('[data-preview-theme=dark]:visible')).toHaveCount(2);
      await page.getByLabel('색상 미리보기').selectOption('current');
      await page.getByLabel('관리자 정답 보기',{exact:true}).check();
      await expect(page.getByRole('grid',{name:'어린이 정답 격자',exact:true})).toBeVisible();
      await expect(page.getByLabel('어린이 Top N')).toHaveValue('3');
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  const publish=page.getByRole('button',{name:'지금 발행',exact:true});
  await publish.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'지금 발행 확인'});
  await expect(dialog).toBeVisible();await expect(dialog).toContainText('기존 퀴즈의 마감·제출·순위는 유지됩니다.');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(publish).toBeFocused();
  await steps.getByRole('button',{name:/단계 격자 구성/}).click();
  await expect(page.getByRole('region',{name:'어린이 배치 시험'}).getByLabel('목표 단어 수')).toHaveValue('3');
  expect(writes).toEqual([]);
});

test('quiz settings preserve folded input and provide the same standalone deadline and winner forms',async({page})=>{
  const writes=await mockAdminWorkspace(page);
  await page.goto('/admin/quiz/published-example');
  const tool=page.locator('[data-admin-tool=quiz-metadata]');
  await tool.locator(':scope > summary').click();
  const title=tool.getByRole('textbox',{name:'설교 제목',exact:true});
  await expect(title).toHaveValue('함께 걷는 기쁨 · 연습');await title.fill('보존할 연습 제목');
  await tool.locator(':scope > summary').click();await tool.locator(':scope > summary').click();
  await expect(title).toHaveValue('보존할 연습 제목');
  for(const id of ['quiz-deadline','quiz-winners','quiz-correction']) {
    const panel=page.locator(`[data-admin-tool=${id}]`);await panel.locator(':scope > summary').click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
  }
  await expect(page.getByLabel('마감 변경 사유')).toBeVisible();
  await expect(page.getByLabel('어린이 Top N')).toBeVisible();
  await expect(page.getByLabel('공개 중지 안내')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const [operation,name] of [['deadline','마감 변경 사유'],['winners','어린이 Top N']]) {
    await page.goto(`/admin/quiz/published-example?operation=${operation}`);
    await expect(page.locator('[data-admin-sheet]').getByLabel(name!)).toBeVisible();
  }
  expect(writes).toEqual([]);
});
