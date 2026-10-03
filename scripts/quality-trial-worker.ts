// Local trial entry only. Production workers/app/index.ts never imports this module.
import { z } from "zod";
import { app, type AppBindings } from "../workers/app/app";
import { AccessAuthenticationRequired, AccessAuthenticationUnavailable, authenticateAccessRequest } from "../workers/_shared/services/access-auth";
import { MutationRequestError, readSameOriginJson } from "../workers/_shared/http/mutation-request";
import { privateTranscriptSchema, transcriptDiagnosticSchema, transcriptProvider } from "../workers/_shared/services/accountless-transcript-contract";
import { importPublicSermonCaptions, PublicVideoError } from "../workers/_shared/services/public-sermon-video";
import { verifySource } from "../workers/_shared/services/transcript-content";

const captureSchema = z.object({ result: z.object({ outcome: z.literal("fetched"),
  transcript: privateTranscriptSchema, diagnostic: transcriptDiagnosticSchema }) });
const requestSchema = z.strictObject({ expectedVersion: z.literal(0), expectedSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u) });

export function createQualityTrialWorker(capture: unknown, options: { turnstileTestMode?: boolean } = {}) {
  // Parse a private server-side copy; the HTTP caller cannot supply caption contents.
  const parsed = captureSchema.safeParse(capture);
  return {
    async fetch(request: Request, bindings: AppBindings, context: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      if (options.turnstileTestMode && url.hostname === "127.0.0.1" && url.protocol === "http:") {
        bindings = { ...bindings, TURNSTILE_EXPECTED_HOSTNAME: "127.0.0.1", TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
          TURNSTILE_SITEVERIFY_FETCH: async (input, init) => {
            const body = JSON.parse(String(init?.body)) as { secret?: string; response?: string };
            if (String(input) !== "https://challenges.cloudflare.com/turnstile/v0/siteverify" ||
              body.secret !== "1x0000000000000000000000000000000AA" || body.response !== "XXXX.DUMMY.TOKEN.XXXX") {
              return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
            }
            const response = await fetch(input, init);
            if (!response.ok) return response;
            const result = await response.json() as { success?: boolean };
            // Official test tokens have fixed/absent hostname/action values. Only
            // this localhost entry adapts a successful dummy-token verification.
            return Response.json(result.success === true ? { ...result, hostname: "127.0.0.1", action: "quiz_submission" } : result);
          } };
      }
      const match = /^\/api\/admin\/sermons\/([A-Za-z0-9_-]{1,128})\/input\/saved-captions$/u.exec(url.pathname);
      if (!match) return app.fetch(request, bindings, context);
      const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
      try {
        // Even a mistakenly served local entry cannot accept remote-origin imports.
        if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") return reply({ error: { code: "LOCAL_ONLY" } }, 403);
        const actor = await authenticateAccessRequest(request, { audience: bindings.ACCESS_AUD, teamDomain: bindings.ACCESS_TEAM_DOMAIN });
        if (request.method !== "POST") return reply({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
        if (url.search) return reply({ error: { code: "SAVED_SOURCE_INVALID" } }, 400);
        const command = requestSchema.safeParse(await readSameOriginJson(request));
        if (!command.success || !parsed.success || command.data.expectedSourceSha256 !== parsed.data.result.transcript.sourceSha256) {
          return reply({ error: { code: "SAVED_SOURCE_INVALID" } }, 400);
        }
        await verifySource(parsed.data.result.transcript);
        const data = await importPublicSermonCaptions(bindings.DB, match[1]!, { expectedVersion: 0 }, actor.email, {
          descriptor: transcriptProvider,
          fetchTranscript: async () => parsed.data.result,
          inspectVideo: async () => { throw new Error("SAVED_SOURCE_INSPECTION_DISABLED"); },
        });
        return reply({ data: { ...data, sourceOrigin: "saved_capture", sourceSha256: parsed.data.result.transcript.sourceSha256 } });
      } catch (error) {
        if (error instanceof AccessAuthenticationRequired) return reply({ error: { code: "ADMIN_AUTH_REQUIRED" } }, 401);
        if (error instanceof AccessAuthenticationUnavailable) return reply({ error: { code: "ADMIN_AUTH_UNAVAILABLE" } }, 503);
        if (error instanceof MutationRequestError) return reply({ error: { code: error.code } }, error.status);
        if (error instanceof PublicVideoError) return reply({ error: { code: error.code } }, error.code === "VIDEO_CONFLICT" ? 409 : error.code === "VIDEO_INVALID" ? 400 : 503);
        return reply({ error: { code: "SAVED_SOURCE_INVALID_OR_UNAVAILABLE" } }, 400);
      }
    },
  };
}
