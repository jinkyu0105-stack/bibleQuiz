import { wordingRequestSchema, wordingViewSchema } from "../../../shared/api/admin-wording";
import { displayTextResultSchema } from "../../../shared/api/admin-display-text";
import { quizSetIdSchema } from "../../../shared/api/admin-finalization";
import { sha256Bytes } from "../storage/sha256";
import { SemanticCorrectionRequired } from "./published-display-text";

export async function readPublishedWording(db: D1Database, id: string) {
  quizSetIdSchema.parse(id);
  // Head, targets and history are read in a single snapshot.
  const row = await db.prepare(`SELECT q.id quizSetId,
    (SELECT coalesce(max(revision),0) FROM published_wording_corrections WHERE quiz_set_id=q.id) revision,
    (SELECT coalesce(max(revision),0) FROM quiz_content_versions WHERE quiz_set_id=q.id) contentRevision,
    EXISTS(SELECT 1 FROM quiz_problem_cases c WHERE c.quiz_set_id=q.id AND c.cycle=(SELECT max(cycle) FROM quiz_problem_cases WHERE quiz_set_id=q.id)
      AND NOT EXISTS(SELECT 1 FROM quiz_problem_outcomes o WHERE o.case_id=c.id)) blocked,
    (SELECT json_group_array(json_object('target',target,'kind',kind,'difficulty',difficulty,'number',number,'direction',direction,'text',text))
      FROM (SELECT * FROM quiz_wording_current WHERE quiz_set_id=q.id AND text IS NOT NULL ORDER BY kind DESC,difficulty,number,direction)) targets,
    (SELECT json_group_array(json_object('revision',revision,'target',target,'before',before_text,'after',after_text,'reason',reason,'createdAt',created_at))
      FROM (SELECT * FROM published_wording_corrections WHERE quiz_set_id=q.id ORDER BY revision DESC)) history
    FROM quiz_sets q WHERE q.id=? AND q.status IN ('published','archived')`).bind(id)
    .first<{ quizSetId: string; revision: number; contentRevision: number; blocked: number; targets: string; history: string }>();
  if (!row) throw new Error("DISPLAY_TEXT_UNAVAILABLE");
  return wordingViewSchema.parse({ ...row, blocked: Boolean(row.blocked), targets: JSON.parse(row.targets), history: JSON.parse(row.history) });
}

export async function correctPublishedWording(db: D1Database, id: string, raw: unknown, actorEmail: string, now = new Date()) {
  quizSetIdSchema.parse(id);
  const fields = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  // Humans determine meaning. No edit-distance/AI heuristic certifies a semantic change as safe.
  if (fields.assessment !== "non_semantic_typo" || fields.confirmation !== "meaning_and_answer_unchanged" ||
    ["answer", "answers", "grid", "entries", "solution", "solutions", "scoring"].some(key => key in fields)) throw new SemanticCorrectionRequired();
  const command = wordingRequestSchema.parse(raw);
  const actor = await sha256Bytes(new TextEncoder().encode(actorEmail));
  const prior = await db.prepare(`SELECT revision,content_revision,target,before_text,after_text,assessment,confirmation,reason,actor_digest
    FROM published_wording_corrections WHERE quiz_set_id=? AND request_key=?`).bind(id, command.requestKey)
    .first<{ revision: number; content_revision: number; target: string; before_text: string; after_text: string; assessment: string; confirmation: string; reason: string; actor_digest: string }>();
  if (prior) {
    if (prior.revision !== command.expectedRevision + 1 || prior.content_revision !== command.contentRevision || prior.target !== command.target ||
      prior.before_text !== command.before || prior.after_text !== command.after || prior.reason !== command.reason || prior.actor_digest !== actor ||
      prior.assessment !== command.assessment || prior.confirmation !== command.confirmation) throw new Error("DISPLAY_TEXT_CONFLICT");
    return displayTextResultSchema.parse({ outcome: "replayed", quizSetId: id, revision: prior.revision });
  }
  const revision = command.expectedRevision + 1, at = now.toISOString();
  await db.batch([
    db.prepare(`INSERT INTO published_wording_corrections(quiz_set_id,revision,request_key,content_revision,target,before_text,after_text,
      assessment,confirmation,reason,actor_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, revision, command.requestKey,
      command.contentRevision, command.target, command.before, command.after, command.assessment, command.confirmation, command.reason, actor, at),
    db.prepare(`INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_type,actor_email,safe_metadata_json,created_at)
      VALUES(?,'quiz_set',?,'published_wording_corrected','access_admin',?,?,?)`).bind(crypto.randomUUID(), id, actorEmail,
      JSON.stringify({ revision, target: command.target, before: command.before, after: command.after, assessment: command.assessment,
        confirmation: command.confirmation, reason: command.reason }), at),
  ]);
  return displayTextResultSchema.parse({ outcome: "changed", quizSetId: id, revision });
}
