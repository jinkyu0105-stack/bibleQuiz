import { planProblemCleanup,problemCleanupStatements } from "./problem-cleanup";
import { planQuizRevisionCleanup, purgeQuizRevisions } from "./quiz-revision-cleanup";
import { planWithdrawalEditCleanup, purgeWithdrawalEdits } from "./withdrawal-edit-cleanup";
import { z } from "zod";
import { draftCleanupListSchema, type DraftCleanupList } from "../../../shared/api/admin-draft-cleanup";
import { createSermonInputStore } from "../repositories/sermon-input-store";
import { createSermonHistoryReader } from "../repositories/sermon-history-reader";
import { transcriptSourcePayloadSchema, type TranscriptSourcePayload } from "./transcript-input-contract";
import { hash } from "./transcript-content";

const DAY = 86_400_000;
// One stable SQL value covers every mutable authority used by cleanup, including
// publication, source policy and in-flight calls. Compare it again inside batch.
const basisSql = `SELECT json_object(
 'sermon',json_array(s.id,s.updated_at),
 'hasDrafts',(EXISTS(SELECT 1 FROM sermon_input_events WHERE sermon_id=s.id AND kind NOT IN ('source','confirm'))
   OR EXISTS(SELECT 1 FROM sermon_content_events WHERE sermon_id=s.id)
   OR EXISTS(SELECT 1 FROM generation_contexts WHERE sermon_id=s.id)
   OR EXISTS(SELECT 1 FROM sermon_history_records WHERE sermon_id=s.id AND stream NOT IN ('sources','confirmations') AND NOT(stream='revisions' AND commit_slot=1))
   OR (EXISTS(SELECT 1 FROM sermon_transcripts WHERE sermon_id=s.id AND retention_mode='delete_text_after_publish')
     AND EXISTS(SELECT 1 FROM quiz_sets WHERE sermon_id=s.id AND published_at IS NOT NULL))),
 'input',coalesce((SELECT version FROM sermon_input_heads WHERE sermon_id=s.id),0),
 'content',coalesce((SELECT event_count FROM sermon_content_heads WHERE sermon_id=s.id),0),
 'history',coalesce((SELECT version FROM sermon_history_heads WHERE sermon_id=s.id),0),
 'metadata',coalesce((SELECT metadata_revision FROM sermon_metadata_drafts WHERE sermon_id=s.id),0),
 'activityAt',(SELECT updated_at FROM draft_activity WHERE sermon_id=s.id),
 'inputAt',(SELECT max(created_at) FROM sermon_input_events WHERE sermon_id=s.id),
 'contentAt',(SELECT max(created_at) FROM sermon_content_events WHERE sermon_id=s.id),
 'qualityCount',(SELECT count(*) FROM sermon_content_quality_reviews WHERE sermon_id=s.id),
 'qualityAt',(SELECT max(created_at) FROM sermon_content_quality_reviews WHERE sermon_id=s.id),
 'quizzes',(SELECT json_group_array(json_array(id,status,published_at,updated_at,
   (EXISTS(SELECT 1 FROM published_quiz_content p WHERE p.quiz_set_id=q.id)
    AND ((SELECT count(*) FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status='active')=2 OR
      q.status='review_ready' AND EXISTS(SELECT 1 FROM quiz_revision_sessions rs WHERE rs.quiz_set_id=q.id)
      AND (SELECT count(*) FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status='withdrawn')>=2)
    AND NOT EXISTS(SELECT 1 FROM quiz_variants v WHERE v.quiz_set_id=q.id AND
      (NOT EXISTS(SELECT 1 FROM quiz_solutions sol WHERE sol.quiz_variant_id=v.id)
       OR v.word_count<>(SELECT count(*) FROM quiz_entries_public e WHERE e.quiz_variant_id=v.id)))))) FROM
   (SELECT * FROM quiz_sets WHERE sermon_id=s.id ORDER BY id) q),
 'jobs',(SELECT json_group_array(json_array(id,status,updated_at)) FROM
   (SELECT * FROM generation_jobs WHERE sermon_id=s.id ORDER BY id)),
 'selections',(SELECT json_group_array(json_array(p.id,p.created_at)) FROM generation_placement_selections p JOIN generation_jobs j ON j.id=p.job_id WHERE j.sermon_id=s.id),
 'leases',(SELECT json_group_array(json_array(r.generation_job_id,r.step_key,r.state,r.lease_expires_at))
   FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id WHERE j.sermon_id=s.id),
 'archives',(SELECT json_group_array(json_array(a.call_id,a.kind,a.state,
   (SELECT count(*) FROM ai_response_archive_chunks b WHERE b.call_id=a.call_id AND b.kind=a.kind)))
   FROM (SELECT a.* FROM ai_response_archives a JOIN ai_provider_calls c ON c.id=a.call_id WHERE c.sermon_id=s.id ORDER BY a.call_id,a.kind) a),
 'transcripts',(SELECT json_group_array(json_array(id,raw_sha256,confirmed_sha256,retention_mode)) FROM
   (SELECT * FROM sermon_transcripts WHERE sermon_id=s.id ORDER BY id))
 ) basis FROM sermons s WHERE s.id=?`;
