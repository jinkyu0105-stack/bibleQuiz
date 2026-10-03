import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { prepareInputSchema } from "../services/prepare-input-schema";
import { createBibleReference } from "../../../shared/bible-reference";

import type { Database } from "../db/client";
import { sermonMetadataDrafts } from "../db/schema";
import {
  finalCheckMetadataSnapshotSchema,
  type FinalCheckMetadataSnapshot,
  type FinalCheckMetadataStore,
} from "../services/final-check-metadata-contract";

const fields = finalCheckMetadataSnapshotSchema.shape;
prepareInputSchema(finalCheckMetadataSnapshotSchema);
// Run the pure canonical-reference rule at startup. The untrimmed title makes
// this an invalid metadata snapshot; nothing is stored or treated as a result.
const initializationReference = createBibleReference({ bookId: "GEN", chapter: 1, verseStart: 1, verseEnd: 1 });
if (initializationReference.ok) finalCheckMetadataSnapshotSchema.safeParse({ contractVersion: 1, sermonId: "INITIALIZE",
  metadataRevision: 1, title: " ", sermonDate: "2000-01-01", bibleReference: initializationReference.value });
const commandSchema = z.strictObject({
  sermonId: fields.sermonId,
  expectedRevision: z.int().positive().nullable(),
  title: fields.title,
  sermonDate: fields.sermonDate,
  bibleReference: fields.bibleReference,
});

type FailureCode = "METADATA_INVALID" | "METADATA_CORRUPT" | "METADATA_UNAVAILABLE";
/** Fixed diagnostics only: never attach input, D1/Zod issues, or a cause. */
export class SermonMetadataError extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}

type SaveResult = { outcome: "conflict" } | {
  outcome: "saved" | "unchanged";
  snapshot: FinalCheckMetadataSnapshot;
};

export interface SermonMetadataRepository extends FinalCheckMetadataStore {
  read(sermonId: string): Promise<FinalCheckMetadataSnapshot | null>;
  save(command: unknown): Promise<SaveResult>;
}

function invalid(code: FailureCode): never { throw new SermonMetadataError(code); }
function safeError(error: unknown): never {
  if (error instanceof SermonMetadataError) throw error;
  return invalid("METADATA_UNAVAILABLE");
}

function decode(row: typeof sermonMetadataDrafts.$inferSelect): FinalCheckMetadataSnapshot {
  try {
    return finalCheckMetadataSnapshotSchema.parse({
      contractVersion: row.contractVersion,
      sermonId: row.sermonId,
      metadataRevision: row.metadataRevision,
      title: row.title,
      sermonDate: row.sermonDate,
      bibleReference: JSON.parse(row.bibleReferenceJson),
    });
  } catch { return invalid("METADATA_CORRUPT"); }
}

/** One small D1 read, with the same decoder as the metadata command store. */
export async function readDisplayMetadata(db: D1Database, sermonId: string) {
  const row = await db.prepare(`SELECT sermon_id sermonId,contract_version contractVersion,metadata_revision metadataRevision,
    title,sermon_date sermonDate,bible_reference_json bibleReferenceJson FROM sermon_metadata_drafts WHERE sermon_id=?`)
    .bind(sermonId).first<typeof sermonMetadataDrafts.$inferSelect>();
  return row ? decode(row) : null;
}

/** Server-only metadata store. The optional D1 binding enables the admin draft guard.
 * One row and one conditional statement make snapshot + revision indivisible.
 * A DB failure is uncertain, never reported as a CAS conflict or auto-retried.
 */
