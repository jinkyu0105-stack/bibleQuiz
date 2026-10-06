import { adminContentViewSchema, type AdminContentView } from "../../shared/api/admin-content-generation";
import { expect, test } from "@playwright/test";
// Serve the same independent projections as the real endpoints, rather than
// returning a complete view for every section and hiding loading regressions.
function contentSection(raw: unknown, url: string) {
  const value = adminContentViewSchema.parse(raw);
  const section = new URL(url).searchParams.get("section");
  if (!section) return value;
  const query = new URL(url).searchParams;
  if (query.get("parts") === "true" && section === "content") {
    const snapshotId = query.get("snapshotId");
    if (snapshotId) return adminContentViewSchema.parse({ ...value, snapshots: value.snapshots.filter(s => s.value.id === snapshotId) });
    return adminContentViewSchema.parse({ ...value, snapshots: [], snapshotIds: value.snapshots.map(s => s.value.id) });
  }
  if (query.get("parts") === "true" && section === "placement" && value.reviewLayouts && value.preview) {
    const difficulty = query.get("difficulty") === "adult" ? "adult" : "child";
    return adminContentViewSchema.parse({ ...value, preview: null, reviewLayouts: null,
      layoutPart: { difficulty, layout: value.reviewLayouts[difficulty], preview: { metadata: value.preview.metadata, summary: value.preview.summary } } });
  }

  const keys: Record<string, (keyof AdminContentView)[]> = {
    costs: ["weekCostMicroUsd", "weekUnknownCalls", "jobCostMicroUsd", "jobUnknownCalls", "quizCostMicroUsd", "quizUnknownCalls"],
    content: ["content", "snapshots", "quality", "historyCursor", "recoveredAnalysisId", "recoveredCritiqueId"],
    activity: ["regenerations"], placement: ["placement", "preview", "reviewLayouts"],
  };
  const base = { ...value, content: { state: "absent" }, snapshots: [], quality: {}, historyCursor: null,
    recoveredAnalysisId: null, recoveredCritiqueId: null, regenerations: [], placement: null, preview: null,
    reviewLayouts: null, weekCostMicroUsd: 0, weekUnknownCalls: 0, jobCostMicroUsd: 0, jobUnknownCalls: 0 };
  return adminContentViewSchema.parse({ ...base, ...Object.fromEntries((keys[section] ?? []).map(key => [key, value[key]])) });
}
const hash = "a".repeat(64);
const binding = { sourceId: "source", sourceRevision: 1, sourceSha256: hash, revisionId: "source", transcriptSha256: hash, checksumFormat: "sha256:utf8-working-text:v1", confirmationId: "confirmed", version: 2 };
const analysis = { centralMessage: [{ id: "claim", text: "서로 사랑하세요", origin: "transcript", evidence: [{ segmentId: "segment-1", start: 12.5, duration: 3, from: 0, to: 8, quote: "서로 사랑하세요" }] }], purpose: [{ id: "purpose", text: "사랑을 실천하도록 권한다", origin: "transcript", evidence: [{ segmentId: "segment-1", start: 12.5, duration: 3, from: 0, to: 8, quote: "서로 사랑하세요" }] }], bibleRelationship: [], argumentFlow: [], repeatedEmphasis: [], illustrations: [], audienceResponse: [], warnings: [], uncertainties: [] };
const critique = Object.fromEntries(["exaggeratedIntent", "unsupportedConclusion", "illustrationAsMainClaim", "reversedMeaning"].map(k => [k, { assessment: "clear", concerns: [] }]));
for (const savedCritique of [false, true]) test(`administrator continues preserved results (critique=${savedCritique}) without buying them again`, async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  let releasePlacement!: () => void;
  let holdPlacement = true, failPlacement = false;
  const placementGate = new Promise<void>(resolve => { releasePlacement = resolve; });
  const view = { enabled: true, quizSetId: "quiz", jobId: "failed-analysis", version: 3, status: "failed", stage: "intent_analysis",
    recoveredCritiqueId: savedCritique ? "recovery-critique" : null,
    recoveredAnalysisId: "recovery-analysis" as string | null, content: { state: "present", intent: { selectedId: "recovery-analysis", rootAnalysisId: "recovery-analysis", confirmation: null }, summary: null, child: null, adult: null },
    snapshots: [{ kind: "intent", value: { id: "recovery-analysis", kind: "analysis", analysis, binding, critiqueId: null }, critique: null }],
    weekCostMicroUsd: 150000, weekUnknownCalls: 0, jobCostMicroUsd: 150000, jobUnknownCalls: 0, preview: null };
  await page.route("**/api/admin/sermons/sermon-1/input**", async route => {
    if (route.request().url().endsWith("/history")) return route.fulfill({ json: { data: { history: { head: { version: 2, sourceType: "caption_timed", sourceId: "source", documentId: "source", confirmationId: "confirmed" }, events: [
      { eventId: "source", version: 1, kind: "source", documentId: "source", parentDocumentId: null, relatedId: null, createdAt: "2026-09-22T00:00:00.000Z" },
      { eventId: "confirmed", version: 2, kind: "confirm", documentId: "source", parentDocumentId: "source", relatedId: null, createdAt: "2026-09-22T00:01:00.000Z" } ] } } } });
    return route.fulfill({ json: { data: { input: { version: 2, sourceType: "caption_timed", sourceId: "source", documentId: "source", documentSha256: hash,
      confirmationId: "confirmed", source: { sourceMode: "public_unofficial", videoId: "abcdefghijk", language: "ko", trackId: "ko", generated: true,
        retrievedAt: "2026-09-24T00:00:00.000Z", providerId: "accountless-youtube-spike", providerVersion: "0.1.0" },
      content: { format: "timed_segments", segments: [{ segmentId: "segment-1", text: "서로 사랑하세요", start: 12.5, duration: 3 }] } } } } });
  });
  await page.route("**/api/admin/sermons/sermon-1/generation/**", async route => {
    if (route.request().url().endsWith("/correction")) return route.fulfill({ json: { data: { enabled: false, quizSetId: "quiz", latestJobId: null } } });
    if (route.request().method() === "GET") {
      if (new URL(route.request().url()).searchParams.get("section") === "placement") {
        if (holdPlacement) await placementGate;
        if (failPlacement) return route.fulfill({ status: 409, json: { error: {
          code: "GENERATION_STATUS_UNAVAILABLE", message: "배치 조회 실패", requestId: "11111111-1111-4111-8111-111111111111" } } });
      }
      return route.fulfill({ json: { data: contentSection(view, route.request().url()) } });
    }
    expect(route.request().url()).toMatch(/\/content$/u);
    requests.push(route.request().postDataJSON());
    view.status = "running"; view.stage = "intent_critique"; view.recoveredAnalysisId = null;
    return route.fulfill({ status: 202, json: { data: { jobId: "continued-job", dispatch: "sent" } } });
  });
  await page.goto("/admin/tools"); await page.getByLabel("설교 ID").fill("sermon-1");
  await page.getByRole("button", { name: "입력자료 불러오기" }).click();
  const panel = page.getByRole("region", { name: "설교 요약·문제 생성", exact: true });
  await expect(panel.getByText(savedCritique ? /보관한 분석과 비판 결과를 재사용합니다/ : /교정과 의도 분석을 다시 호출하지 않습니다/)).toBeVisible();
  await expect(panel.getByText(savedCritique ? /남은 3회 약 USD 0.24/ : /남은 4회 약 USD 0.32/)).toBeVisible();
  await expect(panel.getByRole("article")).toBeVisible();
  await expect(panel.getByText(/준비된 자료부터 표시합니다/)).toBeVisible();
  await expect(panel.getByText(/달력 주간 관측 비용 USD 0.1500/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "보관 분석으로 생성 이어가기" })).toBeDisabled();
  failPlacement = true; holdPlacement = false; releasePlacement();
  await expect(panel.getByRole("alert")).toContainText("일부 자료를 불러오지 못했습니다");
  await expect(panel.getByRole("article")).toBeVisible();
  failPlacement = false;
  await panel.getByRole("button", { name: "생성 상태 확인" }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);

  await panel.getByRole("button", { name: "보관 분석으로 생성 이어가기" }).click();
  const start = panel.getByRole("button", { name: savedCritique ? "보관 결과로 검수 이어가기" : "보관 분석으로 비판 검토 시작" });
  await expect(start).toBeDisabled();
  await panel.getByLabel("예상 비용과 무료 대안을 확인하고 생성을 요청합니다.").check();
  await start.click();
  await expect(panel.getByText("비판 검토 중", { exact: true })).toBeVisible();
  await expect(panel.getByText(/전체 5회/)).toHaveCount(0);
  await panel.getByRole("button", { name: "생성 상태 확인" }).click();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ quizSetId: "quiz", expectedVersion: 3, recoveredAnalysisId: "recovery-analysis" });
  expect(requests[0]).not.toHaveProperty("supersedesJobId");
  if (savedCritique) expect(requests[0]).toHaveProperty("recoveredCritiqueId", "recovery-critique");
});
for (const unverified of [false, true]) test(`administrator compares, edits, confirms, resumes and finishes (unverified=${unverified})`, async ({ page }) => {
  test.setTimeout(60_000);
  const displayedAnalysis = unverified ? JSON.parse(JSON.stringify(analysis)) : analysis;
  if (unverified) for (const [field, reason] of [["centralMessage", "not_found"], ["purpose", "ambiguous"]]) {
    displayedAnalysis[field!][0].evidence = [{ quote: reason === "not_found" ? "없는 인용문" : "반복 인용문",
      locationStatus: "unverified", reason, segmentId: null, start: null, duration: null, from: null, to: null }];
  }
  const jobId = "11111111-1111-4111-8111-111111111111";
  const view = { enabled: true, quizSetId: "quiz", jobId: null as string | null, version: 2, status: "idle", stage: "input_resolve",
    content: { state: "absent" } as Record<string, unknown>, quality: {} as Record<string, unknown>, snapshots: [] as Array<Record<string, unknown>>, weekCostMicroUsd: 80000,
    weekUnknownCalls: 1, jobCostMicroUsd: 0, jobUnknownCalls: 0, preview: null };
  const operations: string[] = [];
  let finalRequestKey = "", finalPolls = 0;
  await page.route("**/api/admin/sermons/sermon-1/input**", async route => {
    if (route.request().url().endsWith("/history")) return route.fulfill({ json: { data: { history: { head: { version: 2, sourceType: "caption_timed", sourceId: "source", documentId: "source", confirmationId: "confirmed" }, events: [
      { eventId: "source", version: 1, kind: "source", documentId: "source", parentDocumentId: null, relatedId: null, createdAt: "2026-09-22T00:00:00.000Z" },
      { eventId: "confirmed", version: 2, kind: "confirm", documentId: "source", parentDocumentId: "source", relatedId: null, createdAt: "2026-09-22T00:01:00.000Z" } ] } } } });
    return route.fulfill({ json: { data: { input: { version: 2, sourceType: "caption_timed", sourceId: "source", documentId: "source", documentSha256: hash,
      confirmationId: "confirmed", source: { sourceMode: "public_unofficial", videoId: "abcdefghijk", language: "ko", trackId: "ko", generated: false, retrievedAt: "2026-09-24T00:00:00.000Z", providerId: "accountless-youtube-spike", providerVersion: "0.1.0" }, content: { format: "timed_segments", segments: [{ segmentId: "segment-1", text: "서로 사랑하세요 그리고 이웃을 도우세요", start: 12.5, duration: 3 }] } } } } });
  });
  await page.route("**/api/admin/sermons/sermon-1/generation/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/correction")) return route.fulfill({ json: { data: { enabled: false, quizSetId: "quiz", latestJobId: null } } });
    if (url.includes("/final-check/")) {
      expect(url.endsWith(finalRequestKey)).toBe(true);
      finalPolls++;
      if (finalPolls < 2) return route.fulfill({ json: { data: { requestKey: finalRequestKey, outcome: "running" } } });
      view.status = "review_ready"; view.stage = "finish";
      return route.fulfill({ json: { data: { requestKey: finalRequestKey, outcome: "review_ready" } } });
    }
    if (route.request().method() === "GET") return route.fulfill({ json: { data: contentSection(view, route.request().url()) } });
    const body = route.request().postDataJSON();
    if (url.endsWith("/content")) {
      view.jobId = jobId; view.version = 4; view.status = "awaiting_intent_review"; view.stage = "intent_review";
      view.content = { state: "present", intent: { selectedId: "analysis", rootAnalysisId: "analysis", confirmation: null }, summary: null, child: null, adult: null };
      view.snapshots = [{ kind: "intent", value: { id: "analysis", kind: "analysis", analysis: displayedAnalysis, binding, critiqueId: null }, critique: null },
        { kind: "intent", value: { id: "critique", kind: "critique", analysis: displayedAnalysis, binding, critiqueId: "critique" }, critique }];
      return route.fulfill({ status: 202, json: { data: { jobId, dispatch: "sent" } } });
    }
    if (url.endsWith("/review")) {
      const op = body.operation.operation;
      operations.push(op.kind); view.version++;
      if (op.kind === "select") view.content.intent = { selectedId: op.analysisId, rootAnalysisId: "analysis", confirmation: null };
      if (op.kind === "edit") { view.content.intent = { selectedId: "edited", rootAnalysisId: "analysis", confirmation: null };
        view.snapshots.push({ kind: "intent", value: { id: "edited", kind: "edit", analysis: op.analysis, binding, critiqueId: "critique" }, critique: null }); }
      if (op.kind === "review") { const key = body.operation.family === "summary" ? "summary" : op.difficulty; view.content[key] = { id: key, review: { id: `review-${key}` } }; }
      if (op.kind === "confirm") view.content.intent = { selectedId: op.analysisId, rootAnalysisId: "analysis", confirmation: { id: "confirmed-intent" } };
    }
    if (url.endsWith("/quality")) {
      operations.push("quality");
      view.quality[body.targetSnapshotId] = { targetSnapshotId: body.targetSnapshotId, scope: body.scope,
        status: body.status, criteria: body.criteria, adminNote: body.adminNote, revision: 1,
        editedRevisionId: body.status === "edited_then_use" ? body.targetSnapshotId : null, createdAt: "2026-09-24T00:00:00.000Z" };
      return route.fulfill({ json: { data: { outcome: "saved" } } });
    }
    if (url.endsWith("/resume")) {
      operations.push("resume"); view.status = "running"; view.stage = "content_review";
      const contentBinding = { transcript: { ...binding, version: view.version }, analysisId: "edited", intentConfirmationId: "confirmed-intent" };
      view.content.summary = { id: "summary", review: null }; view.content.child = { id: "child", review: null }; view.content.adult = { id: "adult", review: null };
      view.snapshots.push({ kind: "summary", value: { id: "summary", binding: contentBinding, draft: { paragraphs: [{ id: "paragraph", text: "서로 사랑하는 삶", intentClaimIds: ["claim"], evidence: analysis.centralMessage[0]!.evidence }] } } });
      for (const difficulty of ["child", "adult"]) view.snapshots.push({ kind: "candidate", value: { id: difficulty, difficulty, binding: contentBinding, statuses: { word: "use" },
        draft: { candidates: [{ id: "word", displayAnswer: "사랑", gridAnswer: "사랑", clue: "서로 아끼는 마음", phraseDescription: "설교의 핵심", selectionReason: "중심 메시지", sermonImportance: "핵심", difficultyReason: "익숙한 단어",
          grounding: { origin: "transcript", intentClaimIds: ["claim"], evidence: analysis.centralMessage[0]!.evidence } }] } } });
    }
    if (url.endsWith("/finish")) {
      operations.push("finish");
      if (unverified) {
        finalRequestKey = body.requestKey;
        expect(finalRequestKey).toMatch(/^[a-f0-9-]{36}$/u);
        return route.fulfill({ status: 202, json: { data: { outcome: "queued", requestKey: finalRequestKey } } });
      }
      view.status = "review_ready"; view.stage = "finish";
    }
    return route.fulfill({ json: { data: { outcome: "saved" } } });
  });
  await page.goto("/admin/tools");
  await page.getByLabel("설교 ID").fill("sermon-1");
  await page.getByRole("button", { name: "입력자료 불러오기" }).click();
  const panel = page.getByRole("region", { name: "설교 요약·문제 생성", exact: true });
  await expect(panel.getByText(/사용량 미확인 1회/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "분석·비판 검토 시작" })).toBeDisabled();
  await panel.getByLabel("예상 비용과 무료 대안을 확인하고 생성을 요청합니다.").check();
  await panel.getByRole("button", { name: "분석·비판 검토 시작" }).click();
  const comparison = panel.getByRole("article").filter({ has: page.getByRole("heading", { name: "비판 수정본", exact: true }) });
  await comparison.getByRole("button", { name: "이 자료 선택" }).click();
  const central = comparison.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^중심 메시지/u }) });
  if (unverified) {
    await expect(comparison.getByText("위치 미확인", { exact: true })).toHaveCount(2);
    await expect(central.getByRole("button", { name: "원문 위치 보기" })).toHaveCount(0);
    await expect(central.getByRole("link", { name: "영상 시각 열기" })).toHaveCount(0);
  } else await expect(central.getByRole("link", { name: "영상 시각 열기" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk&t=12s");
  await central.getByRole("button", { name: "근거 교체" }).click();
  const sourceText = central.getByRole("textbox", { name: "선택할 원문" });
  await expect(sourceText).toHaveValue("서로 사랑하세요 그리고 이웃을 도우세요");
  if (!unverified) await expect.poll(() => sourceText.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe("서로 사랑하세요");
  await sourceText.evaluate((element: HTMLTextAreaElement) => {
    const from = element.value.indexOf("이웃을 도우세요");
    element.setSelectionRange(from, from + "이웃을 도우세요".length);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await central.getByRole("button", { name: "선택한 구절로 근거 교체" }).click();
  await expect(central.getByText("이웃을 도우세요", { exact: true })).toBeVisible();
  await sourceText.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, "서로 사랑하세요".length);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await central.getByRole("button", { name: "선택한 구절을 근거에 추가" }).click();
  await expect(central.locator("blockquote")).toHaveCount(2);
  await central.getByRole("button", { name: "근거 삭제" }).last().click();
  await expect(central.locator("blockquote")).toHaveCount(1);
  await central.getByRole("textbox", { name: "내용", exact: true }).fill("검토하여 다듬은 중심 메시지");
  await expect(central.getByRole("combobox", { name: "내용 출처" })).toHaveValue("unresolved");
  await sourceText.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, "서로 사랑하세요".length);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await central.getByRole("button", { name: "선택한 구절을 근거에 추가" }).click();
  await central.getByRole("button", { name: "이 항목 추가" }).click();
  await expect(central.getByRole("textbox", { name: "내용", exact: true })).toHaveCount(2);
  await central.getByRole("button", { name: "이 항목 삭제" }).last().click();
  await comparison.getByRole("button", { name: "수정본 저장" }).click();
  const edited = panel.getByRole("article").filter({ has: page.getByRole("heading", { name: "직접 수정한 분석", exact: true }) });
  await edited.getByRole("combobox", { name: "평가" }).selectOption("edited_then_use");
  await edited.getByRole("textbox", { name: "검토 메모 (관리자 전용)" }).fill("원문 근거를 바꾸고 문장을 다듬음");
  await edited.getByRole("button", { name: "평가 저장" }).click();
  await edited.getByRole("button", { name: "설교 의도 확정" }).click();
  const dialog = page.getByRole("dialog", { name: "설교 의도 확정" });
  await expect(dialog.getByText(/다음 AI 호출 3회/)).toBeVisible();
  await dialog.getByRole("button", { name: "확정하고 다음 생성 시작" }).click();
  const finish = panel.getByRole("button", { name: "배치·최종 검사 (AI 비용 없음)", exact: true });
  await expect(finish).toBeDisabled();
  for (const title of ["설교 요약", "어린이 문제", "장년 문제"]) {
    const content = panel.getByRole("article").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await content.getByLabel("내용과 원문 근거를 검토했습니다.").check();
    await content.getByRole("button", { name: "이 내용 검수 완료", exact: true }).click();
  }
  await finish.click();
  if (unverified) {
    await expect(panel.getByText("저장된 내용의 배치와 최종 상태를 검사하고 있습니다. AI 비용은 발생하지 않습니다.")).toBeVisible();
    await expect(finish).toBeDisabled();
  }
  await expect(panel.getByText("최종 검사 완료", { exact: true })).toBeVisible();
  if (unverified) expect(finalPolls).toBe(2);
  expect(operations).toEqual(["select", "edit", "quality", "confirm", "resume", "review", "review", "review", "finish"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
