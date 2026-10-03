import { WithdrawalEditsExpired } from "./withdrawal-edit-cleanup";
import { z } from "zod";
import { quizSetIdSchema } from "../../../shared/api/admin-finalization";
import { withdrawalViewSchema } from "../../../shared/api/admin-withdraw";
import { withdrawalEditsSchema, withdrawalEditSaveRequestSchema, withdrawalEditViewSchema, withdrawalEditSaveResultSchema } from "../../../shared/api/admin-withdrawal-preview";
import { sha256Bytes } from "../storage/sha256";

type Edits = z.infer<typeof withdrawalEditsSchema>;
export function mergeWithdrawalEdits(prior: Edits, changes: Edits): Edits {
  const key = (edit: Edits[number]) => `${edit.difficulty}:${edit.entryId}`;
  const merged = new Map(prior.map(edit => [key(edit), edit]));
  for (const edit of changes) merged.set(key(edit), { ...merged.get(key(edit)), ...edit });
  return withdrawalEditsSchema.parse([...merged.values()].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** One statement reads the immutable source and its latest edit head together. */
export async function readEditableWithdrawal(db: D1Database, id: string) {
  quizSetIdSchema.parse(id);
  const row = await db.prepare(`SELECT w.review_revision reviewRevision,w.withdrawn_at withdrawnAt,w.reason,w.review_json body,
      (SELECT purged_at FROM withdrawal_edit_cleanup WHERE quiz_set_id=q.id) purgedAt,coalesce(e.revision,0) editRevision,e.created_at savedAt,coalesce(e.edits_json,'[]') edits
    FROM quiz_withdrawals w JOIN quiz_sets q ON q.id=w.quiz_set_id
    LEFT JOIN withdrawal_edit_revisions e ON e.quiz_set_id=w.quiz_set_id
      AND e.revision=(SELECT max(revision) FROM withdrawal_edit_revisions WHERE quiz_set_id=w.quiz_set_id)
    WHERE q.id=? AND NOT EXISTS(SELECT 1 FROM quiz_revision_sessions WHERE quiz_set_id=q.id) AND q.status='review_ready' AND q.submission_state='paused'
      AND NOT EXISTS(SELECT 1 FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status!='withdrawn')
      AND NOT EXISTS(SELECT 1 FROM submissions s JOIN quiz_variants v ON v.id=s.quiz_variant_id WHERE v.quiz_set_id=q.id)`)
    .bind(id).first<{ reviewRevision: number; withdrawnAt: string; reason: string; body: string; purgedAt: string | null; editRevision: number; savedAt: string | null; edits: string }>();
  if (!row) throw new Error("WITHDRAWAL_EDITS_UNAVAILABLE");
  if (row.purgedAt) throw new WithdrawalEditsExpired();
  const source = withdrawalViewSchema.parse({ quizSetId: id, reviewRevision: row.reviewRevision, withdrawnAt: row.withdrawnAt, reason: row.reason, review: JSON.parse(row.body) });
  const current = withdrawalEditViewSchema.parse({ quizSetId: id, reviewRevision: row.reviewRevision, editRevision: row.editRevision,
    savedAt: row.savedAt, edits: JSON.parse(row.edits), requiresHumanReview: true });
  return { source, current };
}
export async function readWithdrawalEdits(db: D1Database, id: string) {
  return (await readEditableWithdrawal(db, id)).current;
}
export function assertWithdrawalEditTargets(source: Awaited<ReturnType<typeof readEditableWithdrawal>>["source"], edits: Edits) {
  if (edits.some(edit => !source.review.variants.some(variant => variant.difficulty === edit.difficulty && variant.entries.some(entry => entry.id === edit.entryId)))) {
    throw new Error("WITHDRAWAL_EDIT_INVALID_TARGET");
  }
}

/** Save an unfinished edit, even if its layout needs repair. No approval or publication side effect. */
export async function saveWithdrawalEdits(db: D1Database, id: string, raw: unknown, actorEmail: string, now = new Date()) {
  quizSetIdSchema.parse(id);
  const command = withdrawalEditSaveRequestSchema.parse(raw);
  if (await db.prepare("SELECT 1 FROM withdrawal_edit_cleanup WHERE quiz_set_id=?").bind(id).first()) throw new WithdrawalEditsExpired();
  const digest = (value: string) => sha256Bytes(new TextEncoder().encode(value));
  const actor = await digest(actorEmail);
  const requestHash = await digest(JSON.stringify({ ...command, edits: mergeWithdrawalEdits([], command.edits) }));
  const prior = await db.prepare(`SELECT (SELECT purged_at FROM withdrawal_edit_cleanup WHERE quiz_set_id=withdrawal_edit_revisions.quiz_set_id) purgedAt,revision,review_revision reviewRevision,request_sha256 requestHash,actor_digest actor,edits_json edits,created_at savedAt
    FROM withdrawal_edit_revisions WHERE quiz_set_id=? AND request_key=?`).bind(id, command.requestKey)
    .first<{ purgedAt: string | null; revision: number; reviewRevision: number; requestHash: string; actor: string; edits: string; savedAt: string }>();
  if (prior) {
    if (prior.purgedAt) throw new WithdrawalEditsExpired();
    if (prior.requestHash !== requestHash || prior.actor !== actor) throw new Error("WITHDRAWAL_EDIT_CONFLICT");
    return withdrawalEditSaveResultSchema.parse({ outcome: "replayed", revision: { quizSetId: id, reviewRevision: prior.reviewRevision,
      editRevision: prior.revision, savedAt: prior.savedAt, edits: JSON.parse(prior.edits), requiresHumanReview: true } });
  }
  const { source, current } = await readEditableWithdrawal(db, id);
  if (current.editRevision !== command.expectedEditRevision || source.reviewRevision !== command.expectedReviewRevision) throw new Error("WITHDRAWAL_EDIT_CONFLICT");
  assertWithdrawalEditTargets(source, command.edits);
  const edits = mergeWithdrawalEdits(current.edits, command.edits), revision = current.editRevision + 1, savedAt = now.toISOString();
  await db.batch([
    db.prepare(`INSERT INTO withdrawal_edit_revisions(quiz_set_id,revision,review_revision,request_key,request_sha256,edits_json,actor_digest,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(id, revision, source.reviewRevision, command.requestKey, requestHash, JSON.stringify(edits), actor, savedAt),
    db.prepare(`INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_type,actor_email,safe_metadata_json,created_at)
      VALUES(?,'quiz_set',?,'withdrawal_edit_saved','access_admin',?,?,?)`).bind(crypto.randomUUID(), id, actorEmail,
        JSON.stringify({ reviewRevision: source.reviewRevision, editRevision: revision }), savedAt),
  ]);
  return withdrawalEditSaveResultSchema.parse({ outcome: "saved", revision: { quizSetId: id, reviewRevision: source.reviewRevision,
    editRevision: revision, savedAt, edits, requiresHumanReview: true } });
}
