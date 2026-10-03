import { expect, it } from "vitest";
import { utf8ByteLength } from "../_shared/storage/utf8-byte-length";
import { canonicalGenerationJson } from "../_shared/services/generation-context-codec";

it("matches the UTF-8 encoder for every UTF-16 code unit, pairs and malformed sequences", () => {
  const encoder = new TextEncoder();
  for (let code = 0; code <= 0xffff; code++) {
    const text = String.fromCharCode(code);
    if (utf8ByteLength(text) !== encoder.encode(text).length) throw new Error(`UTF8_LENGTH_${code}`);
  }
  for (const text of ["", "한글😀", "\ud800\ud800\udc00\udc00", "\udbff\udfff", "a\n\"\\\u0000", "가😀".repeat(30000)]) {
    expect(utf8ByteLength(text)).toBe(encoder.encode(text).length);
  }
});

it("counts each nested context byte once and retains the exact escaped UTF-8 boundary", () => {
  const value = { a: ["가😀\u0000\n".repeat(5000)], z: true };
  const text = JSON.stringify(value);
  expect(canonicalGenerationJson(value)).toBe(text);
  const room = 131072 - utf8ByteLength(text);
  value.a[0] += "x".repeat(room);
  expect(utf8ByteLength(canonicalGenerationJson(value))).toBe(131072);
  value.a[0] += "x";
  expect(() => canonicalGenerationJson(value)).toThrow("CONTEXT_LIMIT");
});

it("preserves the existing standalone scalar allowance separately from structured context size", () => {
  const scalar = "\u0000".repeat(22000);
  expect(canonicalGenerationJson(scalar)).toBe(JSON.stringify(scalar));
  expect(() => canonicalGenerationJson({ scalar })).toThrow("CONTEXT_LIMIT");
});
