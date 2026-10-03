import { generationAuthoritySnapshotSchema } from "./generation-bridge-contract";
import { prepareInputSchema } from "./prepare-input-schema";
import { z } from "zod";
import { adminContentViewSchema, type AdminContentSection, type AdminContentView } from "../../../shared/api/admin-content-generation";
import { generationReadSession, readTogether } from "../repositories/generation-read-session";
import { decodeGenerationLifecycleJob } from "../repositories/generation-lifecycle-store";
import { inputEventSchema } from "../repositories/sermon-input-store";
import { readStoredCurrent } from "../repositories/human-content-runtime-store";
import { readDisplaySnapshots, readDisplayFinalPart } from "../repositories/generation-display-store";
import { readDisplayMetadata } from "../repositories/sermon-metadata-repository";
import { readLatestContentQuality } from "./content-quality-review";
import { sameLifecycleValue } from "./generation-context-codec";
import { parseDisplayView, projectSnapshot, readRecoveryDisplay, readViewRevision, contentViewRevisionSql, readDisplayActivity } from "./content-generation-view";

// A display header still uses the same complete job/input decoders. Combining
// their SQL reads avoids constructing command stores and repeated D1 responses.
const displayCount = z.int().nonnegative();
// These schemas are invariant. Constructing them for every section adds lazy
// parser setup to each independent request without changing its validation.
const displayRevision = z.string();
const nullableDisplayId = displayRevision.nullable();
const nullableSelectionRevision = z.int().positive().nullable();
const displayInput = prepareInputSchema(inputEventSchema.pick({ id: true, version: true, confirmation_id: true }));
async function header(db: D1Database, sermonId: string, enabled: boolean, section?: "state" | "costs") {
  const now = new Date(Date.now() + 9 * 3600_000); now.setUTCHours(0, 0, 0, 0); now.setUTCDate(now.getUTCDate() - (now.getUTCDay() + 6) % 7);
  const since = new Date(now.getTime() - 9 * 3600_000).toISOString();
  const totals = section === "costs" ? `,
    (SELECT coalesce(sum(coalesce(u.estimated_cost_micro_usd,old.estimated_cost_micro_usd,0)),0) FROM ai_provider_calls c LEFT JOIN ai_usage_observations u ON u.call_id=c.id LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id WHERE c.started_at>=?) week_cost,
    (SELECT coalesce(sum(CASE WHEN u.call_id IS NULL AND old.id IS NULL THEN 1 ELSE 0 END),0) FROM ai_provider_calls c LEFT JOIN ai_usage_observations u ON u.call_id=c.id LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id WHERE c.started_at>=?) week_unknown,
    (SELECT coalesce(sum(coalesce(u.estimated_cost_micro_usd,old.estimated_cost_micro_usd,0)),0) FROM ai_provider_calls c LEFT JOIN ai_usage_observations u ON u.call_id=c.id LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id WHERE c.generation_job_id=j.id) job_cost,
    (SELECT coalesce(sum(CASE WHEN u.call_id IS NULL AND old.id IS NULL THEN 1 ELSE 0 END),0) FROM ai_provider_calls c LEFT JOIN ai_usage_observations u ON u.call_id=c.id LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id WHERE c.generation_job_id=j.id) job_unknown,
    (SELECT coalesce(sum(coalesce(u.estimated_cost_micro_usd,old.estimated_cost_micro_usd,0)),0) FROM ai_provider_calls c LEFT JOIN ai_usage_observations u ON u.call_id=c.id LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id WHERE c.quiz_set_id=q.id) quiz_cost,
    (SELECT coalesce(sum(CASE WHEN u.call_id IS NULL AND old.id IS NULL THEN 1 ELSE 0 END),0) FROM ai_provider_calls c LEFT JOIN ai_usage_observations u ON u.call_id=c.id LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id WHERE c.quiz_set_id=q.id) quiz_unknown` : "";
  const row = await db.prepare(`SELECT j.*,v.request_context_id marker,q.id display_quiz_id,
    (SELECT ${contentViewRevisionSql} FROM sermons s WHERE s.id=j.sermon_id) display_revision,
    (SELECT ticket_id FROM generation_placement_selections WHERE job_id=j.id ORDER BY revision DESC LIMIT 1) selected_ticket,
    (SELECT revision FROM generation_placement_selections WHERE job_id=j.id ORDER BY revision DESC LIMIT 1) selected_revision,
    (SELECT ticket_id FROM generation_final_validation_proofs WHERE job_id=j.id) proof_ticket,
    coalesce(x.version,0) input_version,e.id input_event_id,e.version input_event_version,e.confirmation_id input_confirmation_id,
    coalesce(h.event_count,0) content_count,
    EXISTS(SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=j.id AND
      (r.state='uncertain' OR r.state='effect_started' AND r.lease_expires_at<=?)) uncertain,
    EXISTS(SELECT 1 FROM draft_cleanup_records WHERE sermon_id=j.sermon_id) purged${totals}
    FROM generation_jobs j JOIN generation_full_v3_requests v ON v.job_id=j.id
    JOIN quiz_sets q ON q.id=j.quiz_set_id
    LEFT JOIN sermon_input_heads x ON x.sermon_id=j.sermon_id
    LEFT JOIN sermon_input_events e ON e.sermon_id=x.sermon_id AND e.version=x.version AND e.state='sealed'
    LEFT JOIN sermon_content_heads h ON h.sermon_id=j.sermon_id
    WHERE j.sermon_id=? AND j.id=(SELECT id FROM generation_jobs WHERE sermon_id=j.sermon_id AND request_scope='full'
      AND EXISTS(SELECT 1 FROM generation_full_v3_requests WHERE job_id=generation_jobs.id) ORDER BY created_at DESC,id DESC LIMIT 1)
    AND q.id=(SELECT id FROM quiz_sets WHERE sermon_id=j.sermon_id AND status IN ('draft','needs_revision','review_ready') ORDER BY created_at DESC,id DESC LIMIT 1)
    AND NOT EXISTS(SELECT 1 FROM quiz_withdrawals w WHERE w.quiz_set_id=q.id AND q.status='review_ready')`)
    .bind(new Date().toISOString(), ...(section === "costs" ? [since, since] : []), sermonId).first<Record<string, unknown>>();
  if (!row) return null; // Publication/withdrawal/idle retain their existing path.
  if (row.purged) throw new Error("CONTENT_DISPLAY_UNAVAILABLE");
  if (row.input_version && !row.input_event_id) throw new Error("CONTENT_DISPLAY_CORRUPT");
  const job = decodeGenerationLifecycleJob(row, { request_context_id: row.marker });
  const input = row.input_event_id === null ? null : displayInput.parse({ id: row.input_event_id, version: row.input_event_version, confirmation_id: row.input_confirmation_id });
  const contentCount = displayCount.parse(row.content_count);
  const base = adminContentViewSchema.parse({ enabled, quizSetId: job.quiz_set_id, jobId: job.id,
    version: displayCount.parse(row.input_version) + contentCount, status: row.uncertain ? "uncertain" : job.status,
    stage: job.current_step, content: { state: "absent" }, snapshots: [], preview: null,
    weekCostMicroUsd: row.week_cost ?? 0, weekUnknownCalls: row.week_unknown ?? 0, jobCostMicroUsd: row.job_cost ?? 0, jobUnknownCalls: row.job_unknown ?? 0,
    quizCostMicroUsd: row.quiz_cost ?? 0, quizUnknownCalls: row.quiz_unknown ?? 0 });
  return { job, input, contentCount, base, revision: displayRevision.parse(row.display_revision),
    selectedTicket: nullableDisplayId.parse(row.selected_ticket), selectedRevision: nullableSelectionRevision.parse(row.selected_revision),
    proofTicket: nullableDisplayId.parse(row.proof_ticket) };
}
const indexRow = z.object({ event_id: z.string(), content_sequence: z.int().positive(), quiz_set_id: z.string(),
  source_fingerprint: z.string(), payload_sha256: z.string(), state: z.literal("sealed"), dependencies: z.string(),
  kind: z.string().nullable(), value_kind: z.string().nullable(), value_id: z.string().nullable(), difficulty: z.string().nullable(),
  root_analysis_event_id: z.string().nullable() });
