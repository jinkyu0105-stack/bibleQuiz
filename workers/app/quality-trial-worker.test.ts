import { afterEach, expect, it, vi } from "vitest";
import { createQualityTrialWorker } from "../../scripts/quality-trial-worker";
import { app, type AppBindings } from "./app";

afterEach(() => vi.restoreAllMocks());

it("adapts only an officially verified dummy token in the explicit localhost trial entry", async () => {
  let captured: AppBindings | undefined;
  vi.spyOn(app, "fetch").mockImplementation(async (_request, bindings) => {
    captured = bindings as AppBindings; return Response.json({ ok: true });
  });
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: true,
    hostname: "example.com", challenge_ts: new Date().toISOString() }));
  const entry = createQualityTrialWorker(null, { turnstileTestMode: true });
  await entry.fetch(new Request("http://127.0.0.1:12345/api/health"), {} as AppBindings, {} as ExecutionContext);
  const verify = captured?.TURNSTILE_SITEVERIFY_FETCH;
  expect(verify).toBeTypeOf("function");
  const input = { secret: "1x0000000000000000000000000000000AA", response: "XXXX.DUMMY.TOKEN.XXXX" };
  const url = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  expect(await (await verify!(url, { body: JSON.stringify(input) })).json()).toMatchObject({
    success: true, hostname: "127.0.0.1", action: "quiz_submission" });
  for (const body of [{ ...input, response: "real-token" }, { ...input, secret: "other-secret" }]) {
    expect(await (await verify!(url, { body: JSON.stringify(body) })).json()).toMatchObject({ success: false });
  }
  expect(network).toHaveBeenCalledTimes(1);
});

it("does not install a test verifier on a remote origin or without the explicit option", async () => {
  const forwarded: AppBindings[] = [];
  vi.spyOn(app, "fetch").mockImplementation(async (_request, bindings) => {
    forwarded.push(bindings as AppBindings); return new Response(null);
  });
  for (const [url, enabled] of [["https://example.com/api/health", true], ["http://127.0.0.1:12345/api/health", false]] as const) {
    await createQualityTrialWorker(null, { turnstileTestMode: enabled })
      .fetch(new Request(url), {} as AppBindings, {} as ExecutionContext);
  }
  expect(forwarded.every(b => b.TURNSTILE_SITEVERIFY_FETCH === undefined && b.TURNSTILE_SECRET === undefined)).toBe(true);
});
