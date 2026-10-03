import { describe, expect, it } from "vitest";

import { documentSha256, locateUniqueCorrectionTarget, sourceSha256 } from "./correction";

describe("administrator manual correction preparation", () => {
  it("locates one exact plain-text target with server-compatible context", () => {
    expect(locateUniqueCorrectionTarget({ format: "plain_text", text: "앞말 바꿀말 뒷말" }, "바꿀말")).toEqual({
      segmentId: null,
      start: null,
      duration: null,
      from: 3,
      to: 6,
      contextBefore: "앞말 ",
      contextAfter: " 뒷말",
    });
  });

  it("rejects absent or ambiguous targets and preserves timed metadata", () => {
    expect(locateUniqueCorrectionTarget({ format: "plain_text", text: "말 말" }, "말")).toBeNull();
    expect(locateUniqueCorrectionTarget({
      format: "timed_segments",
      segments: [{ segmentId: "segment-1", text: "고칠 표현", start: 2.5, duration: 1.25 }],
    }, "고칠")).toMatchObject({ segmentId: "segment-1", start: 2.5, duration: 1.25, from: 0, to: 2 });
  });

  it("uses the document text hash and canonical timed source hash required by the server", async () => {
    const content = {
      format: "timed_segments" as const,
      segments: [{ segmentId: "segment-1", text: "가", start: 0, duration: 1 }],
    };
    await expect(documentSha256(content)).resolves.toMatch(/^[0-9a-f]{64}$/u);
    await expect(sourceSha256(content)).resolves.not.toBe(await documentSha256(content));
  });
});
