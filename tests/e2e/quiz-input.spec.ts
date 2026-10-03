import { expect, test, type Page } from "@playwright/test";

const nativeInput = (page: Page) => page.getByRole("textbox", { name: /^낱말 입력:/ });

async function expectWholeGridFits(page: Page) {
  const geometry = await page.getByTestId("grid-boundary").evaluate((boundary) => {
    const frame = boundary.getBoundingClientRect();
    const cells = [...boundary.querySelectorAll('[role="gridcell"]')].map((cell) => cell.getBoundingClientRect());
    return {
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
      allCellsFit: cells.every((cell) => cell.left >= frame.left && cell.right <= frame.right + .1 && cell.top >= frame.top && cell.bottom <= frame.bottom + .1),
      squareCells: cells.every((cell) => cell.width > 0 && Math.abs(cell.width - cell.height) < .1),
      squareGrid: Math.abs(frame.width - frame.height) < .2,
      inViewport: frame.left >= 0 && frame.right <= window.innerWidth,
      horizontalOverflow: boundary.scrollWidth - boundary.clientWidth,
      scrollLeft: boundary.scrollLeft,
    };
  });
  expect(geometry).toEqual({ pageFits: true, allCellsFit: true, squareCells: true, squareGrid: true, inViewport: true, horizontalOverflow: 0, scrollLeft: 0 });
}

// These exercise browser event delivery and React integration, not an OS IME.
async function snapshot(page: Page, value: string, composing = false) {
  await nativeInput(page).evaluate((element, data) => {
    const input = element as HTMLInputElement;
    input.value = data.value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", isComposing: data.composing }));
  }, { value, composing });
}

async function iosInsert(page: Page, value: string, data: string) {
  await nativeInput(page).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    input.value = next.value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: next.data }));
  }, { value, data });
}

async function iosReplace(page: Page, value: string, data: string) {
  await nativeInput(page).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    const deletionAllowed = input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" }));
    if (deletionAllowed) {
      input.value = Array.from(input.value).slice(0, -1).join("");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    }
    input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: next.data }));
    input.value += next.data;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: next.data }));
    if (input.value !== next.value) throw new Error(`iOS replacement produced ${input.value}, expected ${next.value}`);
  }, { value, data });
}

async function iosDelete(page: Page, value: string) {
  await nativeInput(page).evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    const deletionAllowed = input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" }));
    if (deletionAllowed) {
      input.value = Array.from(input.value).slice(0, -1).join("");
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    }
    if (input.value !== nextValue) throw new Error(`iOS deletion produced ${input.value}, expected ${nextValue}`);
  }, value);
}

test("commits whole syllables once, restores drafts, and never submits the preview", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") writes.push(request.url()); });
  await page.goto("/dev/quiz?level=child");
  await expect(page.getByLabel("개발용 시험 안내")).toContainText("발행된 설교 퀴즈가 아닙니다");
  await expect(nativeInput(page)).toHaveCount(1);
  await expect(nativeInput(page)).not.toHaveAttribute("maxlength");
  await expect(page.getByRole("button", { name: "입력 확인", exact: true })).toBeDisabled();
  await snapshot(page, "갑세");
  await snapshot(page, "갑세");
  await expect(page.getByTestId("progress")).toHaveText("2 / 21칸 작성");
  await expect(page.locator('[data-cell="r0c0"]')).toContainText("갑");
  await expect(page.locator('[data-cell="r0c1"]')).toContainText("세");
  await page.reload();
  await expect(page.getByTestId("progress")).toHaveText("2 / 21칸 작성");
  await expect(nativeInput(page)).toHaveValue("");
  await page.getByRole("button", { name: "입력 확인", exact: true }).click();
  await expect(page.getByText(/작성 2칸, 빈칸 19칸입니다/)).toBeVisible();
  expect(writes).toEqual([]);
});

