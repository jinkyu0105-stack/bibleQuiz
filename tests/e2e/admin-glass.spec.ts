import { openAdminTool } from "../fixtures/admin-tools";
import { expect, test } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";
import { mockAdminGuide } from "./fixtures/admin-guide";

const at = "2026-10-10T00:00:00.000Z";
test("admin menus group tasks, use a flat moving highlight and use compact shared actions", async ({ page, isMobile }, info) => {
  test.setTimeout(60_000);
  const requests: string[] = [];
  await page.route("**/api/admin/**", route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path.endsWith("/usage-summary")) return route.fulfill({ status: 503, json: { error: { message: "합성 조회 대기" } } });
    if (path.endsWith("/manual")) return route.fulfill({ json: { data: { markdown: "# 운영 안내", updatedAt: at, verification: "합성 검사", deployment: "local" } } });
    return route.fulfill({ json: { data: path.endsWith("/dashboard") ? { items: [], unansweredCount: 0 } : { items: [] } } });
  });
  const reference = publicResponse("child");
  Object.assign(reference.data.quiz!, { status: "archived", availability: "archived", mode: "practice", acceptingSubmissions: false, solutionAccess: "public" });
  await page.route("**/api/quizzes/**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/me") ? { data: { submission: null } } : reference }));
  await page.goto("/quiz/2026-08-31-test01?level=child");
  const solution = page.getByRole("button", { name: "정답보기", exact: true });
  await expect(solution).toHaveAttribute("aria-disabled", "false");
  await page.getByRole("button", { name: "낮", exact: true }).click();
  await page.goto("/admin");
  const refresh = page.getByRole("button", { name: "운영 상태 새로고침", exact: true });
  await expect(refresh).toBeEnabled();
  const before = requests.filter(path => path.endsWith("/dashboard")).length;
  await refresh.click();
  await expect.poll(() => requests.filter(path => path.endsWith("/dashboard")).length).toBeGreaterThan(before);
  await expect(refresh).toHaveCSS("border-radius", "50%");
  await expect(refresh.locator("svg")).toHaveCount(1);
  await expect(refresh).toHaveText("");
  await expect(refresh).toHaveCSS("min-height", isMobile ? "44px" : "36px");
  expect(await refresh.evaluate(node => getComputedStyle(node, "::before").content)).toBe("none");
  await expect(refresh).not.toHaveAttribute("data-lens-ready");
  await expect(page.getByRole("heading",{name:"퀴즈 관리",exact:true})).toHaveCSS("font-family", /Noto Sans KR/);
  await page.locator(".admin-main").screenshot({ path: info.outputPath("admin-buttons-day.png") });
  const sidebar=page.locator("aside[data-glass-panel=standard]"),navigation=page.getByRole("navigation",{name:"관리자 운영 메뉴"});
  await expect(sidebar).toHaveCSS('background-color',await page.locator('.admin-main').evaluate(node=>getComputedStyle(node).backgroundColor));
  const toggle=sidebar.locator("summary").filter({hasText:"관리자 운영 메뉴"});
  if (isMobile) {
    await toggle.focus(); await page.keyboard.press("Enter"); await expect(navigation).toBeVisible();
    await page.keyboard.press("Space"); await expect(navigation).toBeHidden();
    await page.keyboard.press("Enter");
  } else {
    await expect(sidebar.getByRole("heading",{name:"관리 공간"})).toBeVisible();
    await expect(sidebar.getByRole("heading",{name:"관리 공간"})).toHaveCSS("font-family", /Noto Sans KR/);
    await expect(sidebar.getByRole("heading",{name:"관리 공간"})).toHaveCSS("font-weight", "700");
    await expect(sidebar).toHaveCSS("width","220px");
    const group = navigation.getByRole("heading", {name:"퀴즈 운영",exact:true});
    await expect(group).toBeVisible();
    await expect(group).toHaveCSS("font-family", /Noto Sans KR/);
    await expect(group).toHaveCSS("font-weight", "700");
  }
  await expect(navigation.getByRole("link")).toHaveCount(3);
  await navigation.locator("summary").filter({hasText:"도구와 설정"}).click();
  await expect(navigation.getByRole("link")).toHaveCount(7);
  if (!isMobile) {
    const target=navigation.getByRole("link",{name:"이름·문구 필터",exact:true});
    const current = navigation.getByRole("link", {name:"퀴즈 관리",exact:true});
    const highlight = navigation.locator(':scope > span[aria-hidden="true"]');
    await expect(highlight).toBeVisible();
    await target.hover();
    const iconSurface = highlight.locator('[data-admin-menu-icon-surface]');
    await expect(iconSurface).toHaveCount(1);
    // The target's glyph stays transparent; only the travelling row carries an icon well.
    await expect(target.locator('[data-admin-menu-icon]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(navigation.locator('.glass-indicator, [data-glass-convex]')).toHaveCount(0);
    await expect(highlight).toHaveCSS("border-width", "0px");
    expect(await highlight.evaluate(node => getComputedStyle(node, "::before").content)).toBe("none");
    await expect.poll(async () => {
      const a = await target.boundingBox(), b = await highlight.boundingBox();
      return a && b ? Math.abs(a.y - b.y) : 999;
    }).toBeLessThan(1);
    await page.locator('.admin-main h2').hover();
    await expect.poll(async () => {
      const a = await current.boundingBox(), b = await highlight.boundingBox();
      return a && b ? Math.abs(a.y - b.y) : 999;
    }).toBeLessThan(1);
  }
  await sidebar.screenshot({path:info.outputPath("sidebar-grouped.png")});
  const filterLink=navigation.getByRole("link",{name:"이름·문구 필터",exact:true});
  await filterLink.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/moderation$/);
  await expect(sidebar.locator("[aria-current=page]")).toHaveCount(1);
  await expect(sidebar.locator('a[href="/admin/moderation"]')).toHaveAttribute("aria-current","page");
  for (const path of ["/admin/moderation", "/admin/privacy-requests", "/admin/tools", "/admin/operations", "/admin/manual"]) {
    await page.goto(path);
    if (path === "/admin/tools") await openAdminTool(page, "metadata");
    if (path === "/admin/moderation") await openAdminTool(page, "filter-add");
    if (path === "/admin/manual") {
      await expect(page.getByRole("heading", {name: "운영 매뉴얼", exact: true})).toBeVisible();
      await expect(page.locator(".admin-main .action-button")).toHaveCount(0);
    } else {
      const button=page.locator(".admin-main .action-button").first();
      await expect(button).toBeVisible();
      await expect(button).toHaveCSS("min-height",await button.getAttribute("data-admin-refresh") !== null && !isMobile ? "36px" : "44px");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/admin/operations");
  await page.getByRole("button", { name: "밤", exact: true }).click();
  await expect(page.locator(".admin-main button.secondary-button").first()).toHaveCSS("color", "rgb(172, 200, 255)");
  await page.getByRole("button", { name: "투명도 줄이기", exact: true }).click();
  expect(await page.locator(".admin-main button.secondary-button").first().evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".admin-main").screenshot({ path: info.outputPath("admin-night-320.png") });
  await page.goto("/admin/manual");
  if (!await navigation.isVisible()) await toggle.click();
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  const manualLink=navigation.getByRole("link",{name:"도움말",exact:true});
  await manualLink.focus(); await expect(manualLink).toBeFocused();
  await expect(manualLink).toHaveAttribute("aria-current","page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("manual topics and app navigation share selection feedback while keeping the current topic", async ({page,isMobile}) => {
  const writes = await mockAdminGuide(page);
  await page.goto('/admin/manual');
  await expect(page.getByRole('article')).toBeVisible();
  const nav = page.getByRole('navigation', {name:'매뉴얼 주제'});
  if (isMobile) {
    await expect(nav).toBeHidden();
    const topic = page.getByRole('combobox', {name:'읽을 주제'});
    await topic.selectOption('service-openai');
    await expect(page.getByRole('heading', {name:'OpenAI API',exact:true})).toBeFocused();
    await topic.selectOption('guide-3');
  } else {
    const current = nav.getByRole('button', {name:'퀴즈 만들기',exact:true});
    const hover = nav.getByRole('button', {name:'매월 비용 확인',exact:true});
    const selection = nav.locator('[data-admin-menu-selection]');
    const appSelection = page.getByRole('navigation', {name:'관리자 운영 메뉴'}).locator('[data-admin-menu-selection]');
    for (const time of ['낮','밤']) {
      await page.getByRole('button', {name:time,exact:true}).click();
      for (const property of ['background-color','border-radius','box-shadow']) {
        await expect(selection).toHaveCSS(property,await appSelection.evaluate((n,p)=>getComputedStyle(n).getPropertyValue(p),property));
      }
      await hover.hover();
      await expect(current).toHaveAttribute('aria-current','true');
      await expect(hover.locator('[data-admin-menu-icon]')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
      await expect(selection.locator('[data-admin-menu-icon-surface]')).toHaveCount(1);
      await expect.poll(async()=>Math.abs((await selection.boundingBox())!.y-(await hover.boundingBox())!.y)).toBeLessThan(1);
      await expect.poll(async()=>Math.abs((await selection.locator('[data-admin-menu-icon-surface]').boundingBox())!.y-(await hover.locator('[data-admin-menu-icon]').boundingBox())!.y)).toBeLessThan(1);
      await page.getByRole('article').hover();
      await expect.poll(async()=>Math.abs((await selection.boundingBox())!.y-(await current.boundingBox())!.y)).toBeLessThan(1);
    }
    const group = nav.locator('summary').filter({hasText:'서비스 사전'});
    await group.focus(); await page.keyboard.press('Enter');
    const service = nav.getByRole('button', {name:'OpenAI API',exact:true});
    await service.focus();
    await expect.poll(async()=>Math.abs((await selection.boundingBox())!.y-(await service.boundingBox())!.y)).toBeLessThan(1);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading',{name:'OpenAI API',exact:true})).toBeFocused();
    await expect(service).toHaveAttribute('aria-current','true');
  }
  expect(await page.getByRole('article').evaluate(n=>getComputedStyle(n).backgroundColor)).not.toBe(await page.locator('.admin-main').evaluate(n=>getComputedStyle(n).backgroundColor));
  await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
  await expect(page.getByRole('article')).toHaveCSS('box-shadow','none');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(writes).toEqual([]);
});

test('choosing lower manual topics returns fully to the top and keeps reading focus', async ({page,isMobile}) => {
  const writes = await mockAdminGuide(page);
  await page.goto('/admin/manual');
  await expect(page.locator('#manual-article-title')).toBeVisible();
  const nav = page.getByRole('navigation',{name:'매뉴얼 주제'});
  const choices = [
    {group:'설정과 자료 보호',label:'용어 모아보기'},
    {group:'서비스 사전',label:'서비스 주소'},
    {group:'설정과 자료 보호',label:'개인정보와 성경 본문'},
  ];
  for (const choice of choices) {
    if (isMobile) {
      await page.evaluate(()=>scrollTo(0,250));
      const selector = page.getByRole('combobox',{name:'읽을 주제'});
      // Use the actual option value so this regression follows the registry's identifier.
      const value = await selector.locator('option').filter({hasText:choice.label}).getAttribute('value');
      await selector.selectOption(value!);
    } else {
      const group = nav.locator('details').filter({has:page.getByText(choice.group,{exact:true})});
      if (!await group.evaluate(node=>(node as HTMLDetailsElement).open)) await group.locator('summary').click();
      const item = nav.getByRole('button',{name:choice.label,exact:true});
      await item.focus(); await page.keyboard.press('Enter');
    }
    await expect(page.locator('#manual-article-title')).toBeFocused();
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
    await expect(page.getByRole('heading',{name:'운영 매뉴얼',exact:true})).toBeInViewport();
  }
  expect(writes).toEqual([]);
});
