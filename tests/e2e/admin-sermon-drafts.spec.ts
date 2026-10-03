import { expect, test } from "@playwright/test";
import { draftMetadataViewSchema, registerSermonResultSchema } from "../../shared/api/admin-sermon-drafts";
import { parseBibleReference } from "../../shared/bible-reference";

test("new sermon registration, duplicate resume, prepublication metadata save and stale conflict", async ({ page }, testInfo) => {
  let view: ReturnType<typeof draftMetadataViewSchema.parse> | null = null;
  let failSave = false, saveCount = 0;
  const body = (title: string, date: string, referenceInput: string, revision: number) => {
    const parsed = parseBibleReference(referenceInput); if (!parsed.ok) throw new Error("fixture reference");
    return draftMetadataViewSchema.parse({ sermonId: "new-sermon", quizSetId: "new-quiz", youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      metadataRevision: revision, title, sermonDate: date, bibleReference: parsed.value, referenceLabel: parsed.value.canonicalLabel, slugPreview: `${date}-abc234` });
  };
  await page.route("**/api/admin/sermon-drafts**", async route => {
    const method = route.request().method(), url = new URL(route.request().url());
    if (method === "GET" && url.pathname.endsWith("/sermon-drafts")) return route.fulfill({ json: { data: { items: view ? [{ sermonId: view.sermonId, quizSetId: view.quizSetId, title: view.title, sermonDate: view.sermonDate, status: "draft", expired: false }] : [] } } });
    if (method === "GET") return route.fulfill({ json: { data: view } });
    const fields = route.request().postDataJSON();
    if (method === "POST") {
      const outcome = view ? "existing" : "created";
      view ??= body(fields.title, fields.sermonDate, fields.referenceInput, 1);
      return route.fulfill({ json: { data: registerSermonResultSchema.parse({ outcome, sermonId: "new-sermon", destination: "draft" }) } });
    }
    saveCount++;
    if (failSave) return route.fulfill({ status: 409, json: { error: { code: "DRAFT_CONFLICT", message: "다른 저장이나 발행이 처리됐습니다. 최신 정보를 다시 불러와 주세요." } } });
    expect(fields.expectedRevision).toBe(view!.metadataRevision);
    expect(fields.confirmed).toBe(true);
    view = body(fields.title, fields.sermonDate, fields.referenceInput, fields.expectedRevision + 1);
    return route.fulfill({ json: { data: view } });
  });
  await page.route("**/api/admin/sermons/new-sermon/input**", route => route.fulfill({ json: { data: route.request().url().endsWith("/history") ? { history: null } : { input: null } } }));
  await page.goto("/admin/tools");
  const panel = page.getByRole("region", { name: "설교 작업 선택", exact: true });
  await expect(panel.getByText("미발행 작업이 없습니다. 새 설교를 등록해 주세요.")).toBeVisible();
  await panel.getByRole("button", { name: "새 설교 등록", exact: true }).click();
  await panel.getByLabel("YouTube 영상 링크").fill("https://youtu.be/abcdefghijk");
  await panel.getByLabel("설교 제목", { exact: true }).fill("260920 합성 설교");
  await panel.getByRole("button", { name: "제목에서 설교일 추천" }).click();
  await expect(panel.getByLabel("설교 일자(주일)")).toHaveValue("2026-09-20");
  await panel.getByLabel("성경 장절", { exact: true }).fill("요 3:16-18");
  await expect(panel.getByRole("link", { name: "대한성서공회에서 읽기" })).toHaveAttribute("href", "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE");
  await expect(panel.getByRole("button", { name: "새 작업 등록", exact: true })).toBeDisabled();
  await panel.getByLabel("제목·설교일·성경 장절을 확인했습니다.").check();
  await panel.getByRole("button", { name: "새 작업 등록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "최초 입력자료 저장", exact: true })).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "미발행 작업", exact: true })).toHaveValue("new-sermon");
  await panel.getByLabel("설교 제목", { exact: true }).fill("수정된 합성 제목");
  await panel.getByLabel("설교 일자(주일)").fill("2026-09-21");
  await expect(panel.getByText(/특별예배 등 의도한 날짜/)).toBeVisible();
  await panel.getByRole("combobox", { name: "성경 책", exact: true }).selectOption("MAT");
  await panel.getByLabel("제목·설교일·성경 장절을 확인했습니다.").check();
  await panel.getByRole("button", { name: "설교 정보 저장", exact: true }).click();
  await expect(panel.getByText(/설교 정보를 저장했습니다/)).toBeVisible();
  await expect(panel.getByLabel("설교 제목", { exact: true })).toHaveValue("수정된 합성 제목");
  await expect(panel.getByText("공개 주소 미리보기: /quiz/2026-09-21-abc234")).toBeVisible();
  failSave = true;
  await panel.getByLabel("설교 제목", { exact: true }).fill("충돌 때 보존할 입력");
  await panel.getByLabel("제목·설교일·성경 장절을 확인했습니다.").check();
  await panel.getByRole("button", { name: "설교 정보 저장", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("최신 정보를 다시");
  await expect(panel.getByLabel("설교 제목", { exact: true })).toHaveValue("충돌 때 보존할 입력");
  expect(saveCount).toBe(2);
  await panel.getByRole("button", { name: "작업 목록 새로고침" }).click();
  await expect(panel.getByLabel("설교 제목", { exact: true })).toHaveValue("수정된 합성 제목");
  await panel.getByRole("button", { name: "새 설교 등록", exact: true }).click();
  await panel.getByLabel("YouTube 영상 링크").fill("https://youtube.com/watch?v=abcdefghijk");
  await panel.getByLabel("설교 제목", { exact: true }).fill("중복 제목");
  await panel.getByLabel("성경 장절", { exact: true }).fill("요 3:16");
  await panel.getByLabel("제목·설교일·성경 장절을 확인했습니다.").check();
  await panel.getByRole("button", { name: "새 작업 등록", exact: true }).click();
  await expect(panel.getByText(/같은 영상의 기존 작업/)).toBeVisible();
  await expect(panel.getByLabel("설교 제목", { exact: true })).toHaveValue("수정된 합성 제목");
  await panel.screenshot({ path: `/tmp/p5-65-${testInfo.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("resume an existing draft from the list and keep unsaved source text out of another work", async ({ page }) => {
  const items = ["first", "second"].map(id => ({ sermonId: id, quizSetId: `quiz-${id}`, title: `${id} 합성 설교`, sermonDate: "2026-09-20", status: "draft", expired: false }));
  await page.route("**/api/admin/sermon-drafts**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/sermon-drafts")) return route.fulfill({ json: { data: { items } } });
    const item = items.find(item => path.endsWith(`/${item.sermonId}`))!;
    const reference = parseBibleReference("요 3:16"); if (!reference.ok) throw new Error("fixture");
    return route.fulfill({ json: { data: draftMetadataViewSchema.parse({ ...Object.fromEntries(Object.entries(item).filter(([key]) => !["status", "expired"].includes(key))),
      metadataRevision: 1, youtubeUrl: "https://youtu.be/abcdefghijk", referenceLabel: reference.value.canonicalLabel,
      bibleReference: reference.value, slugPreview: "2026-09-20-abc234" }) } });
  });
  await page.route("**/api/admin/sermons/*/input**", route => route.fulfill({ json: { data: route.request().url().endsWith("/history") ? { history: null } : { input: null } } }));
  await page.goto("/admin/tools");
  const panel = page.getByRole("region", { name: "설교 작업 선택", exact: true });
  const select = panel.getByRole("combobox", { name: "미발행 작업", exact: true });
  await select.selectOption("first");
  await expect(panel.getByLabel("설교 제목", { exact: true })).toHaveValue("first 합성 설교");
  const source = page.locator("textarea").first();
  await source.fill("첫 작업의 저장하지 않은 합성 입력");
  await select.selectOption("second");
  await expect(panel.getByLabel("설교 제목", { exact: true })).toHaveValue("second 합성 설교");
  await expect(source).toHaveValue("");
  await expect(page.getByLabel("설교 ID", { exact: true })).toHaveValue("second");
});
