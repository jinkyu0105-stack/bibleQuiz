import { prepareReadSchema } from "./prepare-input-schema";
import { z } from "zod";
import { generationReadSession, readTogether } from "../repositories/generation-read-session";
import { readLatestContentQuality } from "./content-quality-review";
import { readDisplayFinal, checkedDisplayLayoutSchema, checkedDisplayGridSchema } from "../repositories/generation-display-store";
import { generationAuthoritySnapshotSchema } from "./generation-bridge-contract";
import { adminContentViewSchema, type AdminContentSection, type AdminContentView } from "../../../shared/api/admin-content-generation";
import { createGenerationLifecycleStore, readGenerationLifecycleJob } from "../repositories/generation-lifecycle-store";
import type { DisplaySnapshot } from "../repositories/generation-display-store";
import { readContentDisplay } from "./content-generation-display";
import { createSermonInputStore } from "../repositories/sermon-input-store";
import { readStoredCurrent } from "../repositories/human-content-runtime-store";
import { createDatabase } from "../db/client";
import { createSermonMetadataRepository } from "../repositories/sermon-metadata-repository";
import { sameLifecycleValue } from "./generation-context-codec";
// Display readers have already validated each value. Project explicit API
// fields once and require those exact objects at the composed boundary.
const checkedSnapshots = new WeakSet<object>();
export function projectSnapshot(s: DisplaySnapshot): AdminContentView["snapshots"][number] {
  let value: AdminContentView["snapshots"][number];
  if (s.kind === "intent") value = { kind: s.kind, value: { id: s.value.id, kind: s.value.kind,
    analysis: s.value.analysis, binding: s.value.binding, critiqueId: s.value.critiqueId }, critique: s.critique };
  else if (s.kind === "summary") value = { kind: s.kind, value: { id: s.value.id, kind: s.value.kind,
    draft: s.value.draft, binding: s.value.binding } };
  else value = { kind: s.kind, value: { id: s.value.id, kind: s.value.kind, difficulty: s.value.difficulty,
    draft: s.value.draft, binding: s.value.binding, statuses: s.value.statuses,
    ...(s.operation.kind === "generate" && s.operation.replacement ? { replacement: s.operation.replacement } : {}) } };
  checkedSnapshots.add(value);
  return value;
}
const displayViewSchema = adminContentViewSchema.extend({
  snapshots: z.array(z.custom<AdminContentView["snapshots"][number]>(v => v !== null && typeof v === "object" && checkedSnapshots.has(v))),
  layoutPart: adminContentViewSchema.shape.layoutPart.unwrap().extend({ layout: checkedDisplayLayoutSchema.nullable() }).optional(),
  reviewLayouts: z.strictObject({ child: checkedDisplayLayoutSchema, adult: checkedDisplayLayoutSchema }).nullable().default(null),
  preview: adminContentViewSchema.shape.preview.unwrap().extend({
    variants: z.object({ child: checkedDisplayGridSchema, adult: checkedDisplayGridSchema }),
  }).nullable(),
});
export function parseDisplayView(raw: unknown) { return displayViewSchema.parse(raw); }
prepareReadSchema(displayViewSchema);
prepareReadSchema(adminContentViewSchema);
export async function readContentGenerationView(db: D1Database, sermonId: string, enabled: boolean, before?: number, section?: AdminContentSection) {
  db = generationReadSession(db);
  const [revision, result] = await readTogether([readViewRevision(db, sermonId), readView(db, sermonId, enabled, before, section)]);
  if (revision !== await readViewRevision(db, sermonId)) throw new Error("CONTENT_DISPLAY_CHANGED");
  return section ? { ...result, viewRevision: revision } : result;
}

