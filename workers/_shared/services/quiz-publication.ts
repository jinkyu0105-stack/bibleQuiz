import { adminPublishRequestSchema, adminPublishDataSchema } from "../../../shared/api/admin-publish";
import { publicPuzzleGridSchema, publicSermonSchema } from "../../../shared/api/public-quiz";
import { validateScoringSource } from "./submission-scoring";
import { validateCurrentGenerationFinal } from "./generation-final-validation";
import { createHumanContentRuntimeStore } from "../repositories/human-content-runtime-store";
import { readPlacementSelection } from "../repositories/generation-placement-store";
import { readIntentDomain } from "./generation-domain-reader";
import { OPENAI_DRAFT_PROMPT_VERSION } from "./openai-draft-transport";
import { sha256Bytes } from "../storage/sha256";

const enc = new TextEncoder();
const digest = (value: unknown) => sha256Bytes(enc.encode(JSON.stringify(value)));

/** One explicit administrator action. All public rows and the featured pointer commit together. */
export async function publishReviewedQuiz(db: D1Database, quizSetId: string, raw: unknown, actor: string, now = new Date()) {
  const command = adminPublishRequestSchema.parse(raw);
  if (!/^[0-9a-f]{64}$/u.test(actor) || !Number.isFinite(now.getTime())) throw new Error("PUBLICATION_INVALID");
  const prior = await db.prepare("SELECT p.quiz_set_id quizSetId,p.slug,p.published_at publishedAt,q.published_at currentPublishedAt,q.closes_at closesAt,p.generation_job_id jobId,p.published_by_digest actor,p.request_key requestKey,p.input_version+p.content_event_count version,p.metadata_revision metadataRevision,p.selection_revision selectionRevision FROM published_quiz_content p JOIN quiz_sets q ON q.id=p.quiz_set_id WHERE p.quiz_set_id=?")
    .bind(quizSetId).first<{ quizSetId: string; slug: string; publishedAt: string; currentPublishedAt: string; closesAt: string; jobId: string; actor: string; requestKey: string; version: number; metadataRevision: number; selectionRevision: number }>();
  if (prior) {
    if (prior.currentPublishedAt !== prior.publishedAt || prior.jobId !== command.jobId || prior.actor !== actor || prior.requestKey !== command.requestKey ||
      prior.version !== command.expectedVersion || prior.metadataRevision !== command.expectedMetadataRevision || prior.selectionRevision !== command.expectedSelectionRevision ||
      !["published", "archived"].includes((await db.prepare("SELECT status FROM quiz_sets WHERE id=?").bind(quizSetId).first<{ status: string }>())?.status ?? "")) throw new Error("PUBLICATION_CONFLICT");
    return adminPublishDataSchema.parse({ outcome: "replayed", quizSetId, slug: prior.slug, publishedAt: prior.publishedAt, closesAt: prior.closesAt });
  }
  const job = await db.prepare("SELECT sermon_id sermonId,quiz_set_id quizSetId,status,current_step currentStep,selection_revision selectionRevision FROM generation_jobs WHERE id=? AND request_scope='full' AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=generation_jobs.id)")
    .bind(command.jobId).first<{ sermonId: string; quizSetId: string; status: string; currentStep: string; selectionRevision: number }>();
  if (!job || job.quizSetId !== quizSetId || job.status !== "review_ready" || job.currentStep !== "finish") throw new Error("PUBLICATION_NOT_READY");
  const base = await db.prepare("SELECT q.status,s.slug_suffix suffix,s.slug,s.church_name churchName FROM quiz_sets q JOIN sermons s ON s.id=q.sermon_id WHERE q.id=? AND q.sermon_id=?")
    .bind(quizSetId, job.sermonId).first<{ status: string; suffix: string; slug: string | null; churchName: string }>();
  if (!base || !["draft", "needs_revision", "review_ready"].includes(base.status) || !/^[a-z0-9]{6}$/u.test(base.suffix)) throw new Error("PUBLICATION_NOT_READY");
  const selected = await readPlacementSelection(db, command.jobId);
  const proof = await db.prepare("SELECT ticket_id ticketId FROM generation_final_validation_proofs WHERE job_id=?")
    .bind(command.jobId).first<{ ticketId: string }>();
  if (!proof) throw new Error("PUBLICATION_NOT_READY");
  const ticket = selected?.ticket ?? await createHumanContentRuntimeStore(db).readFinalTicket(proof.ticketId);
  const revision = selected?.row.revision ?? job.selectionRevision;
  if (!ticket || ticket.status !== "current" || ticket.row.quiz_set_id !== quizSetId ||
    ticket.payload.expectedVersion !== command.expectedVersion ||
    ticket.payload.metadata.metadataRevision !== command.expectedMetadataRevision ||
    revision !== command.expectedSelectionRevision) throw new Error("PUBLICATION_STALE");
  const checked = await validateCurrentGenerationFinal(db, ticket.payload);
  if (checked.outcome !== "passed") throw new Error("PUBLICATION_STALE");
  publicSermonSchema.parse({ ...checked.preview.metadata, churchName: base.churchName, summary: checked.preview.summary });
  const slug = `${checked.preview.metadata.date}-${base.suffix}`;
  if (base.slug !== null && base.slug !== slug) throw new Error("PUBLICATION_CONFLICT");
  const publishedAt = now.toISOString(), closesAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString();
  const existingVariants = await db.prepare("SELECT count(*) n FROM quiz_variants WHERE quiz_set_id=?").bind(quizSetId).first<{ n: number }>();
  if (!existingVariants || existingVariants.n !== 0) throw new Error("PUBLICATION_CONFLICT");
  const usage = await db.prepare(`SELECT c.task,c.provider,c.model,c.input_fingerprint inputFingerprint,coalesce(u.input_tokens,old.input_tokens) inputTokens,coalesce(u.output_tokens,old.output_tokens) outputTokens,
    coalesce(u.estimated_cost_micro_usd,old.estimated_cost_micro_usd) costMicroUsd,coalesce(u.pricing_version,old.pricing_version) pricingVersion FROM ai_provider_calls c
    LEFT JOIN ai_usage_observations u ON u.call_id=c.id LEFT JOIN ai_usage_events old ON old.provider_call_id=c.id WHERE c.quiz_set_id=? ORDER BY c.started_at,c.id`)
    .bind(quizSetId).all();
  if (!usage.success) throw new Error("PUBLICATION_UNAVAILABLE");
  const domain = await readIntentDomain(db, { jobId: command.jobId, sermonId: job.sermonId, quizSetId },
    { targets: [ticket.payload.placements.child.ticket.poolId, ticket.payload.placements.adult.ticket.poolId] });
  const provenance = JSON.stringify({ contractVersion: 1, draftContractAtPublication: { promptVersion: OPENAI_DRAFT_PROMPT_VERSION, schemaVersion: "task_v4" }, calls: usage.results.map(row => ({ task: row.task, provider: row.provider,
    model: row.model, inputFingerprint: row.inputFingerprint, promptVersion: null, schemaVersion: null, inputTokens: row.inputTokens, outputTokens: row.outputTokens, costMicroUsd: row.costMicroUsd, pricingVersion: row.pricingVersion })) });
  const statements: D1PreparedStatement[] = [];
  for (const level of ["child", "adult"] as const) {
    const layout = checked.layouts[level], reviewedGrid = publicPuzzleGridSchema.parse(checked.preview.variants[level]);
    if (JSON.stringify(reviewedGrid) !== JSON.stringify(layout.grid) || layout.wordCount !== reviewedGrid.entries.length ||
      layout.activeCellCount !== reviewedGrid.cells.length) throw new Error("PUBLICATION_INVALID");
    const variantId = `pub-${command.requestKey}-${level}`;
    const poolId = ticket.payload.placements[level].ticket.poolId;
    const pool = domain.basis.snapshots.find(snapshot => snapshot.kind === "candidate" && snapshot.value.id === poolId);
    if (!pool || pool.kind !== "candidate") throw new Error("PUBLICATION_INVALID");
    const originalCandidates = [...pool.value.draft.candidates].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const grid = publicPuzzleGridSchema.parse({ ...reviewedGrid, entries: reviewedGrid.entries.map(entry => ({ ...entry, id: `${variantId}-${entry.id}` })) });
    const solution = { cells: layout.solution.cells, entries: Object.fromEntries(reviewedGrid.entries.map(entry => {
      const answer = layout.solution.entries[entry.id];
      if (!answer) throw new Error("PUBLICATION_INVALID");
      return [`${variantId}-${entry.id}`, answer];
    })) };
    validateScoringSource({ grid, solution, canonicalCellOrder: grid.cells.map(cell => cell.id) });
    const active = new Map(grid.cells.map(cell => [cell.id, cell]));
    const storedGrid = { size: grid.gridSize, cells: Array.from({ length: grid.gridSize ** 2 }, (_, index) => {
      const row = Math.floor(index / grid.gridSize), column = index % grid.gridSize, cell = active.get(`r${row}c${column}`);
      const starts = grid.entries.filter(entry => entry.start.row === row && entry.start.column === column);
      return { row, column, isBlocked: !cell,
        ...(starts.some(entry => entry.direction === "across") ? { acrossNumber: cell?.number } : {}),
        ...(starts.some(entry => entry.direction === "down") ? { downNumber: cell?.number } : {}) };
    }) };
    const crossing = grid.entries.reduce((sum, entry) => sum + entry.length, 0) - grid.cells.length;
    if (crossing !== layout.crossingCellCount) throw new Error("PUBLICATION_INVALID");
    statements.push(db.prepare(`INSERT INTO quiz_variants(id,quiz_set_id,difficulty,revision,lifecycle_status,results_status,grid_size,public_grid_json,
      word_count,active_cell_count,intersection_count,winner_count,validation_report_json,created_at)
      VALUES(?,?,?,1,'active','valid',?,?,?,?,?,coalesce((SELECT cast(value as integer) FROM site_state WHERE key=?),3),?,?)`).bind(variantId, quizSetId, level, grid.gridSize, JSON.stringify(storedGrid),
      grid.entries.length, grid.cells.length, crossing, `top-n/${quizSetId}/${level}`, JSON.stringify({ errors: [], warnings: layout.warnings ?? [], generatedAt: publishedAt }), publishedAt));
    for (const [index, entry] of grid.entries.entries()) {
      const ordinal = Number(new RegExp(`^${variantId}-entry-(\\d+)$`, "u").exec(entry.id)?.[1]);
      const grounding = originalCandidates[ordinal - 1]?.grounding;
      if (!grounding) throw new Error("PUBLICATION_INVALID");
      statements.push(db.prepare(`INSERT INTO quiz_entries_public
        (id,quiz_variant_id,number,direction,start_row,start_col,length,clue,transcript_evidence_json,display_order)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(entry.id, variantId, entry.number, entry.direction, entry.start.row, entry.start.column,
        entry.length, entry.clue, JSON.stringify(grounding), index));
    }
    statements.push(db.prepare(`INSERT INTO quiz_solutions(quiz_variant_id,canonical_cell_order_json,solution_cells_json,entry_answers_json,solution_sha256)
      VALUES(?,?,?,?,?)`).bind(variantId, JSON.stringify(grid.cells.map(cell => cell.id)), JSON.stringify(solution.cells),
      JSON.stringify(solution.entries), await digest(solution)));
  }
  statements.push(db.prepare(`INSERT INTO published_quiz_content(quiz_set_id,slug,title,sermon_date,church_name,bible_reference_label,translation,
    bible_reading_url,summary,disclosure,source_sha256,input_version,content_event_count,metadata_revision,selection_revision,
    request_key,ticket_fingerprint,generation_job_id,provenance_json,published_by_digest,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(quizSetId, slug, checked.preview.metadata.title, checked.preview.metadata.date, base.churchName,
      checked.preview.metadata.bibleReferenceLabel, checked.preview.metadata.translation, checked.preview.metadata.bibleReadingUrl,
      checked.preview.summary.text, checked.preview.summary.disclosure, ticket.payload.binding.transcript.sourceSha256,
      ticket.row.input_version, ticket.row.content_event_count, ticket.row.metadata_revision, revision,
      command.requestKey, ticket.row.ticket_fingerprint, command.jobId, provenance, actor, publishedAt));
  statements.push(db.prepare(`UPDATE quiz_sets SET status='published',submission_state='open',published_at=?,opens_at=?,closes_at=?,
    published_from_revision_number=?,updated_at=? WHERE id=? AND status IN ('draft','needs_revision','review_ready')`)
    .bind(publishedAt, publishedAt, closesAt, command.expectedVersion, publishedAt, quizSetId));
  statements.push(db.prepare("UPDATE sermons SET slug=? WHERE id=? AND slug IS NULL").bind(slug, job.sermonId));
  statements.push(db.prepare(`INSERT INTO site_state(key,value,updated_at) VALUES('featured_quiz_set_id',?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(quizSetId, publishedAt));
  await db.batch(statements);
  return adminPublishDataSchema.parse({ outcome: "published", quizSetId, slug, publishedAt, closesAt });
}
