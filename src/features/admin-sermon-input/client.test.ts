import { adminContentViewSchema } from "../../../shared/api/admin-content-generation";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  commandAdminSermonInput,
  loadAdminSermonInput,
  loadAdminSermonInputComparison,
  loadAdminSermonInputCorrection,
  loadAdminSermonInputHistory,
  loadContentFinalCheck,
  loadContentGeneration,
  mutateContentGeneration,
} from "./client";

const hash = "a".repeat(64);
const requestId = "11111111-1111-4111-8111-111111111111";
const current = {
  version: 2,
  sourceType: "caption_plain" as const,
  sourceId: "source-1",
  documentId: "document-2",
  documentSha256: hash,
  confirmationId: null,
  source: { sourceMode: "manual_paste" as const, manualSourceKind: "youtube_visible_transcript" as const, sourceCoverage: "full_transcript" as const },
  content: { format: "plain_text" as const, text: "현재 본문" },
};

afterEach(() => vi.unstubAllGlobals());

describe("administrator sermon input browser client", () => {
  it("retains the queued final-check identity and rejects private or malformed status responses", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { outcome: "queued", requestKey: requestId } }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ data: { outcome: "review_ready", requestKey: requestId } }))
      .mockResolvedValueOnce(Response.json({ data: { outcome: "review_ready", requestKey: requestId, privateGraph: "PRIVATE_CANARY" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(mutateContentGeneration("sermon", "finish", { requestKey: requestId }, "job")).resolves.toMatchObject({ ok: true, data: { data: { outcome: "queued", requestKey: requestId } } });
    await expect(loadContentFinalCheck("sermon", "job", requestId)).resolves.toMatchObject({ ok: true, data: { data: { outcome: "review_ready" } } });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin" });
    await expect(loadContentFinalCheck("sermon", "job", requestId)).resolves.toMatchObject({ ok: false });
  });
  it("reads current and metadata history with private no-store requests", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      void _init;
      const url = String(input);
      return new Response(JSON.stringify(url.endsWith("/history") ? {
        data: { history: { head: { version: 2, sourceType: "caption_plain", sourceId: "source-1", documentId: "document-2", confirmationId: null }, events: [
          { eventId: "source-1", version: 1, kind: "source", documentId: "source-1", parentDocumentId: null, relatedId: null, createdAt: "2026-09-17T00:00:00.000Z" },
          { eventId: "document-2", version: 2, kind: "edit", documentId: "document-2", parentDocumentId: "source-1", relatedId: null, createdAt: "2026-09-17T01:00:00.000Z" },
        ] } },
      } : { data: { input: current } }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(loadAdminSermonInput("sermon-1")).resolves.toEqual({ ok: true, data: current });
    await expect(loadAdminSermonInputHistory("sermon-1")).resolves.toMatchObject({ ok: true, data: { events: [{ kind: "source" }, { kind: "edit" }] } });
    for (const call of fetch.mock.calls) {
      expect(call[1]).toMatchObject({ cache: "no-store", credentials: "same-origin", method: "GET" });
    }
  });

  it("requests only the selected two documents and selected proposal detail", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.includes("/corrections/")
        ? { data: { correction: { proposal: { proposalId: "proposal-1", version: 3, sourceId: "source-1", baseDocumentId: "document-2", createdAt: "2026-09-17T02:00:00.000Z", items: [{ id: "item-1", segmentId: null, start: null, duration: null, from: 0, to: 2, originalText: "현재", proposedText: "고친", changeType: "recognition", reason: "오타", confidence: 1, riskFlags: [], contextBefore: "", contextAfter: " 본문" }] }, decisions: [] } } }
        : { data: { comparison: { sourceId: "source-1", left: { documentId: "source-1", content: { format: "plain_text", text: "원본" } }, right: { documentId: "document-2", content: current.content } } } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);

    await expect(loadAdminSermonInputComparison("sermon-1", { sourceId: "source-1", leftDocumentId: "source-1", rightDocumentId: "document-2" })).resolves.toMatchObject({ ok: true });
    await expect(loadAdminSermonInputCorrection("sermon-1", "proposal-1")).resolves.toMatchObject({ ok: true, data: { proposal: { proposalId: "proposal-1" } } });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("sourceId=source-1&leftDocumentId=source-1&rightDocumentId=document-2");
    expect(String(fetch.mock.calls[1]?.[0]).endsWith("/corrections/proposal-1")).toBe(true);
  });

  it("keeps stable conflict details and rejects malformed success data", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "INPUT_CONFLICT", message: "최신 내용을 확인해 주세요.", requestId } }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { input: { ...current, privateCanary: "PRIVATE_CANARY" } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(commandAdminSermonInput("sermon-1", { action: "confirm", expectedVersion: 2, sourceId: "source-1", documentId: "document-2", documentSha256: hash, reviewed: true })).resolves.toEqual({
      ok: false,
      error: { code: "INPUT_CONFLICT", message: "최신 내용을 확인해 주세요.", requestId, status: 409 },
    });
    await expect(loadAdminSermonInput("sermon-1")).resolves.toMatchObject({ ok: false, error: { code: "CLIENT_UNAVAILABLE" } });
  });
});


