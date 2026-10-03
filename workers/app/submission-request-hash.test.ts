import { describe, expect, it } from "vitest";

import { hashSubmissionRequest } from "../_shared/services/submission-request-hash";

const base = {
  cells: { r0c1: "나", r0c0: "가" },
  comment: "감사합니다",
  name: "은혜",
  quizVariantId: "variant-child",
  revision: 1,
};

describe("semantic submission request hash", () => {
  it("is stable across cell insertion order", async () => {
    await expect(hashSubmissionRequest(base)).resolves.toBe(
      await hashSubmissionRequest({
        ...base,
        cells: { r0c0: "가", r0c1: "나" },
      }),
    );
  });

  it("uses the same stable NFC and trim normalization as stored public text", async () => {
    await expect(hashSubmissionRequest({
      ...base,
      name: "  은혜  ",
      comment: "  감사드립니다  ",
    })).resolves.toBe(await hashSubmissionRequest({
      ...base,
      name: "은혜",
      comment: "감사드립니다",
    }));
  });

  it.each([
    ["variant", { ...base, quizVariantId: "variant-adult" }],
    ["revision", { ...base, revision: 2 }],
    ["name", { ...base, name: "기쁨" }],
    ["comment", { ...base, comment: null }],
    ["cells", { ...base, cells: { r0c0: "다", r0c1: "나" } }],
  ])("changes when semantic %s changes", async (_label, changed) => {
    await expect(hashSubmissionRequest(changed)).resolves.not.toBe(
      await hashSubmissionRequest(base),
    );
  });
});