// Sections may arrive in any order. A view revision prevents combining content,
// quality, metadata or placement selections from different administrator saves.
export const contentViewRevisionSql = `json_object(
  'input_version',(SELECT version FROM sermon_input_heads WHERE sermon_id=s.id),
  'content_version',(SELECT event_count FROM sermon_content_heads WHERE sermon_id=s.id),
  'metadata_version',(SELECT metadata_revision FROM sermon_metadata_drafts WHERE sermon_id=s.id),
  'quality_version',(SELECT count(*) FROM sermon_content_quality_reviews WHERE sermon_id=s.id),
  'jobs_version',(SELECT coalesce(sum(state_version),0) FROM generation_jobs WHERE sermon_id=s.id),
  'placement_version',(SELECT count(*) FROM generation_placement_selections p JOIN generation_jobs j ON j.id=p.job_id WHERE j.sermon_id=s.id),
  'cleanup_version',(SELECT count(*) FROM draft_cleanup_records WHERE sermon_id=s.id),
  'quiz_version',(SELECT group_concat(id || ':' || status) FROM quiz_sets WHERE sermon_id=s.id))`;
export async function readViewRevision(db: D1Database, sermonId: string) {
  const row = await db.prepare(`SELECT ${contentViewRevisionSql} revision FROM sermons s WHERE s.id=?`).bind(sermonId).first<{revision: string}>();
  if (!row) throw new Error("GENERATION_JOB_UNAVAILABLE");
  return row.revision;
}

export async function readDisplayActivity(db: D1Database, sermonId: string, quizSetId: string) {
  const regenerationRows = await db.prepare(`SELECT j.id jobId,j.request_scope scope,j.status,j.created_at createdAt,
    (SELECT r.result_id FROM generation_step_receipts r WHERE r.generation_job_id=j.id AND r.step_key=
      CASE j.request_scope WHEN 'intent' THEN 'intent_critique' WHEN 'summary' THEN 'summary'
        WHEN 'child' THEN 'child_candidates' ELSE 'adult_candidates' END) resultId,
    (SELECT coalesce(reuse.analysis_event_id,analysis.result_id) FROM generation_jobs job
      LEFT JOIN generation_intent_analysis_reuse reuse ON reuse.job_id=job.id
      LEFT JOIN generation_step_receipts analysis ON analysis.generation_job_id=job.id AND analysis.step_key='intent_analysis'
      WHERE job.id=j.id AND job.request_scope='intent') analysisId,
    (SELECT coalesce(sum(u.estimated_cost_micro_usd),0) FROM ai_usage_observations u WHERE u.job_id=j.id) costMicroUsd,
    (SELECT count(*) FROM ai_provider_calls c WHERE c.generation_job_id=j.id AND NOT EXISTS (SELECT 1 FROM ai_usage_observations u WHERE u.call_id=c.id)) unknownCalls,
    EXISTS(SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=j.id AND (r.state='uncertain' OR r.state IN ('claimed','effect_started') AND r.lease_expires_at<=?)) uncertain
    FROM generation_jobs j
    WHERE j.sermon_id=? AND j.quiz_set_id=? AND j.request_contract_version=2 AND j.request_scope IN ('intent','summary','child','adult')
    ORDER BY j.created_at DESC,j.id DESC`).bind(new Date().toISOString(), sermonId, quizSetId).all<{
      jobId: string; scope: string; status: string; createdAt: string; resultId: string | null; analysisId: string | null; costMicroUsd: number; unknownCalls: number; uncertain: number }>();
  const lifecycle = regenerationRows.results.length ? createGenerationLifecycleStore(db) : null;
  return Promise.all(regenerationRows.results.map(async ({ uncertain, ...r }) => {
    const saved = await lifecycle!.readJob(r.jobId);
    if (saved.outcome !== "present") throw new Error("GENERATION_JOB_UNAVAILABLE");
    const context = await lifecycle!.readContext(saved.value.request_context_id);
    if (context.outcome !== "present" || context.value.context.kind !== "request") throw new Error("GENERATION_JOB_UNAVAILABLE");
    const target = context.value.context.candidateTarget;
    return { ...r, ...(target ? { target } : {}), status: uncertain && r.status === "running" ? "uncertain" : r.status };
  }));
}

