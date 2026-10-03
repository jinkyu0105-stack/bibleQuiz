import { describe, expect, it } from "vitest";

import { createTurnstileVerifier } from "../_shared/services/turnstile";

const secret = "test-secret-not-a-real-turnstile-key";
const token = "test-token-not-a-real-turnstile-token";
const idempotencyKey = "01924f8e-7b2a-7f1c-8f3a-123456789abc";

function successResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    success: true,
    challenge_ts: "2026-09-01T00:00:00.000Z",
    hostname: "example.com",
    action: "quiz_submission",
    "error-codes": [],
    ...overrides,
  });
}

function verifier(fetcher: typeof fetch, overrides: Partial<Parameters<typeof createTurnstileVerifier>[0]> = {}) {
  return createTurnstileVerifier({
    expectedAction: "quiz_submission",
    expectedHostname: "example.com",
    fetcher,
    secret,
    ...overrides,
  });
}

describe("Turnstile Siteverify adapter", () => {
  it("sends the secret only to the canonical server endpoint and verifies hostname/action", async () => {
    const requests: Array<{
      body: string;
      contentType: string | null;
      input: string;
      method: string | undefined;
    }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({
        body: String(init?.body),
        contentType: new Headers(init?.headers).get("Content-Type"),
        input: String(input),
        method: init?.method,
      });
      return successResponse({ metadata: { ignored: true } });
    };
    const result = await verifier(fetcher).verify({ idempotencyKey, token });

    expect(result).toEqual({
      outcome: "verified",
      challengeTimestamp: "2026-09-01T00:00:00.000Z",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.contentType).toBe("application/json");
    const body = JSON.parse(requests[0]?.body ?? "") as Record<string, unknown>;
    expect(body).toEqual({ idempotency_key: idempotencyKey, response: token, secret });
    expect(body).not.toHaveProperty("remoteip");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("rejects invalid, expired and already-used tokens without retrying", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] });
    };
    await expect(verifier(fetcher).verify({ idempotencyKey, token })).resolves.toEqual({
      outcome: "rejected",
      reason: "invalid_token",
    });
    expect(calls).toBe(1);
  });

  it.each([
    [{ hostname: "attacker.example" }, "hostname_mismatch"],
    [{ action: "different_action" }, "action_mismatch"],
  ] as const)("rejects successful tokens with mismatched deployment metadata", async (response, reason) => {
    const fetcher: typeof fetch = async () => successResponse(response);
    await expect(verifier(fetcher).verify({ idempotencyKey, token })).resolves.toEqual({
      outcome: "rejected",
      reason,
    });
  });

  it("treats incomplete success metadata and rejected secret configuration as unavailable", async () => {
    await expect(verifier(async () => Response.json({
      success: true,
      challenge_ts: "2026-09-01T00:00:00.000Z",
      hostname: "example.com",
    })).verify({ idempotencyKey, token })).resolves.toEqual({
      outcome: "unavailable",
      reason: "invalid_response",
    });
    await expect(verifier(async () => Response.json({
      success: false,
      "error-codes": ["invalid-input-secret"],
    })).verify({ idempotencyKey, token })).resolves.toEqual({
      outcome: "unavailable",
      reason: "configuration",
    });
  });

  it("retries a transient internal error with the same idempotency request", async () => {
    const bodies: string[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      bodies.push(String(init?.body));
      return bodies.length === 1
        ? Response.json({ success: false, "error-codes": ["internal-error"] })
        : successResponse();
    };
    await expect(verifier(fetcher).verify({ idempotencyKey, token }))
      .resolves.toMatchObject({ outcome: "verified" });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it("fails unavailable after bounded network, HTTP and malformed-response retries", async () => {
    const cases: Array<[typeof fetch, string]> = [
      [async () => { throw new Error("PRIVATE_NETWORK_DETAIL"); }, "network"],
      [async () => new Response("unavailable", { status: 503 }), "service_error"],
      [async () => Response.json({ success: "not-a-boolean" }), "invalid_response"],
    ];
    for (const [fetcher, reason] of cases) {
      let calls = 0;
      const countingFetcher: typeof fetch = async (input, init) => {
        calls += 1;
        return fetcher(input, init);
      };
      const result = await verifier(countingFetcher).verify({ idempotencyKey, token });
      expect(result).toEqual({ outcome: "unavailable", reason });
      expect(calls).toBe(2);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_NETWORK_DETAIL");
    }
  });

  it("aborts a hung verification at the configured timeout", async () => {
    const fetcher: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    await expect(verifier(fetcher, { maxAttempts: 1, timeoutMs: 5 }).verify({ idempotencyKey, token }))
      .resolves.toEqual({ outcome: "unavailable", reason: "network" });
  });

  it("fails closed before fetch for configuration and input boundary errors", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return successResponse();
    };
    await expect(verifier(fetcher, { secret: undefined }).verify({ idempotencyKey, token }))
      .resolves.toEqual({ outcome: "unavailable", reason: "configuration" });
    await expect(verifier(fetcher).verify({ idempotencyKey, token: "x".repeat(2_049) }))
      .resolves.toEqual({ outcome: "rejected", reason: "invalid_token" });
    await expect(verifier(fetcher).verify({ idempotencyKey: "not-a-uuid", token }))
      .resolves.toEqual({ outcome: "rejected", reason: "invalid_token" });
    expect(calls).toBe(0);
  });
});
