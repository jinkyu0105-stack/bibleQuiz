import { z } from "zod";

import {
  createBibleReference,
  normalizedBibleReferenceSchema,
} from "../../../shared/bible-reference";
import { publicSermonSchema } from "../../../shared/api/public-quiz";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);

function isCanonicalReference(
  reference: z.infer<typeof normalizedBibleReferenceSchema>,
): boolean {
  const canonical = createBibleReference({
    bookId: reference.reference.bookId,
    chapter: reference.reference.start.chapter,
    verseEnd: reference.reference.end.verse,
    verseStart: reference.reference.start.verse,
  });

  return canonical.ok &&
    canonical.value.canonicalLabel === reference.canonicalLabel &&
    canonical.value.mode === reference.mode &&
    canonical.value.readingPortalUrl === reference.readingPortalUrl &&
    canonical.value.translation === reference.translation &&
    canonical.value.verseCount === reference.verseCount &&
    canonical.value.reference.bookId === reference.reference.bookId &&
    canonical.value.reference.start.chapter === reference.reference.start.chapter &&
    canonical.value.reference.start.verse === reference.reference.start.verse &&
    canonical.value.reference.end.chapter === reference.reference.end.chapter &&
    canonical.value.reference.end.verse === reference.reference.end.verse;
}

/**
 * Current server-owned sermon metadata used by the final check.
 *
 * `metadataRevision` is deliberately separate from the transcript aggregate
 * version. A future persistence adapter must increase it for every metadata
 * change, including a change that later restores the same visible values.
 */
export const finalCheckMetadataSnapshotSchema = z.strictObject({
  contractVersion: z.literal(1),
  sermonId: id,
  metadataRevision: z.int().positive(),
  title: z.string().min(1).max(300),
  sermonDate: z.iso.date(),
  bibleReference: normalizedBibleReferenceSchema,
}).superRefine((metadata, context) => {
  if (metadata.title !== metadata.title.trim() ||
    metadata.title !== metadata.title.normalize("NFC")) {
    context.addIssue({
      code: "custom",
      message: "Sermon title must already be trimmed and NFC normalized",
      path: ["title"],
    });
  }
  if (!isCanonicalReference(metadata.bibleReference)) {
    context.addIssue({
      code: "custom",
      message: "Bible reference must match the canonical reference metadata",
      path: ["bibleReference"],
    });
  }
});

export type FinalCheckMetadataSnapshot = z.infer<
  typeof finalCheckMetadataSnapshotSchema
>;

/** Read-only boundary only. P5-14 does not provide a D1 adapter or writes. */
export interface FinalCheckMetadataStore {
  read(sermonId: string): Promise<unknown | null>;
}

/** Explicit public preview projection; no revision or canonical structure. */
export const finalCheckPublicMetadataSchema = publicSermonSchema.pick({
  title: true,
  date: true,
  bibleReferenceLabel: true,
  translation: true,
  bibleReadingUrl: true,
});

