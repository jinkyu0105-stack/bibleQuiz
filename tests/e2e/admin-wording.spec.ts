import { expect, test } from "@playwright/test";
import type { WordingView } from "../../shared/api/admin-wording";

test("reviews wording, routes semantic changes, retries lost responses, and retains history", async ({ page }, testInfo) => {
  const quiz = { quizSetId: "synthetic", slug: "2026-09-20-abc123", status: "published", revision: 0,
    metadata: { title: "합성 설교", sermonDate: "2026-09-20" }, publishedAt: "2026-09-21T00:00:00.000Z", closesAt: "2026-09-28T00:00:00.000Z" };
  const view: WordingView = { quizSetId: "synthetic", revision: 0, contentRevision: 0, blocked: false,
    targets: [{ target: "summary", kind: "summary", difficulty: null, number: null, direction: null, text: "합성 요약 입니다." },
      { target: "child-entry", kind: "clue", difficulty: "child", number: 1, direction: "across", text: "합성 단서 입니다." }], history: [] };
  await page.route("**/api/admin/published-quizzes", route => route.fulfill({ json: { data: { items: [quiz] } } }));
  await page.route("**/api/admin/quiz-sets/synthetic/display-text", route => route.fulfill({ json: { data: { quiz, history: [] } } }));
  let readFails = true;
  const commands: Record<string, unknown>[] = [];
  await page.route("**/api/admin/quiz-sets/synthetic/display-text/wording", route => {
    if (route.request().method() === "GET") return readFails ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { data: view } });
    const body = route.request().postDataJSON(); commands.push(body);
    if (commands.length === 1) {
      view.targets[0]!.text = body.after; view.revision = 1;
      view.history.push({ revision: 1, target: body.target, before: body.before, after: body.after, reason: body.reason, createdAt: "2026-09-23T00:00:00.000Z" });
      return route.fulfill({ status: 503, json: {} });
    }
    return route.fulfill({ json: { data: { outcome: "replayed", quizSetId: "synthetic", revision: 1 } } });
  });
  await page.goto("/admin/tools");
  const parent = page.getByRole("region", { name: "발행 정보 정정", exact: true });
  await parent.getByLabel("정정할 퀴즈").selectOption("synthetic");
  await parent.getByRole("button", { name: "요약·단서 오탈자 수정" }).click();
  const panel = page.getByRole("region", { name: "일반 문구 오탈자", exact: true });
  await expect(panel.getByRole("alert")).toContainText("문구를 불러오지 못했습니다");
  readFails = false; await panel.getByRole("button", { name: "최신 문구 불러오기" }).click();
  await panel.getByLabel("수정할 문구").selectOption("summary");
  await panel.getByRole("textbox", { name: "수정 후", exact: true }).fill("합성 요약입니다.");
  for (const choice of ["semantic", "uncertain"]) {
    await panel.getByLabel("수정 종류").selectOption(choice);
    await expect(panel.getByRole("button", { name: "오탈자 저장" })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "문제 오류 처리에서 검토하기" })).toHaveAttribute("href", "#problem-correction-title");
  }
  expect(commands).toHaveLength(0);
  await panel.getByLabel("수정 종류").selectOption("non_semantic_typo");
  await panel.getByLabel("오탈자 정정 사유").fill("띄어쓰기 정정");
  await expect(panel.getByRole("button", { name: "오탈자 저장" })).toBeDisabled();
  await panel.getByRole("checkbox").check();
  await panel.getByRole("textbox", { name: "수정 후", exact: true }).fill("합성 요약입니다!");
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "오탈자 저장" }).click();
  await expect(panel.getByRole("alert")).toContainText("입력은 유지됩니다");
  await expect(panel.getByRole("textbox", { name: "수정 후", exact: true })).toHaveValue("합성 요약입니다!");
  await panel.getByRole("button", { name: "오탈자 저장" }).click();
  await expect(panel.getByRole("status").filter({ hasText: "오탈자 정정을 저장했습니다" })).toBeVisible();
  expect(commands).toHaveLength(2); expect(commands[0]).toEqual(commands[1]);
  await panel.getByText("문구 정정 이력 (1)", { exact: true }).click();
  await expect(panel).toContainText("수정 전: 합성 요약 입니다.");
  await expect(panel).toContainText("수정 후: 합성 요약입니다!");
  await panel.getByLabel("수정할 문구").selectOption("child-entry");
  await page.getByLabel("화면 테마").selectOption(testInfo.project.name === "chromium" ? "light" : "dark");
  await panel.screenshot({ path: testInfo.outputPath("wording.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await parent.getByLabel("정정할 퀴즈").selectOption("synthetic");
  await parent.getByRole("button", { name: "요약·단서 오탈자 수정" }).click();
  await panel.getByLabel("수정할 문구").selectOption("summary");
  await expect(panel.getByRole("textbox", { name: "수정 전", exact: true })).toHaveValue("합성 요약입니다!");
});

test("retains stale edits, refreshes explicitly and locks during problem correction", async ({ page }) => {
  const quiz = { quizSetId: "synthetic", slug: "2026-09-20-abc123", status: "archived", revision: 0,
    metadata: { title: "합성 설교", sermonDate: "2026-09-20" }, publishedAt: "2026-09-21T00:00:00.000Z", closesAt: "2026-09-28T00:00:00.000Z" };
  const view: WordingView = { quizSetId: "synthetic", revision: 0, contentRevision: 0, blocked: false,
    targets: [{ target: "summary", kind: "summary", difficulty: null, number: null, direction: null, text: "합성 요약" }], history: [] };
  await page.route("**/api/admin/published-quizzes", r => r.fulfill({ json: { data: { items: [quiz] } } }));
  await page.route("**/api/admin/quiz-sets/synthetic/display-text", r => r.fulfill({ json: { data: { quiz, history: [] } } }));
  await page.route("**/api/admin/quiz-sets/synthetic/display-text/wording", r => r.request().method() === "GET" ? r.fulfill({ json: { data: view } }) : r.fulfill({ status: 409, json: {} }));
  await page.goto("/admin/tools"); const parent = page.getByRole("region", { name: "발행 정보 정정", exact: true });
  await parent.getByLabel("정정할 퀴즈").selectOption("synthetic");
  await parent.getByRole("button", { name: "요약·단서 오탈자 수정" }).click();
  const panel = page.getByRole("region", { name: "일반 문구 오탈자", exact: true });
  await panel.getByLabel("수정할 문구").selectOption("summary"); await panel.getByRole("textbox", { name: "수정 후", exact: true }).fill("합성 요약.");
  await panel.getByLabel("수정 종류").selectOption("non_semantic_typo"); await panel.getByLabel("오탈자 정정 사유").fill("문장부호 정정");
  await panel.getByRole("checkbox").check(); await panel.getByRole("button", { name: "오탈자 저장" }).click();
  await expect(panel.getByRole("alert")).toBeVisible(); await expect(panel.getByRole("textbox", { name: "수정 후", exact: true })).toHaveValue("합성 요약.");
  view.blocked = true; await panel.getByRole("button", { name: "최신 문구 불러오기" }).click();
  await expect(panel.getByRole("status")).toContainText("문제 오류 처리가 진행 중"); await expect(panel.getByLabel("수정할 문구")).toBeDisabled();
});
