import { env, exports } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { readSermonTheme, saveSermonTheme } from "../_shared/services/sermon-themes";
import { createAccessFixture } from "./test/access-fixture";
const db = (env as Env).DB, actor = "synthetic@example.invalid";
afterEach(() => vi.restoreAllMocks());
it("persists month-specific themes, clears them, rejects stale saves and audits only committed changes", async () => {
  const month = "2081-10";
  expect(await readSermonTheme(db, month)).toEqual({ month, theme: "", revision: null });
  const first = await saveSermonTheme(db, month, { theme: "  함께 자라는 믿음  ", expectedRevision: null }, actor);
  expect((await readSermonTheme(db, month)).theme).toBe("함께 자라는 믿음");
  expect((await readSermonTheme(db, "2081-11")).theme).toBe("");
  await expect(saveSermonTheme(db, month, { theme: "오래된 입력", expectedRevision: null }, actor)).rejects.toMatchObject({ code: "CONFLICT" });
  const cleared = await saveSermonTheme(db, month, { theme: "", expectedRevision: first.revision }, actor);
  expect(cleared.theme).toBe(""); expect(cleared.revision).not.toBe(first.revision);
  await expect(saveSermonTheme(db, month, { theme: "오래된 수정", expectedRevision: first.revision }, actor)).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await db.prepare("SELECT id FROM audit_logs WHERE entity_type='sermon_theme' AND entity_id=?").bind(month).all()).results).toHaveLength(2);
});
it("rolls the audit gate back when the write fails and rejects malformed month/theme", async () => {
  await db.prepare("CREATE TRIGGER fail_theme BEFORE INSERT ON site_state WHEN NEW.key='sermon_theme:2082-01' BEGIN SELECT RAISE(ABORT,'test'); END").run();
  try {
    await expect(saveSermonTheme(db, "2082-01", { theme: "시험", expectedRevision: null }, actor)).rejects.toThrow();
    expect(await db.prepare("SELECT id FROM audit_logs WHERE entity_type='sermon_theme' AND entity_id='2082-01'").first()).toBeNull();
  } finally { await db.prepare("DROP TRIGGER fail_theme").run(); }
  for (const month of ["2026-13", "0000-01", "2026-1", "<script>"]) await expect(readSermonTheme(db, month)).rejects.toThrow();
  for (const theme of ["가".repeat(121), "두\n줄", "숨김\u200b문자"]) await expect(saveSermonTheme(db, "2082-02", { theme, expectedRevision: null }, actor)).rejects.toThrow();
});
it("requires admin Access and same-origin JSON and returns no-store data", async () => {
  const access = await createAccessFixture(new Date());
  vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    if (String(input).startsWith("https://test-team.cloudflareaccess.com/")) return Response.json(access.jwks);
    throw new Error("external forbidden");
  });
  const call = (method = "GET", headers: Record<string,string> = {}, path = "2083-01") => exports.default.fetch(new Request(`https://example.com/api/admin/sermon-themes/${path}`, {
    method, headers: { "Cf-Access-Jwt-Assertion": access.token, Origin: "https://example.com", "Content-Type": "application/json", ...headers },
    ...(method === "PATCH" ? { body: JSON.stringify({ theme: "주제 시험", expectedRevision: null }) } : {}),
  }));
  expect((await call("GET", { "Cf-Access-Jwt-Assertion": "" })).status).toBe(401);
  expect((await call("PATCH", { Origin: "https://evil.invalid" })).status).toBe(403);
  expect((await call("PATCH", { "Content-Type": "text/plain" })).status).toBe(415);
  expect((await call("GET", {}, "2026-13")).status).toBe(400);
  expect((await call("GET", {}, "2083-01?extra=1")).status).toBe(400);
  expect((await call("DELETE")).status).toBe(405);
  expect((await call("PATCH")).status).toBe(200);
  const result = await call(); expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await result.json()).toMatchObject({ data: { month: "2083-01", theme: "주제 시험" } });
  expect((await call("PATCH")).status).toBe(409);
});
