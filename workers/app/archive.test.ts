import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { archiveResponseSchema, parseArchiveQuery } from "../../shared/api/archive";
import { app } from "./app";
import { createDatabase } from "../_shared/db/client";
import { bibleTranslations, quizSets, quizVariants, sermons, siteState } from "../_shared/db/schema";
import { readArchiveCursor, signArchiveCursor } from "../_shared/repositories/archive-cursor";

const binding = env as Env & { ARCHIVE_CURSOR_SECRET: string };
const database = createDatabase(binding.DB);
const now = "2026-09-01T00:00:00.000Z";
const canary = "PRIVATE_ARCHIVE_CANARY";
async function seed(index: number, date = "2026-08-30", status: "archived" | "published" | "draft" = "archived", title = `시험 ${index}`) {
  const id = index.toString().padStart(6, "0"), slug = `${date}-${id}`;
  await database.insert(sermons).values({ id, slug, slugSuffix: id, churchName: "테스트 교회", sermonTitle: title, sermonDate: date,
    bibleTranslationId: "archive-test", bibleReferenceLabel: "마태복음 5:1-12", bibleReferenceJson: [], bibleTextSnapshot: canary,
    youtubeVideoId: id, youtubeUrl: `https://example.com/${id}`, createdAt: now, updatedAt: now });
  await database.insert(quizSets).values({ id, sermonId: id, status, createdBy: canary, createdAt: now, updatedAt: now,
    opensAt: "2026-08-01T00:00:00.000Z", closesAt: "2026-08-08T00:00:00.000Z" });
  await database.insert(quizVariants).values(["child", "adult"].map((difficulty) => ({ id: `${id}-${difficulty}`, quizSetId: id,
    difficulty: difficulty as "child" | "adult", revision: 1, gridSize: 5, publicGridJson: { size: 5, cells: [] },
    wordCount: 6, activeCellCount: 21, intersectionCount: 9,
    validationReportJson: { errors: [], warnings: [canary], generatedAt: now }, createdAt: now })));
  return slug;
}
beforeEach(async () => {
  await database.delete(siteState); await database.delete(quizSets); await database.delete(sermons); await database.delete(bibleTranslations);
  await database.insert(bibleTranslations).values({ id: "archive-test", displayName: "개역개정", edition: "reference-only", publisherOrRightsholder: "대한성서공회", mode: "reference_only", createdAt: now, updatedAt: now });
});
const fetchArchive = (query = "") => exports.default.fetch(new Request(`https://example.com/api/archive?${query}`));
async function read(query = "") {
  const response = await fetchArchive(query);
  expect(response.status).toBe(200);
  return archiveResponseSchema.parse(await response.json()).data;
}

