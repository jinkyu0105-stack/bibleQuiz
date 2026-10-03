import { describe, expect, it } from "vitest";
import { isWellFormedText } from "../_shared/services/text-well-formed";

describe("lossless native Unicode check", () => {
  it("matches the original rule for every individual UTF-16 code unit", () => {
    for (let n = 0; n <= 0xffff; n++) {
      const text = String.fromCharCode(n);
      if (isWellFormedText(text) !== !/[\uD800-\uDFFF]/u.test(text)) throw new Error(`Mismatch at ${n}`);
    }
  });
  it("accepts all Unicode supplementary code points without changing them", () => {
    for (let n = 0x10000; n <= 0x10ffff; n++) {
      if (!isWellFormedText(String.fromCodePoint(n))) throw new Error(`Mismatch at ${n}`);
    }
  });
  it("matches the old check across adjacent Unicode/control boundaries", () => {
    const parts = ["", "x", "가", "\r\n", "\0", "\uD7FF", "\uD800", "\uDBFF", "\uDC00", "\uDFFF", "\uE000", "😀"];
    for (const a of parts) for (const b of parts) for (const c of parts) {
      const text = a + b + c;
      expect(isWellFormedText(text)).toBe(!/[\uD800-\uDFFF]/u.test(text));
    }
  });
});
