import { expect, test } from '@playwright/test';
import { mockAdminGuide } from './fixtures/admin-guide';
import { adminScreenshots } from '../../src/config/admin-screenshots';

test('admin concepts work with hover, keyboard, touch and dismissal without writes', async ({ page }, info) => {
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/submissions?quiz=published-example');
  await page.locator('summary').filter({hasText:'용어·화면 안내'}).click();
  const term=page.getByRole('button',{name:'개인정보 삭제',exact:true}).first();
  if(!info.project.use.isMobile) {
    await term.hover();
    const tooltip=page.getByRole('tooltip');
    await expect(tooltip).toContainText('복구할 수 없고');
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
  }
  await term.focus();
  await expect(page.getByRole('tooltip')).toContainText('같은 퀴즈·난도');
  await expect(term).toHaveAccessibleDescription(/복구할 수 없고/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(term).toBeFocused();
  await term.click();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(page.getByRole('tooltip')).toBeHidden();
  await page.setViewportSize({width:320,height:740});
  for(const name of ['새벽','낮','노을','밤']) {
    await page.getByRole('button',{name,exact:true}).click();
    await term.click();
    await expect(page.getByRole('tooltip')).toBeVisible();
    const borders=await page.getByRole('tooltip').evaluate(el=>{const s=getComputedStyle(el);return ['top','right','bottom','left'].map(side=>`${s.getPropertyValue(`border-${side}-width`)}/${s.getPropertyValue(`border-${side}-color`)}`);});
    expect(new Set(borders).size).toBe(1);
    const box=await page.getByRole('tooltip').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x+box!.width).toBeLessThanOrEqual(320);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y+box!.height).toBeLessThanOrEqual(740);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(writes).toEqual([]);
});

test('tooltips prefer above and only move below when the top space runs out', async ({ page }) => {
  const writes = await mockAdminGuide(page);
  await page.goto('/admin/manual');
  await expect(page.getByRole('heading', { name: '퀴즈를 만드는 순서', exact: true })).toBeVisible();
  const term = page.getByRole('button', { name: '확정', exact: true }).first();
  const tooltip = page.getByRole('tooltip');
  await term.focus();
  await expect(tooltip).toBeVisible();
  const alignTerm = (top: number) => term.evaluate((element, top) => {
    window.scrollBy(0, element.getBoundingClientRect().top - top);
  }, top);
  const placement = () => term.evaluate(element => {
    const anchor = element.getBoundingClientRect();
    const bubble = document.getElementById(element.getAttribute('aria-describedby')!)!.getBoundingClientRect();
    return {
      aboveGap: anchor.top - bubble.bottom,
      belowGap: bubble.top - anchor.bottom,
      top: bubble.top,
      bottom: bubble.bottom,
    };
  });
  const threshold = (await tooltip.boundingBox())!.height + 8 + 12;
  await alignTerm(threshold + 1);
  await expect.poll(async () => (await placement()).aboveGap).toBeCloseTo(8, 0);
  expect((await placement()).top).toBeGreaterThanOrEqual(12);
  // Crossing the top margin changes direction while the same tooltip stays open.
  await alignTerm(threshold - 1);
  await expect.poll(async () => (await placement()).belowGap).toBeCloseTo(8, 0);
  expect((await placement()).bottom).toBeLessThanOrEqual(page.viewportSize()!.height - 12);
  await alignTerm(360);
  await expect.poll(async () => (await placement()).aboveGap).toBeCloseTo(8, 0);
  await page.setViewportSize({ width: 320, height: 740 });
  await alignTerm(360);
  await term.click();
  await expect(tooltip).toBeVisible();
  await expect.poll(async () => (await placement()).aboveGap).toBeCloseTo(8, 0);
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  expect(writes).toEqual([]);
});

test('manual screenshots enlarge with focus return, zoom, Escape and outside close', async ({ page }) => {
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/manual');
  const thumbnail=page.getByRole('button',{name:'요약과 두 난도를 각각 검수하기 화면 확대',exact:true});
  await thumbnail.scrollIntoViewIfNeeded();
  await expect(thumbnail.locator('img')).toBeVisible();
  await expect.poll(() => thumbnail.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>600)).toBe(true);
  await thumbnail.click();
  const dialog=page.getByRole('dialog',{name:'요약과 두 난도를 각각 검수하기'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'닫기',exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:'원본 크기로 보기'}).click();
  await expect(dialog.getByRole('button',{name:'화면에 맞추기'})).toHaveAttribute('aria-pressed','true');
  await dialog.getByRole('region',{name:'확대한 화면'}).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button',{name:'닫기',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(thumbnail).toBeFocused();
  await thumbnail.click();
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  await expect(thumbnail).toBeFocused();
  await thumbnail.click();
  await page.mouse.click(2,2);
  await expect(dialog).toBeHidden();
  await expect(thumbnail).toBeFocused();
  expect(writes).toEqual([]);
});