export function createSermonMetadataRepository(database: Database, draftBinding?: D1Database): SermonMetadataRepository {
  async function read(sermonId: string) {
    if (!fields.sermonId.safeParse(sermonId).success) invalid("METADATA_INVALID");
    try {
      const [row] = await database.select().from(sermonMetadataDrafts)
        .where(eq(sermonMetadataDrafts.sermonId, sermonId));
      return row ? decode(row) : null;
    } catch (error) { return safeError(error); }
  }

  return {
    read,
    async save(input) {
      const command = commandSchema.safeParse(input);
      if (!command.success) invalid("METADATA_INVALID");
      const { sermonId, expectedRevision, title, sermonDate, bibleReference } = command.data;
      // Parse a complete P5-14 snapshot, including its semantic refinements.
      const candidate = finalCheckMetadataSnapshotSchema.safeParse({
        contractVersion: 1, sermonId, metadataRevision: 1, title, sermonDate, bibleReference,
      });
      if (!candidate.success) invalid("METADATA_INVALID");
      try {
        const current = await read(sermonId);
        if ((current?.metadataRevision ?? null) !== expectedRevision) return { outcome: "conflict" };
        const unchanged = current !== null && current.title === title &&
          current.sermonDate === sermonDate &&
          JSON.stringify(current.bibleReference) === JSON.stringify(candidate.data.bibleReference);
        if (draftBinding) {
          const editable = `EXISTS (SELECT 1 FROM sermons s JOIN quiz_sets q ON q.sermon_id=s.id
            WHERE s.id=? AND ${unpublishedSermonGuard})`;
          const referenceJson = JSON.stringify(candidate.data.bibleReference);
          const revision = (expectedRevision ?? 0) + 1;
          if (!unchanged && !Number.isSafeInteger(revision)) invalid("METADATA_INVALID");
          if (unchanged) {
            const row = await draftBinding.prepare(`SELECT metadata_revision FROM sermon_metadata_drafts
              WHERE sermon_id=? AND metadata_revision=? AND ${editable}`).bind(sermonId, expectedRevision, sermonId).first();
            return row ? { outcome: "unchanged", snapshot: current } : { outcome: "conflict" };
          }
          const statement = expectedRevision === null
            ? draftBinding.prepare(`INSERT INTO sermon_metadata_drafts
                (sermon_id,contract_version,metadata_revision,title,sermon_date,bible_reference_json)
                SELECT ?,1,?,?,?,? WHERE ${editable} ON CONFLICT(sermon_id) DO NOTHING RETURNING *`)
              .bind(sermonId, revision, title, sermonDate, referenceJson, sermonId)
            : draftBinding.prepare(`UPDATE sermon_metadata_drafts SET metadata_revision=?,title=?,sermon_date=?,bible_reference_json=?
                WHERE sermon_id=? AND metadata_revision=? AND ${editable} RETURNING *`)
              .bind(revision, title, sermonDate, referenceJson, sermonId, expectedRevision, sermonId);
          const saved = await statement.first();
          return saved ? { outcome: "saved", snapshot: { ...candidate.data, metadataRevision: revision } } : { outcome: "conflict" };
        }
        // A no-op still has a DB linearization point AFTER the expected revision check.
        if (unchanged) {
          const latest = await read(sermonId);
          if (!latest || JSON.stringify(latest) !== JSON.stringify(current)) return { outcome: "conflict" };
          return { outcome: "unchanged", snapshot: latest };
        }
        const metadataRevision = (expectedRevision ?? 0) + 1;
        if (!Number.isSafeInteger(metadataRevision)) invalid("METADATA_INVALID");
        const values = {
          sermonId, contractVersion: 1, metadataRevision, title, sermonDate,
          bibleReferenceJson: JSON.stringify(candidate.data.bibleReference),
        };
        const rows = expectedRevision === null
          ? await database.insert(sermonMetadataDrafts).values(values)
            .onConflictDoNothing({ target: sermonMetadataDrafts.sermonId }).returning()
          : await database.update(sermonMetadataDrafts).set(values).where(and(
            eq(sermonMetadataDrafts.sermonId, sermonId),
            eq(sermonMetadataDrafts.metadataRevision, expectedRevision),
          )).returning();
        const row = rows[0];
        // RETURNING belongs to this exact write, unlike a later read of a newer revision.
        return row ? { outcome: "saved", snapshot: decode(row) } : { outcome: "conflict" };
      } catch (error) { return safeError(error); }
    },
  };
}

/** q and s aliases belong to the caller. Ever-published/withdrawn and purged work stays on its own path. */
export const unpublishedSermonGuard = `q.status IN ('draft','review_ready','needs_revision')
  AND q.published_at IS NULL AND s.slug IS NULL
  AND NOT EXISTS (SELECT 1 FROM published_quiz_content p WHERE p.quiz_set_id=q.id)
  AND NOT EXISTS (SELECT 1 FROM quiz_withdrawals w WHERE w.quiz_set_id=q.id)
  AND NOT EXISTS (SELECT 1 FROM draft_cleanup_records d WHERE d.sermon_id=s.id)`;
