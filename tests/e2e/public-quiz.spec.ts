import { expect, test, type Page } from "@playwright/test";
import { participationBoardDataSchema } from "../../shared/api/participation-board";
import {
  submissionResultSchema,
  type OwnSubmission,
} from "../../shared/api/submission";
import { publicResponse } from "../fixtures/public-response";

async function mockPublic(
  page: Page,
  revision = () => 1,
  ownSubmission: (difficulty: "adult" | "child") => OwnSubmission | null = () => null,
) {
  await page.route("**/api/quizzes/**", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const url = new URL(route.request().url());
    const level = url.pathname.includes("/adult/") || url.searchParams.get("difficulty") === "adult" ? "adult" : "child";
    if (url.pathname.endsWith("/me")) {
      return route.fulfill({ json: { data: { submission: ownSubmission(level) } } });
    }
    if (url.pathname.endsWith("/solution")) {
      const result = successfulSubmission(level);
      return route.fulfill({
        json: {
          data: {
            quizVariantId: `public-test-${level}`,
            quizRevision: revision(),
            solution: result.solution,
          },
        },
      });
    }
    return route.fulfill({ json: publicResponse(level, revision()) });
  });
}

function successfulSubmission(difficulty: "adult" | "child" = "child") {
  const quiz = publicResponse(difficulty).data.quiz!;
  const ids = quiz.variant.grid.cells.map((cell) => cell.id);
  return submissionResultSchema.parse({
    submissionId: "e2e-submission",
    submittedAt: "2026-09-01T05:30:00.000Z",
    correctCells: 1,
    totalCells: ids.length,
    correctWords: 0,
    totalWords: quiz.variant.grid.entries.length,
    scoreBasisPoints: Math.round(10_000 / ids.length),
    correctnessMask: `1${"0".repeat(ids.length - 1)}`,
    canRevealAnswer: true,
    solution: {
      cells: Object.fromEntries(ids.map((id) => [id, "가"])),
      entries: Object.fromEntries(quiz.variant.grid.entries.map((entry) => [entry.id, "가".repeat(entry.length)])),
    },
  });
}

function successfulPractice(cells: Readonly<Record<string, string>>, difficulty: "adult" | "child" = "child") {
  const quiz = publicResponse(difficulty).data.quiz!;
  const ids = quiz.variant.grid.cells.map((cell) => cell.id);
  const solutionCells = Object.fromEntries(ids.map((id) => [id, "가"]));
  const correctCells = ids.filter((id) => cells[id] === "가").length;
  const correctWords = quiz.variant.grid.entries.filter((entry) => Array.from({ length: entry.length }, (_, offset) => {
    const row = entry.start.row + (entry.direction === "down" ? offset : 0);
    const column = entry.start.column + (entry.direction === "across" ? offset : 0);
    return `r${row}c${column}`;
  }).every((id) => cells[id] === "가")).length;
  return {
    quizVariantId: quiz.variant.id,
    quizRevision: quiz.variant.revision,
    correctCells,
    totalCells: ids.length,
    correctWords,
    totalWords: quiz.variant.grid.entries.length,
    scoreBasisPoints: Math.round((correctCells / ids.length) * 10_000),
    correctnessMask: ids.map((id) => cells[id] === "가" ? "1" : "0").join(""),
    solution: {
      cells: solutionCells,
      entries: Object.fromEntries(quiz.variant.grid.entries.map((entry) => [entry.id, "가".repeat(entry.length)])),
    },
  };
}

function participationBoardFixture() {
  const quiz = publicResponse("child").data.quiz!;
  const ids = quiz.variant.grid.cells.map((cell) => cell.id);
  return participationBoardDataSchema.parse({
    winnerCount: 1,
    participants: [
      {
        submissionOrder: 1,
        displayName: "은혜",
        submittedAt: "2026-09-01T05:30:00.000Z",
        comment: "감사합니다",
        answers: { [ids[0]!]: "가", [ids[1]!]: "나" },
        correctCellIds: [ids[0]!],
        isFullyCorrect: false,
        isMine: true,
      },
      {
        submissionOrder: 2,
        displayName: "소망",
        submittedAt: "2026-09-01T05:31:00.000Z",
        comment: null,
        answers: Object.fromEntries(ids.map((id) => [id, "가"])),
        correctCellIds: ids,
        isFullyCorrect: true,
        isMine: false,
      },
      {
        submissionOrder: 3,
        displayName: "기쁨",
        submittedAt: "2026-09-01T05:32:00.000Z",
        comment: "함께해서 기쁩니다",
        answers: Object.fromEntries(ids.map((id) => [id, "가"])),
        correctCellIds: ids,
        isFullyCorrect: true,
        isMine: false,
      },
    ],
    winners: [{ rank: 1, submissionOrder: 2 }],
  });
}

