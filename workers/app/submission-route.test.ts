import { app } from "./app";
import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { previewQuiz } from "../../src/features/quiz/preview-data";
import {
  ownSubmissionDataSchema,
  submissionDeletionDataSchema,
  submissionResultSchema,
} from "../../shared/api/submission";
import { createDatabase } from "../_shared/db/client";
import {
  anonymousSessions,
  auditLogs,
  bibleTranslations,
  leaderboardSnapshotEntries,
  leaderboardSnapshots,
  moderationExceptions,
  moderationTerms,
  quizEntriesPublic,
  quizSets,
  quizSolutions,
  quizVariants,
  reservedNames,
  sermons,
  siteState,
  submissions,
} from "../_shared/db/schema";
import {
  SESSION_COOKIE_NAME,
  generateSessionToken,
  hashSessionToken,
} from "../_shared/services/session";
import { MAX_MUTATION_JSON_BYTES } from "../_shared/http/mutation-request";

const binding = env as Env & {
  SESSION_PEPPER: string;
  TURNSTILE_EXPECTED_HOSTNAME: string;
  TURNSTILE_SECRET: string;
};
const database = createDatabase(binding.DB);
const now = new Date();
const nowIso = now.toISOString();
const slug = "2026-09-01-submit";
const variantId = "submission-route-child";
const idempotencyKey = "01924f8e-7b2a-7f1c-8f3a-123456789abc";
const endpoint = `https://example.com/api/quizzes/${slug}/child/submissions`;
const ownEndpoint = `https://example.com/api/quizzes/${slug}/child/me`;
const deletionEndpoint = `${ownEndpoint}/submission`;

function verifiedResponse(): Response {
  return Response.json({
    success: true,
    hostname: "example.com",
    action: "quiz_submission",
    challenge_ts: nowIso,
  });
}

