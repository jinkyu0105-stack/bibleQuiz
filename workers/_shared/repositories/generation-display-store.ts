import { publicPuzzleGridSchema } from "../../../shared/api/public-quiz";
import { canonicalGenerationJson } from "../services/generation-context-codec";
import { prepareReadSchema, prepareInputSchema } from "../services/prepare-input-schema";
import { z } from "zod";
import { adminPlacementLayoutSchema } from "../../../shared/api/admin-placement";
import { domainSnapshotSchema, type DomainPrepared } from "../services/generation-domain-contract";
import { finalCheckPreviewSchema, finalCheckTicketSchema, type FinalCheckTicket } from "../services/final-check-contract";
import { fingerprintLifecycleValue } from "../services/generation-context-codec";
import { lifecycleId } from "../services/generation-lifecycle-contract";
import { candidateReplacementSchema } from "../services/sermon-candidates-contract";
import { sha256Bytes } from "../storage/sha256";

// The original command is verified before this copy is written. A display only
// needs its kind/replacement, not another copy of the generated analysis/draft.
// object() also reads previously prepared copies without revalidating the command.
const displayOperation = z.object({ kind: lifecycleId, replacement: candidateReplacementSchema.optional() });
const displaySnapshotSchema = z.discriminatedUnion("kind", [
  domainSnapshotSchema.options[0].omit({ operation: true }).extend({ operation: displayOperation }),
  domainSnapshotSchema.options[1].omit({ operation: true }).extend({ operation: displayOperation }),
  domainSnapshotSchema.options[2].omit({ operation: true }).extend({ operation: displayOperation }),
]);
export type DisplaySnapshot = z.infer<typeof displaySnapshotSchema>;
const snapshotProjection = z.strictObject({ snapshot: displaySnapshotSchema.nullable(), dependencies: z.array(lifecycleId).max(32) });
const finalPartProjection = z.strictObject({ ticket: finalCheckTicketSchema,
  preview: finalCheckPreviewSchema.pick({ metadata: true, summary: true }), layout: adminPlacementLayoutSchema });
const checkedLayouts = new WeakSet<object>();
const checkedGrids = new WeakSet<object>();
/** Private response composition accepts only objects already fully parsed here.
 * No external value or command can register itself. */
export const checkedDisplayLayoutSchema = z.custom<z.infer<typeof adminPlacementLayoutSchema>>(v =>
  v !== null && typeof v === "object" && checkedLayouts.has(v));
export const checkedDisplayGridSchema = z.custom<z.infer<typeof adminPlacementLayoutSchema>["grid"]>(v =>
  v !== null && typeof v === "object" && checkedGrids.has(v));
prepareReadSchema(snapshotProjection);
prepareReadSchema(finalPartProjection);
// Ticket leaves are built-in identifiers/counts/options, without text callbacks.
prepareInputSchema(finalCheckTicketSchema);
// Initialize the pure geometry/serialization code before the first HTTP read.
// The missing cells intentionally reject this grid. No accepted result, source,
// request, hash, database read/write or placement search is produced here.
publicPuzzleGridSchema.safeParse({ gridSize: 5, cells: [{ id: "r0c0", row: 0, column: 0, number: 1 }],
  entries: ["across", "down"].map(direction => ({ id: direction, number: 1, direction, start: { row: 0, column: 0 }, length: 2, clue: "INITIALIZE" })) });
canonicalGenerationJson({ initialization: ["INITIALIZE", 1, null] });
export type FinalDisplayPart = z.infer<typeof finalPartProjection>;
export type FinalDisplay = { ticket: FinalCheckTicket; preview: z.infer<typeof finalCheckPreviewSchema>;
  layouts: Record<"child" | "adult", z.infer<typeof adminPlacementLayoutSchema>> };
const digest = (text: string) => sha256Bytes(new TextEncoder().encode(text));

/** The offline archived-recovery tool is approved only through 0034. It must
 * keep writing that schema without silently adding an unrelated migration. */
export async function hasSnapshotDisplayStorage(db: D1Database) {
  return !!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='generation_display_snapshots'").first();
}

/** Called with the already verified domain command, in its existing atomic
 * write. Store only the materialization and display dependencies, not the graph. */
