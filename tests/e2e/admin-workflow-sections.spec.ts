import {expect,test} from '@playwright/test';
import {mockAdminWorkspace} from './fixtures/admin-workspace';
import {selectSkyTime} from './sky-control-helpers';

const stages=[
  {step:2,section:'생성과 작업 상태'},
  {step:3,section:'문제 1 편집'},
  {step:4,section:'어린이 배치 시험'},
  {step:5,section:'Top N 인원 설정'},
  {step:6,section:'공개 전 확인'},
];

test('editing subsections keep their contents and actions readable in every sky palette and at narrow widths',async({page},info)=>{
  test.skip(info.project.name!=='chromium','One complete viewport and palette matrix.');
  test.setTimeout(240000);
  const writes=await mockAdminWorkspace(page);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  for(const width of [1440,375,320]) {
    await page.setViewportSize({width,height:1000});
    for(const {step,section} of stages) {
      await page.goto(`/admin/quiz/weekly?step=${step}`);
      if(step===3)await page.getByRole('group',{name:'검수할 내용'}).getByRole('button',{name:/어린이/}).click();
      const sheet=page.locator('[data-admin-sheet]:visible');
      await expect(sheet).toHaveCount(1);await expect(page.getByRole('region',{name:section,exact:true})).toBeVisible();
      for(const [theme,label] of [['dawn','새벽'],['day','낮'],['sunset','노을'],['night','밤']]) {
        await selectSkyTime(page,label!);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        const groups=sheet.locator('[data-workflow-section]:visible');
        expect(await groups.count()).toBeGreaterThanOrEqual(2);
        for(const group of await groups.all()) {
          const metrics=await group.evaluate(node=>{
            const r=node.getBoundingClientRect(),heading=node.querySelector(':scope > h4')!;
            const fields=Array.from(node.querySelectorAll('input,textarea,select,button')).filter(el=>el.getClientRects().length);
            return {font:parseFloat(getComputedStyle(heading).fontSize),overflow:node.scrollWidth-node.clientWidth,
              outside:fields.filter(el=>{const f=el.getBoundingClientRect();return f.left<r.left-1||f.right>r.right+1;}).map(el=>el.outerHTML.slice(0,120))};
          });
          expect(metrics.font).toBe(15);expect(metrics.overflow).toBeLessThanOrEqual(1);expect(metrics.outside).toEqual([]);
        }
        if(process.env.CAPTURE_SECTIONS==='1' && width!==320) {
          // Actual UI with isolated synthetic data; never remote sermon content.
          await sheet.screenshot({path:`docs/design/phase-9/workflow-sections/step${step}-${theme}-${width}.png`,
            style:'.site-header,.page-dock { visibility:hidden!important; }'});
        }
      }
    }
  }
  expect(writes).toEqual([]);expect(errors).toEqual([]);
});

test('related review, placement, winner and publication controls stay in their own sections',async({page})=>{
  const writes=await mockAdminWorkspace(page);
  await page.goto('/admin/quiz/weekly?step=2');
  const generation=page.getByRole('region',{name:'생성과 작업 상태',exact:true});
  await expect(generation.getByRole('button',{name:'생성 상태 확인',exact:true})).toBeVisible();
  await page.locator('summary').filter({hasText:'설교 목적'}).click();
  const emptyGroup=page.locator('details').filter({has:page.locator(':scope > summary').filter({hasText:'설교 목적'})});
  await expect(emptyGroup.getByText('아직 작성한 항목이 없습니다.',{exact:true})).toBeVisible();
  await expect(emptyGroup.getByRole('button',{name:'이 항목 추가',exact:true})).toBeVisible();
  const nav=page.getByRole('navigation',{name:'초안 편집 단계'});
  await nav.getByRole('button',{name:/단계 문제 검토/}).click();
  await page.getByRole('group',{name:'검수할 내용'}).getByRole('button',{name:/어린이/}).click();
  const question=page.getByRole('region',{name:'문제 1 편집',exact:true});
  await expect(question.getByLabel('답 1',{exact:true})).toHaveValue('사랑');
  await expect(question.getByRole('textbox',{name:'단서 1',exact:true})).toHaveValue('서로 아끼는 마음');
  await expect(question.getByLabel('배치에 사용할지 선택')).toHaveValue('use');
  await expect(page.getByRole('region',{name:'검수와 저장',exact:true}).filter({visible:true}).getByRole('button',{name:'임시 저장',exact:true})).toBeVisible();
  await nav.getByRole('button',{name:/단계 격자 구성/}).click();
  const child=page.getByRole('region',{name:'어린이 배치 시험',exact:true});
  await expect(child.getByRole('button',{name:'어린이 배치 시험',exact:true})).toBeVisible();
  await child.getByLabel('목표 단어 수').fill('7');
  await expect(page.getByRole('region',{name:'배치 저장과 검사',exact:true}).getByRole('button')).toBeDisabled();
  await nav.getByRole('button',{name:/단계 최종 점검/}).click();
  const winners=page.getByRole('region',{name:'Top N 인원 설정',exact:true});
  await expect(winners.getByLabel('어린이 Top N')).toHaveValue('3');
  await expect(winners.getByRole('button',{name:'Top N 설정 저장',exact:true})).toBeVisible();
  await nav.getByRole('button',{name:/단계 공개하기/}).click();
  const publish=page.getByRole('region',{name:'공개 전 확인',exact:true}).getByRole('button',{name:'지금 발행',exact:true});
  await publish.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog',{name:'지금 발행 확인',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(publish).toBeFocused();
  await nav.getByRole('button',{name:/단계 격자 구성/}).click();
  await expect(child.getByLabel('목표 단어 수')).toHaveValue('7');
  expect(writes).toEqual([]);
});

test('expanded evidence, quality and regeneration keep fields and actions inside the reading area',async({page},info)=>{
  test.setTimeout(60000);
  const writes=await mockAdminWorkspace(page);
  const width=info.project.name==='chromium'?1440:375;
  await page.setViewportSize({width,height:1000});
  await page.goto('/admin/quiz/weekly?step=2');
  const generation=page.getByRole('region',{name:'생성과 작업 상태',exact:true});
  await generation.locator('summary').filter({hasText:'다시 생성·이전 결과 선택'}).click();
  const article=page.locator('article[id^="snapshot-"]:visible');
  await article.locator('summary').filter({hasText:'원문 근거 확인'}).click();
  await article.locator('summary').filter({hasText:'품질 평가와 검토 메모'}).click();
  const quality=page.getByRole('region',{name:'관리자 품질 평가',exact:true}).filter({visible:true});
  await expect(quality.getByRole('button',{name:'평가 저장',exact:true})).toBeVisible();
  for(const [theme,label] of [['dawn','새벽'],['day','낮'],['sunset','노을'],['night','밤']]) {
    await selectSkyTime(page,label!);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const region of [generation,quality]) {
      expect(await region.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
    }
    if(process.env.CAPTURE_SECTIONS==='1' && ['day','night'].includes(theme!)) {
      for(const [name,region] of [['generation',generation],['quality',quality]] as const)
        await region.screenshot({path:`docs/design/phase-9/workflow-sections/expanded-${name}-${theme}-${width}.png`,style:'.site-header,.page-dock { visibility:hidden!important; }'});
    }
  }
  await page.goto('/dev/design#workflow-section');
  const gallery=page.getByRole('region',{name:'작업 소섹션',exact:true});
  await gallery.getByRole('button',{name:'임시 저장',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('실제 퀴즈 자료는 변경하지 않습니다.');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(writes).toEqual([]);
});
