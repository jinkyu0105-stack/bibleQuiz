import { sql } from "drizzle-orm";
import { publishedQuizContent, quizSets, sermons } from "../db/schema";

// Whitelisted scalar public columns only. The permanent initial snapshot stays intact.
export const latestRepublication = (column: "title" | "sermon_date" | "church_name" | "bible_reference_label" | "summary" | "disclosure" | "translation" | "quiz_set_id") =>
  sql`(select r.${sql.raw(column)} from quiz_content_versions r where r.quiz_set_id=${quizSets.id} order by r.revision desc limit 1)`;
export const publishedTitle = sql<string>`coalesce((select c.title from published_display_corrections c where c.quiz_set_id=${quizSets.id} and c.revision>coalesce((select r.display_revision from quiz_content_versions r where r.quiz_set_id=${quizSets.id} order by r.revision desc limit 1),-1) order by c.revision desc limit 1),${latestRepublication("title")},${publishedQuizContent.title},${sermons.sermonTitle})`;
export const publishedSermonDate = sql<string>`coalesce((select c.sermon_date from published_display_corrections c where c.quiz_set_id=${quizSets.id} and c.revision>coalesce((select r.display_revision from quiz_content_versions r where r.quiz_set_id=${quizSets.id} order by r.revision desc limit 1),-1) order by c.revision desc limit 1),${latestRepublication("sermon_date")},${publishedQuizContent.sermonDate},${sermons.sermonDate})`;

export const publishedSummary = sql<string | null>`(select text from quiz_wording_current where quiz_set_id=${quizSets.id} and target='summary')`;
