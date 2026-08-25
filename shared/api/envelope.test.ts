import { describe, expect, it } from "vitest";

import { failure, success } from "./envelope";

describe("API envelope", () => {
  it("wraps successful data without adding private fields", () => {
    expect(success({ status: "ok" })).toEqual({ data: { status: "ok" } });
  });

  it("returns a stable error code and request ID", () => {
    expect(
      failure({
        code: "NOT_FOUND",
        message: "요청한 API를 찾을 수 없습니다.",
        requestId: "request-1",
      }),
    ).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "요청한 API를 찾을 수 없습니다.",
        requestId: "request-1",
      },
    });
  });
});