describe("progressive content requests", () => {
  const state = adminContentViewSchema.parse({ enabled: false, quizSetId: "quiz", jobId: "job", version: 4,
    viewRevision: "revision-4", status: "review_ready", stage: "finish", content: { state: "absent" }, snapshots: [],
    weekCostMicroUsd: 0, weekUnknownCalls: 0, jobCostMicroUsd: 0, jobUnknownCalls: 0, preview: null });
  it("shows state and costs before a slow placement request without requesting the aggregate endpoint", async () => {
    let finishPlacement!: (response: Response) => void;
    const placement = new Promise<Response>(resolve => { finishPlacement = resolve; });
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin" });
      const query = new URL(url, "https://example.invalid").searchParams;
      const section = query.get("section");
      expect(section).toBeTruthy();
      if (section === "content") expect(query.get("before")).toBe("12");
      else expect(query.has("before")).toBe(false);
      if (section === "placement") return placement;
      return Response.json({ data: { ...state, weekCostMicroUsd: section === "costs" ? 2620 : 0 } });
    });
    vi.stubGlobal("fetch", fetch);
    const progress = vi.fn();
    const done = loadContentGeneration("sermon", undefined, 12, progress);
    await vi.waitFor(() => expect(progress.mock.calls.some(call => call[1].includes("costs"))).toBe(true));
    expect(progress.mock.calls[0]?.[1]).toEqual(["state"]);
    expect(progress.mock.calls.at(-1)?.[0].weekCostMicroUsd).toBe(2620);
    expect(progress.mock.calls.at(-1)?.[1]).not.toContain("placement");
    finishPlacement(Response.json({ data: state }));
    await expect(done).resolves.toMatchObject({ ok: true, data: { data: { weekCostMicroUsd: 2620 } } });
    expect(fetch).toHaveBeenCalledTimes(5);
  });
  it("rejects a changed view revision instead of combining different saves", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({ data: {
      ...state, viewRevision: url.includes("section=placement") ? "revision-5" : state.viewRevision } })));
    const progress = vi.fn();
    await expect(loadContentGeneration("sermon", undefined, undefined, progress)).resolves.toMatchObject({ ok: false,
      error: { code: "CONTENT_DISPLAY_CHANGED" } });
    expect(progress.mock.calls.every(call => call[0].viewRevision === "revision-4")).toBe(true);
  });
  it("keeps completed sections available on failure and never retries generation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("section=placement")
      ? Response.json({ error: { code: "UNAVAILABLE", message: "배치 조회 실패", requestId } }, { status: 409 })
      : Response.json({ data: state })));
    const progress = vi.fn();
    await expect(loadContentGeneration("sermon", undefined, undefined, progress)).resolves.toMatchObject({ ok: false });
    expect(progress).toHaveBeenCalled();
    expect(progress.mock.calls[0]?.[0]).toEqual(state);
  });
});
