import { expect, test } from "@playwright/test";
import { adminAiCostsSchema } from "../../shared/api/admin-ai-costs";
import { draftMetadataViewSchema } from "../../shared/api/admin-sermon-drafts";
import { parseBibleReference } from "../../shared/bible-reference";

test("selected quiz cost opens its call ledger and changes with the selected work", async ({ page }) => {
  const reference = parseBibleReference("요 3:16");
  if (!reference.ok) throw new Error("synthetic reference");
  const items = ["first", "second"].map(id => ({ sermonId: id, quizSetId: `quiz-${id}`,
    title: `${id} 합성 설교`, sermonDate: "2026-09-20", status: "draft", expired: false }));
  const call = (id: string, cost: number | null) => ({ callId: `call-${id}`, jobId: `job-${id}`, purpose: "intent_analysis", scope: "full", singleEntry: false,
    provider: "openai", model: "gpt-5.6-terra", startedAt: "2026-09-22T00:00:00.000Z",
    observedAt: cost === null ? null : "2026-09-22T00:00:01.000Z", state: cost === null ? "uncertain" : "completed",
    inputVersion: 2, metadataRevision: 1, attemptNumber: 1, inputTokens: cost === null ? null : 100,
    cachedInputTokens: cost === null ? null : 20, reasoningTokens: cost === null ? null : 10,
    outputTokens: cost === null ? null : 30, audioInputTokens: null, audioSeconds: null,
    pricingVersion: cost === null ? null : "openai-terra-2026-09-22", estimatedCostMicroUsd: cost,
    usageSource: cost === null ? null : "provider_reported" });
  const first = adminAiCostsSchema.parse({ quizSetId: "quiz-first", knownCostMicroUsd: 524, unknownCalls: 1, totalCalls: 2,
    models: [{ provider: "openai", model: "gpt-5.6-terra", knownCostMicroUsd: 524, unknownCalls: 1, totalCalls: 2 }],
    calls: [call("known", 524), call("unknown", null)] });
  const second = adminAiCostsSchema.parse({ quizSetId: "quiz-second", knownCostMicroUsd: 1200, unknownCalls: 0, totalCalls: 1,
    models: [{ provider: "openai", model: "gpt-5.6-terra", knownCostMicroUsd: 1200, unknownCalls: 0, totalCalls: 1 }],
    calls: [{ ...call("second", 1200), pricingVersion: "openai-terra-2026-10-06-cache-write" }] });
  await page.route("**/api/admin/sermon-drafts**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/sermon-drafts")) return route.fulfill({ json: { data: { items } } });
    const item = items.find(value => path.endsWith(`/${value.sermonId}`))!;
    return route.fulfill({ json: { data: draftMetadataViewSchema.parse({ sermonId: item.sermonId, quizSetId: item.quizSetId,
      youtubeUrl: "https://youtu.be/abcdefghijk", metadataRevision: 1, title: item.title,
      sermonDate: item.sermonDate, bibleReference: reference.value, referenceLabel: reference.value.canonicalLabel,
      slugPreview: "2026-09-20-abc234" }) } });
  });
  await page.route("**/api/admin/sermons/*/input**", route => route.fulfill({ json: { data: route.request().url().endsWith("/history")
    ? { history: null } : { input: null } } }));
  await page.route("**/api/admin/quiz-sets/*/ai-costs", route => route.fulfill({ json: { data: route.request().url().includes("quiz-first") ? first : second } }));
  await page.goto("/admin/tools");
  const selected = page.getByRole("combobox", { name: "미발행 작업", exact: true });
  await selected.selectOption("first");
  const costButton = page.getByRole("button", { name: /이번 주 AI 예상 비용/ });
  await expect(costButton).toContainText("USD 0.000524");
  await expect(costButton).toContainText("사용량 미확인 1회");
  await costButton.click();
  const drawer = page.getByRole("dialog", { name: "이 퀴즈의 AI 호출 비용" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("openai · gpt-5.6-terra").first()).toBeVisible();
  await expect(drawer.getByText(/가격표 openai-terra-2026-09-22/)).toBeVisible();
  await expect(drawer.getByRole("note")).toContainText("캐시 저장 요금을 반영하지 않았습니다");
  await expect(drawer.getByText("미확인 호출의 비용은 합계에 포함되지 않았습니다. 0원이라는 뜻이 아닙니다.")).toBeVisible();
  await expect(drawer.getByText(/입력 v2 · 설교 정보 v1 · 시도 1/).first()).toBeVisible();
  await drawer.getByRole("button", { name: "닫기" }).click();
  await selected.selectOption("second");
  await expect(costButton).toContainText("USD 0.001200");
  await expect(costButton).not.toContainText("사용량 미확인");
  await costButton.click();
  await expect(drawer.getByRole("note")).toHaveCount(0);
  await expect(drawer.getByText("전체 1회 · 사용량 미확인 0회")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
