import { expect, test } from "@playwright/test";

const hash = "a".repeat(64);
const requestId = "11111111-1111-4111-8111-111111111111";

const current = {
  version: 4,
  sourceType: "caption_plain",
  sourceId: "source-1",
  documentId: "document-current",
  documentSha256: hash,
  confirmationId: null,
  source: { sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript" },
  content: { format: "plain_text", text: "처음 바꾼 말씀입니다" },
};

const history = {
  head: { version: 4, sourceType: "caption_plain", sourceId: "source-1", documentId: "document-current", confirmationId: null },
  events: [
    { eventId: "source-1", version: 1, kind: "source", documentId: "source-1", parentDocumentId: null, relatedId: null, createdAt: "2026-09-17T00:00:00.000Z" },
    { eventId: "document-current", version: 2, kind: "edit", documentId: "document-current", parentDocumentId: "source-1", relatedId: null, createdAt: "2026-09-17T01:00:00.000Z" },
    { eventId: "proposal-1", version: 3, kind: "proposal", documentId: "document-current", parentDocumentId: "document-current", relatedId: null, createdAt: "2026-09-17T02:00:00.000Z" },
    { eventId: "decision-1", version: 4, kind: "decision", documentId: "document-current", parentDocumentId: "document-current", relatedId: "proposal-1", createdAt: "2026-09-17T03:00:00.000Z" },
  ],
};

test("AI correction preserves one request after a lost response and opens human review", async ({ page }) => {
  let jobId: string | null = null, posts = 0;
  await page.route("**/api/admin/sermons/sermon-1/generation/**", async route => {
    if (route.request().method() === "POST") {
      posts++;
      jobId = route.request().postDataJSON().requestKey;
      await route.abort("failed");
      return;
    }
    if (route.request().url().endsWith("/correction")) {
      await route.fulfill({ json: { data: { enabled: true, quizSetId: "quiz-1", latestJobId: jobId } } });
      return;
    }
    await route.fulfill({ json: { data: { jobId, status: "review_ready", stage: "finish", proposalId: "proposal-1",
      costStatus: "observed", usage: [{ model: "gpt-5.6-terra", inputTokens: 100, outputTokens: 30, reasoningTokens: 10,
        cachedInputTokens: 20, estimatedCostMicroUsd: 524, pricingVersion: "test" }] } } });
  });
  await page.route("**/api/admin/sermons/sermon-1/input**", async route => {
    const url = route.request().url();
    if (url.endsWith("/history")) { await route.fulfill({ json: { data: { history } } }); return; }
    if (url.includes("/corrections/")) {
      await route.fulfill({ json: { data: { correction: { proposal: { kind: "correction_document_v1", proposalId: "proposal-1",
        version: 3, sourceId: "source-1", baseDocumentId: "document-current", createdAt: "2026-09-17T02:00:00.000Z",
        content: { format: "plain_text", text: "AI 교정 검토용 문서" } } } } } }); return;
    }
    await route.fulfill({ json: { data: { input: current } } });
  });
  await page.goto("/admin/tools");
  await page.getByLabel("설교 ID").fill("sermon-1");
  await page.getByRole("button", { name: "입력자료 불러오기" }).click();
  await page.getByRole("button", { name: "AI 교정 요청", exact: true }).click();
  await expect(page.getByRole("button", { name: "AI 교정 요청", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "교정 상태 확인" }).click();
  await expect(page.getByText("관측 사용량 기준 예상 비용: USD 0.000524")).toBeVisible();
  await page.getByRole("button", { name: "생성된 교정 문서 검토" }).click();
  await expect(page.getByRole("textbox", { name: "교정 문서", exact: true })).toHaveValue("AI 교정 검토용 문서");
  expect(posts).toBe(1);
  await expect(page.getByRole("button", { name: "현재 본문 확정", exact: true })).toBeDisabled();
});

test("administrator loads current input, calculates diff after two bodies, and opens only the selected proposal", async ({ page }) => {
  let correctionReads = 0;
  let version = 4;
  const commands: unknown[] = [];
  await page.route("**/api/admin/sermons/sermon-1/input**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "PATCH") {
      const command = request.postDataJSON();
      commands.push(command);
      version = 5;
      await route.fulfill({ json: { data: { head: { eventId: "decision-2", version, sourceType: "caption_plain", sourceId: "source-1", documentId: "document-current", documentSha256: hash, confirmationId: null } } } });
      return;
    }
    if (url.pathname.endsWith("/history")) {
      await route.fulfill({ json: { data: { history: version === 4 ? history : {
        head: { ...history.head, version },
        events: [...history.events, { eventId: "decision-2", version, kind: "decision", documentId: "document-current", parentDocumentId: "document-current", relatedId: "proposal-1", createdAt: "2026-09-17T04:00:00.000Z" }],
      } } } });
      return;
    }
    if (url.pathname.endsWith("/comparison")) {
      await route.fulfill({ json: { data: { comparison: { sourceId: "source-1", left: { documentId: url.searchParams.get("leftDocumentId"), content: { format: "plain_text", text: "처음 말씀입니다" } }, right: { documentId: url.searchParams.get("rightDocumentId"), content: current.content } } } } });
      return;
    }
    if (url.pathname.includes("/corrections/")) {
      correctionReads++;
      await route.fulfill({ json: { data: { correction: { proposal: { proposalId: "proposal-1", version: 3, sourceId: "source-1", baseDocumentId: "document-current", createdAt: "2026-09-17T02:00:00.000Z", items: [{ id: "item-1", segmentId: null, start: null, duration: null, from: 3, to: 5, originalText: "바꾼", proposedText: "고친", changeType: "recognition", reason: "자막 오타", confidence: 1, riskFlags: [], contextBefore: "처음 ", contextAfter: " 말씀입니다" }] }, decisions: [] } } } });
      return;
    }
    await route.fulfill({ json: { data: { input: { ...current, version } } } });
  });

  await page.goto("/admin/tools");
  await page.getByLabel("설교 ID").fill("sermon-1");
  await page.getByRole("button", { name: "입력자료 불러오기" }).click();
  await expect(page.getByRole("heading", { name: "붙여넣은 자막" })).toBeVisible();

  await page.getByRole("button", { name: "선택한 본문 비교" }).click();
  await expect(page.locator("ins").filter({ hasText: "바꾼" })).toBeVisible();
  await expect(page.getByLabel("선택한 두 입력자료의 변경 비교")).toContainText("처음 바꾼 말씀입니다");

  await page.getByLabel("검토할 교정 제안").selectOption("proposal-1");
  expect(correctionReads).toBe(0);
  await page.getByRole("button", { name: "선택 제안 상세 보기" }).click();
  await expect(page.getByText("자막 오타")).toBeVisible();
  expect(correctionReads).toBe(1);

  await page.getByLabel("검토 결정").selectOption("accepted");
  await page.getByRole("button", { name: "선택한 결정 저장" }).click();
  await expect.poll(() => commands).toContainEqual(expect.objectContaining({ action: "decide_corrections", proposalId: "proposal-1" }));
  await expect(page.locator("body")).not.toContainText("PRIVATE_CANARY");
});

