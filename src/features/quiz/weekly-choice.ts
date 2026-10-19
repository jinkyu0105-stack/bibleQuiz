import { publicQuizResponseSchema } from "../../../shared/api/public-quiz";

/** Read only when opened. The server owns featured/automatic quiz selection. */
export async function loadWeeklyChoice(signal: AbortSignal) {
  for (const difficulty of ["child", "adult"] as const) {
    const response = await fetch(`/api/quizzes/latest?difficulty=${difficulty}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), cache: "no-store", headers: { Accept: "application/json" },
    });
    if (response.status === 404 && difficulty === "child") continue;
    if (!response.ok) throw new Error("WEEKLY_CHOICE_UNAVAILABLE");
    const { data } = publicQuizResponseSchema.parse(await response.json());
    if (data.quiz && data.quiz.variant.difficulty !== difficulty) throw new Error("WEEKLY_CHOICE_INVALID");
    return data.quiz ? { title: data.quiz.sermon.title, slug: data.quiz.slug, difficulties: data.quiz.availableDifficulties } : null;
  }
  return null;
}
