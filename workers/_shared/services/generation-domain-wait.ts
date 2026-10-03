import { readIntentDomain } from "./generation-domain-reader";
import { readVerifiedEvents } from "../repositories/human-content-runtime-store";
import { domainPreparedSchema, type DomainPrepared, type DomainBasis } from "./generation-domain-contract";
import { DOMAIN_STORAGE_BUDGET, domainStorageJson } from "../repositories/generation-domain-storage";
import { prepareHumanCommand } from "./generation-domain";
import { assessDomainIntentWait } from "./generation-domain-evidence";
import { assessGenerationWait } from "./generation-bridge";
import type { GenerationAuthoritySnapshot, GenerationWait } from "./generation-bridge-contract";

/** Replays the sealed human transitions through the same reducer. Only a proved
 * review invalidation chain may normalize a wait for the legacy lifecycle gate. */
export async function verifiedDomainWait(db: D1Database, wait: GenerationWait, current: GenerationAuthoritySnapshot): Promise<GenerationWait> {
  if (assessGenerationWait(wait, current).outcome !== "stale" || wait.kind !== "intent_review" ||
    wait.content.state !== "present" || current.content.state !== "present") return wait;
  const rows = await db.prepare("SELECT event_id FROM sermon_content_events WHERE sermon_id=? AND content_sequence>? AND content_sequence<=? ORDER BY content_sequence LIMIT 33")
    .bind(wait.sermonId, wait.content.eventCount, current.content.eventCount).all<{ event_id: string }>();
  if (rows.results.length > 32 || rows.results.length !== current.content.eventCount - wait.content.eventCount) return wait;
  try {
    const targets = rows.results.map(r => r.event_id);
    if (targets.length > DOMAIN_STORAGE_BUDGET.maxTargets) return wait;
    const captured = await readIntentDomain(db, { jobId: current.jobId, sermonId: current.sermonId, quizSetId: current.quizSetId }, { historyEventIds: [...targets, wait.content.lastEventId, ...[wait.content.summary, wait.content.child, wait.content.adult].flatMap(s => s?.review ? [s.review.id] : [])], existing: current });
    const events = await readVerifiedEvents(db, current.sermonId, targets), proofs: DomainPrepared[] = [];
    for (const event of events) {
      if (event.origin !== "human" || !event.payload || typeof event.payload !== "object" || !("command" in event.payload)) return wait;
      const p = domainPreparedSchema.parse(event.payload.command), version = p.expectedInput.version + (p.before.state === "present" ? p.before.eventCount : 0);
      const references = captured.basis.references.references.filter(r => r.kind === "input" || r.eventVersion <= version);
      const ids = new Set(references.map(r => r.eventId));
      const basis: DomainBasis = { ...captured.basis, context: p.context, authority: { ...current, content: p.before },
        targetIds: [], references: { referenceVersion: 2, references }, snapshots: captured.basis.snapshots.filter(s => ids.has(s.value.id)),
        humanRecords: captured.basis.humanRecords.filter(r => ids.has(r.id)), intentSelections: captured.basis.intentSelections.filter(s => s.atVersion <= version && ids.has(s.confirmationId)) };
      const prepared = await prepareHumanCommand(basis, { operation: p.operation }, p.event, DOMAIN_STORAGE_BUDGET);
      if (prepared.outcome !== "prepared" || domainStorageJson(prepared.value) !== domainStorageJson(p)) return wait;
      proofs.push(prepared.value);
    }
    if (assessDomainIntentWait(wait, current, proofs).outcome !== "ready") return wait;
    return { ...wait, content: { ...wait.content, summary: current.content.summary, child: current.content.child, adult: current.content.adult } };
  } catch { return wait; }
}
