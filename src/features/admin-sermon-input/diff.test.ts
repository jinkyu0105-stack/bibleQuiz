import { describe, expect, it } from "vitest";

import { createTextDiff, inputContentText } from "./diff";

describe("administrator sermon input browser diff", () => {
  it("preserves unchanged text and marks only removed and added tokens", () => {
    expect(createTextDiff("처음 말씀입니다.\n그대로", "처음 고친 말씀입니다.\n그대로")).toEqual([
      { kind: "equal", text: "처음 " },
      { kind: "added", text: "고친 " },
      { kind: "equal", text: "말씀입니다.\n그대로" },
    ]);
  });

  it("projects timed segments only after selected content is supplied", () => {
    expect(inputContentText({
      format: "timed_segments",
      segments: [
        { segmentId: "segment-1", text: "첫 구간", start: 0, duration: 1 },
        { segmentId: "segment-2", text: "둘째 구간", start: 1, duration: 1 },
      ],
    })).toBe("첫 구간\n둘째 구간");
  });

  it("bounds very large changed middles without dropping either body", () => {
    const left = Array.from({ length: 250 }, (_, index) => `이전${index}`).join(" ");
    const right = Array.from({ length: 250 }, (_, index) => `다음${index}`).join(" ");
    const parts = createTextDiff(left, right);
    expect(parts.map((part) => part.kind)).toEqual(["removed", "added"]);
    expect(parts[0]?.text).toBe(left);
    expect(parts[1]?.text).toBe(right);
  });
});
