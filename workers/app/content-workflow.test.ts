import { env, exports } from "cloudflare:workers";
import { introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generationDb as db, seedGenerationContext } from "./test/generation-storage-fixture";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { sendContentDispatch, type ContentWorkflowParams } from "../_shared/services/content-generation";
import { requestIntent } from "../_shared/services/content-intent-generation";
import { createGenerationLifecycleStore } from "../_shared/repositories/generation-lifecycle-store";
import { raw, analysis, clearCritique, evidence } from "./test/generation-domain-fixture";
import { createAccessFixture } from "./test/access-fixture";
import { app, type AppBindings } from "./app";
import { finalCheckInstanceId, type ContentWorkflowMessage } from "../_shared/services/content-final-check-workflow";

const bindings = env as Env & { CONTENT_WORKFLOW: Workflow<ContentWorkflowParams> };
afterEach(() => { vi.restoreAllMocks(); });
describe("actual local Content Workflow through administrator API", () => {
  it("receives one authenticated request and persists a draft without publishing", async () => {
    const owner = await seedGenerationContext(), requestKey = crypto.randomUUID();
    const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript",
      sourceCoverage: "full_transcript", rawTranscriptText: "합성 입력" });
    if (source.outcome !== "validated") throw new Error("fixture");
    await createSermonInputService(createSermonInputStore(db)).importPreparedManual(owner.sermonId, 0, source.source,
      { kind: "human", adminId: "a".repeat(64), now: new Date().toISOString() });
    const access = await createAccessFixture(new Date());
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (request) => {
      const url = request instanceof Request ? request.url : String(request);
      if (url === "https://test-team.cloudflareaccess.com/cdn-cgi/access/certs") return Response.json(access.jwks);
      if (url !== "https://api.openai.com/v1/responses") throw new Error("NETWORK_DISABLED_IN_TEST");
      return Response.json({ id: "synthetic-response", model: "gpt-5.6-terra", status: "completed",
        usage: { input_tokens: 100, output_tokens: 30, input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 10 } },
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft: { format: "plain_text", text: "합성 교정" } }) }] }],
      });
    });
    const instance = await introspectWorkflowInstance(bindings.CONTENT_WORKFLOW, requestKey);
    try {
      const response = await exports.default.fetch(new Request(`https://example.com/api/admin/sermons/${owner.sermonId}/generation/correction`, {
        method: "POST", headers: { "Cf-Access-Jwt-Assertion": access.token, Origin: "https://example.com", "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey, quizSetId: owner.quizSetId, expectedInputVersion: 1 }),
      }));
      expect(response.status).toBe(202);
      await instance.waitForStatus("complete");
      expect(await instance.getOutput()).toMatchObject({ outcome: "saved", jobId: requestKey, proposalId: `proposal-${requestKey}` });
      expect(fetcher.mock.calls.filter(([url]) => String(url) === "https://api.openai.com/v1/responses")).toHaveLength(1);
      const status = await exports.default.fetch(new Request(`https://example.com/api/admin/sermons/${owner.sermonId}/generation/${requestKey}`, {
        headers: { "Cf-Access-Jwt-Assertion": access.token },
      }));
      expect(status.status).toBe(200);
      const data = await status.json();
      expect(data).toMatchObject({ data: { status: "review_ready", proposalId: `proposal-${requestKey}`, costStatus: "observed" } });
      expect(JSON.stringify(data)).not.toContain("합성 입력");
      const repeated = await exports.default.fetch(new Request(`https://example.com/api/admin/sermons/${owner.sermonId}/generation/correction`, {
        method: "POST", headers: { "Cf-Access-Jwt-Assertion": access.token, Origin: "https://example.com", "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey, quizSetId: owner.quizSetId, expectedInputVersion: 1 }),
      }));
      expect(repeated.status).toBe(202);
      expect(fetcher.mock.calls.filter(([url]) => String(url) === "https://api.openai.com/v1/responses")).toHaveLength(1);
      const wrongOwner = await exports.default.fetch(new Request(`https://example.com/api/admin/sermons/other-sermon/generation/${requestKey}`, {
        headers: { "Cf-Access-Jwt-Assertion": access.token },
      }));
      expect(wrongOwner.status).toBe(404);
      const availability = await exports.default.fetch(new Request(`https://example.com/api/admin/sermons/${owner.sermonId}/generation/correction`, {
        headers: { "Cf-Access-Jwt-Assertion": access.token },
      }));
      expect(await availability.json()).toEqual({ data: { enabled: true, quizSetId: owner.quizSetId, latestJobId: requestKey } });
      expect(await db.prepare("SELECT status FROM quiz_sets WHERE id=?").bind(owner.quizSetId).first()).toEqual({ status: "draft" });
    } finally { await instance.dispose(); }
  });
  it("runs the private initial-intent entry through real Workflow and stops at human review", async () => {
    const owner = await seedGenerationContext(), store = createSermonInputStore(db), service = createSermonInputService(store);
    const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript",
      sourceCoverage: "full_transcript", rawTranscriptText: raw });
    if (source.outcome !== "validated") throw new Error("fixture");
    const actor = { kind: "human", adminId: "a".repeat(64), now: new Date().toISOString() } as const;
    await service.importPreparedManual(owner.sermonId, 0, source.source, actor);
    const head = (await store.head(owner.sermonId))!;
    await service.execute(owner.sermonId, { action: "confirm", expectedVersion: 1, sourceId: head.source_id,
      documentId: head.document_id, documentSha256: head.document_sha256, reviewed: true }, actor);
    const requested = await requestIntent(db, owner.sermonId, { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId,
      expectedVersion: 2 }, actor.adminId);
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async request => {
      if (String(request) !== "https://api.openai.com/v1/responses") throw new Error("NETWORK_DISABLED_IN_TEST");
      const draft = ++calls === 1 ? analysis() : { analysis: analysis(), critique: clearCritique };
      return Response.json({ id: "synthetic-intent", model: "gpt-5.6-terra", status: "completed",
        usage: { input_tokens: 100, output_tokens: 30, input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 10 } },
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft }) }] }] });
    });
    const instance = await introspectWorkflowInstance(bindings.CONTENT_WORKFLOW, requested.jobId);
    try {
      expect((await sendContentDispatch(db, bindings.CONTENT_WORKFLOW, requested.dispatchId)).outcome).toBe("sent");
      await instance.waitForStatus("complete");
      expect(await instance.getOutput()).toEqual({ outcome: "awaiting_intent_review" });
      expect(calls).toBe(2);
      const job = await createGenerationLifecycleStore(db).readJob(requested.jobId);
      expect(job.outcome === "present" && job.value.status).toBe("awaiting_intent_review");
      expect(await db.prepare("SELECT status FROM quiz_sets WHERE id=?").bind(owner.quizSetId).first()).toEqual({ status: "draft" });
      expect(await db.prepare("SELECT intent_confirmation_event_id FROM sermon_content_current WHERE sermon_id=?")
        .bind(owner.sermonId).first()).toEqual({ intent_confirmation_event_id: null });
    } finally { await instance.dispose(); }
  });
  it.each([false, true])("keeps full Workflow alive for authenticated review/resume and completes without publication (background final check=%s)", async (background) => {
    const owner = await seedGenerationContext(), store = createSermonInputStore(db), service = createSermonInputService(store);
    const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript", rawTranscriptText: raw });
    if (source.outcome !== "validated") throw new Error("fixture");
    const actor = { kind: "human", adminId: "a".repeat(64), now: new Date().toISOString() } as const;
    await service.importPreparedManual(owner.sermonId, 0, source.source, actor);
    const head = (await store.head(owner.sermonId))!;
    await service.execute(owner.sermonId, { action: "confirm", expectedVersion: 1, sourceId: head.source_id, documentId: head.document_id, documentSha256: head.document_sha256, reviewed: true }, actor);
    const access = await createAccessFixture(new Date()), key = crypto.randomUUID();
    const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async request => {
      const url = request instanceof Request ? request.url : String(request);
      if (url.endsWith("/cdn-cgi/access/certs")) return Response.json(access.jwks);
      if (url !== "https://api.openai.com/v1/responses") throw new Error("NETWORK_DISABLED_IN_TEST");
      calls++;
      const draft = calls === 1 ? analysis() : calls === 2 ? { analysis: analysis(), critique: clearCritique } : calls === 3 ?
        { paragraphs: [{ id: "p", text: "합성 요약", intentClaimIds: ["centralMessage"], evidence: [evidence()] }] } :
        { candidates: ["가나다", "라마바", "가사라", "다아바", "허호"].map((answer, i) => ({ id: `word-${i}`, displayAnswer: answer, gridAnswer: answer,
          clue: `난이도 ${calls} 단서 ${i}`, phraseDescription: "설명", selectionReason: "근거", sermonImportance: "핵심", difficultyReason: "난도",
          grounding: { origin: "transcript", intentClaimIds: ["centralMessage"], evidence: [evidence()] } })) };
      return Response.json({ id: "synthetic", model: "gpt-5.6-terra", status: "completed", usage: { input_tokens: 100, output_tokens: 30, input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 10 } },
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft }) }] }] });
    });
    async function post(path: string, body: unknown, origin = "https://example.com") {
      const request = new Request(`https://example.com/api/admin/sermons/${owner.sermonId}/generation/${path}`, { method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": access.token, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return background ? app.request(request, undefined, { ...(env as AppBindings), CONTENT_FINAL_CHECK_WORKFLOW_ENABLED: "true" }) : exports.default.fetch(request);
    }
    const instance = await introspectWorkflowInstance(bindings.CONTENT_WORKFLOW, key);
    try {
      const request = { requestKey: key, quizSetId: owner.quizSetId, expectedVersion: 2, selection: { child: { options, index: 0 }, adult: { options, index: 0 } } };
      expect((await post("content", request, "https://foreign.example")).status).toBe(403);
      expect(calls).toBe(0);
      expect((await post("content", request)).status).toBe(202);
      expect(await instance.waitForStepResult({ name: `generate-dispatch-${key}` })).toEqual({ outcome: "awaiting_intent_review" });
      for (const task of ["intent_analysis", "intent_critique"]) {
        expect(await instance.waitForStepResult({ name: `generate-dispatch-${key}-task-${task}` })).toEqual({ outcome: "continue" });
      }
      expect(calls).toBe(2);
      expect((await post(`${key}/resume`, {})).status).toBe(200);
      expect(calls).toBe(2);
      const critiqueId = `result-${key}-intent_critique`;
      for (const [index, kind] of (["select", "confirm"] as const).entries()) {
        const response = await post(`${key}/review`, { requestKey: crypto.randomUUID(), expectedVersion: 4 + index, operation: { family: "intent", operation: { kind, analysisId: critiqueId } } });
        expect(response.status).toBe(200);
      }
      expect((await post(`${key}/resume`, {})).status).toBe(200);
      expect(await instance.waitForStepResult({ name: `generate-resume-${key}-2` })).toEqual({ outcome: "awaiting_content_review" });
      for (const task of ["summary", "child_candidates", "adult_candidates"]) {
        expect(await instance.waitForStepResult({ name: `generate-resume-${key}-2-task-${task}` })).toEqual({ outcome: "continue" });
      }
      expect(calls).toBe(5);
      for (const [index, family] of (["summary", "child", "adult"] as const).entries()) {
        const operation = family === "summary" ? { family: "summary", operation: { kind: "review", summaryId: `result-${key}-summary` } } :
          { family: "candidate", operation: { kind: "review", difficulty: family, poolId: `result-${key}-${family}_candidates` } };
        expect((await post(`${key}/review`, { requestKey: crypto.randomUUID(), expectedVersion: 9 + index, operation })).status).toBe(200);
      }
      if (background) {
        const requestKey = crypto.randomUUID();
        const final = await introspectWorkflowInstance(bindings.CONTENT_WORKFLOW as Workflow<ContentWorkflowMessage>, await finalCheckInstanceId(key, requestKey));
        try {
          for (let duplicate = 0; duplicate < 2; duplicate++) {
            const done = await post(`${key}/finish`, { requestKey });
            expect(done.status).toBe(202);
            expect(await done.json()).toEqual({ data: { outcome: "queued", requestKey } });
          }
          await final.waitForStatus("complete");
          expect(await final.getOutput()).toEqual({ outcome: "review_ready" });
          const status = await app.request(`https://example.com/api/admin/sermons/${owner.sermonId}/generation/${key}/final-check/${requestKey}`,
            { headers: { "Cf-Access-Jwt-Assertion": access.token } }, { ...(env as AppBindings), CONTENT_FINAL_CHECK_WORKFLOW_ENABLED: "true" });
          expect(status.status).toBe(200);
          expect(status.headers.get("Cache-Control")).toBe("private, no-store");
          expect(await status.json()).toEqual({ data: { outcome: "review_ready", requestKey } });
          const path = `https://example.com/api/admin/sermons/${owner.sermonId}/generation/${key}/final-check/${requestKey}`;
          const configured = { ...(env as AppBindings), CONTENT_FINAL_CHECK_WORKFLOW_ENABLED: "true" };
          expect((await app.request(path, undefined, configured)).status).toBe(401);
          expect((await app.request(path.replace(owner.sermonId, crypto.randomUUID()),
            { headers: { "Cf-Access-Jwt-Assertion": access.token } }, configured)).status).toBe(409);
          expect((await post(`${key}/finish`, { requestKey }, "https://foreign.example")).status).toBe(403);
        } finally { await final.dispose(); }
      } else {
        const done = await post(`${key}/finish`, {});
        expect(done.status).toBe(200);
        expect(await done.json()).toMatchObject({ data: { outcome: "review_ready" } });
      }
      await instance.waitForStatus("complete");
      expect(await instance.getOutput()).toEqual({ outcome: "review_ready" });
      const status = await exports.default.fetch(new Request(`https://example.com/api/admin/sermons/${owner.sermonId}/generation/content`, { headers: { "Cf-Access-Jwt-Assertion": access.token } }));
      expect(status.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await status.json()).toMatchObject({ data: { status: "review_ready", jobCostMicroUsd: 2620, jobUnknownCalls: 0, preview: { summary: { text: "합성 요약" } } } });
      expect(calls).toBe(5);
      expect(await db.prepare("SELECT status FROM quiz_sets WHERE id=?").bind(owner.quizSetId).first()).toEqual({ status: "draft" });
    } finally { await instance.dispose(); }
  }, 90_000);

});
