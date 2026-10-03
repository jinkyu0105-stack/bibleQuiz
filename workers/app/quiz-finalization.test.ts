import { env, exports } from "cloudflare:workers";
import {
  createScheduledController,
} from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Difficulty } from "../../shared/api/public-quiz";
import { previewQuiz } from "../../src/features/quiz/preview-data";
import { createDatabase } from "../_shared/db/client";
import {
  anonymousSessions,
  auditLogs,
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
  QuizFinalizationInvalidState,
  QuizFinalizationNotDue,
  QuizFinalizationUnavailable,
  createQuizFinalizationService,
} from "../_shared/services/quiz-finalization";
import { createQuizFinalizationScheduler } from "../_shared/services/quiz-finalization-scheduler";
import {
  SESSION_COOKIE_NAME,
  generateSessionToken,
  hashSessionToken,
} from "../_shared/services/session";
import { createAccessFixture } from "./test/access-fixture";
import { runScheduledFinalization } from "./index";

const binding = env as Env & {
  ACCESS_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
  SESSION_PEPPER: string;
  TURNSTILE_EXPECTED_HOSTNAME: string;
  TURNSTILE_SECRET: string;
};
const database = createDatabase(binding.DB);
const openedAt = "2026-09-01T00:00:00.000Z";
const closesAt = "2026-09-02T00:00:00.000Z";
const finalizedAt = "2026-09-02T00:01:00.000Z";

interface SeedVariant {
  canonicalCellIds: readonly string[];
  difficulty: Difficulty;
  entryCount: number;
  id: string;
  revision: number;
  winnerCount: number;
}

async function seedQuizSet(
  suffix: string,
  options: {
    closesAt?: string;
    status?: "archived" | "draft" | "published";
    winnerCounts?: Partial<Record<Difficulty, number>>;
  } = {},
) {
  const translationId = `finalization-translation-${suffix}`;
  const sermonId = `finalization-sermon-${suffix}`;
  const quizSetId = `finalization-set-${suffix}`;
  const slug = `2026-09-01-${suffix.padEnd(6, "0").slice(0, 6)}`;
  const status = options.status ?? "published";
  await database.insert(bibleTranslations).values({
    id: translationId,
    displayName: "개역개정",
    edition: "reference-only",
    publisherOrRightsholder: "대한성서공회",
    mode: "reference_only",
    createdAt: openedAt,
    updatedAt: openedAt,
  });
  await database.insert(sermons).values({
    id: sermonId,
    slug,
    slugSuffix: suffix.padEnd(6, "0").slice(0, 6),
    churchName: "다사랑교회",
    sermonTitle: "마감 서비스 시험",
    sermonDate: "2026-09-01",
    bibleTranslationId: translationId,
    bibleReferenceJson: [],
    bibleReferenceLabel: "마태복음 5:1-2",
    youtubeVideoId: `finalization-video-${suffix}`,
    youtubeUrl: `https://example.com/watch/${suffix}`,
    createdAt: openedAt,
    updatedAt: openedAt,
  });
  await database.insert(quizSets).values({
    id: quizSetId,
    sermonId,
    status,
    createdBy: "test-admin",
    publishedAt: openedAt,
    opensAt: openedAt,
    closesAt: options.closesAt ?? closesAt,
    archivedAt: status === "archived" ? finalizedAt : null,
    createdAt: openedAt,
    updatedAt: openedAt,
  });

  const variants: SeedVariant[] = [];
  for (const difficulty of ["child", "adult"] as const) {
    const { grid } = previewQuiz(difficulty);
    const id = `finalization-${difficulty}-${suffix}`;
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
    const winnerCount = options.winnerCounts?.[difficulty] ?? 3;
    await database.insert(quizVariants).values({
      id,
      quizSetId,
      difficulty,
      revision: 1,
      gridSize: grid.gridSize,
      publicGridJson: { size: grid.gridSize, cells: publicCells },
      wordCount: grid.entries.length,
      activeCellCount: grid.cells.length,
      intersectionCount: grid.entries.reduce((sum, entry) => sum + entry.length, 0) - grid.cells.length,
      winnerCount,
      validationReportJson: { errors: [], warnings: [], generatedAt: openedAt },
      createdAt: openedAt,
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
      canonicalCellOrderJson: canonicalCellIds,
      solutionCellsJson: Object.fromEntries(canonicalCellIds.map((cellId) => [cellId, "가"])),
      entryAnswersJson: Object.fromEntries(
        grid.entries.map((entry) => [`${id}-${entry.id}`, "가".repeat(entry.length)]),
      ),
      solutionSha256: "a".repeat(64),
    });
    variants.push({
      canonicalCellIds,
      difficulty,
      entryCount: grid.entries.length,
      id,
      revision: 1,
      winnerCount,
    });
  }
  return { quizSetId, slug, variants };
}