export async function snapshotDisplayStatement(db: D1Database, p: DomainPrepared, sourceFingerprint: string) {
  const snapshot = p.materializedSnapshot, op = p.operation.operation, dependencies: (string | null)[] = [];
  if (snapshot?.kind === "intent") dependencies.push(snapshot.provenance.rootAnalysisId, snapshot.value.critiqueId);
  for (const key of ["baseAnalysisId", "analysisId", "baseSummaryId", "summaryId", "basePoolId", "poolId"] as const)
    if (key in op) dependencies.push(Reflect.get(op, key) as string);
  if ("replacement" in op && op.replacement) dependencies.push(op.replacement.basePoolId);
  if (snapshot && snapshot.kind !== "intent") dependencies.push(snapshot.value.binding.analysisId, snapshot.value.binding.intentConfirmationId);
  for (const c of [p.before, p.after]) if (c.state === "present" && c.intent?.confirmation) dependencies.push(c.intent.selectedId, c.intent.confirmation.id);
  const body = JSON.stringify(snapshotProjection.parse({ snapshot: snapshot ? { ...snapshot, operation: {
    kind: snapshot.operation.kind,
    ...("replacement" in snapshot.operation && snapshot.operation.replacement ? { replacement: snapshot.operation.replacement } : {}),
  } } : null, dependencies: [...new Set(dependencies.filter((id): id is string => !!id))] }));
  return db.prepare(`INSERT INTO generation_display_snapshots(sermon_id,event_id,quiz_set_id,source_fingerprint,body_sha256,body_json)
    VALUES(?,?,?,?,?,?) ON CONFLICT(sermon_id,event_id) DO UPDATE SET
      quiz_set_id=excluded.quiz_set_id,source_fingerprint=excluded.source_fingerprint,body_sha256=excluded.body_sha256,body_json=excluded.body_json`)
    .bind(p.owner.sermonId, p.event.id, p.owner.quizSetId, sourceFingerprint, await digest(body), body);
}

/** No original context/chunks are restored on a GET. Check the small copy's
 * digest, owner and sealed source fingerprint. Commands still verify originals. */
export async function readDisplaySnapshots(db: D1Database, owner: { sermonId: string; quizSetId: string }, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.prepare(`SELECT p.*,e.content_sequence,e.payload_sha256,e.state,l.root_analysis_event_id
    FROM generation_display_snapshots p JOIN sermon_content_events e ON e.sermon_id=p.sermon_id AND e.event_id=p.event_id
    JOIN sermon_content_domain_lineage l ON l.sermon_id=e.sermon_id AND l.event_id=e.event_id
    JOIN sermon_content_payloads m ON m.sermon_id=e.sermon_id AND m.event_id=e.event_id AND m.verified=1 AND m.payload_sha256=e.payload_sha256
    WHERE p.sermon_id=? AND p.event_id IN (${ids.map(() => "?").join(",")})`)
    .bind(owner.sermonId, ...ids).all<{ event_id: string; quiz_set_id: string; source_fingerprint: string; body_sha256: string; body_json: string;
      content_sequence: number; payload_sha256: string; state: string; root_analysis_event_id: string | null }>();
  if (rows.results.length !== ids.length) throw new Error("CONTENT_DISPLAY_NOT_PREPARED");
  return Promise.all(rows.results.map(async row => {
    if (row.quiz_set_id !== owner.quizSetId || row.state !== "sealed" || row.source_fingerprint !== row.payload_sha256 ||
      await digest(row.body_json) !== row.body_sha256) throw new Error("CONTENT_DISPLAY_CORRUPT");
    const projection = snapshotProjection.parse(JSON.parse(row.body_json)), s = projection.snapshot;
    if (s && (s.value.id !== row.event_id || s.kind === "intent" && s.provenance.rootAnalysisId !== row.root_analysis_event_id)) throw new Error("CONTENT_DISPLAY_CORRUPT");
    return { ...projection, sequence: row.content_sequence };
  }));
}

/** Only store a result of the full final validation, never a browser supplied grid. */
export async function finalDisplayStatements(db: D1Database, owner: { sermonId: string; quizSetId: string }, ticketId: string,
  ticket: FinalCheckTicket, checked: Pick<FinalDisplay, "preview" | "layouts">) {
  return Promise.all((["child", "adult"] as const).map(difficulty => finalDisplayPartStatement(db, owner, ticketId, difficulty,
    { ticket, preview: { metadata: checked.preview.metadata, summary: checked.preview.summary }, layout: checked.layouts[difficulty] })));
}
export async function finalDisplayPartStatement(db: D1Database, owner: { sermonId: string; quizSetId: string }, ticketId: string,
  difficulty: "child" | "adult", part: FinalDisplayPart) {
  const ticket = part.ticket;
  if (ticket.sermonId !== owner.sermonId) throw new Error("CONTENT_DISPLAY_CORRUPT");
  const body = JSON.stringify(finalPartProjection.parse(part));
  return db.prepare(`INSERT INTO generation_display_finals(ticket_id,difficulty,sermon_id,quiz_set_id,source_fingerprint,body_sha256,body_json)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(ticket_id,difficulty) DO UPDATE SET
      sermon_id=excluded.sermon_id,quiz_set_id=excluded.quiz_set_id,source_fingerprint=excluded.source_fingerprint,body_sha256=excluded.body_sha256,body_json=excluded.body_json`)
    .bind(ticketId, difficulty, owner.sermonId, owner.quizSetId, await fingerprintLifecycleValue(ticket), await digest(body), body);
}

