/// <reference types="vite/client" />
// Imported only by the generated, loopback-only development configuration.
import { app, type AppBindings } from "../app/app";
import { createAccessFixture, testAccessAudience, testAccessIssuer } from "../app/test/access-fixture";

export type LocalDemoBindings = Pick<AppBindings, "DB" | "SESSION_PEPPER" | "ARCHIVE_CURSOR_SECRET"> & { LOCAL_DEMO_ENABLED?: string };
let identity: ReturnType<typeof createAccessFixture> | undefined;
let issuedAt = 0;
const localHosts = new Set(["localhost", "127.0.0.1"]);

export async function localDemoFetch(request: Request, env: LocalDemoBindings, context?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (!import.meta.env?.DEV || env.LOCAL_DEMO_ENABLED !== "true" || url.protocol !== "http:" || !localHosts.has(url.hostname)) {
    return new Response("Local demo only", { status: 403 });
  }
  const origin = request.headers.get("Origin");
  if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return new Response("Same-origin local demo only", { status: 403 });
  }
  if (!identity || Date.now() - issuedAt > 240_000) {
    issuedAt = Date.now();
    identity = createAccessFixture(new Date(), { email: "local-demo@example.test" });
  }
  const fixture = await identity;
  const headers = new Headers(request.headers);
  headers.set("Cf-Access-Jwt-Assertion", fixture.token);
  const accessFetcher: typeof fetch = async input => {
    if (String(input) !== `${testAccessIssuer}/cdn-cgi/access/certs`) return new Response(null, { status: 404 });
    return Response.json(fixture.jwks);
  };
  const turnstileFetcher: typeof fetch = async (input, init) => {
    if (String(input) !== "https://challenges.cloudflare.com/turnstile/v0/siteverify") return new Response(null, { status: 404 });
    const payload = JSON.parse(String(init?.body)) as { response?: string };
    const action = payload.response === "local-demo-quiz_submission" ? "quiz_submission" : payload.response === "local-demo-privacy_request" ? "privacy_request" : undefined;
    return Response.json(action ? { success: true, action, hostname: url.hostname, challenge_ts: new Date().toISOString() } : { success: false, "error-codes": ["invalid-input-response"] });
  };
  // Explicit bindings exclude real provider keys, workflows, backups and cron.
  const response = await app.fetch(new Request(request, { headers }), {
    DB: env.DB, SESSION_PEPPER: env.SESSION_PEPPER, ARCHIVE_CURSOR_SECRET: env.ARCHIVE_CURSOR_SECRET,
    ACCESS_AUD: testAccessAudience, ACCESS_TEAM_DOMAIN: testAccessIssuer, ACCESS_JWKS_FETCH: accessFetcher,
    TURNSTILE_SECRET: "local-demo-test-only", TURNSTILE_EXPECTED_HOSTNAME: url.hostname, TURNSTILE_SITEVERIFY_FETCH: turnstileFetcher,
    AI_GENERATION_ENABLED: "false", DRAFT_CLEANUP_ENABLED: "false", OPERATIONS_CRON_ENABLED: "false",
  }, context);
  response.headers.set("x-biblequiz-environment", "local-demo");
  return response;
}
export default { fetch: localDemoFetch };
