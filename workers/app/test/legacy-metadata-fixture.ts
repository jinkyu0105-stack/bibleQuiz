import { z } from "zod";
import { parseBibleReference } from "../../../shared/bible-reference";
import { finalCheckMetadataSnapshotSchema } from "../../_shared/services/final-check-metadata-contract";

// Synthetic rehearsal only. No production import, DB reads, writes or backfill.
const legacySchema = z.strictObject({
  sermonId: z.string(), title: z.string(), sermonDate: z.string(),
  translation: z.string(), mode: z.string(), label: z.string(),
  references: z.array(z.strictObject({
    book: z.string().min(1).max(40), chapter: z.int().positive(),
    verseStart: z.int().positive(), verseEnd: z.int().positive(),
  })),
});

export function inspectSyntheticLegacyMetadata(input: unknown) {
  const fail = (code: string) => ({ outcome: "needs_review" as const, code });
  const parsed = legacySchema.safeParse(input);
  if (!parsed.success) return fail("LEGACY_SHAPE_INVALID");
  const value = parsed.data;
  if (value.translation !== "개역개정" || value.mode !== "reference_only") return fail("LEGACY_EDITION_UNSUPPORTED");
  if (value.references.length !== 1) return fail("LEGACY_REFERENCE_COUNT");
  const reference = value.references[0]!;
  const converted = parseBibleReference(`${reference.book} ${reference.chapter}:${reference.verseStart}-${reference.verseEnd}`);
  const label = parseBibleReference(value.label);
  if (!converted.ok) return fail("LEGACY_REFERENCE_INVALID");
  if (!label.ok || JSON.stringify(label.value) !== JSON.stringify(converted.value)) return fail("LEGACY_LABEL_MISMATCH");
  const snapshot = finalCheckMetadataSnapshotSchema.safeParse({
    contractVersion: 1, sermonId: value.sermonId, metadataRevision: 1,
    title: value.title, sermonDate: value.sermonDate, bibleReference: converted.value,
  });
  if (!snapshot.success) return fail("LEGACY_METADATA_INVALID");
  // This is a candidate, not an initialized persisted revision.
  return { outcome: "candidate" as const, candidate: snapshot.data };
}
