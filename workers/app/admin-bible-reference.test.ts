import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminBibleReferenceSuccessSchema,
  adminBibleReferenceValidationFailureSchema,
} from "../../shared/api/admin-bible-reference";
import { MAX_MUTATION_JSON_BYTES } from "../_shared/http/mutation-request";
import { createAccessFixture } from "./test/access-fixture";

const origin = "https://example.com";
const parseEndpoint = `${origin}/api/admin/bible/parse-reference`;
const previewEndpoint = `${origin}/api/admin/bible/reference-preview`;

function post(token: string | undefined, body: string, headers: HeadersInit = {}) {
  return exports.default.fetch(new Request(parseEndpoint, {
    body,
    headers: {
      ...(token === undefined ? {} : { "Cf-Access-Jwt-Assertion": token }),
      "Content-Type": "application/json",
      Origin: origin,
      ...headers,
    },
    method: "POST",
  }));
}

describe("administrator Bible reference routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticates before method, query and body validation", async () => {
    const certs = vi.spyOn(globalThis, "fetch");
    const unauthorizedBody = await post(undefined, "not-json");
    expect(unauthorizedBody.status).toBe(401);
    await expect(unauthorizedBody.json()).resolves.toMatchObject({
      error: { code: "ADMIN_AUTH_REQUIRED" },
    });
    expect(certs).not.toHaveBeenCalled();

    const unauthorizedMethod = await exports.default.fetch(new Request(parseEndpoint, {
      method: "GET",
    }));
    expect(unauthorizedMethod.status).toBe(401);
    expect(certs).not.toHaveBeenCalled();
  });

  it("returns the same minimal normalized reference for natural-language and selection input", async () => {
    const fixture = await createAccessFixture(new Date());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.jwks));

    const natural = await post(fixture.token, JSON.stringify({ input: "요한복음 3:1~3" }));
    const selection = await exports.default.fetch(new Request(
      `${previewEndpoint}?book=JHN&chapter=3&verseStart=1&verseEnd=3`,
      { headers: { "Cf-Access-Jwt-Assertion": fixture.token } },
    ));
    const naturalText = await natural.text();
    const selectionText = await selection.text();
    const naturalJson = JSON.parse(naturalText) as unknown;
    const selectionJson = JSON.parse(selectionText) as unknown;

    expect(natural.status).toBe(200);
    expect(selection.status).toBe(200);
    expect(adminBibleReferenceSuccessSchema.parse(naturalJson))
      .toEqual(adminBibleReferenceSuccessSchema.parse(selectionJson));
    expect(natural.headers.get("cache-control")).toBe("private, no-store");
    expect(selection.headers.get("cache-control")).toBe("private, no-store");
    for (const raw of [naturalText, selectionText]) {
      expect(raw).not.toContain("admin@example.com");
      expect(raw).not.toContain("text");
      expect(raw).not.toContain("transcript");
    }
  });

  it("preserves parser error codes without exposing input or authentication values", async () => {
    const fixture = await createAccessFixture(new Date());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.jwks));
    const natural = await post(fixture.token, JSON.stringify({ input: "요한복음 3:37" }));
    const selection = await exports.default.fetch(new Request(
      `${previewEndpoint}?book=JHN&chapter=3&verseStart=37&verseEnd=37`,
      { headers: { "Cf-Access-Jwt-Assertion": fixture.token } },
    ));

    for (const response of [natural, selection]) {
      const text = await response.text();
      expect(response.status).toBe(400);
      expect(adminBibleReferenceValidationFailureSchema.parse(JSON.parse(text)))
        .toMatchObject({ error: { code: "VERSE_OUT_OF_RANGE" } });
      expect(text).not.toContain("admin@example.com");
      expect(text).not.toContain(fixture.token);
    }
  });

  it("strictly rejects extra, duplicate, malformed and wrong-method requests after Access", async () => {
    const fixture = await createAccessFixture(new Date());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.jwks));

    const extraBody = await post(fixture.token, JSON.stringify({
      input: "요 3:16",
      text: "성경 본문을 추가할 수 없음",
    }));
    expect(extraBody.status).toBe(400);
    await expect(extraBody.json()).resolves.toMatchObject({
      error: { code: "INVALID_BIBLE_REFERENCE_REQUEST" },
    });

    const invalidJson = await post(fixture.token, "not-json");
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toMatchObject({ error: { code: "INVALID_JSON" } });

    const wrongMediaType = await post(
      fixture.token,
      JSON.stringify({ input: "요 3:16" }),
      { "Content-Type": "text/plain" },
    );
    expect(wrongMediaType.status).toBe(415);
    await expect(wrongMediaType.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_MEDIA_TYPE" },
    });

    const oversized = await post(fixture.token, JSON.stringify({
      input: "요 3:16",
      padding: "x".repeat(MAX_MUTATION_JSON_BYTES),
    }));
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });

    const malformedQuery = await exports.default.fetch(new Request(
      `${previewEndpoint}?book=JHN&chapter=3&verseStart=1&verseEnd=3&verseEnd=4`,
      { headers: { "Cf-Access-Jwt-Assertion": fixture.token } },
    ));
    expect(malformedQuery.status).toBe(400);
    await expect(malformedQuery.json()).resolves.toMatchObject({
      error: { code: "INVALID_BIBLE_REFERENCE_QUERY" },
    });

    const wrongOrigin = await post(
      fixture.token,
      JSON.stringify({ input: "요 3:16" }),
      { Origin: "https://attacker.example" },
    );
    expect(wrongOrigin.status).toBe(403);
    await expect(wrongOrigin.json()).resolves.toMatchObject({ error: { code: "ORIGIN_NOT_ALLOWED" } });

    const wrongMethod = await exports.default.fetch(new Request(previewEndpoint, {
      headers: { "Cf-Access-Jwt-Assertion": fixture.token },
      method: "POST",
    }));
    expect(wrongMethod.status).toBe(405);
    await expect(wrongMethod.json()).resolves.toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } });
  });
});
