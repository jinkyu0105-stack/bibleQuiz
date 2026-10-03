import { z } from "zod";
import { sha256Bytes } from "../storage/sha256";
const timestamp = z.iso.datetime();
export class WithdrawalEditsExpired extends Error {
  constructor() { super("DRAFT_EXPIRED"); }
}
export async function planWithdrawalEditCleanup(db: D1Database, sermonId: string, now: string) {
  timestamp.parse(now);
  const row = await db.prepare(`SELECT q.id quizSetId,q.status,q.submission_state submissionState,
      max(e.revision) headRevision,max(e.created_at) lastSavedAt,c.purged_at purgedAt,
      EXISTS(SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id
        WHERE j.sermon_id=q.sermon_id AND r.state IN ('claimed','effect_started') AND r.lease_expires_at>?) activeCall
    FROM quiz_sets q JOIN quiz_withdrawals w ON w.quiz_set_id=q.id JOIN withdrawal_edit_revisions e ON e.quiz_set_id=q.id
    LEFT JOIN withdrawal_edit_cleanup c ON c.quiz_set_id=q.id WHERE q.sermon_id=? GROUP BY q.id`)
    .bind(now, sermonId).first<{ quizSetId: string; status: string; submissionState: string; headRevision: number; lastSavedAt: string; purgedAt: string | null; activeCall: number }>();
  if (!row) return null;
  const dueAt = new Date(Date.parse(timestamp.parse(row.lastSavedAt)) + 7 * 86_400_000).toISOString();
  const blocked = row.status !== "review_ready" || row.submissionState !== "paused" ? "publication_missing" as const
    : row.activeCall ? "active_call" as const : null;
  return { ...row, dueAt, blocked };
}
/** Existing daily cleanup calls this only for the new withdrawal editing work. */
export async function purgeWithdrawalEdits(db: D1Database, sermonId: string, now: string) {
  const plan = await planWithdrawalEditCleanup(db, sermonId, now);
  if (!plan) return null;
  if (plan.purgedAt) return { outcome: "replayed" as const };
  if (plan.blocked || plan.dueAt > now) return { outcome: "not_due" as const };
  const rows = await db.prepare("SELECT revision,edits_json body FROM withdrawal_edit_revisions WHERE quiz_set_id=? ORDER BY revision")
    .bind(plan.quizSetId).all<{ revision: number; body: string }>();
  const hashes = Object.fromEntries(await Promise.all(rows.results.map(async row => [String(row.revision), await sha256Bytes(new TextEncoder().encode(row.body))])));
  try {
    await db.batch([
      db.prepare("INSERT INTO withdrawal_edit_cleanup(quiz_set_id,head_revision,last_saved_at,due_at,purged_at,payload_hashes_json) VALUES(?,?,?,?,?,?)")
        .bind(plan.quizSetId, plan.headRevision, plan.lastSavedAt, plan.dueAt, now, JSON.stringify(hashes)),
      db.prepare(`INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_type,actor_email,safe_metadata_json,created_at)
        VALUES(?,'quiz_set',?,'withdrawal_edits_purged','system',NULL,?,?)`).bind(`withdrawal-cleanup-${plan.quizSetId}`, plan.quizSetId,
          JSON.stringify({ policy: "draft_7_days", dueAt: plan.dueAt, headRevision: plan.headRevision }), now),
    ]);
    return { outcome: "purged" as const };
  } catch (error) {
    if (await db.prepare("SELECT 1 FROM withdrawal_edit_cleanup WHERE quiz_set_id=?").bind(plan.quizSetId).first()) return { outcome: "replayed" as const };
    throw error;
  }
}
