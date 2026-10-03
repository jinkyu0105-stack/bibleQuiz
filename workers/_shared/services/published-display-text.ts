import {
  displayTextRequestSchema, displayTextResultSchema, displayTextViewSchema,
  publishedMetadataListSchema, type PublishedMetadata,
} from "../../../shared/api/admin-display-text";
import { quizSetIdSchema } from "../../../shared/api/admin-finalization";
import { sha256Bytes } from "../storage/sha256";

export class SemanticCorrectionRequired extends Error {
  constructor() { super("SEMANTIC_CORRECTION_REQUIRED"); }
}
function rejectProblemChanges(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const record = raw as Record<string, unknown>;
  const forbidden = new Set(["summary", "clue", "clues", "answer", "answers", "grid", "entries", "solution", "solutions", "scoring", "bibleReferenceLabel"]);
  for (const value of [record, record.before, record.after]) {
    if (value && typeof value === "object" && Object.keys(value).some(key => forbidden.has(key))) throw new SemanticCorrectionRequired();
  }
}

const selection = `SELECT q.id quizSetId,coalesce(p.slug,s.slug) slug,q.status,
  coalesce(c.revision,0) revision,coalesce(CASE WHEN c.revision>coalesce(r.display_revision,-1) THEN c.title END,r.title,p.title,s.sermon_title) title,
  coalesce(CASE WHEN c.revision>coalesce(r.display_revision,-1) THEN c.sermon_date END,r.sermon_date,p.sermon_date,s.sermon_date) sermonDate,
  q.published_at publishedAt,q.closes_at closesAt
  FROM quiz_sets q JOIN sermons s ON s.id=q.sermon_id
  LEFT JOIN published_quiz_content p ON p.quiz_set_id=q.id
  LEFT JOIN quiz_content_versions r ON r.quiz_set_id=q.id AND r.revision=(SELECT max(revision) FROM quiz_content_versions WHERE quiz_set_id=q.id)
  LEFT JOIN published_display_corrections c ON c.quiz_set_id=q.id
    AND c.revision=(SELECT max(r.revision) FROM published_display_corrections r WHERE r.quiz_set_id=q.id)
  WHERE q.status IN ('published','archived')`;
type Row = Omit<PublishedMetadata, "metadata"> & { title: string; sermonDate: string };
function metadata({ title, sermonDate, ...rest }: Row) { return { ...rest, metadata: { title, sermonDate } }; }

export async function listPublishedMetadata(db: D1Database) {
  const rows = await db.prepare(`${selection} ORDER BY q.published_at DESC,q.id DESC`).all<Row>();
  return publishedMetadataListSchema.parse({ items: rows.results.map(metadata) });
}
export async function readPublishedDisplayText(db: D1Database, id: string) {
  quizSetIdSchema.parse(id);
  // One query gives metadata and history from the same D1 snapshot.
  const rows = await db.prepare(`SELECT current.*,h.revision historyRevision,h.before_title beforeTitle,
    h.before_sermon_date beforeDate,h.title afterTitle,h.sermon_date afterDate,h.reason,h.created_at createdAt
    FROM (${selection} AND q.id=?) current LEFT JOIN published_display_corrections h ON h.quiz_set_id=current.quizSetId
    ORDER BY h.revision DESC`).bind(id).all<Row & { historyRevision: number | null; beforeTitle: string; beforeDate: string;
      afterTitle: string; afterDate: string; reason: string; createdAt: string }>();
  const first = rows.results[0];
  if (!first) throw new Error("DISPLAY_TEXT_UNAVAILABLE");
  return displayTextViewSchema.parse({ quiz: metadata({ quizSetId: first.quizSetId, slug: first.slug, status: first.status,
    revision: first.revision, title: first.title, sermonDate: first.sermonDate, publishedAt: first.publishedAt, closesAt: first.closesAt }),
    history: rows.results.filter(row => row.historyRevision !== null).map(row => ({ revision: row.historyRevision,
      before: { title: row.beforeTitle, sermonDate: row.beforeDate }, after: { title: row.afterTitle, sermonDate: row.afterDate },
      reason: row.reason, createdAt: row.createdAt })) });
}

export async function correctPublishedDisplayText(db: D1Database, id: string, raw: unknown, actorEmail: string, now = new Date()) {
  quizSetIdSchema.parse(id);
  rejectProblemChanges(raw);
  const command = displayTextRequestSchema.parse(raw);
  const actor = await sha256Bytes(new TextEncoder().encode(actorEmail));
  const prior = await db.prepare(`SELECT revision,before_title beforeTitle,before_sermon_date beforeDate,title,sermon_date sermonDate,
    reason,actor_digest actor FROM published_display_corrections WHERE quiz_set_id=? AND request_key=?`).bind(id, command.requestKey)
    .first<{ revision: number; beforeTitle: string; beforeDate: string; title: string; sermonDate: string; reason: string; actor: string }>();
  if (prior) {
    if (prior.revision !== command.expectedRevision + 1 || prior.beforeTitle !== command.before.title || prior.beforeDate !== command.before.sermonDate ||
      prior.title !== command.after.title || prior.sermonDate !== command.after.sermonDate || prior.reason !== command.reason || prior.actor !== actor)
      throw new Error("DISPLAY_TEXT_CONFLICT");
    return displayTextResultSchema.parse({ outcome: "replayed", quizSetId: id, revision: prior.revision });
  }
  const revision = command.expectedRevision + 1, createdAt = now.toISOString();
  // The INSERT trigger compares revision and exact previous display values at commit time.
  // The audit and correction either both commit or both roll back; no protected row is updated.
  await db.batch([
    db.prepare(`INSERT INTO published_display_corrections(quiz_set_id,revision,request_key,before_title,before_sermon_date,
      title,sermon_date,reason,actor_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id, revision, command.requestKey,
      command.before.title, command.before.sermonDate, command.after.title, command.after.sermonDate, command.reason, actor, createdAt),
    db.prepare(`INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_type,actor_email,safe_metadata_json,created_at)
      VALUES(?,'quiz_set',?,'published_display_corrected','access_admin',?,?,?)`).bind(crypto.randomUUID(), id, actorEmail,
      JSON.stringify({ revision, before: command.before, after: command.after, reason: command.reason }), createdAt),
  ]);
  return displayTextResultSchema.parse({ outcome: "changed", quizSetId: id, revision });
}
