import { weeklyDashboardSchema, submissionListSchema, winnerSettingsSchema, winnerSettingsRequestSchema,
  policyCreateSchema, policyPatchSchema, policyListSchema, policyTestSchema, policyTestResultSchema } from "../../../shared/api/admin-weekly";
import { privacyAdminListSchema, privacyReplySchema } from "../../../shared/api/privacy";
import { listPublishedMetadata } from "./published-display-text";
import { createDatabase } from "../db/client";
import { createModerationPolicyRepository } from "../repositories/moderation-policy-repository";
import { inspectSubmissionField, normalizeModerationValue, normalizeReservedName } from "./content-moderation";

export class WeeklyError extends Error {
  constructor(readonly code: "INVALID" | "CONFLICT" | "NOT_FOUND" | "LOCKED") { super(code); }
}
export function auditStatement(db: D1Database, entity: string, id: string, action: string, actor: string, at: string, metadata: unknown = {}) {
  return db.prepare("INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_type,actor_email,safe_metadata_json,created_at) VALUES(?,?,?,?,'access_admin',?,?,?)")
    .bind(crypto.randomUUID(), entity, id, action, actor, JSON.stringify(metadata), at);
}
export async function readWeeklyDashboard(db: D1Database) {
  const [quizzes, counts] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT q.id quizSetId,q.sermon_id sermonId,coalesce(m.title,s.sermon_title) title,
      coalesce(m.sermon_date,s.sermon_date) sermonDate,coalesce(p.slug,s.slug) slug,q.status,q.submission_state submissionStatus,
      q.closes_at closesAt,max(q.updated_at,
      coalesce((SELECT updated_at FROM draft_activity WHERE sermon_id=s.id),''),
      coalesce((SELECT max(updated_at) FROM generation_jobs WHERE quiz_set_id=q.id),'')) updatedAt,(q.id=(SELECT value FROM site_state WHERE key='featured_quiz_set_id')) featured,
      (q.status='review_ready' AND EXISTS(SELECT 1 FROM quiz_withdrawals WHERE quiz_set_id=q.id)) withdrawn,
      EXISTS(SELECT 1 FROM draft_cleanup_records WHERE sermon_id=s.id) expired,
      (SELECT current_step FROM generation_jobs WHERE quiz_set_id=q.id ORDER BY created_at DESC,id DESC LIMIT 1) stage,
      (SELECT status FROM generation_jobs WHERE quiz_set_id=q.id ORDER BY created_at DESC,id DESC LIMIT 1) jobStatus,
      (SELECT count(*) FROM submissions sub JOIN quiz_variants v ON v.id=sub.quiz_variant_id WHERE v.quiz_set_id=q.id AND sub.status='visible' AND v.lifecycle_status='active' AND v.results_status='valid') visibleCount,
      (SELECT count(*) FROM submissions sub JOIN quiz_variants v ON v.id=sub.quiz_variant_id WHERE v.quiz_set_id=q.id AND v.difficulty='child' AND sub.status='visible' AND v.lifecycle_status='active' AND v.results_status='valid') childVisibleCount,
      (SELECT count(*) FROM submissions sub JOIN quiz_variants v ON v.id=sub.quiz_variant_id WHERE v.quiz_set_id=q.id AND v.difficulty='adult' AND sub.status='visible' AND v.lifecycle_status='active' AND v.results_status='valid') adultVisibleCount,
      coalesce((SELECT winner_count FROM quiz_variants WHERE quiz_set_id=q.id AND difficulty='child' ORDER BY revision DESC LIMIT 1),(SELECT cast(value AS integer) FROM site_state WHERE key='top-n/'||q.id||'/child'),3) childWinnerCount,
      coalesce((SELECT winner_count FROM quiz_variants WHERE quiz_set_id=q.id AND difficulty='adult' ORDER BY revision DESC LIMIT 1),(SELECT cast(value AS integer) FROM site_state WHERE key='top-n/'||q.id||'/adult'),3) adultWinnerCount,
      (SELECT count(*) FROM submissions sub JOIN quiz_variants v ON v.id=sub.quiz_variant_id WHERE v.quiz_set_id=q.id) totalCount
      FROM quiz_sets q JOIN sermons s ON s.id=q.sermon_id LEFT JOIN sermon_metadata_drafts m ON m.sermon_id=s.id
      LEFT JOIN published_quiz_content p ON p.quiz_set_id=q.id ORDER BY updatedAt DESC,q.id DESC`),
    db.prepare("SELECT count(*) n FROM privacy_requests WHERE status IN ('received','reviewing')"),
  ]);
  const published = (await listPublishedMetadata(db)).items;
  return weeklyDashboardSchema.parse({ items: quizzes!.results.map(r => {
    const display = published.find(q => q.quizSetId === r.quizSetId)?.metadata;
    return { ...r, ...(display ? {title: display.title, sermonDate: display.sermonDate} : {}), featured: !!r.featured, withdrawn: !!r.withdrawn, expired: !!r.expired };
  }), unansweredCount: counts!.results[0]?.n ?? 0 });
}
export async function listAdminSubmissions(db: D1Database, quizSetId: string) {
  const rows = await db.prepare(`SELECT s.id,v.difficulty,v.revision,s.status,s.display_name displayName,s.comment,s.submitted_at submittedAt,
    s.score_basis_points/100.0 scorePercent,s.answers_json answers FROM submissions s JOIN quiz_variants v ON v.id=s.quiz_variant_id
    WHERE v.quiz_set_id=? ORDER BY s.submitted_at,s.id`).bind(quizSetId).all();
  const actions = await db.prepare(`SELECT a.submission_id submissionId,a.action,a.reason,a.created_at createdAt
    FROM moderation_actions a JOIN submissions s ON s.id=a.submission_id JOIN quiz_variants v ON v.id=s.quiz_variant_id
    WHERE v.quiz_set_id=? ORDER BY a.created_at,a.id`).bind(quizSetId).all();
  return submissionListSchema.parse({ items: rows.results.map(r => ({ ...r, answers: r.status === "deleted" ? null : JSON.parse(String(r.answers)),
    actions: actions.results.filter(a => a.submissionId === r.id).map(({ action, reason, createdAt }) => ({ action, reason, createdAt })) })) });
}
const winnerKey = (id: string, level: string) => `top-n/${id}/${level}`;
export async function readWinnerSettings(db: D1Database, id: string) {
  const row = await db.prepare(`SELECT q.status,q.closes_at,
    EXISTS(SELECT 1 FROM leaderboard_snapshots l JOIN quiz_variants v ON v.id=l.quiz_variant_id WHERE v.quiz_set_id=q.id) frozen,
    coalesce((SELECT winner_count FROM quiz_variants WHERE quiz_set_id=q.id AND difficulty='child' AND lifecycle_status='active'),
      (SELECT cast(value as integer) FROM site_state WHERE key=?),(SELECT winner_count FROM quiz_variants WHERE quiz_set_id=q.id AND difficulty='child' ORDER BY revision DESC LIMIT 1),3) child,
    coalesce((SELECT winner_count FROM quiz_variants WHERE quiz_set_id=q.id AND difficulty='adult' AND lifecycle_status='active'),
      (SELECT cast(value as integer) FROM site_state WHERE key=?),(SELECT winner_count FROM quiz_variants WHERE quiz_set_id=q.id AND difficulty='adult' ORDER BY revision DESC LIMIT 1),3) adult,
    coalesce((SELECT updated_at FROM site_state WHERE key=?),'') settingsAt
    FROM quiz_sets q WHERE q.id=?`).bind(winnerKey(id,"child"),winnerKey(id,"adult"),winnerKey(id,"revision"),id).first();
  if (!row) throw new WeeklyError("NOT_FOUND");
  const editable = row.status !== "archived" && !row.frozen && (!row.closes_at || String(row.closes_at) > new Date().toISOString());
  return winnerSettingsSchema.parse({ child: row.child, adult: row.adult, editable, revision: JSON.stringify([row.status,row.closes_at,row.child,row.adult,row.settingsAt]) });
}
export async function saveWinnerSettings(db: D1Database, id: string, raw: unknown, actor: string) {
  const command = winnerSettingsRequestSchema.parse(raw), current = await readWinnerSettings(db,id);
  if (!current.editable) throw new WeeklyError("LOCKED");
  if (command.expectedRevision !== current.revision) throw new WeeklyError("CONFLICT");
  const [status, deadline, , , settingsAt] = JSON.parse(current.revision) as [string,string|null,number,number,string];
  const at = nextTimestamp(settingsAt), auditId = crypto.randomUUID();
  // Exact settings + current period + absence of finalized rankings are checked again in the transaction.
  const guard = `EXISTS(SELECT 1 FROM quiz_sets q WHERE q.id=? AND q.status=? AND q.closes_at IS ? AND (q.closes_at IS NULL OR q.closes_at>?)
    AND NOT EXISTS(SELECT 1 FROM leaderboard_snapshots l JOIN quiz_variants v ON v.id=l.quiz_variant_id WHERE v.quiz_set_id=q.id)
    AND coalesce((SELECT winner_count FROM quiz_variants WHERE quiz_set_id=q.id AND difficulty='child' AND lifecycle_status='active'),(SELECT cast(value as integer) FROM site_state WHERE key=?),(SELECT winner_count FROM quiz_variants WHERE quiz_set_id=q.id AND difficulty='child' ORDER BY revision DESC LIMIT 1),3)=?
    AND coalesce((SELECT winner_count FROM quiz_variants WHERE quiz_set_id=q.id AND difficulty='adult' AND lifecycle_status='active'),(SELECT cast(value as integer) FROM site_state WHERE key=?),(SELECT winner_count FROM quiz_variants WHERE quiz_set_id=q.id AND difficulty='adult' ORDER BY revision DESC LIMIT 1),3)=?
    AND coalesce((SELECT updated_at FROM site_state WHERE key=?),'')=?)`;
  const results = await db.batch([
    db.prepare(`INSERT INTO audit_logs SELECT ?,'quiz_set',?,'winner_count_changed','access_admin',?,?,? WHERE ${guard}`)
      .bind(auditId,id,actor,JSON.stringify({child:command.child,adult:command.adult,reason:command.reason}),at,id,status,deadline,at,winnerKey(id,"child"),current.child,winnerKey(id,"adult"),current.adult,winnerKey(id,"revision"),settingsAt),
    ...(["child","adult"] as const).flatMap(level => [
      db.prepare(`INSERT INTO site_state(key,value,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM audit_logs WHERE id=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
        .bind(winnerKey(id,level),String(command[level]),at,auditId),
      db.prepare(`UPDATE quiz_variants SET winner_count=? WHERE quiz_set_id=? AND difficulty=? AND lifecycle_status='active' AND EXISTS(SELECT 1 FROM audit_logs WHERE id=?)`).bind(command[level],id,level,auditId),
    ]),
    db.prepare(`INSERT INTO site_state(key,value,updated_at) SELECT ?,'1',? WHERE EXISTS(SELECT 1 FROM audit_logs WHERE id=?) ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at`).bind(winnerKey(id,"revision"),at,auditId),
  ]);
  if (results[0]!.meta.changes !== 1) throw new WeeklyError("CONFLICT");
  return readWinnerSettings(db,id);
}
const nextTimestamp = (previous: string) => new Date(Math.max(Date.now(), Date.parse(previous) + 1 || 0)).toISOString();
export const policyTables = { reserved: "reserved_names", term: "moderation_terms", exception: "moderation_exceptions" } as const;
export async function listAdminPolicy(db: D1Database) {
  const rows = await db.prepare(`SELECT id,'reserved' kind,protected_group_id groupId,display_label label,normalized_value value,'name' scope,'exact' matchMode,enabled,updated_at updatedAt FROM reserved_names
    UNION ALL SELECT id,'term',NULL,normalized_pattern,normalized_pattern,scope,match_mode,enabled,updated_at FROM moderation_terms
    UNION ALL SELECT id,'exception',NULL,reason,normalized_value,scope,'exact',enabled,updated_at FROM moderation_exceptions ORDER BY kind,label,id`).all();
  return policyListSchema.parse({items:rows.results.map(row=>({...row,enabled:!!row.enabled}))});
}
export async function createAdminPolicy(db: D1Database, raw: unknown, actor: string) {
  const command=policyCreateSchema.parse(raw), at=new Date().toISOString(), id=crypto.randomUUID();
  const statements: D1PreparedStatement[]=[];
  if(command.kind==='reserved') {
    const normalized=[...new Set(command.aliases.map(normalizeReservedName))];
    if(normalized.some(v=>!v)) throw new WeeklyError('INVALID');
    for(const [index,value] of normalized.entries()) statements.push(db.prepare(`INSERT INTO reserved_names(id,protected_group_id,display_label,normalized_value,category,enabled,created_by,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)`)
      .bind(index===0?id:crypto.randomUUID(),id,command.label,value,index===0?'person':'alias',actor,at,at));
  } else {
    const value=normalizeModerationValue(command.value); if(!value) throw new WeeklyError('INVALID');
    statements.push(command.kind==='term'
      ? db.prepare(`INSERT INTO moderation_terms(id,scope,normalized_pattern,match_mode,enabled,created_by,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?)`).bind(id,command.scope,value,command.matchMode,actor,at,at)
      : db.prepare(`INSERT INTO moderation_exceptions(id,scope,normalized_value,reason,enabled,created_by,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?)`).bind(id,command.scope,value,command.reason,actor,at,at));
  }
  statements.push(auditStatement(db,'moderation_policy',id,'policy_created',actor,at,{kind:command.kind}));
  await db.batch(statements); return listAdminPolicy(db);
}
export async function patchAdminPolicy(db:D1Database,kind:keyof typeof policyTables,id:string,raw:unknown,actor:string) {
  const command=policyPatchSchema.parse(raw),table=policyTables[kind],at=nextTimestamp(command.expectedUpdatedAt),auditId=crypto.randomUUID();
  const column=kind==='term'?'normalized_pattern':'normalized_value';
  const value=command.value===undefined?null:(kind==='reserved'?normalizeReservedName(command.value):normalizeModerationValue(command.value));
  if(value==='') throw new WeeklyError('INVALID');
  const results=await db.batch([
    db.prepare(`INSERT INTO audit_logs SELECT ?,'moderation_policy',?,'policy_changed','access_admin',?,?,? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND updated_at=?)`)
      .bind(auditId,id,actor,JSON.stringify({kind,enabled:command.enabled,reason:command.reason}),at,id,command.expectedUpdatedAt),
    db.prepare(`UPDATE ${table} SET enabled=?,${column}=coalesce(?,${column}),updated_at=? WHERE id=? AND updated_at=? AND EXISTS(SELECT 1 FROM audit_logs WHERE id=?)`)
      .bind(Number(command.enabled),value,at,id,command.expectedUpdatedAt,auditId),
  ]);
  if(results[1]!.meta.changes!==1) throw new WeeklyError('CONFLICT');
  return listAdminPolicy(db);
}
export async function testAdminPolicy(db:D1Database,raw:unknown) {
  const command=policyTestSchema.parse(raw),policy=await createModerationPolicyRepository(createDatabase(db)).loadActivePolicy();
  const result=inspectSubmissionField(command.scope,command.value,policy);
  return policyTestResultSchema.parse({...result,matchedRuleId:result.matchedRuleId??null});
}
export async function listPrivacyRequests(db:D1Database) {
  const rows=await db.prepare(`SELECT id,request_type requestType,quiz_slug quizSlug,submitted_name submittedName,message,status,admin_response adminResponse,created_at createdAt,updated_at updatedAt FROM privacy_requests ORDER BY created_at DESC,id DESC`).all();
  return privacyAdminListSchema.parse({items:rows.results});
}
export async function replyPrivacyRequest(db:D1Database,id:string,raw:unknown,actor:string) {
  const command=privacyReplySchema.parse(raw),at=nextTimestamp(command.expectedUpdatedAt),auditId=crypto.randomUUID();
  const results=await db.batch([
    db.prepare(`INSERT INTO audit_logs SELECT ?,'privacy_request',?,'privacy_request_updated','access_admin',?,?,? WHERE EXISTS(SELECT 1 FROM privacy_requests WHERE id=? AND updated_at=?)`)
      .bind(auditId,id,actor,JSON.stringify({status:command.status}),at,id,command.expectedUpdatedAt),
    db.prepare(`UPDATE privacy_requests SET status=?,admin_response=?,updated_at=?,resolved_by=?,resolved_at=? WHERE id=? AND updated_at=? AND EXISTS(SELECT 1 FROM audit_logs WHERE id=?)`)
      .bind(command.status,command.adminResponse||null,at,['resolved','rejected'].includes(command.status)?actor:null,['resolved','rejected'].includes(command.status)?at:null,id,command.expectedUpdatedAt,auditId),
  ]);
  if(results[1]!.meta.changes!==1) throw new WeeklyError('CONFLICT');
  return listPrivacyRequests(db);
}
