import {
  draftListSchema, draftMetadataViewSchema, registerSermonSchema, registerSermonResultSchema, saveDraftMetadataSchema,
} from "../../../shared/api/admin-sermon-drafts";
import { adminSermonIdSchema } from "../../../shared/api/admin-sermon-input";
import { parseBibleReference } from "../../../shared/bible-reference";
import { parseYouTubeVideoId } from "../../../shared/sermon-registration";
import { createDatabase } from "../db/client";
import { createSermonMetadataRepository, unpublishedSermonGuard } from "../repositories/sermon-metadata-repository";
import { finalCheckMetadataSnapshotSchema } from "./final-check-metadata-contract";
import { sha256Bytes } from "../storage/sha256";

export class SermonDraftError extends Error {
  constructor(readonly code: "DRAFT_INVALID" | "DRAFT_CONFLICT" | "DRAFT_NOT_FOUND") { super(code); }
}
function invalid(): never { throw new SermonDraftError("DRAFT_INVALID"); }
function metadata(sermonId: string, fields: { title: string; sermonDate: string; referenceInput: string }) {
  const reference = parseBibleReference(fields.referenceInput);
  if (!reference.ok) return invalid();
  return finalCheckMetadataSnapshotSchema.parse({ contractVersion: 1, sermonId, metadataRevision: 1,
    title: fields.title, sermonDate: fields.sermonDate, bibleReference: reference.value });
}

export async function findExistingSermonVideo(db: D1Database, videoId: string) {
  const row = await db.prepare(`SELECT s.id sermonId,
    CASE WHEN ${unpublishedSermonGuard} THEN 'draft'
      WHEN EXISTS(SELECT 1 FROM draft_cleanup_records d WHERE d.sermon_id=s.id) AND s.slug IS NULL THEN 'expired'
      ELSE 'published' END destination
    FROM sermons s JOIN quiz_sets q ON q.sermon_id=s.id WHERE s.youtube_video_id=?`).bind(videoId).first();
  return row ? registerSermonResultSchema.parse({ outcome: "existing", ...row }) : null;
}
export async function registerSermonDraft(db: D1Database, raw: unknown, email: string, now = new Date()) {
  const parsed = registerSermonSchema.safeParse(raw);
  if (!parsed.success) return invalid();
  const videoId = parseYouTubeVideoId(parsed.data.video);
  if (!videoId) return invalid();
  const prior = await findExistingSermonVideo(db, videoId);
  if (prior) return prior;
  const id = crypto.randomUUID(), quizId = crypto.randomUUID();
  const snapshot = metadata(id, parsed.data), reference = snapshot.bibleReference;
  const actor = await sha256Bytes(new TextEncoder().encode(email));
  const createdAt = now.toISOString();
  // Only a reference-only translation row; no text permission is asserted.
  const translationId = "GAE-reference-only";
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  for (let attempt = 0; attempt < 8; attempt++) {
    let suffix = "";
    while (suffix.length < 6) {
      for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
        if (byte < 256 - 256 % alphabet.length && suffix.length < 6) suffix += alphabet[byte % alphabet.length];
      }
    }
    try {
      await db.batch([
        db.prepare(`INSERT INTO bible_translations (id,display_name,edition,publisher_or_rightsholder,mode,created_at,updated_at)
          VALUES (?,'개역개정','reference-only','대한성서공회','reference_only',?,?) ON CONFLICT(id) DO NOTHING`).bind(translationId, createdAt, createdAt),
        db.prepare(`INSERT INTO sermons(id,slug_suffix,church_name,youtube_url,youtube_video_id,sermon_title,sermon_date,
          bible_translation_id,bible_reference_json,bible_reference_label,created_at,updated_at)
          SELECT ?,?,'다사랑교회',?,?,?,?,?,?,?, ?,? FROM bible_translations WHERE id=? AND mode='reference_only' AND display_name='개역개정'`)
          .bind(id, suffix, `https://www.youtube.com/watch?v=${videoId}`, videoId, snapshot.title, snapshot.sermonDate, translationId,
            JSON.stringify([{ book: reference.reference.bookId, chapter: reference.reference.start.chapter,
              verseStart: reference.reference.start.verse, verseEnd: reference.reference.end.verse }]), reference.canonicalLabel, createdAt, createdAt, translationId),
        db.prepare(`INSERT INTO quiz_sets(id,sermon_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?)`).bind(quizId, id, actor, createdAt, createdAt),
        db.prepare(`INSERT INTO sermon_metadata_drafts(sermon_id,contract_version,metadata_revision,title,sermon_date,bible_reference_json)
          VALUES (?,1,1,?,?,?)`).bind(id, snapshot.title, snapshot.sermonDate, JSON.stringify(reference)),
      ]);
      return registerSermonResultSchema.parse({ outcome: "created", sermonId: id, destination: "draft" });
    } catch (error) {
      const duplicate = await findExistingSermonVideo(db, videoId);
      if (duplicate) return duplicate;
      // Retry only a proven suffix collision, never an uncertain write or other DB failure.
      if (!await db.prepare("SELECT id FROM sermons WHERE slug_suffix=?").bind(suffix).first()) throw error;
    }
  }
  throw new SermonDraftError("DRAFT_CONFLICT");
}