async function inputValue(page: Page, value: string) {
  await page.getByRole("textbox", { name: /^낱말 입력:/ }).evaluate((element, value) => {
    const input = element as HTMLInputElement; input.value = value;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  }, value);
}
test("public quiz loads, keeps difficulty-specific drafts and survives permalink refresh", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") writes.push(request.url()); });
  await mockPublic(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "함께 돌아보는 한 주 (테스트)" })).toBeVisible();
  await expect(page.getByText(/설교자의 원문이 아닙니다/)).toBeVisible();
  await expect(page.locator('time[datetime="2099-09-07T00:00:00.000Z"]')).toContainText("한국 시간");
  await expect(page.getByTestId("remaining-time")).toContainText("남은 기간:");
  await inputValue(page, "갑세");
  await page.getByRole("tab", { name: "어린이용" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "장년용" })).toBeFocused();
  await expect(page).toHaveURL(/level=adult/);
  await expect(page.getByTestId("progress")).toHaveText("0 / 40칸 작성");
  await inputValue(page, "값");
  await page.getByRole("tab", { name: "어린이용" }).click();
  await expect(page.getByTestId("progress")).toHaveText("2 / 21칸 작성");
  await page.getByRole("link", { name: "이 퀴즈의 고유 주소" }).click();
  await expect(page).toHaveURL(/\/quiz\/2026-08-31-test01\?level=child/);
  await page.reload();
  await expect(page.getByTestId("progress")).toHaveText("2 / 21칸 작성");
  await expect(page.locator('[data-cell="r0c0"]')).toContainText("갑");
  expect(writes).toEqual([]);
});

test("loading, empty, error/retry and private-field rejection do not invent a quiz", async ({ page }) => {
  let respond: () => void = () => {};
  const gate = new Promise<void>((resolve) => { respond = resolve; });
  await page.route("**/api/quizzes/**", async (route) => { await gate; await route.fulfill({ json: { data: { quiz: null, otherOpenQuizzes: [] } } }); });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status", { name: "퀴즈를 불러오고 있습니다." })).toBeVisible();
  respond();
  await expect(page.getByRole("heading", { name: "말씀 퀴즈를 준비하고 있습니다." })).toBeVisible();
  await expect(page.getByRole("grid")).toHaveCount(0);
  await page.unroute("**/api/quizzes/**");
  await page.route("**/api/quizzes/**", (route) => route.fulfill({ status: 503, json: { error: { message: "PRIVATE_CANARY", requestId: "123e4567-e89b-42d3-a456-426614174000" } } }));
  await page.reload();
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PRIVATE_CANARY");
  await page.unroute("**/api/quizzes/**");
  await mockPublic(page);
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.unroute("**/api/quizzes/**");
  await page.route("**/api/quizzes/**", (route) => route.fulfill({ json: { data: { ...publicResponse().data, solution: "PRIVATE_CANARY" } } }));
  await page.reload();
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(page.getByRole("grid")).toHaveCount(0);
});

test("updated revisions never silently apply or overwrite old drafts", async ({ page }) => {
  let revision = 1;
  await mockPublic(page, () => revision);
  await page.goto("/quiz/2026-08-31-test01?level=child");
  await inputValue(page, "값");
  const old = await page.evaluate(() => localStorage.getItem("bibleQuiz:draft:public-test-child:1"));
  revision = 2;
  await page.reload();
  await expect(page.getByText(/다른 문제 버전의 임시 저장/)).toBeVisible();
  await expect(page.getByTestId("progress")).toHaveText("0 / 21칸 작성");
  await inputValue(page, "세");
  expect(await page.evaluate(() => localStorage.getItem("bibleQuiz:draft:public-test-child:1"))).toBe(old);
  expect(await page.evaluate(() => localStorage.getItem("bibleQuiz:draft:public-test-child:2"))).toBeNull();
});

