import { archiveResponseSchema, parseArchiveQuery, type ArchivePage, type ArchiveQuery } from "../../../shared/api/archive";

export class ArchiveLoadError extends Error {
  constructor(readonly invalidFilter = false) { super("ARCHIVE_LOAD_FAILED"); }
}
export function parseArchiveLocation(search: string): ArchiveQuery {
  const params = new URLSearchParams(search);
  // Pagination belongs to history state, never to shareable page URLs.
  if ([...params.keys()].some((key) => !["q", "year", "month"].includes(key))) throw new ArchiveLoadError(true);
  return parseArchiveQuery(params);
}
export function archiveSearch(query: Pick<ArchiveQuery, "q" | "year" | "month">): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.year !== null) params.set("year", String(query.year).padStart(4, "0"));
  if (query.month !== null) params.set("month", String(query.month));
  return params.toString();
}
export async function fetchArchive(query: ArchiveQuery, signal: AbortSignal): Promise<ArchivePage> {
  const params = new URLSearchParams(archiveSearch(query));
  params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  try {
    const response = await fetch(`/api/archive?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new ArchiveLoadError(response.status === 400);
    const parsed = archiveResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.data.items.length > query.limit ||
      (!query.cursor && (parsed.data.data.availableYears === undefined || parsed.data.data.availableMonths === undefined)) ||
      (parsed.data.data.nextCursor !== null && parsed.data.data.items.length !== query.limit)) throw new ArchiveLoadError();
    return parsed.data.data;
  } catch (error) {
    if (error instanceof ArchiveLoadError) throw error;
    throw new ArchiveLoadError();
  }
}
/** Re-fetch expanded pages on Back/refresh so withdrawn metadata is not restored from a cache. */
export async function restoreArchive(query: ArchiveQuery, count: number, signal: AbortSignal): Promise<ArchivePage> {
  let page = await fetchArchive({ ...query, cursor: null }, signal);
  const cursors = new Set<string>();
  while (page.items.length < count && page.nextCursor) {
    if (cursors.has(page.nextCursor)) throw new ArchiveLoadError();
    cursors.add(page.nextCursor);
    const next = await fetchArchive({ ...query, cursor: page.nextCursor }, signal);
    page = appendArchive(page, next);
  }
  return page;
}
export function appendArchive(previous: ArchivePage, next: ArchivePage): ArchivePage {
  const slugs = new Set(previous.items.map((item) => item.slug));
  if (next.items.some((item) => slugs.has(item.slug)) || (next.nextCursor !== null && next.nextCursor === previous.nextCursor)) throw new ArchiveLoadError();
  return { ...previous, items: [...previous.items, ...next.items], nextCursor: next.nextCursor };
}
