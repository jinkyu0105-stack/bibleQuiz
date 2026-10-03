import { blankExportSchema, topNExportSchema } from "../../shared/api/quiz-export";
import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { participationBoardDataSchema } from "../../shared/api/participation-board";
import { previewQuiz } from "../../src/features/quiz/preview-data";
import { createDatabase } from "../_shared/db/client";
import {
  anonymousSessions,
  auditLogs,
  bibleTranslations,
  leaderboardSnapshotEntries,
  leaderboardSnapshots,
  moderationActions,
  quizEntriesPublic,
  quizSolutions,
  quizSets,
  quizVariants,
  sermons,
  siteState,
  submissions,
} from "../_shared/db/schema";
import { createSubmissionModerationService } from "../_shared/services/submission-moderation";
import {
  SESSION_COOKIE_NAME,
  generateSessionToken,
  hashSessionToken,
} from "../_shared/services/session";

const binding = env as Env & { SESSION_PEPPER: string };
const database = createDatabase(binding.DB);
const now = new Date();
const nowIso = now.toISOString();
const slug = "2026-09-02-board1";
const variantId = "participation-board-child";
const adultVariantId = "participation-board-adult";
const endpoint = `https://example.com/api/quizzes/${slug}/child/board`;

interface SeedSubmissionOptions {
  answers?: Record<string, string>;
  comment?: string | null;
  displayName?: string;
  fullyCorrect?: boolean;
  id: string;
  index: number;
  sessionHash: string;
  status?: "deleted" | "hidden" | "visible";
  submittedAt?: string;
  targetVariantId?: string;
}

