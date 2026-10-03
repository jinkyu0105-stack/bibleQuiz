import { describe, expect, it } from "vitest";
import { canonicalDomainJson, encodeDomainPayload, decodeDomainPayload } from "../_shared/services/generation-domain-codec";
import { canonicalGenerationJson } from "../_shared/services/generation-context-codec";
import { domainStorageBudgetStatus, DOMAIN_OUTPUT_BOUNDS, measureDomainResources } from "../_shared/services/generation-domain-resources";
import { correctionProposalInputSchema } from "../_shared/services/transcript-correction-contract";
import { aiDraftTaskSchemas } from "../_shared/services/ai-draft-provider-contract";
import { budget, evidence } from "./test/generation-domain-fixture";

describe("P5-47 separate lossless domain codec", () => {
  it.each([1.25, 2.5, 0.8, -0, Number.MIN_VALUE, Number.MAX_VALUE])("roundtrips finite schema number %s", async number => {
    const v = { number, text: "한글😀\r\n\t\\\"\u0000", a: [null, true] };
    const encoded = await encodeDomainPayload(v, budget), decoded = await decodeDomainPayload(encoded, budget);
    expect(decoded).toEqual(v);
    expect(Object.is((decoded as typeof v).number, number)).toBe(true);
    expect(canonicalDomainJson(decoded, budget)).toBe(canonicalDomainJson(v, budget));
    expect(() => canonicalGenerationJson(v)).toThrow();
  });
  it("keeps key canonicalization and exact UTF8/chunk hashes", async () => {
    const value = { z: "한😀".repeat(40000), a: "\"\\\n" };
    const encoded = await encodeDomainPayload(value, budget);
    expect(encoded.byteLength).toBeGreaterThan(131072);
    expect(encoded.chunks.length).toBeGreaterThan(2);
    expect(await decodeDomainPayload(encoded, budget)).toEqual(value);
    expect(canonicalDomainJson({ a: value.a, z: value.z }, budget)).toBe(canonicalDomainJson(value, budget));
    encoded.chunks[1]!.body[0] = encoded.chunks[1]!.body[0]! ^ 1;
    await expect(decodeDomainPayload(encoded, budget)).rejects.toThrow("DOMAIN_CORRUPT");
  });
  it.each([NaN, Infinity, -Infinity, undefined, BigInt(1), new Date(), "\ud800", { a: undefined }])("rejects non-lossless value %#", value => {
    expect(() => canonicalDomainJson(value, budget)).toThrow("DOMAIN_INVALID");
  });
  it("rejects cycles/getters/array accessors without invoking them", () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    let calls = 0; const object = { get secret() { calls++; return "PRIVATE"; } };
    const array = [1]; Object.defineProperty(array, "0", { get() { calls++; return 1; } });
    for (const v of [cycle, object, array]) expect(() => canonicalDomainJson(v, budget)).toThrow();
    expect(calls).toBe(0);
  });
  it("counts escaped bytes at the exact boundary and refuses +1", async () => {
    const v = { text: "\"\\\u0000\n".repeat(200) };
    const bytes = new TextEncoder().encode(canonicalDomainJson(v, budget)).length;
    expect(canonicalDomainJson(v, { ...budget, maxPayloadBytes: bytes })).toBe(JSON.stringify(v));
    expect(() => canonicalDomainJson(v, { ...budget, maxPayloadBytes: bytes - 1 })).toThrow("DOMAIN_LIMIT");
    const encoded = await encodeDomainPayload(v, budget);
    await expect(decodeDomainPayload(encoded, { ...budget, maxPayloadBytes: bytes - 1 })).rejects.toThrow("DOMAIN_LIMIT");
  });
  it("enforces depth/node/chunk/decoded budgets without truncation", async () => {
    expect(() => canonicalDomainJson({ a: { b: 1 } }, { ...budget, maxDepth: 1 })).toThrow("DOMAIN_LIMIT");
    expect(() => canonicalDomainJson([1, 2], { ...budget, maxNodes: 2 })).toThrow("DOMAIN_LIMIT");
    expect(() => canonicalDomainJson("12345", { ...budget, maxDecodedBytes: 6 })).toThrow("DOMAIN_LIMIT");
    const e = await encodeDomainPayload("x".repeat(70000), budget);
    await expect(decodeDomainPayload(e, { ...budget, maxPayloadBytes: 65536, maxChunks: 1 })).rejects.toThrow("DOMAIN_LIMIT");
  });
});

describe("P5-47 resource calculation without new product caps", () => {
  it.each(["intent_analysis", "intent_critique", "summary", "child_candidates", "adult_candidates"] as const)("reports unbounded existing %s schema", task => {
    expect(domainStorageBudgetStatus(task)).toMatchObject({ outcome: "not_ready", bound: { schemaBound: "unbounded" } });
  });
  it("measures a valid summary exceeding the old raw transport ceiling", () => {
    const output = { paragraphs: [{ id: "p", text: "가\"\\".repeat(50000), intentClaimIds: ["claim"], evidence: [evidence()] }] };
    const m = measureDomainResources("summary", output, { operation: output }, {}, 1, 1, null, budget);
    expect(m).toMatchObject({ outcome: "measured", batchStatements: null, storage: { outcome: "not_ready" } });
    if (m.outcome === "measured") expect(m.payloadBytes).toBeGreaterThan(131072);
    expect(() => measureDomainResources("summary", output, output, {}, 33, 1, null, budget)).toThrow("DOMAIN_LIMIT");
    expect(() => measureDomainResources("summary", output, output, {}, 1, 11, null, budget)).toThrow("DOMAIN_LIMIT");
    expect(() => measureDomainResources("summary", output, output, {}, 1, 1, 41, budget)).toThrow("DOMAIN_LIMIT");
    expect(() => measureDomainResources("summary", output, output, {}, 1, 1, 40, { ...budget, maxDecodedBytes: 100 })).toThrow("DOMAIN_LIMIT");
  });
  it("preserves the legacy bound for 1000 maximum-width correction items and escaping against the conservative schema bound", () => {
    const item = { id: "i".repeat(128), segmentId: "s".repeat(128), start: Number.MAX_VALUE, duration: Number.MIN_VALUE,
      from: Number.MAX_SAFE_INTEGER, to: Number.MAX_SAFE_INTEGER, originalText: "\u0000".repeat(20000),
      proposedText: "\u0000".repeat(20000), reason: "\u0000".repeat(500), confidence: 0.8,
      contextBefore: "\u0000".repeat(120), contextAfter: "\u0000".repeat(120), changeType: "recognition", riskFlags: ["biblical_term", "number", "negation", "deletion", "needs_review"] };
    // Shape maximum, deliberately NOT semantic quote/unique-ID validity.
    const output = { items: Array.from({ length: 1000 }, () => item) };
    expect(correctionProposalInputSchema.pick({ items: true }).safeParse(output).success).toBe(true);
    expect(aiDraftTaskSchemas.correction.output.safeParse(output).success).toBe(false);
    const exactBytes = '{"items":['.length + 1000 * new TextEncoder().encode(JSON.stringify(item)).length + 999 + ']}'.length;
    expect(exactBytes).toBeLessThanOrEqual(DOMAIN_OUTPUT_BOUNDS.correction.maxOutputBytes);
    expect(exactBytes).toBeGreaterThan(200 * 1024 * 1024);
    expect(aiDraftTaskSchemas.correction.output.safeParse({ items: [...output.items, item] }).success).toBe(false);
    expect(domainStorageBudgetStatus("correction").outcome).toBe("not_ready");
  });
});