async function readView(db: D1Database, sermonId: string, enabled: boolean, before?: number, section?: AdminContentSection) {
  const needs = (part: AdminContentSection) => section === undefined || section === part;

  db = generationReadSession(db);
  // Monday 00:00 Asia/Seoul, reported from observed usage including failed/stale calls.
  const now = new Date(Date.now() + 9 * 3600_000); now.setUTCHours(0, 0, 0, 0); now.setUTCDate(now.getUTCDate() - (now.getUTCDay() + 6) % 7);
  const since = new Date(now.getTime() - 9 * 3600_000).toISOString();
  const [quiz, row, costs, withdrawn] = await readTogether([
    db.prepare("SELECT id FROM quiz_sets WHERE sermon_id=? AND status IN ('draft','needs_revision','review_ready') ORDER BY created_at DESC,id DESC LIMIT 1")
      .bind(sermonId).first<{ id: string }>(),
    db.prepare("SELECT id FROM generation_jobs WHERE sermon_id=? AND request_scope='full' AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=generation_jobs.id) ORDER BY created_at DESC,id DESC LIMIT 1")
      .bind(sermonId).first<{ id: string }>(),
    needs("costs") ? db.prepare(`SELECT coalesce(sum(coalesce(u.estimated_cost_micro_usd,old.estimated_cost_micro_usd,0)),0) cost,
    coalesce(sum(CASE WHEN u.call_id IS NULL AND old.id IS NULL THEN 1 ELSE 0 END),0) unknown_calls FROM ai_provider_calls c
    LEFT JOIN ai_usage_observations u ON u.call_id=c.id LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id WHERE c.started_at>=?`).bind(since).first<{ cost: number; unknown_calls: number }>() : Promise.resolve(null),
    db.prepare(`SELECT w.quiz_set_id quizSetId FROM quiz_withdrawals w
      JOIN quiz_sets q ON q.id=w.quiz_set_id WHERE q.sermon_id=? AND q.status='review_ready'`)
      .bind(sermonId).first<{ quizSetId: string }>(),
  ]);
  let jobCost = { cost: 0, unknown_calls: 0 };
  if (row && needs("costs")) jobCost = await db.prepare(`SELECT coalesce(sum(coalesce(u.estimated_cost_micro_usd,old.estimated_cost_micro_usd,0)),0) cost,
    coalesce(sum(CASE WHEN u.call_id IS NULL AND old.id IS NULL THEN 1 ELSE 0 END),0) unknown_calls FROM ai_provider_calls c
    LEFT JOIN ai_usage_observations u ON u.call_id=c.id LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id WHERE c.generation_job_id=?`).bind(row.id).first<typeof jobCost>() ?? jobCost;
  // A withdrawn publication starts from its permanent copy, never the old draft
  // or its already-consumed publication ticket (which may have been purged).
  if (withdrawn) return adminContentViewSchema.parse({ enabled: false, quizSetId: withdrawn.quizSetId,
    jobId: null, version: 0, status: "withdrawn", stage: "withdrawn", content: { state: "absent" }, snapshots: [],
    weekCostMicroUsd: costs?.cost ?? 0, weekUnknownCalls: costs?.unknown_calls ?? 0,
    jobCostMicroUsd: jobCost.cost, jobUnknownCalls: jobCost.unknown_calls, preview: null });
  if (!quiz) {
    const published = await db.prepare("SELECT p.quiz_set_id quizSetId,p.slug,q.published_at publishedAt,q.closes_at closesAt FROM published_quiz_content p JOIN quiz_sets q ON q.id=p.quiz_set_id WHERE q.sermon_id=? AND q.status IN ('published','archived') ORDER BY p.published_at DESC LIMIT 1")
      .bind(sermonId).first<{ quizSetId: string; slug: string; publishedAt: string; closesAt: string }>();
    if (published) return adminContentViewSchema.parse({ enabled, quizSetId: published.quizSetId, jobId: null, version: 0,
      status: "published", stage: "published", publication: { slug: published.slug, publishedAt: published.publishedAt, closesAt: published.closesAt },
      content: { state: "absent" }, snapshots: [], weekCostMicroUsd: costs?.cost ?? 0, weekUnknownCalls: costs?.unknown_calls ?? 0,
      jobCostMicroUsd: 0, jobUnknownCalls: 0, preview: null });
  }
  if (!row || !quiz) return adminContentViewSchema.parse({ enabled, quizSetId: quiz?.id ?? null, jobId: null,
    version: (await createSermonInputStore(db).head(sermonId))?.version ?? 0, status: "idle", stage: "input_resolve", content: { state: "absent" }, snapshots: [],
    weekCostMicroUsd: costs?.cost ?? 0, weekUnknownCalls: costs?.unknown_calls ?? 0, jobCostMicroUsd: 0, jobUnknownCalls: 0, preview: null });
  const quizCost = needs("costs") ? await db.prepare(`SELECT coalesce(sum(coalesce(u.estimated_cost_micro_usd,old.estimated_cost_micro_usd,0)),0) cost,
    coalesce(sum(CASE WHEN u.call_id IS NULL AND old.id IS NULL THEN 1 ELSE 0 END),0) unknown_calls FROM ai_provider_calls c
    LEFT JOIN ai_usage_observations u ON u.call_id=c.id LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id WHERE c.quiz_set_id=?`)
    .bind(quiz.id).first<{ cost: number; unknown_calls: number }>() : null;
  // These independent headers share one D1 batch. Waiting for each header
  // separately repeats the binding's response decoding for the same view.
  const [job, head, contentHead, uncertain] = await readTogether([
    readGenerationLifecycleJob(db, row.id),
    createSermonInputStore(db).head(sermonId),
    db.prepare("SELECT event_count FROM sermon_content_heads WHERE sermon_id=?").bind(sermonId).first<{ event_count: number }>(),
    db.prepare("SELECT count(*) n FROM generation_step_receipts WHERE generation_job_id=? AND (state='uncertain' OR state='effect_started' AND lease_expires_at<=?)")
      .bind(row.id, new Date().toISOString()).first<{ n: number }>(),
  ]);
  if (job.outcome !== "present" || job.value.quiz_set_id !== quiz.id) throw new Error("GENERATION_JOB_UNAVAILABLE");
  const base = adminContentViewSchema.parse({ enabled, quizSetId: quiz.id, jobId: row.id,
    version: (head?.version ?? 0) + (contentHead?.event_count ?? 0), status: uncertain?.n ? "uncertain" : job.value.status,
    stage: job.value.current_step, content: { state: "absent" }, snapshots: [], preview: null,
    weekCostMicroUsd: costs?.cost ?? 0, weekUnknownCalls: costs?.unknown_calls ?? 0,
    jobCostMicroUsd: jobCost.cost, jobUnknownCalls: jobCost.unknown_calls,
    quizCostMicroUsd: quizCost?.cost ?? 0, quizUnknownCalls: quizCost?.unknown_calls ?? 0 });
  if (section === "state" || section === "costs") return base;
  // Read one history page plus the current selections and their verified dependencies.
  const generated = needs("content") ? await db.prepare(`SELECT e.event_id,e.content_sequence FROM sermon_content_events e
    JOIN sermon_content_domain_lineage l ON l.sermon_id=e.sermon_id AND l.event_id=e.event_id
    LEFT JOIN sermon_content_human_events h ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id
    WHERE e.sermon_id=? AND e.state='sealed' AND (? IS NULL OR e.content_sequence<?)
    AND (e.origin='ai' OR h.operation IN ('intent_edit','summary_edit','summary_restore','candidate_edit','candidate_restore','candidate_set_status'))
    ORDER BY e.content_sequence DESC LIMIT 7`).bind(sermonId, before ?? null, before ?? null).all<{ event_id: string; content_sequence: number }>() : { results: [] };
  const page = generated.results.slice(0, 6);
  const regenerations = needs("activity") ? await readDisplayActivity(db, sermonId, quiz.id) : [];
  if (section === "activity") return adminContentViewSchema.parse({ ...base, regenerations });
  let preview: AdminContentView["preview"] = null, reviewLayouts: AdminContentView["reviewLayouts"] = null;
  let placement: AdminContentView["placement"] = null;
  if (needs("placement")) {
    const [selected, metadata, proof, current] = await readTogether([
      db.prepare("SELECT revision,ticket_id FROM generation_placement_selections WHERE job_id=? ORDER BY revision DESC LIMIT 1")
        .bind(row.id).first<{revision: number; ticket_id: string}>(),
      createSermonMetadataRepository(createDatabase(db)).read(sermonId),
      db.prepare("SELECT ticket_id FROM generation_final_validation_proofs WHERE job_id=?").bind(row.id).first<{ ticket_id: string }>(),
      readStoredCurrent(db, sermonId),
    ]);
    if (!metadata) throw new Error("GENERATION_JOB_UNAVAILABLE");
    const ticketId = selected?.ticket_id ?? proof?.ticket_id;
    if (ticketId) {
      const saved = await readDisplayFinal(db, { sermonId, quizSetId: quiz.id }, ticketId), ticket = saved.ticket;
      const quality = await readLatestContentQuality(db, sermonId, [ticket.binding.analysisId, ticket.summary.summaryId,
        ticket.placements.child.ticket.poolId, ticket.placements.adult.ticket.poolId]);
      const binding = ticket.binding.transcript;
      if (current && ticket.expectedVersion === base.version && sameLifecycleValue(metadata, ticket.metadata) &&
        binding.sourceId === current.input.sourceId && binding.revisionId === current.input.documentId &&
        binding.transcriptSha256 === current.input.documentSha256 && binding.confirmationId === current.input.confirmationId &&
        ticket.binding.analysisId === current.selectedAnalysisEventId && ticket.binding.intentConfirmationId === current.intentConfirmationEventId &&
        ticket.summary.summaryId === current.summarySnapshotEventId && ticket.summary.reviewId === current.summaryReviewEventId &&
        ticket.placements.child.ticket.poolId === current.childPoolEventId && ticket.placements.child.ticket.reviewId === current.childReviewEventId &&
        ticket.placements.adult.ticket.poolId === current.adultPoolEventId && ticket.placements.adult.ticket.reviewId === current.adultReviewEventId &&
        !Object.values(quality).some(review => review.status === "regenerate")) {
        preview = saved.preview; reviewLayouts = saved.layouts;
      }
      placement = { revision: selected?.revision ?? job.value.selection_revision!, metadataRevision: metadata.metadataRevision,
        selection: { child: { options: ticket.placements.child.ticket.options, index: ticket.placements.child.index },
          adult: { options: ticket.placements.adult.ticket.options, index: ticket.placements.adult.index } },
        selected: !!selected, current: !!preview };
    } else {
      // SQL extracts only the saved selection. Original contexts are still fully
      // checked by commands; this private display value never becomes authority.
      const request = await db.prepare(`SELECT json_extract((SELECT group_concat(CAST(body AS TEXT),'') FROM
        (SELECT body FROM generation_context_chunks WHERE context_id=c.id AND verified=1 ORDER BY position)), '$.authority.selection') selection
        FROM generation_contexts c JOIN generation_request_contexts r ON r.context_id=c.id AND r.fingerprint=c.fingerprint
        WHERE c.id=? AND c.job_id=? AND c.sermon_id=? AND c.quiz_set_id=? AND c.kind='request' AND c.state='sealed'`)
        .bind(job.value.request_context_id, row.id, sermonId, quiz.id).first<{selection: string}>();
      if (!request) throw new Error("GENERATION_JOB_UNAVAILABLE");
      const selection = generationAuthoritySnapshotSchema.shape.selection.parse(JSON.parse(request.selection));
      if (selection.state === "present") placement = { revision: selection.selectionRevision, metadataRevision: metadata.metadataRevision,
        selection: selection.value, selected: false, current: false };
    }
  }
  if (section === "placement") return displayViewSchema.parse({ ...base, placement, preview, reviewLayouts });
  const read = await readContentDisplay(db, { sermonId, quizSetId: quiz.id }, page.map(r => r.event_id));
  const quality = await readLatestContentQuality(db, sermonId, read.snapshots.map(snapshot => snapshot.value.id));
  const recovery = needs("content") && job.value.status === "failed" ? await readRecoveryDisplay(db, sermonId, quiz.id, read) : null;
  return displayViewSchema.parse({ enabled, quizSetId: quiz.id, jobId: row.id, version: read.version,
    recoveredAnalysisId: recovery?.analysisId ?? null,
    recoveredCritiqueId: recovery?.critiqueId ?? null,
    status: uncertain?.n ? "uncertain" : job.value.status, stage: job.value.current_step, content: read.content, snapshots: read.snapshots.map(projectSnapshot),
    quizCostMicroUsd: quizCost?.cost ?? 0, quizUnknownCalls: quizCost?.unknown_calls ?? 0,
    quality,
    historyCursor: generated.results.length > 6 ? page.at(-1)!.content_sequence : null,
    regenerations,
    weekCostMicroUsd: costs?.cost ?? 0, weekUnknownCalls: costs?.unknown_calls ?? 0, jobCostMicroUsd: jobCost.cost, jobUnknownCalls: jobCost.unknown_calls, preview, reviewLayouts,
    placement });
}

