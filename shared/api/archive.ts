import { z } from "zod";
import { difficultySchema, quizSlugSchema } from "./public-quiz";

export class InvalidArchiveFilter extends Error {
  constructor() { super("INVALID_ARCHIVE_FILTER"); }
}
export interface ArchiveQuery {
  q: string;
  year: number | null;
  month: number | null;
  limit: number;
  cursor: string | null;
}
export function parseArchiveQuery(params: URLSearchParams): ArchiveQuery {
  const keys = ["q", "year", "month", "limit", "cursor"];
  if ([...params.keys()].some((key) => !keys.includes(key) || params.getAll(key).length !== 1)) throw new InvalidArchiveFilter();
  const q = (params.get("q") ?? "").trim().normalize("NFKC").trim();
  if ([...q].length > 60) throw new InvalidArchiveFilter();
  const integer = (key: string, min: number, max: number, pattern: RegExp): number | null => {
    const value = params.get(key);
    if (value === null) return null;
    if (!pattern.test(value) || Number(value) < min || Number(value) > max) throw new InvalidArchiveFilter();
    return Number(value);
  };
  const year = integer("year", 1, 9999, /^\d{4}$/u);
  const month = integer("month", 1, 12, /^\d{1,2}$/u);
  const limit = integer("limit", 1, 24, /^\d{1,2}$/u) ?? 12;
  const cursor = params.get("cursor");
  if (cursor !== null && (cursor.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(cursor))) throw new InvalidArchiveFilter();
  return { q, year, month, limit, cursor };
}
/** Stable serialization of normalized filters; page size is not a search filter. */
export function archiveFilterKey(query: Pick<ArchiveQuery, "q" | "year" | "month">): string {
  return JSON.stringify([query.q, query.year, query.month]);
}
export const archiveItemSchema = z.strictObject({
  slug: quizSlugSchema,
  title: z.string().trim().min(1).max(300),
  sermonDate: z.iso.date(),
  bibleReferenceLabel: z.string().trim().min(1).max(300),
  availableDifficulties: z.array(difficultySchema).min(1).max(2).refine((values) => new Set(values).size === values.length),
});
export const archivePageSchema = z.strictObject({
  items: z.array(archiveItemSchema).max(24).refine((items) => new Set(items.map((item) => item.slug)).size === items.length),
  nextCursor: z.string().min(1).max(2048).nullable(),
  availableYears: z.array(z.int().min(1).max(9999)).optional(),
  availableMonths: z.array(z.int().min(1).max(12)).optional(),
}).refine((page) => (page.availableYears === undefined) === (page.availableMonths === undefined));
export const archiveResponseSchema = z.strictObject({ data: archivePageSchema });
export type ArchiveItem = z.infer<typeof archiveItemSchema>;
export type ArchivePage = z.infer<typeof archivePageSchema>;
