// Local trial entry only. Never imported by workers/app/index.ts.
import { z } from "zod";
import { ContentWorkflow } from "../workers/content/index";

const archiveSchema = z.strictObject({
  origin: z.string().regex(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u),
  token: z.string().regex(/^[a-f0-9]{64}$/u),
});
export function createArchivedTrialFetch(raw: unknown, upstream: typeof fetch = fetch): typeof fetch {
  const archive = archiveSchema.parse(raw);
  let archiveFailed = false;
  const record = async (path: string, value: unknown) => {
    const response = await upstream(archive.origin + path, { method: "POST", redirect: "manual",
      signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${archive.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(value) });
    if (response.status !== 201) throw new Error("LOCAL_ARCHIVE_UNAVAILABLE");
  };
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://api.openai.com/v1/responses") return upstream(input, init);
    if (init?.method !== "POST" || typeof init.body !== "string") throw new Error("LOCAL_ARCHIVE_REQUEST_INVALID");
    if (archiveFailed) throw new Error("LOCAL_ARCHIVE_PREVIOUS_RESPONSE_LOST");
    const captureId = crypto.randomUUID();
    // Must be durable before the paid request. Never copy request headers (API key).
    await record(`/capture/${captureId}/request`, { body: init.body });
    if (init.signal?.aborted) throw new Error("LOCAL_ARCHIVE_REQUEST_ABORTED");
    const response = await upstream(input, init);
    try {
      await record(`/capture/${captureId}/response`, { status: response.status, body: await response.clone().text() });
    } catch {
      // Still return the paid response so its usage can be accounted for. No retry.
      archiveFailed = true;
      console.warn(JSON.stringify({ code: "LOCAL_ARCHIVE_RESPONSE_FAILED", captureId }));
    }
    return response;
  };
}

/** The private generated entry supplies loopback config; no production binding is added. */
export function createArchivedQualityWorkflow(config: unknown) {
  const parsed = archiveSchema.parse(config);
  return class ArchivedQualityWorkflow extends ContentWorkflow {
    protected override generationOptions() { return { fetch: createArchivedTrialFetch(parsed) }; }
  };
}