/** Button availability only. Reuse commands still verify the full recovery
 * provenance and current authority; this display value cannot authorize them. */
export async function readRecoveryDisplay(db: D1Database, sermonId: string, quizSetId: string, read: {content: AdminContentView["content"]; snapshots: readonly {
  kind: string; value: {id: string; kind: string}; provenance: {rootAnalysisId: string | null}; }[]}) {
  const c = read.content;
  if (c.state !== "present" || !c.intent || c.intent.confirmation) return null;
  const analysis = read.snapshots.find(s => s.value.id === c.intent!.selectedId);
  if (analysis?.kind !== "intent" || analysis.value.kind !== "analysis") return null;
  const rows = await db.prepare(`SELECT r.event_id FROM generation_archived_intent_recoveries r
    JOIN generation_contexts c ON c.id=r.context_id AND c.fingerprint=r.context_fingerprint AND c.state='sealed' AND c.kind='step'
      AND c.job_id=r.source_job_id AND c.sermon_id=r.sermon_id AND c.quiz_set_id=r.quiz_set_id
    JOIN generation_jobs j ON j.id=r.source_job_id AND j.status='failed' AND j.request_scope='full'
      AND EXISTS(SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=j.id)
    JOIN sermon_input_heads h ON h.sermon_id=r.sermon_id AND h.version=c.input_version
    JOIN sermon_input_events i ON i.sermon_id=h.sermon_id AND i.version=h.version AND i.state='sealed'
      AND i.source_id=c.source_id AND i.document_id=c.document_id AND i.document_sha256=c.document_sha256 AND i.confirmation_id IS c.confirmation_id
    JOIN sermon_metadata_drafts m ON m.sermon_id=r.sermon_id AND m.metadata_revision=c.metadata_revision
    WHERE r.sermon_id=? AND r.quiz_set_id=?`).bind(sermonId, quizSetId).all<{event_id: string}>();
  if (!rows.results.some(r => r.event_id === analysis.value.id)) return null;
  const critique = read.snapshots.find(s => s.kind === "intent" && s.value.kind === "critique" && s.provenance.rootAnalysisId === analysis.value.id &&
    rows.results.some(r => r.event_id === s.value.id));
  return { analysisId: analysis.value.id, critiqueId: critique?.value.id ?? null };
}
