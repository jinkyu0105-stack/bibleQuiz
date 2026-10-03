import { z } from "zod";

const savedSchema = z.object({ filter: z.string(), count: z.int().min(0), scrollY: z.number().finite().min(0) });
export function readArchiveHistory(state: unknown, filter: string) {
  const parsed = z.object({ bibleQuizArchive: savedSchema }).safeParse(state);
  return parsed.success && parsed.data.bibleQuizArchive.filter === filter ? parsed.data.bibleQuizArchive : null;
}
export function writeArchiveHistory(filter: string, count: number, scrollY: number) {
  try {
    // Preserve router-owned state (navigation keys/index/user state), storing no quiz content.
    window.history.replaceState({ ...window.history.state, bibleQuizArchive: { filter, count, scrollY: Math.max(0, scrollY) } }, "");
  } catch { /* History can be unavailable/rate-limited; the current list remains usable. */ }
}
