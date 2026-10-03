import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccessFixture } from "./test/access-fixture";
afterEach(() => vi.restoreAllMocks());
describe("administrator publication boundary", () => {
  const url = "https://example.com/api/admin/quiz-sets/test-quiz/publish";
  it("requires Access for every method", async () => {
    for (const method of ["POST", "GET", "PUT"]) expect((await exports.default.fetch(new Request(url, { method }))).status).toBe(401);
  });
  it("enforces same origin, strict commands and safe errors with no generation opt-in", async () => {
    const access = await createAccessFixture(new Date());
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    const auth = { "Cf-Access-Jwt-Assertion": access.token };
    const command = { requestKey: crypto.randomUUID(), jobId: "test-job", expectedVersion: 12,
      expectedMetadataRevision: 1, expectedSelectionRevision: 1, confirmation: "publish" };
    for (const origin of ["https://foreign.invalid", "null", ""]) {
      const result = await exports.default.fetch(new Request(url, { method: "POST", body: JSON.stringify(command),
        headers: { ...auth, "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) } }));
      expect(result.status).toBe(403);
    }
    const wrongMethod = await exports.default.fetch(new Request(url, { headers: auth }));
    expect(wrongMethod.status).toBe(405);
    for (const body of [{ ...command, unexpected: "TEST_ONLY_PRIVATE" }, { ...command, confirmation: "draft" }, command]) {
      const result = await exports.default.fetch(new Request(url, { method: "POST", body: JSON.stringify(body),
        headers: { ...auth, "Content-Type": "application/json", Origin: "https://example.com" } }));
      expect(result.status).toBe(409);
      expect(result.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await result.text()).not.toMatch(/TEST_ONLY_PRIVATE|SELECT|D1_ERROR|solution|token/u);
    }
    expect(fetcher.mock.calls.every(([input]) => String(input).includes("cloudflareaccess.com"))).toBe(true);
  });
});
