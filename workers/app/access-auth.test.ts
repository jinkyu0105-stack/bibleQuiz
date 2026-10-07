import { describe, expect, it, vi } from "vitest";

import {
  AccessAuthenticationRequired,
  AccessAuthenticationUnavailable,
  authenticateAccessRequest,
} from "../_shared/services/access-auth";
import {
  createAccessFixture,
  testAccessAudience as audience,
  testAccessIssuer as issuer,
} from "./test/access-fixture";

const now = new Date();

function request(token?: string) {
  return new Request("https://example.com/api/admin/quiz-sets/set-1/close-now", {
    headers: token === undefined ? {} : { "Cf-Access-Jwt-Assertion": token },
  });
}

describe("Cloudflare Access authentication", () => {
  it("verifies RS256 signature, issuer, audience and returns only normalized email", async () => {
    const fixture = await createAccessFixture(now);
    const requests: string[] = [];
    const identity = await authenticateAccessRequest(request(fixture.token), {
      audience,
      fetcher: async (input) => {
        requests.push(String(input));
        return Response.json(fixture.jwks);
      },
      now,
      teamDomain: "test-team.cloudflareaccess.com",
    });
    expect(identity).toEqual({ email: "admin@example.com" });
    expect(requests).toEqual([`${issuer}/cdn-cgi/access/certs`]);
  });

  it.each([
    { iss: "https://other.cloudflareaccess.com" },
    { aud: "wrong-audience" },
    { exp: 1 },
    { email: "not-an-email" },
  ] as const)("rejects a token with invalid claims", async (overrides) => {
    const fixture = await createAccessFixture(now, overrides);
    await expect(authenticateAccessRequest(request(fixture.token), {
      audience,
      fetcher: async () => Response.json(fixture.jwks),
      now,
      teamDomain: issuer,
    })).rejects.toBeInstanceOf(AccessAuthenticationRequired);
  });

  it("rejects missing and tampered assertions without exposing token details", async () => {
    await expect(authenticateAccessRequest(request(), {
      audience,
      fetcher: async () => { throw new Error("must not fetch"); },
      teamDomain: issuer,
    })).rejects.toBeInstanceOf(AccessAuthenticationRequired);
    const fixture = await createAccessFixture(now);
    const parts = fixture.token.split(".");
    const signature = parts[2]!;
    const tampered = `${parts[0]}.${parts[1]}.${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
    await expect(authenticateAccessRequest(request(tampered), {
      audience,
      fetcher: async () => Response.json(fixture.jwks),
      now,
      teamDomain: issuer,
    })).rejects.toBeInstanceOf(AccessAuthenticationRequired);
  });

  it("fails unavailable for invalid configuration and JWKS transport or shape", async () => {
    const fixture = await createAccessFixture(now);
    await expect(authenticateAccessRequest(request(fixture.token), {
      audience,
      teamDomain: "https://example.com",
    })).rejects.toBeInstanceOf(AccessAuthenticationUnavailable);
    await expect(authenticateAccessRequest(request(fixture.token), {
      audience,
      fetcher: async () => new Response("unavailable", { status: 503 }),
      teamDomain: issuer,
    })).rejects.toBeInstanceOf(AccessAuthenticationUnavailable);
    await expect(authenticateAccessRequest(request(fixture.token), {
      audience,
      fetcher: async () => Response.json({ keys: [{ kid: "private-but-invalid" }] }),
      teamDomain: issuer,
    })).rejects.toBeInstanceOf(AccessAuthenticationUnavailable);
  });
  it("reuses only public keys and still rejects a modified token on the next request", async () => {
    const fixture = await createAccessFixture(now);
    const fetcher = vi.fn(async () => Response.json(fixture.jwks));
    const options = { audience, teamDomain: issuer, fetcher, now };
    expect(await authenticateAccessRequest(request(fixture.token), options)).toEqual({ email: "admin@example.com" });
    expect(await authenticateAccessRequest(request(fixture.token), options)).toEqual({ email: "admin@example.com" });
    const parts = fixture.token.split(".");
    const payload = JSON.parse(atob(parts[1]!.replaceAll("-", "+").replaceAll("_", "/")));
    payload.email = "other@example.com";
    parts[1] = btoa(JSON.stringify(payload)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
    await expect(authenticateAccessRequest(request(parts.join(".")), options)).rejects.toBeInstanceOf(AccessAuthenticationRequired);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refreshes an unknown signing key once and verifies the rotated signature", async () => {
    const first = await createAccessFixture(now, {}, "first"), next = await createAccessFixture(now, {}, "next");
    let keys = first.jwks;
    const fetcher = vi.fn(async () => Response.json(keys));
    const options = { audience, teamDomain: issuer, fetcher, now };
    await authenticateAccessRequest(request(first.token), options);
    keys = next.jwks;
    await authenticateAccessRequest(request(next.token), options);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("honors no-store when reading public keys", async () => {
    const fixture = await createAccessFixture(now);
    const fetcher = vi.fn(async () => Response.json(fixture.jwks, { headers: { "Cache-Control": "no-store" } }));
    const options = { audience, teamDomain: issuer, now, fetcher };
    const clock = vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    try {
      await authenticateAccessRequest(request(fixture.token), options);
      await authenticateAccessRequest(request(fixture.token), options);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });

  it.each([0, 5_000])("expires public keys from their load time after %i ms of setup, even when refresh fails", async (setupDelay) => {
    const fixtureTime = new Date("2026-09-01T00:00:00.000Z");
    const fixture = await createAccessFixture(fixtureTime, { exp: Math.floor(fixtureTime.getTime() / 1000) + 1000 });
    const loadedAt = fixtureTime.getTime() + setupDelay;
    // Freeze before loading keys: CI scheduling must not consume the expiry margin.
    const clock = vi.spyOn(Date, "now").mockReturnValue(loadedAt);
    let available = true;
    const fetcher = vi.fn(async () => available ? Response.json(fixture.jwks) : new Response(null, { status: 503 }));
    const authenticate = (time: number) => {
      clock.mockReturnValue(time);
      return authenticateAccessRequest(request(fixture.token), { audience, teamDomain: issuer, now: new Date(time), fetcher });
    };
    try {
      expect(await authenticate(loadedAt)).toEqual({ email: "admin@example.com" });
      available = false;
      expect(await authenticate(loadedAt + 299_999)).toEqual({ email: "admin@example.com" });
      expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(authenticate(loadedAt + 300_000)).rejects.toBeInstanceOf(AccessAuthenticationUnavailable);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await expect(authenticate(loadedAt + 300_001)).rejects.toBeInstanceOf(AccessAuthenticationUnavailable);
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally { clock.mockRestore(); }
  });

});