test("public layout keeps the grid visible in both themes, with plain-text summary", async ({ page }) => {
  await page.route("**/api/quizzes/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/me")) {
      return route.fulfill({ json: { data: { submission: null } } });
    }
    const body = publicResponse("adult");
    body.data.quiz!.sermon.summary!.text = '<img src=x onerror="alert(1)"> 테스트 문구';
    body.data.quiz!.availability = "paused"; body.data.quiz!.submissionState = "paused";
    body.data.quiz!.acceptingSubmissions = false; body.data.quiz!.pauseReason = "문제를 확인하고 있습니다.";
    body.data.quiz!.submissionCount = 12;
    return route.fulfill({ json: body });
  });
  await page.goto("/?level=adult");
  await expect(page.getByRole("tabpanel").getByText("문제를 확인하고 있습니다.").first()).toBeVisible();
  await expect(page.getByText("현재 장년용에 12명이 참여했습니다.")).toBeVisible();
  await expect(page.locator(".summary-copy img")).toHaveCount(0);
  for (const theme of ["light", "dark"]) {
    await page.getByLabel("화면 테마").selectOption(theme);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.getByTestId("grid-boundary").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
      })).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath(`public-${theme}.png`), fullPage: true });
  }
});

test("deadline keeps exact Korean time beside a readable remaining period", async ({ page }) => {
  const closesAt = new Date(Date.now() + 26 * 60 * 60_000 + 5 * 60_000).toISOString();
  await page.route("**/api/quizzes/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/me")) {
      return route.fulfill({ json: { data: { submission: null } } });
    }
    const body = publicResponse();
    body.data.quiz!.closesAt = closesAt;
    body.data.quiz!.closesAtLabel = "검증용 정확한 마감 시각 (한국 시간)";
    return route.fulfill({ json: body });
  });
  await page.goto("/");
  await expect(page.locator(`time[datetime="${closesAt}"]`)).toHaveText("검증용 정확한 마감 시각 (한국 시간)");
  await expect(page.getByTestId("remaining-time")).toHaveText("남은 기간: 1일 2시간");
});

