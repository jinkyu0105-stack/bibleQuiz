import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { localDemoFetch } from "../local-demo/index";
import { app } from "./app";
const db = (env as Env).DB;
const bindings = { DB: db, LOCAL_DEMO_ENABLED: "true", SESSION_PEPPER: "a".repeat(64), ARCHIVE_CURSOR_SECRET: "b".repeat(64) };

it("local demo requires loopback HTTP, explicit opt-in and same-origin requests", async () => {
  for (const url of ["https://localhost/api/admin/dashboard", "https://example.com/api/admin/dashboard", "http://192.168.0.1/api/admin/dashboard"]) {
    expect((await localDemoFetch(new Request(url), bindings)).status).toBe(403);
  }
  expect((await localDemoFetch(new Request("http://localhost:5173/api/admin/dashboard"), { DB: db })).status).toBe(403);
  expect((await localDemoFetch(new Request("http://localhost:5173/api/admin/dashboard", { headers: { Origin: "https://other.example" } }), bindings)).status).toBe(403);
  expect((await localDemoFetch(new Request("http://localhost:5173/api/admin/dashboard", { headers: { "Sec-Fetch-Site": "cross-site" } }), bindings)).status).toBe(403);
});
it("local demo authenticates synthetic identity while the normal app still rejects anonymous access", async () => {
  const request = new Request("http://localhost:5173/api/admin/dashboard");
  const normal = await app.fetch(request, { DB: db, ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com", ACCESS_AUD: "test-access-audience" });
  expect(normal.status).toBe(401);
  const result = await localDemoFetch(request, bindings);
  expect(result.status).toBe(200);
  expect(result.headers.get("x-biblequiz-environment")).toBe("local-demo");
  expect(await result.json()).toMatchObject({ data: { items: [] } });
});
it("local demo persists a synthetic inquiry through the real API and keeps same-origin write checks", async () => {
  const body = { requestKey: crypto.randomUUID(), requestType: "privacy_question", quizSlug: null, submittedName: "로컬시험", message: "로컬 저장과 문의 처리를 확인합니다.", turnstileToken: "local-demo-privacy_request" };
  const url = "http://localhost:5173/api/privacy-requests";
  const invalid = await localDemoFetch(new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" }, body: JSON.stringify({...body, turnstileToken: "invalid"}) }), bindings);
  expect(invalid.status).toBe(403);
  const saved = await localDemoFetch(new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" }, body: JSON.stringify(body) }), bindings);
  expect(saved.status).toBe(200);
  const row = await db.prepare("SELECT submitted_name FROM privacy_requests WHERE submitted_name='로컬시험'").first();
  expect(row).toEqual({ submitted_name: "로컬시험" });
});
