/** Decode a bounded SQLite hex(BLOB) projection. The query must also check
 * typeof(body)='blob'; accepting text stored in a BLOB column would mask damage.
 * Hex avoids D1's JSON number per byte and keeps malformed UTF-8 lossless so
 * the existing length, digest and UTF-8 checks can reject it. */
export function decodeD1HexBlob(value: unknown, maximumBytes: number): Uint8Array | null {
  if (typeof value !== "string" || value.length % 2 || value.length / 2 > maximumBytes) return null;
  const bytes = new Uint8Array(value.length / 2);
  const nibble = (code: number) => code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 70 ? code - 55 : -1;
  for (let i = 0; i < bytes.length; i++) {
    const high = nibble(value.charCodeAt(i * 2)), low = nibble(value.charCodeAt(i * 2 + 1));
    if (high < 0 || low < 0) return null;
    bytes[i] = high * 16 + low;
  }
  return bytes;
}
