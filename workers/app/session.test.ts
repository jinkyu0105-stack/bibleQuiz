import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDatabase } from "../_shared/db/client";
import { anonymousSessions, submissions } from "../_shared/db/schema";
import {
  MAX_MUTATION_JSON_BYTES,
  MutationRequestError,
  readSameOriginJson,
} from "../_shared/http/mutation-request";
import {
  SESSION_COOKIE_NAME,
  generateSessionToken,
  hashSessionToken,
} from "../_shared/services/session";
import { app } from "./app";

const binding = env as Env & {
  ARCHIVE_CURSOR_SECRET: string;
  SESSION_PEPPER: string;
};
const database = createDatabase(binding.DB);
const endpoint = "https://example.com/api/session";

function sessionRequest(
  body = "{}",
  headers: Record<string, string> = {},
): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://example.com",
      ...headers,
    },
    body,
  });
}

async function postSession(request = sessionRequest()) {
  return exports.default.fetch(request);
}

function readToken(response: Response): string {
  const cookie = response.headers.get("Set-Cookie");
  const match = cookie?.match(new RegExp(`^${SESSION_COOKIE_NAME}=([^;]+)`, "u"));
  if (match?.[1] === undefined) throw new Error("Missing session cookie");
  return match[1];
}

beforeEach(async () => {
  await database.delete(submissions);
  await database.delete(anonymousSessions);
});

describe("anonymous session crypto and HTTP boundary", () => {
  it("creates a 256-bit opaque cookie while storing only its HMAC", async () => {
    const response = await postSession();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);

    const cookie = response.headers.get("Set-Cookie") ?? "";
    const token = readToken(response);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(cookie).toContain("Max-Age=15552000");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toMatch(/(?:^|;)\s*Domain=/iu);

    const raw = await response.text();
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(binding.SESSION_PEPPER);
    const parsed = JSON.parse(raw) as { data: { expiresAt: string } };
    const lifetime = Date.parse(parsed.data.expiresAt) - Date.now();
    expect(lifetime).toBeGreaterThan(179 * 24 * 60 * 60 * 1_000);
    expect(lifetime).toBeLessThanOrEqual(180 * 24 * 60 * 60 * 1_000);

    const rows = await database.select().from(anonymousSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionHash).toBe(await hashSessionToken(token, binding.SESSION_PEPPER));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("reuses an active cookie without creating or rotating the session", async () => {
    const token = generateSessionToken();
    const expiresAt = "2099-01-01T00:00:00.000Z";
    await database.insert(anonymousSessions).values({
      sessionHash: await hashSessionToken(token, binding.SESSION_PEPPER),
      createdAt: "2025-01-01T00:00:00.000Z",
      lastSeenAt: "2025-01-01T00:00:00.000Z",
      expiresAt,
    });

    const second = await postSession(sessionRequest("{}", {
      Cookie: `${SESSION_COOKIE_NAME}=${token}`,
    }));
    expect(second.status).toBe(200);
    expect(second.headers.get("Set-Cookie")).toBeNull();
    expect(await second.json()).toEqual({ data: { expiresAt } });
    const rows = await database.select().from(anonymousSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastSeenAt).not.toBe("2025-01-01T00:00:00.000Z");
  });

  it("replaces unknown and expired cookies with new sessions", async () => {
    const unknownToken = generateSessionToken();
    const unknown = await postSession(sessionRequest("{}", {
      Cookie: `${SESSION_COOKIE_NAME}=${unknownToken}`,
    }));
    expect(unknown.status).toBe(200);
    expect(readToken(unknown)).not.toBe(unknownToken);

    const expiredToken = generateSessionToken();
    await database.insert(anonymousSessions).values({
      sessionHash: await hashSessionToken(expiredToken, binding.SESSION_PEPPER),
      createdAt: "2025-01-01T00:00:00.000Z",
      lastSeenAt: "2025-01-01T00:00:00.000Z",
      expiresAt: "2025-06-30T00:00:00.000Z",
    });
    const expired = await postSession(sessionRequest("{}", {
      Cookie: `${SESSION_COOKIE_NAME}=${expiredToken}`,
    }));
    expect(expired.status).toBe(200);
    expect(readToken(expired)).not.toBe(expiredToken);
    expect(await database.select().from(anonymousSessions)).toHaveLength(3);
  });

  it("rejects cross-origin, non-JSON, malformed, extra-field and oversized requests before storage", async () => {
    const cases: Array<[Request, number, string]> = [
      [sessionRequest("{}", { Origin: "https://attacker.example" }), 403, "ORIGIN_NOT_ALLOWED"],
      [new Request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }), 403, "ORIGIN_NOT_ALLOWED"],
      [sessionRequest("{}", { "Content-Type": "text/plain" }), 415, "UNSUPPORTED_MEDIA_TYPE"],
      [sessionRequest("{"), 400, "INVALID_JSON"],
      [sessionRequest('{"token":"client-controlled"}'), 400, "INVALID_SESSION_REQUEST"],
      [sessionRequest(`"${"a".repeat(MAX_MUTATION_JSON_BYTES)}"`), 413, "PAYLOAD_TOO_LARGE"],
    ];

    for (const [request, status, code] of cases) {
      const response = await postSession(request);
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ error: { code, requestId: expect.any(String) } });
    }
    expect(await database.select().from(anonymousSessions)).toHaveLength(0);
  });

  it("accepts JSON charset parameters and rejects non-mutation methods in the shared guard", async () => {
    const response = await postSession(sessionRequest("{}", {
      "Content-Type": "Application/JSON; charset=utf-8",
    }));
    expect(response.status).toBe(200);

    const request = new Request(endpoint, {
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com",
      },
    });
    await expect(readSameOriginJson(request)).rejects.toMatchObject({
      code: "METHOD_NOT_ALLOWED",
      status: 405,
    } satisfies Partial<MutationRequestError>);
  });

  it("fails closed without exposing a missing or malformed pepper", async () => {
    const privateCookie = generateSessionToken();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await app.fetch(sessionRequest("{}", {
      Cookie: `${SESSION_COOKIE_NAME}=${privateCookie}`,
    }), {
      DB: binding.DB,
      SESSION_PEPPER: "not-a-valid-secret",
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.json()).toMatchObject({
      error: { code: "SESSION_UNAVAILABLE", requestId: expect.any(String) },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateCookie);
    expect(JSON.stringify(log.mock.calls)).not.toContain("not-a-valid-secret");
    expect(await database.select().from(anonymousSessions)).toHaveLength(0);
    log.mockRestore();
  });
});
