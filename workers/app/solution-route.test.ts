import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { quizSolutionDataSchema } from "../../shared/api/solution";
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
import {
  SESSION_COOKIE_NAME,
  generateSessionToken,
  hashSessionToken,
} from "../_shared/services/session";

const binding = env as Env & { SESSION_PEPPER: string };
const database = createDatabase(binding.DB);
const now = new Date();
const nowIso = now.toISOString();
const slug = "2026-09-03-sol001";
const childVariantId = "solution-route-child";
const adultVariantId = "solution-route-adult";
const endpoint = `https://example.com/api/quizzes/${slug}/child/solution`;

interface SeededVariant {
  canonicalCellIds: readonly string[];
  entryAnswers: Record<string, string>;
  solutionCells: Record<string, string>;
}

async function seedQuiz(): Promise<SeededVariant> {
  await database.insert(bibleTranslations).values({
    id: "solution-route-translation",
    displayName: "개역개정",
    edition: "reference-only",
    publisherOrRightsholder: "대한성서공회",
    mode: "reference_only",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await database.insert(sermons).values({
    id: "solution-route-sermon",
    slug,
    slugSuffix: "sol001",
    churchName: "다사랑교회",
    sermonTitle: "정답 조회 시험",
    sermonDate: "2026-09-03",
    bibleTranslationId: "solution-route-translation",
    bibleReferenceJson: [],
    bibleReferenceLabel: "마태복음 5:1-2",
    youtubeVideoId: "solution-route-video",
    youtubeUrl: "https://example.com/watch/solution-route",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await database.insert(quizSets).values({
    id: "solution-route-set",
    sermonId: "solution-route-sermon",
    status: "published",
    createdBy: "test-admin-private",
    publishedAt: nowIso,
    opensAt: new Date(now.getTime() - 60_000).toISOString(),
    closesAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  let child: SeededVariant | undefined;
  for (const [difficulty, variantId] of [
    ["child", childVariantId],
    ["adult", adultVariantId],
  ] as const) {
    const { grid } = previewQuiz(difficulty);
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
      quizSetId: "solution-route-set",
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
      solutionSha256: difficulty === "child" ? "c".repeat(64) : "a".repeat(64),
    });
    if (difficulty === "child") child = { canonicalCellIds, entryAnswers, solutionCells };
  }

  if (child === undefined) throw new Error("Missing child fixture");
  return child;
}

async function seedSession(options: { active?: boolean } = {}) {
  const token = generateSessionToken();
  const sessionHash = await hashSessionToken(token, binding.SESSION_PEPPER);
  await database.insert(anonymousSessions).values({
    sessionHash,
    createdAt: new Date(now.getTime() - 60_000).toISOString(),
    lastSeenAt: new Date(now.getTime() - 30_000).toISOString(),
    expiresAt: options.active === false
      ? new Date(now.getTime() - 1_000).toISOString()
      : new Date(now.getTime() + 60 * 60_000).toISOString(),
  });
  return { sessionHash, token };
}

async function seedSubmission(
  fixture: SeededVariant,
  sessionHash: string,
  options: {
    index: number;
    revision?: number;
    status?: "deleted" | "hidden" | "visible";
    variantId?: string;
  },
) {
  const status = options.status ?? "visible";
  await database.insert(submissions).values({
    id: `solution-submission-${options.index}`,
    quizVariantId: options.variantId ?? childVariantId,
    quizRevision: options.revision ?? 1,
    sessionHash,
    idempotencyKey: `01924f8e-7b2a-7f1c-8f3a-${options.index.toString(16).padStart(12, "0")}`,
    requestHash: options.index.toString(16).padStart(64, "0"),
    displayName: status === "deleted" ? null : "은혜",
    comment: status === "deleted" ? null : "정답 조회",
    answersJson: status === "deleted" ? null : { [fixture.canonicalCellIds[0]!]: "가" },
    correctnessMask: `1${"0".repeat(fixture.canonicalCellIds.length - 1)}`,
    correctCells: 1,
    totalCells: fixture.canonicalCellIds.length,
    correctWords: 0,
    totalWords: Object.keys(fixture.entryAnswers).length,
    scoreBasisPoints: Math.round(10_000 / fixture.canonicalCellIds.length),
    isFullyCorrect: false,
    status,
    submittedAt: new Date(now.getTime() + options.index).toISOString(),
    hiddenAt: status === "hidden" ? nowIso : null,
    deletedAt: status === "deleted" ? nowIso : null,
  });
}

function solutionRequest(token?: string, url = endpoint, method = "GET") {
  return new Request(url, {
    method,
    headers: token === undefined ? {} : { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
}

async function parseSolution(response: Response) {
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new Error("Missing solution response data");
  }
  return quizSolutionDataSchema.parse(body.data);
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

describe("quiz solution API", () => {
  it("requires an active exact-variant non-deleted submission while published", async () => {
    const fixture = await seedQuiz();
    expect((await exports.default.fetch(solutionRequest())).status).toBe(403);
    expect((await exports.default.fetch(solutionRequest("not-a-session"))).status).toBe(403);

    const unknown = generateSessionToken();
    expect((await exports.default.fetch(solutionRequest(unknown))).status).toBe(403);

    const expired = await seedSession({ active: false });
    await seedSubmission(fixture, expired.sessionHash, { index: 1 });
    expect((await exports.default.fetch(solutionRequest(expired.token))).status).toBe(403);

    const empty = await seedSession();
    expect((await exports.default.fetch(solutionRequest(empty.token))).status).toBe(403);

    const deleted = await seedSession();
    await seedSubmission(fixture, deleted.sessionHash, { index: 2, status: "deleted" });
    expect((await exports.default.fetch(solutionRequest(deleted.token))).status).toBe(403);

    const otherVariant = await seedSession();
    await seedSubmission(fixture, otherVariant.sessionHash, {
      index: 3,
      variantId: adultVariantId,
    });
    expect((await exports.default.fetch(solutionRequest(otherVariant.token))).status).toBe(403);
  });

  it.each(["visible", "hidden"] as const)("reveals a minimal answer to a %s owner", async (status) => {
    const fixture = await seedQuiz();
    const session = await seedSession();
    await seedSubmission(fixture, session.sessionHash, { index: status === "visible" ? 4 : 5, status });

    const response = await exports.default.fetch(solutionRequest(session.token));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const raw = await response.text();
    expect(raw).not.toContain("canonicalCellOrder");
    expect(raw).not.toContain("solutionSha256");
    expect(raw).not.toContain("test-admin-private");
    const body = JSON.parse(raw) as { data: unknown };
    expect(quizSolutionDataSchema.parse(body.data)).toEqual({
      quizVariantId: childVariantId,
      quizRevision: 1,
      solution: {
        cells: fixture.solutionCells,
        entries: fixture.entryAnswers,
      },
    });
  });

  it("reveals an archived answer publicly without reading a session", async () => {
    const fixture = await seedQuiz();
    await database.update(quizSets).set({
      status: "archived",
      closesAt: new Date(now.getTime() - 1_000).toISOString(),
      archivedAt: nowIso,
      updatedAt: nowIso,
    }).where(eq(quizSets.id, "solution-route-set"));

    const response = await exports.default.fetch(solutionRequest());
    expect(response.status).toBe(200);
    expect(await parseSolution(response)).toEqual({
      quizVariantId: childVariantId,
      quizRevision: 1,
      solution: { cells: fixture.solutionCells, entries: fixture.entryAnswers },
    });
  });

  it("uses lazy finalization before making a due published answer public", async () => {
    await seedQuiz();
    await database.update(quizSets).set({
      closesAt: new Date(Date.now() - 1_000).toISOString(),
    }).where(eq(quizSets.id, "solution-route-set"));

    const response = await exports.default.fetch(solutionRequest());
    expect(response.status).toBe(200);
    expect((await database.select({ status: quizSets.status }).from(quizSets))[0]?.status)
      .toBe("archived");
  });

  it("rejects invalid paths, query parameters, and methods without exposing answers", async () => {
    await seedQuiz();
    const invalidQuery = await exports.default.fetch(solutionRequest(
      undefined,
      `${endpoint}?include=checksum`,
    ));
    expect(invalidQuery.status).toBe(400);
    expect(await invalidQuery.text()).not.toContain("가가");

    const invalidDifficulty = await exports.default.fetch(solutionRequest(
      undefined,
      `https://example.com/api/quizzes/${slug}/expert/solution`,
    ));
    expect(invalidDifficulty.status).toBe(404);

    const method = await exports.default.fetch(solutionRequest(undefined, endpoint, "POST"));
    expect(method.status).toBe(405);
    expect(await method.text()).not.toContain("가가");
  });

  it("fails closed for a mismatched submission revision or damaged private solution", async () => {
    const fixture = await seedQuiz();
    const session = await seedSession();
    await seedSubmission(fixture, session.sessionHash, { index: 6, revision: 2 });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const revisionMismatch = await exports.default.fetch(solutionRequest(session.token));
      expect(revisionMismatch.status).toBe(503);
      expect(await revisionMismatch.text()).not.toContain("test-admin-private");

      await database.update(submissions).set({ quizRevision: 1 });
      await database.update(quizSolutions).set({
        entryAnswersJson: Object.fromEntries(
          Object.entries(fixture.entryAnswers).map(([id, answer]) => [id, "나".repeat(answer.length)]),
        ),
      }).where(eq(quizSolutions.quizVariantId, childVariantId));
      const damaged = await exports.default.fetch(solutionRequest(session.token));
      expect(damaged.status).toBe(503);
      const raw = await damaged.text();
      expect(raw).not.toContain("나나");
      expect(raw).not.toContain("solutionSha256");
      expect(JSON.stringify(log.mock.calls)).not.toContain("나나");
    } finally {
      log.mockRestore();
    }
  });
});