async function seedSubmission(
  variant: SeedVariant,
  index: number,
  options: {
    fullyCorrect?: boolean;
    sessionHash?: string;
    status?: "deleted" | "hidden" | "visible";
    submittedAt?: string;
  } = {},
) {
  const status = options.status ?? "visible";
  const fullyCorrect = options.fullyCorrect ?? true;
  const sessionHash = options.sessionHash ?? index.toString(16).padStart(64, "0");
  const id = `finalization-submission-${variant.difficulty}-${index}`;
  await database.insert(anonymousSessions).values({
    sessionHash,
    createdAt: openedAt,
    lastSeenAt: openedAt,
    expiresAt: "2027-09-01T00:00:00.000Z",
  });
  const answers = fullyCorrect
    ? Object.fromEntries(variant.canonicalCellIds.map((cellId) => [cellId, "가"]))
    : { [variant.canonicalCellIds[0]!]: "가" };
  const correctCells = fullyCorrect ? variant.canonicalCellIds.length : 1;
  await database.insert(submissions).values({
    id,
    quizVariantId: variant.id,
    quizRevision: variant.revision,
    sessionHash,
    idempotencyKey: `01924f8e-7b2a-7f1c-8f3a-${index.toString(16).padStart(12, "0")}`,
    requestHash: index.toString(16).padStart(64, "0"),
    displayName: status === "deleted" ? null : `참여${index}`,
    comment: null,
    answersJson: status === "deleted" ? null : answers,
    correctnessMask: fullyCorrect
      ? "1".repeat(variant.canonicalCellIds.length)
      : `1${"0".repeat(variant.canonicalCellIds.length - 1)}`,
    correctCells,
    totalCells: variant.canonicalCellIds.length,
    correctWords: fullyCorrect ? variant.entryCount : 0,
    totalWords: variant.entryCount,
    scoreBasisPoints: Math.round(correctCells * 10_000 / variant.canonicalCellIds.length),
    isFullyCorrect: fullyCorrect,
    status,
    submittedAt: options.submittedAt ?? `2026-09-01T23:00:${index.toString().padStart(2, "0")}.000Z`,
    hiddenAt: status === "hidden" ? finalizedAt : null,
    deletedAt: status === "deleted" ? finalizedAt : null,
  });
  return id;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await database.delete(leaderboardSnapshotEntries);
  await database.delete(leaderboardSnapshots);
  await database.delete(auditLogs);
  await database.delete(submissions);
  await database.delete(anonymousSessions);
  await database.delete(quizSolutions);
  await database.delete(siteState);
  await database.delete(quizSets);
  await database.delete(sermons);
  await database.delete(bibleTranslations);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quiz finalization / isolated migrated D1", () => {
  it("enforces audit actor and safe metadata constraints in migrated D1", async () => {
    await expect(database.insert(auditLogs).values({
      action: "close_now",
      actorType: "access_admin",
      actorEmail: null,
      createdAt: finalizedAt,
      entityId: "set-1",
      entityType: "quiz_set",
      id: "invalid-audit-identity",
      safeMetadataJson: { reason: "test" },
    })).rejects.toThrow();
    await expect(database.insert(auditLogs).values({
      action: "close_now",
      actorType: "system",
      actorEmail: null,
      createdAt: finalizedAt,
      entityId: "set-1",
      entityType: "quiz_set",
      id: "valid-system-audit",
      safeMetadataJson: { outcome: "scheduled" },
    })).resolves.toBeDefined();
  });

  it("atomically snapshots exact visible winners for both difficulties and archives the set", async () => {
    const { quizSetId, variants } = await seedQuizSet("basic1", {
      winnerCounts: { adult: 1, child: 2 },
    });
    const child = variants.find((variant) => variant.difficulty === "child")!;
    const adult = variants.find((variant) => variant.difficulty === "adult")!;
    const childFirst = await seedSubmission(child, 1);
    const childSecond = await seedSubmission(child, 2);
    await seedSubmission(child, 3);
    await seedSubmission(child, 4, { status: "hidden", submittedAt: "2026-09-01T22:00:00.000Z" });
    await seedSubmission(child, 5, { fullyCorrect: false, submittedAt: "2026-09-01T21:00:00.000Z" });
    const adultFirst = await seedSubmission(adult, 6);
    await seedSubmission(adult, 7);

    const result = await createQuizFinalizationService(database, {
      snapshotId: (variantId) => `snapshot-${variantId}`,
    }).finalizeDueQuizSet(quizSetId, new Date(finalizedAt));

    expect(result).toEqual({
      archivedAt: finalizedAt,
      outcome: "finalized",
      quizSetId,
      snapshots: [
        {
          quizVariantId: adult.id,
          winnerCount: 1,
          winnerSubmissionIds: [adultFirst],
        },
        {
          quizVariantId: child.id,
          winnerCount: 2,
          winnerSubmissionIds: [childFirst, childSecond],
        },
      ],
    });
    await expect(database.select({ status: quizSets.status, archivedAt: quizSets.archivedAt })
      .from(quizSets).where(eq(quizSets.id, quizSetId))).resolves.toEqual([
      { status: "archived", archivedAt: finalizedAt },
    ]);
  });

  it("converges concurrent and repeated finalization on one immutable snapshot", async () => {
    const { quizSetId, variants } = await seedQuizSet("race01");
    await seedSubmission(variants[0]!, 11);
    const first = createQuizFinalizationService(database, {
      snapshotId: (variantId) => `first-${variantId}`,
    });
    const second = createQuizFinalizationService(database, {
      snapshotId: (variantId) => `second-${variantId}`,
    });

    const results = await Promise.all([
      first.finalizeDueQuizSet(quizSetId, new Date(finalizedAt)),
      second.finalizeDueQuizSet(quizSetId, new Date(finalizedAt)),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["finalized", "replayed"]);
    expect(await database.select().from(leaderboardSnapshots)).toHaveLength(2);
    expect(await database.select().from(leaderboardSnapshotEntries)).toHaveLength(1);

    const replay = await first.finalizeDueQuizSet(
      quizSetId,
      new Date("2026-09-03T00:00:00.000Z"),
    );
    expect(replay.outcome).toBe("replayed");
    expect(replay.archivedAt).toBe(finalizedAt);
    expect(await database.select().from(leaderboardSnapshots)).toHaveLength(2);
  });

  it("forces a future published set closed with one atomic administrator audit record", async () => {
    const target = await seedQuizSet("admin1", {
      closesAt: "2026-09-03T00:00:00.000Z",
    });
    await seedSubmission(target.variants[0]!, 12);
    const service = createQuizFinalizationService(database, {
      snapshotId: (variantId) => `admin-snapshot-${variantId}`,
    });
    const result = await service.closeQuizSetNow(target.quizSetId, {
      actorEmail: "admin@example.com",
      auditId: "audit-close-admin1",
      reason: "운영자 확인 후 조기 마감",
    }, new Date(finalizedAt));

    expect(result.outcome).toBe("finalized");
    expect(await database.select({
      archivedAt: quizSets.archivedAt,
      closesAt: quizSets.closesAt,
      status: quizSets.status,
    }).from(quizSets).where(eq(quizSets.id, target.quizSetId))).toEqual([{
      archivedAt: finalizedAt,
      closesAt: finalizedAt,
      status: "archived",
    }]);
    expect(await database.select().from(auditLogs)).toEqual([
      expect.objectContaining({
        action: "close_now",
        actorEmail: "admin@example.com",
        actorType: "access_admin",
        createdAt: finalizedAt,
        entityId: target.quizSetId,
        entityType: "quiz_set",
        safeMetadataJson: {
          previousClosesAt: "2026-09-03T00:00:00.000Z",
          reason: "운영자 확인 후 조기 마감",
        },
      }),
    ]);

    const replay = await service.closeQuizSetNow(target.quizSetId, {
      actorEmail: "admin@example.com",
      auditId: "audit-close-replay",
      reason: "반복 요청",
    }, new Date("2026-09-04T00:00:00.000Z"));
    expect(replay).toMatchObject({ archivedAt: finalizedAt, outcome: "replayed" });
    expect(await database.select().from(auditLogs)).toHaveLength(1);

    await expect(service.closeQuizSetNow(target.quizSetId, {
      actorEmail: "admin@example.com",
      auditId: "audit-close-invalid-reason",
      reason: "잘못된\n사유",
    }, new Date("2026-09-04T00:00:00.000Z")))
      .rejects.toThrowError(QuizFinalizationUnavailable);
  });

  it("rolls back forced close time, snapshots and audit when finalization validation fails", async () => {
    const originalClose = "2026-09-03T00:00:00.000Z";
    const target = await seedQuizSet("adminbad", { closesAt: originalClose });
    const submissionId = await seedSubmission(target.variants[0]!, 13);
    await database.update(submissions).set({
      answersJson: { [target.variants[0]!.canonicalCellIds[0]!]: "나" },
    }).where(eq(submissions.id, submissionId));

    await expect(createQuizFinalizationService(database).closeQuizSetNow(
      target.quizSetId,
      {
        actorEmail: "admin@example.com",
        auditId: "audit-close-damaged",
        reason: "손상된 자료 마감 시도",
      },
      new Date(finalizedAt),
    )).rejects.toThrowError(QuizFinalizationUnavailable);
    expect(await database.select({ closesAt: quizSets.closesAt, status: quizSets.status })
      .from(quizSets).where(eq(quizSets.id, target.quizSetId)))
      .toEqual([{ closesAt: originalClose, status: "published" }]);
    expect(await database.select().from(leaderboardSnapshots)).toHaveLength(0);
    expect(await database.select().from(auditLogs)).toHaveLength(0);
  });

  it("does not finalize a set before its close or from a non-published state", async () => {
    const future = await seedQuizSet("future", {
      closesAt: "2026-09-03T00:00:00.000Z",
    });
    await expect(createQuizFinalizationService(database).finalizeDueQuizSet(
      future.quizSetId,
      new Date(finalizedAt),
    )).rejects.toThrowError(QuizFinalizationNotDue);

    const draft = await seedQuizSet("draft1", { status: "draft" });
    await expect(createQuizFinalizationService(database).finalizeDueQuizSet(
      draft.quizSetId,
      new Date(finalizedAt),
    )).rejects.toThrowError(QuizFinalizationInvalidState);
    expect(await database.select().from(leaderboardSnapshots)).toHaveLength(0);
  });

  it("fails closed before archiving when a stored answer no longer matches its score", async () => {
    const { quizSetId, variants } = await seedQuizSet("damage");
    const submissionId = await seedSubmission(variants[0]!, 21);
    await database.update(submissions).set({
      answersJson: { [variants[0]!.canonicalCellIds[0]!]: "나" },
    }).where(eq(submissions.id, submissionId));

    await expect(createQuizFinalizationService(database).finalizeDueQuizSet(
      quizSetId,
      new Date(finalizedAt),
    )).rejects.toThrowError(QuizFinalizationUnavailable);
    expect(await database.select().from(leaderboardSnapshots)).toHaveLength(0);
    expect(await database.select({ status: quizSets.status }).from(quizSets)
      .where(eq(quizSets.id, quizSetId))).toEqual([{ status: "published" }]);
  });

  it("rolls back every target snapshot when any statement in the batch fails", async () => {
    const unrelated = await seedQuizSet("other1", { status: "archived" });
    await database.insert(leaderboardSnapshots).values({
      id: "forced-collision",
      quizVariantId: unrelated.variants[0]!.id,
      winnerCount: unrelated.variants[0]!.winnerCount,
      finalizedAt,
    });
    const target = await seedQuizSet("target");
    const adult = target.variants.find((variant) => variant.difficulty === "adult")!;
    const child = target.variants.find((variant) => variant.difficulty === "child")!;

    await expect(createQuizFinalizationService(database, {
      snapshotId: (variantId) => variantId === child.id
        ? "forced-collision"
        : `snapshot-${variantId}`,
    }).finalizeDueQuizSet(target.quizSetId, new Date(finalizedAt)))
      .rejects.toThrowError(QuizFinalizationUnavailable);

    expect(await database.select().from(leaderboardSnapshots)
      .where(inArray(leaderboardSnapshots.quizVariantId, [adult.id, child.id])))
      .toHaveLength(0);
    expect(await database.select({ status: quizSets.status }).from(quizSets)
      .where(eq(quizSets.id, target.quizSetId))).toEqual([{ status: "published" }]);
  });

  it("lazy-finalizes concurrent first public quiz and board reads", async () => {
    vi.useFakeTimers({ now: new Date(finalizedAt) });
    const target = await seedQuizSet("lazy01");
    await database.update(quizSets).set({
      submissionState: "paused",
      submissionPausedAt: openedAt,
      submissionPauseReason: "마감 전 확인 중",
    }).where(eq(quizSets.id, target.quizSetId));
    await database.insert(siteState).values({
      key: "featured_quiz_set_id",
      value: target.quizSetId,
      updatedAt: openedAt,
    });

    const [quizResponse, boardResponse] = await Promise.all([
      exports.default.fetch(new Request(
        "https://example.com/api/quizzes/latest?difficulty=child",
      )),
      exports.default.fetch(new Request(
        `https://example.com/api/quizzes/${target.slug}/adult/board`,
      )),
    ]);

    expect(quizResponse.status).toBe(200);
    expect(await quizResponse.json()).toMatchObject({
      data: {
        quiz: {
          availability: "archived",
          mode: "practice",
          quizSetId: target.quizSetId,
          status: "archived",
        },
      },
    });
    expect(boardResponse.status).toBe(200);
    expect(await boardResponse.json()).toMatchObject({
      data: { participants: [], winners: [] },
    });
    expect(await database.select().from(leaderboardSnapshots)
      .where(inArray(
        leaderboardSnapshots.quizVariantId,
        target.variants.map((variant) => variant.id),
      ))).toHaveLength(2);
    expect(await database.select({ status: quizSets.status, archivedAt: quizSets.archivedAt })
      .from(quizSets).where(eq(quizSets.id, target.quizSetId)))
      .toEqual([{ status: "archived", archivedAt: finalizedAt }]);
  });

  it("uses the same lazy archive state for own read, deletion and submission routes", async () => {
    vi.useFakeTimers({ now: new Date(finalizedAt) });

    const ownTarget = await seedQuizSet("lazyme");
    const ownResponse = await exports.default.fetch(new Request(
      `https://example.com/api/quizzes/${ownTarget.slug}/child/me`,
    ));
    expect(ownResponse.status).toBe(200);
    expect(await ownResponse.json()).toEqual({ data: { submission: null } });

    const deleteTarget = await seedQuizSet("lazydel");
    const deleteChild = deleteTarget.variants.find((variant) => variant.difficulty === "child")!;
    const deleteToken = generateSessionToken();
    const deleteSessionHash = await hashSessionToken(deleteToken, binding.SESSION_PEPPER);
    const deletedSubmissionId = await seedSubmission(deleteChild, 31, {
      sessionHash: deleteSessionHash,
    });
    const deleteResponse = await exports.default.fetch(new Request(
      `https://example.com/api/quizzes/${deleteTarget.slug}/child/me/submission`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE_NAME}=${deleteToken}`,
          Origin: "https://example.com",
        },
        body: "{}",
      },
    ));
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toMatchObject({
      data: { submission: { status: "deleted" } },
    });
    expect(await database.select({ status: submissions.status }).from(submissions)
      .where(eq(submissions.id, deletedSubmissionId)))
      .toEqual([{ status: "deleted" }]);

    const submitTarget = await seedQuizSet("lazysub");
    const submitChild = submitTarget.variants.find((variant) => variant.difficulty === "child")!;
    const submitToken = generateSessionToken();
    await database.insert(anonymousSessions).values({
      sessionHash: await hashSessionToken(submitToken, binding.SESSION_PEPPER),
      createdAt: openedAt,
      lastSeenAt: openedAt,
      expiresAt: "2027-09-01T00:00:00.000Z",
    });
    const verification = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({
      success: true,
      hostname: "example.com",
      action: "quiz_submission",
      challenge_ts: finalizedAt,
    }));
    const submitResponse = await exports.default.fetch(new Request(
      `https://example.com/api/quizzes/${submitTarget.slug}/child/submissions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE_NAME}=${submitToken}`,
          Origin: "https://example.com",
        },
        body: JSON.stringify({
          revision: 1,
          idempotencyKey: "01924f8e-7b2a-7f1c-8f3a-123456789abc",
          turnstileToken: "turnstile-token-private",
          name: "은혜",
          comment: "",
          consent: true,
          cells: { [submitChild.canonicalCellIds[0]!]: "가" },
        }),
      },
    ));
    expect(submitResponse.status).toBe(409);
    expect(await submitResponse.json()).toMatchObject({ error: { code: "QUIZ_CLOSED" } });
    expect(verification).toHaveBeenCalledOnce();
    expect(await database.select().from(submissions)
      .where(eq(submissions.quizVariantId, submitChild.id))).toHaveLength(0);

    for (const target of [ownTarget, deleteTarget, submitTarget]) {
      expect(await database.select({ status: quizSets.status }).from(quizSets)
        .where(eq(quizSets.id, target.quizSetId)))
        .toEqual([{ status: "archived" }]);
    }
  });

  it("fails a public lazy read closed without exposing damaged finalization data", async () => {
    vi.useFakeTimers({ now: new Date(finalizedAt) });
    const target = await seedQuizSet("lazybad");
    const child = target.variants.find((variant) => variant.difficulty === "child")!;
    const submissionId = await seedSubmission(child, 41);
    await database.update(submissions).set({
      answersJson: { [child.canonicalCellIds[0]!]: "나" },
    }).where(eq(submissions.id, submissionId));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await exports.default.fetch(new Request(
      `https://example.com/api/quizzes/${target.slug}?difficulty=child`,
    ));
    const raw = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(raw)).toMatchObject({
      error: { code: "QUIZ_UNAVAILABLE", requestId: expect.any(String) },
    });
    expect(raw).not.toContain("나");
    expect(JSON.stringify(log.mock.calls)).not.toContain("나");
    expect(await database.select().from(leaderboardSnapshots)
      .where(inArray(
        leaderboardSnapshots.quizVariantId,
        target.variants.map((variant) => variant.id),
      ))).toHaveLength(0);
    expect(await database.select({ status: quizSets.status }).from(quizSets)
      .where(eq(quizSets.id, target.quizSetId)))
      .toEqual([{ status: "published" }]);
  });

  it("runs the Worker scheduled boundary, isolates damaged sets and leaves future sets alone", async () => {
    const good = await seedQuizSet("sched1");
    const damaged = await seedQuizSet("sched2");
    const future = await seedQuizSet("sched3", { closesAt: "2026-09-03T00:00:00.000Z" });
    const damagedSubmission = await seedSubmission(damaged.variants[0]!, 51);
    await database.update(submissions).set({
      answersJson: { [damaged.variants[0]!.canonicalCellIds[0]!]: "나" },
    }).where(eq(submissions.id, damagedSubmission));

    const summary = await createQuizFinalizationScheduler(database).run(new Date(finalizedAt));
    expect(summary).toEqual({ discovered: 2, failed: 1, finalized: 1, replayed: 0 });
    expect(await database.select({ id: quizSets.id, status: quizSets.status }).from(quizSets)
      .where(inArray(quizSets.id, [good.quizSetId, damaged.quizSetId, future.quizSetId])))
      .toEqual(expect.arrayContaining([
        { id: good.quizSetId, status: "archived" },
        { id: damaged.quizSetId, status: "published" },
        { id: future.quizSetId, status: "published" },
      ]));

    const boundary = await seedQuizSet("sched4");
    const controller = createScheduledController({ scheduledTime: Date.parse(finalizedAt) });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runScheduledFinalization(controller, {...binding,OPERATIONS_CRON_ENABLED:"true",DRAFT_CLEANUP_ENABLED:"false"})).rejects.toThrow("QUIZ_FINALIZATION_SCHEDULE_FAILED");
    expect(await database.select({ status: quizSets.status }).from(quizSets)
      .where(eq(quizSets.id, boundary.quizSetId))).toEqual([{ status: "archived" }]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(boundary.quizSetId);
  });

  it("requires Access and strictly closes through the administrator route without exposing audit identity", async () => {
    vi.useFakeTimers({ now: new Date(finalizedAt) });
    const target = await seedQuizSet("route1", { closesAt: "2026-09-03T00:00:00.000Z" });
    const fixture = await createAccessFixture(new Date(finalizedAt));
    const certs = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.jwks));

    const unauthorized = await exports.default.fetch(new Request(
      `https://example.com/api/admin/quiz-sets/${target.quizSetId}/close-now`,
      {
        body: JSON.stringify({ confirmation: "close_now", reason: "관리자 조기 마감" }),
        headers: { "Content-Type": "application/json", Origin: "https://example.com" },
        method: "POST",
      },
    ));
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toMatchObject({ error: { code: "ADMIN_AUTH_REQUIRED" } });
    expect(certs).not.toHaveBeenCalled();

    const response = await exports.default.fetch(new Request(
      `https://example.com/api/admin/quiz-sets/${target.quizSetId}/close-now`,
      {
        body: JSON.stringify({ confirmation: "close_now", reason: "관리자 조기 마감" }),
        headers: {
          "Cf-Access-Jwt-Assertion": fixture.token,
          "Content-Type": "application/json",
          Origin: "https://example.com",
        },
        method: "POST",
      },
    ));
    const raw = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(raw)).toMatchObject({
      data: {
        archivedAt: finalizedAt,
        outcome: "finalized",
        quizSetId: target.quizSetId,
        snapshots: [{ winnerSubmissionCount: 0 }, { winnerSubmissionCount: 0 }],
      },
    });
    expect(raw).not.toContain("admin@example.com");
    expect(raw).not.toContain("관리자 조기 마감");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await database.select().from(auditLogs)).toHaveLength(1);

    const replay = await exports.default.fetch(new Request(
      `https://example.com/api/admin/quiz-sets/${target.quizSetId}/close-now`,
      {
        body: JSON.stringify({ confirmation: "close_now", reason: "반복 확인" }),
        headers: {
          "Cf-Access-Jwt-Assertion": fixture.token,
          "Content-Type": "application/json",
          Origin: "https://example.com",
        },
        method: "POST",
      },
    ));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ data: { outcome: "replayed" } });
    expect(await database.select().from(auditLogs)).toHaveLength(1);
  });

  it("rejects invalid close-now transport, target and state before any finalization write", async () => {
    vi.useFakeTimers({ now: new Date(finalizedAt) });
    const published = await seedQuizSet("stpub1", { closesAt: "2026-09-03T00:00:00.000Z" });
    const draft = await seedQuizSet("stdraf", { status: "draft" });
    const fixture = await createAccessFixture(new Date(finalizedAt));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.jwks));
    const headers = {
      "Cf-Access-Jwt-Assertion": fixture.token,
      "Content-Type": "application/json",
      Origin: "https://example.com",
    };
    const call = (url: string, body: unknown, overrides: RequestInit = {}) => exports.default.fetch(
      new Request(url, {
        body: JSON.stringify(body),
        headers,
        method: "POST",
        ...overrides,
      }),
    );

    const extra = await call(
      `https://example.com/api/admin/quiz-sets/${published.quizSetId}/close-now`,
      { confirmation: "close_now", reason: "형식 검사", actorEmail: "attacker@example.com" },
    );
    expect(extra.status).toBe(400);
    const query = await call(
      `https://example.com/api/admin/quiz-sets/${published.quizSetId}/close-now?force=1`,
      { confirmation: "close_now", reason: "검색 조건 검사" },
    );
    expect(query.status).toBe(400);
    const origin = await call(
      `https://example.com/api/admin/quiz-sets/${published.quizSetId}/close-now`,
      { confirmation: "close_now", reason: "출처 검사" },
      { headers: { ...headers, Origin: "https://attacker.example" } },
    );
    expect(origin.status).toBe(403);
    const invalidState = await call(
      `https://example.com/api/admin/quiz-sets/${draft.quizSetId}/close-now`,
      { confirmation: "close_now", reason: "상태 검사" },
    );
    expect(invalidState.status).toBe(409);
    await expect(invalidState.json()).resolves.toMatchObject({ error: { code: "QUIZ_SET_NOT_PUBLISHED" } });
    const missing = await call(
      "https://example.com/api/admin/quiz-sets/missing-set/close-now",
      { confirmation: "close_now", reason: "대상 검사" },
    );
    expect(missing.status).toBe(404);
    const unauthenticatedMethod = await exports.default.fetch(new Request(
      `https://example.com/api/admin/quiz-sets/${published.quizSetId}/close-now`,
      { method: "GET" },
    ));
    expect(unauthenticatedMethod.status).toBe(401);
    const authenticatedMethod = await exports.default.fetch(new Request(
      `https://example.com/api/admin/quiz-sets/${published.quizSetId}/close-now`,
      {
        headers: { "Cf-Access-Jwt-Assertion": fixture.token },
        method: "GET",
      },
    ));
    expect(authenticatedMethod.status).toBe(405);

    expect(await database.select().from(auditLogs)).toHaveLength(0);
    expect(await database.select().from(leaderboardSnapshots)).toHaveLength(0);
    expect(await database.select({ closesAt: quizSets.closesAt, status: quizSets.status })
      .from(quizSets).where(eq(quizSets.id, published.quizSetId)))
      .toEqual([{ closesAt: "2026-09-03T00:00:00.000Z", status: "published" }]);
  });

  it("converges scheduled, lazy and administrator finalization on one snapshot", async () => {
    vi.useFakeTimers({ now: new Date(finalizedAt) });
    const target = await seedQuizSet("allrce");
    const fixture = await createAccessFixture(new Date(finalizedAt));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.jwks));
    const adminRequest = new Request(
      `https://example.com/api/admin/quiz-sets/${target.quizSetId}/close-now`,
      {
        body: JSON.stringify({ confirmation: "close_now", reason: "경쟁 상태 마감" }),
        headers: {
          "Cf-Access-Jwt-Assertion": fixture.token,
          "Content-Type": "application/json",
          Origin: "https://example.com",
        },
        method: "POST",
      },
    );

    const [scheduled, lazy, admin] = await Promise.all([
      createQuizFinalizationScheduler(database).run(new Date(finalizedAt)),
      exports.default.fetch(new Request(
        `https://example.com/api/quizzes/${target.slug}?difficulty=child`,
      )),
      exports.default.fetch(adminRequest),
    ]);
    expect(scheduled.failed).toBe(0);
    expect(lazy.status).toBe(200);
    expect(admin.status).toBe(200);
    expect(await database.select().from(leaderboardSnapshots)).toHaveLength(2);
    expect(await database.select({ archivedAt: quizSets.archivedAt, status: quizSets.status })
      .from(quizSets).where(eq(quizSets.id, target.quizSetId)))
      .toEqual([{ archivedAt: finalizedAt, status: "archived" }]);
    expect((await database.select().from(auditLogs)).length).toBeLessThanOrEqual(1);
  });
});
