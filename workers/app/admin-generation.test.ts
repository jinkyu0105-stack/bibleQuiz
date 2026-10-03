import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccessFixture } from "./test/access-fixture";
import { seedGenerationContext } from "./test/generation-storage-fixture";
import { fullGenerationEnabled } from "../_shared/services/preview-generation-access";
import { app, type AppBindings } from "./app";

afterEach(() => vi.restoreAllMocks());
describe("administrator generation boundary", () => {
  it("keeps unrelated full requests, corrections and regeneration disabled with a Preview fixture grant", async () => {
    const owner = await seedGenerationContext(), other = await seedGenerationContext();
    const access = await createAccessFixture(new Date()), create = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    const bindings: AppBindings = { ...(env as AppBindings), AI_GENERATION_ENABLED: "false",
      P571_SYNTHETIC_SERMON_IDS: JSON.stringify([owner.sermonId]), CONTENT_WORKFLOW: { create } as never };
    const origin = "https://biblequiz-app-preview.jinkyu0105.workers.dev";
    const headers = { "Cf-Access-Jwt-Assertion": access.token, Origin: origin, "Content-Type": "application/json" };
    for (const [subject, enabled] of [[owner, true], [other, false]] as const) {
      const response = await app.request(`${origin}/api/admin/sermons/${subject.sermonId}/generation/content`, { headers }, bindings);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { enabled } });
    }
    const options = { gridSizes: [5], targetWordCounts: [4], seed: "test", maxTrials: 1, searchBudgetPerTrial: 1 };
    const requests = [
      { subject: other, path: "content", body: { requestKey: crypto.randomUUID(), quizSetId: other.quizSetId,
        expectedVersion: 2, selection: { child: { options, index: 0 }, adult: { options, index: 0 } } } },
      { subject: owner, path: "correction", body: { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId, expectedInputVersion: 1 } },
      { subject: owner, path: "regenerate", body: { requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId, expectedVersion: 2, scope: "summary" } },
    ];
    for (const { subject, path, body } of requests) {
      const response = await app.request(`${origin}/api/admin/sermons/${subject.sermonId}/generation/${path}`,
        { method: "POST", headers, body: JSON.stringify(body) }, bindings);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "GENERATION_DISABLED" } });
    }
    expect(create).not.toHaveBeenCalled();
  });
  it("restricts the synthetic override to at most three exact Preview fixture IDs", () => {
    const id = crypto.randomUUID(), other = crypto.randomUUID();
    const origin = "https://biblequiz-app-preview.jinkyu0105.workers.dev";
    const bindings = { CONTENT_WORKFLOW: {}, AI_GENERATION_ENABLED: "false", P571_SYNTHETIC_SERMON_IDS: JSON.stringify([id]) };
    expect(fullGenerationEnabled(bindings, id, origin)).toBe(true);
    expect(fullGenerationEnabled(bindings, other, origin)).toBe(false);
    for (const url of ["https://example.com", "http://biblequiz-app-preview.jinkyu0105.workers.dev",
      "https://biblequiz-app-preview.jinkyu0105.workers.dev.foreign.invalid"]) {
      expect(fullGenerationEnabled(bindings, id, url)).toBe(false);
    }
    for (const value of ["invalid", "true", '["*"]', JSON.stringify([id, other, crypto.randomUUID(), crypto.randomUUID()])]) {
      expect(fullGenerationEnabled({ ...bindings, P571_SYNTHETIC_SERMON_IDS: value }, id, origin)).toBe(false);
    }
    expect(fullGenerationEnabled({ ...bindings, CONTENT_WORKFLOW: undefined }, id, origin)).toBe(false);
    expect(fullGenerationEnabled({ CONTENT_WORKFLOW: {}, AI_GENERATION_ENABLED: "true" }, other, "https://example.com")).toBe(true);
  });
  it("requires Access authentication for reads and mutations", async () => {
    for (const [method, suffix] of [["GET", "correction"], ["POST", "correction"], ["GET", "unknown-job"],
      ["POST", "unknown-job/display-prepare"], ["GET", `unknown-job/display-preparation/${crypto.randomUUID()}`]] as const) {
      const response = await exports.default.fetch(new Request(`https://example.com/api/admin/sermons/unknown/generation/${suffix}`, { method }));
      expect(response.status).toBe(401);
    }
  });
  it("reports the default disabled state without exposing private context", async () => {
    const owner = await seedGenerationContext(), access = await createAccessFixture(new Date());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    const path = `https://example.com/api/admin/sermons/${owner.sermonId}/generation/correction`;
    const headers = { "Cf-Access-Jwt-Assertion": access.token };
    const read = await exports.default.fetch(new Request(path, { headers }));
    expect(read.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await read.json()).toEqual({ data: { enabled: false, quizSetId: owner.quizSetId, latestJobId: null } });
    const body = JSON.stringify({ requestKey: crypto.randomUUID(), quizSetId: owner.quizSetId, expectedInputVersion: 1 });
    const disabled = await exports.default.fetch(new Request(path, { method: "POST", body,
      headers: { ...headers, Origin: "https://example.com", "Content-Type": "application/json" } }));
    expect(disabled.status).toBe(503);
    for (const origin of ["https://foreign.invalid", "null"]) {
      const denied = await exports.default.fetch(new Request(path, { method: "POST", body,
        headers: { ...headers, Origin: origin, "Content-Type": "application/json" } }));
      expect(denied.status).toBe(403);
      const displayDenied = await exports.default.fetch(new Request(path.replace("/correction", "/unknown-job/display-prepare"), {
        method: "POST", body: JSON.stringify({ requestKey: crypto.randomUUID() }),
        headers: { ...headers, Origin: origin, "Content-Type": "application/json" } }));
      expect(displayDenied.status).toBe(403);
    }
    const missing = await exports.default.fetch(new Request(path.replace("/correction", "/missing"), { headers }));
    expect(missing.status).toBe(404);
  });
});