describe("archive API / isolated migrated D1", () => {
  it("has an explicit empty page and no-store headers", async () => {
    const response = await fetchArchive();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(await response.json()).toEqual({ data: { items: [], nextCursor: null, availableYears: [], availableMonths: [] } });
  });
  it("uses stable descending date/id pagination, default12, recent3 and max24", async () => {
    for (let index = 1; index <= 26; index++) await seed(index, index === 26 ? "2026-09-01" : "2026-08-30");
    const first = await read();
    expect(first.items).toHaveLength(12);
    expect(first.items.map((item) => item.slug.slice(-6))).toEqual(Array.from({ length: 12 }, (_, i) => String(26 - i).padStart(6, "0")));
    expect((await read("limit=3")).items).toEqual(first.items.slice(0, 3));
    expect((await read("limit=24")).items).toHaveLength(24);
    // Inserting a newer item does not repeat/skip remaining older items.
    await seed(27, "2026-09-01");
    const second = await read(new URLSearchParams({ cursor: first.nextCursor! }).toString());
    const third = await read(new URLSearchParams({ cursor: second.nextCursor! }).toString());
    expect(second.items).toHaveLength(12); expect(third.items).toHaveLength(2); expect(third.nextCursor).toBeNull();
    expect(second.availableYears).toBeUndefined();
    const all = [...first.items, ...second.items, ...third.items];
    expect(new Set(all.map((item) => item.slug)).size).toBe(26);
    expect(all.at(-1)?.slug).toBe("2026-08-30-000001");
  });
  it("only exposes archived active valid variants, including non-ranked corrections", async () => {
    for (let i = 1; i <= 7; i++) await seed(i, "2026-08-30", i === 1 ? "published" : i === 2 ? "draft" : "archived");
    await database.update(quizVariants).set({ lifecycleStatus: "superseded" }).where(eq(quizVariants.quizSetId, "000003"));
    await database.update(quizVariants).set({ lifecycleStatus: "withdrawn" }).where(eq(quizVariants.quizSetId, "000004"));
    await database.update(quizVariants).set({ resultsStatus: "invalidated" }).where(eq(quizVariants.quizSetId, "000005"));
    await database.update(quizVariants).set({ resultsStatus: "non_ranked_correction" }).where(eq(quizVariants.quizSetId, "000006"));
    await database.update(quizVariants).set({ lifecycleStatus: "withdrawn" }).where(eq(quizVariants.id, "000007-adult"));
    const response = await fetchArchive(); const raw = await response.text();
    expect(raw).not.toContain(canary);
    for (const field of ["grid", "answer", "solution", "createdBy", "transcript", "quizSetId"]) expect(raw).not.toContain(field);
    const data = archiveResponseSchema.parse(JSON.parse(raw)).data;
    expect(data.items.map((item) => item.slug.slice(-6))).toEqual(["000007", "000006"]);
    expect(data.items[0]?.availableDifficulties).toEqual(["child"]);
  });
  it("searches normalized input literally, escaping %, underscore, backslash and SQL syntax", async () => {
    await seed(1, "2026-08-30", "archived", "ABC 100% 밑_줄 역\\선");
    await seed(2, "2026-08-30", "archived", "다른 제목");
    for (const q of ["  ＡＢＣ  ", "abc", "%", "_", "\\"]) expect((await read(new URLSearchParams({ q }).toString())).items).toHaveLength(1);
    expect((await read(new URLSearchParams({ q: "마태복음" }).toString())).items).toHaveLength(2);
    expect((await read(new URLSearchParams({ q: "%' OR 1=1 --" }).toString())).items).toEqual([]);
  });
  it("searches the full permitted 60 characters including multi-byte Korean and literal punctuation", async () => {
    const q = "가나다라마".repeat(11) + "%_ABC";
    expect([...q]).toHaveLength(60);
    await seed(1, "2026-08-30", "archived", `앞 ${q} 뒤`);
    await seed(2, "2026-08-30", "archived", q.replace("%_", "XX"));
    expect((await read(new URLSearchParams({ q }).toString())).items.map(item => item.slug)).toEqual(["2026-08-30-000001"]);
    expect((await fetchArchive(new URLSearchParams({ q: q + "가" }).toString())).status).toBe(400);
  });
  it("filters by sermon date including month-only and offers only eligible dates", async () => {
    await seed(1, "2025-08-03"); await seed(2, "2026-08-30"); await seed(3, "2026-09-01");
    await seed(4, "2024-12-01", "published"); await seed(5, "2023-11-01", "draft");
    expect((await read("month=8")).items).toHaveLength(2);
    const selected = await read("year=2025");
    expect(selected.availableYears).toEqual([2026, 2025]); expect(selected.availableMonths).toEqual([8]);
    expect((await read("year=2026&month=9")).items[0]?.slug).toBe("2026-09-01-000003");
    expect((await read("year=2026&q=nomatch")).availableMonths).toEqual([8, 9]);
  });
  it.each(["month=13", "year=202", "limit=25", "cursor=bad", "q=x&q=y", "answer=yes"])("rejects invalid query %s", async (query) => {
    const response = await fetchArchive(query); expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_ARCHIVE_FILTER" } });
  });
  it("rejects changed cursor signature/payload, cross-filter reuse and key rotation", async () => {
    await seed(1); await seed(2);
    const first = await read("limit=1&q=시험"); const cursor = first.nextCursor!;
    for (const query of [new URLSearchParams({ cursor, q: "다른" }), new URLSearchParams({ cursor, q: "시험", year: "2026" }), new URLSearchParams({ cursor: `A${cursor.slice(1)}`, q: "시험" }), new URLSearchParams({ cursor: cursor.replace(/\.[^.]/u, (value) => value === ".A" ? ".B" : ".A"), q: "시험" })]) {
      expect((await fetchArchive(query.toString())).status).toBe(400);
    }
    const query = parseArchiveQuery(new URLSearchParams({ q: "시험" }));
    const otherKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    await expect(readArchiveCursor(cursor, query, otherKey)).rejects.toThrow("INVALID_ARCHIVE_FILTER");
    expect(await readArchiveCursor(await signArchiveCursor({ date: "2026-08-30", id: "000002" }, query, binding.ARCHIVE_CURSOR_SECRET), query, binding.ARCHIVE_CURSOR_SECRET)).toEqual({ date: "2026-08-30", id: "000002" });
  });
  it("fails closed without a configured key or with corrupt metadata; no raw secrets/errors", async () => {
    await seed(1); await seed(2);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const missingKey = await app.request("https://example.com/api/archive?limit=1", {}, { DB: binding.DB });
      expect(missingKey.status).toBe(503);
      await database.update(sermons).set({ slug: `broken-${canary}` }).where(eq(sermons.id, "000001"));
      const response = await fetchArchive(); expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(canary);
      expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
      expect(JSON.stringify(log.mock.calls)).not.toContain(binding.ARCHIVE_CURSOR_SECRET);
    } finally { log.mockRestore(); }
  });
});
