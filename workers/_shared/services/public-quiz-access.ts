import type { Difficulty, PublicQuizData } from "../../../shared/api/public-quiz";
import type { Database } from "../db/client";
import { createPublicQuizRepository } from "../repositories/public-quiz-repository";
import {
  QuizFinalizationUnavailable,
  createQuizFinalizationService,
} from "./quiz-finalization";

type PublicQuizSelector = "latest" | { slug: string };

/**
 * Public quiz reads are also the bounded fallback for a delayed scheduler.
 * The finalizer owns every write; this service only detects a due published
 * set and then re-reads the immutable archived view.
 */
export function createPublicQuizAccessService(database: Database) {
  const repository = createPublicQuizRepository(database);
  const finalization = createQuizFinalizationService(database);

  return {
    async read(
      selector: PublicQuizSelector,
      difficulty: Difficulty,
      now = new Date(),
    ): Promise<PublicQuizData> {
      const initial = await repository.read(selector, difficulty, now);
      const quiz = initial.quiz;
      if (
        quiz === null ||
        quiz.status !== "published" ||
        now.getTime() < Date.parse(quiz.closesAt)
      ) {
        return initial;
      }

      await finalization.finalizeDueQuizSet(quiz.quizSetId, now);
      const archived = await repository.read(selector, difficulty, now);
      if (
        archived.quiz === null ||
        archived.quiz.quizSetId !== quiz.quizSetId ||
        archived.quiz.status !== "archived"
      ) {
        throw new QuizFinalizationUnavailable();
      }
      return archived;
    },
  };
}
