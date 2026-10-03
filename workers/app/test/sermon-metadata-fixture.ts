import { createBibleReference } from "../../../shared/bible-reference";
import type { Database } from "../../_shared/db/client";
import { bibleTranslations, sermons } from "../../_shared/db/schema";

export function metadataCommand(sermonId: string, expectedRevision: number | null = null) {
  const reference = createBibleReference({ bookId: "JHN", chapter: 3, verseStart: 16, verseEnd: 18 });
  if (!reference.ok) throw new Error("synthetic reference");
  return { sermonId, expectedRevision, title: "TEST_ONLY_PRIVATE_METADATA", sermonDate: "2026-09-06", bibleReference: reference.value };
}

export async function seedMetadataSermon(database: Database, sermonId: string) {
  const createdAt = "2026-09-10T00:00:00.000Z";
  await database.insert(bibleTranslations).values({
    id: sermonId, displayName: "개역개정", edition: "reference-only",
    publisherOrRightsholder: "합성", mode: "reference_only", createdAt, updatedAt: createdAt,
  });
  await database.insert(sermons).values({
    id: sermonId, slugSuffix: sermonId, churchName: "합성", youtubeUrl: `https://example.com/${sermonId}`,
    youtubeVideoId: sermonId, sermonTitle: "TEST_ONLY_PUBLIC_ORIGINAL", sermonDate: "2026-09-01",
    bibleTranslationId: sermonId, bibleReferenceJson: [{ book: "요", chapter: 3, verseStart: 16, verseEnd: 18 }],
    bibleReferenceLabel: "요한복음 3:16-18", createdAt, updatedAt: createdAt,
  });
}
