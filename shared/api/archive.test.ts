import { describe, expect, it } from "vitest";
import { archiveFilterKey, archiveResponseSchema, parseArchiveQuery } from "./archive";

describe("archive public contract", () => {
  it("normalizes Unicode before the 60-code-point limit and permits month-only filtering", () => {
    expect(parseArchiveQuery(new URLSearchParams({ q: "  ＡＢＣ 값  ", month: "08" }))).toEqual({ q: "ABC 값", year: null, month: 8, limit: 12, cursor: null });
    expect(parseArchiveQuery(new URLSearchParams({ q: "가".repeat(60) })).q).toHaveLength(60);
    expect(archiveFilterKey(parseArchiveQuery(new URLSearchParams("q=%20Ａ%20")))).toBe(archiveFilterKey(parseArchiveQuery(new URLSearchParams("q=A"))));
  });
  it.each(["year=0", "year=10000", "year=26", "year=", "month=0", "month=13", "month=1.5", "limit=0", "limit=25", "limit=1e1", "limit=-1", "q=a&q=b", "solution=true", "cursor=", "cursor=a.b.c", `q=${"가".repeat(61)}`, `q=${"㍿".repeat(16)}`])("rejects invalid input %s", (query) => {
    expect(() => parseArchiveQuery(new URLSearchParams(query))).toThrow("INVALID_ARCHIVE_FILTER");
  });
  it("rejects private fields at response, page and item boundaries", () => {
    const item = { slug: "2026-08-31-test01", title: "시험", sermonDate: "2026-08-31", bibleReferenceLabel: "마태복음 5:1", availableDifficulties: ["child"] };
    const data = { items: [item], nextCursor: null, availableYears: [2026], availableMonths: [8] };
    expect(archiveResponseSchema.safeParse({ data }).success).toBe(true);
    for (const body of [{ data, solution: "private" }, { data: { ...data, solution: "private" } }, { data: { ...data, items: [{ ...item, answer: "답" }] } }, { data: { ...data, items: [item, item] } }]) {
      expect(archiveResponseSchema.safeParse(body).success).toBe(false);
    }
  });
});
