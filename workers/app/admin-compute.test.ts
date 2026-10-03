import { env } from "cloudflare:workers";
import { createExecutionContext, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "./app";
import { adminComputeShard, fetchWithAdminCompute, type AdminComputeBindings } from "./admin-compute";
import { createAccessFixture } from "./test/access-fixture";

const bindings = env as unknown as AdminComputeBindings;
const origin = "https://example.com";
const reference = `${origin}/api/admin/bible/reference-preview?book=JHN&chapter=3&verseStart=16&verseEnd=16`;
const forward = (request: Request, override: Partial<AdminComputeBindings> = {}) =>
  fetchWithAdminCompute(request, { ...bindings, ADMIN_COMPUTE_ENABLED: "true", ...override }, createExecutionContext());

afterEach(() => vi.restoreAllMocks());

describe("internal administrator compute", () => {
  it("keeps related sections in one bounded shard and separates resources", () => {
    const id = "0096192d-3c52-4a41-906e-ae95c7844592";
    expect(adminComputeShard(`/api/admin/sermons/${id}/generation/content`))
      .toBe(adminComputeShard(`/api/admin/sermons/${id}/input`));
    const shards = new Set(Array.from({ length: 100 }, (_, n) => adminComputeShard(`/api/admin/sermons/id-${n}/input`)));
    expect(shards.size).toBe(8);
    expect(adminComputeShard("/api/admin/sermon-drafts")).toBe("admin-v1-global");
  });

  it("requires authentication inside the actual DO before processing a request", async () => {
    const response = await forward(new Request(reference));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "ADMIN_AUTH_REQUIRED" } });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("preserves authenticated GET output and checks each subsequent token", async () => {
    const fixture = await createAccessFixture(new Date());
    const certs = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.jwks));
    const request = () => new Request(reference, { headers: { "Cf-Access-Jwt-Assertion": fixture.token } });
    const direct = await app.fetch(request(), bindings, createExecutionContext());
    const delegated = await forward(request());
    expect(delegated.status).toBe(200);
    expect(await delegated.json()).toEqual(await direct.json());
    expect(delegated.headers.get("cache-control")).toBe("private, no-store");
    const bad = await forward(new Request(reference, { headers: { "Cf-Access-Jwt-Assertion": "invalid" } }));
    expect(bad.status).toBe(401);
    expect(certs).toHaveBeenCalledTimes(1);
  });

  it("streams POST bodies unchanged and retains the original Origin guard", async () => {
    const fixture = await createAccessFixture(new Date());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.jwks));
    const post = (requestOrigin: string) => new Request(`${origin}/api/admin/bible/parse-reference`, {
      method: "POST", body: JSON.stringify({ input: "요 3:16" }),
      headers: { "Content-Type": "application/json", Origin: requestOrigin, "Cf-Access-Jwt-Assertion": fixture.token },
    });
    const direct = await app.fetch(post(origin), bindings, createExecutionContext());
    const delegated = await forward(post(origin));
    expect(delegated.status).toBe(200);
    expect(await delegated.json()).toEqual(await direct.json());
    expect((await forward(post("https://untrusted.invalid"))).status).toBe(403);
  });

  it("does not expose non-admin routes through the internal object", async () => {
    const response = await bindings.ADMIN_COMPUTE!.getByName("admin-v1-global")
      .fetch(new Request(`${origin}/api/health`));
    expect(response.status).toBe(404);
  });

  it("does not cache identities or write DO storage and survives object eviction", async () => {
    const fixture = await createAccessFixture(new Date());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.jwks));
    const stub = bindings.ADMIN_COMPUTE!.getByName("admin-eviction-test");
    const first = await stub.fetch(new Request(reference, { headers: { "Cf-Access-Jwt-Assertion": fixture.token } }));
    expect(first.status).toBe(200);
    await first.arrayBuffer();
    expect(await runInDurableObject(stub, async (_, state) => (await state.storage.list()).size)).toBe(0);
    await evictDurableObject(stub);
    const unauthorized = await stub.fetch(new Request(reference));
    expect(unauthorized.status).toBe(401);
    await unauthorized.arrayBuffer();
    const resumed = await stub.fetch(new Request(reference, { headers: { "Cf-Access-Jwt-Assertion": fixture.token } }));
    expect(resumed.status).toBe(200);
    await resumed.arrayBuffer();
  });

  it("fails without command replay when the binding is absent or fails after dispatch", async () => {
    const unavailable = await forward(new Request(reference), { ADMIN_COMPUTE: undefined });
    expect(unavailable.status).toBe(503);
    const fetcher = vi.fn().mockRejectedValue(new Error("private failure"));
    const namespace = { getByName: vi.fn(() => ({ fetch: fetcher })) } as unknown as AdminComputeBindings["ADMIN_COMPUTE"];
    const response = await forward(new Request(`${origin}/api/admin/sermon-drafts`, {
      method: "POST", body: "do not retry", headers: { "Content-Type": "application/json" },
    }), { ADMIN_COMPUTE: namespace });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private failure");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("leaves public paths on the existing app and supports the disabled local profile", async () => {
    const getByName = vi.fn();
    const namespace = { getByName } as unknown as AdminComputeBindings["ADMIN_COMPUTE"];
    const response = await forward(new Request(`${origin}/api/health`), { ADMIN_COMPUTE: namespace });
    expect(response.status).toBe(200);
    const local = await forward(new Request(reference), { ADMIN_COMPUTE_ENABLED: "false", ADMIN_COMPUTE: namespace });
    expect(local.status).toBe(401);
    expect(getByName).not.toHaveBeenCalled();
  });
});
