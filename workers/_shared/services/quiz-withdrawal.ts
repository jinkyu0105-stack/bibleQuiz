import { latestRevisionSession, hashRevision, revisionAudit, sourceToBody, draftStatement } from "./quiz-revision";
import { withdrawRequestSchema, withdrawResultSchema, withdrawalReviewSchema, withdrawalViewSchema, withdrawalListSchema } from "../../../shared/api/admin-withdraw";
import { quizSetIdSchema } from "../../../shared/api/admin-finalization";
import { sha256Bytes } from "../storage/sha256";

// Only permanent content is copied. No draft body, actor, AI provenance or participant data.
// SELECT executes inside the same INSERT statement that the commit-time guard checks.
export const reviewSource = `SELECT json_object(
  'metadata',json_object('title',coalesce(CASE WHEN c.revision>coalesce(r.display_revision,-1) THEN c.title END,r.title,p.title,s.sermon_title),'sermonDate',coalesce(CASE WHEN c.revision>coalesce(r.display_revision,-1) THEN c.sermon_date END,r.sermon_date,p.sermon_date,s.sermon_date)),
  'slug',coalesce(p.slug,s.slug),'summary',(SELECT text FROM quiz_wording_current WHERE quiz_set_id=q.id AND target='summary'),'disclosure',coalesce(r.disclosure,p.disclosure,s.ai_summary_disclosure),
  'churchName',coalesce(r.church_name,p.church_name,s.church_name),'bibleReferenceLabel',coalesce(r.bible_reference_label,p.bible_reference_label,s.bible_reference_label),
  'translation',coalesce(r.translation,p.translation,t.display_name),'bibleReadingUrl',coalesce(r.bible_reading_url,p.bible_reading_url,?),
  'variants',json((SELECT json_group_array(json_object(
    'sourceVariantId',v.id,'sourceRevision',v.revision,'difficulty',v.difficulty,'grid',json(v.public_grid_json),
    'entries',json((SELECT json_group_array(json_object('id',e.id,'number',e.number,'direction',e.direction,
      'startRow',e.start_row,'startCol',e.start_col,'length',e.length,'clue',coalesce((SELECT text FROM quiz_wording_current WHERE quiz_set_id=q.id AND target=e.id),e.clue),
      'grounding',json(e.transcript_evidence_json),'displayOrder',e.display_order)) FROM quiz_entries_public e WHERE e.quiz_variant_id=v.id)),
    'canonicalCellOrder',json(sol.canonical_cell_order_json),'solutionCells',json(sol.solution_cells_json),
    'entryAnswers',json(sol.entry_answers_json),'solutionSha256',sol.solution_sha256))
    FROM quiz_variants v JOIN quiz_solutions sol ON sol.quiz_variant_id=v.id WHERE v.quiz_set_id=q.id AND v.lifecycle_status='active'))
  ) body FROM quiz_sets q JOIN sermons s ON s.id=q.sermon_id JOIN bible_translations t ON t.id=s.bible_translation_id
  LEFT JOIN published_quiz_content p ON p.quiz_set_id=q.id
  LEFT JOIN quiz_content_versions r ON r.quiz_set_id=q.id AND r.revision=(SELECT max(revision) FROM quiz_content_versions WHERE quiz_set_id=q.id)
  LEFT JOIN published_display_corrections c ON c.quiz_set_id=q.id AND c.revision=(SELECT max(revision) FROM published_display_corrections WHERE quiz_set_id=q.id)
  WHERE q.id=?`;

