/** TextEncoder's byte length without allocating a second copy of the text.
 * Lone surrogates count as the encoder's three-byte replacement character;
 * callers that require lossless text must still reject them separately. */
export function utf8ByteLength(text: string): number {
  let bytes = text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) { bytes++; continue; }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 2; i++; continue; }
    }
    bytes += 2;
  }
  return bytes;
}
