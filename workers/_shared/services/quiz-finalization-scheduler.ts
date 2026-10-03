import { and, asc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../db/client";
import { quizSets } from "../db/schema";
import { createQuizFinalizationService } from "./quiz-finalization";

export class QuizFinalizationScheduleUnavailable extends Error {
  constructor() {
    super("QUIZ_FINALIZATION_SCHEDULE_UNAVAILABLE");
  }
}

export interface QuizFinalizationScheduleSummary {
  discovered: number;
  failed: number;
  finalized: number;
  replayed: number;
}

const dueQuizSetSchema = z.object({
  closesAt: z.iso.datetime(),
  id: z.string().min(1).max(128),
}).strict();

export function createQuizFinalizationScheduler(database: Database) {
  return {
    async run(now = new Date()): Promise<QuizFinalizationScheduleSummary> {
      if (!Number.isFinite(now.getTime())) {
        throw new QuizFinalizationScheduleUnavailable();
      }
      const nowIso = now.toISOString();
      if (!z.iso.datetime().safeParse(nowIso).success) {
        throw new QuizFinalizationScheduleUnavailable();
      }

      let dueSets: Array<z.infer<typeof dueQuizSetSchema>>;
      try {
        const rows = await database.select({
          closesAt: quizSets.closesAt,
          id: quizSets.id,
        }).from(quizSets).where(and(
          eq(quizSets.status, "published"),
          isNull(quizSets.archivedAt),
          isNotNull(quizSets.closesAt),
          lte(quizSets.closesAt, nowIso),
        )).orderBy(asc(quizSets.closesAt), asc(quizSets.id));
        dueSets = z.array(dueQuizSetSchema).parse(rows);
      } catch {
        throw new QuizFinalizationScheduleUnavailable();
      }

      const summary: QuizFinalizationScheduleSummary = {
        discovered: dueSets.length,
        failed: 0,
        finalized: 0,
        replayed: 0,
      };
      const finalization = createQuizFinalizationService(database);
      for (const set of dueSets) {
        try {
          const result = await finalization.finalizeDueQuizSet(set.id, now);
          summary[result.outcome] += 1;
        } catch {
          summary.failed += 1;
        }
      }
      return summary;
    },
  };
}