test("administrator previews, edits, adopts, and separately confirms a correction document", async ({ page }) => {
  let currentInput = { ...current, version: 3, confirmationId: "old-confirmation" as string | null };
  let currentHistory = { head: { ...history.head, version: 3, confirmationId: "old-confirmation" as string | null },
    events: history.events.slice(0, 3) };
  const commands: Array<Record<string, unknown>> = [];
  await page.route("**/api/admin/sermons/sermon-1/input**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "PATCH") {
      const command = request.postDataJSON() as Record<string, unknown>;
      commands.push(command);
      const isApply = command.action === "apply_correction_document";
      const version = currentInput.version + 1;
      const eventId = isApply ? "merge-document" : "confirm-document";
      const documentId = isApply ? eventId : currentInput.documentId;
      const confirmationId = isApply ? null : eventId;
      currentHistory = { head: { ...currentHistory.head, version, documentId, confirmationId },
        events: [...currentHistory.events, { eventId, version, kind: isApply ? "merge" : "confirm",
          documentId, parentDocumentId: currentInput.documentId, relatedId: isApply ? "proposal-1" : null,
          createdAt: "2026-09-17T04:00:00.000Z" }] };
      currentInput = { ...currentInput, version, documentId, confirmationId,
        content: isApply ? command.content as typeof current.content : currentInput.content };
      await route.fulfill({ json: { data: { head: { eventId, version, sourceType: current.sourceType,
        sourceId: current.sourceId, documentId, documentSha256: hash, confirmationId } } } });
      return;
    }
    if (url.pathname.endsWith("/history")) return route.fulfill({ json: { data: { history: currentHistory } } });
    if (url.pathname.includes("/corrections/")) return route.fulfill({ json: { data: { correction: {
      proposal: { kind: "correction_document_v1", proposalId: "proposal-1", version: 3,
        sourceId: "source-1", baseDocumentId: "document-current", createdAt: "2026-09-17T02:00:00.000Z",
        content: { format: "plain_text", text: "교정된 문서 전체" } },
    } } } });
    return route.fulfill({ json: { data: { input: currentInput } } });
  });

  await page.goto("/admin/tools");
  await page.getByLabel("설교 ID").fill("sermon-1");
  await page.getByRole("button", { name: "입력자료 불러오기" }).click();
  await page.getByLabel("검토할 교정 제안").selectOption("proposal-1");
  await page.getByRole("button", { name: "선택 제안 상세 보기" }).click();
  await page.getByLabel("교정 문서").fill("관리자가 고친 문서");
  await page.getByRole("button", { name: "이 교정본 사용" }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ action: "apply_correction_document", proposalId: "proposal-1",
    reviewed: true, content: { format: "plain_text", text: "관리자가 고친 문서" } });
  await expect(page.getByText("확정 필요", { exact: true })).toBeVisible();
  await page.getByLabel("현재 본문을 검토했습니다.").check();
  await page.getByRole("button", { name: "현재 본문 확정" }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toMatchObject({ action: "confirm", reviewed: true });
});

