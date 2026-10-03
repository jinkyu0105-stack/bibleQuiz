import { z } from "zod";
import type { DomainBasis, DomainPrepared } from "../services/generation-domain-contract";
import { domainTranscriptBinding } from "../services/generation-domain";
import { sameTranscript } from "../services/sermon-intent";
import { lifecycleDigest, lifecycleId, lifecycleTime } from "../services/generation-lifecycle-contract";
import { sameLifecycleValue as same, fingerprintLifecycleValue } from "../services/generation-context-codec";
import { domainStorageJson } from "./generation-domain-storage";
import { sha256Bytes } from "../storage/sha256";
import { createGenerationLifecycleStore } from "./generation-lifecycle-store";

export const archivedIntentRecoveryRowSchema = z.strictObject({
  event_id: lifecycleId, sermon_id: lifecycleId, quiz_set_id: lifecycleId, source_job_id: lifecycleId,
  context_id: lifecycleId, context_fingerprint: lifecycleDigest, attempt: z.int().positive(),
  call_id: lifecycleId, usage_id: lifecycleId, request_sha256: lifecycleDigest, response_sha256: lifecycleDigest,
  instructions_sha256: lifecycleDigest, payload_sha256: lifecycleDigest, actor_digest: lifecycleDigest, created_at: lifecycleTime,
});
export type ArchivedIntentRecoveryRow = z.infer<typeof archivedIntentRecoveryRowSchema>;
export async function readArchivedIntentRecovery(db: D1Database, sermonId: string, eventId: string) {
  const row = await db.prepare("SELECT * FROM generation_archived_intent_recoveries WHERE sermon_id=? AND event_id=?")
    .bind(sermonId, eventId).first();
  return row ? archivedIntentRecoveryRowSchema.parse(row) : null;
}

/** Eligibility after readIntentDomain has verified the recovery payload and provenance. */
export async function readCurrentArchivedIntentRecovery(db: D1Database, basis: DomainBasis) {
  const a = basis.authority, c = a.content;
  if (a.input.state !== "present" || c.state !== "present" || !c.intent || c.intent.confirmation || c.intent.critique) return null;
  const snapshot = basis.snapshots.find(s => s.value.id === c.intent!.selectedId);
  const recovery = await readArchivedIntentRecovery(db, a.sermonId, c.intent.selectedId);
  if (!recovery || recovery.quiz_set_id !== a.quizSetId || snapshot?.kind !== "intent" || snapshot.value.kind !== "analysis" ||
    !sameTranscript(snapshot.value.binding, domainTranscriptBinding(a.input, snapshot.value.binding.version))) return null;
  const source = await createGenerationLifecycleStore(db).readContext(recovery.context_id);
  return source.outcome === "present" && source.value.context.kind === "step" &&
    same(a.input, source.value.context.authority.input) && same(a.metadata, source.value.context.authority.metadata) ? recovery : null;
}

/** A saved critique can accompany its recovered root in the same continuation. */
export async function readCurrentArchivedCritiqueRecovery(db: D1Database, basis: DomainBasis) {
  const a = basis.authority, c = a.content;
  if (c.state !== "present" || !c.availableCritique || !c.intent || c.intent.confirmation ||
    c.availableCritique.rootAnalysisId !== c.intent.selectedId) return null;
  const snapshot = basis.snapshots.find(s => s.value.id === c.availableCritique!.id);
  const recovery = await readArchivedIntentRecovery(db, a.sermonId, c.availableCritique.id);
  if (!recovery || recovery.quiz_set_id !== a.quizSetId || snapshot?.kind !== "intent" || snapshot.value.kind !== "critique" ||
    snapshot.provenance.rootAnalysisId !== c.intent.selectedId) return null;
  const source = await createGenerationLifecycleStore(db).readContext(recovery.context_id);
  return source.outcome === "present" && source.value.context.kind === "step" &&
    source.value.context.execution.task === "intent_critique" && same(a.input, source.value.context.authority.input) &&
    same(a.metadata, source.value.context.authority.metadata) ? recovery : null;
}

/** History read verification only; this is not a storage permission or human approval. */
export async function verifyArchivedIntentRecovery(db: D1Database, r: ArchivedIntentRecoveryRow, p: DomainPrepared) {
  const intent = p.operation.family === "intent" && ["analysis", "critique"].includes(p.operation.operation.kind) &&
    p.materializedSnapshot?.kind === "intent" && ["analysis", "critique"].includes(p.materializedSnapshot.value.kind);
  const summary = p.operation.family === "summary" && p.operation.operation.kind === "generate" && p.materializedSnapshot?.kind === "summary";
  if (p.origin !== "ai" || (!intent && !summary) ||
    p.event.id !== r.event_id || p.event.actorDigest !== r.actor_digest || p.event.createdAt !== r.created_at ||
    !same(p.owner, { jobId: r.source_job_id, sermonId: r.sermon_id, quizSetId: r.quiz_set_id }) ||
    !same(p.context, { contextId: r.context_id, fingerprint: r.context_fingerprint }) ||
    await sha256Bytes(new TextEncoder().encode(domainStorageJson(p))) !== r.payload_sha256) return false;
  const op = p.operation.operation;
  if (!("kind" in op)) return false;
  if (!(p.operation.family === "intent" && (op.kind === "analysis" || op.kind === "critique") ||
    p.operation.family === "summary" && op.kind === "generate")) return false;
  if (!("binding" in op)) return false;
  const task = p.operation.family === "summary" ? "summary" : op.kind === "analysis" ? "intent_analysis" : "intent_critique";
  const store = createGenerationLifecycleStore(db), job = await store.readJob(r.source_job_id);
  const source = await store.readOutcome(r.source_job_id, task, r.attempt);
  const step = await store.readContext(r.context_id);
  if (job.outcome !== "present" || job.value.status !== "failed" || job.value.current_step !== task ||
    job.value.execution_contract_version !== 3 || job.value.request_scope !== "full" ||
    source.outcome !== "present" || source.value.outcome !== "rejected" || source.value.result !== null ||
    source.value.callId !== r.call_id || source.value.usage?.usageId !== r.usage_id ||
    !same(source.value.context, p.context) || step.outcome !== "present" || step.value.context.kind !== "step" ||
    step.value.context.execution.task !== task || step.value.encoded.envelope.fingerprint !== r.context_fingerprint ||
    !same(step.value.context.authority.input, p.expectedInput) || !same(step.value.context.authority.content, p.before) ||
    !same(step.value.context.execution.context.binding, op.binding)) return false;
  if (op.kind === "critique" && (step.value.context.execution.task !== "intent_critique" ||
    step.value.context.execution.context.baseAnalysisId !== op.baseAnalysisId)) return false;
  const pin = { sourceJobId: r.source_job_id, sermonId: r.sermon_id, quizSetId: r.quiz_set_id, attempt: r.attempt,
    requestSha256: r.request_sha256, responseSha256: r.response_sha256, instructionsSha256: r.instructions_sha256 };
  return r.event_id === `recovery-${await fingerprintLifecycleValue({ pin, context: p.context })}`;
}
