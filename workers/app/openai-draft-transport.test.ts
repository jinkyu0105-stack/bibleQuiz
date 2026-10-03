import { describe, expect, it, vi } from "vitest";
import { createOpenAiDraftTransport, openAiDraftBody } from "../_shared/services/openai-draft-transport";
import { estimateOpenAiDraftCost } from "../_shared/services/openai-draft-cost";
const input = { task: "correction" as const, input: { transcript: { format: "plain_text" as const, text: "합성 자료" } } };
const usage = { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 5 } };
const response = (extra: Record<string, unknown> = {}) => ({ id: "synthetic-response", model: "gpt-5.6-terra", usage,
  status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft: { format: "plain_text", text: "수정 자료" } }) }] }], ...extra });
describe("OpenAI transport", () => {
  it("never sends if the durable request reservation fails", async () => {
    const fetcher = vi.fn(), archive = { request: vi.fn(async () => { throw new Error("ARCHIVE_DOWN"); }), response: vi.fn() };
    await expect(createOpenAiDraftTransport({ apiKey: "synthetic", fetch: fetcher, observe: async () => {}, archive })
      .complete(input, new AbortController().signal)).rejects.toThrow("ARCHIVE_DOWN");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("accounts for a response before stopping on an archive failure, without accepting content or retrying", async () => {
    const fetcher = vi.fn(async () => Response.json(response())), observe = vi.fn(async () => {});
    const archive = { request: vi.fn(async () => {}), response: vi.fn(async () => { throw new Error("ARCHIVE_DOWN"); }) };
    await expect(createOpenAiDraftTransport({ apiKey: "synthetic", fetch: fetcher, observe, archive })
      .complete(input, new AbortController().signal)).rejects.toThrow("AI_RESPONSE_ARCHIVE_UNAVAILABLE");
    expect(observe).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(archive.response.mock.invocationCallOrder[0]).toBeLessThan(observe.mock.invocationCallOrder[0]!);
  });
  it("archives exact malformed bytes before JSON parsing and does not archive credentials", async () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x7b]), archive = { request: vi.fn(async () => {}), response: vi.fn(async () => {}) };
    const fetcher = vi.fn(async () => new Response(bytes, { status: 502 }));
    await expect(createOpenAiDraftTransport({ apiKey: "PRIVATE_KEY", fetch: fetcher, observe: async () => {}, archive })
      .complete(input, new AbortController().signal)).rejects.toThrow();
    expect(archive.response).toHaveBeenCalledWith(502, bytes);
    expect(JSON.stringify(archive.request.mock.calls)).not.toContain("PRIVATE_KEY");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("sends one stateless structured request with no server identities or token cap", async () => {
    const observe = vi.fn(async () => {}), fetcher = vi.fn(async () => Response.json(response()));
    const transport = createOpenAiDraftTransport({ apiKey: "synthetic", fetch: fetcher, observe });
    expect(await transport.complete(input, new AbortController().signal)).toMatchObject({ outcome: "completed", task: "correction" });
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.openai.com/v1/responses");
    const sent = JSON.parse(String(call[1].body));
    expect(sent).toMatchObject({ model: "gpt-5.6-terra", store: false, reasoning: { effort: "high" }, text: { format: { strict: true, type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["draft"] } } } });
    expect(sent).not.toHaveProperty("max_output_tokens");
    expect(JSON.parse(sent.input)).toEqual(input.input);
    expect(observe).toHaveBeenCalledWith({ model: "gpt-5.6-terra", responseId: "synthetic-response", usage });
  });
  it("constructs a real workerd Request before the synthetic provider responds", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      // Unlike a plain fetch stub, workerd validates redirect options here.
      const request = new Request(url, init);
      expect(request.url).toBe("https://api.openai.com/v1/responses");
      expect(request.method).toBe("POST");
      expect(request.redirect).toBe("manual");
      expect(JSON.parse(await request.text()).input).toBe(JSON.stringify(input.input));
      return Response.json(response());
    });
    const result = await createOpenAiDraftTransport({ apiKey: "synthetic", fetch: fetcher, observe: async () => {} })
      .complete(input, new AbortController().signal);
    expect(result).toMatchObject({ outcome: "completed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([301, 302, 303, 307, 308])("rejects HTTP %s without following or parsing redirect data", async status => {
    const observe = vi.fn(async () => {}), diagnose = vi.fn();
    const redirect = new Response("PRIVATE_NON_JSON", { status, headers: { Location: "https://must-not-be-contacted.invalid" } });
    const read = vi.spyOn(redirect, "json");
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(new Request(url, init).redirect).toBe("manual");
      return redirect;
    });
    expect(await createOpenAiDraftTransport({ apiKey: "synthetic", fetch: fetcher, observe, diagnose })
      .complete(input, new AbortController().signal)).toEqual({ outcome: "failed", reason: "transport" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    expect(diagnose.mock.calls).toEqual([[{ phase: "http", httpStatus: status, providerCode: null }]]);
  });
  it.each(["correction", "intent_analysis", "intent_critique", "summary", "child_candidates", "adult_candidates"] as const)("builds strict %s schema without human-only origins", task => {
    const result = openAiDraftBody({ ...input, task } as Parameters<typeof openAiDraftBody>[0]);
    expect(result.text.format.schema).toMatchObject({ type: "object", additionalProperties: false });
    expect(JSON.stringify(result.text.format.schema)).not.toContain('"admin_context"');
    expect(JSON.stringify(result.text.format.schema)).not.toContain('"from"');
    expect(JSON.stringify(result.text.format.schema)).not.toContain('"to"');
    expect(JSON.stringify(result.text.format.schema)).not.toContain('"start"');
    expect(JSON.stringify(result.text.format.schema)).not.toContain('"duration"');
    expect(JSON.stringify(result.text.format.schema)).not.toContain('"locationStatus"');
    if (task !== "correction") expect(JSON.stringify(result.text.format.schema)).not.toContain('"segmentId"');
    expect(result.text.format.name).toBe(`${task}_v4`);
    expect(result.instructions).toContain("구간 ID, 시간, 문자 위치는 출력하지 않는다");
  });
  it.each([
    { status: "incomplete", output: [] },
    { output: [{ type: "message", content: [{ type: "refusal" }] }] },
    { output: [{ type: "message", content: [{ type: "output_text", text: "broken json" }] }] },
  ])("observes usage even when result is unusable", async extra => {
    const observe = vi.fn(async () => {});
    const transport = createOpenAiDraftTransport({ apiKey: "synthetic", fetch: async () => Response.json(response(extra)), observe });
    await transport.complete(input, new AbortController().signal);
    expect(observe).toHaveBeenCalledTimes(1);
  });
  it("does not retry HTTP errors or reveal their body", async () => {
    const fetcher = vi.fn(async () => Response.json({ error: "SECRET_BODY" }, { status: 429 }));
    const result = await createOpenAiDraftTransport({ apiKey: "synthetic", fetch: fetcher, observe: async () => {} }).complete(input, new AbortController().signal);
    expect(result).toEqual({ outcome: "failed", reason: "transport" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("refuses a new final audit before sending", async () => {
    const fetcher = vi.fn();
    const transport = createOpenAiDraftTransport({ apiKey: "synthetic", fetch: fetcher, observe: async () => {} });
    await expect(transport.complete({ task: "final_audit", input: {} } as never, new AbortController().signal)).rejects.toThrow("AI_DRAFT_TASK_DISABLED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not double-count reasoning tokens and keeps the pricing version", () => {
    expect(estimateOpenAiDraftCost({ model: "gpt-5.6-terra", responseId: "synthetic", usage })).toMatchObject({ estimatedCostMicroUsd: 422,
      reasoningTokens: 5, pricingVersion: "openai-terra-2026-09-22" });
    expect(() => estimateOpenAiDraftCost({ model: "other", responseId: "synthetic", usage })).toThrow("AI_PRICING_MODEL_UNKNOWN");
  });
  it.each([
    [400, "invalid_json_schema"], [401, "invalid_api_key"], [403, "permission_denied"],
    [429, "credit_balance_exhausted"], [429, "project_spend_limit_exceeded"],
    [429, "rate_limit_exceeded"], [503, "server_is_overloaded"],
  ])("reports HTTP %s and only an allowed code without retrying", async (status, code) => {
    const diagnose = vi.fn(), observe = vi.fn(async () => {});
    const fetcher = vi.fn(async () => Response.json({ error: { code, message: "PRIVATE_MESSAGE",
      param: "PRIVATE_PARAM", type: "PRIVATE_TYPE" }, input: "PRIVATE_TRANSCRIPT" }, { status: Number(status) }));
    const result = await createOpenAiDraftTransport({ apiKey: "PRIVATE_KEY", fetch: fetcher, observe, diagnose })
      .complete(input, new AbortController().signal);
    expect(result).toEqual({ outcome: "failed", reason: "transport" });
    expect(diagnose.mock.calls).toEqual([[{ phase: "http", httpStatus: status, providerCode: code }]]);
    expect(JSON.stringify(diagnose.mock.calls)).not.toContain("PRIVATE_");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(observe).not.toHaveBeenCalled();
  });
  it.each(["PRIVATE_CODE", null, { code: "invalid_api_key" }])("drops unknown or malformed error codes", async code => {
    const diagnose = vi.fn();
    await createOpenAiDraftTransport({ apiKey: "synthetic", observe: async () => {}, diagnose,
      fetch: async () => Response.json({ error: { code } }, { status: 400 }) }).complete(input, new AbortController().signal);
    expect(diagnose.mock.calls).toEqual([[{ phase: "http", httpStatus: 400, providerCode: null }]]);
  });
  it("keeps the HTTP status for a non-JSON failure without emitting the body", async () => {
    const diagnose = vi.fn(), fetcher = vi.fn(async () => new Response("PRIVATE_HTML", { status: 502 }));
    const transport = createOpenAiDraftTransport({ apiKey: "synthetic", fetch: fetcher, observe: async () => {}, diagnose });
    await expect(transport.complete(input, new AbortController().signal)).rejects.toThrow();
    expect(diagnose.mock.calls).toEqual([[{ phase: "response_json", httpStatus: 502, providerCode: null }]]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("distinguishes network failure from an aborted request (%s)", async aborted => {
    const diagnose = vi.fn(), controller = new AbortController();
    const fetcher = vi.fn(async () => { if (aborted) controller.abort(); throw new Error("PRIVATE_EXCEPTION"); });
    await expect(createOpenAiDraftTransport({ apiKey: "synthetic", fetch: fetcher, observe: async () => {}, diagnose })
      .complete(input, controller.signal)).rejects.toThrow("PRIVATE_EXCEPTION");
    expect(diagnose.mock.calls).toEqual([[{ phase: aborted ? "aborted" : "network", httpStatus: null, providerCode: null }]]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains usage before output diagnostics even if the diagnostic sink throws", async () => {
    const observe = vi.fn(async () => {}), diagnose = vi.fn(() => { throw new Error("sink unavailable"); });
    const fetcher = vi.fn(async () => Response.json(response({ status: "incomplete", output: [] })));
    expect(await createOpenAiDraftTransport({ apiKey: "synthetic", fetch: fetcher, observe, diagnose })
      .complete(input, new AbortController().signal)).toEqual({ outcome: "failed", reason: "incomplete" });
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe.mock.invocationCallOrder[0]).toBeLessThan(diagnose.mock.invocationCallOrder[0]!);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports usage persistence failure without leaking the error or retrying", async () => {
    const diagnose = vi.fn(), fetcher = vi.fn(async () => Response.json(response()));
    await expect(createOpenAiDraftTransport({ apiKey: "synthetic", fetch: fetcher, diagnose,
      observe: async () => { throw new Error("PRIVATE_USAGE_EXCEPTION"); } })
      .complete(input, new AbortController().signal)).rejects.toThrow("PRIVATE_USAGE_EXCEPTION");
    expect(diagnose.mock.calls).toEqual([[{ phase: "usage", httpStatus: 200, providerCode: null }]]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("leaves successful responses quiet", async () => {
    const diagnose = vi.fn();
    await createOpenAiDraftTransport({ apiKey: "synthetic", fetch: async () => Response.json(response()),
      observe: async () => {}, diagnose }).complete(input, new AbortController().signal);
    expect(diagnose).not.toHaveBeenCalled();
  });

});
