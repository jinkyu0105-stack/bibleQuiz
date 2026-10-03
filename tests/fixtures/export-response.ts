import { topNExport } from "../../shared/api/quiz-export";
import { publicResponse } from "./public-response";
export function exportResponse(count = 13, difficulty: "child" | "adult" = "child") {
  const quiz = publicResponse(difficulty).data.quiz!;
  return topNExport(quiz, { winnerCount: 3,
    participants: Array.from({ length: count }, (_, index) => ({ submissionOrder: index + 1,
      displayName: `정답자${index + 1}`, submittedAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
      comment: "인쇄에는나오지않는문구", isFullyCorrect: true, isMine: index === 0,
      answers: Object.fromEntries(quiz.variant.grid.cells.map(cell => [cell.id, "가"])),
      correctCellIds: quiz.variant.grid.cells.map(cell => cell.id),
    })), winners: Array.from({ length: Math.min(3, count) }, (_, index) => ({ rank: index + 1, submissionOrder: index + 1 })),
  }, new Date("2026-10-01T01:00:00.000Z"));
}
