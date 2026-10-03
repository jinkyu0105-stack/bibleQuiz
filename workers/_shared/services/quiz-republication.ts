import type { RevisionBody } from "../../../shared/api/admin-quiz-revision";
import { revisionCommandSchema } from "../../../shared/api/admin-quiz-revision";
import { withdrawalReviewSchema } from "../../../shared/api/admin-withdraw";
import { publicPuzzleGridSchema } from "../../../shared/api/public-quiz";
import { validateLayout } from "../../../shared/puzzle/layout";
import { validateScoringSource } from "./submission-scoring";
import { hashRevision, requireQuizRevision, readQuizRevision, revisionAudit, checkRevisionBody } from "./quiz-revision";

export async function publishQuizRevision(db: D1Database, id: string, raw: unknown, actorEmail: string, now = new Date()) {
  const command = revisionCommandSchema.parse(raw);
  if (command.action !== "publish") throw new Error("REVISION_INVALID");
  const actor = await hashRevision(actorEmail), requestHash = await hashRevision(command);
  const prior = await db.prepare("SELECT request_sha256 hash,actor_digest actor,session_id sessionId FROM quiz_republications WHERE quiz_set_id=? AND request_key=?")
    .bind(id,command.requestKey).first<{ hash: string; actor: string; sessionId: string }>();
  if (prior) {
    if (prior.hash !== requestHash || prior.actor !== actor) throw new Error("REVISION_CONFLICT");
    // Replay reports the current state; it never reactivates an earlier publication.
    return readQuizRevision(db,id);
  }
  const { body, session, view } = await requireQuizRevision(db,id,command.sessionId,command.expectedRevision);
  const source = withdrawalReviewSchema.parse(JSON.parse(session.source));
  if (!view.canPublish || checkRevisionBody(body,source).length) throw new Error("REVISION_NOT_REVIEWED");
  const publishedAt = now.toISOString(), closesAt = new Date(now.getTime()+7*86_400_000).toISOString();
  const statements: D1PreparedStatement[] = [];
  statements.push(...await revisionVariantStatements(db,id,body,source,command.requestKey,session.reviewRevision,publishedAt));
  statements.push(db.prepare(`INSERT INTO quiz_republications(session_id,quiz_set_id,revision,draft_revision,request_key,request_sha256,actor_digest,body_sha256,
    slug,title,sermon_date,church_name,bible_reference_label,translation,bible_reading_url,summary,disclosure,display_revision,published_at,closes_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(session.id,id,session.reviewRevision,command.expectedRevision,command.requestKey,requestHash,actor,await hashRevision(body),
      source.slug,body.content.metadata.title,body.content.metadata.sermonDate,body.content.churchName,body.content.bibleReferenceLabel,source.translation,source.bibleReadingUrl,
      body.content.summary,source.disclosure,session.displayRevision,publishedAt,closesAt));
  statements.push(revisionAudit(db,id,"quiz_republished",actorEmail,publishedAt,{ cycle: session.cycle,revision: session.reviewRevision }));
  await db.batch(statements);
  return readQuizRevision(db,id);
}

export async function revisionVariantStatements(db: D1Database,id: string,body: RevisionBody,source: ReturnType<typeof withdrawalReviewSchema.parse>,requestKey: string,revision: number,publishedAt: string,
  levels: readonly ("child" | "adult")[] = ["child","adult"],resultsStatus = "valid",winnerCounts: Partial<Record<"child" | "adult",number>> = {}) {
  const statements: D1PreparedStatement[] = [];
  for (const level of levels) {
    const layout = body.layouts[level]!;
    const variantId = `rev-${requestKey}-${level}`;
    const grid = publicPuzzleGridSchema.parse({ ...layout.grid, entries: layout.grid.entries.map((entry,index) => ({ ...entry,id: `${variantId}-e${index}` })) });
    const solution = { cells: layout.solution.cells, entries: Object.fromEntries(layout.grid.entries.map((e,index) => [`${variantId}-e${index}`,layout.solution.entries[e.id]!])) };
    validateScoringSource({ grid,solution,canonicalCellOrder: grid.cells.map(c => c.id) });
    const warnings = validateLayout(grid.gridSize, grid.entries.map(entry => ({ entryId: entry.id,
      gridAnswer: solution.entries[entry.id]!, start: entry.start, direction: entry.direction }))).warnings?.map(warning => warning.message) ?? [];
    const storedGrid = { size: grid.gridSize, cells: Array.from({ length: grid.gridSize**2 },(_,i) => {
      const row = Math.floor(i/grid.gridSize),column = i%grid.gridSize;
      const starts = grid.entries.filter(e => e.start.row===row && e.start.column===column);
      return { row,column,isBlocked: !grid.cells.some(c => c.row===row && c.column===column),
        ...(starts.some(e => e.direction==="across") ? { acrossNumber: starts[0]!.number } : {}),
        ...(starts.some(e => e.direction==="down") ? { downNumber: starts[0]!.number } : {}) };
    }) };
    statements.push(db.prepare(`INSERT INTO quiz_variants(id,quiz_set_id,difficulty,revision,lifecycle_status,results_status,grid_size,public_grid_json,
      word_count,active_cell_count,intersection_count,winner_count,validation_report_json,created_at)
      VALUES(?,?,?,?, 'active',?,?,?,?,?,?,coalesce(?,(SELECT cast(value AS integer) FROM site_state WHERE key=?),(SELECT winner_count FROM quiz_variants WHERE quiz_set_id=? AND difficulty=? ORDER BY revision DESC LIMIT 1),3),?,?)`).bind(variantId,id,level,revision,resultsStatus,grid.gridSize,JSON.stringify(storedGrid),grid.entries.length,
        grid.cells.length,grid.entries.reduce((n,e) => n+e.length,0)-grid.cells.length,winnerCounts[level] ?? null,`top-n/${id}/${level}`,id,level,JSON.stringify({ errors: [],warnings,generatedAt: publishedAt }),publishedAt));
    for (const [index,entry] of grid.entries.entries()) {
      const originalId = layout.grid.entries[index]!.id;
      const original = source.variants.find(v => v.difficulty===level)!.entries.find(e => e.id===originalId)!;
      const edited = body.content[level].find(e => e.id===originalId)!;
      const grounding = edited.evidence.trim() ? { origin: "admin_context",note: edited.evidence,previous: original.grounding } : original.grounding;
      statements.push(db.prepare("INSERT INTO quiz_entries_public(id,quiz_variant_id,number,direction,start_row,start_col,length,clue,transcript_evidence_json,display_order) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(entry.id,variantId,entry.number,entry.direction,entry.start.row,entry.start.column,entry.length,entry.clue,JSON.stringify(grounding),index));
    }
    statements.push(db.prepare("INSERT INTO quiz_solutions(quiz_variant_id,canonical_cell_order_json,solution_cells_json,entry_answers_json,solution_sha256) VALUES(?,?,?,?,?)")
      .bind(variantId,JSON.stringify(grid.cells.map(c => c.id)),JSON.stringify(solution.cells),JSON.stringify(solution.entries),await hashRevision(solution)));
  }
  return statements;
}