prepareInputSchema(indexRow);
const dependencyIds = prepareInputSchema(z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u)).max(32));
/** Small index only. Each body is subsequently SHA/schema checked by its own
 * snapshot request before the client marks the content section complete. */
async function manifest(db: D1Database, sermonId: string, quizSetId: string, current: Awaited<ReturnType<typeof readStoredCurrent>>, before?: number) {
  const page = (await db.prepare(`SELECT e.event_id,e.content_sequence FROM sermon_content_events e
    JOIN sermon_content_domain_lineage l ON l.sermon_id=e.sermon_id AND l.event_id=e.event_id
    LEFT JOIN sermon_content_human_events h ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id
    WHERE e.sermon_id=? AND e.state='sealed' AND (? IS NULL OR e.content_sequence<?)
    AND (e.origin='ai' OR h.operation IN ('intent_edit','summary_edit','summary_restore','candidate_edit','candidate_restore','candidate_set_status'))
    ORDER BY e.content_sequence DESC LIMIT 7`).bind(sermonId, before ?? null, before ?? null).all<{ event_id: string; content_sequence: number }>()).results;
  const ids = [...new Set([...(current ? [current.lastEventId, current.selectedAnalysisEventId, current.intentCritiqueEventId,
    current.intentConfirmationEventId, current.summarySnapshotEventId, current.summaryReviewEventId,
    current.childPoolEventId, current.childReviewEventId, current.adultPoolEventId, current.adultReviewEventId].filter((s): s is string => !!s) : []), ...page.slice(0, 6).map(s => s.event_id)])];
  const rows: z.infer<typeof indexRow>[] = [];
  for (let offset = 0; offset < ids.length;) {
    if (ids.length > 32) throw new Error("CONTENT_DISPLAY_LIMIT");
    const group = ids.slice(offset, offset + 10); offset += group.length;
    const found = (await db.prepare(`SELECT p.event_id,p.quiz_set_id,p.source_fingerprint,e.payload_sha256,e.state,e.content_sequence,l.root_analysis_event_id,
      json_extract(p.body_json,'$.dependencies') dependencies,json_extract(p.body_json,'$.snapshot.kind') kind,
      json_extract(p.body_json,'$.snapshot.value.kind') value_kind,json_extract(p.body_json,'$.snapshot.value.id') value_id,
      json_extract(p.body_json,'$.snapshot.value.difficulty') difficulty
      FROM generation_display_snapshots p JOIN sermon_content_events e ON e.sermon_id=p.sermon_id AND e.event_id=p.event_id
      JOIN sermon_content_domain_lineage l ON l.sermon_id=e.sermon_id AND l.event_id=e.event_id
      JOIN sermon_content_payloads m ON m.sermon_id=e.sermon_id AND m.event_id=e.event_id AND m.verified=1 AND m.payload_sha256=e.payload_sha256
      WHERE p.sermon_id=? AND p.event_id IN (${group.map(() => "?").join(",")})`).bind(sermonId, ...group).all()).results;
    if (found.length !== group.length) throw new Error("CONTENT_DISPLAY_NOT_PREPARED");
    for (const raw of found) {
      const row = indexRow.parse(raw);
      if (row.quiz_set_id !== quizSetId || row.source_fingerprint !== row.payload_sha256 || row.value_id && row.value_id !== row.event_id) throw new Error("CONTENT_DISPLAY_CORRUPT");
      rows.push(row);
      for (const id of dependencyIds.parse(JSON.parse(row.dependencies))) if (!ids.includes(id)) ids.push(id);
    }
  }
  rows.sort((a, b) => a.content_sequence - b.content_sequence);
  const selected = rows.find(r => r.event_id === current?.selectedAnalysisEventId);
  if (current?.selectedAnalysisEventId && (selected?.kind !== "intent" || !selected.root_analysis_event_id)) throw new Error("CONTENT_DISPLAY_CORRUPT");
  function slot(id: string | null | undefined, review: string | null | undefined, kind: string, difficulty?: string) {
    if (!id) return null;
    const row = rows.find(r => r.event_id === id);
    if (row?.kind !== kind || difficulty && row.difficulty !== difficulty) throw new Error("CONTENT_DISPLAY_CORRUPT");
    return { id, review: review ? { id: review } : null };
  }
  const content: AdminContentView["content"] = !current ? { state: "absent" } : { state: "present",
    intent: selected ? { selectedId: selected.event_id, rootAnalysisId: selected.root_analysis_event_id!, confirmation: current.intentConfirmationEventId ? { id: current.intentConfirmationEventId } : null } : null,
    summary: slot(current.summarySnapshotEventId, current.summaryReviewEventId, "summary"),
    child: slot(current.childPoolEventId, current.childReviewEventId, "candidate", "child"),
    adult: slot(current.adultPoolEventId, current.adultReviewEventId, "candidate", "adult") };
  return { content, snapshotIds: rows.filter(r => r.kind !== null).map(r => r.event_id),
    historyCursor: page.length > 6 ? page[5]!.content_sequence : null,
    snapshots: rows.filter(r => r.kind !== null).map(r => ({ kind: r.kind!, value: { id: r.event_id, kind: r.value_kind! }, provenance: { rootAnalysisId: r.root_analysis_event_id } })) };
}

