import {expect,test} from '@playwright/test';
import {mockAdminWorkspace} from './fixtures/admin-workspace';

test('six-stage workspace keeps selections, preview controls and publication confirmation usable',async({page})=>{
  const writes=await mockAdminWorkspace(page);
  await page.goto('/admin/quiz/weekly?step=1');
  const steps=page.getByRole('list',{name:'주간 발행 6단계'});
  const names=['설교 영상','설교 의도','요약과 문제','격자 배치','최종 확인','발행'];
  for(const [index,name] of names.entries()) {
    const button=steps.getByRole('button',{name:new RegExp(`^${name}`)});
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
  await steps.getByRole('button',{name:/^격자 배치/}).click();
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