const timestamp = z.iso.datetime();
const basisSchema = z.object({ sermon: z.tuple([z.string(),timestamp]), hasDrafts: z.number(), input: z.number(), content: z.number(), history: z.number(), metadata: z.number(),
  activityAt: timestamp.nullable(), inputAt: timestamp.nullable(), contentAt: timestamp.nullable(), qualityCount: z.number(), qualityAt: timestamp.nullable(),
  quizzes: z.array(z.tuple([z.string(),z.string(),timestamp.nullable(),timestamp,z.number()])),
  jobs: z.array(z.tuple([z.string(),z.string(),timestamp])),
  selections: z.array(z.tuple([z.string(),timestamp])),
  leases: z.array(z.tuple([z.string(),z.string(),z.string(),timestamp.nullable()])),
  archives: z.array(z.tuple([z.string(),z.string(),z.string(),z.number()])),
  transcripts: z.array(z.tuple([z.string(),z.string(),z.string().nullable(),z.enum(["keep_private","delete_text_after_publish"])])),
});
function sourceMetadata(source: TranscriptSourcePayload) {
  if (source.sourceMode === "public_unofficial") {
    return { sourceMode: source.sourceMode, videoId: source.videoId, language: source.language, trackId: source.trackId,
      generated: source.generated, retrievedAt: source.retrievedAt, providerId: source.providerId,
      providerVersion: source.providerVersion, sourceSha256: source.sourceSha256 };
  }
  return { sourceMode: source.sourceMode, manualSourceKind: source.manualSourceKind,
    sourceCoverage: source.sourceCoverage, checksumFormat: source.checksumFormat, sourceSha256: source.rawTranscriptSha256 };
}
// Legacy commits have no timestamp column. Read their verified domain records,
// never infer an expiry from a migration date or mutate the old ledger.
function legacyActivity(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    ["createdAt", "confirmedAt", "occurredAt", "decidedAt", "registeredAt"].includes(key) && timestamp.safeParse(child).success
      ? [String(child)] : legacyActivity(child));
}
export async function draftIsPurged(db: D1Database, sermonId: string) {
  return !!await db.prepare("SELECT 1 FROM draft_cleanup_records WHERE sermon_id=?").bind(sermonId).first();
}
async function plan(db: D1Database, sermonId: string, now: string) {
  const row = await db.prepare(basisSql).bind(sermonId).first<{ basis: string }>();
  if (!row) throw new Error("DRAFT_NOT_FOUND");
  const basis = basisSchema.parse(JSON.parse(row.basis));
  const legacy = basis.history ? await createSermonHistoryReader(db).read(sermonId) : null;
  const published = basis.quizzes.filter(q => q[2] !== null);
  const allPublished = basis.quizzes.length > 0 && published.length === basis.quizzes.length;
  const dates = [basis.sermon[1], basis.activityAt, basis.inputAt, basis.contentAt, basis.qualityAt, ...basis.jobs.map(j => j[2]), ...basis.selections.map(s => s[1]),
    ...basis.quizzes.map(q => q[3]), ...legacyActivity(legacy)].filter((v): v is string => v !== null);
  const dueAt = new Date(Math.max(...(allPublished ? published.map(q => Date.parse(q[2]!)) : dates.map(Date.parse))) + 7 * DAY).toISOString();
  const blocked = !allPublished && basis.metadata > 0 && basis.activityAt === null ? "activity_unknown" as const
    : published.some(q => q[4] !== 1) ? "publication_missing" as const
    : basis.leases.some(l => ["claimed","effect_started"].includes(l[2]) && l[3] !== null && l[3] > now) ? "active_call" as const : null;
  return { basis, rawBasis: row.basis, legacy, dueAt, blocked };
}
export async function listDraftCleanup(db: D1Database, now = new Date().toISOString()): Promise<DraftCleanupList> {
  timestamp.parse(now);
  const rows = await db.prepare(`SELECT s.id,coalesce((SELECT title FROM published_quiz_content pc JOIN quiz_sets q ON q.id=pc.quiz_set_id WHERE q.sermon_id=s.id ORDER BY pc.published_at DESC LIMIT 1),(SELECT title FROM sermon_metadata_drafts WHERE sermon_id=s.id),s.sermon_title) title,p.purged_at FROM sermons s
    LEFT JOIN draft_cleanup_records p ON p.sermon_id=s.id WHERE p.sermon_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM quiz_problem_cases e JOIN quiz_sets q ON q.id=e.quiz_set_id WHERE q.sermon_id=s.id)
    OR EXISTS(SELECT 1 FROM quiz_revision_sessions e JOIN quiz_sets q ON q.id=e.quiz_set_id WHERE q.sermon_id=s.id)
    OR EXISTS(SELECT 1 FROM withdrawal_edit_revisions e JOIN quiz_sets q ON q.id=e.quiz_set_id WHERE q.sermon_id=s.id)
    OR EXISTS(SELECT 1 FROM sermon_input_heads WHERE sermon_id=s.id)
    OR EXISTS(SELECT 1 FROM sermon_history_heads WHERE sermon_id=s.id)
    OR EXISTS(SELECT 1 FROM sermon_content_heads WHERE sermon_id=s.id)
    OR EXISTS(SELECT 1 FROM sermon_transcripts WHERE sermon_id=s.id AND retention_mode='delete_text_after_publish') ORDER BY s.id`).all<{ id: string; title: string; purged_at: string | null }>();
  const items: DraftCleanupList["items"] = [];
  for (const row of rows.results) {
    try {
      const edits = await planProblemCleanup(db,row.id,now) ?? await planQuizRevisionCleanup(db,row.id,now) ?? await planWithdrawalEditCleanup(db, row.id, now);
      if (edits) {
        if (edits.purgedAt) items.push({ sermonId: row.id, title: row.title, dueAt: edits.dueAt, state: "purged", reason: "expired" });
        else if (edits.blocked || edits.dueAt <= new Date(Date.parse(now) + DAY).toISOString()) items.push({
          sermonId: row.id, title: row.title, dueAt: edits.dueAt,
          state: edits.blocked ? "blocked" : edits.dueAt <= now ? "due" : "scheduled", reason: edits.blocked });
        continue;
      }
    } catch { items.push({ sermonId: row.id, title: row.title, dueAt: null, state: "blocked", reason: "unreadable" }); continue; }
    if (row.purged_at) { items.push({ sermonId: row.id, title: row.title, dueAt: row.purged_at, state: "purged", reason: "expired" }); continue; }
    try {
      const p = await plan(db, row.id, now);
      if (!p.basis.hasDrafts) continue;
      if (!p.blocked && p.dueAt > new Date(Date.parse(now) + DAY).toISOString()) continue;
      items.push({ sermonId: row.id, title: row.title, dueAt: p.blocked === "activity_unknown" ? null : p.dueAt,
        state: p.blocked ? "blocked" : p.dueAt <= now ? "due" : "scheduled", reason: p.blocked });
    } catch { items.push({ sermonId: row.id, title: row.title, dueAt: null, state: "blocked", reason: "unreadable" }); }
  }
  return draftCleanupListSchema.parse({ items });
}

