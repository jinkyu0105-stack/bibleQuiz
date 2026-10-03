import { archivedIntentRecoveryPinSchema, prepareArchivedIntentRecovery } from "./archived-intent-recovery";
import { lifecycleDigest, lifecycleTime } from "./generation-lifecycle-contract";
import { createGenerationLifecycleStore } from "../repositories/generation-lifecycle-store";
import { archivedIntentRecoveryRowSchema, readArchivedIntentRecovery, verifyArchivedIntentRecovery } from "../repositories/archived-intent-recovery-store";
import { prepareLifecycleArtifact } from "../repositories/generation-lifecycle-artifact";
import { sqlAccess } from "../repositories/generation-lifecycle-data";
import { sameLifecycleValue as same } from "./generation-context-codec";
import { prepareReadIntentResult, readIntentDomain } from "./generation-domain-reader";
import { sha256Bytes } from "../storage/sha256";

const hash = (text: string) => sha256Bytes(new TextEncoder().encode(text));
/** Explicit local operator action. Always revalidates the original archive; a
 * serialized preparation package is not accepted. No provider call or dispatch. */
export async function commitArchivedIntentRecovery(db: D1Database, rawPin: unknown, requestText: string, responseText: string,
  actorDigest: string, now: string) {
  try {
    const pin = archivedIntentRecoveryPinSchema.parse(rawPin);
    lifecycleDigest.parse(actorDigest); lifecycleTime.parse(now);
    if (await hash(requestText) !== pin.requestSha256 || await hash(responseText) !== pin.responseSha256)
      return { outcome: "conflict" as const };
    const owner = { jobId: pin.sourceJobId, sermonId: pin.sermonId, quizSetId: pin.quizSetId };
    const prior = await db.prepare("SELECT event_id FROM generation_archived_intent_recoveries WHERE source_job_id=?")
      .bind(pin.sourceJobId).first<{ event_id: string }>();
    async function verifiedReplay(eventId: string) {
      const r = await readArchivedIntentRecovery(db, owner.sermonId, eventId);
      if (!r || r.quiz_set_id !== owner.quizSetId || r.source_job_id !== owner.jobId || r.actor_digest !== actorDigest ||
        r.attempt !== pin.attempt || r.request_sha256 !== pin.requestSha256 || r.response_sha256 !== pin.responseSha256 ||
        r.instructions_sha256 !== pin.instructionsSha256) return { outcome: "conflict" as const };
      // Includes stored payload hash, source failed outcome and settled usage checks.
      const read = await readIntentDomain(db, owner, { targets: [eventId] });
      if (!read.basis.snapshots.some(s => s.value.id === eventId &&
        (s.kind === "intent" && ["analysis", "critique"].includes(s.value.kind) || s.kind === "summary" && s.value.kind === "generate")))
        return { outcome: "unavailable" as const };
      return { outcome: "replayed" as const, eventId, providerCalls: 0 as const };
    }
    if (prior) return verifiedReplay(prior.event_id);
    const checked = await prepareArchivedIntentRecovery(db, pin, requestText, responseText);
    if (checked.outcome !== "ready_for_local_review") return { outcome: "not_ready" as const, code: checked.code };
    const p = checked.package, source = p.source, captured = await readIntentDomain(db, owner);
    if (!same(captured.basis.authority, p.expectedAuthority)) return { outcome: "conflict" as const };
    const store = createGenerationLifecycleStore(db), step = await store.readContext(source.context.contextId);
    if (step.outcome !== "present" || step.value.context.kind !== "step") return { outcome: "unavailable" as const };
    const request = { task: p.result.task, context: p.result.context, input: JSON.parse(JSON.parse(JSON.parse(requestText).body).input) };
    const prepared = await prepareReadIntentResult(captured.basis, source.context, { request, result: p.result },
      { id: p.recoveryId, actorDigest, createdAt: now });
    if (prepared.outcome !== "prepared") return { outcome: "not_ready" as const, code: "CONTENT_INVALID" as const };
    const artifact = await prepareLifecycleArtifact(db, step.value.context,
      { id: p.recoveryId, actorDigest: null, payload: prepared.value }, now, source.context.contextId);
    const row = archivedIntentRecoveryRowSchema.parse({ event_id: p.recoveryId, sermon_id: owner.sermonId, quiz_set_id: owner.quizSetId,
      source_job_id: owner.jobId, context_id: source.context.contextId, context_fingerprint: source.context.fingerprint,
      attempt: pin.attempt, call_id: source.callId, usage_id: source.usageId, request_sha256: pin.requestSha256,
      response_sha256: pin.responseSha256, instructions_sha256: pin.instructionsSha256,
      payload_sha256: artifact.reference.fingerprint, actor_digest: actorDigest, created_at: now });
    if (!await verifyArchivedIntentRecovery(db, row, prepared.value)) return { outcome: "unavailable" as const };
    const sql = sqlAccess(db);
    // 0030 guards recheck source/settlement, current input/content/metadata,
    // selection, unpublished quiz, cleanup and concurrent jobs in this same batch.
    // The deferred FK forces the receipt and sealed content event to commit together.
    const saved = await sql.batch([sql.insert("generation_archived_intent_recoveries", row), ...artifact.statements]);
    const found = await readArchivedIntentRecovery(db, owner.sermonId, p.recoveryId);
    if (!found) return { outcome: "conflict" as const };
    const replay = await verifiedReplay(p.recoveryId);
    return saved && replay.outcome === "replayed" ? { outcome: "saved" as const, eventId: p.recoveryId, providerCalls: 0 as const } : replay;
  } catch { return { outcome: "unavailable" as const }; }
}
