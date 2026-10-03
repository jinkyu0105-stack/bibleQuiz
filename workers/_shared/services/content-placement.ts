import { adminPlacementTrialRequestSchema, adminPlacementTrialSchema, adminPlacementSelectRequestSchema } from "../../../shared/api/admin-placement";
import { searchCandidatePool } from "../../../shared/puzzle/pool-search";
import { presentPlacement } from "./placement-presentation";
import { readPlacementSelection } from "../repositories/generation-placement-store";
import { readIntentDomain } from "./generation-domain-reader";
import { generationAggregateVersion } from "./generation-bridge";
import { sameLifecycleValue } from "./generation-context-codec";
import { captureContentFinalTicket, saveContentFinalTicket } from "./content-generation-final";
import { validateCurrentGenerationFinal } from "./generation-final-validation";
import { lifecycleDigest } from "./generation-lifecycle-contract";
import { createHumanContentRuntimeStore } from "../repositories/human-content-runtime-store";
import { finalDisplayStatements } from "../repositories/generation-display-store";

type Owner = { jobId: string; sermonId: string; quizSetId: string };
type Basis = { expectedVersion: number; expectedMetadataRevision: number; expectedSelectionRevision: number };
async function current(db: D1Database, owner: Owner, command: Basis) {
  const read = await readIntentDomain(db, owner), a = read.basis.authority;
  const latest = await db.prepare("SELECT id FROM generation_jobs WHERE sermon_id=? AND request_scope='full' ORDER BY created_at DESC,id DESC LIMIT 1")
    .bind(owner.sermonId).first<{ id: string }>();
  if (latest?.id !== owner.jobId || a.scope !== "full" || !["running", "review_ready"].includes(a.status) ||
    generationAggregateVersion(a) !== command.expectedVersion || a.metadata.metadataRevision !== command.expectedMetadataRevision ||
    a.selection.state !== "present" || a.selection.selectionRevision !== command.expectedSelectionRevision ||
    a.content.state !== "present" || !a.content.intent?.confirmation || !a.content.summary?.review || !a.content.child?.review || !a.content.adult?.review) throw new Error("PLACEMENT_STALE");
  return read;
}

/** Private administrator response. Only serializePublicPuzzle is used for the public grid. */
export async function trialContentPlacement(db: D1Database, owner: Owner, raw: unknown) {
  const command = adminPlacementTrialRequestSchema.parse(raw), read = await current(db, owner, command);
  const content = read.basis.authority.content;
  if (content.state !== "present") throw new Error("PLACEMENT_STALE");
  const slot = content[command.difficulty];
  const snapshot = read.basis.snapshots.find(s => s.kind === "candidate" && s.value.id === slot?.id);
  if (!snapshot || snapshot.kind !== "candidate") throw new Error("PLACEMENT_NOT_REVIEWED");
  const candidates = [...snapshot.value.draft.candidates].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map((candidate, i) => ({ id: `entry-${i + 1}`, displayAnswer: candidate.displayAnswer, gridAnswer: candidate.gridAnswer,
      clue: candidate.clue, status: snapshot.value.statuses[candidate.id]!, phrase: candidate.phraseDescription }));
  const trial = searchCandidatePool({ ...command.options, candidates });
  await current(db, owner, command);
  return adminPlacementTrialSchema.parse({ ...command, layouts: trial.layouts.map((layout, index) => presentPlacement(layout, index, candidates)),
    searchIncomplete: trial.searchIncomplete, reasons: [...new Set(trial.attempts.flatMap(a => a.reasons.map(r => r.message)))] });
}

export async function selectContentPlacement(db: D1Database, owner: Owner, raw: unknown, actor: string) {
  const command = adminPlacementSelectRequestSchema.parse(raw); lifecycleDigest.parse(actor);
  const prior = await db.prepare("SELECT job_id,revision,ticket_id,actor_digest FROM generation_placement_selections WHERE id=?")
    .bind(command.requestKey).first<{ job_id: string; revision: number; ticket_id: string; actor_digest: string }>();
  if (prior) {
    const saved = await createHumanContentRuntimeStore(db).readFinalTicket(prior.ticket_id);
    if (prior.job_id !== owner.jobId || prior.actor_digest !== actor || prior.revision !== command.expectedSelectionRevision + 1 ||
      !saved || saved.payload.sermonId !== owner.sermonId || saved.row.quiz_set_id !== owner.quizSetId ||
      saved.payload.expectedVersion !== command.expectedVersion || saved.payload.metadata.metadataRevision !== command.expectedMetadataRevision ||
      !sameLifecycleValue(command.selection, { child: { options: saved.payload.placements.child.ticket.options, index: saved.payload.placements.child.index },
        adult: { options: saved.payload.placements.adult.ticket.options, index: saved.payload.placements.adult.index } })) throw new Error("PLACEMENT_REQUEST_CONFLICT");
    const latest = await readPlacementSelection(db, owner.jobId);
    return { outcome: "replayed" as const, current: saved.status === "current" && latest?.row.id === command.requestKey };
  }
  await current(db, owner, command);
  const ticket = await captureContentFinalTicket(db, owner, command.selection);
  const checked = await validateCurrentGenerationFinal(db, ticket);
  if (checked.outcome !== "passed") throw new Error("PLACEMENT_NOT_READY");
  const ticketId = await saveContentFinalTicket(db, owner, ticket);
  await current(db, owner, command);
  // The insert trigger compares the current heads, metadata, editable quiz and predecessor revision atomically.
  await db.batch([db.prepare("INSERT INTO generation_placement_selections(id,job_id,revision,ticket_id,actor_digest,created_at) VALUES(?,?,?,?,?,?)")
    .bind(command.requestKey, owner.jobId, command.expectedSelectionRevision + 1, ticketId, actor, new Date().toISOString()),
    ...await finalDisplayStatements(db, owner, ticketId, ticket, checked)]);
  return { outcome: "saved" as const, current: true };
}
