import { describe, expect, it } from "vitest";

import { sessionDataSchema, sessionRequestSchema } from "./session";

describe("session API contract", () => {
  it("accepts only an empty object request", () => {
    expect(sessionRequestSchema.parse({})).toEqual({});
    for (const value of [null, [], { token: "private" }, { expiresAt: "2027-01-01T00:00:00.000Z" }]) {
      expect(sessionRequestSchema.safeParse(value).success).toBe(false);
    }
  });

  it("returns only a valid expiry timestamp", () => {
    expect(sessionDataSchema.parse({ expiresAt: "2027-02-28T00:00:00.000Z" })).toEqual({
      expiresAt: "2027-02-28T00:00:00.000Z",
    });
    expect(sessionDataSchema.safeParse({ expiresAt: "soon" }).success).toBe(false);
    expect(sessionDataSchema.safeParse({
      expiresAt: "2027-02-28T00:00:00.000Z",
      token: "private",
    }).success).toBe(false);
  });
});

