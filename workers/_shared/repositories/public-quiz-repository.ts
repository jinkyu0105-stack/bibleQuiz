import { publishedTitle, publishedSermonDate, publishedSummary, latestRepublication } from "./published-display-columns";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { publicQuizResponseSchema, publicPuzzleGridSchema, type Difficulty, type PublicQuizData } from "../../../shared/api/public-quiz";
import type { Database } from "../db/client";
import { bibleTranslations, publishedQuizContent, quizEntriesPublic, quizSets, quizVariants, sermons, sermonTranscripts, siteState, submissions } from "../db/schema";
import { publicGridSchema as storedGridSchema } from "../db/validation";

export class PublicQuizUnavailable extends Error {
  constructor() { super("PUBLIC_QUIZ_UNAVAILABLE"); }
}

/** Read-only repository. No solution/private transcript text or full-row select is exposed. */
export function createPublicQuizRepository(database: Database) {
  return {
    async read(
      selector: "latest" | { slug: string },
      difficulty: Difficulty,
      now = new Date(),
      options: { includeSubmissionCount?: boolean } = {},
    ): Promise<PublicQuizData> {
      // Only public lifecycle rows become candidates. Invalidated versions stay private.
      const candidates = await database.select({
        quizSetId: quizSets.id, slug: sql<string>`coalesce(${publishedQuizContent.slug},${sermons.slug})`,
        title: publishedTitle,
        sermonDate: publishedSermonDate,
        churchName: sql<string>`coalesce(${latestRepublication("church_name")},${publishedQuizContent.churchName},${sermons.churchName})`,
        bibleReferenceLabel: sql<string>`coalesce(${latestRepublication("bible_reference_label")},${publishedQuizContent.bibleReferenceLabel},${sermons.bibleReferenceLabel})`,
        summary: publishedSummary,
        sermonId: sermons.id, confirmedTranscriptId: quizSets.confirmedTranscriptId,
        disclosure: sql<string | null>`coalesce(${latestRepublication("disclosure")},${publishedQuizContent.disclosure},${sermons.aiSummaryDisclosure})`,
        translation: sql<string>`coalesce(${latestRepublication("translation")},${publishedQuizContent.translation},${bibleTranslations.displayName})`,
        snapshotId: sql<string | null>`coalesce(${latestRepublication("quiz_set_id")},${publishedQuizContent.quizSetId})`,
        translationMode: bibleTranslations.mode,
        status: quizSets.status, submissionState: quizSets.submissionState,
        pauseReason: quizSets.submissionPauseReason, publishedAt: quizSets.publishedAt,
        opensAt: quizSets.opensAt, closesAt: quizSets.closesAt,
        variantId: quizVariants.id, difficulty: quizVariants.difficulty,
      }).from(quizSets)
        .innerJoin(sermons, eq(sermons.id, quizSets.sermonId))
        .leftJoin(publishedQuizContent, eq(publishedQuizContent.quizSetId, quizSets.id))
        .innerJoin(bibleTranslations, eq(bibleTranslations.id, sermons.bibleTranslationId))
        .innerJoin(quizVariants, and(eq(quizVariants.quizSetId, quizSets.id), eq(quizVariants.lifecycleStatus, "active"),
          or(eq(quizVariants.resultsStatus, "valid"), and(eq(quizSets.status, "archived"), eq(quizVariants.resultsStatus, "non_ranked_correction")))))
        .where(inArray(quizSets.status, ["published", "archived"]))
        .orderBy(desc(quizSets.publishedAt), desc(publishedSermonDate), desc(quizSets.id), asc(quizVariants.difficulty));
      const isOpen = (row: typeof candidates[number]) => row.status === "published" && row.submissionState === "open" &&
        row.opensAt !== null && row.closesAt !== null && Date.parse(row.opensAt) <= now.getTime() && now.getTime() < Date.parse(row.closesAt);
      let selected: typeof candidates[number] | undefined;
      if (selector === "latest") {
        const [featured] = await database.select({ value: siteState.value }).from(siteState).where(eq(siteState.key, "featured_quiz_set_id"));
        selected = candidates.find((row) => row.quizSetId === featured?.value) ?? candidates.find(isOpen) ??
          [...candidates].filter((row) => row.status === "archived").sort((a, b) => b.sermonDate.localeCompare(a.sermonDate) || b.quizSetId.localeCompare(a.quizSetId))[0];
      } else selected = candidates.find((row) => row.slug === selector.slug);
      const setId = selected?.quizSetId;
      const row = candidates.find((candidate) => candidate.quizSetId === setId && candidate.difficulty === difficulty);
      if (selected && !row) throw new PublicQuizUnavailable();
      if (!row) return { quiz: null, otherOpenQuizzes: [] };

      const [variant] = await database.select({
        id: quizVariants.id, replaces: quizVariants.replacesVariantId, results: quizVariants.resultsStatus, revision: quizVariants.revision, gridSize: quizVariants.gridSize,
        grid: quizVariants.publicGridJson, wordCount: quizVariants.wordCount, activeCellCount: quizVariants.activeCellCount,
        intersectionCount: quizVariants.intersectionCount,
        desktopBackgroundPath: quizVariants.desktopBackgroundPath, mobileBackgroundPath: quizVariants.mobileBackgroundPath,
      }).from(quizVariants).where(and(eq(quizVariants.id, row.variantId), eq(quizVariants.lifecycleStatus, "active")));
      if (!variant) throw new PublicQuizUnavailable();
      const visibleSubmissionCounts = options.includeSubmissionCount === false ? [] : await database.select({
          quizRevision: submissions.quizRevision,
          submissionCount: count(),
        }).from(submissions).where(and(
          eq(submissions.quizVariantId, variant.id),
          eq(submissions.status, "visible"),
        )).groupBy(submissions.quizRevision);
      if (visibleSubmissionCounts.some((item) => item.quizRevision !== variant.revision)) {
        throw new Error("Invalid visible submission revision");
      }
      const submissionCount = visibleSubmissionCounts[0]?.submissionCount ?? 0;
      if (!Number.isSafeInteger(submissionCount) || submissionCount < 0) {
        throw new Error("Invalid visible submission count");
      }
      const entries = await database.select({
        id: quizEntriesPublic.id, number: quizEntriesPublic.number, direction: quizEntriesPublic.direction,
        row: quizEntriesPublic.startRow, column: quizEntriesPublic.startCol, length: quizEntriesPublic.length, clue: sql<string>`coalesce((select text from quiz_wording_current where target=${quizEntriesPublic.id} and quiz_set_id=${row.quizSetId}),${quizEntriesPublic.clue})`,
      }).from(quizEntriesPublic).where(eq(quizEntriesPublic.quizVariantId, variant.id))
        .orderBy(asc(quizEntriesPublic.number), asc(quizEntriesPublic.direction), asc(quizEntriesPublic.id));

      // DB JSON predates Phase 2 and contains all cells. Strip unknown nested keys
      // before adapting, then strictly validate public geometry; never spread DB JSON.
      const stored = storedGridSchema.parse(variant.grid);
      if (stored.size !== variant.gridSize || stored.cells.length !== stored.size ** 2 ||
        new Set(stored.cells.map((cell) => `${cell.row}:${cell.column}`)).size !== stored.cells.length ||
        stored.cells.some((cell) => cell.row >= stored.size || cell.column >= stored.size ||
          (cell.isBlocked && (cell.acrossNumber !== undefined || cell.downNumber !== undefined)))) {
        throw new Error("Invalid stored grid");
      }
      const grid = publicPuzzleGridSchema.parse({
        gridSize: stored.size,
        cells: stored.cells.filter((cell) => !cell.isBlocked).map((cell) => {
          if (cell.acrossNumber !== undefined && cell.downNumber !== undefined && cell.acrossNumber !== cell.downNumber) throw new Error("Invalid cell numbering");
          const number = cell.acrossNumber ?? cell.downNumber;
          for (const direction of ["across", "down"] as const) {
            const entry = entries.find((item) => item.row === cell.row && item.column === cell.column && item.direction === direction);
            if (entry?.number !== (direction === "across" ? cell.acrossNumber : cell.downNumber)) throw new Error("Invalid entry start");
          }
          return { id: `r${cell.row}c${cell.column}`, row: cell.row, column: cell.column, ...(number === undefined ? {} : { number }) };
        }),
        entries: entries.map((entry) => ({ id: entry.id, number: entry.number, direction: entry.direction, start: { row: entry.row, column: entry.column }, length: entry.length, clue: entry.clue })),
      });
      const crossingCount = (grid.entries.reduce((sum, entry) => sum + entry.length, 0) - grid.cells.length);
      if (variant.wordCount !== entries.length || variant.activeCellCount !== grid.cells.length || variant.intersectionCount !== crossingCount ||
        row.translationMode !== "reference_only" || row.translation !== "개역개정") throw new Error("Invalid public metadata");
      if (row.summary !== null && row.snapshotId === null) {
        if (!row.confirmedTranscriptId) throw new Error("Missing summary source");
        const [source] = await database.select({
          sourceMode: sermonTranscripts.sourceMode, manualSourceKind: sermonTranscripts.manualSourceKind,
          sourceCoverage: sermonTranscripts.sourceCoverage,
        }).from(sermonTranscripts).where(and(eq(sermonTranscripts.id, row.confirmedTranscriptId),
          eq(sermonTranscripts.sermonId, row.sermonId), eq(sermonTranscripts.status, "confirmed")));
        const publicTranscript = source?.sourceCoverage === "full_transcript" &&
          (source.sourceMode === "public_unofficial" || source.sourceMode === "youtube_oauth" || source.manualSourceKind === "youtube_visible_transcript");
        const providedNotes = source?.sourceMode === "sermon_notes" || source?.manualSourceKind === "sermon_manuscript" || source?.manualSourceKind === "sermon_summary";
        const expected = publicTranscript ? "아래 내용은 설교 영상의 공개 자막을 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다." :
          providedNotes ? "아래 내용은 관리자가 제공한 설교 자료를 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다." : null;
        if (expected === null || row.disclosure !== expected) throw new Error("Invalid summary disclosure");
      }
      const availability = row.status === "archived" ? "archived" : row.submissionState === "paused" ? "paused" :
        now.getTime() < Date.parse(row.opensAt ?? "") ? "upcoming" : isOpen(row) ? "open" : "closed";
      const difficultiesFor = (quizSetId: string) => candidates.filter((candidate) => candidate.quizSetId === quizSetId).map((candidate) => candidate.difficulty).sort();
      const otherIds = new Set<string>();
      const otherOpenQuizzes = selector === "latest" ? candidates.filter((candidate) => {
        if (candidate.quizSetId === row.quizSetId || !isOpen(candidate) || otherIds.has(candidate.quizSetId)) return false;
        otherIds.add(candidate.quizSetId);
        return true;
      }).map((candidate) => ({
        slug: candidate.slug, title: candidate.title, sermonDate: candidate.sermonDate,
        bibleReferenceLabel: candidate.bibleReferenceLabel, closesAt: candidate.closesAt,
        availableDifficulties: difficultiesFor(candidate.quizSetId),
      })) : [];
      const closesAt = z.iso.datetime().parse(row.closesAt);
      const data = {
        quiz: {
          quizSetId: row.quizSetId, slug: row.slug,
          sermon: {
            title: row.title, date: row.sermonDate, churchName: row.churchName,
            bibleReferenceLabel: row.bibleReferenceLabel, translation: row.translation,
            bibleReadingUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE",
            summary: row.summary === null ? null : { text: row.summary, disclosure: row.disclosure },
          },
          status: row.status, submissionState: row.submissionState,
          ...(variant.replaces ? { correction: { nonRanked: variant.results === "non_ranked_correction", notice: "문제 오류를 바로잡은 수정본입니다. 이전 오류본의 결과와 순위는 무효 처리되었으며 당시 본인 기록은 보존됩니다." } } : {}),
          pauseReason: row.submissionState === "paused" ? row.pauseReason : null,
          publishedAt: row.publishedAt, opensAt: row.opensAt, closesAt,
          closesAtLabel: new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" }).format(new Date(closesAt)) + " (한국 시간)",
          mode: row.status === "archived" ? "practice" : "participation",
          acceptingSubmissions: availability === "open", availability,
          availableDifficulties: difficultiesFor(row.quizSetId),
          variant: { id: variant.id, difficulty, revision: variant.revision, grid,
            desktopBackgroundPath: variant.desktopBackgroundPath, mobileBackgroundPath: variant.mobileBackgroundPath },
          submissionCount, solutionAccess: row.status === "archived" ? "public" : "after_submission",
        }, otherOpenQuizzes,
      };
      return publicQuizResponseSchema.parse({ data }).data;
    },
  };
}
