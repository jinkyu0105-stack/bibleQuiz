import { z } from "zod";

// Private, deterministic byte transport only: no DB, network, logging or domain approval.
export const historyChunkBytes = 65_536;
export const historyCodec = "record-json-utf8-v1";
const positive = z.int().positive();
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const manifestSchema = z.strictObject({
  codec: z.literal(historyCodec), chunkBytes: z.literal(historyChunkBytes),
  chunkCount: positive, byteLength: positive, payloadSha256: hashSchema,
});
const chunkSchema = z.strictObject({
  chunkIndex: z.int().nonnegative(), byteLength: positive.max(historyChunkBytes),
  chunkSha256: hashSchema, body: z.instanceof(Uint8Array),
}).refine((chunk) => chunk.body.byteLength === chunk.byteLength);
export type HistoryPayload = {
  manifest: z.infer<typeof manifestSchema>;
  chunks: z.infer<typeof chunkSchema>[];
};
export class InvalidHistoryStorage extends Error {
  constructor() { super("HISTORY_STORAGE_INVALID"); }
}
export function invalidHistory(): never { throw new InvalidHistoryStorage(); }

/** Semantic equality ignores object key order, but never array order or absent/null. */
export function sameHistoryValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every((key) => Object.hasOwn(b, key) &&
    sameHistoryValue(Reflect.get(a, key), Reflect.get(b, key)));
}

/** Reject values JSON would silently drop/replace, including lossy UTF-16. */
function verifyJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (/[\uD800-\uDFFF]/u.test(value)) invalidHistory();
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) invalidHistory();
    return;
  }
  if (typeof value !== "object" || ancestors.has(value)) invalidHistory();
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalidHistory();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) invalidHistory();
  if (array && (keys.length !== value.length + 1 ||
    !Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean))) invalidHistory();
  ancestors.add(value);
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !("value" in descriptor)) invalidHistory();
    verifyJson(key, ancestors);
    verifyJson(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

export async function historySha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Serialize once. Domain source/working checksums are intentionally NOT this hash. */
export async function encodeHistoryJson(value: unknown): Promise<HistoryPayload> {
  try {
    verifyJson(value);
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const chunks: HistoryPayload["chunks"] = [];
    for (let offset = 0; offset < bytes.length; offset += historyChunkBytes) {
      const body = bytes.slice(offset, offset + historyChunkBytes);
      chunks.push({ chunkIndex: chunks.length, byteLength: body.length,
        chunkSha256: await historySha256(body), body });
    }
    return { manifest: { codec: historyCodec, chunkBytes: historyChunkBytes, chunkCount: chunks.length,
      byteLength: bytes.length, payloadSha256: await historySha256(bytes) }, chunks };
  } catch { return invalidHistory(); }
}

/** Accept unordered transport rows; index, exact lengths and BOTH hash levels decide validity. */
export async function decodeHistoryJson(input: unknown): Promise<unknown> {
  try {
    const parsed = z.strictObject({ manifest: manifestSchema, chunks: z.array(chunkSchema).min(1) }).parse(input);
    // Detach every buffer before the first await: callers cannot change bytes mid-verification.
    const chunks = parsed.chunks.map((c) => ({ ...c, body: new Uint8Array(c.body) }))
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
    const m = parsed.manifest;
    if (m.chunkCount !== chunks.length || m.chunkCount !== Math.ceil(m.byteLength / historyChunkBytes)) invalidHistory();
    let total = 0;
    for (const [i, c] of chunks.entries()) {
      const expected = i === chunks.length - 1 ? m.byteLength - i * historyChunkBytes : historyChunkBytes;
      if (c.chunkIndex !== i || c.byteLength !== expected || c.body.length !== expected) invalidHistory();
      total += c.body.length;
      if (await historySha256(c.body) !== c.chunkSha256) invalidHistory();
    }
    if (total !== m.byteLength) invalidHistory();
    const bytes = new Uint8Array(total);
    for (const c of chunks) bytes.set(c.body, c.chunkIndex * historyChunkBytes);
    if (await historySha256(bytes) !== m.payloadSha256) invalidHistory();
    // ignoreBOM=true preserves a leading BOM for JSON.parse to reject, rather than hiding it.
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    verifyJson(value);
    return value;
  } catch { return invalidHistory(); }
}
