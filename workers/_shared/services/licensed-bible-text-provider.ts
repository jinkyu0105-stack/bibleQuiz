import { z } from "zod";

import {
  canonicalBibleReferenceSchema,
  type CanonicalBibleReference,
} from "../../../shared/bible-reference";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const providerIdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);
const providerVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u);

export const licensedBibleTextModeSchema = z.enum([
  "licensed_api",
  "licensed_local",
]);

export const licensedBibleTextDestinationSchema = z.enum([
  "admin_review",
  "public_api",
  "public_html",
  "public_archive",
  "png",
  "pdf",
]);

export const licensedBibleTextPermissionSchema = z.strictObject({
  allowedArchive: z.boolean(),
  allowedPdf: z.boolean(),
  allowedPng: z.boolean(),
  allowedWeb: z.boolean(),
  approvalStatus: z.literal("approved"),
  evidenceSha256: sha256Schema,
  permissionExpiresAt: z.iso.datetime().nullable(),
  permissionStartsAt: z.iso.datetime().nullable(),
  requiredAttribution: z.string().min(1).max(1_000),
  rightsholder: z.string().min(1).max(300),
  territory: z.string().min(1).max(300),
}).superRefine((permission, context) => {
  if (
    permission.permissionStartsAt !== null
    && permission.permissionExpiresAt !== null
    && Date.parse(permission.permissionStartsAt) >= Date.parse(permission.permissionExpiresAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Permission expiry must be later than its start.",
      path: ["permissionExpiresAt"],
    });
  }
});

export const licensedBibleTextProviderDescriptorSchema = z.strictObject({
  mode: licensedBibleTextModeSchema,
  permission: licensedBibleTextPermissionSchema,
  providerId: providerIdentifierSchema,
  providerVersion: providerVersionSchema,
  sourceSha256: sha256Schema,
  translation: z.literal("개역개정"),
});

export const licensedBibleTextRequestSchema = z.strictObject({
  destination: licensedBibleTextDestinationSchema,
  mode: licensedBibleTextModeSchema,
  reference: canonicalBibleReferenceSchema,
  requestedAt: z.iso.datetime(),
  translation: z.literal("개역개정"),
});

const licensedBibleVerseSchema = z.strictObject({
  bookId: canonicalBibleReferenceSchema.shape.bookId,
  chapter: z.int().positive(),
  text: z.string().max(20_000).refine((text) => text.trim().length > 0),
  verse: z.int().positive(),
});

export const licensedBibleTextProviderResponseSchema = z.strictObject({
  mode: licensedBibleTextModeSchema,
  passageSha256: sha256Schema,
  providerId: providerIdentifierSchema,
  providerVersion: providerVersionSchema,
  reference: canonicalBibleReferenceSchema,
  retrievedAt: z.iso.datetime(),
  sourceSha256: sha256Schema,
  translation: z.literal("개역개정"),
  verses: z.array(licensedBibleVerseSchema).min(1).max(200),
});

export type LicensedBibleTextProviderDescriptor = z.infer<
  typeof licensedBibleTextProviderDescriptorSchema
>;
export type LicensedBibleTextRequest = z.infer<typeof licensedBibleTextRequestSchema>;
export type LicensedBibleTextProviderResponse = z.infer<
  typeof licensedBibleTextProviderResponseSchema
>;

/**
 * Server-only adapter contract. Credentials belong in the concrete adapter's
 * environment/closure and must never be returned in descriptor or response data.
 */
export interface LicensedBibleTextProvider {
  readonly descriptor: LicensedBibleTextProviderDescriptor;
  fetchPassage(request: LicensedBibleTextRequest): Promise<unknown>;
}

function referencesMatch(
  left: CanonicalBibleReference,
  right: CanonicalBibleReference,
): boolean {
  return left.bookId === right.bookId
    && left.start.chapter === right.start.chapter
    && left.start.verse === right.start.verse
    && left.end.chapter === right.end.chapter
    && left.end.verse === right.end.verse;
}

