import { describe, expect, it } from "vitest";
import {
  assessContextIdentity, assessOriginalContextLink, assessRequestContextReplay, canonicalGenerationJson, decodeGenerationContext, encodeGenerationContext,
  fingerprintLifecycleValue, GENERATION_CONTEXT_LIMITS, type ContextEnvelopeInput,
} from "../_shared/services/generation-context-codec";
import { generationContextSchema, type GenerationContext } from "../_shared/services/generation-lifecycle-contract";
import { sha256Bytes } from "../_shared/storage/sha256";
import { hash, now, requestContext, stepContext, waitContext } from "./test/generation-lifecycle-fixture";

function envelope(c: GenerationContext): ContextEnvelopeInput {
  return { contextId: "context", jobId: "job", sermonId: "sermon", quizSetId: "quiz", kind: c.kind, requestKey: "request_key",
    createdAt: now, stepKey: c.kind === "step" ? c.stepKey : null, waitGeneration: c.kind === "wait" ? c.wait.generation : null,
    codec: "generation-context-json-utf8-v1" };
}
const encode = (c: GenerationContext) => encodeGenerationContext(c, envelope(c));
const canary = "TEST_ONLY_CONTEXT_PRIVATE_CANARY";
describe("P5-43 canonical context bytes (no persisted context or FK claims)", () => {
  it.each([requestContext, stepContext, waitContext])("round-trips original request/step/wait, not latest authority", async (fixture) => {
    const c = fixture(), saved = structuredClone(c), encoded = await encode(c);
    expect(await decodeGenerationContext(encoded.envelope, encoded.chunks, encoded.envelope)).toEqual(saved);
    expect(c).toEqual(saved);
    if (c.kind === "step") {
      c.authority.metadata.metadataRevision++;
      expect((await encode(c)).envelope.fingerprint).not.toBe(encoded.envelope.fingerprint);
      const restored = await decodeGenerationContext(encoded.envelope, encoded.chunks, encoded.envelope);
      expect(restored).toEqual(saved);
    }
  });
  it("P42-01 replays original request ID and rejects a different key or same-key meaning", async () => {
    const c = requestContext(), stored = await encode(c);
    expect(await assessRequestContextReplay("request_key", c, stored)).toEqual({ outcome: "replayed", jobId: "job", contextId: "context" });
    expect(await assessRequestContextReplay("other", c, stored)).toEqual({ outcome: "conflict" });
    c.actorDigest = "b".repeat(64);
    expect(await assessRequestContextReplay("request_key", c, stored)).toEqual({ outcome: "conflict" });
  });
  it.each([stepContext, waitContext])("links only original request context/owner/key across restart", async (fixture) => {
    const r = requestContext(), child = fixture();
    if (child.kind === "step") child.authority.scope = r.authority.scope;
    const stored = await encode(r);
    child.request = { contextId: stored.envelope.contextId, fingerprint: stored.envelope.fingerprint };
    expect(await assessOriginalContextLink(await encode(child), stored)).toEqual({ outcome: "eligible" });
    child.request.contextId = "foreign";
    expect(await assessOriginalContextLink(await encode(child), stored)).toEqual({ outcome: "conflict" });
  });
  it("sorts keys only; preserves arrays, whitespace, Unicode composition, explicit null/absent", async () => {
    expect(canonicalGenerationJson({ z: [2, 1], a: null })).toBe('{"a":null,"z":[2,1]}');
    expect(await fingerprintLifecycleValue({ a: 1, b: 2 })).toBe(await fingerprintLifecycleValue({ b: 2, a: 1 }));
    expect(await fingerprintLifecycleValue("é")).not.toBe(await fingerprintLifecycleValue("e\u0301"));
    expect(await fingerprintLifecycleValue({ a: null })).not.toBe(await fingerprintLifecycleValue({}));
    expect(await fingerprintLifecycleValue([1, 2])).not.toBe(await fingerprintLifecycleValue([2, 1]));
    expect(await fingerprintLifecycleValue(" a ")).not.toBe(await fingerprintLifecycleValue("a"));
  });
  it.each([undefined, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, -0, 1n, new Date(), new Map(), "\ud800", [undefined], Array(1)])("rejects noncanonical value %#", (value) => {
    expect(() => canonicalGenerationJson(value)).toThrow(/CONTEXT_INVALID/);
  });
  it("rejects cycles, getters and deep/wide input without private exception contents", () => {
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    for (const raw of [cyclic, { get value() { throw new Error(canary); } }, { secret: undefined }]) {
      expect(() => canonicalGenerationJson(raw)).toThrow("CONTEXT_INVALID");
    }
    let deep: unknown = null; for (let i = 0; i < 35; i++) deep = { deep };
    expect(() => canonicalGenerationJson(deep)).toThrow("CONTEXT_LIMIT");
    expect(() => canonicalGenerationJson(Array(8193).fill(0))).toThrow("CONTEXT_LIMIT");
  });
  it.each(["actor", "guidance", "options", "owner", "revision"])("P42-01 changes request meaning for %s", async (field) => {
    const c = requestContext(), before = await encode(c);
    if (field === "actor") c.actorDigest = "b".repeat(64);
    if (field === "guidance") c.guidance = { text: canary, sha256: await sha256Bytes(new TextEncoder().encode(canary)) };
    if (field === "options" && c.authority.selection.state === "present") c.authority.selection.value.child.options.seed = "other";
    if (field === "owner") c.authority.quizSetId = "other";
    if (field === "revision") c.authority.metadata.metadataRevision++;
    const encoded = await encodeGenerationContext(c, { ...envelope(c), quizSetId: c.authority.quizSetId });
    expect(encoded.envelope.fingerprint).not.toBe(before.envelope.fingerprint);
  });
  it("request key/time are envelope identity, not semantic fingerprint", async () => {
    const c = requestContext(), a = await encode(c), b = await encodeGenerationContext(c, { ...envelope(c), requestKey: "other", createdAt: "2026-09-18T00:00:00Z" });
    expect(a.envelope.fingerprint).toBe(b.envelope.fingerprint);
    expect(assessContextIdentity(a.envelope, b.envelope)).toBe("conflict");
    expect(assessContextIdentity(a.envelope, a.envelope)).toBe("exact");
  });
  it.each(["chunk", "digest", "order", "length", "missing", "owner", "kind", "key", "version", "extra"])("P42-02 rejects supplied %s corruption", async (field) => {
    const c = requestContext(); c.guidance = { text: "가".repeat(8192), sha256: await sha256Bytes(new TextEncoder().encode("가".repeat(8192))) };
    const a = await encode(c), expected = structuredClone(a.envelope);
    if (field === "chunk") a.chunks[0]!.body[0] = 0;
    if (field === "digest") a.chunks[0]!.sha256 = hash;
    if (field === "order") a.chunks.reverse();
    if (field === "length") a.chunks[0]!.byteLength++;
    if (field === "missing") a.chunks.pop();
    if (field === "owner") a.envelope.jobId = "other";
    if (field === "kind") a.envelope.kind = "wait";
    if (field === "key") a.envelope.requestKey = "other";
    if (field === "version") Reflect.set(a.envelope, "codec", "unsupported");
    if (field === "extra") Reflect.set(a.chunks[0]!, "private", canary);
    await expect(decodeGenerationContext(a.envelope, a.chunks, expected)).rejects.toThrow("CONTEXT_CORRUPT");
  });
  it("P42-23 bounds guidance code points, multibyte/chunks, reference count and manifest before decoding", async () => {
    const c = requestContext(), text = "😀".repeat(8192);
    c.guidance = { text, sha256: await sha256Bytes(new TextEncoder().encode(text)) };
    const a = await encode(c);
    expect(a.envelope.chunkCount).toBeGreaterThan(1);
    expect(a.chunks.every((v) => v.byteLength <= 16384)).toBe(true);
    expect(await decodeGenerationContext(a.envelope, a.chunks, a.envelope)).toEqual(c);
    c.guidance.text += "x"; await expect(encode(c)).rejects.toThrow("CONTEXT_INVALID"); c.guidance = null;
    while (c.references.length < 32) c.references.push({ sermonId: "sermon", eventId: `extra_${c.references.length}`, kind: "content", sha256: hash });
    expect((await encode(c)).envelope.referencedEvents).toBe(32);
    c.references.push({ sermonId: "sermon", eventId: "too_many", kind: "content", sha256: hash });
    await expect(encode(c)).rejects.toThrow("CONTEXT_INVALID");
    for (const field of ["byteLength", "chunkCount", "referencedEvents"] as const) {
      const changed = { ...a.envelope, [field]: field === "byteLength" ? 65537 : field === "chunkCount" ? 5 : 33 };
      await expect(decodeGenerationContext(changed, a.chunks, changed)).rejects.toThrow("CONTEXT_LIMIT");
    }
    expect(GENERATION_CONTEXT_LIMITS.wait.maxContextBytes).toBe(32768);
  });
  it("accepts exactly 64KiB and rejects one byte more before making chunks", async () => {
    // Maximal valid opaque IDs and references exercise the actual writer budget,
    // not a supplied manifest claiming a large payload.
    const source = requestContext();
    while (source.references.length < 32) source.references.push({ sermonId: "sermon", eventId: `extra_${source.references.length}`, kind: "content", sha256: hash });
    const ids = new Set(source.references.map((r) => r.eventId)); ids.add("sermon"); ids.add("job"); ids.add("quiz");
    const expand = (v: unknown): unknown => typeof v === "string" && ids.has(v) ? v.padEnd(128, "x") : Array.isArray(v) ? v.map(expand) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ["kind", "difficulty", "scope", "stage", "task"].includes(k) ? x : expand(x)])) : v;
    const c = expand(source) as typeof source;
    c.guidance = { text: "", sha256: hash };
    const baseBytes = new TextEncoder().encode(canonicalGenerationJson(c)).byteLength;
    const padding = 65536 - baseBytes;
    const text = "\u0000".repeat(Math.floor(padding / 6)) + "x".repeat(padding % 6);
    expect([...text].length).toBeLessThanOrEqual(8192);
    c.guidance = { text, sha256: await sha256Bytes(new TextEncoder().encode(text)) };
    const base = { ...envelope(c), jobId: c.authority.jobId, sermonId: c.authority.sermonId, quizSetId: c.authority.quizSetId };
    expect(generationContextSchema.safeParse(c).error?.issues).toBeUndefined();
    const encoded = await encodeGenerationContext(c, base);
    expect(encoded.envelope.byteLength).toBe(65536);
    expect(encoded.envelope.chunkCount).toBe(4);
    expect(await decodeGenerationContext(encoded.envelope, encoded.chunks, encoded.envelope)).toEqual(c);
    c.guidance.text += "x"; c.guidance.sha256 = await sha256Bytes(new TextEncoder().encode(c.guidance.text));
    await expect(encodeGenerationContext(c, base)).rejects.toThrow("CONTEXT_LIMIT");
  });
  it.each(["references", "foreign_ref", "guidance_digest", "legacy", "unsafe", "same_revision", "future_predecessor", "old_predecessor", "wrong_scope", "step_key", "wait_version", "wait_parent"])("rejects invalid original %s", async (kind) => {
    const c = kind.startsWith("wait") ? waitContext() : kind === "same_revision" || kind === "step_key" || (kind === "future_predecessor" || kind === "old_predecessor" || kind === "wrong_scope") ? stepContext() : requestContext();
    if (kind === "references") c.references.pop();
    if (kind === "foreign_ref") c.references[0]!.sermonId = "foreign";
    if (kind === "guidance_digest" && c.kind === "request") c.guidance = { text: canary, sha256: hash };
    if (kind === "legacy") Reflect.set(c, "contractVersion", 1);
    if (kind === "unsafe" && c.kind === "request" && c.authority.input.state === "present") c.authority.input.version = Number.MAX_SAFE_INTEGER;
    if (kind === "same_revision" && c.kind === "step" && c.authority.input.state === "present") c.authority.input.documentSha256 = "b".repeat(64);
    if (kind === "old_predecessor" && c.kind === "step") c.predecessor.stateVersion--;
    if (kind === "wrong_scope" && c.kind === "step") c.authority.scope = "child";
    if (kind === "step_key" && c.kind === "step") c.stepKey = "latest";
    if (kind === "future_predecessor" && c.kind === "step") c.predecessor.stateVersion = 999;
    if (kind === "wait_version" && c.kind === "wait") c.enter.stateVersion++;
    if (kind === "wait_parent" && c.kind === "wait") c.parent = { waitGeneration: 10, commandKey: "command", outcome: c.enter };
    await expect(encode(c)).rejects.toThrow("CONTEXT_INVALID");
  });
});