test("composition defers persistence, but direct cell and difficulty clicks cancel it before moving", async ({ page }) => {
  await page.goto("/dev/quiz?level=child");
  await nativeInput(page).focus();
  const before = await page.evaluate(() => localStorage.getItem("bibleQuiz:draft:preview-child-5:1"));
  await nativeInput(page).dispatchEvent("compositionstart");
  for (const value of ["ㄱ", "가", "갑", "값"]) await snapshot(page, value, true);
  await expect(page.getByTestId("progress")).toHaveText("0 / 21칸 작성");
  await expect(page.locator('[data-cell="r0c0"]')).toHaveAttribute("data-composing", "true");
  expect(await page.evaluate(() => localStorage.getItem("bibleQuiz:draft:preview-child-5:1"))).toBe(before);
  await page.locator('[data-cell="r0c1"]').click();
  await expect(nativeInput(page)).toHaveAttribute("aria-label", /1행 2열/);
  await expect(page.locator('[data-cell="r0c0"]')).not.toHaveAttribute("data-composing", "true");
  await expect(page.getByTestId("progress")).toHaveText("0 / 21칸 작성");
  await nativeInput(page).dispatchEvent("compositionstart");
  await snapshot(page, "ㄹ", true);
  await page.getByRole("tab", { name: "장년용" }).click();
  await expect(page).toHaveURL(/level=adult/);
  await expect(page.getByRole("tab", { name: "장년용" })).toBeFocused();
  await expect(page.getByTestId("progress")).toHaveText("0 / 40칸 작성");
  await page.getByRole("tab", { name: "어린이용" }).click();
  await expect(page.getByTestId("progress")).toHaveText("0 / 21칸 작성");
});

test("coarse-pointer devices retain a native touch target for keyboard input", async ({ page }) => {
  await page.goto("/dev/quiz?level=child");
  const nativeTarget = await nativeInput(page).evaluate((element) => ({
    coarse: matchMedia("(pointer: coarse)").matches,
    pointerEvents: getComputedStyle(element).pointerEvents,
    zIndex: getComputedStyle(element).zIndex,
  }));
  expect(nativeTarget.pointerEvents).toBe(nativeTarget.coarse ? "auto" : "none");
  expect(nativeTarget.zIndex).toBe(nativeTarget.coarse ? "2" : "auto");
  if (nativeTarget.coarse) {
    await nativeInput(page).tap();
    await expect(nativeInput(page)).toHaveAttribute("aria-label", /가로 1번/);
    await nativeInput(page).tap();
    await expect(nativeInput(page)).toHaveAttribute("aria-label", /세로 1번/);
    await page.getByRole("button", { name: /방향 전환/ }).tap();
    await expect(nativeInput(page)).toHaveAttribute("aria-label", /가로 1번/);
  }
  const cell = page.locator('[data-cell="r0c1"]');
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await cell.tap();
  else await cell.click();
  await expect(nativeInput(page)).toBeFocused();
});

test("coarse-pointer iOS-style replacements do not become application Backspace", async ({ page }) => {
  await page.goto("/dev/quiz?level=child");
  test.skip(!await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "touch replacement path");
  await nativeInput(page).focus();
  await iosInsert(page, "ㄱ", "ㄱ");
  await iosReplace(page, "가", "가");
  await iosReplace(page, "갑", "갑");
  await iosReplace(page, "값", "값");
  await iosInsert(page, "값ㅎ", "ㅎ");
  await iosReplace(page, "값호", "호");
  await iosReplace(page, "값홍", "홍");
  await iosInsert(page, "값홍ㄱ", "ㄱ");
  await iosReplace(page, "값홍기", "기");
  await iosReplace(page, "값홍길", "길");
  await iosInsert(page, "값홍길ㄷ", "ㄷ");
  await iosReplace(page, "값홍길도", "도");
  await iosReplace(page, "값홍길동", "동");
  await expect(page.locator('[data-cell="r0c0"]')).toContainText("값");
  await expect(page.locator('[data-cell="r0c1"]')).toContainText("홍");
  await expect(page.locator('[data-cell="r0c2"]')).toContainText("길");
  await expect(page.locator('[data-cell="r0c3"]')).toContainText("동");
  await expect(nativeInput(page)).toHaveAttribute("aria-label", /1행 4열/);
  await iosDelete(page, "값홍길");
  await expect(nativeInput(page)).toHaveAttribute("aria-label", /1행 3열/);
  await expect(page.locator('[data-cell="r0c3"]')).not.toContainText("동");
});

