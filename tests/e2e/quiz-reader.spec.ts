import { expect, test } from "@playwright/test";
import { publicResponse } from "../fixtures/public-response";
import { selectSkyTime } from "./sky-control-helpers";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/quizzes/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/me")) return route.fulfill({ json: { data: { submission: null } } });
    return route.fulfill({ json: publicResponse(url.searchParams.get("difficulty") === "adult" ? "adult" : "child") });
  });
});

test("compact reader keeps summary, icon help and index navigation accessible", async ({ page }) => {
  await page.goto("/quiz/2026-08-31-test01?level=child");
  const tools = page.locator(".quiz-meta-tools");
  await expect(tools.getByRole("button")).toHaveCount(2);
  await expect(tools.getByRole("button").nth(0)).toHaveAccessibleName("설교일");
  await expect(tools.getByRole("button").nth(1)).toHaveAccessibleName("퀴즈 공유");
  await expect(page.getByRole("link", { name: "이번 주 말씀으로 돌아가기" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /대한성서공회에서 성경 읽기/ })).toHaveCount(0);
  await expect(page.locator(".quiz-scripture")).not.toContainText("개역개정");
  const summary = page.locator(".sermon-summary > summary");
  await expect(page.locator(".summary-copy")).toBeHidden();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/설교자의 원문이 아닙니다/)).toBeVisible();
  await page.keyboard.press("Enter");
  const date = page.getByRole("button", { name: "설교일", exact: true });
  await date.click();
  const tip = page.getByRole("tooltip", { name: /설교일 ·/ });
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("2026년 8월 31일 월요일");
  const placement = await tip.getAttribute("data-side");
  const triggerBox = (await date.boundingBox())!;
  const tipBox = (await tip.boundingBox())!;
  if (triggerBox.y - tipBox.height - 8 >= 12) expect(placement).toBe("above");
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await page.getByRole("tab", { name: "어린이용" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "장년용" })).toBeFocused();
  await expect(page.getByTestId("progress")).toHaveText("0 / 40칸 작성");
  const tabs = await page.getByRole("tablist", { name: "퀴즈 난이도" }).getByRole("tab").evaluateAll(nodes => nodes.map(node => { const b=node.getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right}; }));
  expect(Math.abs(tabs[0]!.top-tabs[1]!.top)).toBeLessThan(.1);
  expect(Math.abs(tabs[0]!.right-tabs[1]!.left)).toBeLessThan(.1);
  await page.locator(".quiz-export-disclosure > summary").click();
  await expect(page.getByRole("button", { name: "빈 격자 받기", exact: true })).toBeVisible();
});

test("four sky times retain full square grids and readable tools at narrow widths", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/quiz/2026-08-31-test01?level=adult");
  for (const time of ["새벽", "낮", "노을", "밤"]) {
    await selectSkyTime(page, time);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.getByTestId("grid-boundary").evaluate(node => {
        const box=node.getBoundingClientRect();
        const cells=[...node.querySelectorAll("[role=gridcell]")].map(cell=>cell.getBoundingClientRect());
        return { fits: document.documentElement.scrollWidth<=innerWidth && box.left>=0 && box.right<=innerWidth,
          square: Math.abs(box.width-box.height)<.2 && cells.every(cell=>Math.abs(cell.width-cell.height)<.1),
          all: cells.every(cell=>cell.left>=box.left && cell.right<=box.right+.1) };
      });
      expect(geometry).toEqual({fits:true,square:true,all:true});
      await expect(page.getByRole("button", { name: "입력 확인", exact: true })).toBeDisabled();
    }
  }
});


test("weekly reader replaces archive with a private participation preview", async ({ page }) => {
  const boardRequests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.endsWith("/board")) boardRequests.push(request.url()); });
  await page.goto("/?level=child");
  await expect(page.getByRole("heading", { name: "참여 현황", exact: true })).toBeVisible();
  await expect(page.getByText("답안을 제출하면 함께 참여한 분들의 답안을 볼 수 있어요.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "지난 퀴즈", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "아직 참여할 수 있는 퀴즈", exact: true })).toHaveCount(0);
  await page.locator(".quiz-export-disclosure > summary").click();
  const exportBox = (await page.locator(".quiz-export-disclosure").boundingBox())!;
  const participationBox = (await page.locator(".quiz-participation-panel").boundingBox())!;
  expect(participationBox.y).toBeGreaterThan(exportBox.y + exportBox.height);
  await expect(page.locator("#quiz-panel").getByRole("heading", { name: "참여 현황", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "참여 현황 보기", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "장년용" }).click();
  await expect(page.getByTestId("progress")).toHaveText("0 / 40칸 작성");
  await expect(page.getByRole("heading", { name: "참여 현황", exact: true })).toHaveCount(1);
  expect(boardRequests).toEqual([]);
});


test("input help stays under the same pointer while opening and closing", async ({ page }) => {
  await page.goto("/?level=child");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const button = page.getByRole("button", { name: "입력 안내", exact: true });
    await button.scrollIntoViewIfNeeded();
    const before = (await button.boundingBox())!;
    const x = before.x + before.width / 2, y = before.y + before.height / 2;
    await page.mouse.click(x, y);
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#input-help")).toBeVisible();
    const after = (await button.boundingBox())!;
    expect(Math.abs(after.x-before.x)).toBeLessThan(1);
    expect(Math.abs(after.y-before.y)).toBeLessThan(1);
    await page.mouse.click(x, y);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#input-help")).toBeHidden();
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-expanded", "false");
  }
});


