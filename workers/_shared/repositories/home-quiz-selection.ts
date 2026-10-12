/** One home selection rule for the public page and its admin overview. */
export type HomeQuizCandidate = {
  quizSetId: string; status: string; submissionState: string;
  publishedAt: string | null; sermonDate: string; opensAt: string | null; closesAt: string | null;
};

// Match the public query's descending SQLite BINARY order, including tied IDs.
const descending = (a: string, b: string) => a === b ? 0 : a > b ? -1 : 1;

export function selectHomeQuiz<T extends HomeQuizCandidate>(candidates: readonly T[], featuredId: string | null | undefined, now: Date): T | undefined {
  const ordered = [...candidates].sort((a, b) => descending(a.publishedAt ?? "", b.publishedAt ?? "") || descending(a.sermonDate, b.sermonDate) || descending(a.quizSetId, b.quizSetId));
  return ordered.find(row => row.quizSetId === featuredId) ?? ordered.find(row => row.status === "published" && row.submissionState === "open" && row.opensAt !== null && row.closesAt !== null && Date.parse(row.opensAt) <= now.getTime() && now.getTime() < Date.parse(row.closesAt)) ??
    ordered.filter(row => row.status === "archived").sort((a, b) => b.sermonDate.localeCompare(a.sermonDate) || b.quizSetId.localeCompare(a.quizSetId))[0];
}
