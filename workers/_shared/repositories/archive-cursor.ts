import { z } from "zod";
import { archiveFilterKey, InvalidArchiveFilter, type ArchiveQuery } from "../../../shared/api/archive";

const payloadSchema = z.strictObject({ v: z.literal(1), date: z.iso.date(), id: z.string().min(1).max(128), filter: z.string() });
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
function decode(value: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
  if (encode(bytes) !== value) throw new InvalidArchiveFilter();
  return bytes;
}
async function signingKey(secret: string | undefined) {
  // No shared fallback or per-isolate ephemeral key: both break integrity/restarts.
  if (!secret || !/^[a-fA-F0-9]{64}$/u.test(secret)) throw new Error("ARCHIVE_CURSOR_KEY_UNAVAILABLE");
  const bytes = Uint8Array.from(secret.match(/../gu)!, (byte) => Number.parseInt(byte, 16));
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function fingerprint(query: ArchiveQuery) {
  return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(archiveFilterKey(query)))));
}
export async function signArchiveCursor(position: { date: string; id: string }, query: ArchiveQuery, secret: string | undefined): Promise<string> {
  const key = await signingKey(secret);
  const payload = encode(encoder.encode(JSON.stringify(payloadSchema.parse({ v: 1, ...position, filter: await fingerprint(query) }))));
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function readArchiveCursor(cursor: string, query: ArchiveQuery, secret: string | undefined): Promise<{ date: string; id: string }> {
  const key = await signingKey(secret);
  try {
    const [payload, signature, extra] = cursor.split(".");
    if (!payload || !signature || extra !== undefined || cursor.length > 2048) throw new InvalidArchiveFilter();
    if (!await crypto.subtle.verify("HMAC", key, decode(signature), encoder.encode(payload))) throw new InvalidArchiveFilter();
    const value = payloadSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(decode(payload))));
    if (value.filter !== await fingerprint(query)) throw new InvalidArchiveFilter();
    return { date: value.date, id: value.id };
  } catch { throw new InvalidArchiveFilter(); }
}