test("keyboard selection, deletion and Tab exit preserve native focus", async ({ page }) => {
  await page.goto("/dev/quiz?level=child");
  await nativeInput(page).focus();
  await nativeInput(page).press("Enter");
  await expect(nativeInput(page)).toHaveAttribute("aria-label", /세로 1번/);
  await nativeInput(page).press("Enter");
  await snapshot(page, "갑세");
  const coarsePointer = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  await nativeInput(page).press("Backspace");
  await expect(nativeInput(page)).toHaveAttribute("aria-label", /1행 2열/);
  await expect(page.getByTestId("progress")).toHaveText(coarsePointer ? "1 / 21칸 작성" : "2 / 21칸 작성");
  await nativeInput(page).press("Backspace");
  await expect(page.getByTestId("progress")).toHaveText("1 / 21칸 작성");
  await page.locator('[data-cell="r0c4"]').click();
  await nativeInput(page).press("Tab");
  await expect(page.getByRole("button", { name: "이전 칸", exact: true })).toBeFocused();
  await page.getByRole("tab", { name: "어린이용" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "장년용" })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-adult");
});

test("paste is bounded and rejects invalid input without erasing committed cells", async ({ page }) => {
  await page.goto("/dev/quiz?level=child");
  await page.locator('[data-cell="r0c3"]').click();
  const cancelled = await nativeInput(page).evaluate((element) => {
    // Firefox does not expose script-populated clipboard data in synthetic events.
    // Supply the payload explicitly; this does not claim to test the OS clipboard.
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => "갑세값" } });
    return !element.dispatchEvent(event);
  });
  expect(cancelled).toBe(true);
  await expect(page.getByTestId("progress")).toHaveText("2 / 21칸 작성");
  await expect(page.locator("#input-status")).toContainText("넘어선 1글자");
  await snapshot(page, "갑세!");
  await expect(page.getByTestId("progress")).toHaveText("2 / 21칸 작성");
  await expect(page.locator("#input-status")).toContainText("완성된 한글만");
});

test("invalid drafts require explicit discard and preserve other local settings", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("bibleQuiz:draft:preview-child-5:1", "broken");
      localStorage.setItem("bibleQuiz:theme", "dark");
      sessionStorage.setItem("seeded", "yes");
    }
  });
  await page.goto("/dev/quiz?level=child");
  await expect(page.getByText("저장된 입력을 안전하게 읽을 수 없습니다.", { exact: false })).toBeVisible();
  await snapshot(page, "값");
  expect(await page.evaluate(() => localStorage.getItem("bibleQuiz:draft:preview-child-5:1"))).toBe("broken");
  await page.getByRole("button", { name: "기존 임시 저장 지우기" }).click();
  await page.reload();
  await expect(page.getByTestId("progress")).toHaveText("1 / 21칸 작성");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("storage failures leave editing and theme controls usable", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked for test"); } }); });
  await page.goto("/dev/quiz?level=child");
  await expect(page.getByText("이 브라우저에서는 임시 저장을 사용할 수 없습니다.")).toBeVisible();
  await snapshot(page, "값");
  await expect(page.getByTestId("progress")).toHaveText("1 / 21칸 작성");
  await expect(page.getByText("저장하지 못했습니다. 입력은 현재 화면에 유지됩니다.")).toBeVisible();
  await page.getByLabel("화면 테마").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByText("테마는 이 화면에서만 유지됩니다.")).toBeVisible();
});

test("themes and large view persist, with bounded page width at 320px", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/dev/quiz?level=adult&size=10");
  await expect(page.getByLabel("화면 테마")).toHaveValue("system");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(40, 40, 40)");
  await page.getByLabel("화면 테마").selectOption("light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(253, 246, 227)");
  await page.getByRole("button", { name: "크게 보기" }).click();
  await expect(page.getByRole("button", { name: "기본 보기" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByLabel("화면 테마")).toHaveValue("light");
  await expect(page.getByRole("button", { name: "기본 보기" })).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const cell = await page.locator('[data-cell="r0c0"]').boundingBox();
  expect(cell!.width).toBeCloseTo(28.6, 1);
  await expectWholeGridFits(page);
  await nativeInput(page).focus();
  for (let index = 0; index < 8; index += 1) await nativeInput(page).press("Tab");
  await expect(nativeInput(page)).toHaveAttribute("aria-label", /1행 9열/);
  await expect(async () => {
    const active = await nativeInput(page).boundingBox();
    expect(active!.x).toBeGreaterThanOrEqual(0);
    expect(active!.x + active!.width).toBeLessThanOrEqual(320);
  }).toPass();
  await expectWholeGridFits(page);
  await page.screenshot({ path: test.info().outputPath("quiz-small-light.png"), fullPage: true });
  await page.getByLabel("화면 테마").selectOption("dark");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: test.info().outputPath("quiz-desktop-dark.png"), fullPage: true });
});

