import { z } from "zod";

export const difficultySchema = z.enum(["child", "adult"]);
export type Difficulty = z.infer<typeof difficultySchema>;
export const quizSlugSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$/u);
const id = z.string().min(1).max(128);
const coordinate = z.int().min(0).max(9);
const text = z.string().trim().min(1);

// This module is browser-safe: no solution schema, generator or private fixture imports.
export const publicPuzzleGridStructureSchema = z.strictObject({
  gridSize: z.int().min(5).max(10),
  cells: z.array(z.strictObject({
    id: z.string().regex(/^r[0-9]c[0-9]$/u), row: coordinate, column: coordinate,
    number: z.int().positive().optional(),
  }).transform(({ number, ...cell }) => ({ ...cell, ...(number === undefined ? {} : { number }) }))).min(1).max(100),
  entries: z.array(z.strictObject({
    id, number: z.int().positive(), direction: z.enum(["across", "down"]),
    start: z.strictObject({ row: coordinate, column: coordinate }),
    length: z.int().min(2).max(10), clue: text.max(2000),
  })).min(2).max(100),
});

export const publicPuzzleGridSchema = publicPuzzleGridStructureSchema.superRefine((grid, ctx) => {
  const fail = () => ctx.addIssue({ code: "custom", message: "Invalid public grid geometry" });
  const cells = new Map(grid.cells.map((cell) => [cell.id, cell]));
  const memberships = new Map<string, number[]>();
  const pairs = new Set<string>();
  const starts = [...new Set(grid.entries.map((entry) => `r${entry.start.row}c${entry.start.column}`))].sort();
  if (cells.size !== grid.cells.length || new Set(grid.entries.map((entry) => entry.id)).size !== grid.entries.length) fail();
  for (const cell of grid.cells) {
    if (cell.id !== `r${cell.row}c${cell.column}` || cell.row >= grid.gridSize || cell.column >= grid.gridSize ||
      cell.number !== (starts.includes(cell.id) ? starts.indexOf(cell.id) + 1 : undefined)) fail();
  }
  grid.entries.forEach((entry, index) => {
    const startId = `r${entry.start.row}c${entry.start.column}`;
    if (entry.number !== starts.indexOf(startId) + 1) fail();
    let previous: string | undefined;
    for (let offset = 0; offset < entry.length; offset++) {
      const cellId = `r${entry.start.row + (entry.direction === "down" ? offset : 0)}c${entry.start.column + (entry.direction === "across" ? offset : 0)}`;
      const members = memberships.get(cellId) ?? [];
      if (!cells.has(cellId) || members.some((member) => grid.entries[member]?.direction === entry.direction)) fail();
      memberships.set(cellId, [...members, index]);
      if (previous) pairs.add(`${previous}:${cellId}`);
      previous = cellId;
    }
  });
  const crossings = grid.entries.map(() => 0);
  const graph = grid.entries.map(() => new Set<number>());
  for (const cell of grid.cells) {
    const members = memberships.get(cell.id) ?? [];
    if (!members.length) fail();
    if (members.length === 2) {
      for (const member of members) {
        crossings[member] = (crossings[member] ?? 0) + 1;
        for (const other of members) graph[member]?.add(other);
      }
    }
    for (const neighbor of [`r${cell.row + 1}c${cell.column}`, `r${cell.row}c${cell.column + 1}`]) {
      if (cells.has(neighbor) && !pairs.has(`${cell.id}:${neighbor}`)) fail();
    }
  }
  const seen = new Set<number>();
  const pending = [0];
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...(graph[current] ?? []));
  }
  if (seen.size !== grid.entries.length || crossings.some((count) => count < 1)) fail();
});

const imagePath = z.string().regex(/^\/images\/[a-zA-Z0-9/_-]+\.(?:avif|webp|png)$/u).nullable();
export const publicSermonSchema = z.strictObject({
  title: text.max(300), date: z.iso.date(), churchName: text.max(100),
  bibleReferenceLabel: text.max(300), translation: z.literal("개역개정"),
  // Official reading portal only; never a stored arbitrary URL or a Bible text snapshot.
  bibleReadingUrl: z.literal("https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE"),
  summary: z.strictObject({ text: text.max(20000), disclosure: z.enum([
    "아래 내용은 설교 영상의 공개 자막을 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다.",
    "아래 내용은 관리자가 제공한 설교 자료를 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다.",
  ]) }).nullable(),
});
export const openQuizSummarySchema = z.strictObject({
  slug: quizSlugSchema, title: text.max(300), sermonDate: z.iso.date(),
  bibleReferenceLabel: text.max(300), closesAt: z.iso.datetime(),
  availableDifficulties: z.array(difficultySchema).min(1).max(2),
});
export const publicQuizSchema = z.strictObject({
  quizSetId: id, slug: quizSlugSchema, sermon: publicSermonSchema,
  status: z.enum(["published", "archived"]), submissionState: z.enum(["open", "paused"]),
  correction: z.strictObject({ nonRanked: z.boolean(), notice: z.string() }).optional(),
  pauseReason: text.max(1000).nullable(), publishedAt: z.iso.datetime(),
  opensAt: z.iso.datetime(), closesAt: z.iso.datetime(), closesAtLabel: text,
  mode: z.enum(["participation", "practice"]), acceptingSubmissions: z.boolean(),
  availability: z.enum(["open", "paused", "upcoming", "closed", "archived"]),
  availableDifficulties: z.array(difficultySchema).min(1).max(2),
  variant: z.strictObject({
    id, difficulty: difficultySchema, revision: z.int().positive(), grid: publicPuzzleGridSchema,
    desktopBackgroundPath: imagePath, mobileBackgroundPath: imagePath,
  }),
  // Count is exact for the current public variant. Repository errors must not become zero.
  submissionCount: z.int().nonnegative(),
  solutionAccess: z.enum(["after_submission", "public"]),
}).superRefine((quiz, ctx) => {
  if (Date.parse(quiz.opensAt) >= Date.parse(quiz.closesAt) ||
    !quiz.availableDifficulties.includes(quiz.variant.difficulty) ||
    new Set(quiz.availableDifficulties).size !== quiz.availableDifficulties.length ||
    quiz.mode !== (quiz.status === "archived" ? "practice" : "participation") ||
    quiz.solutionAccess !== (quiz.status === "archived" ? "public" : "after_submission") ||
    quiz.acceptingSubmissions !== (quiz.availability === "open") ||
    (quiz.availability === "archived") !== (quiz.status === "archived") ||
    (quiz.availability === "open" && quiz.submissionState !== "open")) {
    ctx.addIssue({ code: "custom", message: "Invalid public quiz state" });
  }
});
export const publicQuizResponseSchema = z.strictObject({
  data: z.strictObject({ quiz: publicQuizSchema.nullable(), otherOpenQuizzes: z.array(openQuizSummarySchema) }),
});
export type PublicQuiz = z.infer<typeof publicQuizSchema>;
export type PublicQuizData = z.infer<typeof publicQuizResponseSchema>["data"];
