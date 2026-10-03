import { describe, expect, it } from "vitest";
import { withinTranscriptCharacterLimit } from "../_shared/services/transcript-character-limit";

describe("D-033 caption code-point limit", () => {
  it.each(["가", "😀", "a", "\"", "\\", "\n", " "])("counts unchanged %s code points at both edges", character => {
    for (const size of [29_999, 30_000, 30_001]) {
      expect(withinTranscriptCharacterLimit(character.repeat(size))).toBe(size <= 30_000);
    }
  });
  it("counts LF separators and does not join surrogate halves across segments", () => {
    expect(withinTranscriptCharacterLimit([{ text: "😀".repeat(15_000) }, { text: "가".repeat(14_999) }])).toBe(true);
    expect(withinTranscriptCharacterLimit([{ text: "😀".repeat(15_000) }, { text: "가".repeat(15_000) }])).toBe(false);
    expect(withinTranscriptCharacterLimit([{ text: "가".repeat(29_998) + "\ud83d" }, { text: "\ude00" }])).toBe(false);
  });
  it("does not normalize decomposed Korean, combining marks, CRLF or BOM", () => {
    const prefix = "가".repeat(29_997);
    expect(withinTranscriptCharacterLimit(prefix + "\ufeff\r\n")).toBe(true);
    expect(withinTranscriptCharacterLimit(prefix + "가e\u0301")).toBe(false);
  });
});
