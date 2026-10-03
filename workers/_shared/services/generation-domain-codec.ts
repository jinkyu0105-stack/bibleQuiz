import { z } from "zod";
import { sha256Bytes } from "../storage/sha256";
import { utf8ByteLength } from "../storage/utf8-byte-length";

/** Separate from integer-only generation-context-json-utf8-v1. */
export const DOMAIN_CODEC = "generation-domain-json-utf8-v1" as const;
export const domainResourceBudgetSchema = z.strictObject({
  maxPayloadBytes: z.int().positive(), chunkBytes: z.int().positive().max(65536), maxChunks: z.int().positive(),
  maxReferences: z.int().positive().max(32), maxTargets: z.int().positive().max(10),
  maxDepth: z.int().positive().max(32), maxNodes: z.int().positive(),
  maxDecodedBytes: z.int().positive(), maxBatchStatements: z.int().positive(),
}).refine(b => b.maxPayloadBytes <= b.chunkBytes * b.maxChunks && Number.isSafeInteger(b.chunkBytes * b.maxChunks));
export type DomainResourceBudget = z.infer<typeof domainResourceBudgetSchema>;
export class DomainContractError extends Error {
  constructor(readonly code: "DOMAIN_INVALID" | "DOMAIN_LIMIT" | "DOMAIN_CORRUPT") { super(code); }
}
export function invalidDomain(): never { throw new DomainContractError("DOMAIN_INVALID"); }
export function domainLimit(): never { throw new DomainContractError("DOMAIN_LIMIT"); }
export function canonicalDomainJson(raw: unknown, budget: DomainResourceBudget): string {
  const parsed = domainResourceBudgetSchema.safeParse(budget);
  if (!parsed.success) return invalidDomain();
  const b = parsed.data, seen = new Set<object>(), parts: string[] = [];
  let bytes = 0, nodes = 0;
  function emit(s: string) {
    bytes += utf8ByteLength(s);
    if (bytes > b.maxPayloadBytes || bytes > b.maxDecodedBytes) domainLimit();
    parts.push(s);
  }
  function string(s: string) {
    // Check before allocating escaped output. -0 and finite decimals are lossless.
    if (s.length > b.maxPayloadBytes) domainLimit();
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s)) invalidDomain();
    emit(JSON.stringify(s));
  }
  function visit(v: unknown, depth: number) {
    if (++nodes > b.maxNodes || depth > b.maxDepth) domainLimit();
    if (v === null) return emit("null");
    if (typeof v === "string") return string(v);
    if (typeof v === "boolean") return emit(String(v));
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return invalidDomain();
      return emit(Object.is(v, -0) ? "-0" : JSON.stringify(v));
    }
    if (!v || typeof v !== "object" || seen.has(v) || Object.getOwnPropertySymbols(v).length) return invalidDomain();
    const array = Array.isArray(v);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return invalidDomain();
    const keys = Object.keys(v);
    if (keys.length > b.maxNodes - nodes || (array && (keys.length !== v.length || keys.some((k, n) => k !== String(n))))) return domainLimit();
    // Reject non-enumerable data too: no silent field loss and no getters executed.
    if (Object.getOwnPropertyNames(v).length !== keys.length + (array ? 1 : 0)) return invalidDomain();
    seen.add(v); emit(array ? "[" : "{");
    (array ? keys : keys.sort()).forEach((key, n) => {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !("value" in d)) return invalidDomain();
      if (n) emit(",");
      if (!array) { string(key); emit(":"); }
      visit(d.value, depth + 1);
    });
    emit(array ? "]" : "}"); seen.delete(v);
  }
  visit(raw, 0);
  return parts.join("");
}
export async function encodeDomainPayload(raw: unknown, budget: DomainResourceBudget) {
  const text = canonicalDomainJson(raw, budget), bytes = new TextEncoder().encode(text);
  const chunks: { position: number; body: Uint8Array; sha256: string }[] = [];
  for (let offset = 0; offset < bytes.length; offset += budget.chunkBytes) {
    const body = bytes.slice(offset, offset + budget.chunkBytes);
    chunks.push({ position: chunks.length, body, sha256: await sha256Bytes(body) });
  }
  if (chunks.length > budget.maxChunks) domainLimit();
  return { codec: DOMAIN_CODEC, byteLength: bytes.length, sha256: await sha256Bytes(bytes), chunks };
}
const encodedDomainSchema = z.strictObject({ codec: z.literal(DOMAIN_CODEC), byteLength: z.int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u), chunks: z.array(z.strictObject({ position: z.int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u), body: z.instanceof(Uint8Array) })) });
export async function decodeDomainPayload(raw: unknown, budget: DomainResourceBudget): Promise<unknown> {
  const b = domainResourceBudgetSchema.safeParse(budget);
  if (!b.success) return invalidDomain();
  const parsed = encodedDomainSchema.safeParse(raw);
  if (!parsed.success) throw new DomainContractError("DOMAIN_CORRUPT");
  const envelope = parsed.data;
  if (envelope.byteLength > b.data.maxPayloadBytes || envelope.byteLength > b.data.maxDecodedBytes || envelope.chunks.length > b.data.maxChunks) domainLimit();
  const corrupt = (): never => { throw new DomainContractError("DOMAIN_CORRUPT"); };
  if (envelope.codec !== DOMAIN_CODEC || !Number.isSafeInteger(envelope.byteLength) || envelope.byteLength < 1 ||
    envelope.chunks.length !== Math.ceil(envelope.byteLength / b.data.chunkBytes)) return corrupt();
  const bytes = new Uint8Array(envelope.byteLength);
  let offset = 0;
  for (const [n, c] of envelope.chunks.entries()) {
    if (c.position !== n || c.body.byteLength !== Math.min(b.data.chunkBytes, bytes.length - offset) || await sha256Bytes(c.body) !== c.sha256) return corrupt();
    bytes.set(c.body, offset); offset += c.body.byteLength;
  }
  if (await sha256Bytes(bytes) !== envelope.sha256) return corrupt();
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), value: unknown = JSON.parse(text);
    if (canonicalDomainJson(value, b.data) !== text) return corrupt();
    return value;
  } catch { return corrupt(); }
}