export async function listSermonDrafts(db: D1Database) {
  const rows = await db.prepare(`SELECT s.id sermonId,q.id quizSetId,coalesce(m.title,s.sermon_title) title,
    coalesce(m.sermon_date,s.sermon_date) sermonDate,q.status,
    EXISTS(SELECT 1 FROM draft_cleanup_records d WHERE d.sermon_id=s.id) expired
    FROM sermons s JOIN quiz_sets q ON q.sermon_id=s.id LEFT JOIN sermon_metadata_drafts m ON m.sermon_id=s.id
    WHERE q.status IN ('draft','review_ready','needs_revision') AND q.published_at IS NULL AND s.slug IS NULL
      AND NOT EXISTS(SELECT 1 FROM published_quiz_content p WHERE p.quiz_set_id=q.id)
    ORDER BY q.created_at DESC,q.id DESC`).all();
  return draftListSchema.parse({ items: rows.results.map(row => ({ ...row, expired: Boolean(row.expired) })) });
}
export async function readSermonDraft(db: D1Database, id: string) {
  adminSermonIdSchema.parse(id);
  const row = await db.prepare(`SELECT s.id sermonId,q.id quizSetId,s.youtube_url youtubeUrl,s.sermon_title title,
    s.sermon_date sermonDate,s.bible_reference_label referenceLabel,s.slug_suffix suffix
    FROM sermons s JOIN quiz_sets q ON q.sermon_id=s.id WHERE s.id=? AND ${unpublishedSermonGuard}`).bind(id).first();
  if (!row) throw new SermonDraftError("DRAFT_NOT_FOUND");
  const saved = await createSermonMetadataRepository(createDatabase(db)).read(id);
  return draftMetadataViewSchema.parse({ sermonId: id, quizSetId: row.quizSetId, youtubeUrl: row.youtubeUrl,
    title: saved?.title ?? row.title, sermonDate: saved?.sermonDate ?? row.sermonDate,
    metadataRevision: saved?.metadataRevision ?? null, bibleReference: saved?.bibleReference ?? null,
    referenceLabel: saved?.bibleReference.canonicalLabel ?? row.referenceLabel,
    slugPreview: `${saved?.sermonDate ?? row.sermonDate}-${row.suffix}` });
}
export async function saveSermonDraft(db: D1Database, id: string, raw: unknown) {
  adminSermonIdSchema.parse(id);
  const parsed = saveDraftMetadataSchema.safeParse(raw);
  if (!parsed.success) return invalid();
  const snapshot = metadata(id, parsed.data);
  const result = await createSermonMetadataRepository(createDatabase(db), db).save({ sermonId: id,
    expectedRevision: parsed.data.expectedRevision, title: snapshot.title, sermonDate: snapshot.sermonDate, bibleReference: snapshot.bibleReference });
  if (result.outcome === "conflict") throw new SermonDraftError("DRAFT_CONFLICT");
  return readSermonDraft(db, id);
}