function permissionIsActive(
  permission: z.infer<typeof licensedBibleTextPermissionSchema>,
  requestedAt: string,
): boolean {
  const timestamp = Date.parse(requestedAt);
  return (permission.permissionStartsAt === null
      || timestamp >= Date.parse(permission.permissionStartsAt))
    && (permission.permissionExpiresAt === null
      || timestamp < Date.parse(permission.permissionExpiresAt));
}

function destinationIsAllowed(
  permission: z.infer<typeof licensedBibleTextPermissionSchema>,
  destination: z.infer<typeof licensedBibleTextDestinationSchema>,
): boolean {
  switch (destination) {
    case "admin_review":
      return true;
    case "public_api":
    case "public_html":
      return permission.allowedWeb;
    case "public_archive":
      return permission.allowedWeb && permission.allowedArchive;
    case "png":
      return permission.allowedPng;
    case "pdf":
      return permission.allowedPdf;
  }
}

export function assertLicensedBibleTextRequestAllowed(
  descriptorInput: unknown,
  requestInput: unknown,
): {
  descriptor: LicensedBibleTextProviderDescriptor;
  request: LicensedBibleTextRequest;
} {
  const descriptor = licensedBibleTextProviderDescriptorSchema.parse(descriptorInput);
  const request = licensedBibleTextRequestSchema.parse(requestInput);

  if (descriptor.mode !== request.mode) {
    throw new Error("LICENSED_BIBLE_TEXT_MODE_MISMATCH");
  }
  if (descriptor.translation !== request.translation) {
    throw new Error("LICENSED_BIBLE_TEXT_TRANSLATION_MISMATCH");
  }
  if (!permissionIsActive(descriptor.permission, request.requestedAt)) {
    throw new Error("LICENSED_BIBLE_TEXT_PERMISSION_INACTIVE");
  }
  if (!destinationIsAllowed(descriptor.permission, request.destination)) {
    throw new Error("LICENSED_BIBLE_TEXT_DESTINATION_FORBIDDEN");
  }

  return { descriptor, request };
}

export function parseLicensedBibleTextProviderResponse(
  descriptorInput: unknown,
  requestInput: unknown,
  responseInput: unknown,
): LicensedBibleTextProviderResponse {
  const { descriptor, request } = assertLicensedBibleTextRequestAllowed(
    descriptorInput,
    requestInput,
  );
  const response = licensedBibleTextProviderResponseSchema.parse(responseInput);

  if (
    response.providerId !== descriptor.providerId
    || response.providerVersion !== descriptor.providerVersion
  ) {
    throw new Error("LICENSED_BIBLE_TEXT_PROVIDER_MISMATCH");
  }
  if (
    response.mode !== descriptor.mode
    || response.translation !== descriptor.translation
    || response.sourceSha256 !== descriptor.sourceSha256
  ) {
    throw new Error("LICENSED_BIBLE_TEXT_SOURCE_MISMATCH");
  }
  if (!referencesMatch(response.reference, request.reference)) {
    throw new Error("LICENSED_BIBLE_TEXT_REFERENCE_MISMATCH");
  }

  const expectedVerseCount = request.reference.end.verse
    - request.reference.start.verse
    + 1;
  if (response.verses.length !== expectedVerseCount) {
    throw new Error("LICENSED_BIBLE_TEXT_VERSE_RANGE_MISMATCH");
  }

  response.verses.forEach((verse, index) => {
    if (
      verse.bookId !== request.reference.bookId
      || verse.chapter !== request.reference.start.chapter
      || verse.verse !== request.reference.start.verse + index
    ) {
      throw new Error("LICENSED_BIBLE_TEXT_VERSE_RANGE_MISMATCH");
    }
  });

  return response;
}

export async function fetchLicensedBibleTextPassage(
  provider: LicensedBibleTextProvider,
  requestInput: unknown,
): Promise<LicensedBibleTextProviderResponse> {
  const { request } = assertLicensedBibleTextRequestAllowed(
    provider.descriptor,
    requestInput,
  );
  const response = await provider.fetchPassage(request);
  return parseLicensedBibleTextProviderResponse(
    provider.descriptor,
    request,
    response,
  );
}
