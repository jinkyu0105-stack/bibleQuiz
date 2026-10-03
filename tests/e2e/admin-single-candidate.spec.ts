import { expect, test } from "@playwright/test";
import type { AdminContentView } from "../../shared/api/admin-content-generation";

const hash = "a".repeat(64);
const binding = { transcript: { sourceId: "source", sourceRevision: 1, sourceSha256: hash, revisionId: "source",
  transcriptSha256: hash, checksumFormat: "sha256:utf8-working-text:v1" as const, confirmationId: "confirmed", version: 2 },
  analysisId: "intent", intentConfirmationId: "intent-confirmed" };
const candidate = (id: string, answer: string, clue: string) => ({ id, displayAnswer: answer, gridAnswer: answer, clue,
  phraseDescription: "명사", selectionReason: "설교 근거", sermonImportance: "핵심", difficultyReason: "쉬움",
  grounding: { origin: "transcript" as const, intentClaimIds: ["claim"], evidence: [{ quote: "서로 사랑하세요", from: 0, to: 8, segmentId: null, start: null, duration: null }] } });

test("select one answer and clue, recover the same request, compare and adopt while keeping other items", async ({ page }, testInfo) => {
  const view: AdminContentView = { enabled: true, quizSetId: "quiz", jobId: "full", version: 12, status: "running", stage: "content_review",
    content: { state: "present", intent: { selectedId: "intent", rootAnalysisId: "root", confirmation: { id: "intent-confirmed" } },
      summary: { id: "summary", review: { id: "summary-review" } }, child: { id: "child", review: { id: "child-review" } }, adult: { id: "adult", review: { id: "adult-review" } } },
    snapshots: [{ kind: "candidate", value: { id: "child", difficulty: "child", binding, statuses: { first: "locked", second: "excluded" },
      draft: { candidates: [candidate("first", "사랑", "이웃에게 나눌 마음"), candidate("second", "믿음", "보존할 다른 단서")] } } }],
    regenerations: [], historyCursor: null, preview: null, placement: null, reviewLayouts: null,
    weekCostMicroUsd: 400000, weekUnknownCalls: 0, jobCostMicroUsd: 400000, jobUnknownCalls: 0 };
  const requests: unknown[] = [];
  await page.route("**/api/admin/sermons/sermon-1/input**", async route => {
    if (route.request().url().endsWith("/history")) return route.fulfill({ json: { data: { history: { head: { version: 2, sourceType: "caption_plain", sourceId: "source", documentId: "source", confirmationId: "confirmed" }, events: [
      { eventId: "source", version: 1, kind: "source", documentId: "source", parentDocumentId: null, relatedId: null, createdAt: "2026-09-22T00:00:00.000Z" },
      { eventId: "confirmed", version: 2, kind: "confirm", documentId: "source", parentDocumentId: "source", relatedId: null, createdAt: "2026-09-22T00:01:00.000Z" } ] } } } });
    return route.fulfill({ json: { data: { input: { version: 2, sourceType: "caption_plain", sourceId: "source", documentId: "source", documentSha256: hash,
      confirmationId: "confirmed", source: { sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript" },
      content: { format: "plain_text", text: "서로 사랑하세요" } } } } });
  });
  await page.route("**/api/admin/sermons/sermon-1/generation/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/correction")) return route.fulfill({ json: { data: { enabled: false, quizSetId: "quiz", latestJobId: null } } });
    if (route.request().method() === "GET") return route.fulfill({ json: { data: view } });
    const body = route.request().postDataJSON();
    if (path.endsWith("/regenerate")) {
      requests.push(body);
      if (requests.length === 1) return route.abort("connectionreset");
      const original = view.snapshots[0]!;
      if (original.kind !== "candidate") throw new Error("fixture");
      view.version++;
      view.snapshots.push({ kind: "candidate", value: { ...structuredClone(original.value), id: "replacement", replacement: body.target,
        draft: { candidates: [candidate("first", "소망", "새로 제안한 마음"), original.value.draft.candidates[1]!] } } });
      view.regenerations = [{ jobId: body.requestKey, scope: "child", target: body.target, status: "review_ready", resultId: "replacement", analysisId: null,
        createdAt: "2026-09-23T00:00:00.000Z", costMicroUsd: 80000, unknownCalls: 0 }];
      return route.fulfill({ status: 202, json: { data: { jobId: body.requestKey, dispatch: "sent" } } });
    }
    if (path.endsWith("/review") && view.content.state === "present") {
      const op = body.operation.operation;
      if (op.kind === "select") view.content.child = { id: op.poolId, review: null };
      else if (op.kind === "review") view.content.child!.review = { id: "replacement-reviewed" };
      else throw new Error("unexpected mutation");
      view.version++;
      return route.fulfill({ json: { data: { outcome: "saved" } } });
    }
    throw new Error("unexpected request");
  });
  const load = async () => { await page.goto("/admin/tools"); await page.getByLabel("설교 ID").fill("sermon-1"); await page.getByRole("button", { name: "입력자료 불러오기" }).click(); };
  await load();
  const region = page.getByRole("region", { name: "필요한 내용만 다시 생성", exact: true });
  await region.getByLabel("재생성 범위").selectOption("child_one");
  await expect(region.getByRole("button", { name: "이 답·단서만 다시 생성" })).toBeDisabled();
  await region.getByLabel("다시 만들 답·단서").selectOption("child:first");
  await expect(region.getByText("현재 답: 사랑", { exact: false })).toBeVisible();
  await region.getByLabel("개별 재생성 비용과 무료 대안을 확인했습니다.").check();
  await region.getByRole("button", { name: "이 답·단서만 다시 생성" }).click();
  await expect(region.getByRole("button", { name: "같은 재생성 요청 확인" })).toBeEnabled();
  await expect(region.getByLabel("다시 만들 답·단서")).toBeDisabled();
  await region.getByRole("button", { name: "같은 재생성 요청 확인" }).click();
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).toMatchObject({ scope: "child", expectedVersion: 12, target: { basePoolId: "child", candidateId: "first" } });
  const replacement = page.getByRole("article").filter({ has: page.getByRole("region", { name: "답·단서 변경 비교" }) });
  const comparison = replacement.getByRole("region", { name: "답·단서 변경 비교" });
  await expect(comparison.getByText("답: 사랑", { exact: true })).toBeVisible();
  await expect(comparison.getByText("답: 소망", { exact: true })).toBeVisible();
  await expect(replacement.getByRole("textbox", { name: "단서 2", exact: true })).toHaveValue("보존할 다른 단서");
  await expect(replacement.getByLabel("배치에 사용할지 선택").nth(0)).toHaveValue("locked");
  await expect(replacement.getByLabel("배치에 사용할지 선택").nth(1)).toHaveValue("excluded");
  expect(view.content.state === "present" && view.content.child?.id).toBe("child");
  await page.getByLabel("화면 테마").selectOption("dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await comparison.screenshot({ path: `/tmp/p5-56-${testInfo.project.name}-dark.png` });
  await page.getByLabel("화면 테마").selectOption("light");
  await comparison.screenshot({ path: `/tmp/p5-56-${testInfo.project.name}-light.png` });
  await replacement.getByRole("button", { name: "이 자료 선택" }).click();
  await expect(replacement.getByRole("button", { name: "이 내용 검수 완료", exact: true })).toBeDisabled();
  await replacement.getByLabel("내용과 원문 근거를 검토했습니다.").check();
  await replacement.getByRole("button", { name: "이 내용 검수 완료", exact: true }).click();
  await load();
  await expect(replacement.getByText("검수 완료", { exact: true })).toBeVisible();
  view.regenerations[0]!.status = "uncertain";
  view.regenerations[0]!.resultId = null;
  await page.getByRole("button", { name: "생성 상태 확인" }).click();
  await region.getByLabel("재생성 범위").selectOption("child_one");
  await region.getByLabel("다시 만들 답·단서").selectOption("replacement:first");
  await expect(region.getByRole("button", { name: "이 답·단서만 다시 생성" })).toBeDisabled();
  await expect(region.getByText(/이전 응답이 확인되지 않았습니다/)).toBeVisible();
  await region.getByLabel("개별 재생성 비용과 무료 대안을 확인했습니다.").check();
  await expect(region.getByRole("button", { name: "이 답·단서만 다시 생성" })).toBeEnabled();
  expect(view.content).toMatchObject({ child: { id: "replacement", review: { id: "replacement-reviewed" } }, adult: { id: "adult", review: { id: "adult-review" } } });
});