async function seedQuiz() {
  await database.insert(bibleTranslations).values({
    id: "submission-route-translation",
    displayName: "개역개정",
    edition: "reference-only",
    publisherOrRightsholder: "대한성서공회",
    mode: "reference_only",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await database.insert(sermons).values({
    id: "submission-route-sermon",
    slug,
    slugSuffix: "submit",
    churchName: "다사랑교회",
    sermonTitle: "제출 경로 시험",
    sermonDate: "2026-09-01",
    bibleTranslationId: "submission-route-translation",
    bibleReferenceJson: [],
    bibleReferenceLabel: "마태복음 5:1-2",
    youtubeVideoId: "submit-test",
    youtubeUrl: "https://example.com/watch/submit-test",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await database.insert(quizSets).values({
    id: "submission-route-set",
    sermonId: "submission-route-sermon",
    status: "published",
    createdBy: "test-admin",
    publishedAt: nowIso,
    opensAt: new Date(now.getTime() - 60_000).toISOString(),
    closesAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  let canonicalCellOrder: readonly string[] = [];
  for (const [difficulty, id] of [
    ["child", variantId],
    ["adult", "submission-route-adult"],
  ] as const) {
    const { grid } = previewQuiz(difficulty);
    const cellOrder = grid.cells.map((cell) => cell.id);
    if (difficulty === "child") canonicalCellOrder = cellOrder;
    const publicCells = Array.from({ length: grid.gridSize ** 2 }, (_, index) => {
      const row = Math.floor(index / grid.gridSize);
      const column = index % grid.gridSize;
      const publicCell = grid.cells.find((cell) => cell.row === row && cell.column === column);
      const across = grid.entries.find((entry) =>
        entry.direction === "across" && entry.start.row === row && entry.start.column === column
      );
      const down = grid.entries.find((entry) =>
        entry.direction === "down" && entry.start.row === row && entry.start.column === column
      );
      return {
        row,
        column,
        isBlocked: publicCell === undefined,
        ...(across === undefined ? {} : { acrossNumber: across.number }),
        ...(down === undefined ? {} : { downNumber: down.number }),
      };
    });
    await database.insert(quizVariants).values({
      id,
      quizSetId: "submission-route-set",
      difficulty,
      revision: 1,
      gridSize: grid.gridSize,
      publicGridJson: { size: grid.gridSize, cells: publicCells },
      wordCount: grid.entries.length,
      activeCellCount: grid.cells.length,
      intersectionCount: grid.entries.reduce((sum, entry) => sum + entry.length, 0) - grid.cells.length,
      validationReportJson: { errors: [], warnings: [], generatedAt: nowIso },
      createdAt: nowIso,
    });
    await database.insert(quizEntriesPublic).values(grid.entries.map((entry, displayOrder) => ({
      id: `${id}-${entry.id}`,
      quizVariantId: id,
      number: entry.number,
      direction: entry.direction,
      startRow: entry.start.row,
      startCol: entry.start.column,
      length: entry.length,
      clue: entry.clue!,
      displayOrder,
    })));
    await database.insert(quizSolutions).values({
      quizVariantId: id,
      canonicalCellOrderJson: cellOrder,
      solutionCellsJson: Object.fromEntries(cellOrder.map((cellId) => [cellId, "가"])),
      entryAnswersJson: Object.fromEntries(grid.entries.map((entry) => [
        `${id}-${entry.id}`,
        "가".repeat(entry.length),
      ])),
      solutionSha256: "a".repeat(64),
    });
  }
  return { canonicalCellOrder };
}

async function seedSession(): Promise<string> {
  const token = generateSessionToken();
  await database.insert(anonymousSessions).values({
    sessionHash: await hashSessionToken(token, binding.SESSION_PEPPER),
    createdAt: new Date(now.getTime() - 60_000).toISOString(),
    lastSeenAt: new Date(now.getTime() - 60_000).toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
  });
  return token;
}

function request(token: string | undefined, overrides: Record<string, unknown> = {}) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://example.com",
      ...(token === undefined ? {} : { Cookie: `${SESSION_COOKIE_NAME}=${token}` }),
    },
    body: JSON.stringify({
      revision: 1,
      idempotencyKey,
      turnstileToken: "turnstile-token-private",
      name: "은혜",
      comment: "감사합니다",
      consent: true,
      cells: { r0c0: "가", r0c1: "나" },
      ...overrides,
    }),
  });
}

function ownRequest(token?: string, url = ownEndpoint, method = "GET") {
  return new Request(url, {
    method,
    headers: token === undefined ? {} : { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
}

function deletionRequest(
  token?: string,
  body = "{}",
  headers: Record<string, string> = {},
  url = deletionEndpoint,
  method = "DELETE",
) {
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://example.com",
      ...(token === undefined ? {} : { Cookie: `${SESSION_COOKIE_NAME}=${token}` }),
      ...headers,
    },
    ...(method === "GET" ? {} : { body }),
  });
}

function rawRequest(
  body: string,
  headers: Record<string, string> = {},
  method = "POST",
) {
  return new Request(endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://example.com",
      ...headers,
    },
    ...(method === "GET" ? {} : { body }),
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await database.delete(leaderboardSnapshotEntries);
  await database.delete(leaderboardSnapshots);
  await database.delete(auditLogs);
  await database.delete(submissions);
  await database.delete(anonymousSessions);
  await database.delete(moderationExceptions);
  await database.delete(moderationTerms);
  await database.delete(reservedNames);
  await database.delete(quizSolutions);
  await database.delete(siteState);
  await database.delete(quizSets);
  await database.delete(sermons);
  await database.delete(bibleTranslations);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("public final submission route", () => {
  it("verifies, scores and stores once without exposing private request values", async () => {
    const { canonicalCellOrder } = await seedQuiz();
    const token = await seedSession();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => verifiedResponse());

    const response = await exports.default.fetch(request(token));
    const raw = await response.text();
    expect(response.status, `${raw} fetch calls=${fetcher.mock.calls.length}`).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(raw).not.toContain("turnstile-token-private");
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(binding.TURNSTILE_SECRET);
    const result = submissionResultSchema.parse(JSON.parse(raw).data);
    expect(result).toMatchObject({
      correctCells: 1,
      totalCells: canonicalCellOrder.length,
      canRevealAnswer: true,
    });
    expect(result.correctnessMask.startsWith("10")).toBe(true);
    expect(await database.select().from(submissions)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledOnce();
    const siteverifyBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(siteverifyBody).toEqual({
      idempotency_key: idempotencyKey,
      response: "turnstile-token-private",
      secret: binding.TURNSTILE_SECRET,
    });
    expect(siteverifyBody).not.toHaveProperty("remoteip");
  });

  it("replays the same semantic request before consuming another Turnstile token", async () => {
    await seedQuiz();
    const token = await seedSession();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => verifiedResponse());
    const first = await exports.default.fetch(request(token));
    const firstBody = await first.json();
    await database.insert(moderationTerms).values({
      id: "policy-added-after-submit",
      scope: "answer",
      normalizedPattern: "가",
      matchMode: "contains",
      enabled: true,
      createdBy: "test-admin",
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    const replay = await exports.default.fetch(request(token, { turnstileToken: "fresh-token" }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    expect(fetcher).toHaveBeenCalledOnce();

    const conflict = await exports.default.fetch(request(token, {
      turnstileToken: "another-token",
      comment: "다른 내용",
    }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });
    const already = await exports.default.fetch(request(token, {
      idempotencyKey: "01924f8e-7b2a-7f1c-9f3a-123456789abc",
    }));
    expect(already.status).toBe(409);
    expect(await already.json()).toMatchObject({ error: { code: "ALREADY_SUBMITTED" } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("preserves a stored idempotent replay while the same request lazily archives the quiz", async () => {
    await seedQuiz();
    const token = await seedSession();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => verifiedResponse());
    const first = await exports.default.fetch(request(token));
    const firstBody = await first.json();
    expect(first.status).toBe(200);

    await database.update(quizSets).set({
      closesAt: new Date(now.getTime() - 1).toISOString(),
    });
    const replay = await exports.default.fetch(request(token, {
      turnstileToken: "fresh-token-after-close",
    }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstBody);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await database.select({ status: quizSets.status }).from(quizSets))
      .toEqual([{ status: "archived" }]);
    expect(await database.select().from(leaderboardSnapshots)).toHaveLength(2);
  });

  it("rejects session, cell and moderation failures before Siteverify or storage", async () => {
    await seedQuiz();
    const token = await seedSession();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => verifiedResponse());
    const cases: Array<[Request, number, string]> = [
      [request(undefined), 401, "SESSION_REQUIRED"],
      [request(token, { cells: {} }), 422, "EMPTY_SUBMISSION"],
      [request(token, { cells: { r9c9: "가" } }), 422, "INVALID_GRID_SHAPE"],
      [request(token, { cells: { r0c0: "ㄱ" } }), 422, "INVALID_HANGUL_SYLLABLE"],
      [request(token, { name: "관리자" }), 422, "NAME_RESERVED"],
    ];
    for (const [submittedRequest, status, code] of cases) {
      const response = await exports.default.fetch(submittedRequest);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code, requestId: expect.any(String) } });
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(await database.select().from(submissions)).toHaveLength(0);
  });

  it("enforces the private mutation boundary with stable transport errors", async () => {
    const token = await seedSession();
    const cases: Array<[Request, number, string]> = [
      [rawRequest("{", { Cookie: `${SESSION_COOKIE_NAME}=${token}` }), 400, "INVALID_JSON"],
      [rawRequest("{}", { Origin: "https://attacker.example" }), 403, "ORIGIN_NOT_ALLOWED"],
      [rawRequest("{}", { "Content-Type": "text/plain" }), 415, "UNSUPPORTED_MEDIA_TYPE"],
      [rawRequest(`"${"a".repeat(MAX_MUTATION_JSON_BYTES)}"`), 413, "PAYLOAD_TOO_LARGE"],
      [rawRequest("", {}, "GET"), 405, "METHOD_NOT_ALLOWED"],
    ];
    for (const [submittedRequest, status, code] of cases) {
      const response = await exports.default.fetch(submittedRequest);
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ error: { code, requestId: expect.any(String) } });
    }
  });

  it("fails closed on rejected verification and checks revision and pause after verification", async () => {
    await seedQuiz();
    const token = await seedSession();
    let verificationCalls = 0;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      verificationCalls += 1;
      return verificationCalls === 1
        ? Response.json({ success: false, "error-codes": ["invalid-input-response"] })
        : verifiedResponse();
    });

    const rejected = await exports.default.fetch(request(token));
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ error: { code: "TURNSTILE_FAILED" } });
    const revision = await exports.default.fetch(request(token, { revision: 2 }));
    expect(revision.status).toBe(409);
    expect(await revision.json()).toMatchObject({ error: { code: "REVISION_MISMATCH" } });

    await database.update(quizSets).set({
      submissionState: "paused",
      submissionPausedAt: nowIso,
      submissionPauseReason: "확인 중",
    });
    const paused = await exports.default.fetch(request(token));
    expect(paused.status).toBe(409);
    expect(await paused.json()).toMatchObject({ error: { code: "SUBMISSIONS_PAUSED" } });
    expect(await database.select().from(submissions)).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not store when verification is unavailable or the quiz is closed", async () => {
    await seedQuiz();
    const token = await seedSession();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("unavailable", { status: 503 }),
    );
    const unavailable = await exports.default.fetch(request(token));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({
      error: { code: "VERIFICATION_UNAVAILABLE" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    await database.update(quizSets).set({
      closesAt: new Date(now.getTime() - 1).toISOString(),
    });
    fetcher.mockImplementation(async () => verifiedResponse());
    const closed = await exports.default.fetch(request(token));
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ error: { code: "QUIZ_CLOSED" } });
    expect(await database.select().from(submissions)).toHaveLength(0);
  });

  it("rejects a new submission when verification crosses the close boundary", async () => {
    vi.useFakeTimers({ now });
    await seedQuiz();
    await database.update(quizSets).set({
      closesAt: new Date(now.getTime() + 1_000).toISOString(),
    });
    const token = await seedSession();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      vi.setSystemTime(new Date(now.getTime() + 2_000));
      return verifiedResponse();
    });

    const response = await exports.default.fetch(request(token));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "QUIZ_CLOSED" } });
    expect(await database.select().from(submissions)).toHaveLength(0);
  });
});

