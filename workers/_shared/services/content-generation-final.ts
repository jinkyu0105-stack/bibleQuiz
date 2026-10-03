import { readTogether, generationReadSession } from "../repositories/generation-read-session";
import { readPlacementSelection } from "../repositories/generation-placement-store";
import { createHumanContentRuntimeStore, fingerprintFinalCheckTicket } from "../repositories/human-content-runtime-store";
import { createGenerationLifecycleStore } from "../repositories/generation-lifecycle-store";
import { readIntentDomain } from "./generation-domain-reader";
import { domainTranscriptBinding } from "./generation-domain";
import { generationAggregateVersion } from "./generation-bridge";
import { finalCheckTicketSchema, type FinalCheckSelection, type FinalCheckTicket } from "./final-check-contract";
import { validateCurrentGenerationFinal } from "./generation-final-validation";

type Owner = { jobId: string; sermonId: string; quizSetId: string };
export async function captureContentFinalTicket(db: D1Database, owner: Owner, selection?: FinalCheckSelection) {
  return ticketFromRead(await readIntentDomain(db, owner), owner, selection);
}
function ticketFromRead(read: Awaited<ReturnType<typeof readIntentDomain>>, owner: Owner, selection?: FinalCheckSelection) {
  const a = read.basis.authority, c = a.content;
  if (a.scope !== "full" || a.input.state !== "present" || a.selection.state !== "present" || c.state !== "present" ||
    !c.intent?.confirmation || !c.summary?.review || !c.child?.review || !c.adult?.review) throw new Error("CONTENT_NOT_REVIEWED");
  const version = generationAggregateVersion(a)!;
  const choice = selection ?? a.selection.value;
  const binding = { transcript: domainTranscriptBinding(a.input, version), analysisId: c.intent.selectedId, intentConfirmationId: c.intent.confirmation.id };
  const placement = (difficulty: "child" | "adult") => {
    const slot = c[difficulty]!;
    return { index: choice[difficulty].index, ticket: { sermonId: owner.sermonId, difficulty, expectedVersion: version,
      poolId: slot.id, reviewId: slot.review!.id, binding: slot.binding, options: choice[difficulty].options } };
  };
  return finalCheckTicketSchema.parse({ sermonId: owner.sermonId, expectedVersion: version, metadata: a.metadata, binding,
    summary: { summaryId: c.summary.id, reviewId: c.summary.review.id, binding: c.summary.binding }, placements: { child: placement("child"), adult: placement("adult") } });
}

export async function saveContentFinalTicket(db: D1Database, owner: Owner, ticket: FinalCheckTicket) {
  const runtime = createHumanContentRuntimeStore(db);
  const fingerprints = await fingerprintFinalCheckTicket(ticket);
  // Content fingerprint allows safe replay and choosing a previously tested layout again.
  const [current, existing] = await readTogether([runtime.readCurrent(owner.sermonId),
    db.prepare("SELECT id FROM final_check_tickets WHERE ticket_fingerprint=?").bind(fingerprints.ticketFingerprint).first<{ id: string }>()]);
  if (!current || current.status !== "current" || current.input.version + current.current.eventCount !== ticket.expectedVersion) throw new Error("PLACEMENT_STALE");
  if (existing) {
    const saved = await runtime.readFinalTicket(existing.id);
    if (saved?.status !== "current" || saved.row.quiz_set_id !== owner.quizSetId) throw new Error("PLACEMENT_STALE");
    return existing.id;
  }
  const ticketId = `layout-${fingerprints.ticketFingerprint}`;
  const saved = await runtime.commitFinalTicket({ ticketId, sermonId: owner.sermonId, quizSetId: owner.quizSetId, createdAt: new Date().toISOString(),
    expectedInput: current.input, expectedCurrent: current.current, expectedMetadataRevision: ticket.metadata.metadataRevision,
    expectedTicketFingerprint: fingerprints.ticketFingerprint, inputs: { intentConfirmationEventId: ticket.binding.intentConfirmationId,
      summarySnapshotEventId: ticket.summary.summaryId, summaryReviewEventId: ticket.summary.reviewId,
      childPoolEventId: ticket.placements.child.ticket.poolId, childReviewEventId: ticket.placements.child.ticket.reviewId,
      adultPoolEventId: ticket.placements.adult.ticket.poolId, adultReviewEventId: ticket.placements.adult.ticket.reviewId,
      childPlacementTicketFingerprint: fingerprints.childPlacementTicketFingerprint, adultPlacementTicketFingerprint: fingerprints.adultPlacementTicketFingerprint,
      childSelectionIndex: ticket.placements.child.index, adultSelectionIndex: ticket.placements.adult.index }, payload: ticket }, current);
  if (saved.status !== "current") throw new Error("PLACEMENT_STALE");
  return saved.ticketId;
}

