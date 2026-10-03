import { env, exports } from "cloudflare:workers";
import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { practiceCheckDataSchema } from "../../shared/api/practice";
import { previewQuiz } from "../../src/features/quiz/preview-data";
import { createDatabase } from "../_shared/db/client";
import {
  anonymousSessions,
  bibleTranslations,
  leaderboardSnapshotEntries,
  leaderboardSnapshots,
  quizEntriesPublic,
  quizSets,
  quizSolutions,
  quizVariants,
  sermons,
  siteState,
  submissions,
} from "../_shared/db/schema";

const binding = env as Env;
const database = createDatabase(binding.DB);
const now = new Date();
const nowIso = now.toISOString();
const slug = "2026-09-03-prc001";
const variantId = "practice-check-child";
const endpoint = `https://example.com/api/quizzes/${slug}/child/practice/check`;

interface Fixture {
  canonicalCellIds: string[];
  entryAnswers: Record<string, string>;
  solutionCells: Record<string, string>;
}

async function seedQuiz(status: "archived" | "published" = "archived"): Promise<Fixture> {
  await database.insert(bibleTranslations).values({
    id: "practice-check-translation",
    displayName: "개역개정",
    edition: "reference-only",
    publisherOrRightsholder: "대한성서공회",
    mode: "reference_only",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await database.insert(sermons).values({
    id: "practice-check-sermon",
    slug,
    slugSuffix: "prc001",
    churchName: "다사랑교회",
    sermonTitle: "지난 퀴즈 채점 시험",
    sermonDate: "2026-09-03",
    bibleTranslationId: "practice-check-translation",
    bibleReferenceJson: [],
    bibleReferenceLabel: "마태복음 5:1-2",
    youtubeVideoId: "practice-check-video",
    youtubeUrl: "https://example.com/watch/practice-check",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await database.insert(quizSets).values({
    id: "practice-check-set",
    sermonId: "practice-check-sermon",
    status,
    archivedAt: status === "archived" ? nowIso : null,
    createdBy: "test-admin-private",
    publishedAt: new Date(now.getTime() - 120_000).toISOString(),
    opensAt: new Date(now.getTime() - 120_000).toISOString(),
    closesAt: status === "archived"
      ? new Date(now.getTime() - 60_000).toISOString()
      : new Date(now.getTime() + 60 * 60_000).toISOString(),
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const { grid } = previewQuiz("child");
  const canonicalCellIds = grid.cells.map((cell) => cell.id);
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
    id: variantId,
    quizSetId: "practice-check-set",
    difficulty: "child",
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
    id: `${variantId}-${entry.id}`,
    quizVariantId: variantId,
    number: entry.number,
    direction: entry.direction,
    startRow: entry.start.row,
    startCol: entry.start.column,
    length: entry.length,
    clue: entry.clue!,
    displayOrder,
  })));
  const solutionCells = Object.fromEntries(canonicalCellIds.map((cellId) => [cellId, "가"]));
  const entryAnswers = Object.fromEntries(grid.entries.map((entry) => [
    `${variantId}-${entry.id}`,
    "가".repeat(entry.length),
  ]));
  await database.insert(quizSolutions).values({
    quizVariantId: variantId,
    canonicalCellOrderJson: canonicalCellIds,
    solutionCellsJson: solutionCells,
    entryAnswersJson: entryAnswers,
    solutionSha256: "d".repeat(64),
  });
  return { canonicalCellIds, entryAnswers, solutionCells };
}

function practiceRequest(
  body: unknown = { revision: 1, cells: { r0c0: "가" } },
  options: { headers?: Record<string, string>; method?: string; url?: string } = {},
) {
  return new Request(options.url ?? endpoint, {
    method: options.method ?? "POST",
    headers: {
      Origin: "https://example.com",
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...((options.method ?? "POST") === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}

async function responseCode(response: Response): Promise<string | undefined> {
  const body = await response.json() as { error?: { code?: string } };
  return body.error?.code;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await database.delete(leaderboardSnapshotEntries);
  await database.delete(leaderboardSnapshots);
  await database.delete(submissions);
  await database.delete(anonymousSessions);
  await database.delete(siteState);
  await database.delete(quizSets);
  await database.delete(sermons);
  await database.delete(bibleTranslations);
});

describe("archived practice check API", () => {
  it("scores in memory without a session or participation storage access", async () => {
    const fixture = await seedQuiz();
    await database.insert(anonymousSessions).values({
      sessionHash: "a".repeat(64),
      createdAt: new Date(now.getTime() - 60_000).toISOString(),
      lastSeenAt: new Date(now.getTime() - 30_000).toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    });
    await database.insert(submissions).values({
      id: "practice-stray-submission",
      quizVariantId: variantId,
      quizRevision: 99,
      sessionHash: "a".repeat(64),
      idempotencyKey: "01924f8e-7b2a-7f1c-8f3a-000000000099",
      requestHash: "b".repeat(64),
      displayName: "과거 참여자",
      comment: null,
      answersJson: { [fixture.canonicalCellIds[0]!]: "가" },
      correctnessMask: `1${"0".repeat(fixture.canonicalCellIds.length - 1)}`,
      correctCells: 1,
      totalCells: fixture.canonicalCellIds.length,
      correctWords: 0,
      totalWords: Object.keys(fixture.entryAnswers).length,
      scoreBasisPoints: Math.round(10_000 / fixture.canonicalCellIds.length),
      isFullyCorrect: false,
      status: "visible",
      submittedAt: nowIso,
    });

    const beforeSubmissionCount = await database.select({ value: count() }).from(submissions);
    const response = await exports.default.fetch(practiceRequest({
      revision: 1,
      cells: {
        [fixture.canonicalCellIds[0]!]: "가",
        [fixture.canonicalCellIds[1]!]: "나",
      },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const raw = await response.text();
    expect(raw).not.toContain("practice-stray-submission");
    expect(raw).not.toContain("sessionHash");
    const envelope = JSON.parse(raw) as { data: unknown };
    const data = practiceCheckDataSchema.parse(envelope.data);
    expect(data).toMatchObject({
      quizVariantId: variantId,
      quizRevision: 1,
      correctCells: 1,
      totalCells: fixture.canonicalCellIds.length,
    });
    expect(data.solution.cells).toEqual(fixture.solutionCells);
    expect(await database.select({ value: count() }).from(submissions)).toEqual(beforeSubmissionCount);
    expect(await database.select({ value: count() }).from(leaderboardSnapshots)).toEqual([{ value: 0 }]);
  });

  it("rejects published, stale, empty, inactive, malformed, and expanded requests", async () => {
    await seedQuiz("published");
    expect(await responseCode(await exports.default.fetch(practiceRequest()))).toBe("PRACTICE_NOT_AVAILABLE");
    await database.update(quizSets).set({ status: "archived", archivedAt: nowIso }).where(eq(quizSets.id, "practice-check-set"));

    const cases: Array<[unknown, number, string]> = [
      [{ revision: 2, cells: { r0c0: "가" } }, 409, "REVISION_MISMATCH"],
      [{ revision: 1, cells: {} }, 422, "EMPTY_SUBMISSION"],
      [{ revision: 1, cells: { r9c9: "가" } }, 422, "INVALID_GRID_SHAPE"],
      [{ revision: 1, cells: { r0c0: "ㄱ" } }, 422, "INVALID_HANGUL_SYLLABLE"],
      [{ revision: 1, cells: { r0c0: "가" }, name: "PRIVATE_CANARY" }, 400, "INVALID_PRACTICE_REQUEST"],
    ];
    for (const [body, status, code] of cases) {
      const response = await exports.default.fetch(practiceRequest(body));
      expect(response.status).toBe(status);
      expect(await responseCode(response)).toBe(code);
    }
  });

  it("enforces path, query, method, origin, and JSON mutation guards", async () => {
    await seedQuiz();
    const cases: Array<[Request, number, string]> = [
      [practiceRequest({}, { method: "GET" }), 405, "METHOD_NOT_ALLOWED"],
      [practiceRequest({}, { url: `${endpoint}?unexpected=1` }), 400, "INVALID_QUIZ_QUERY"],
      [practiceRequest({}, { url: endpoint.replace("prc001", "bad") }), 404, "QUIZ_NOT_FOUND"],
      [practiceRequest({}, { headers: { Origin: "https://attacker.example" } }), 403, "ORIGIN_NOT_ALLOWED"],
      [practiceRequest({}, { headers: { "Content-Type": "text/plain" } }), 415, "UNSUPPORTED_MEDIA_TYPE"],
    ];
    for (const [request, status, code] of cases) {
      const response = await exports.default.fetch(request);
      expect(response.status).toBe(status);
      expect(await responseCode(response)).toBe(code);
    }
  });

  it("fails closed for a missing quiz or damaged private solution", async () => {
    expect((await exports.default.fetch(practiceRequest())).status).toBe(404);
    const fixture = await seedQuiz();
    await database.update(quizSolutions).set({
      solutionCellsJson: { ...fixture.solutionCells, [fixture.canonicalCellIds[0]!]: "ㄱ" },
    }).where(eq(quizSolutions.quizVariantId, variantId));
    const response = await exports.default.fetch(practiceRequest());
    expect(response.status).toBe(503);
    expect(await responseCode(response)).toBe("PRACTICE_CHECK_UNAVAILABLE");
  });
});