describe("current session submission read route", () => {
  it("returns a strict empty result without creating or requiring a session", async () => {
    await seedQuiz();

    for (const submittedRequest of [
      ownRequest(),
      ownRequest("not-a-session-token"),
    ]) {
      const response = await exports.default.fetch(submittedRequest);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(ownSubmissionDataSchema.parse(JSON.parse(await response.text()).data)).toEqual({
        submission: null,
      });
    }
    expect(await database.select().from(anonymousSessions)).toHaveLength(0);
  });

  it("treats an expired or unknown active session as no owned submission", async () => {
    await seedQuiz();
    const token = await seedSession();
    await database.update(anonymousSessions).set({
      expiresAt: new Date(now.getTime() - 1).toISOString(),
    });

    const response = await exports.default.fetch(ownRequest(token));
    expect(response.status).toBe(200);
    expect(ownSubmissionDataSchema.parse(JSON.parse(await response.text()).data))
      .toEqual({ submission: null });
  });

  it("restores only the exact session and variant, including hidden submissions", async () => {
    await seedQuiz();
    const token = await seedSession();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => verifiedResponse());
    const stored = await exports.default.fetch(request(token));
    expect(stored.status).toBe(200);

    const response = await exports.default.fetch(ownRequest(token));
    const raw = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const data = ownSubmissionDataSchema.parse(JSON.parse(raw).data);
    expect(data.submission).toMatchObject({
      status: "submitted",
      quizVariantId: variantId,
      quizRevision: 1,
      answers: { r0c0: "가", r0c1: "나" },
      result: { submissionId: expect.any(String), canRevealAnswer: true },
    });
    for (const privateValue of [token, "은혜", "감사합니다", idempotencyKey, binding.TURNSTILE_SECRET]) {
      expect(raw).not.toContain(privateValue);
    }

    const otherToken = await seedSession();
    const other = await exports.default.fetch(ownRequest(otherToken));
    expect(ownSubmissionDataSchema.parse(JSON.parse(await other.text()).data)).toEqual({ submission: null });

    await database.update(submissions).set({
      status: "hidden",
      hiddenAt: nowIso,
    }).where(eq(submissions.quizVariantId, variantId));
    const hidden = await exports.default.fetch(ownRequest(token));
    const hiddenRaw = await hidden.text();
    expect(ownSubmissionDataSchema.parse(JSON.parse(hiddenRaw).data).submission)
      .toMatchObject({ status: "submitted" });
    expect(hiddenRaw).not.toContain("hidden");
  });

  it("returns only a tombstone after deletion and never reveals removed answers or solutions", async () => {
    await seedQuiz();
    const token = await seedSession();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => verifiedResponse());
    expect((await exports.default.fetch(request(token))).status).toBe(200);

    const deletedAt = new Date(now.getTime() + 1_000).toISOString();
    await database.update(submissions).set({
      status: "deleted",
      displayName: null,
      comment: null,
      answersJson: null,
      deletedAt,
    }).where(eq(submissions.quizVariantId, variantId));

    const response = await exports.default.fetch(ownRequest(token));
    const raw = await response.text();
    expect(ownSubmissionDataSchema.parse(JSON.parse(raw).data)).toEqual({
      submission: {
        status: "deleted",
        quizVariantId: variantId,
        quizRevision: 1,
        deletedAt,
      },
    });
    expect(raw).not.toContain("answers");
    expect(raw).not.toContain("solution");
  });

  it("fails closed when stored answers no longer match the stored score", async () => {
    await seedQuiz();
    const token = await seedSession();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => verifiedResponse());
    expect((await exports.default.fetch(request(token))).status).toBe(200);
    await database.update(submissions).set({
      answersJson: { r0c0: "나", r0c1: "나" },
    }).where(eq(submissions.quizVariantId, variantId));

    const response = await exports.default.fetch(ownRequest(token));
    const raw = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(raw)).toMatchObject({
      error: { code: "SUBMISSION_LOOKUP_UNAVAILABLE", requestId: expect.any(String) },
    });
    expect(raw).not.toContain("solution");
    expect(raw).not.toContain("correctnessMask");
  });

  it("uses stable private errors for invalid targets and methods", async () => {
    await seedQuiz();
    const cases: Array<[Request, number, string]> = [
      [ownRequest(undefined, `${ownEndpoint}?unexpected=1`), 400, "INVALID_QUIZ_QUERY"],
      [ownRequest(undefined, "https://example.com/api/quizzes/not-a-slug/child/me"), 404, "QUIZ_NOT_FOUND"],
      [ownRequest(undefined, ownEndpoint, "POST"), 405, "METHOD_NOT_ALLOWED"],
    ];
    for (const [submittedRequest, status, code] of cases) {
      const response = await exports.default.fetch(submittedRequest);
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ error: { code, requestId: expect.any(String) } });
    }
  });
});

