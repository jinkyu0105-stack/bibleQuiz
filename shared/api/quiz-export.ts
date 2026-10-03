import { z } from "zod";
import { difficultySchema, publicPuzzleGridSchema, quizSlugSchema, type PublicQuiz } from "./public-quiz";
import { participationBoardDataSchema, participationBoardParticipantSchema, type ParticipationBoardData } from "./participation-board";

export const blankExportSchema = z.strictObject({
  slug: quizSlugSchema, difficulty: difficultySchema, quizVariantId: z.string().min(1),
  quizRevision: z.int().positive(), grid: publicPuzzleGridSchema,
});
const correctParticipantSchema = z.strictObject({
  displayName: participationBoardParticipantSchema.shape.displayName,
  submittedAt: participationBoardParticipantSchema.shape.submittedAt,
  answers: participationBoardParticipantSchema.shape.answers,
  completionOrder: z.int().positive(), rank: z.int().min(1).max(10).nullable(),
});
export const topNViewSchema = z.strictObject({
  winnerCount: z.int().min(1).max(10), participants: z.array(correctParticipantSchema).max(500),
}).superRefine((view, ctx) => {
  const ranks = new Set<number>();
  view.participants.forEach((person, index) => {
    if (person.completionOrder !== index + 1 ||
      (index > 0 && view.participants[index - 1]!.submittedAt > person.submittedAt) ||
      (person.rank !== null && (person.rank > view.winnerCount || ranks.has(person.rank)))) {
      ctx.addIssue({ code: "custom", message: "Invalid Top N order" });
    }
    if (person.rank !== null) ranks.add(person.rank);
  });
});
export const topNExportSchema = blankExportSchema.extend({
  status: z.enum(["published", "archived"]), generatedAt: z.iso.datetime(),
  sermon: z.strictObject({
    churchName: z.string().min(1).max(100), title: z.string().min(1).max(300),
    date: z.iso.date(), bibleReferenceLabel: z.string().min(1).max(300), translation: z.literal("개역개정"),
  }), board: topNViewSchema,
}).superRefine((model, ctx) => {
  const ids = new Set(model.grid.cells.map(cell => cell.id));
  for (const person of model.board.participants) {
    if (Object.keys(person.answers).length !== ids.size || Object.keys(person.answers).some(id => !ids.has(id))) {
      ctx.addIssue({ code: "custom", message: "Incomplete export grid" });
    }
  }
});
export type BlankExport = z.infer<typeof blankExportSchema>;
export type TopNView = z.infer<typeof topNViewSchema>;
export type TopNExport = z.infer<typeof topNExportSchema>;

// Explicit projection: never spread a quiz, private solution, or participant into an export.
export function blankExport(quiz: PublicQuiz): BlankExport {
  return blankExportSchema.parse({ slug: quiz.slug, difficulty: quiz.variant.difficulty,
    quizVariantId: quiz.variant.id, quizRevision: quiz.variant.revision, grid: quiz.variant.grid });
}
export function topNView(board: ParticipationBoardData): TopNView {
  const checked = participationBoardDataSchema.parse(board);
  const ranks = new Map(checked.winners.map(winner => [winner.submissionOrder, winner.rank]));
  return topNViewSchema.parse({ winnerCount: checked.winnerCount,
    participants: checked.participants.filter(person => person.isFullyCorrect).map((person, index) => ({
      completionOrder: index + 1, displayName: person.displayName, submittedAt: person.submittedAt,
      answers: person.answers, rank: ranks.get(person.submissionOrder) ?? null,
    })) });
}
export function topNExport(quiz: PublicQuiz, board: ParticipationBoardData, now: Date): TopNExport {
  return topNExportSchema.parse({ ...blankExport(quiz), status: quiz.status, generatedAt: now.toISOString(),
    sermon: { churchName: quiz.sermon.churchName, title: quiz.sermon.title, date: quiz.sermon.date,
      bibleReferenceLabel: quiz.sermon.bibleReferenceLabel, translation: quiz.sermon.translation }, board: topNView(board) });
}
export function clueText(model: BlankExport): string {
  const lines: string[] = [];
  for (const [direction, label] of [["across", "가로"], ["down", "세로"]] as const) {
    lines.push(`[${label}]`);
    lines.push(...model.grid.entries.filter(entry => entry.direction === direction)
      .sort((a, b) => a.number - b.number).map(entry => `${entry.number}. ${entry.clue}`));
  }
  return lines.join("\n");
}
export const difficultyLabel = (level: "child" | "adult") => level === "child" ? "어린이용" : "장년용";