export async function readContentGenerationParts(db: D1Database, sermonId: string, enabled: boolean,
  section: AdminContentSection, before?: number, snapshotId?: string, difficulty?: "child" | "adult"): Promise<AdminContentView | null> {
  // This response and its revision are entirely from one SQL snapshot; a
  // read coalescer or a second consistency query would add no consistency.
  if (section === "state" || section === "costs") {
    const h = await header(db, sermonId, enabled, section);
    return h ? { ...h.base, viewRevision: h.revision } : null;
  }
  db = generationReadSession(db);
  const [h, current, metadata] = await readTogether([header(db, sermonId, enabled),
    section === "content" || section === "placement" ? readStoredCurrent(db, sermonId) : Promise.resolve(null),
    section === "placement" ? readDisplayMetadata(db, sermonId) : Promise.resolve(null)]);
  if (!h) return null;
  const revision = h.revision;
  const owner = { sermonId, quizSetId: h.job.quiz_set_id };
  let result: AdminContentView;
  if (section === "activity") {
    result = adminContentViewSchema.parse({ ...h.base, regenerations: await readDisplayActivity(db, sermonId, owner.quizSetId) });
  } else if (section === "content") {
    if (!h.input?.confirmation_id || h.contentCount !== (current?.eventCount ?? 0)) throw new Error("CONTENT_DISPLAY_CORRUPT");
    if (snapshotId) {
      const [saved] = await readDisplaySnapshots(db, owner, [snapshotId]);
      if (!saved?.snapshot) throw new Error("CONTENT_DISPLAY_CORRUPT");
      result = parseDisplayView({ ...h.base, snapshots: [projectSnapshot(saved.snapshot)] });
    } else {
      const index = await manifest(db, sermonId, owner.quizSetId, current, before);
      const quality = await readLatestContentQuality(db, sermonId, index.snapshotIds);
      const recovery = h.job.status === "failed" ? await readRecoveryDisplay(db, sermonId, owner.quizSetId, index) : null;
      result = adminContentViewSchema.parse({ ...h.base, content: index.content, snapshotIds: index.snapshotIds,
        quality, historyCursor: index.historyCursor, recoveredAnalysisId: recovery?.analysisId ?? null, recoveredCritiqueId: recovery?.critiqueId ?? null });
    }
  } else if (section === "placement") {
    if (!metadata || !difficulty) return null;
    const ticketId = h.selectedTicket ?? h.proofTicket;
    if (!ticketId) {
      const request = await db.prepare(`SELECT json_extract((SELECT group_concat(CAST(body AS TEXT),'') FROM
        (SELECT body FROM generation_context_chunks WHERE context_id=c.id AND verified=1 ORDER BY position)), '$.authority.selection') selection
        FROM generation_contexts c JOIN generation_request_contexts r ON r.context_id=c.id AND r.fingerprint=c.fingerprint
        WHERE c.id=? AND c.job_id=? AND c.sermon_id=? AND c.quiz_set_id=? AND c.kind='request' AND c.state='sealed'`)
        .bind(h.job.request_context_id, h.job.id, sermonId, owner.quizSetId).first<{ selection: string }>();
      if (!request) throw new Error("GENERATION_JOB_UNAVAILABLE");
      const selection = generationAuthoritySnapshotSchema.shape.selection.parse(JSON.parse(request.selection));
      result = adminContentViewSchema.parse({ ...h.base, placement: selection.state === "present" ? {
        revision: selection.selectionRevision, metadataRevision: metadata.metadataRevision, selection: selection.value, selected: false, current: false } : null });
      if (revision !== await readViewRevision(db, sermonId)) throw new Error("CONTENT_DISPLAY_CHANGED");
      return { ...result, viewRevision: revision };
    }
    const saved = await readDisplayFinalPart(db, owner, ticketId, difficulty), ticket = saved.ticket;
    const quality = await readLatestContentQuality(db, sermonId, [ticket.binding.analysisId, ticket.summary.summaryId, ticket.placements.child.ticket.poolId, ticket.placements.adult.ticket.poolId]);
    const b = ticket.binding.transcript;
    const valid = !!current && ticket.expectedVersion === h.base.version && sameLifecycleValue(metadata, ticket.metadata) &&
      b.sourceId === current.input.sourceId && b.revisionId === current.input.documentId && b.transcriptSha256 === current.input.documentSha256 && b.confirmationId === current.input.confirmationId &&
      ticket.binding.analysisId === current.selectedAnalysisEventId && ticket.binding.intentConfirmationId === current.intentConfirmationEventId &&
      ticket.summary.summaryId === current.summarySnapshotEventId && ticket.summary.reviewId === current.summaryReviewEventId &&
      ticket.placements.child.ticket.poolId === current.childPoolEventId && ticket.placements.child.ticket.reviewId === current.childReviewEventId &&
      ticket.placements.adult.ticket.poolId === current.adultPoolEventId && ticket.placements.adult.ticket.reviewId === current.adultReviewEventId && !Object.values(quality).some(r => r.status === "regenerate");
    result = parseDisplayView({ ...h.base, placement: { revision: h.selectedRevision ?? h.job.selection_revision!, metadataRevision: metadata.metadataRevision,
      selection: { child: { options: ticket.placements.child.ticket.options, index: ticket.placements.child.index }, adult: { options: ticket.placements.adult.ticket.options, index: ticket.placements.adult.index } },
      selected: !!h.selectedTicket, current: valid }, layoutPart: { difficulty, layout: valid ? saved.layout : null, preview: valid ? saved.preview : null } });
  } else return null;
  // State returned above from one atomic SELECT. These parts perform more
  // reads, so confirm their revision again before returning them.
  if (revision !== await readViewRevision(db, sermonId)) throw new Error("CONTENT_DISPLAY_CHANGED");
  return { ...result, viewRevision: revision };
}