async function seedQuiz(options: {
  resultsStatus?: "non_ranked_correction" | "valid";
  status?: "archived" | "published";
  winnerCount?: number;
} = {}) {
  const { grid } = previewQuiz("child");
  const status = options.status ?? "published";
  const winnerCount = options.winnerCount ?? 3;
  const canonicalCellIds = grid.cells.map((cell) => cell.id);
  await database.insert(bibleTranslations).values({
    id: "participation-board-translation",
    displayName: "개역개정",
    edition: "reference-only",
    publisherOrRightsholder: "대한성서공회",
    mode: "reference_only",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await database.insert(sermons).values({
    id: "participation-board-sermon",
    slug,
    slugSuffix: "board1",
    churchName: "다사랑교회",
    sermonTitle: "참여 현황 시험",
    sermonDate: "2026-09-02",
    bibleTranslationId: "participation-board-translation",
    bibleReferenceJson: [],
    bibleReferenceLabel: "마태복음 5:1-2",
    youtubeVideoId: "participation-board-video",
    youtubeUrl: "https://example.com/watch/participation-board",
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await database.insert(quizSets).values({
    id: "participation-board-set",
    sermonId: "participation-board-sermon",
    status,
    createdBy: "test-admin",
    publishedAt: new Date(now.getTime() - 120_000).toISOString(),
    opensAt: new Date(now.getTime() - 60_000).toISOString(),
    closesAt: status === "archived"
      ? new Date(now.getTime() - 1_000).toISOString()
      : new Date(now.getTime() + 60 * 60_000).toISOString(),
    archivedAt: status === "archived" ? nowIso : null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  const publicCells = Array.from({ length: grid.gridSize ** 2 }, (_, index) => {
    const row = Math.floor(index / grid.gridSize);
    const column = index % grid.gridSize;
    const publicCell = grid.cells.find((cell) =>
      cell.row === row && cell.column === column
    );
    const across = grid.entries.find((entry) =>
      entry.direction === "across" &&
      entry.start.row === row &&
      entry.start.column === column
    );
    const down = grid.entries.find((entry) =>
      entry.direction === "down" &&
      entry.start.row === row &&
      entry.start.column === column
    );
    return {
      row,
      column,
      isBlocked: publicCell === undefined,
      ...(across === undefined ? {} : { acrossNumber: across.number }),
      ...(down === undefined ? {} : { downNumber: down.number }),
    };
  });
  const variant = {
    quizSetId: "participation-board-set",
    revision: 1,
    gridSize: grid.gridSize,
    publicGridJson: { size: grid.gridSize, cells: publicCells },
    wordCount: grid.entries.length,
    activeCellCount: grid.cells.length,
    intersectionCount: grid.entries.reduce((sum, entry) => sum + entry.length, 0) - grid.cells.length,
    winnerCount,
    validationReportJson: { errors: [], warnings: [], generatedAt: nowIso },
    createdAt: nowIso,
  };
  await database.insert(quizVariants).values({
    ...variant,
    id: variantId,
    difficulty: "child",
    resultsStatus: options.resultsStatus ?? "valid",
  });
  await database.insert(quizVariants).values({
    ...variant,
    id: adultVariantId,
    difficulty: "adult",
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
  await database.insert(quizEntriesPublic).values(grid.entries.map((entry, displayOrder) => ({
    id: `${adultVariantId}-${entry.id}`, quizVariantId: adultVariantId, number: entry.number,
    direction: entry.direction, startRow: entry.start.row, startCol: entry.start.column,
    length: entry.length, clue: entry.clue!, displayOrder,
  })));
  await database.insert(quizSolutions).values({
    quizVariantId: variantId,
    canonicalCellOrderJson: canonicalCellIds,
    solutionCellsJson: Object.fromEntries(canonicalCellIds.map((cellId) => [cellId, "가"])),
    entryAnswersJson: Object.fromEntries(
      grid.entries.map((entry) => [`${variantId}-${entry.id}`, "가".repeat(entry.length)]),
    ),
    solutionSha256: "0".repeat(64),
  });
  return { canonicalCellIds, entryCount: grid.entries.length };
}

async function seedSession(index: number, active = true) {
  const token = generateSessionToken();
  const sessionHash = await hashSessionToken(token, binding.SESSION_PEPPER);
  await database.insert(anonymousSessions).values({
    sessionHash,
    createdAt: new Date(now.getTime() - 120_000).toISOString(),
    lastSeenAt: new Date(now.getTime() - 60_000).toISOString(),
    expiresAt: active
      ? new Date(now.getTime() + 60 * 60_000 + index).toISOString()
      : new Date(now.getTime() - 1_000 - index).toISOString(),
  });
  return { sessionHash, token };
}

async function seedSubmission(
  canonicalCellIds: readonly string[],
  entryCount: number,
  options: SeedSubmissionOptions,
) {
  const fullyCorrect = options.fullyCorrect ?? false;
  const status = options.status ?? "visible";
  const answers = options.answers ?? (fullyCorrect
    ? Object.fromEntries(canonicalCellIds.map((id) => [id, "가"]))
    : { [canonicalCellIds[0]!]: "가" });
  const correctCells = fullyCorrect ? canonicalCellIds.length : 1;
  await database.insert(submissions).values({
    id: options.id,
    quizVariantId: options.targetVariantId ?? variantId,
    quizRevision: 1,
    sessionHash: options.sessionHash,
    idempotencyKey: `01924f8e-7b2a-7f1c-8f3a-${options.index.toString(16).padStart(12, "0")}`,
    requestHash: options.index.toString(16).padStart(64, "0"),
    displayName: status === "deleted" ? null : (options.displayName ?? `참여${options.index}`),
    comment: status === "deleted" ? null : (options.comment ?? null),
    answersJson: status === "deleted" ? null : answers,
    correctnessMask: fullyCorrect
      ? "1".repeat(canonicalCellIds.length)
      : `1${"0".repeat(canonicalCellIds.length - 1)}`,
    correctCells,
    totalCells: canonicalCellIds.length,
    correctWords: fullyCorrect ? entryCount : 0,
    totalWords: entryCount,
    scoreBasisPoints: Math.round((correctCells / canonicalCellIds.length) * 10_000),
    isFullyCorrect: fullyCorrect,
    status,
    submittedAt: options.submittedAt ?? new Date(now.getTime() + options.index).toISOString(),
    hiddenAt: status === "hidden" ? nowIso : null,
    deletedAt: status === "deleted" ? nowIso : null,
  });
}

function boardRequest(token?: string, url = endpoint, method = "GET") {
  return new Request(url, {
    method,
    headers: token === undefined ? {} : { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
}

async function parseBoardResponse(response: Response) {
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new Error("Missing board response data");
  }
  return participationBoardDataSchema.parse(body.data);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await database.delete(leaderboardSnapshotEntries);
  await database.delete(leaderboardSnapshots);
  await database.delete(moderationActions);
  await database.delete(submissions);
  await database.delete(anonymousSessions);
  await database.delete(siteState);
  await database.delete(auditLogs);
  await database.delete(quizSets);
  await database.delete(sermons);
  await database.delete(bibleTranslations);
});

describe("participation board API", () => {
  it("applies administrator hide, unhide and delete to dynamic and fixed ranks without promotion", async () => {
    const { canonicalCellIds, entryCount } = await seedQuiz({ winnerCount: 3 });
    const owners = await Promise.all([seedSession(50), seedSession(51), seedSession(52)]);
    for (const [index, owner] of owners.entries()) {
      await seedSubmission(canonicalCellIds, entryCount, {
        displayName: `순위${index + 1}`,
        fullyCorrect: true,
        id: `moderated-winner-${index + 1}`,
        index: 50 + index,
        sessionHash: owner.sessionHash,
        submittedAt: new Date(now.getTime() + index * 1_000).toISOString(),
      });
    }
    const service = createSubmissionModerationService(database);
    const ids = (prefix: string, deletion = false) => ({
      actionId: `${prefix}-action`,
      auditId: `${prefix}-audit`,
      ...(deletion ? { deletionMarkerAuditId: `${prefix}-marker` } : {}),
    });
    await service.moderate({
      action: "hide",
      actorEmail: "admin@example.com",
      changedAt: nowIso,
      ids: ids("published-hide"),
      reason: "공개 내용 확인 중",
      submissionId: "moderated-winner-2",
    });
    const hiddenPublished = await parseBoardResponse(
      await exports.default.fetch(boardRequest(owners[0]!.token)),
    );
    expect(hiddenPublished.participants.map((participant) => participant.displayName))
      .toEqual(["순위1", "순위3"]);
    expect(hiddenPublished.winners).toEqual([
      { rank: 1, submissionOrder: 1 },
      { rank: 2, submissionOrder: 2 },
    ]);

    await service.moderate({
      action: "unhide",
      actorEmail: "admin@example.com",
      changedAt: new Date(now.getTime() + 2_000).toISOString(),
      ids: ids("published-unhide"),
      reason: "검토 결과 공개 가능",
      submissionId: "moderated-winner-2",
    });
    const restoredPublished = await parseBoardResponse(
      await exports.default.fetch(boardRequest(owners[0]!.token)),
    );
    expect(restoredPublished.winners).toEqual([
      { rank: 1, submissionOrder: 1 },
      { rank: 2, submissionOrder: 2 },
      { rank: 3, submissionOrder: 3 },
    ]);

    await database.update(quizSets).set({
      archivedAt: nowIso,
      closesAt: new Date(now.getTime() - 1_000).toISOString(),
      status: "archived",
    }).where(eq(quizSets.id, "participation-board-set"));
    await database.insert(leaderboardSnapshots).values({
      finalizedAt: nowIso,
      id: "moderation-fixed-snapshot",
      quizVariantId: variantId,
      winnerCount: 3,
    });
    await database.insert(leaderboardSnapshotEntries).values([
      { rank: 1, snapshotId: "moderation-fixed-snapshot", submissionId: "moderated-winner-1" },
      { rank: 2, snapshotId: "moderation-fixed-snapshot", submissionId: "moderated-winner-2" },
      { rank: 3, snapshotId: "moderation-fixed-snapshot", submissionId: "moderated-winner-3" },
    ]);
    await service.moderate({
      action: "delete",
      actorEmail: "admin@example.com",
      changedAt: new Date(now.getTime() + 3_000).toISOString(),
      ids: ids("archived-delete", true),
      reason: "삭제 요청 처리 완료",
      submissionId: "moderated-winner-1",
    });
    await service.moderate({
      action: "hide",
      actorEmail: "admin@example.com",
      changedAt: new Date(now.getTime() + 4_000).toISOString(),
      ids: ids("archived-hide"),
      reason: "아카이브 공개 내용 확인",
      submissionId: "moderated-winner-2",
    });
    const moderatedArchive = await parseBoardResponse(
      await exports.default.fetch(boardRequest()),
    );
    expect(moderatedArchive.participants.map((participant) => participant.displayName))
      .toEqual(["순위3"]);
    expect(moderatedArchive.winners).toEqual([{ rank: 3, submissionOrder: 1 }]);
    expect(await database.select().from(leaderboardSnapshotEntries)).toHaveLength(3);
    expect(await database.select().from(moderationActions)).toHaveLength(4);
    expect(await database.select({
      answers: submissions.answersJson,
      comment: submissions.comment,
      displayName: submissions.displayName,
      status: submissions.status,
    }).from(submissions).where(eq(submissions.id, "moderated-winner-1"))).toEqual([{
      answers: null,
      comment: null,
      displayName: null,
      status: "deleted",
    }]);
  });

  it("requires an active exact-variant submission while the quiz is published", async () => {
    const { canonicalCellIds, entryCount } = await seedQuiz();
    const noCookie = await exports.default.fetch(boardRequest());
    expect(noCookie.status).toBe(403);
    expect(noCookie.headers.get("Cache-Control")).toBe("private, no-store");

    const malformed = await exports.default.fetch(boardRequest("not-a-session"));
    expect(malformed.status).toBe(403);

    const emptySession = await seedSession(1);
    expect((await exports.default.fetch(boardRequest(emptySession.token))).status).toBe(403);

    const expired = await seedSession(2, false);
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "expired-submission",
      index: 2,
      sessionHash: expired.sessionHash,
    });
    expect((await exports.default.fetch(boardRequest(expired.token))).status).toBe(403);

    const otherVariant = await seedSession(3);
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "adult-submission",
      index: 3,
      sessionHash: otherVariant.sessionHash,
      targetVariantId: adultVariantId,
    });
    expect((await exports.default.fetch(boardRequest(otherVariant.token))).status).toBe(403);

    const deleted = await seedSession(4);
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "deleted-submission",
      index: 4,
      sessionHash: deleted.sessionHash,
      status: "deleted",
    });
    const deletedResponse = await exports.default.fetch(boardRequest(deleted.token));
    expect(deletedResponse.status).toBe(403);
    expect(await deletedResponse.json()).toMatchObject({
      error: { code: "SUBMISSION_REQUIRED", requestId: expect.any(String) },
    });
  });

  it("returns visible participants in stable order and lets a hidden submitter read", async () => {
    const { canonicalCellIds, entryCount } = await seedQuiz({ winnerCount: 2 });
    const first = await seedSession(10);
    const second = await seedSession(11);
    const third = await seedSession(12);
    const hidden = await seedSession(13);
    const tiedAt = new Date(now.getTime() + 10_000).toISOString();
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "submission-b",
      index: 10,
      sessionHash: first.sessionHash,
      displayName: "은혜",
      fullyCorrect: true,
      submittedAt: tiedAt,
    });
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "submission-a",
      index: 11,
      sessionHash: second.sessionHash,
      displayName: "사랑",
      comment: "감사합니다",
      submittedAt: tiedAt,
    });
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "submission-c",
      index: 12,
      sessionHash: third.sessionHash,
      displayName: "기쁨",
      fullyCorrect: true,
      submittedAt: new Date(now.getTime() + 20_000).toISOString(),
    });
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "submission-hidden",
      index: 13,
      sessionHash: hidden.sessionHash,
      displayName: "비공개이름",
      fullyCorrect: true,
      status: "hidden",
    });

    const response = await exports.default.fetch(boardRequest(hidden.token));
    const raw = await response.text();
    expect(response.status).toBe(200);
    const board = participationBoardDataSchema.parse(JSON.parse(raw).data);
    expect(board).toMatchObject({
      winnerCount: 2,
      participants: [
        { submissionOrder: 1, displayName: "사랑", correctCellIds: [canonicalCellIds[0]], isFullyCorrect: false, isMine: false },
        { submissionOrder: 2, displayName: "은혜", correctCellIds: canonicalCellIds, isFullyCorrect: true, isMine: false },
        { submissionOrder: 3, displayName: "기쁨", correctCellIds: canonicalCellIds, isFullyCorrect: true, isMine: false },
      ],
      winners: [
        { rank: 1, submissionOrder: 2 },
        { rank: 2, submissionOrder: 3 },
      ],
    });
    for (const value of ["비공개이름", hidden.sessionHash, "idempotencyKey", "requestHash", "hiddenAt"]) {
      expect(raw).not.toContain(value);
    }

    const mineResponse = await exports.default.fetch(boardRequest(first.token));
    const mine = await parseBoardResponse(mineResponse);
    expect(mine.participants.find((participant) => participant.displayName === "은혜")?.isMine)
      .toBe(true);
  });

  it("opens archived boards publicly and preserves snapshot rank gaps after moderation", async () => {
    const { canonicalCellIds, entryCount } = await seedQuiz({
      status: "archived",
      winnerCount: 3,
    });
    const first = await seedSession(20);
    const second = await seedSession(21);
    const third = await seedSession(22);
    const partial = await seedSession(23);
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "winner-one",
      index: 20,
      sessionHash: first.sessionHash,
      displayName: "첫째",
      fullyCorrect: true,
    });
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "winner-two-hidden",
      index: 21,
      sessionHash: second.sessionHash,
      displayName: "숨김이름",
      fullyCorrect: true,
      status: "hidden",
    });
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "winner-three",
      index: 22,
      sessionHash: third.sessionHash,
      displayName: "셋째",
      fullyCorrect: true,
    });
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "partial-four",
      index: 23,
      sessionHash: partial.sessionHash,
      displayName: "넷째",
    });
    await database.insert(leaderboardSnapshots).values({
      id: "snapshot-one",
      quizVariantId: variantId,
      winnerCount: 3,
      finalizedAt: nowIso,
    });
    await database.insert(leaderboardSnapshotEntries).values([
      { snapshotId: "snapshot-one", rank: 1, submissionId: "winner-one" },
      { snapshotId: "snapshot-one", rank: 2, submissionId: "winner-two-hidden" },
      { snapshotId: "snapshot-one", rank: 3, submissionId: "winner-three" },
    ]);

    const publicResponse = await exports.default.fetch(boardRequest());
    const publicBoard = await parseBoardResponse(publicResponse);
    expect(publicResponse.status).toBe(200);
    expect(publicBoard.participants.map((participant) => participant.displayName))
      .toEqual(["첫째", "셋째", "넷째"]);
    expect(publicBoard.winners).toEqual([
      { rank: 1, submissionOrder: 1 },
      { rank: 3, submissionOrder: 2 },
    ]);
    expect(publicBoard.participants.every((participant) => !participant.isMine)).toBe(true);

    const mineResponse = await exports.default.fetch(boardRequest(third.token));
    const mineBoard = await parseBoardResponse(mineResponse);
    expect(mineBoard.participants[1]?.isMine).toBe(true);

    await database.update(submissions).set({
      status: "deleted",
      displayName: null,
      comment: null,
      answersJson: null,
      deletedAt: nowIso,
    }).where(eq(submissions.id, "winner-one"));
    const afterDelete = await parseBoardResponse(
      await exports.default.fetch(boardRequest()),
    );
    expect(afterDelete.participants.map((participant) => participant.displayName))
      .toEqual(["셋째", "넷째"]);
    expect(afterDelete.winners).toEqual([{ rank: 3, submissionOrder: 1 }]);
  });

  it("fails closed without a valid archived snapshot but allows non-ranked corrections", async () => {
    await seedQuiz({ status: "archived" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const missingSnapshot = await exports.default.fetch(boardRequest());
    const missingRaw = await missingSnapshot.text();
    expect(missingSnapshot.status).toBe(503);
    expect(JSON.parse(missingRaw)).toMatchObject({
      error: { code: "BOARD_UNAVAILABLE", requestId: expect.any(String) },
    });
    expect(missingRaw).not.toContain("leaderboard_snapshots");
    log.mockRestore();

    await database.delete(quizSets);
    await database.delete(sermons);
    await database.delete(bibleTranslations);
    await seedQuiz({ status: "archived", resultsStatus: "non_ranked_correction" });
    const correction = await exports.default.fetch(boardRequest());
    expect(correction.status).toBe(200);
    expect(await parseBoardResponse(correction)).toEqual({
      winnerCount: 3,
      participants: [],
      winners: [],
    });
  });

  it("does not expose corrupt stored participant data", async () => {
    const { canonicalCellIds, entryCount } = await seedQuiz();
    const owner = await seedSession(30);
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "corrupt-submission",
      index: 30,
      sessionHash: owner.sessionHash,
      displayName: "안전이름",
    });
    await database.update(submissions).set({
      answersJson: { [canonicalCellIds[0]!]: "나" },
    })
      .where(eq(submissions.id, "corrupt-submission"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await exports.default.fetch(boardRequest(owner.token));
    const raw = await response.text();
    expect(response.status).toBe(503);
    expect(raw).not.toContain("나");
    expect(raw).not.toContain("안전이름");
    expect(JSON.parse(raw)).toMatchObject({
      error: { code: "BOARD_UNAVAILABLE", requestId: expect.any(String) },
    });

    await database.update(submissions).set({ answersJson: { r9c9: "가" } })
      .where(eq(submissions.id, "corrupt-submission"));
    const outsideGrid = await exports.default.fetch(boardRequest(owner.token));
    const outsideRaw = await outsideGrid.text();
    expect(outsideGrid.status).toBe(503);
    expect(outsideRaw).not.toContain("r9c9");
    log.mockRestore();
  });

  it("uses stable errors for invalid targets, queries and methods", async () => {
    await seedQuiz();
    const cases: Array<[Request, number, string]> = [
      [boardRequest(undefined, `${endpoint}?unexpected=1`), 400, "INVALID_QUIZ_QUERY"],
      [boardRequest(undefined, "https://example.com/api/quizzes/not-a-slug/child/board"), 404, "QUIZ_NOT_FOUND"],
      [boardRequest(undefined, endpoint, "POST"), 405, "METHOD_NOT_ALLOWED"],
    ];
    for (const [request, status, code] of cases) {
      const response = await exports.default.fetch(request);
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({
        error: { code, requestId: expect.any(String) },
      });
    }
  });

  it("enforces snapshot foreign keys, rank bounds and one submission per snapshot", async () => {
    const { canonicalCellIds, entryCount } = await seedQuiz({ status: "archived" });
    const owner = await seedSession(40);
    await seedSubmission(canonicalCellIds, entryCount, {
      id: "snapshot-winner",
      index: 40,
      sessionHash: owner.sessionHash,
      fullyCorrect: true,
    });
    await expect(binding.DB.prepare(
      "INSERT INTO leaderboard_snapshots (id, quiz_variant_id, winner_count, finalized_at) VALUES (?, ?, ?, ?)",
    ).bind("missing-variant-snapshot", "missing-variant", 3, nowIso).run())
      .rejects.toThrow(/FOREIGN KEY/u);
    await database.insert(leaderboardSnapshots).values({
      id: "valid-snapshot",
      quizVariantId: variantId,
      winnerCount: 3,
      finalizedAt: nowIso,
    });
    await expect(binding.DB.prepare(
      "INSERT INTO leaderboard_snapshot_entries (snapshot_id, rank, submission_id) VALUES (?, ?, ?)",
    ).bind("valid-snapshot", 0, "snapshot-winner").run()).rejects.toThrow(/CHECK/u);
    await database.insert(leaderboardSnapshotEntries).values({
      snapshotId: "valid-snapshot",
      rank: 1,
      submissionId: "snapshot-winner",
    });
    await expect(binding.DB.prepare(
      "INSERT INTO leaderboard_snapshot_entries (snapshot_id, rank, submission_id) VALUES (?, ?, ?)",
    ).bind("valid-snapshot", 2, "snapshot-winner").run()).rejects.toThrow(/UNIQUE/u);
  });
});


