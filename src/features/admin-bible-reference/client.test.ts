import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseAdminBibleReference,
  previewAdminBibleReference,
} from "./client";

const reference = {
  canonicalLabel: "요한복음 3:1–3",
  mode: "reference_only" as const,
  readingPortalUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE" as const,
  reference: {
    bookId: "JHN" as const,
    end: { chapter: 3, verse: 3 },
    start: { chapter: 3, verse: 1 },
  },
  translation: "개역개정" as const,
  verseCount: 3,
};

afterEach(() => vi.unstubAllGlobals());

describe("admin bible reference browser client", () => {
  it("posts strict natural-language input with private no-store browser settings", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: reference }));
    vi.stubGlobal("fetch", fetcher);

    await expect(parseAdminBibleReference("요한복음 3:1-3")).resolves.toEqual({ ok: true, data: reference });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/bible/parse-reference",
      expect.objectContaining({
        body: JSON.stringify({ input: "요한복음 3:1-3" }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "POST",
      }),
    );
  });

  it("uses the exact selection query without sending local book metadata", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: reference }));
    vi.stubGlobal("fetch", fetcher);

    await expect(previewAdminBibleReference({
      book: "JHN", chapter: 3, verseEnd: 3, verseStart: 1,
    })).resolves.toEqual({ ok: true, data: reference });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/bible/reference-preview?book=JHN&chapter=3&verseEnd=3&verseStart=1",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin", method: "GET" }),
    );
  });

  it("keeps validated server errors but replaces malformed or private responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: {
        code: "VERSE_OUT_OF_RANGE",
        message: "요한복음 3장은 1절부터 36절까지 있습니다.",
        requestId: "123e4567-e89b-42d3-a456-426614174000",
      },
    }, { status: 400 })));
    await expect(parseAdminBibleReference("요한복음 3:99")).resolves.toMatchObject({
      ok: false,
      error: { code: "VERSE_OUT_OF_RANGE", requestId: "123e4567-e89b-42d3-a456-426614174000" },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      data: { ...reference, text: "PRIVATE_CANARY" },
    })));
    const malformed = await parseAdminBibleReference("요한복음 3:1-3");
    expect(malformed).toMatchObject({ ok: false, error: { code: "CLIENT_UNAVAILABLE" } });
    expect(JSON.stringify(malformed)).not.toContain("PRIVATE_CANARY");
  });
});
