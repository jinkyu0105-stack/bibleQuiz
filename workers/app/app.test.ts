import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("biblequiz-app Worker", () => {
  it("returns the standard health envelope", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.com/api/health"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const body = await response.json<{
      data: { service: string; status: string; timestamp: string };
    }>();

    expect(body.data.service).toBe("biblequiz-app");
    expect(body.data.status).toBe("ok");
    expect(new Date(body.data.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("returns JSON rather than SPA HTML for an unknown API route", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.com/api/unknown"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("checks the migrated D1 binding without returning database contents", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.com/api/health/database"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        database: "d1",
        status: "ok",
      },
    });
  });
});