describe("public export API", () => {
  const blankEndpoint = endpoint.replace("/board", "/export-data");
  const topEndpoint = endpoint.replace("/board", "/top-n-export");
  it("allows blank grid without cookie and refuses extra query/methods without private data", async () => {
    await seedQuiz();
    const response = await exports.default.fetch(boardRequest(undefined, blankEndpoint));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json() as { data: unknown }; const model = blankExportSchema.parse(body.data);
    expect(model.grid.cells.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/solution|answers|session|sermon|displayName|hash/u);
    expect((await exports.default.fetch(boardRequest(undefined, blankEndpoint + "?unexpected=1"))).status).toBe(400);
    expect((await exports.default.fetch(boardRequest(undefined, blankEndpoint, "POST"))).status).toBe(405);
  });
  it("checks exact variant active submission and projects only fully correct people", async () => {
    const { canonicalCellIds, entryCount } = await seedQuiz();
    const owner = await seedSession(71); const other = await seedSession(72); const hidden = await seedSession(73);
    await seedSubmission(canonicalCellIds, entryCount, { id: "export-correct", index: 71, sessionHash: owner.sessionHash, fullyCorrect: true, comment: "인쇄금지" });
    await seedSubmission(canonicalCellIds, entryCount, { id: "export-partial", index: 72, sessionHash: other.sessionHash });
    await seedSubmission(canonicalCellIds, entryCount, { id: "export-hidden", index: 73, sessionHash: hidden.sessionHash, fullyCorrect: true, status: "hidden" });
    expect((await exports.default.fetch(boardRequest(undefined, topEndpoint))).status).toBe(403);
    expect((await exports.default.fetch(boardRequest(owner.token, topEndpoint.replace("/child/", "/adult/")))).status).toBe(403);
    const response = await exports.default.fetch(boardRequest(other.token, topEndpoint));
    expect(response.status).toBe(200); const body = await response.json() as { data: unknown };
    const result = topNExportSchema.parse(body.data); expect(result.board.participants).toHaveLength(1);
    expect(result.board.participants[0]!.rank).toBe(1);
    expect(JSON.stringify(body)).not.toMatch(/comment|isMine|sessionHash|scoreBasisPoints|イン|인쇄금지/u);
    expect((await exports.default.fetch(boardRequest(owner.token, topEndpoint, "POST"))).status).toBe(405);
  });
  it("public archived export preserves snapshot gaps after hide and excludes invalidated versions", async () => {
    const { canonicalCellIds, entryCount } = await seedQuiz({ status: "archived", winnerCount: 3 });
    for (let index = 0; index < 4; index++) {
      const owner = await seedSession(80 + index);
      await seedSubmission(canonicalCellIds, entryCount, { id: `export-archived-${index}`, index: 80 + index, sessionHash: owner.sessionHash, fullyCorrect: true, status: index === 0 ? "hidden" : "visible" });
    }
    await database.insert(leaderboardSnapshots).values({ id: "export-snapshot", finalizedAt: nowIso, quizVariantId: variantId, winnerCount: 3 });
    await database.insert(leaderboardSnapshotEntries).values([0, 1, 2].map(index => ({ snapshotId: "export-snapshot", submissionId: `export-archived-${index}`, rank: index + 1 })));
    const response = await exports.default.fetch(boardRequest(undefined, topEndpoint));
    expect(response.status).toBe(200); const body = await response.json() as { data: unknown };
    expect(topNExportSchema.parse(body.data).board.participants.map(person => person.rank)).toEqual([2, 3, null]);
    await database.update(quizVariants).set({ lifecycleStatus: "superseded", resultsStatus: "invalidated" }).where(eq(quizVariants.id, variantId));
    expect((await exports.default.fetch(boardRequest(undefined, topEndpoint))).status).toBe(404);
    expect((await exports.default.fetch(boardRequest(undefined, blankEndpoint))).status).toBe(404);
  });
});
