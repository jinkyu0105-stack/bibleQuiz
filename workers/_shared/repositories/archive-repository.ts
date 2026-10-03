import { publishedTitle, publishedSermonDate, latestRepublication } from "./published-display-columns";
import { and, desc, eq, exists, inArray, lt, or, sql } from "drizzle-orm";
import { archivePageSchema, type ArchivePage, type ArchiveQuery } from "../../../shared/api/archive";
import type { Database } from "../db/client";
import { publishedQuizContent, quizSets, quizVariants, sermons } from "../db/schema";
import { readArchiveCursor, signArchiveCursor } from "./archive-cursor";

/** An archive read never selects grid, answers, source text, or administrator columns. */
export function createArchiveRepository(database: Database, secret: string | undefined) {
  const activeVariant = (difficulty?: "child" | "adult") => exists(database.select({ id: quizVariants.id }).from(quizVariants).where(and(
    eq(quizVariants.quizSetId, quizSets.id), eq(quizVariants.lifecycleStatus, "active"),
    inArray(quizVariants.resultsStatus, ["valid", "non_ranked_correction"]),
    difficulty ? eq(quizVariants.difficulty, difficulty) : undefined,
  )));
  const eligible = and(eq(quizSets.status, "archived"), activeVariant());
  const dateColumn = publishedSermonDate;
  const titleColumn = publishedTitle;
  const referenceColumn = sql<string>`coalesce(${latestRepublication("bible_reference_label")},${publishedQuizContent.bibleReferenceLabel},${sermons.bibleReferenceLabel})`;
  const yearColumn = sql<number>`cast(substr(${dateColumn}, 1, 4) as integer)`;
  const monthColumn = sql<number>`cast(substr(${dateColumn}, 6, 2) as integer)`;
  return {
    async read(query: ArchiveQuery): Promise<ArchivePage> {
      const position = query.cursor ? await readArchiveCursor(query.cursor, query, secret) : null;
      const rowsQuery = database.select({
        id: quizSets.id, slug: sql<string>`coalesce(${publishedQuizContent.slug},${sermons.slug})`, title: titleColumn,
        sermonDate: dateColumn, bibleReferenceLabel: referenceColumn,
        child: sql<number>`${activeVariant("child")}`, adult: sql<number>`${activeVariant("adult")}`,
      }).from(quizSets).innerJoin(sermons, eq(sermons.id, quizSets.sermonId))
        .leftJoin(publishedQuizContent, eq(publishedQuizContent.quizSetId, quizSets.id)).where(and(
        eligible,
        // Literal substring matching keeps the existing ASCII case-insensitive behavior without D1's LIKE pattern byte limit.
        query.q ? or(sql`instr(lower(${titleColumn}), lower(${query.q})) > 0`, sql`instr(lower(${referenceColumn}), lower(${query.q})) > 0`) : undefined,
        query.year === null ? undefined : eq(yearColumn, query.year),
        query.month === null ? undefined : eq(monthColumn, query.month),
        position ? or(lt(dateColumn, position.date), and(eq(dateColumn, position.date), lt(quizSets.id, position.id))) : undefined,
      )).orderBy(desc(dateColumn), desc(quizSets.id)).limit(query.limit + 1);
      // Options are from eligible archive dates, independent of q/month. Months depend only on selected year.
      const [rows, years, months] = await Promise.all([
        rowsQuery,
        position ? Promise.resolve(null) : database.selectDistinct({ value: yearColumn }).from(quizSets)
          .innerJoin(sermons, eq(sermons.id, quizSets.sermonId)).leftJoin(publishedQuizContent, eq(publishedQuizContent.quizSetId, quizSets.id)).where(eligible).orderBy(desc(yearColumn)),
        position ? Promise.resolve(null) : database.selectDistinct({ value: monthColumn }).from(quizSets)
          .innerJoin(sermons, eq(sermons.id, quizSets.sermonId)).leftJoin(publishedQuizContent, eq(publishedQuizContent.quizSetId, quizSets.id)).where(and(eligible, query.year === null ? undefined : eq(yearColumn, query.year))).orderBy(monthColumn),
      ]);
      const visible = rows.slice(0, query.limit);
      const last = visible.at(-1);
      const nextCursor = rows.length > query.limit && last
        ? await signArchiveCursor({ date: last.sermonDate, id: last.id }, query, secret) : null;
      return archivePageSchema.parse({
        items: visible.map((row) => ({ slug: row.slug, title: row.title, sermonDate: row.sermonDate,
          bibleReferenceLabel: row.bibleReferenceLabel,
          availableDifficulties: [...(row.child ? ["child"] : []), ...(row.adult ? ["adult"] : [])],
        })), nextCursor,
        ...(years && months ? { availableYears: years.map((row) => row.value), availableMonths: months.map((row) => row.value) } : {}),
      });
    },
  };
}
