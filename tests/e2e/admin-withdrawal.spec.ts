import { expect, test } from "@playwright/test";
import type { WithdrawalView } from "../../shared/api/admin-withdraw";
const quiz = { quizSetId: "synthetic", slug: "2026-09-20-abc123", status: "published", revision: 1,
  metadata: { title: "합성 철회 대상", sermonDate: "2026-09-20" }, publishedAt: "2026-09-21T00:00:00.000Z", closesAt: "2026-09-28T00:00:00.000Z" };
const review: WithdrawalView = { quizSetId: "synthetic", reviewRevision: 2, withdrawnAt: "2026-09-23T00:00:00.000Z", reason: "합성 철회 사유",
  review: { metadata: quiz.metadata, slug: quiz.slug, summary: "보존된 합성 요약", disclosure: "합성 안내", churchName: "합성 교회",
    bibleReferenceLabel: "마태복음 5:1", translation: "개역개정", bibleReadingUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE",
    variants: ["child", "adult"].map(difficulty => ({ sourceVariantId: `synthetic-${difficulty}`, sourceRevision: 1,
      difficulty: difficulty as "child" | "adult", grid: { size: 5, cells: [] },
      entries: [{ id: "entry", number: 1, direction: "across", startRow: 0, startCol: 0, length: 2, clue: "합성 단서", grounding: {}, displayOrder: 0 }],
      canonicalCellOrder: ["r0c0", "r0c1"], solutionCells: { r0c0: "가", r0c1: "나" }, entryAnswers: { entry: "가나" }, solutionSha256: "a".repeat(64) })) } };
test("confirms withdrawal, retries a lost response exactly and restores private review after refresh", async ({ page }, testInfo) => {
  let saved = false, failedList = true;
  const commands: unknown[] = [];
  await page.route("**/api/admin/published-quizzes", route => route.fulfill({ json: { data: { items: saved ? [] : [quiz] } } }));
  await page.route("**/api/admin/withdrawn-quizzes", route => failedList ? route.fulfill({ status: 503, json: {} }) :
    route.fulfill({ json: { data: { items: saved ? [{ quizSetId: "synthetic", title: quiz.metadata.title, reviewRevision: 2, withdrawnAt: review.withdrawnAt }] : [] } } }));
  await page.route("**/api/admin/quiz-sets/synthetic/withdraw-to-review", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: review } });
    commands.push(route.request().postDataJSON()); saved = true;
    return commands.length === 1 ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { data: { outcome: "replayed", quizSetId: "synthetic", reviewRevision: 2, withdrawnAt: review.withdrawnAt } } });
  });
  await page.goto("/admin/tools"); const panel = page.getByRole("region", { name: "첫 제출 전 발행 철회" });
  await expect(panel.getByRole("alert")).toContainText("목록을 불러오지 못했습니다");
  failedList = false; await panel.getByRole("button", { name: "목록 다시 확인" }).click();
  await panel.getByLabel("철회할 퀴즈", { exact: true }).selectOption("synthetic");
  await panel.getByLabel("철회 사유").fill(review.reason);
  await panel.getByRole("button", { name: "발행 철회 확인", exact: true }).click();
  await expect(panel.getByRole("group", { name: "발행 철회 최종 확인" })).toContainText("공개 링크에서 풀이와 제출을 중단");
  await panel.getByRole("button", { name: "취소", exact: true }).click(); expect(commands).toHaveLength(0);
  await panel.getByRole("button", { name: "발행 철회 확인", exact: true }).click();
  await panel.getByRole("button", { name: "지금 발행 철회", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("입력한 사유는 유지");
  await expect(panel.getByLabel("철회 사유")).toHaveValue(review.reason);
  await panel.getByRole("button", { name: "지금 발행 철회", exact: true }).click();
  expect(commands).toHaveLength(2); expect(commands[0]).toEqual(commands[1]);
  await expect(panel.getByRole("status")).toContainText("검수 대기로 돌렸습니다");
  await expect(panel.getByRole("article", { name: "철회 후 검수 시작 자료" })).toContainText("보존된 합성 요약");
  await panel.getByText("어린이 문제·정답 보존 자료", { exact: true }).click();
  await expect(panel).toContainText("합성 단서 · 정답: 가나");
  await panel.screenshot({ path: testInfo.outputPath("withdrawal-light.png") });
  await page.getByLabel("화면 테마").selectOption("dark");
  await panel.screenshot({ path: testInfo.outputPath("withdrawal-dark.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await panel.getByLabel("철회한 퀴즈 검수 자료").selectOption("synthetic");
  await expect(panel.getByRole("article", { name: "철회 후 검수 시작 자료" })).toContainText("오전 9:00");
});

test("keeps reason on submission conflict and handles empty lists", async ({ page }) => {
  let empty = false;
  await page.route("**/api/admin/published-quizzes", route => route.fulfill({ json: { data: { items: empty ? [] : [quiz] } } }));
  await page.route("**/api/admin/withdrawn-quizzes", route => route.fulfill({ json: { data: { items: [] } } }));
  await page.route("**/api/admin/quiz-sets/synthetic/withdraw-to-review", route => route.fulfill({ status: 409, json: {} }));
  await page.goto("/admin/tools"); const panel = page.getByRole("region", { name: "첫 제출 전 발행 철회" });
  await panel.getByLabel("철회할 퀴즈", { exact: true }).selectOption("synthetic");
  await panel.getByLabel("철회 사유").fill(review.reason);
  await panel.getByRole("button", { name: "발행 철회 확인", exact: true }).click();
  await panel.getByRole("button", { name: "지금 발행 철회", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("제출·마감·정정 여부");
  await expect(panel.getByLabel("철회 사유")).toHaveValue(review.reason);
  empty = true; await panel.getByRole("button", { name: "목록 다시 확인" }).click();
  await expect(panel).toContainText("현재 발행 중인 퀴즈가 없습니다");
});