describe("current session submission deletion route", () => {
  it("removes public content, returns a minimal tombstone and blocks resubmission", async () => {
    await seedQuiz();
    const token = await seedSession();
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => verifiedResponse());
    expect((await exports.default.fetch(request(token))).status).toBe(200);

    const [response, concurrentResponse] = await Promise.all([
      exports.default.fetch(deletionRequest(token)),
      exports.default.fetch(deletionRequest(token)),
    ]);
    const raw = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const deleted = submissionDeletionDataSchema.parse(JSON.parse(raw).data);
    expect(deleted).toMatchObject({
      submission: {
        status: "deleted",
        quizVariantId: variantId,
        quizRevision: 1,
        deletedAt: expect.any(String),
      },
    });
    expect(concurrentResponse.status).toBe(200);
    expect(submissionDeletionDataSchema.parse(JSON.parse(await concurrentResponse.text()).data))
      .toEqual(deleted);
    for (const privateValue of [token, "은혜", "감사합니다", idempotencyKey, "answers", "solution"]) {
      expect(raw).not.toContain(privateValue);
    }

    const [row] = await database.select().from(submissions)
      .where(eq(submissions.quizVariantId, variantId));
    expect(row).toMatchObject({
      status: "deleted",
      displayName: null,
      comment: null,
      answersJson: null,
      deletedAt: deleted.submission.deletedAt,
      correctCells: 1,
    });
    expect(await database.select().from(auditLogs)).toEqual([
      expect.objectContaining({
        action: "self_service_delete",
        actorEmail: null,
        actorType: "self_service",
        createdAt: deleted.submission.deletedAt,
        entityId: row!.id,
        entityType: "submission",
        safeMetadataJson: {
          deletedAt: deleted.submission.deletedAt,
          quizRevision: 1,
          quizVariantId: variantId,
        },
      }),
    ]);

    const restored = await exports.default.fetch(ownRequest(token));
    expect(ownSubmissionDataSchema.parse(JSON.parse(await restored.text()).data))
      .toEqual(deleted);

    const repeated = await exports.default.fetch(deletionRequest(token));
    expect(repeated.status).toBe(200);
    expect(submissionDeletionDataSchema.parse(JSON.parse(await repeated.text()).data))
      .toEqual(deleted);

    const resubmission = await exports.default.fetch(request(token, {
      idempotencyKey: "01924f8e-7b2a-7f1c-9f3a-123456789abc",
    }));
    expect(resubmission.status).toBe(409);
    expect(await resubmission.json()).toMatchObject({ error: { code: "ALREADY_SUBMITTED" } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("requires the exact active owner session and leaves another session's submission intact", async () => {
    await seedQuiz();
    const ownerToken = await seedSession();
    const otherToken = await seedSession();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => verifiedResponse());
    expect((await exports.default.fetch(request(ownerToken))).status).toBe(200);

    const other = await exports.default.fetch(deletionRequest(otherToken));
    expect(other.status).toBe(404);
    expect(await other.json()).toMatchObject({ error: { code: "SUBMISSION_NOT_FOUND" } });
    expect(await database.select().from(submissions)).toMatchObject([
      { status: "visible", displayName: "은혜", answersJson: { r0c0: "가", r0c1: "나" } },
    ]);

    await database.update(anonymousSessions).set({
      lastSeenAt: new Date(now.getTime() - 2).toISOString(),
      expiresAt: new Date(now.getTime() - 1).toISOString(),
    }).where(eq(anonymousSessions.sessionHash, await hashSessionToken(ownerToken, binding.SESSION_PEPPER)));
    const expired = await exports.default.fetch(deletionRequest(ownerToken));
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ error: { code: "SESSION_REQUIRED" } });
    expect(await database.select().from(submissions)).toMatchObject([
      { status: "visible", displayName: "은혜" },
    ]);
  });

  it("enforces strict JSON transport, target and method boundaries", async () => {
    await seedQuiz();
    const token = await seedSession();
    const cases: Array<[Request, number, string]> = [
      [deletionRequest(token, "{"), 400, "INVALID_JSON"],
      [deletionRequest(token, "{}", { Origin: "https://attacker.example" }), 403, "ORIGIN_NOT_ALLOWED"],
      [deletionRequest(token, "{}", { "Content-Type": "text/plain" }), 415, "UNSUPPORTED_MEDIA_TYPE"],
      [deletionRequest(token, `"${"a".repeat(MAX_MUTATION_JSON_BYTES)}"`), 413, "PAYLOAD_TOO_LARGE"],
      [deletionRequest(token, JSON.stringify({ confirmation: true })), 400, "INVALID_SUBMISSION_DELETION_REQUEST"],
      [deletionRequest(token, "{}", {}, `${deletionEndpoint}?unexpected=1`), 400, "INVALID_QUIZ_QUERY"],
      [deletionRequest(token, "{}", {}, "https://example.com/api/quizzes/not-a-slug/child/me/submission"), 404, "QUIZ_NOT_FOUND"],
      [deletionRequest(token, "{}", {}, deletionEndpoint, "POST"), 405, "METHOD_NOT_ALLOWED"],
      [deletionRequest(), 401, "SESSION_REQUIRED"],
    ];

    for (const [submittedRequest, status, code] of cases) {
      const response = await exports.default.fetch(submittedRequest);
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ error: { code, requestId: expect.any(String) } });
    }
  });
});

// P8 admission control must never block recovery of a committed result.
describe("P8 successful submission/deletion replay under limiting",()=>{
  it("replays prior success before invoking the limiter or Turnstile",async()=>{
    await seedQuiz();const token=await seedSession();
    vi.spyOn(globalThis,"fetch").mockImplementation(async()=>verifiedResponse());
    expect((await exports.default.fetch(request(token))).status).toBe(200);
    const limit=vi.fn(async()=>({success:false})),b={...binding,PUBLIC_RATE_LIMIT_ENABLED:"true",PUBLIC_ACTOR_LIMIT:{limit}};
    const replay=await app.fetch(request(token),b);expect(replay.status).toBe(200);expect(limit).not.toHaveBeenCalled();
    const denied=await app.fetch(deletionRequest(token),b);expect(denied.status).toBe(429);expect(limit).toHaveBeenCalledTimes(1);
    expect((await exports.default.fetch(deletionRequest(token))).status).toBe(200);limit.mockClear();
    expect((await app.fetch(deletionRequest(token),b)).status).toBe(200);expect(limit).not.toHaveBeenCalled();
  });
});
