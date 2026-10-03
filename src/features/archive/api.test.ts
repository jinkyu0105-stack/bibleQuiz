import { afterEach, describe, expect, it, vi } from "vitest";
import { parseArchiveQuery } from "../../../shared/api/archive";
import { appendArchive, archiveSearch, fetchArchive, parseArchiveLocation, restoreArchive } from "./api";
import { readArchiveHistory } from "./history";

const item = (index: number) => ({ slug: `2026-08-30-${String(index).padStart(6, "0")}`, title: `시험 ${index}`, sermonDate: "2026-08-30", bibleReferenceLabel: "마태복음 5:1", availableDifficulties: ["child" as const] });
const first = { items: Array.from({ length: 12 }, (_, i) => item(i)), nextCursor: "next.cursor", availableYears: [2026], availableMonths: [8] };
const query = parseArchiveQuery(new URLSearchParams());
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
describe("archive browser API and history", () => {
  it("normalizes URL filters, excluding pagination from shareable URLs", () => {
    expect(archiveSearch(parseArchiveLocation("?q=%20Ａ%20&month=08"))).toBe("q=A&month=8");
    expect(() => parseArchiveLocation("?limit=24")).toThrow();
    expect(() => parseArchiveLocation("?year=bad")).toThrow();
  });
  it("requests a strict no-store page and forwards abort signals", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: first })));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchArchive(query, signal())).toEqual(first);
    expect(fetch).toHaveBeenCalledWith("/api/archive?limit=12", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });
  it.each(["private", "missing-options", "short-with-cursor", "duplicate", "invalid-json"])("rejects %s responses", async (kind) => {
    const data = kind === "private" ? { ...first, answer: "PRIVATE" } : kind === "missing-options" ? { items: [], nextCursor: null } : kind === "short-with-cursor" ? { ...first, items: [] } : { ...first, items: [item(1), item(1)] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(kind === "invalid-json" ? "bad" : JSON.stringify({ data }))));
    await expect(fetchArchive(query, signal())).rejects.toThrow("ARCHIVE_LOAD_FAILED");
  });
  it.each([400, 503])("does not echo server messages for HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("PRIVATE", { status })));
    await expect(fetchArchive(query, signal())).rejects.toMatchObject({ message: "ARCHIVE_LOAD_FAILED", invalidFilter: status === 400 });
  });
  it("restores expanded count using new API reads, retaining first-page options", async () => {
    const second = { items: [item(12)], nextCursor: null };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: first }))).mockResolvedValueOnce(new Response(JSON.stringify({ data: second })));
    vi.stubGlobal("fetch", fetch);
    const restored = await restoreArchive(query, 24, signal());
    expect(restored.items).toHaveLength(13); expect(restored.availableYears).toEqual([2026]);
    expect(fetch.mock.calls[1]?.[0]).toBe("/api/archive?limit=12&cursor=next.cursor");
  });
  it("refuses duplicate items and non-progressing cursors", () => {
    expect(() => appendArchive(first, { items: [item(0)], nextCursor: null })).toThrow();
    expect(() => appendArchive(first, { items: [item(12)], nextCursor: first.nextCursor })).toThrow();
  });
  it("uses only validated count/scroll data for the same filter", () => {
    const state = { key: "router", bibleQuizArchive: { filter: "key", count: 24, scrollY: 803 }, private: "never used" };
    expect(readArchiveHistory(state, "key")).toEqual({ filter: "key", count: 24, scrollY: 803 });
    expect(readArchiveHistory(state, "other")).toBeNull();
    expect(readArchiveHistory({ bibleQuizArchive: { filter: "key", count: -1, scrollY: Infinity } }, "key")).toBeNull();
    expect(readArchiveHistory(null, "key")).toBeNull();
  });
});