/** One difficulty per HTTP request. Uses the unchanged full part schema. */
export async function readDisplayFinalPart(db: D1Database, owner: {sermonId: string; quizSetId: string}, ticketId: string, difficulty: "child" | "adult") {
  const row = await db.prepare(`SELECT p.*,t.sermon_id source_sermon_id,t.quiz_set_id source_quiz_set_id,t.ticket_fingerprint,t.state
    FROM generation_display_finals p JOIN final_check_tickets t ON t.id=p.ticket_id WHERE p.ticket_id=? AND p.difficulty=?`)
    .bind(ticketId, difficulty).first<{sermon_id: string; quiz_set_id: string; source_sermon_id: string; source_quiz_set_id: string;
      state: string; source_fingerprint: string; ticket_fingerprint: string; body_json: string; body_sha256: string}>();
  if (!row) throw new Error("CONTENT_DISPLAY_NOT_PREPARED");
  if (row.sermon_id !== owner.sermonId || row.quiz_set_id !== owner.quizSetId || row.source_sermon_id !== owner.sermonId ||
    row.source_quiz_set_id !== owner.quizSetId || row.state !== "sealed" || row.source_fingerprint !== row.ticket_fingerprint ||
    await digest(row.body_json) !== row.body_sha256) throw new Error("CONTENT_DISPLAY_CORRUPT");
  const value = finalPartProjection.parse(JSON.parse(row.body_json));
  if (value.ticket.sermonId !== owner.sermonId || await fingerprintLifecycleValue(value.ticket) !== row.ticket_fingerprint) throw new Error("CONTENT_DISPLAY_CORRUPT");
  checkedLayouts.add(value.layout); checkedGrids.add(value.layout.grid);
  return value;
}

export async function readDisplayFinal(db: D1Database, owner: { sermonId: string; quizSetId: string }, ticketId: string) {
  const rows = await db.prepare(`SELECT p.*,t.sermon_id source_sermon_id,t.quiz_set_id source_quiz_set_id,t.ticket_fingerprint,t.state
    FROM generation_display_finals p JOIN final_check_tickets t ON t.id=p.ticket_id WHERE p.ticket_id=?`)
    .bind(ticketId).all<{ difficulty: "child" | "adult"; sermon_id: string; quiz_set_id: string; source_sermon_id: string; source_quiz_set_id: string;
      source_fingerprint: string; ticket_fingerprint: string; state: string; body_json: string; body_sha256: string }>();
  if (rows.results.length !== 2) throw new Error("CONTENT_DISPLAY_NOT_PREPARED");
  const parts: Partial<Record<"child" | "adult", FinalDisplayPart>> = {};
  let ticketJson: string | undefined;
  for (const row of rows.results) {
    if (row.sermon_id !== owner.sermonId || row.quiz_set_id !== owner.quizSetId || row.source_sermon_id !== owner.sermonId ||
    row.source_quiz_set_id !== owner.quizSetId || row.state !== "sealed" || row.source_fingerprint !== row.ticket_fingerprint ||
    await digest(row.body_json) !== row.body_sha256) throw new Error("CONTENT_DISPLAY_CORRUPT");
    const value = finalPartProjection.parse(JSON.parse(row.body_json));
    const json = JSON.stringify(value.ticket);
    if (value.ticket.sermonId !== owner.sermonId || (ticketJson === undefined
      ? await fingerprintLifecycleValue(value.ticket) !== row.ticket_fingerprint : json !== ticketJson)) throw new Error("CONTENT_DISPLAY_CORRUPT");
    ticketJson = json;
    checkedLayouts.add(value.layout); checkedGrids.add(value.layout.grid);
    parts[row.difficulty] = value;
  }
  if (!parts.child || !parts.adult || JSON.stringify(parts.child.preview) !== JSON.stringify(parts.adult.preview)) throw new Error("CONTENT_DISPLAY_CORRUPT");
  // Both parts have already passed the same schemas, owner and digest checks.
  // The API boundary validates the composed response; do not validate each grid
  // another two times merely to assemble these already checked values.
  const result: FinalDisplay = { ticket: parts.child.ticket, preview: { ...parts.child.preview,
    variants: { child: parts.child.layout.grid, adult: parts.adult.layout.grid } }, layouts: { child: parts.child.layout, adult: parts.adult.layout } };
  return result;
}