test("share copies the stable quiz URL and offers manual copy on failure", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (url: string) => { localStorage.setItem("copiedShare", url); } }, configurable: true });
  });
  await page.goto("/?level=adult&extra=private#ignored");
  await page.getByRole("button", { name: "퀴즈 공유", exact: true }).click();
  await expect(page.getByText("퀴즈 주소를 복사했습니다.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("copiedShare"))).toBe("http://127.0.0.1:4173/quiz/2026-08-31-test01?level=adult");
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } } }); });
  await page.getByRole("button", { name: "퀴즈 공유", exact: true }).click();
  const field=page.getByRole("textbox", { name: "공유할 퀴즈 주소" });
  await expect(field).toHaveValue("http://127.0.0.1:4173/quiz/2026-08-31-test01?level=adult");
  await field.focus();
  expect(await field.evaluate(node => (node as HTMLInputElement).selectionEnd)).toBe((await field.inputValue()).length);
});

test("native share uses the selected quiz and cancellation does not copy", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: async (data: ShareData) => { localStorage.setItem("nativeShare", JSON.stringify(data)); throw new DOMException("cancel", "AbortError"); } });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { localStorage.setItem("unexpectedCopy", "true"); } } });
  });
  await page.goto("/?level=child");
  await page.getByRole("button", { name: "퀴즈 공유", exact: true }).click();
  await expect(page.getByRole("button", { name: "퀴즈 공유", exact: true })).toBeEnabled();
  const shared=JSON.parse((await page.evaluate(() => localStorage.getItem("nativeShare")))!);
  expect(shared.url).toBe("http://127.0.0.1:4173/quiz/2026-08-31-test01?level=child");
  expect(shared.title).toContain("어린이용");
  expect(await page.evaluate(() => localStorage.getItem("unexpectedCopy"))).toBeNull();
  await expect(page.getByText("퀴즈 주소를 복사했습니다.")).toHaveCount(0);
});


test("heading tools stay beside the title and help follows the input layout", async ({ page }) => {
  await page.goto("/?level=child");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const title=(await page.locator("#sermon-heading").boundingBox())!;
    const tools=(await page.locator(".quiz-meta-tools").boundingBox())!;
    expect(tools.x).toBeGreaterThanOrEqual(title.x+title.width);
    expect(tools.y).toBeLessThan(title.y+title.height);
    await page.getByRole("button", { name: "입력 안내", exact: true }).click();
    const mobile = width < 768 || await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    if (mobile) {
      await expect(page.getByText("빈칸을 터치해 키보드를 열고 한글을 입력하세요.", { exact: false })).toBeVisible();
      await expect(page.locator("#input-help kbd:visible")).toHaveCount(0);
    } else {
      await expect(page.locator("#input-help kbd").first()).toBeVisible();
      await expect(page.getByText("빈칸을 터치해 키보드를 열고 한글을 입력하세요.", { exact: false })).toBeHidden();
    }
    await page.getByRole("button", { name: "입력 안내", exact: true }).click();
  }
});

test("reader toolbar groups status and help and aligns the active clue with the grid", async ({ page }) => {
  await page.goto("/?level=child");
  await expect(page.locator(".quiz-availability-label")).toHaveText("참여 가능");
  await expect(page.locator(".quiz-availability[data-availability=open]")).toHaveCount(0);
  await expect(page.getByText(/5 × 5|6개 낱말/)).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const clue = (await page.locator("#current-clue").boundingBox())!;
    const grid = (await page.getByTestId("grid-boundary").boundingBox())!;
    expect(Math.abs(clue.x - grid.x)).toBeLessThan(1);
    const help = (await page.getByRole("button", { name: "입력 안내", exact: true }).boundingBox())!;
    const count = (await page.locator(".quiz-participants").boundingBox())!;
    const status = (await page.locator(".quiz-availability-label").boundingBox())!;
    expect(help.x).toBeGreaterThan(count.x + count.width);
    expect(status.y + status.height).toBeLessThanOrEqual(count.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});

test("archived reader retains the practice notice in a callout", async ({ page }) => {
  await page.route("**/api/quizzes/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/me")) return route.fulfill({ json: { data: { submission: null } } });
    const response = publicResponse();
    Object.assign(response.data.quiz!, { status: "archived", submissionState: "paused", mode: "practice", acceptingSubmissions: false, availability: "archived", solutionAccess: "public" });
    return route.fulfill({ json: response });
  });
  await page.goto("/quiz/2026-08-31-test01?level=child");
  await expect(page.locator(".quiz-availability-label")).toHaveText("마감");
  const notice = page.locator(".quiz-availability-callout");
  await expect(notice).toContainText("마감된 퀴즈입니다. 기록을 남기지 않고 다시 풀어볼 수 있습니다.");
  await expect(notice).toContainText("입력은 이 브라우저에 임시 저장됩니다.");
  await expect(page.locator("#input-status")).toContainText("빈칸");
});