/** Explicit final check. No provider call, publication or public write. */
export async function finishContentGeneration(db: D1Database, owner: Owner) {
  db = generationReadSession(db);
  const lifecycle = createGenerationLifecycleStore(db);
  let ticket: FinalCheckTicket, captured: Awaited<ReturnType<typeof readIntentDomain>>;
  let prepared: Awaited<ReturnType<typeof lifecycle.prepareReviewedFull>>;
  let selected: Awaited<ReturnType<typeof readPlacementSelection>>;
  try {
    [captured, prepared, selected] = await readTogether([readIntentDomain(db, owner), lifecycle.prepareReviewedFull(owner.jobId), readPlacementSelection(db, owner.jobId)]);
    ticket = ticketFromRead(captured, owner);
  }
  catch { return { outcome: "not_ready" as const }; }
  const job = prepared.initial;
  if (selected?.ticket.status === "current" && selected.ticket.row.ticket_fingerprint !== (await fingerprintFinalCheckTicket(ticket)).ticketFingerprint) return { outcome: "stale" as const };
  if (job.status === "running" && job.current_step === "content_review") {
    const ticketId = selected?.ticket.status === "current" ? selected.row.ticket_id : await saveContentFinalTicket(db, owner, ticket);
    const completed = await lifecycle.completeReviewedFull(captured.basis.authority, ticketId, new Date().toISOString(), prepared);
    return { ...completed, outcome: ["saved", "replayed"].includes(completed.outcome) ? "review_ready" :
      completed.outcome === "not_ready" ? "needs_revision" : completed.outcome };
  }
  // Preserve recovery of jobs already between the old individual transitions.
  const checked = await validateCurrentGenerationFinal(db, ticket);
  if (checked.outcome !== "passed") return { outcome: "needs_revision" as const };
  if (job.status === "review_ready") return { outcome: "review_ready" as const, preview: checked.preview };
  const ticketId = selected?.ticket.status === "current" ? selected.row.ticket_id : await saveContentFinalTicket(db, owner, ticket);
  for (const stage of ["place_child", "place_adult", "final_validate"] as const) {
    const advanced = await lifecycle.advance(owner.jobId, job.request_context_id, stage, new Date().toISOString());
    if (!["saved", "replayed"].includes(advanced.outcome)) return advanced;
  }
  const validated = await lifecycle.completeFinalValidation((await readIntentDomain(db, owner, { existing: captured.basis.authority })).basis.authority, ticketId, new Date().toISOString());
  if (!["saved", "replayed"].includes(validated.outcome)) return validated;
  const finished = await lifecycle.finish((await readIntentDomain(db, owner, { existing: captured.basis.authority })).basis.authority, new Date().toISOString());
  return { outcome: ["saved", "replayed"].includes(finished.outcome) ? "review_ready" as const : finished.outcome,
    ...(["saved", "replayed"].includes(finished.outcome) ? { preview: checked.preview } : {}) };
}