test("skip link, landmarks and cell names support keyboard-only narrow-screen use", async ({ page }) => {
  await mockPublic(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "함께 돌아보는 한 주 (테스트)" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 이동" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
  await expect(page.getByRole("gridcell", { name: /1행 1열, 가로 1번, 세로 1번, 1번 시작, 빈칸/u })).toBeVisible();
  await expect(page.getByRole("gridcell", { name: "2행 2열, 막힌 칸" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /낱말 입력: 1행 1열, 가로 1번, 빈칸/u })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const name of ["이전 칸", "방향 전환", "다음 칸"]) {
    const box = await page.getByRole("button", { name: new RegExp(name, "u") }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
  }
});

test("submission prepares a session, safely retries and renders the immediate result", async ({ page }) => {
  await page.addInitScript(() => {
    window.__BIBLEQUIZ_TEST_TURNSTILE__ = () => ({ outcome: "error" });
  });
  let storedOwnSubmission: OwnSubmission | null = null;
  await mockPublic(page, () => 1, () => storedOwnSubmission);
  const sessionBodies: unknown[] = [];
  const submissionBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/session", async (route) => {
    sessionBodies.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: { expiresAt: "2027-03-01T00:00:00.000Z" } } });
  });
  await page.route("**/api/quizzes/*/*/submissions", async (route) => {
    submissionBodies.push(route.request().postDataJSON());
    if (submissionBodies.length === 1) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "VERIFICATION_UNAVAILABLE", message: "사람 확인 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.", requestId: "123e4567-e89b-42d3-a456-426614174000" } },
      });
      return;
    }
    const result = successfulSubmission();
    storedOwnSubmission = {
      status: "submitted",
      quizVariantId: "public-test-child",
      quizRevision: 1,
      answers: { r0c0: "가" },
      result,
    };
    await route.fulfill({ json: { data: result } });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "정답보기" })).toHaveAttribute("aria-disabled", "true");
  await inputValue(page, "가");
  await page.getByRole("button", { name: "입력 확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "사람 확인 다시 시도" })).toBeVisible();
  await page.evaluate(() => {
    let count = 0;
    window.__BIBLEQUIZ_TEST_TURNSTILE__ = () => ({
      outcome: "ready",
      token: `e2e-turnstile-${++count}`,
    });
  });
  await page.getByRole("button", { name: "사람 확인 다시 시도" }).click();
  await expect(page.getByText("사람 확인이 완료되었습니다.")).toBeVisible();
  await page.getByLabel("이름", { exact: true }).fill("은혜");
  await page.getByLabel("한줄평 (선택)").fill("감사합니다");
  await page.getByRole("checkbox").check();
  const submit = page.getByRole("button", { name: "답안 제출" });
  await expect(submit).toBeEnabled();
  await page.getByLabel("화면 테마").selectOption("light");
  const submitBox = await submit.boundingBox();
  expect(submitBox!.height).toBeGreaterThanOrEqual(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("submission-form-light.png"), fullPage: true });
  await submit.click();
  await expect(page.getByText("사람 확인 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.")).toBeVisible();
  await expect(page.getByText("사람 확인이 완료되었습니다.")).toBeVisible();
  await page.getByRole("button", { name: "답안 제출" }).click();

  await expect(page.getByRole("heading", { name: "제출이 완료되었습니다" })).toBeVisible();
  await expect(page.getByText("4.76%", { exact: true })).toBeVisible();
  await expect(page.getByTestId("result-answer-grid").locator('[data-comparison-cell="r0c0"]')).toHaveAttribute("aria-label", /내 답 가, 정답 가, 맞음/u);
  await expect(page.getByTestId("result-answer-grid").locator('[data-comparison-cell="r0c1"]')).toHaveAttribute("aria-label", /내 답 빈칸, 정답 가, 미작성/u);
  await expect(page.getByTestId("result-answer-grid").locator('[data-comparison-cell="r0c0"]')).toHaveText(/가/u);
  await expect(page.getByTestId("result-answer-grid").locator('[data-comparison-cell="r0c1"]')).toHaveText("");
  await expect(page.getByTestId("result-solution-grid").locator('[data-comparison-cell="r0c1"]')).toHaveText(/가/u);
  await expect(page.getByText(/다시 볼 칸/u)).toHaveCount(0);
  const answerGridBox = await page.getByTestId("result-answer-grid").boundingBox();
  const solutionGridBox = await page.getByTestId("result-solution-grid").boundingBox();
  if (page.viewportSize()!.width >= 768) {
    expect(solutionGridBox!.x).toBeGreaterThan(answerGridBox!.x + answerGridBox!.width);
  } else {
    expect(solutionGridBox!.y).toBeGreaterThan(answerGridBox!.y + answerGridBox!.height);
  }
  await expect(page.getByRole("button", { name: "정답 닫기" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("화면 테마").selectOption("dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("submission-result-dark.png"), fullPage: true });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "제출한 답안이 확인되었습니다" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "제출이 완료되었습니다" })).toHaveCount(0);
  await page.getByRole("button", { name: "정답보기" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "제출이 완료되었습니다" })).toBeVisible();
  await expect(page.getByTestId("result-answer-grid")).toBeVisible();
  await expect(page.getByTestId("result-solution-grid")).toBeVisible();
  await expect(page.getByText("같은 브라우저로 다시 방문하면 저장된 결과를 불러옵니다.")).toBeVisible();
  await expect(page.getByTestId("result-answer-grid").locator('[data-comparison-cell="r0c0"]')).toHaveAttribute("aria-label", /내 답 가, 정답 가, 맞음/u);
  storedOwnSubmission = {
    status: "deleted",
    quizVariantId: "public-test-child",
    quizRevision: 1,
    deletedAt: "2026-09-02T00:00:00.000Z",
  };
  await page.evaluate(() => localStorage.setItem("bibleQuiz:draft:public-test-child:1", "PRIVATE_LOCAL_DRAFT"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "제출이 삭제되었습니다" })).toBeVisible();
  await expect(page.getByText(/이 퀴즈의 어린이용에는 다시 제출할 수 없습니다/u)).toBeVisible();
  await expect(page.getByTestId("progress")).toHaveText("0 / 21칸 작성");
  expect(await page.evaluate(() => localStorage.getItem("bibleQuiz:draft:public-test-child:1"))).toBeNull();
  await expect(page.getByRole("heading", { name: "제출이 완료되었습니다" })).toHaveCount(0);
  expect(sessionBodies).toEqual([{}]);
  expect(submissionBodies).toHaveLength(2);
  expect(submissionBodies[0]?.idempotencyKey).toBe(submissionBodies[1]?.idempotencyKey);
  expect(submissionBodies[0]?.turnstileToken).toMatch(/^e2e-turnstile-[0-9]+$/u);
  expect(submissionBodies[1]?.turnstileToken).toMatch(/^e2e-turnstile-[0-9]+$/u);
  expect(submissionBodies[0]?.turnstileToken).not.toBe(submissionBodies[1]?.turnstileToken);
  for (const body of submissionBodies) {
    expect(body).toMatchObject({ revision: 1, name: "은혜", comment: "감사합니다", consent: true, cells: { r0c0: "가" } });
    for (const key of ["score", "rank", "correctness", "solution"]) expect(body).not.toHaveProperty(key);
  }
  await expect(page.locator("body")).not.toContainText("e2e-turnstile");
});

test("own submission deletion confirms, safely retries and removes private result views", async ({ page }) => {
  const result = successfulSubmission();
  const restored: OwnSubmission = {
    status: "submitted",
    quizVariantId: "public-test-child",
    quizRevision: 1,
    answers: { r0c0: "가" },
    result,
  };
  const board = participationBoardFixture();
  const deletionBodies: unknown[] = [];
  let releaseDeletion: () => void = () => {};
  const deletionGate = new Promise<void>((resolve) => { releaseDeletion = resolve; });

  await page.route("**/api/quizzes/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/me/submission")) {
      expect(request.method()).toBe("DELETE");
      deletionBodies.push(request.postDataJSON());
      if (deletionBodies.length === 1) {
        await deletionGate;
        await route.fulfill({
          status: 503,
          json: { error: { code: "DELETION_UNAVAILABLE", message: "삭제하지 못했습니다. 다시 시도해 주세요.", requestId: "123e4567-e89b-42d3-a456-426614174000" } },
        });
        return;
      }
      await route.fulfill({
        json: {
          data: {
            submission: {
              status: "deleted",
              quizVariantId: "public-test-child",
              quizRevision: 1,
              deletedAt: "2026-09-02T00:00:00.000Z",
            },
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith("/board")) {
      await route.fulfill({ json: { data: board } });
      return;
    }
    if (url.pathname.endsWith("/solution")) {
      await route.fulfill({
        json: {
          data: {
            quizVariantId: restored.quizVariantId,
            quizRevision: restored.quizRevision,
            solution: result.solution,
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith("/me")) {
      await route.fulfill({ json: { data: { submission: restored } } });
      return;
    }
    await route.fulfill({ json: publicResponse() });
  });

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("bibleQuiz:draft:public-test-child:1", "PRIVATE_LOCAL_DRAFT"));
  await page.getByRole("button", { name: "정답보기" }).click();
  await page.getByRole("button", { name: "참여 현황 보기" }).click();
  await expect(page.getByRole("article", { name: "은혜" })).toBeVisible();

  const openDeletion = page.getByRole("button", { name: "내 제출 삭제" });
  await openDeletion.focus();
  await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog", { name: "내 제출을 삭제할까요?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("이 작업은 되돌릴 수 없으며 이 퀴즈의 어린이용에 다시 제출할 수 없습니다.");
  await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("submission-deletion-confirm-light-320.png"), fullPage: true });

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(openDeletion).toBeFocused();
  await expect(page.getByRole("heading", { name: "제출이 완료되었습니다" })).toBeVisible();
  await expect(page.getByRole("article", { name: "은혜" })).toBeVisible();

  await openDeletion.click();
  dialog = page.getByRole("dialog", { name: "내 제출을 삭제할까요?" });
  const confirmDeletion = dialog.getByRole("button", { name: "삭제하기" });
  await confirmDeletion.click();
  await expect(dialog.getByRole("button", { name: "삭제하고 있습니다" })).toBeDisabled();
  await dialog.getByRole("button", { name: "삭제하고 있습니다" }).click({ force: true });
  expect(deletionBodies).toEqual([{}]);
  releaseDeletion();

  await expect(dialog.getByRole("alert")).toContainText("삭제하지 못했습니다. 다시 시도해 주세요.");
  await expect(page.getByRole("heading", { name: "제출이 완료되었습니다" })).toBeVisible();
  await expect(page.getByRole("article", { name: "은혜" })).toBeVisible();
  await page.getByLabel("화면 테마").selectOption("dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("submission-deletion-error-dark-320.png"), fullPage: true });

  await dialog.getByRole("button", { name: "삭제 다시 시도" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "제출이 삭제되었습니다" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "제출이 완료되었습니다" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "내 제출 삭제" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "참여 현황" })).toHaveCount(0);
  await expect(page.getByTestId("progress")).toHaveText("0 / 21칸 작성");
  await expect(page.locator('[data-cell="r0c0"]')).toHaveAttribute("aria-label", /빈칸$/u);
  await expect(page.locator('[data-cell="r0c0"]')).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("bibleQuiz:draft:public-test-child:1"))).toBeNull();
  expect(deletionBodies).toEqual([{}, {}]);
});

test("participation board stays on demand, rejects private extras and renders accessible answers", async ({ page }) => {
  const board = participationBoardFixture();
  const result = successfulSubmission();
  const restored: OwnSubmission = {
    status: "submitted",
    quizVariantId: "public-test-child",
    quizRevision: 1,
    answers: { r0c0: "가" },
    result,
  };
  let releaseBoard: () => void = () => {};
  const boardGate = new Promise<void>((resolve) => { releaseBoard = resolve; });
  let boardRequests = 0;
  await page.route("**/api/quizzes/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/board")) {
      boardRequests += 1;
      expect(route.request().method()).toBe("GET");
      if (boardRequests === 1) {
        await boardGate;
        await route.fulfill({
          json: {
            data: {
              ...board,
              participants: [{ ...board.participants[0], sessionHash: "PRIVATE_CANARY" }, board.participants[1]],
            },
          },
        });
        return;
      }
      await route.fulfill({ json: { data: board } });
      return;
    }
    if (url.pathname.endsWith("/me")) {
      await route.fulfill({ json: { data: { submission: restored } } });
      return;
    }
    await route.fulfill({ json: publicResponse() });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "제출한 답안이 확인되었습니다" })).toBeVisible();
  await expect(page.getByRole("button", { name: "정답보기" })).toBeVisible();
  const openBoard = page.getByRole("button", { name: "참여 현황 보기" });
  await expect(openBoard).toBeVisible();
  expect(boardRequests).toBe(0);

  await openBoard.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status", { name: "참여 현황을 불러오고 있습니다." })).toBeVisible();
  expect(boardRequests).toBe(1);
  releaseBoard();
  await expect(page.getByRole("button", { name: "참여 현황 다시 시도" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PRIVATE_CANARY");

  await page.getByRole("button", { name: "참여 현황 다시 시도" }).click();
  await expect(page.getByRole("article", { name: "은혜" })).toBeVisible();
  await expect(page.getByRole("article", { name: "소망" })).toBeVisible();
  await expect(page.getByRole("article", { name: "기쁨" })).toBeVisible();
  await expect(page.getByRole("article", { name: "은혜" }).getByText(/감사합니다/u)).toBeVisible();
  await expect(page.getByText("내 답안", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "소망" }).getByText("모든 칸 정답", { exact: true })).toBeVisible();
  await expect(page.locator('[data-board-cell="r0c0"]').first()).toHaveAttribute("data-answer-state", "correct");
  await expect(page.locator('[data-board-cell="r0c1"]').first()).toHaveAttribute("data-answer-state", "incorrect");
  await expect(page.getByRole("article", { name: "은혜" }).locator('[data-board-cell][data-answer-state="blank"]').first()).toBeVisible();
  expect(boardRequests).toBe(2);

  const allParticipants = page.getByRole("button", { name: "전체 참여" });
  const topParticipants = page.getByRole("button", { name: "Top N", exact: true });
  await expect(allParticipants).toHaveAttribute("aria-pressed", "true");
  await topParticipants.focus();
  await page.keyboard.press("Enter");
  await expect(topParticipants).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article", { name: "은혜" })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "소망" })).toBeVisible();
  await expect(page.getByRole("article", { name: "기쁨" })).toBeVisible();
  await expect(page.getByRole("article", { name: "소망" }).getByText("1위", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "기쁨" }).getByText(/[0-9]+위/u)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("감사합니다");
  await expect(page.locator("body")).not.toContainText("함께해서 기쁩니다");
  expect(boardRequests).toBe(2);
  await page.screenshot({ path: test.info().outputPath("participation-top-n.png"), fullPage: true });

  await allParticipants.click();
  await expect(allParticipants).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article", { name: "은혜" }).getByText(/감사합니다/u)).toBeVisible();
  expect(boardRequests).toBe(2);

  for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
    await page.getByLabel("화면 테마").selectOption(theme);
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`participation-board-${theme}.png`), fullPage: true });
  }
});

