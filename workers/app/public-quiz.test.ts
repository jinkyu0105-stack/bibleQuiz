import { env, exports } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewQuiz } from "../../src/features/quiz/preview-data";
import { publicQuizResponseSchema, type Difficulty } from "../../shared/api/public-quiz";
import { createDatabase } from "../_shared/db/client";
import { anonymousSessions, bibleTranslations, quizEntriesPublic, quizSets, quizVariants, sermons, sermonTranscripts, siteState, submissions } from "../_shared/db/schema";
import { createPublicQuizRepository } from "../_shared/repositories/public-quiz-repository";
import { sermonMetadataDrafts } from "../_shared/db/schema";
import { createSermonMetadataRepository } from "../_shared/repositories/sermon-metadata-repository";
import { metadataCommand } from "./test/sermon-metadata-fixture";

const database = createDatabase((env as Env).DB);
const now = "2026-08-31T03:00:00.000Z";
const canary = "PRIVATE_CANARY_답안자막관리자";
const repository = createPublicQuizRepository(database);
async function seed(suffix = "test01", status: "published" | "archived" | "draft" = "published", difficulties: Difficulty[] = ["child", "adult"]) {
  const slug = `2026-08-31-${suffix}`;
  await database.insert(sermons).values({ id: suffix, slug, slugSuffix: suffix,
    churchName: "다사랑교회", sermonTitle: `시험 설교 ${suffix}`, sermonDate: "2026-08-31",
    bibleTranslationId: "test-translation", bibleReferenceLabel: "마태복음 5:1-12",
    bibleReferenceJson: [{ book: "마태복음", chapter: 5, verseStart: 1, verseEnd: 12 }],
    bibleTextSnapshot: canary, youtubeVideoId: suffix, youtubeUrl: `https://www.youtube.com/watch?v=${suffix}`,
    createdAt: now, updatedAt: now });
  await database.insert(quizSets).values({ id: suffix, sermonId: suffix, status,
    createdBy: canary, createdAt: now, updatedAt: now, publishedAt: now,
    opensAt: "2026-08-30T00:00:00.000Z", closesAt: "2099-09-07T00:00:00.000Z",
    publishedAiProvenanceJson: [{ model: canary, purpose: canary, responseId: canary }],
  });
  for (const difficulty of difficulties) {
    const { grid } = previewQuiz(difficulty);
    const variantId = `${suffix}-${difficulty}`;
    const cells = Array.from({ length: grid.gridSize ** 2 }, (_, index) => {
      const row = Math.floor(index / grid.gridSize), column = index % grid.gridSize;
      const across = grid.entries.find((entry) => entry.start.row === row && entry.start.column === column && entry.direction === "across");
      const down = grid.entries.find((entry) => entry.start.row === row && entry.start.column === column && entry.direction === "down");
      return { row, column, isBlocked: !grid.cells.some((cell) => cell.row === row && cell.column === column),
        ...(across ? { acrossNumber: across.number } : {}), ...(down ? { downNumber: down.number } : {}), syllable: canary };
    });
    await database.insert(quizVariants).values({ id: variantId, quizSetId: suffix, difficulty, revision: 1, gridSize: grid.gridSize,
      publicGridJson: { size: grid.gridSize, cells }, wordCount: grid.entries.length, activeCellCount: grid.cells.length,
      intersectionCount: grid.entries.reduce((sum, entry) => sum + entry.length, 0) - grid.cells.length,
      validationReportJson: { errors: [], warnings: [canary], generatedAt: now }, createdAt: now });
    await database.insert(quizEntriesPublic).values(grid.entries.map((entry, displayOrder) => ({
      id: `${variantId}-${entry.id}`, quizVariantId: variantId, number: entry.number, direction: entry.direction,
      startRow: entry.start.row, startCol: entry.start.column, length: entry.length, clue: entry.clue!,
      transcriptEvidenceJson: { privateText: canary }, displayOrder,
    })));
  }
  return slug;
}
async function seedSubmission(
  quizVariantId: string,
  status: "visible" | "hidden" | "deleted",
  index: number,
  quizRevision = 1,
) {
  const sessionHash = index.toString(16).padStart(64, "0");
  const timestamp = `2026-08-31T00:0${index}:00.000Z`;
  await database.insert(anonymousSessions).values({
    sessionHash,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: "2099-09-07T00:00:00.000Z",
  });
  await database.insert(submissions).values({
    id: `submission-${quizVariantId}-${index}`,
    quizVariantId,
    quizRevision,
    sessionHash,
    idempotencyKey: `01924f8e-7b2a-7f1c-8f3a-${index.toString(16).padStart(12, "0")}`,
    requestHash: index.toString(16).repeat(64),
    displayName: status === "deleted" ? null : "은혜",
    comment: null,
    answersJson: status === "deleted" ? null : { r0c0: "가" },
    correctnessMask: "10",
    correctCells: 1,
    totalCells: 2,
    correctWords: 0,
    totalWords: 1,
    scoreBasisPoints: 5_000,
    isFullyCorrect: false,
    status,
    submittedAt: timestamp,
    hiddenAt: status === "hidden" ? timestamp : null,
    deletedAt: status === "deleted" ? timestamp : null,
  });
}
beforeEach(async () => {
  // These bindings are the isolated Worker-test D1, never the developer/remote database.
  await database.delete(submissions);
  await database.delete(anonymousSessions);
  await database.delete(siteState);
  await database.delete(quizSets);
  await database.delete(sermonMetadataDrafts);
  await database.delete(sermons);
  await database.delete(bibleTranslations);
  await database.insert(bibleTranslations).values({ id: "test-translation", displayName: "개역개정", edition: "reference-only",
    publisherOrRightsholder: "대한성서공회", mode: "reference_only", createdAt: now, updatedAt: now });
});
const fetchQuiz = (path: string) => exports.default.fetch(new Request(`https://example.com/api/quizzes/${path}`));

