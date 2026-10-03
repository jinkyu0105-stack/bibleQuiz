import { afterEach, describe, expect, it, vi } from "vitest";

import { submissionRequestSchema, submissionResultSchema } from "../../../shared/api/submission";
import {
  deleteOwnSubmission,
  generateUuidV7,
  prepareSubmissionSession,
  readOwnSubmission,
  submissionFingerprint,
  submitQuiz,
} from "./submission-client";

afterEach(() => vi.unstubAllGlobals());

const request = submissionRequestSchema.parse({
  revision: 1,
  idempotencyKey: "01924f8e-7b2a-7f1c-8f3a-123456789abc",
  turnstileToken: "test-token",
  name: "은혜",
  comment: "감사합니다",
  consent: true,
  cells: { r0c0: "가" },
});
const result = submissionResultSchema.parse({
  submissionId: "submission-1",
  submittedAt: "2026-09-01T00:00:00.000Z",
  correctCells: 1,
  totalCells: 2,
  correctWords: 0,
  totalWords: 1,
  scoreBasisPoints: 5_000,
  correctnessMask: "10",
  canRevealAnswer: true,
  solution: { cells: { r0c0: "가", r0c1: "나" }, entries: { entry: "가나" } },
});

describe("public submission client", () => {
  it("prepares only the strict same-origin session request", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      data: { expiresAt: "2027-03-01T00:00:00.000Z" },
    }));
    vi.stubGlobal("fetch", fetcher);
    await expect(prepareSubmissionSession()).resolves.toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledWith("/api/session", expect.objectContaining({
      body: "{}",
      cache: "no-store",
      credentials: "same-origin",
      method: "POST",
    }));
  });

  it("shares only an in-flight session preparation and allows a later refresh", async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      release = resolve;
    }));
    vi.stubGlobal("fetch", fetcher);
    const first = prepareSubmissionSession();
    const second = prepareSubmissionSession();
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(Response.json({ data: { expiresAt: "2027-03-01T00:00:00.000Z" } }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, expiresAt: "2027-03-01T00:00:00.000Z" },
      { ok: true, expiresAt: "2027-03-01T00:00:00.000Z" },
    ]);

    const third = prepareSubmissionSession();
    expect(fetcher).toHaveBeenCalledTimes(2);
    release(Response.json({ data: { expiresAt: "2027-03-02T00:00:00.000Z" } }));
    await expect(third).resolves.toEqual({ ok: true, expiresAt: "2027-03-02T00:00:00.000Z" });
  });

  it("validates a successful result and sends no client score fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: result }));
    vi.stubGlobal("fetch", fetcher);
    await expect(submitQuiz({ slug: "2026-09-01-test01", difficulty: "child" }, request))
      .resolves.toEqual({ ok: true, data: result });
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(sent).toEqual(request);
    for (const key of ["score", "rank", "correctness", "solution"]) {
      expect(sent).not.toHaveProperty(key);
    }
  });

  it("keeps only validated public errors and hides malformed upstream contents", async () => {
    for (const [response, code] of [
      [Response.json({ error: { code: "INVALID_NAME", field: "name", message: "이름을 확인해 주세요.", requestId: "123e4567-e89b-42d3-a456-426614174000" } }, { status: 422 }), "INVALID_NAME"],
      [new Response("PRIVATE_CANARY", { status: 503 }), "CLIENT_UNAVAILABLE"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const submitted = await submitQuiz({ slug: "2026-09-01-test01", difficulty: "child" }, request);
      expect(submitted).toMatchObject({ ok: false, error: { code } });
      expect(JSON.stringify(submitted)).not.toContain("PRIVATE_CANARY");
    }
  });

  it("reads only the strict current-session submission without creating a session", async () => {
    const ownSubmission = {
      status: "submitted",
      quizVariantId: "public-test-child",
      quizRevision: 1,
      answers: { r0c0: "가" },
      result,
    } as const;
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      data: { submission: ownSubmission },
    }));
    vi.stubGlobal("fetch", fetcher);

    await expect(readOwnSubmission({ slug: "2026-09-01-test01", difficulty: "child" }))
      .resolves.toEqual({ ok: true, data: ownSubmission });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/quizzes/2026-09-01-test01/child/me",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
  });

  it("rejects malformed own-submission data without exposing private extras", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      data: {
        submission: {
          status: "submitted",
          quizVariantId: "public-test-child",
          quizRevision: 1,
          answers: { r0c0: "가" },
          result,
          sessionHash: "PRIVATE_CANARY",
        },
      },
    })));

    const restored = await readOwnSubmission({ slug: "2026-09-01-test01", difficulty: "child" });
    expect(restored).toMatchObject({ ok: false, error: { code: "CLIENT_UNAVAILABLE" } });
    expect(JSON.stringify(restored)).not.toContain("PRIVATE_CANARY");
  });

  it("deletes only the exact current submission through a strict same-origin request", async () => {
    const deleted = {
      status: "deleted",
      quizVariantId: "public-test-child",
      quizRevision: 1,
      deletedAt: "2026-09-02T00:00:00.000Z",
    } as const;
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: { submission: deleted } }));
    vi.stubGlobal("fetch", fetcher);

    await expect(deleteOwnSubmission({
      difficulty: "child",
      quizRevision: 1,
      quizVariantId: "public-test-child",
      slug: "2026-09-01-test01",
    })).resolves.toEqual({ ok: true, data: deleted });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/quizzes/2026-09-01-test01/child/me/submission",
      expect.objectContaining({
        body: "{}",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "DELETE",
      }),
    );
  });

  it("keeps the result when deletion data is mismatched or contains private extras", async () => {
    const target = {
      difficulty: "child" as const,
      quizRevision: 1,
      quizVariantId: "public-test-child",
      slug: "2026-09-01-test01",
    };
    for (const submission of [
      {
        status: "deleted", quizVariantId: "other-variant", quizRevision: 1,
        deletedAt: "2026-09-02T00:00:00.000Z",
      },
      {
        status: "deleted", quizVariantId: "public-test-child", quizRevision: 1,
        deletedAt: "2026-09-02T00:00:00.000Z", answers: "PRIVATE_CANARY",
      },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { submission } })));
      const deleted = await deleteOwnSubmission(target);
      expect(deleted).toMatchObject({ ok: false, error: { code: "CLIENT_UNAVAILABLE" } });
      expect(JSON.stringify(deleted)).not.toContain("PRIVATE_CANARY");
    }
  });

  it("creates UUIDv7 keys and stable semantic fingerprints", () => {
    const key = generateUuidV7(1_725_000_000_000);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(submissionRequestSchema.shape.idempotencyKey.safeParse(key).success).toBe(true);
    expect(submissionFingerprint({ revision: 1, name: " 은혜 ", comment: " 감사 ", consent: true, cells: { r0c1: "나", r0c0: "가" } }))
      .toBe(submissionFingerprint({ revision: 1, name: "은혜", comment: "감사", consent: true, cells: { r0c0: "가", r0c1: "나" } }));
  });
});