test("default layouts stay within the page and text tokens meet AA contrast", async ({ page }) => {
  for (const difficulty of ["child", "adult"]) {
    await page.goto(`/dev/quiz?level=${difficulty}`);
    for (const theme of ["light", "dark"]) {
      await page.getByLabel("화면 테마").selectOption(theme);
      for (const width of [360, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await expectWholeGridFits(page);
      }
      const contrasts = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        const luminance = (token: string) => {
          const hex = css.getPropertyValue(token).trim().slice(1);
          const rgb = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
            .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
          return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
        };
        return [["--text", "--page"], ["--text", "--surface"], ["--text-strong", "--selection"], ["--button-text", "--accent"]]
          .map(([foreground, background]) => {
            const a = luminance(foreground!); const b = luminance(background!);
            return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          });
      });
      for (const ratio of contrasts) expect(ratio).toBeGreaterThanOrEqual(4.5);
      await page.setViewportSize({ width: difficulty === "child" ? 360 : 1440, height: 1000 });
      await page.screenshot({ path: test.info().outputPath(`default-${difficulty}-${theme}.png`) });
    }
  }
});

test("all grid sizes fit in both view modes, with usable controls and separate cell labels", async ({ page }) => {
  test.setTimeout(60000);
  for (const size of [5, 8, 10]) {
    await page.goto(`/dev/quiz?level=adult&size=${size}`);
    await snapshot(page, "값");
    if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await nativeInput(page).tap();
    else await page.locator('[data-cell="r0c0"]').click();
    for (const theme of ["light", "dark"]) {
      await page.getByLabel("화면 테마").selectOption(theme);
      for (const large of [false, true]) {
        const toggle = page.getByRole("button", { name: /^(크게 보기|기본 보기)$/ });
        if (await toggle.getAttribute("aria-pressed") !== String(large)) await toggle.click();
        for (const width of [320, 360, 375, 568, 768, 1024, 1440, 1920]) {
          await page.setViewportSize({ width, height: width === 568 ? 320 : 900 });
          await expectWholeGridFits(page);
        }
        await page.setViewportSize({ width: 320, height: 720 });
        const labels = await page.locator('[data-cell="r0c0"]').evaluate((cell) => {
          const box = cell.getBoundingClientRect();
          const spans = [...cell.querySelectorAll("span")].map((span) => span.getBoundingClientRect());
          return {
            count: spans.length,
            contained: spans.every((span) => span.left >= box.left && span.right <= box.right && span.top >= box.top && span.bottom <= box.bottom),
            separate: spans.every((a, index) => spans.slice(index + 1).every((b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)),
          };
        });
        expect(labels, `${size}×${size}, ${theme}, large=${large}`).toEqual({ count: 3, contained: true, separate: true });
        for (const name of ["이전 칸", "다음 칸", "방향 전환"]) {
          const box = await page.getByRole("button", { name: new RegExp(name) }).boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(48);
          expect(box!.width).toBeGreaterThanOrEqual(48);
        }
        if (size === 10 && !large) {
          await page.getByTestId("grid-boundary").screenshot({ path: test.info().outputPath(`fit-10x10-${theme}.png`) });
        }
      }
    }
  }
  // A cell at the far side remains directly clickable, without panning first.
  await page.locator('[data-cell="r8c8"]').click();
  await expect(nativeInput(page)).toHaveAttribute("aria-label", /9행 9열/);
  await snapshot(page, "감");
  await expect(page.locator('[data-cell="r8c8"]')).toContainText("감");
  await expectWholeGridFits(page);
});