/** Only synthetic tests call this directly today. No HTTP deletion endpoint. */
export async function purgeExpiredDraft(db: D1Database, sermonId: string, now = new Date().toISOString()) {
  timestamp.parse(now);
  const problems=await planProblemCleanup(db,sermonId,now);
  if(problems && !problems.purgedAt) {
    if(problems.blocked || problems.dueAt>now) return {outcome:"not_due" as const};
    const original=await draftIsPurged(db,sermonId) ? []:await originalCleanupStatements(db,sermonId,now,problems.dueAt);
    const statements=[...await problemCleanupStatements(db,sermonId,now),...original];
    const prior=await planQuizRevisionCleanup(db,sermonId,now);
    if(prior && !prior.purgedAt) return (await purgeQuizRevisions(db,sermonId,now,statements))!;
    await db.batch(statements);return {outcome:"purged" as const};
  }
  const revisions=await planQuizRevisionCleanup(db,sermonId,now);
  if(revisions) {
    if(revisions.purgedAt) return {outcome:"replayed" as const};
    if(revisions.blocked || revisions.dueAt>now) return {outcome:"not_due" as const};
    const original=await draftIsPurged(db,sermonId) ? [] : await originalCleanupStatements(db,sermonId,now,revisions.dueAt);
    return (await purgeQuizRevisions(db,sermonId,now,original))!;
  }
  const withdrawal = await purgeWithdrawalEdits(db, sermonId, now);
  if (withdrawal) return withdrawal;
  if (await draftIsPurged(db, sermonId)) return { outcome: "replayed" as const };
  const statements=await originalCleanupStatements(db,sermonId,now);
  if (!statements.length) return { outcome: "not_due" as const };
  try {
    const result = await db.batch(statements);
    return { outcome: result[0]?.meta.changes === 1 ? "purged" as const : "changed" as const };
  } catch (error) {
    // A concurrent winner or lost commit response is a replay; a rolled-back
    // audit/constraint failure has no durable marker and must remain a failure.
    if (await draftIsPurged(db, sermonId)) return { outcome: "replayed" as const };
    throw error;
  }
}
async function originalCleanupStatements(db: D1Database,sermonId: string,now: string,dueFloor?: string): Promise<D1PreparedStatement[]> {
  const p = await plan(db, sermonId, now);
  if (dueFloor && p.dueAt<dueFloor) p.dueAt=dueFloor;
  if (!p.basis.hasDrafts || p.blocked || p.dueAt > now) return [];
  const store = createSermonInputStore(db);
  const input = await db.prepare("SELECT * FROM sermon_input_events WHERE sermon_id=? ORDER BY version").bind(sermonId).all<{
    id: string; kind: string; source_id: string; document_id: string; document_sha256: string }>();
  const keepInput = new Set<string>(), keepHistory = new Set<string>();
  const sources: unknown[] = [];
  const published = p.basis.quizzes.length > 0 && p.basis.quizzes.every(q => q[2] !== null);
  const deletesSource = (sha: string) => published && p.basis.transcripts.some(t => t[1] === sha && t[3] === "delete_text_after_publish")
    && !p.basis.transcripts.some(t => t[1] === sha && t[3] === "keep_private");
  for (const s of input.results.filter(e => e.kind === "source")) {
    const record = await store.event(sermonId, s.id);
    if (!record) throw new Error("DRAFT_SOURCE_UNAVAILABLE");
    const source = transcriptSourcePayloadSchema.parse(await store.payload(record));
    const metadata = sourceMetadata(source);
    sources.push({ id: s.id, ...metadata });
    if (!deletesSource(metadata.sourceSha256)) {
      keepInput.add(s.id);
      const confirmed = input.results.filter(e => e.kind === "confirm" && e.source_id === s.id).at(-1);
      if (confirmed) { keepInput.add(confirmed.id); keepInput.add(confirmed.document_id); }
    }
  }
  // Confirmation events contain only a reviewed flag; keep the identity and proof.
  for (const e of input.results.filter(e => e.kind === "confirm")) keepInput.add(e.id);
  if (p.legacy) {
    for (const s of p.legacy.sources) {
      const metadata = sourceMetadata(transcriptSourcePayloadSchema.parse(s.payload)); sources.push({ id: s.id, ...metadata });
      if (!deletesSource(metadata.sourceSha256)) {
        keepHistory.add(s.id);
        const confirmation = p.legacy.confirmations.filter(c => c.sourceId === s.id).at(-1);
        if (confirmation) keepHistory.add(confirmation.revisionId);
      }
    }
    for (const c of p.legacy.confirmations) keepHistory.add(c.id);
  }
  const history = await db.prepare("SELECT record_id FROM sermon_history_records WHERE sermon_id=?").bind(sermonId).all<{ record_id: string }>();
  const payloadPlan = JSON.stringify({ sources, purgeInputIds: input.results.filter(e => !keepInput.has(e.id)).map(e => e.id),
    purgeHistoryIds: history.results.filter(r => !keepHistory.has(r.record_id)).map(r => r.record_id) });
  const guarded = (sql: string) => db.prepare(`${sql} AND EXISTS(SELECT 1 FROM draft_cleanup_records WHERE sermon_id=?)`).bind(sermonId, sermonId);
  const statements = [db.prepare(`INSERT INTO draft_cleanup_records
    (sermon_id,purged_at,due_at,input_version,content_count,history_version,metadata_revision,basis_fingerprint,source_metadata_json)
    SELECT ?,?,?,?,?,?,?,?,? FROM (${basisSql}) WHERE basis=?`).bind(sermonId, now, p.dueAt, p.basis.input, p.basis.content,
      p.basis.history, p.basis.metadata, await hash(p.rawBasis), payloadPlan, sermonId, p.rawBasis),
    guarded("DELETE FROM sermon_input_chunks WHERE sermon_id=? AND event_id IN (SELECT value FROM draft_cleanup_records p,json_each(p.source_metadata_json,'$.purgeInputIds') WHERE p.sermon_id=sermon_input_chunks.sermon_id)"),
    guarded("DELETE FROM sermon_history_chunks WHERE sermon_id=? AND record_id IN (SELECT value FROM draft_cleanup_records p,json_each(p.source_metadata_json,'$.purgeHistoryIds') WHERE p.sermon_id=sermon_history_chunks.sermon_id)"),
    guarded("DELETE FROM sermon_content_chunks WHERE sermon_id=?"),
    guarded("DELETE FROM generation_context_chunks WHERE context_id IN (SELECT id FROM generation_contexts WHERE sermon_id=?)"),
    guarded("DELETE FROM final_check_ticket_chunks WHERE ticket_id IN (SELECT id FROM final_check_tickets WHERE sermon_id=?)"),
    guarded("DELETE FROM ai_final_audit_chunks WHERE audit_result_id IN (SELECT a.id FROM ai_final_audit_results a JOIN generation_jobs j ON j.id=a.generation_job_id WHERE j.sermon_id=?)"),
    guarded("DELETE FROM ai_response_archive_chunks WHERE call_id IN (SELECT id FROM ai_provider_calls WHERE sermon_id=?)"),
    ...(published ? [guarded("UPDATE sermon_transcripts SET raw_text='',raw_segments_json=NULL,confirmed_text=CASE WHEN confirmed_text IS NULL THEN NULL ELSE '' END WHERE sermon_id=? AND retention_mode='delete_text_after_publish'")] : []),
    db.prepare(`INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_type,actor_email,safe_metadata_json,created_at)
      SELECT ?,'sermon',?,'draft_payloads_purged','system',NULL,?,? WHERE EXISTS(SELECT 1 FROM draft_cleanup_records WHERE sermon_id=?)`)
      .bind(`draft-cleanup-${sermonId}`, sermonId, JSON.stringify({ dueAt: p.dueAt, policy: "draft_7_days" }), now, sermonId),
  ];
  return statements;
}
export async function runScheduledDraftCleanup(env: { DB: D1Database; DRAFT_CLEANUP_ENABLED?: string }, now: string) {
  if (env.DRAFT_CLEANUP_ENABLED !== "true") return { outcome: "disabled" as const };
  const list = await listDraftCleanup(env.DB, now);
  const results: { sermonId: string; outcome: string }[] = [];
  for (const item of list.items.filter(i => i.state === "due")) {
    try { results.push({ sermonId: item.sermonId, ...(await purgeExpiredDraft(env.DB, item.sermonId, now)) }); }
    catch { results.push({ sermonId: item.sermonId, outcome: "failed" }); }
  }
  if (results.some(r => r.outcome === "failed")) throw new Error("DRAFT_CLEANUP_INCOMPLETE");
  return { outcome: "completed" as const, results };
}