describe("public quiz read API / migrated D1", () => {
  it("P5-18 private draft edits and corrupt drafts cannot change the public response", async () => {
    const slug = await seed();
    const before = await (await fetchQuiz(slug)).json();
    const metadata = createSermonMetadataRepository(database);
    await metadata.save(metadataCommand("test01"));
    await metadata.save({ ...metadataCommand("test01", 1), title: "TEST_ONLY_PRIVATE_METADATA_B" });
    expect(await (await fetchQuiz(slug)).json()).toEqual(before);
    await database.update(sermonMetadataDrafts).set({ bibleReferenceJson: "{}" });
    const response = await fetchQuiz(slug);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(before);
    expect(JSON.stringify(before)).not.toContain("TEST_ONLY_PRIVATE_METADATA");
  });
  it("returns an empty latest response and private/not-found indistinguishable 404s", async () => {
    const response = await fetchQuiz("latest");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { quiz: null, otherOpenQuizzes: [] } });
    const slug = await seed("draft1", "draft");
    for (const path of [slug, "2026-08-31-absent", "bad-slug"]) {
      const response = await fetchQuiz(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "QUIZ_NOT_FOUND", requestId: expect.any(String) } });
    }
  });
  it("serves selected difficulty with strict allowlisting and no private canaries", async () => {
    const slug = await seed();
    for (const difficulty of ["child", "adult"] as const) {
      const response = await fetchQuiz(`${slug}?difficulty=${difficulty}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const raw = await response.text();
      expect(raw).not.toContain(canary);
      for (const key of ["syllable", "transcriptEvidence", "bibleTextSnapshot", "createdBy", "validationReport", "solution_cells", "entry_answers"]) expect(raw).not.toContain(key);
      const body = publicQuizResponseSchema.parse(JSON.parse(raw));
      expect(body.data.quiz?.variant.difficulty).toBe(difficulty);
      expect(body.data.quiz?.variant.grid.gridSize).toBe(difficulty === "child" ? 5 : 8);
      expect(body.data.quiz?.solutionAccess).toBe("after_submission");
      expect(body.data.quiz?.submissionCount).toBe(0);
    }
  });
  it("counts only exact visible submissions for the selected active variant", async () => {
    const slug = await seed();
    await seedSubmission("test01-child", "visible", 1);
    await seedSubmission("test01-child", "visible", 2);
    await seedSubmission("test01-child", "hidden", 3);
    await seedSubmission("test01-child", "deleted", 4);
    await seedSubmission("test01-adult", "visible", 5);

    await expect(repository.read({ slug }, "child", new Date(now)))
      .resolves.toMatchObject({ quiz: { submissionCount: 2 } });
    await expect(repository.read({ slug }, "adult", new Date(now)))
      .resolves.toMatchObject({ quiz: { submissionCount: 1 } });
    const response = await fetchQuiz(`${slug}?difficulty=child`);
    expect(response.status).toBe(200);
    expect(publicQuizResponseSchema.parse(await response.json()).data.quiz?.submissionCount).toBe(2);
  });
  it("fails closed instead of showing a count for a mismatched visible revision", async () => {
    const slug = await seed();
    await seedSubmission("test01-child", "visible", 1, 2);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await fetchQuiz(`${slug}?difficulty=child`);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(canary);
    } finally { log.mockRestore(); }
  });
  it("honors featured and keeps the other open quizzes accessible", async () => {
    const slug = await seed();
    await seed("other1");
    await seed("draft1", "draft");
    await seed("arch01", "archived");
    await database.insert(siteState).values({ key: "featured_quiz_set_id", value: "test01", updatedAt: now });
    const data = await repository.read("latest", "child", new Date(now));
    expect(data.quiz?.slug).toBe(slug);
    expect(data.otherOpenQuizzes.map((quiz) => quiz.slug)).toEqual(["2026-08-31-other1"]);
    expect((await repository.read({ slug: "2026-08-31-other1" }, "adult", new Date(now))).quiz).not.toBeNull();
  });
  it("falls back from unpublished featured to open, then archive without reopening it", async () => {
    await seed("draft1", "draft");
    await seed("arch01", "archived");
    await seed("open01");
    await database.insert(siteState).values({ key: "featured_quiz_set_id", value: "draft1", updatedAt: now });
    expect((await repository.read("latest", "child", new Date(now))).quiz?.quizSetId).toBe("open01");
    await database.update(quizSets).set({ status: "draft" }).where(eq(quizSets.id, "open01"));
    expect((await repository.read("latest", "child", new Date(now))).quiz).toMatchObject({ quizSetId: "arch01", mode: "practice", acceptingSubmissions: false, solutionAccess: "public" });
  });
  it("keeps paused visible, checks exact open/close times, and never mutates status on GET", async () => {
    const slug = await seed();
    for (const [time, availability] of [["2026-08-29T23:59:59.000Z", "upcoming"], ["2026-08-30T00:00:00.000Z", "open"], ["2099-09-07T00:00:00.000Z", "closed"]]) {
      const data = await repository.read({ slug }, "child", new Date(time!));
      expect(data.quiz?.availability).toBe(availability);
      expect(data.quiz?.status).toBe("published");
    }
    await database.update(quizSets).set({ submissionState: "paused", submissionPausedAt: now, submissionPauseReason: "문제를 확인하고 있습니다." });
    expect((await repository.read({ slug }, "child", new Date(now))).quiz).toMatchObject({ availability: "paused", acceptingSubmissions: false, pauseReason: "문제를 확인하고 있습니다." });
  });
  it("excludes withdrawn/superseded variants and uses replacement identity/revision", async () => {
    const slug = await seed();
    await database.update(quizVariants).set({ lifecycleStatus: "superseded", resultsStatus: "invalidated" }).where(eq(quizVariants.id, "test01-child"));
    expect((await fetchQuiz(`${slug}?difficulty=child`)).status).toBe(404);
    expect((await fetchQuiz(`${slug}?difficulty=adult`)).status).toBe(200);
    const [old] = await database.select().from(quizVariants).where(eq(quizVariants.id, "test01-child"));
    await database.insert(quizVariants).values({ ...old!, id: "corrected-child", revision: 2, lifecycleStatus: "active", resultsStatus: "valid", replacesVariantId: "test01-child" });
    const oldEntries = await database.select().from(quizEntriesPublic).where(eq(quizEntriesPublic.quizVariantId, "test01-child"));
    await database.insert(quizEntriesPublic).values(oldEntries.map((entry) => ({ ...entry, id: `new-${entry.id}`, quizVariantId: "corrected-child" })));
    expect((await repository.read({ slug }, "child", new Date(now))).quiz?.variant).toMatchObject({ id: "corrected-child", revision: 2 });
    await database.update(quizVariants).set({ lifecycleStatus: "withdrawn" }).where(eq(quizVariants.id, "corrected-child"));
    await database.update(quizVariants).set({ lifecycleStatus: "withdrawn" }).where(eq(quizVariants.id, "test01-adult"));
    expect((await fetchQuiz(slug)).status).toBe(404);
  });
  it.each(["difficulty=bad", "difficulty=child&difficulty=adult", "solution=true", "difficulty="])("rejects invalid query %s", async (query) => {
    expect((await fetchQuiz(`latest?${query}`)).status).toBe(400);
  });
  it("exposes unranked corrections only for archived practice", async () => {
    const slug = await seed();
    await database.update(quizVariants).set({ resultsStatus: "non_ranked_correction" });
    expect((await fetchQuiz(slug)).status).toBe(404);
    await database.update(quizSets).set({ status: "archived" });
    expect((await repository.read({ slug }, "child", new Date(now))).quiz).toMatchObject({ mode: "practice", acceptingSubmissions: false });
  });
  it.each(["count", "json", "number", "disclosure", "image"])("rejects corrupt stored %s without echoing data", async (kind) => {
    const slug = await seed();
    if (kind === "count") await database.update(quizVariants).set({ activeCellCount: 99 });
    if (kind === "json") await (env as Env).DB.prepare("UPDATE quiz_variants SET public_grid_json = ?").bind(`broken-${canary}`).run();
    if (kind === "number") await database.update(quizEntriesPublic).set({ number: 99 }).where(eq(quizEntriesPublic.id, "test01-child-across-1"));
    if (kind === "disclosure") await database.update(sermons).set({ aiSummary: "테스트 요약", aiSummaryDisclosure: canary });
    if (kind === "image") await database.update(quizVariants).set({ desktopBackgroundPath: `https://example.com/${canary}` });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await fetchQuiz(slug);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(canary);
      expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
    } finally { log.mockRestore(); }
  });
  it("fails closed on malformed geometry and logs no private values", async () => {
    const slug = await seed();
    await database.update(quizEntriesPublic).set({ length: 10 }).where(and(eq(quizEntriesPublic.quizVariantId, "test01-child"), eq(quizEntriesPublic.direction, "across")));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await fetchQuiz(slug);
      expect(response.status).toBe(503);
      const raw = await response.text();
      expect(raw).not.toContain(canary);
      expect(raw).not.toContain("geometry");
      expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
      expect(JSON.parse(raw)).toMatchObject({ error: { code: "QUIZ_UNAVAILABLE", requestId: expect.any(String) } });
    } finally { log.mockRestore(); }
  });
  it("enforces the new entry FK and direction constraints", async () => {
    await expect((env as Env).DB.prepare("INSERT INTO quiz_entries_public VALUES ('invalid','missing',1,'across',0,0,2,'test',NULL,0)").run()).rejects.toThrow(/FOREIGN KEY/);
    await seed();
    await expect((env as Env).DB.prepare("INSERT INTO quiz_entries_public VALUES ('invalid','test01-child',1,'diagonal',0,0,2,'test',NULL,0)").run()).rejects.toThrow(/CHECK/);
  });
  it("validates AI disclosure against confirmed source metadata without exposing transcript text", async () => {
    const slug = await seed();
    await database.insert(sermonTranscripts).values({ id: "private-transcript", sermonId: "test01", sourceRevision: 1,
      language: "ko", sourceMode: "sermon_notes", manualSourceKind: "sermon_summary", sourceCoverage: "partial_notes",
      rawText: canary, rawSha256: canary, confirmedText: canary, confirmedSha256: canary,
      status: "confirmed", confirmedAt: now, confirmedBy: canary, fetchedAt: now });
    await database.update(quizSets).set({ confirmedTranscriptId: "private-transcript" });
    await database.update(sermons).set({ aiSummary: "테스트 요약", aiSummaryDisclosure: "아래 내용은 관리자가 제공한 설교 자료를 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다." });
    const response = await fetchQuiz(slug);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(canary);
    await database.update(sermons).set({ aiSummaryDisclosure: "아래 내용은 설교 영상의 공개 자막을 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다." });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await fetchQuiz(slug)).status).toBe(503); } finally { log.mockRestore(); }
  });
});
