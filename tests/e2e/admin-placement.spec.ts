import { expect, test } from "@playwright/test";
import type { AdminContentView } from "../../shared/api/admin-content-generation";
import { searchCandidatePool } from "../../shared/puzzle/pool-search";
import { presentPlacement } from "../../workers/_shared/services/placement-presentation";
const hash = "a".repeat(64);
const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
const candidates = ["가나다", "라마바", "가사라", "다아바", "허호"].map((answer, i) => ({ id: `entry-${i + 1}`, displayAnswer: answer, gridAnswer: answer, clue: `합성 단서 ${i}`, status: "use" as const, phrase: "명사구" }));
const makeTrial = (settings: typeof options) => { const result = searchCandidatePool({ ...settings, candidates });
  return { layouts: result.layouts.map((layout, i) => presentPlacement(layout, i, candidates)), searchIncomplete: result.searchIncomplete,
    reasons: [...new Set(result.attempts.flatMap(a => a.reasons.map(r => r.message)))] }; };
test("administrator compares layouts, restores choices and reviews public and answer grids without AI", async ({ page }, testInfo) => {
  const layouts = makeTrial(options).layouts;
  const view: AdminContentView = { enabled: false, quizSetId: "quiz", jobId: "job", version: 12, status: "running", stage: "content_review",
    content: { state: "present", intent: { selectedId: "intent", rootAnalysisId: "intent", confirmation: { id: "confirmed-intent" } },
      summary: { id: "summary", review: { id: "rs" } }, child: { id: "child", review: { id: "rc" } }, adult: { id: "adult", review: { id: "ra" } } }, snapshots: [], historyCursor: null, regenerations: [],
    weekCostMicroUsd: 400000, weekUnknownCalls: 0, jobCostMicroUsd: 400000, jobUnknownCalls: 0,
    placement: { revision: 1, metadataRevision: 1, selected: false, current: false, selection: { child: { options, index: 0 }, adult: { options, index: 0 } } },
    reviewLayouts: { child: layouts[0]!, adult: layouts[0]! }, preview: { metadata: { title: "배치 검토용 합성 설교", date: "2026-09-20", bibleReferenceLabel: "요한복음 3:16", translation: "개역개정", bibleReadingUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php" },
      summary: { text: "첫 문단\n\n두 번째 문단", disclosure: "공개 자막을 바탕으로 AI가 요약한 것으로 설교자의 원문이 아닙니다." }, variants: { child: layouts[0]!.grid, adult: layouts[0]!.grid } } };
  const initialPreview = structuredClone(view.preview!);
  view.preview = null; view.reviewLayouts = null;
  const actions: string[] = [], saved: unknown[] = []; let failTrial = false;
  await page.route("**/api/admin/sermons/sermon-1/input**", async route => {
    if (route.request().url().endsWith("/history")) return route.fulfill({ json: { data: { history: { head: { version: 2, sourceType: "caption_plain", sourceId: "source", documentId: "source", confirmationId: "confirmed" }, events: [
      { eventId: "source", version: 1, kind: "source", documentId: "source", parentDocumentId: null, relatedId: null, createdAt: "2026-09-22T00:00:00.000Z" },
      { eventId: "confirmed", version: 2, kind: "confirm", documentId: "source", parentDocumentId: "source", relatedId: null, createdAt: "2026-09-22T00:01:00.000Z" } ] } } } });
    return route.fulfill({ json: { data: { input: { version: 2, sourceType: "caption_plain", sourceId: "source", documentId: "source", documentSha256: hash,
      confirmationId: "confirmed", source: { sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript" }, content: { format: "plain_text", text: "합성 입력 자료" } } } } });
  });
  await page.route("**/api/admin/sermons/sermon-1/generation/**", async route => {
    const action = route.request().url().split("/").at(-1)!;
    if (action === "correction") return route.fulfill({ json: { data: { enabled: false, quizSetId: "quiz", latestJobId: null } } });
    if (route.request().method() === "GET") return route.fulfill({ json: { data: view } });
    actions.push(action); const body = route.request().postDataJSON();
    if (action === "placement-trial") {
      if (failTrial) return route.fulfill({ status: 409, json: { error: { code: "GENERATION_COMMAND_UNAVAILABLE", message: "자료가 변경되었습니다. 상태를 다시 확인해 주세요.", requestId: "11111111-1111-4111-8111-111111111111" } } });
      return route.fulfill({ json: { data: { ...body, ...makeTrial(body.options) } } });
    }
    if (action === "placement-select") {
      view.preview = structuredClone(initialPreview); view.reviewLayouts = { child: layouts[0]!, adult: layouts[0]! };
      saved.push(body); view.placement = { ...view.placement!, revision: view.placement!.revision + 1, selected: true, current: true, selection: body.selection };
      for (const level of ["child", "adult"] as const) { const chosen = makeTrial(body.selection[level].options).layouts[body.selection[level].index]!;
        view.reviewLayouts![level] = chosen; view.preview!.variants[level] = chosen.grid; }
      return route.fulfill({ json: { data: { outcome: "saved", current: true } } });
    }
    if (action === "finish") { view.status = "review_ready"; view.stage = "finish"; return route.fulfill({ json: { data: { outcome: "review_ready" } } }); }
    throw new Error(`Unexpected mutation ${action}`);
  });
  const load = async () => { await page.goto("/admin/tools"); await page.getByLabel("설교 ID").fill("sermon-1"); await page.getByRole("button", { name: "입력자료 불러오기" }).click(); };
  await load();
  const panel = page.getByRole("region", { name: "배치 선택·발행 전 검토", exact: true });
  const child = panel.getByRole("region", { name: "어린이 배치 시험", exact: true });
  const adult = panel.getByRole("region", { name: "장년 배치 시험", exact: true });
  const save = panel.getByRole("button", { name: "선택한 두 배치 저장·검사" });
  await expect(save).toBeDisabled();
  await child.getByLabel("목표 단어 수").fill("3");
  await child.getByRole("button", { name: "어린이 배치 시험", exact: true }).click();
  await expect(child.getByRole("status").filter({ hasText: "발행은 가능합니다." })).toBeVisible();
  await expect(child.getByRole("grid")).toBeVisible();
  await child.getByLabel("목표 단어 수").fill("4");
  await child.getByRole("button", { name: "어린이 배치 시험", exact: true }).click();
  await child.getByLabel("비교할 배치").selectOption("1");
  await expect(child.getByRole("grid")).toHaveAttribute("aria-rowcount", "6");
  await adult.getByRole("button", { name: "장년 배치 시험", exact: true }).click();
  await expect(save).toBeEnabled();
  await adult.getByLabel("목표 단어 수").fill("7");
  await expect(save).toBeDisabled();
  await adult.getByRole("button", { name: "장년 배치 시험", exact: true }).click();
  await expect(adult.getByText(/이 설정에서는 배치를 찾지 못했습니다/)).toBeVisible();
  await adult.getByLabel("목표 단어 수").fill("4");
  await adult.getByRole("button", { name: "장년 배치 시험", exact: true }).click();
  await save.click();
  await expect(panel.getByRole("heading", { name: "선택한 배치의 최종 검사 통과" })).toBeVisible();
  await expect(page.getByText("최종 검사 완료", { exact: true })).toBeVisible();
  expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ expectedVersion: 12, expectedSelectionRevision: 1, selection: { child: { index: 1 }, adult: { index: 0 } } });
  expect(JSON.stringify(saved[0])).not.toMatch(/solution|gridAnswer|cells/u);
  await load();
  const final = panel.getByRole("region", { name: "최종 검사 미리보기" });
  await expect(final.getByRole("grid", { name: "어린이 문제 격자" })).toHaveAttribute("aria-rowcount", "6");
  expect(await final.getByRole("grid").first().textContent()).not.toContain("가");
  await panel.getByLabel("관리자 정답 보기").check();
  await expect(final.getByRole("grid", { name: "어린이 정답 격자" })).toBeVisible();
  expect(await final.getByRole("grid").first().textContent()).toContain("가");
  await panel.getByLabel("모바일 폭으로 보기").check(); await panel.getByLabel("크게 보기").check();
  await page.getByLabel("화면 테마").selectOption("dark");
  await expect(final.getByRole("link", { name: "대한성서공회에서 읽기" })).toHaveAttribute("href", view.preview!.metadata.bibleReadingUrl);
  await expect(final.getByText(/아직 발행하지 않았습니다/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await final.screenshot({ path: `/tmp/p5-52-${testInfo.project.name}-dark.png` });
  await page.getByLabel("화면 테마").selectOption("light");
  await panel.getByLabel("모바일 폭으로 보기").uncheck(); await panel.getByLabel("크게 보기").uncheck();
  await final.screenshot({ path: `/tmp/p5-52-${testInfo.project.name}-light.png` });
  // A failed trial cannot leave its previous success selectable.
  await child.getByRole("button", { name: "어린이 배치 시험", exact: true }).click();
  failTrial = true;
  await child.getByRole("button", { name: "어린이 배치 시험", exact: true }).click();
  await expect(panel.getByText("자료가 변경되었습니다. 상태를 다시 확인해 주세요.")).toBeVisible();
  await expect(save).toBeDisabled();
  // Editing the content removes the old final preview after a state refresh.
  view.version++; view.preview = null; view.reviewLayouts = null; view.placement!.current = false;
  if (view.content.state === "present") view.content.child!.review = null;
  await page.getByRole("button", { name: "생성 상태 확인", exact: true }).click();
  await expect(panel.getByText(/저장한 배치의 바탕 자료가 변경/)).toBeVisible();
  await expect(child.getByRole("button", { name: "어린이 배치 시험", exact: true })).toBeDisabled();
  await expect(final).toHaveCount(0);
  expect(actions.every(action => ["placement-trial", "placement-select", "finish"].includes(action))).toBe(true);
});
