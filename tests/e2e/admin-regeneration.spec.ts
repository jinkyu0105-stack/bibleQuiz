import { expect, test } from "@playwright/test";
const hash = "a".repeat(64);
const binding = { sourceId: "source", sourceRevision: 1, sourceSha256: hash, revisionId: "source", transcriptSha256: hash, checksumFormat: "sha256:utf8-working-text:v1", confirmationId: "confirmed", version: 2 };
const analysis = { centralMessage: [{ id: "claim", text: "서로 사랑하세요", origin: "transcript", evidence: [{ segmentId: null, start: null, duration: null, from: 0, to: 8, quote: "서로 사랑하세요" }] }], purpose: [], bibleRelationship: [], argumentFlow: [], repeatedEmphasis: [], illustrations: [], audienceResponse: [], warnings: [], uncertainties: [] };
test("administrator explicitly regenerates one scope, recovers a lost response and chooses a reviewed replacement", async ({ page }, testInfo) => {
  const contentBinding = { transcript: binding, analysisId: "intent", intentConfirmationId: "confirmed-intent" };
  const summary = (id: string, text: string) => ({ kind: "summary", value: { id, binding: contentBinding,
    draft: { paragraphs: [{ id: "p", text, intentClaimIds: ["claim"], evidence: analysis.centralMessage[0]!.evidence }] } } });
  const view = { enabled: true, quizSetId: "quiz", jobId: "full-job", version: 12, status: "running", stage: "content_review",
    content: { state: "present", intent: { selectedId: "intent", rootAnalysisId: "intent", confirmation: { id: "confirmed-intent" } },
      summary: { id: "old-summary", review: { id: "old-review" } as { id: string } | null },
      child: { id: "child", review: { id: "child-review" } }, adult: { id: "adult", review: { id: "adult-review" } } },
    snapshots: [summary("old-summary", "보존할 기존 요약")], historyCursor: 5 as number | null,
    regenerations: [] as Array<{ jobId: string; scope: string; status: string; resultId: string | null; analysisId: string | null; createdAt: string; costMicroUsd: number; unknownCalls: number }>,
    weekCostMicroUsd: 400000, weekUnknownCalls: 0, jobCostMicroUsd: 400000, jobUnknownCalls: 0, preview: null };
  const requests: Array<{ requestKey: string; expectedVersion: number; scope: string }> = [];
  let lost = true;
  await page.route("**/api/admin/sermons/sermon-1/input**", async route => {
    if (route.request().url().endsWith("/history")) return route.fulfill({ json: { data: { history: { head: { version: 2, sourceType: "caption_plain", sourceId: "source", documentId: "source", confirmationId: "confirmed" }, events: [
      { eventId: "source", version: 1, kind: "source", documentId: "source", parentDocumentId: null, relatedId: null, createdAt: "2026-09-22T00:00:00.000Z" },
      { eventId: "confirmed", version: 2, kind: "confirm", documentId: "source", parentDocumentId: "source", relatedId: null, createdAt: "2026-09-22T00:01:00.000Z" } ] } } } });
    return route.fulfill({ json: { data: { input: { version: 2, sourceType: "caption_plain", sourceId: "source", documentId: "source", documentSha256: hash,
      confirmationId: "confirmed", source: { sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript" }, content: { format: "plain_text", text: "서로 사랑하세요" } } } } });
  });
  await page.route("**/api/admin/sermons/sermon-1/generation/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/correction")) return route.fulfill({ json: { data: { enabled: false, quizSetId: "quiz", latestJobId: null } } });
    if (route.request().method() === "GET") return route.fulfill({ json: { data: url.searchParams.has("before") ? { ...view, snapshots: [summary("historical", "과거 요약")], historyCursor: null } : view } });
    const body = route.request().postDataJSON();
    if (url.pathname.endsWith("/regenerate")) {
      requests.push(body);
      if (requests.length === 3) {
        view.version++;
        return route.fulfill({ status: 409, json: { error: { code: "GENERATION_REQUEST_UNAVAILABLE", message: "현재 자료가 변경되었습니다.", requestId: "11111111-1111-4111-8111-111111111111" } } });
      }
      if (lost) { lost = false; return route.abort("connectionreset"); }
      view.version++;
      view.snapshots.push(summary("new-summary", "새로 생성한 비교 요약"));
      view.regenerations = [{ jobId: body.requestKey, scope: body.scope, status: "review_ready", resultId: "new-summary", analysisId: null, createdAt: "2026-09-22T00:00:00.000Z", costMicroUsd: 80000, unknownCalls: 0 }];
      return route.fulfill({ status: 202, json: { data: { jobId: body.requestKey, dispatch: "sent" } } });
    }
    if (url.pathname.endsWith("/review")) {
      view.version++;
      const op = body.operation.operation;
      if (op.kind === "select") view.content.summary = { id: op.summaryId, review: null };
      else if (op.kind === "review") view.content.summary.review = { id: "new-review" };
      else throw new Error("unexpected mutation");
      return route.fulfill({ json: { data: { outcome: "saved" } } });
    }
    throw new Error(`unexpected mutation ${url.pathname}`);
  });
  const load = async () => { await page.goto("/admin/tools"); await page.getByLabel("설교 ID").fill("sermon-1"); await page.getByRole("button", { name: "입력자료 불러오기" }).click(); };
  await load();
  const region = page.getByRole("region", { name: "필요한 내용만 다시 생성", exact: true });
  await expect(region.getByRole("button", { name: "요약만 다시 생성" })).toBeDisabled();
  await region.getByLabel("개별 재생성 비용과 무료 대안을 확인했습니다.").check();
  await region.getByRole("button", { name: "요약만 다시 생성" }).click();
  await expect(region.getByRole("button", { name: "같은 재생성 요청 확인" })).toBeEnabled();
  await region.getByRole("button", { name: "같은 재생성 요청 확인" }).click();
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]); expect(requests[0]).toMatchObject({ scope: "summary", expectedVersion: 12 });
  const articles = page.getByRole("article");
  const original = articles.filter({ has: page.locator('textarea').filter({ hasText: "보존할 기존 요약" }) });
  const replacement = articles.filter({ has: page.locator('textarea').filter({ hasText: "새로 생성한 비교 요약" }) });
  await expect(original.getByText("검수 완료", { exact: true })).toBeVisible();
  await expect(replacement.getByText("비교 자료", { exact: true })).toBeVisible();
  await replacement.getByRole("button", { name: "이 자료 선택" }).click();
  await expect(replacement.getByRole("button", { name: "이 내용 검수 완료", exact: true })).toBeDisabled();
  await replacement.getByLabel("내용과 원문 근거를 검토했습니다.").check();
  await replacement.getByRole("button", { name: "이 내용 검수 완료", exact: true }).click();
  await load();
  await expect(replacement.getByText("검수 완료", { exact: true })).toBeVisible();
  await region.getByText(/개별 생성 이력·비용/).click();
  await expect(region.getByText(/비교 자료 저장 완료/)).toBeVisible();
  await region.getByLabel("재생성 범위").selectOption("adult");
  await expect(region.getByRole("button", { name: "장년 문제만 다시 생성" })).toBeDisabled();
  await page.getByRole("button", { name: "이전 생성·수정 자료 보기" }).click();
  await expect(page.locator("textarea").filter({ hasText: "과거 요약" })).toHaveValue("과거 요약");
  expect(requests).toHaveLength(2);
  await region.getByLabel("개별 재생성 비용과 무료 대안을 확인했습니다.").check();
  await region.getByRole("button", { name: "장년 문제만 다시 생성" }).click();
  await region.getByRole("button", { name: "현재 자료로 새 요청 준비" }).click();
  await expect(region.getByLabel("개별 재생성 비용과 무료 대안을 확인했습니다.")).not.toBeChecked();
  await expect(region.getByLabel("재생성 범위")).toBeEnabled();
  expect(requests).toHaveLength(3);
  await page.getByLabel("화면 테마").selectOption("dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await region.screenshot({ path: `/tmp/p5-53-${testInfo.project.name}-dark.png` });
  await page.getByLabel("화면 테마").selectOption("light");
  await region.screenshot({ path: `/tmp/p5-53-${testInfo.project.name}-light.png` });
});


test("administrator compares an intent-only revision and explicitly reconfirms it", async ({ page }) => {
  const critique = { exaggeratedIntent: { assessment: "clear", concerns: [] }, unsupportedConclusion: { assessment: "clear", concerns: [] },
    illustrationAsMainClaim: { assessment: "clear", concerns: [] }, reversedMeaning: { assessment: "clear", concerns: [] } };
  const intent = (id: string, root: string, text: string) => ({ kind: "intent", value: { id, kind: "critique", binding,
    analysis: { ...analysis, centralMessage: [{ ...analysis.centralMessage[0]!, text }] }, critiqueId: id }, critique,
    rootAnalysisId: root });
  const view = { enabled: true, quizSetId: "quiz", jobId: "full-job", version: 12, status: "running", stage: "content_review",
    content: { state: "present", intent: { selectedId: "old-intent", rootAnalysisId: "old-root", confirmation: { id: "old-confirm" } as { id: string } | null },
      summary: { id: "summary", review: { id: "summary-review" } as { id: string } | null },
      child: { id: "child", review: { id: "child-review" } as { id: string } | null },
      adult: { id: "adult", review: { id: "adult-review" } as { id: string } | null } },
    snapshots: [intent("old-intent", "old-root", "기존 해석")], historyCursor: null,
    regenerations: [] as Array<{ jobId: string; scope: "intent"; status: string; resultId: string | null; analysisId: string | null; createdAt: string; costMicroUsd: number; unknownCalls: number }>,
    weekCostMicroUsd: 400000, weekUnknownCalls: 0, jobCostMicroUsd: 400000, jobUnknownCalls: 0, preview: null };
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
      view.version += 2;
      view.snapshots.push(intent("new-critique", "result-regen-job-intent_analysis", "새 비판 수정본"));
      view.regenerations = [{ jobId: "regen-job", scope: "intent", status: "awaiting_intent_review", resultId: "new-critique", analysisId: "result-regen-job-intent_analysis",
        createdAt: "2026-09-22T00:00:00.000Z", costMicroUsd: 160000, unknownCalls: 0 }];
      return route.fulfill({ status: 202, json: { data: { jobId: "regen-job", dispatch: "sent" } } });
    }
    if (path.endsWith("/review")) {
      const op = body.operation.operation;
      view.version++;
      if (op.kind === "select") { view.content.intent = { selectedId: op.analysisId, rootAnalysisId: "result-regen-job-intent_analysis", confirmation: null };
        view.content.summary.review = null; view.content.child.review = null; view.content.adult.review = null; }
      else if (op.kind === "confirm") view.content.intent.confirmation = { id: "new-confirm" };
      else throw new Error("unexpected command");
      return route.fulfill({ json: { data: { outcome: "saved" } } });
    }
    if (path.endsWith("/regen-job/resume")) { view.regenerations[0]!.status = "review_ready"; return route.fulfill({ json: { data: { outcome: "sent" } } }); }
    throw new Error(`unexpected mutation ${path}`);
  });
  await page.goto("/admin/tools"); await page.getByLabel("설교 ID").fill("sermon-1");
  await page.getByRole("button", { name: "입력자료 불러오기" }).click();
  const region = page.getByRole("region", { name: "필요한 내용만 다시 생성", exact: true });
  await region.getByLabel("재생성 범위").selectOption("intent");
  await expect(region.getByRole("button", { name: "설교 의도만 다시 생성" })).toBeDisabled();
  await region.getByLabel("개별 재생성 비용과 무료 대안을 확인했습니다.").check();
  await region.getByRole("button", { name: "설교 의도만 다시 생성" }).click();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ scope: "intent", expectedVersion: 12 });
  expect(view.content.intent.selectedId).toBe("old-intent");
  const replacement = page.getByRole("article").filter({ has: page.locator("textarea").filter({ hasText: "새 비판 수정본" }) });
  await expect(replacement.getByText("비교 자료", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "재확정한 의도 반영 완료" })).toBeDisabled();
  await expect(region.getByRole("button", { name: "기존 의도 유지하고 비교 종료" })).toBeEnabled();
  await replacement.getByRole("button", { name: "이 자료 선택" }).click();
  await expect(region.getByRole("button", { name: "기존 의도 유지하고 비교 종료" })).toBeDisabled();
  expect(view.content.summary.review).toBeNull(); expect(view.content.child.review).toBeNull(); expect(view.content.adult.review).toBeNull();
  await replacement.getByRole("button", { name: "설교 의도 확정" }).click();
  const confirmation = page.getByRole("dialog", { name: "설교 의도 확정" });
  await expect(confirmation.getByText("확정하면 새 의도를 비교 작업에 반영합니다. 추가 AI 호출은 없습니다.")).toBeVisible();
  await confirmation.getByRole("button", { name: "확정하고 비교 반영" }).click();
  await region.getByText(/개별 생성 이력·비용/).click();
  await expect(region.getByText(/비교 자료 저장 완료/)).toBeVisible();
  expect(view.content.intent).toMatchObject({ selectedId: "new-critique", confirmation: { id: "new-confirm" } });
  view.regenerations = [{ jobId: "failed-job", scope: "intent", status: "failed", resultId: null,
    analysisId: "saved-first-analysis", createdAt: "2026-09-22T01:00:00.000Z", costMicroUsd: 80000, unknownCalls: 0 }];
  await page.reload();
  await page.getByLabel("설교 ID").fill("sermon-1");
  await page.getByRole("button", { name: "입력자료 불러오기" }).click();
  await region.getByLabel("재생성 범위").selectOption("intent");
  await expect(region.getByRole("button", { name: "비판 검토만 다시 시도" })).toBeDisabled();
  await region.getByLabel("개별 재생성 비용과 무료 대안을 확인했습니다.").check();
  await region.getByRole("button", { name: "비판 검토만 다시 시도" }).click();
  expect(requests.at(-1)).toMatchObject({ scope: "intent", supersedesJobId: "failed-job", retryCritiqueOnly: true });
});
