import { describe, expect, it } from "vitest";

import type { LicensedBibleTextProvider } from "../_shared/services/licensed-bible-text-provider";
import {
  assertLicensedBibleTextRequestAllowed,
  fetchLicensedBibleTextPassage,
  licensedBibleTextDestinationSchema,
  licensedBibleTextProviderDescriptorSchema,
  licensedBibleTextProviderResponseSchema,
  licensedBibleTextRequestSchema,
  parseLicensedBibleTextProviderResponse,
} from "../_shared/services/licensed-bible-text-provider";

const sourceSha256 = "a".repeat(64);
const passageSha256 = "b".repeat(64);
const reference = {
  bookId: "JHN",
  end: { chapter: 3, verse: 3 },
  start: { chapter: 3, verse: 1 },
} as const;
const descriptor = {
  mode: "licensed_api",
  permission: {
    allowedArchive: true,
    allowedPdf: false,
    allowedPng: false,
    allowedWeb: true,
    approvalStatus: "approved",
    evidenceSha256: "c".repeat(64),
    permissionExpiresAt: "2027-01-01T00:00:00.000Z",
    permissionStartsAt: "2026-01-01T00:00:00.000Z",
    requiredAttribution: "TEST-ONLY ATTRIBUTION",
    rightsholder: "TEST-ONLY RIGHTSHOLDER",
    territory: "TEST-ONLY TERRITORY",
  },
  providerId: "test-only-provider",
  providerVersion: "test-v1",
  sourceSha256,
  translation: "개역개정",
} as const;
const request = {
  destination: "public_html",
  mode: "licensed_api",
  reference,
  requestedAt: "2026-09-07T00:00:00.000Z",
  translation: "개역개정",
} as const;
const response = {
  mode: "licensed_api",
  passageSha256,
  providerId: "test-only-provider",
  providerVersion: "test-v1",
  reference,
  retrievedAt: "2026-09-07T00:00:01.000Z",
  sourceSha256,
  translation: "개역개정",
  verses: [
    { bookId: "JHN", chapter: 3, text: "TEST_ONLY_VERSE_1", verse: 1 },
    { bookId: "JHN", chapter: 3, text: "TEST_ONLY_VERSE_2", verse: 2 },
    { bookId: "JHN", chapter: 3, text: "TEST_ONLY_VERSE_3", verse: 3 },
  ],
} as const;

describe("licensed Bible text provider boundary", () => {
  it("defines a server-only unknown-output adapter without selecting a provider", async () => {
    const provider: LicensedBibleTextProvider = {
      descriptor,
      fetchPassage: async () => response,
    };

    await expect(fetchLicensedBibleTextPassage(provider, request)).resolves.toEqual(response);
  });

  it("rejects reference-only, pending permission, secrets and response extras", () => {
    expect(licensedBibleTextProviderDescriptorSchema.safeParse({
      ...descriptor,
      mode: "reference_only",
    }).success).toBe(false);
    expect(licensedBibleTextProviderDescriptorSchema.safeParse({
      ...descriptor,
      permission: { ...descriptor.permission, approvalStatus: "pending" },
    }).success).toBe(false);
    expect(licensedBibleTextProviderDescriptorSchema.safeParse({
      ...descriptor,
      apiKey: "must-not-cross-the-interface",
    }).success).toBe(false);
    expect(licensedBibleTextProviderResponseSchema.safeParse({
      ...response,
      signedUrl: "https://example.invalid/private",
    }).success).toBe(false);
  });

  it("keeps current public, HTML, AI and export sinks closed to reference-only text", () => {
    for (const destination of [
      "public_api",
      "public_html",
      "public_archive",
      "png",
      "pdf",
    ]) {
      expect(licensedBibleTextRequestSchema.safeParse({
        ...request,
        destination,
        mode: "reference_only",
      }).success).toBe(false);
    }
    expect(licensedBibleTextDestinationSchema.safeParse("ai_request").success).toBe(false);
  });

  it("checks active permission and each licensed output scope before any provider call", async () => {
    expect(assertLicensedBibleTextRequestAllowed(descriptor, request)).toEqual({
      descriptor,
      request,
    });
    expect(() => assertLicensedBibleTextRequestAllowed(descriptor, {
      ...request,
      destination: "png",
    })).toThrow("LICENSED_BIBLE_TEXT_DESTINATION_FORBIDDEN");
    expect(() => assertLicensedBibleTextRequestAllowed(descriptor, {
      ...request,
      destination: "pdf",
    })).toThrow("LICENSED_BIBLE_TEXT_DESTINATION_FORBIDDEN");
    expect(() => assertLicensedBibleTextRequestAllowed(descriptor, {
      ...request,
      requestedAt: "2027-01-01T00:00:00.000Z",
    })).toThrow("LICENSED_BIBLE_TEXT_PERMISSION_INACTIVE");

    let calls = 0;
    const provider: LicensedBibleTextProvider = {
      descriptor,
      fetchPassage: async () => {
        calls += 1;
        return response;
      },
    };
    await expect(fetchLicensedBibleTextPassage(provider, {
      ...request,
      destination: "png",
    })).rejects.toThrow("LICENSED_BIBLE_TEXT_DESTINATION_FORBIDDEN");
    expect(calls).toBe(0);
  });

  it("requires exact provider, source, reference and contiguous verse identity", () => {
    expect(() => parseLicensedBibleTextProviderResponse(descriptor, request, {
      ...response,
      providerId: "other-provider",
    })).toThrow("LICENSED_BIBLE_TEXT_PROVIDER_MISMATCH");
    expect(() => parseLicensedBibleTextProviderResponse(descriptor, request, {
      ...response,
      sourceSha256: "d".repeat(64),
    })).toThrow("LICENSED_BIBLE_TEXT_SOURCE_MISMATCH");
    expect(() => parseLicensedBibleTextProviderResponse(descriptor, request, {
      ...response,
      reference: { ...reference, end: { chapter: 3, verse: 2 } },
    })).toThrow("LICENSED_BIBLE_TEXT_REFERENCE_MISMATCH");
    expect(() => parseLicensedBibleTextProviderResponse(descriptor, request, {
      ...response,
      verses: [response.verses[0], response.verses[2], response.verses[1]],
    })).toThrow("LICENSED_BIBLE_TEXT_VERSE_RANGE_MISMATCH");
  });
});
