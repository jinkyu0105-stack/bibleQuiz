import type { Difficulty, PublicQuiz } from "../../../shared/api/public-quiz";
import type { PublicPuzzleGrid } from "../../../shared/puzzle/types";
import type { DraftIdentity } from "./draft";

export interface QuizInputView extends DraftIdentity {
  difficulty: Difficulty;
  grid: PublicPuzzleGrid;
}

export function quizInputView(quiz: PublicQuiz): QuizInputView {
  return { quizId: quiz.variant.id, variantRevision: quiz.variant.revision, difficulty: quiz.variant.difficulty, grid: quiz.variant.grid };
}