export async function readWithdrawalReview(db: D1Database, id: string) {
  quizSetIdSchema.parse(id);
  const session = await latestRevisionSession(db,id);
  if (session) return withdrawalViewSchema.parse({ quizSetId: id,reviewRevision: session.reviewRevision,withdrawnAt: session.createdAt,reason: session.reason,review: JSON.parse(session.source) });
  const row = await db.prepare(`SELECT quiz_set_id quizSetId,review_revision reviewRevision,withdrawn_at withdrawnAt,reason,review_json body
    FROM quiz_withdrawals WHERE quiz_set_id=?`).bind(id).first<{ quizSetId: string; reviewRevision: number; withdrawnAt: string; reason: string; body: string }>();
  if (!row) throw new Error("WITHDRAWAL_UNAVAILABLE");
  const { body, ...rest } = row;
  return withdrawalViewSchema.parse({ ...rest, review: JSON.parse(body) });
}
export async function listWithdrawalReviews(db: D1Database) {
  const rows = await db.prepare(`SELECT w.quiz_set_id quizSetId,coalesce((SELECT review_revision FROM quiz_revision_sessions WHERE quiz_set_id=w.quiz_set_id ORDER BY cycle DESC LIMIT 1),w.review_revision) reviewRevision,coalesce((SELECT created_at FROM quiz_revision_sessions WHERE quiz_set_id=w.quiz_set_id ORDER BY cycle DESC LIMIT 1),w.withdrawn_at) withdrawnAt,
    coalesce((SELECT json_extract(source_json,'$.metadata.title') FROM quiz_revision_sessions WHERE quiz_set_id=w.quiz_set_id ORDER BY cycle DESC LIMIT 1),json_extract(w.review_json,'$.metadata.title')) title FROM quiz_withdrawals w JOIN quiz_sets q ON q.id=w.quiz_set_id
    WHERE q.status='review_ready' ORDER BY w.withdrawn_at DESC,w.quiz_set_id DESC`).all();
  return withdrawalListSchema.parse({ items: rows.results });
}
export async function withdrawPublishedQuiz(db: D1Database, id: string, raw: unknown, actorEmail: string, now = new Date()) {
  quizSetIdSchema.parse(id);
  const command = withdrawRequestSchema.parse(raw);
  const later = await db.prepare("SELECT 1 FROM quiz_republications WHERE quiz_set_id=? AND published_at=?").bind(id,command.expectedPublishedAt).first();
  if (later) return withdrawRepublishedQuiz(db,id,command,actorEmail,now);
  const actor = await sha256Bytes(new TextEncoder().encode(actorEmail));
  const prior = await db.prepare(`SELECT request_key requestKey,published_at publishedAt,display_revision displayRevision,
    reason,actor_digest actor,review_revision reviewRevision,withdrawn_at withdrawnAt FROM quiz_withdrawals WHERE quiz_set_id=?`).bind(id)
    .first<{ requestKey: string; publishedAt: string; displayRevision: number; reason: string; actor: string; reviewRevision: number; withdrawnAt: string }>();
  if (prior) {
    if (prior.requestKey !== command.requestKey || prior.publishedAt !== command.expectedPublishedAt ||
      prior.displayRevision !== command.expectedDisplayRevision || prior.reason !== command.reason || prior.actor !== actor) throw new Error("WITHDRAWAL_CONFLICT");
    return withdrawResultSchema.parse({ outcome: "replayed", quizSetId: id, reviewRevision: prior.reviewRevision, withdrawnAt: prior.withdrawnAt });
  }
  // Legacy public reads use this official reference-only landing URL as well.
  const readingUrl = "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE";
  const source = await db.prepare(reviewSource).bind(readingUrl, id).first<{ body: string }>();
  if (!source) throw new Error("WITHDRAWAL_UNAVAILABLE");
  withdrawalReviewSchema.parse(JSON.parse(source.body));
  const withdrawnAt = now.toISOString();
  await db.batch([
    db.prepare(`INSERT INTO quiz_withdrawals(quiz_set_id,request_key,published_at,display_revision,review_revision,review_json,reason,actor_digest,withdrawn_at)
      VALUES(?,?,?,?,(SELECT max(revision)+1 FROM quiz_variants WHERE quiz_set_id=?),(${reviewSource}),?,?,?)`)
      .bind(id, command.requestKey, command.expectedPublishedAt, command.expectedDisplayRevision, id, readingUrl, id, command.reason, actor, withdrawnAt),
    db.prepare(`INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_type,actor_email,safe_metadata_json,created_at)
      VALUES(?,'quiz_set',?,'publication_withdrawn','access_admin',?,?,?)`).bind(crypto.randomUUID(), id, actorEmail,
      JSON.stringify({ reason: command.reason, publishedAt: command.expectedPublishedAt, displayRevision: command.expectedDisplayRevision }), withdrawnAt),
  ]);
  const saved = await readWithdrawalReview(db, id);
  return withdrawResultSchema.parse({ outcome: "withdrawn", quizSetId: id, reviewRevision: saved.reviewRevision, withdrawnAt });
}

async function withdrawRepublishedQuiz(db: D1Database,id: string,command: ReturnType<typeof withdrawRequestSchema.parse>,actorEmail: string,now: Date) {
  const actor = await hashRevision(actorEmail), requestHash = await hashRevision(command);
  const prior = await db.prepare("SELECT quiz_set_id quizSetId,request_sha256 hash,actor_digest actor,review_revision reviewRevision,created_at withdrawnAt FROM quiz_revision_sessions WHERE id=?")
    .bind(command.requestKey).first<{ quizSetId: string; hash: string; actor: string; reviewRevision: number; withdrawnAt: string }>();
  if (prior) {
    if (prior.quizSetId!==id || prior.hash!==requestHash || prior.actor!==actor) throw new Error("WITHDRAWAL_CONFLICT");
    return withdrawResultSchema.parse({ outcome: "replayed",quizSetId:id,reviewRevision:prior.reviewRevision,withdrawnAt:prior.withdrawnAt });
  }
  const last = await latestRevisionSession(db,id), at=now.toISOString();
  const readingUrl="https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE";
  const source=await db.prepare(reviewSource).bind(readingUrl,id).first<{ body: string }>();
  if (!source || !last) throw new Error("WITHDRAWAL_CONFLICT");
  const body=sourceToBody(withdrawalReviewSchema.parse(JSON.parse(source.body)));
  await db.batch([
    db.prepare(`INSERT INTO quiz_revision_sessions(id,quiz_set_id,cycle,kind,review_revision,published_at,display_revision,source_json,request_sha256,actor_digest,reason,created_at)
      VALUES(?,?,?,'withdraw',(SELECT max(revision)+1 FROM quiz_variants WHERE quiz_set_id=?),?,?,(SELECT ? WHERE ?=(${reviewSource})),?,?,?,?)`)
      .bind(command.requestKey,id,last.cycle+1,id,command.expectedPublishedAt,command.expectedDisplayRevision,source.body,source.body,readingUrl,id,requestHash,actor,command.reason,at),
    draftStatement(db,command.requestKey,1,command.requestKey,requestHash,actor,"start",body,await hashRevision(body),at),
    revisionAudit(db,id,"publication_withdrawn",actorEmail,at,{ cycle: last.cycle+1,reason:command.reason }),
  ]);
  const saved=await readWithdrawalReview(db,id);
  return withdrawResultSchema.parse({ outcome:"withdrawn",quizSetId:id,reviewRevision:saved.reviewRevision,withdrawnAt:at });
}