test("archived participation board is public before practice", async ({ page }) => {
  const board = participationBoardDataSchema.parse({
    winnerCount: 3,
    participants: [],
    winners: [],
  });
  let boardRequests = 0;
  let solutionRequests = 0;
  let archivedOwnSubmission: OwnSubmission | null = null;
  let releaseSolution: () => void = () => {};
  const solutionGate = new Promise<void>((resolve) => { releaseSolution = resolve; });
  await page.route("**/api/quizzes/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/board")) {
      boardRequests += 1;
      await route.fulfill({ json: { data: board } });
      return;
    }
    if (url.pathname.endsWith("/me")) {
      await route.fulfill({ json: { data: { submission: archivedOwnSubmission } } });
      return;
    }
    if (url.pathname.endsWith("/solution")) {
      solutionRequests += 1;
      const result = successfulSubmission();
      if (solutionRequests === 1) {
        await solutionGate;
        await route.fulfill({
          json: {
            data: {
              quizVariantId: "public-test-child",
              quizRevision: 1,
              solution: result.solution,
              canonicalCellOrder: ["PRIVATE_CANARY"],
            },
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          data: {
            quizVariantId: "public-test-child",
            quizRevision: 1,
            solution: result.solution,
          },
        },
      });
      return;
    }
    const response = publicResponse();
    Object.assign(response.data.quiz!, {
      status: "archived",
      submissionState: "paused",
      mode: "practice",
      acceptingSubmissions: false,
      availability: "archived",
      solutionAccess: "public",
    });
    await route.fulfill({ json: response });
  });

  await page.goto("/quiz/2026-08-31-test01?level=child");
  await expect(page.getByRole("heading", { name: "지난 퀴즈 풀어보기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "채점하기" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "제출이 완료되었습니다" })).toHaveCount(0);
  const revealSolution = page.getByRole("button", { name: "정답보기" });
  await expect(revealSolution).not.toHaveAttribute("aria-disabled", "true");
  await revealSolution.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status", { name: "정답을 불러오고 있습니다." })).toBeVisible();
  releaseSolution();
  await expect(page.getByRole("button", { name: "정답 다시 시도" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PRIVATE_CANARY");
  await page.getByRole("button", { name: "정답 다시 시도" }).click();
  await expect(page.getByRole("heading", { name: "지난 퀴즈 정답" })).toBeVisible();
  await expect(page.getByText("작성한 답안이 없습니다. 빈칸과 공식 정답을 비교합니다.")).toBeVisible();
  await expect(page.getByTestId("result-answer-grid").locator('[data-comparison-cell="r0c0"]')).toHaveAttribute("aria-label", /내 답 빈칸, 정답 가, 미작성/u);
  await page.getByLabel("화면 테마").selectOption("dark");
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("archived-solution-dark-320.png"), fullPage: true });
  await page.getByRole("button", { name: "정답 닫기" }).click();
  await expect(page.getByRole("heading", { name: "지난 퀴즈 정답" })).toHaveCount(0);
  expect(solutionRequests).toBe(2);
  expect(boardRequests).toBe(0);
  await page.getByRole("button", { name: "참여 현황 보기" }).click();
  await expect(page.getByText("아직 공개할 참여 답안이 없습니다.")).toBeVisible();
  expect(boardRequests).toBe(1);
  archivedOwnSubmission = {
    status: "deleted",
    quizVariantId: "public-test-child",
    quizRevision: 1,
    deletedAt: "2026-09-02T00:00:00.000Z",
  };
  await page.reload();
  await expect(page.getByRole("heading", { name: "제출이 삭제되었습니다" })).toBeVisible();
  await expect(page.getByRole("button", { name: "정답보기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "참여 현황 보기" })).toBeVisible();
});

test("archived practice check is strict, retryable, non-persistent and editable after solution reveal", async ({ page }) => {
  let practiceRequests = 0;
  let releasePractice: () => void = () => {};
  const practiceGate = new Promise<void>((resolve) => { releasePractice = resolve; });
  const mutationPaths: string[] = [];
  await page.route("**/api/quizzes/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") mutationPaths.push(url.pathname);
    if (url.pathname.endsWith("/me")) {
      await route.fulfill({ json: { data: { submission: null } } });
      return;
    }
    if (url.pathname.endsWith("/practice/check")) {
      practiceRequests += 1;
      const body = request.postDataJSON() as { cells: Record<string, string>; revision: number };
      expect(Object.keys(body).sort()).toEqual(["cells", "revision"]);
      expect(body.revision).toBe(1);
      for (const key of ["name", "comment", "consent", "idempotencyKey", "turnstileToken", "score", "rank"]) {
        expect(body).not.toHaveProperty(key);
      }
      const data = successfulPractice(body.cells);
      if (practiceRequests === 1) {
        await practiceGate;
        await route.fulfill({ json: { data: { ...data, submissionId: "PRIVATE_CANARY" } } });
      } else {
        await route.fulfill({ json: { data } });
      }
      return;
    }
    const response = publicResponse();
    Object.assign(response.data.quiz!, {
      status: "archived",
      submissionState: "paused",
      mode: "practice",
      acceptingSubmissions: false,
      availability: "archived",
      solutionAccess: "public",
    });
    await route.fulfill({ json: response });
  });

  await page.goto("/quiz/2026-08-31-test01?level=child");
  await inputValue(page, "가나");
  const check = page.getByRole("button", { name: "채점하기" });
  await expect(check).toBeEnabled();
  await check.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status", { name: "답안을 채점하고 있습니다." })).toBeVisible();
  releasePractice();
  await expect(page.getByRole("button", { name: "채점 다시 시도" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PRIVATE_CANARY");
  await expect(page.getByTestId("progress")).toHaveText("2 / 21칸 작성");

  await page.getByRole("button", { name: "채점 다시 시도" }).click();
  await expect(page.getByRole("heading", { name: "채점 결과" })).toBeVisible();
  await expect(page.getByText("이 결과는 제출 기록, 참여 수나 순위로 저장되지 않습니다.")).toBeVisible();
  await expect(page.getByTestId("result-answer-grid").locator('[data-comparison-cell="r0c0"]')).toHaveAttribute("aria-label", /내 답 가, 정답 가, 맞음/u);
  await expect(page.getByTestId("result-answer-grid").locator('[data-comparison-cell="r0c1"]')).toHaveAttribute("aria-label", /내 답 나, 정답 가, 틀림/u);
  await page.getByLabel("화면 테마").selectOption("dark");
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("archived-practice-dark-320.png"), fullPage: true });

  await page.getByRole("button", { name: "정답 닫기" }).click();
  await expect(page.getByRole("heading", { name: "채점 결과" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^낱말 입력:/ })).toBeEnabled();
  await inputValue(page, "가");
  await page.getByRole("button", { name: "채점하기" }).click();
  await expect(page.getByRole("heading", { name: "채점 결과" })).toBeVisible();
  expect(practiceRequests).toBe(3);
  expect(mutationPaths).toEqual([
    "/api/quizzes/2026-08-31-test01/child/practice/check",
    "/api/quizzes/2026-08-31-test01/child/practice/check",
    "/api/quizzes/2026-08-31-test01/child/practice/check",
  ]);
});