test('guide examples preserve editable fields and load every real screenshot', async ({ page }) => {
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/moderation');
  await page.locator('[data-admin-tool="filter-test"] > summary').click();
  const field=page.getByRole('textbox',{name:'시험 문구',exact:true});
  await field.fill('저장하지 않은 연습 문구');
  await page.locator('[data-admin-screenshots] > summary').click();
  const thumbnail=page.getByRole('button',{name:'필터를 저장하기 전에 시험하기 화면 확대'});
  await thumbnail.click();
  await page.keyboard.press('Escape');
  await expect(field).toHaveValue('저장하지 않은 연습 문구');
  for(const screenshot of Object.values(adminScreenshots)) {
    const response=await page.request.get(`/images/admin-guide/${screenshot.file}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');
    expect((await response.body()).byteLength).toBeGreaterThan(5000);
  }
  expect(writes).toEqual([]);
});

test('all admin destinations retain headings, restrained emoji and contextual concepts', async ({ page }) => {
  const writes=await mockAdminGuide(page);
  const cases=[
    ['/admin','퀴즈 관리','초안'],['/admin/submissions','참여 기록','숨김'],
    ['/admin/privacy-requests','문의·삭제 요청','처리 완료'],['/admin/tools','수정·보관 도구','초안'],
    ['/admin/moderation','이름·문구 필터 관리','정확한 예외'],['/admin/operations','비용·백업 상태','예상 비용'],
    ['/admin/quiz/weekly?step=3','요약과 문제','검수'],
  ];
  for(const [url,title,term] of cases) {
    await page.goto(url!);
    const heading=page.getByRole('heading',{name:title!,exact:true}).first();
    await expect(heading).toBeVisible();
    const guide=page.locator('summary').filter({hasText:'용어·화면 안내'});
    if(await guide.count())await guide.click();
    await expect(heading.locator('[aria-hidden="true"]').first()).toContainText(/\p{Extended_Pictographic}/u);
    await page.getByRole('button',{name:term!,exact:true}).first().focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(writes).toEqual([]);
});


test('manual explains emphasized concepts while preserving copyable technical names', async ({ page }) => {
  const writes=await mockAdminGuide(page);
  await page.goto('/admin/manual');
  await expect(page.getByRole('heading',{name:'퀴즈를 만드는 순서',exact:true})).toBeVisible();
  const select=page.getByRole('combobox',{name:'읽을 주제'});
  if(await select.isVisible()) await select.selectOption('guide-5');
  else {
    const nav=page.getByRole('navigation',{name:'매뉴얼 주제'});
    await nav.locator('summary').filter({hasText:'설정과 자료 보호'}).click();
    await nav.getByRole('button',{name:'연습·운영 서버',exact:true}).click();
  }
  await page.getByRole('button',{name:'Preview',exact:true}).focus();
  await expect(page.getByRole('tooltip')).toContainText('연습용 서버');
  await page.keyboard.press('Escape');
  const identifier=page.locator('code').filter({hasText:'D1_DATABASE_ID'});
  await expect(identifier).toHaveText('D1_DATABASE_ID');
  await expect(identifier.getByRole('button')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('manual uses meaning colours, official service icons and natural Korean wrapping', async ({ page }) => {
  const writes = await mockAdminGuide(page);
  await page.goto('/admin/manual');
  const article = page.getByRole('article', { name: '퀴즈를 만드는 순서' });
  await expect(article).toBeVisible();
  async function choose(id: string, name: string, group: string) {
    const select = page.getByRole('combobox', { name: '읽을 주제' });
    if (await select.isVisible()) await select.selectOption(id);
    else {
      const nav = page.getByRole('navigation', { name: '매뉴얼 주제' });
      if (group) {
        const section = nav.locator('details').filter({ hasText: group });
        if (await section.getAttribute('open') === null) await section.locator('summary').click();
      }
      await nav.getByRole('button', { name, exact: true }).click();
    }
  }
  const colours = new Map<string, string[]>();
  for (const theme of ['새벽', '낮', '노을', '밤']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await choose('guide-3', '퀴즈 만들기', '');
    const current: string[] = [];
    for (const name of ['발행', '확정', '발행 완료', '설교 의도']) {
      const term = page.getByRole('article').getByRole('button', { name, exact: true }).first();
      current.push(await term.evaluate(el => getComputedStyle(el).color));
    }
    await choose('guide-11', '개인정보와 성경 본문', '설정과 자료 보호');
    current.push(await page.getByRole('button', { name: '개인정보 삭제', exact: true }).evaluate(el => getComputedStyle(el).color));
    expect(new Set(current).size).toBe(5);
    colours.set(theme, current);
  }
  expect(new Set([...colours.values()].map(values => values.join(','))).size).toBe(4);
  for (const [id, name, file] of [['openai','OpenAI API','openai.svg'],['r2','Cloudflare R2','cloudflare.png'],['github_actions','GitHub Actions','github.svg']]) {
    await choose(`service-${id}`, name!, '서비스 사전');
    const logo = page.getByRole('heading', { name, exact: true }).locator('img');
    await expect(logo).toHaveAttribute('src', `/images/services/${file}`);
    expect(await logo.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await choose('guide-1', '사이트 소개', '설정과 자료 보호');
    const intro = page.getByRole('article');
    await expect(intro).toContainText('빈칸이 있어도 제출할 수 있습니다.');
    const word = intro.getByRole('button', { name: '초안', exact: true }).locator('..');
    await expect(word).toHaveText('초안을', { useInnerText: true });
    const wordLines = await word.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const centers = [...range.getClientRects()].filter(rect => rect.height > 0).map(rect => rect.y + rect.height / 2);
      return Math.max(...centers) - Math.min(...centers);
    });
    expect(wordLines).toBeLessThan(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(writes).toEqual([]);
});