test("administrator stores first pastor material and never offers edit, restore, or correction controls", async ({ page }) => {
  let saved = false;
  let posted: unknown;
  const manuscript = {
    version: 1,
    sourceType: "sermon_manuscript",
    sourceId: "source-manuscript",
    documentId: "source-manuscript",
    documentSha256: hash,
    confirmationId: null,
    source: { sourceMode: "sermon_notes", manualSourceKind: "sermon_manuscript", sourceCoverage: "partial_notes" },
    content: { format: "plain_text", text: "받은 원고" },
  };
  await page.route("**/api/admin/sermons/sermon-2/input**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      posted = request.postDataJSON();
      saved = true;
      await route.fulfill({ json: { data: { input: manuscript } } });
      return;
    }
    if (url.pathname.endsWith("/history")) {
      await route.fulfill({ json: { data: { history: saved ? { head: { version: 1, sourceType: "sermon_manuscript", sourceId: "source-manuscript", documentId: "source-manuscript", confirmationId: null }, events: [{ eventId: "source-manuscript", version: 1, kind: "source", documentId: "source-manuscript", parentDocumentId: null, relatedId: null, createdAt: "2026-09-17T00:00:00.000Z" }] } : null } } });
      return;
    }
    await route.fulfill({ json: { data: { input: saved ? manuscript : null } } });
  });

  await page.goto("/admin/tools");
  await page.getByLabel("설교 ID").fill("sermon-2");
  await page.getByRole("button", { name: "입력자료 불러오기" }).click();
  await page.getByLabel("자료 종류").selectOption("sermon_manuscript");
  await page.getByLabel("입력자료 본문").fill("받은 원고");
  await page.getByRole("button", { name: "최초 원본 저장" }).click();

  await expect(page.getByRole("heading", { name: "목사님 제공 설교 원고" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "받은 자료 그대로 사용" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "자막 직접 수정" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "자막 교정 검토" })).toHaveCount(0);
  expect(posted).toEqual({ expectedVersion: 0, sourceMode: "sermon_notes", manualSourceKind: "sermon_manuscript", sourceCoverage: "partial_notes", rawTranscriptText: "받은 원고" });
});

test("a stale command reloads current input and shows the stable conflict message", async ({ page }) => {
  let currentReads = 0;
  await page.route("**/api/admin/sermons/sermon-1/input**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "PATCH") {
      await route.fulfill({ status: 409, json: { error: { code: "INPUT_CONFLICT", message: "다른 저장이 먼저 처리됐습니다. 최신 내용을 확인해 주세요.", requestId } } });
      return;
    }
    if (url.pathname.endsWith("/history")) await route.fulfill({ json: { data: { history } } });
    else {
      currentReads++;
      await route.fulfill({ json: { data: { input: current } } });
    }
  });

  await page.goto("/admin/tools");
  await page.getByLabel("설교 ID").fill("sermon-1");
  await page.getByRole("button", { name: "입력자료 불러오기" }).click();
  await page.getByLabel("현재 본문을 검토했습니다.").check();
  await page.getByRole("button", { name: "현재 본문 확정" }).click();
  await expect(page.getByRole("region", { name: "설교 입력자료 검토", exact: true })
    .getByRole("alert").filter({ hasText: "다른 저장이 먼저 처리됐습니다" })).toBeVisible();
  expect(currentReads).toBeGreaterThanOrEqual(2);
});
