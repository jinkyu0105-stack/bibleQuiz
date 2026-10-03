import { sha256Bytes } from "../storage/sha256";

export async function planQuizRevisionCleanup(db: D1Database, sermonId: string, now: string) {
  const row = await db.prepare(`SELECT max(a.at) lastSavedAt,
    (SELECT count(*) FROM quiz_revision_sessions s JOIN quiz_sets q ON q.id=s.quiz_set_id
     WHERE q.sermon_id=? AND NOT EXISTS(SELECT 1 FROM quiz_revision_cleanup WHERE session_id=s.id)) remaining,
    EXISTS(SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id
     WHERE j.sermon_id=? AND r.state IN ('claimed','effect_started') AND r.lease_expires_at>?) activeCall
    FROM quiz_revision_activity a WHERE a.sermon_id=?`).bind(sermonId,sermonId,now,sermonId)
    .first<{ lastSavedAt: string | null; remaining: number; activeCall: number }>();
  if (!row?.lastSavedAt) return null;
  const dueAt = new Date(Date.parse(row.lastSavedAt)+7*86_400_000).toISOString();
  return { dueAt,purgedAt: row.remaining ? null : dueAt,blocked: row.activeCall ? "active_call" as const : null };
}
export async function purgeQuizRevisions(db: D1Database, sermonId: string, now: string, originalStatements: D1PreparedStatement[] = []) {
  const plan = await planQuizRevisionCleanup(db,sermonId,now);
  if (!plan) return null;
  if (plan.purgedAt) return { outcome: "replayed" as const };
  if (plan.blocked || plan.dueAt>now) return { outcome: "not_due" as const };
  const sessions = await db.prepare(`SELECT s.id,s.quiz_set_id quizSetId FROM quiz_revision_sessions s JOIN quiz_sets q ON q.id=s.quiz_set_id
    WHERE q.sermon_id=? AND NOT EXISTS(SELECT 1 FROM quiz_revision_cleanup WHERE session_id=s.id) ORDER BY s.cycle`).bind(sermonId).all<{ id: string; quizSetId: string }>();
  const statements: D1PreparedStatement[] = [], legacyIncluded = new Set<string>();
  for (const session of sessions.results) {
    const drafts = await db.prepare("SELECT revision,body_sha256 hash FROM quiz_revision_drafts WHERE session_id=? ORDER BY revision").bind(session.id).all<{ revision: number; hash: string }>();
    const legacy = legacyIncluded.has(session.quizSetId) ? [] : (await db.prepare(`SELECT revision,edits_json body FROM withdrawal_edit_revisions WHERE quiz_set_id=?
      AND NOT EXISTS(SELECT 1 FROM withdrawal_edit_cleanup WHERE quiz_set_id=?)`).bind(session.quizSetId,session.quizSetId).all<{ revision: number; body: string }>()).results;
    const hashes = { drafts: Object.fromEntries(drafts.results.map(d => [String(d.revision),d.hash])),
      legacy: Object.fromEntries(await Promise.all(legacy.map(async d => [String(d.revision),await sha256Bytes(new TextEncoder().encode(d.body))]))) };
    legacyIncluded.add(session.quizSetId);
    statements.push(db.prepare("INSERT INTO quiz_revision_cleanup(session_id,head_revision,due_at,purged_at,hashes_json) VALUES(?,?,?,?,?)")
      .bind(session.id,drafts.results.at(-1)?.revision ?? 0,plan.dueAt,now,JSON.stringify(hashes)));
  }
  statements.push(db.prepare(`INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_type,actor_email,safe_metadata_json,created_at)
    VALUES(?,'sermon',?,'quiz_revisions_purged','system',NULL,?,?)`).bind(crypto.randomUUID(),sermonId,JSON.stringify({ policy: "draft_7_days",dueAt: plan.dueAt,cycles: sessions.results.length }),now));
  try { await db.batch([...statements,...originalStatements]); }
  catch (error) {
    if ((await planQuizRevisionCleanup(db,sermonId,now))?.purgedAt) return { outcome: "replayed" as const };
    throw error;
  }
  return { outcome: "purged" as const };
}
