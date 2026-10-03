import { z } from "zod";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_ATTEMPTS = 2;

const siteverifyResponseSchema = z.object({
  action: z.string().min(1).max(64).optional(),
  challenge_ts: z.iso.datetime().optional(),
  "error-codes": z.array(z.string().min(1).max(128)).max(20).optional(),
  hostname: z.string().min(1).max(253).optional(),
  success: z.boolean(),
});

export type TurnstileVerificationResult =
  | { outcome: "rejected"; reason: "action_mismatch" | "hostname_mismatch" | "invalid_token" }
  | { outcome: "unavailable"; reason: "configuration" | "invalid_response" | "network" | "service_error" }
  | { outcome: "verified"; challengeTimestamp: string };

export interface TurnstileVerifierOptions {
  expectedAction: string;
  expectedHostname: string;
  fetcher?: typeof fetch;
  maxAttempts?: number;
  secret: string | undefined;
  timeoutMs?: number;
}

function validConfiguration(options: TurnstileVerifierOptions): boolean {
  return (
    typeof options.secret === "string" &&
    options.secret.length >= 1 &&
    options.secret.length <= 256 &&
    /^[a-z0-9.-]{1,253}$/u.test(options.expectedHostname) &&
    /^[a-z0-9_-]{1,64}$/u.test(options.expectedAction) &&
    Number.isInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) &&
    (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) >= 1 &&
    (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) <= 10_000 &&
    Number.isInteger(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS) &&
    (options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS) >= 1 &&
    (options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS) <= 3
  );
}

async function requestSiteverify(
  fetcher: typeof fetch,
  body: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(SITEVERIFY_URL, {
      body,
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function createTurnstileVerifier(options: TurnstileVerifierOptions) {
  const fetcher = options.fetcher ?? fetch;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async verify(input: {
      idempotencyKey: string;
      token: string;
    }): Promise<TurnstileVerificationResult> {
      if (!validConfiguration(options)) {
        return { outcome: "unavailable", reason: "configuration" };
      }
      if (
        input.token.length < 1 ||
        input.token.length > 2_048 ||
        !z.uuid().safeParse(input.idempotencyKey).success
      ) {
        return { outcome: "rejected", reason: "invalid_token" };
      }

      const body = JSON.stringify({
        idempotency_key: input.idempotencyKey,
        response: input.token,
        secret: options.secret,
      });

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let response: Response;
        try {
          response = await requestSiteverify(fetcher, body, timeoutMs);
        } catch {
          if (attempt === maxAttempts) return { outcome: "unavailable", reason: "network" };
          continue;
        }

        if (!response.ok) {
          if (attempt === maxAttempts) return { outcome: "unavailable", reason: "service_error" };
          continue;
        }

        let raw: unknown;
        try {
          raw = await response.json();
        } catch {
          if (attempt === maxAttempts) return { outcome: "unavailable", reason: "invalid_response" };
          continue;
        }
        const parsed = siteverifyResponseSchema.safeParse(raw);
        if (!parsed.success) {
          if (attempt === maxAttempts) return { outcome: "unavailable", reason: "invalid_response" };
          continue;
        }

        const result = parsed.data;
        if (result.success) {
          if (
            result.hostname === undefined ||
            result.action === undefined ||
            result.challenge_ts === undefined
          ) {
            return { outcome: "unavailable", reason: "invalid_response" };
          }
          if (result.hostname !== options.expectedHostname) {
            return { outcome: "rejected", reason: "hostname_mismatch" };
          }
          if (result.action !== options.expectedAction) {
            return { outcome: "rejected", reason: "action_mismatch" };
          }
          return { outcome: "verified", challengeTimestamp: result.challenge_ts };
        }

        const errorCodes = new Set(result["error-codes"] ?? []);
        if (
          errorCodes.has("invalid-input-response") ||
          errorCodes.has("missing-input-response") ||
          errorCodes.has("timeout-or-duplicate")
        ) return { outcome: "rejected", reason: "invalid_token" };

        if (
          errorCodes.has("invalid-input-secret") ||
          errorCodes.has("missing-input-secret")
        ) return { outcome: "unavailable", reason: "configuration" };

        if (errorCodes.has("internal-error") && attempt < maxAttempts) continue;
        return { outcome: "unavailable", reason: "service_error" };
      }
      return { outcome: "unavailable", reason: "service_error" };
    },
  };
}
