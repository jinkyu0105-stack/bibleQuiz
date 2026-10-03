import type { AdminContentView } from "../../../shared/api/admin-content-generation";
import { readStoredCurrent } from "../repositories/human-content-runtime-store";
import { readDisplaySnapshots, type DisplaySnapshot } from "../repositories/generation-display-store";
import { createSermonInputStore } from "../repositories/sermon-input-store";
import { readTogether } from "../repositories/generation-read-session";
import { draftIsPurged } from "./draft-cleanup";
import { sameLifecycleValue } from "./generation-context-codec";

/** Presentation copies cannot create a DomainBasis/witness or authorize any
 * command. A GET reads saved snapshots; it never restores provider graphs. */
export async function readContentDisplay(db: D1Database, owner: { sermonId: string; quizSetId: string }, targets: string[]) {
  const input = createSermonInputStore(db);
  const [current, head, purged, contentHead] = await readTogether([readStoredCurrent(db, owner.sermonId), input.head(owner.sermonId), draftIsPurged(db, owner.sermonId),
    db.prepare("SELECT event_count,last_event_id FROM sermon_content_heads WHERE sermon_id=?").bind(owner.sermonId).first<{event_count: number; last_event_id: string}>()]);
  if (purged || !head?.confirmation_id) throw new Error("CONTENT_DISPLAY_UNAVAILABLE");
  if ((contentHead?.event_count ?? 0) !== (current?.eventCount ?? 0) || contentHead?.last_event_id !== current?.lastEventId) throw new Error("CONTENT_DISPLAY_CORRUPT");
  const refs = current;
  const pending = [...new Set([...(refs ? [refs.lastEventId, refs.selectedAnalysisEventId, refs.intentCritiqueEventId,
    refs.intentConfirmationEventId, refs.summarySnapshotEventId, refs.summaryReviewEventId, refs.childPoolEventId,
    refs.childReviewEventId, refs.adultPoolEventId, refs.adultReviewEventId].filter((id): id is string => !!id) : []), ...targets])];
  const snapshots = new Map<string, DisplaySnapshot>(), sequences = new Map<string, number>();
  for (let offset = 0; offset < pending.length;) {
    if (pending.length > 32) throw new Error("CONTENT_DISPLAY_LIMIT");
    const ids = pending.slice(offset, offset + 10); offset += ids.length;
    for (const saved of await readDisplaySnapshots(db, owner, ids)) {
      if (saved.snapshot) { snapshots.set(saved.snapshot.value.id, saved.snapshot); sequences.set(saved.snapshot.value.id, saved.sequence); }
      for (const dep of saved.dependencies) if (!pending.includes(dep)) pending.push(dep);
    }
  }
  const selected = refs?.selectedAnalysisEventId ? snapshots.get(refs.selectedAnalysisEventId) : null;
  if (refs && selected?.kind !== "intent") throw new Error("CONTENT_DISPLAY_CORRUPT");
  function slot(eventId: string | null | undefined, reviewId: string | null | undefined, kind: "summary" | "candidate", difficulty?: "child" | "adult") {
    if (!eventId) return null;
    const value = snapshots.get(eventId);
    if (value?.kind !== kind || difficulty && (value.kind !== "candidate" || value.value.difficulty !== difficulty)) throw new Error("CONTENT_DISPLAY_CORRUPT");
    return { id: eventId, review: reviewId ? { id: reviewId } : null };
  }
  const content: AdminContentView["content"] = !refs ? { state: "absent" } : {
    state: "present", intent: selected?.kind === "intent" ? { selectedId: selected.value.id, rootAnalysisId: selected.provenance.rootAnalysisId!,
      confirmation: refs.intentConfirmationEventId ? { id: refs.intentConfirmationEventId } : null } : null,
    summary: slot(refs.summarySnapshotEventId, refs.summaryReviewEventId, "summary"),
    child: slot(refs.childPoolEventId, refs.childReviewEventId, "candidate", "child"),
    adult: slot(refs.adultPoolEventId, refs.adultReviewEventId, "candidate", "adult"),
  };
  const [again, latestInput, removed] = await readTogether([readStoredCurrent(db, owner.sermonId), input.head(owner.sermonId), draftIsPurged(db, owner.sermonId)]);
  if (removed || !sameLifecycleValue(head, latestInput) || !sameLifecycleValue(current, again)) throw new Error("CONTENT_DISPLAY_CHANGED");
  return { content, snapshots: [...snapshots.values()].sort((a, b) => sequences.get(a.value.id)! - sequences.get(b.value.id)!),
    version: head.version + (refs?.eventCount ?? 0), sourceType: head.source_type };
}
