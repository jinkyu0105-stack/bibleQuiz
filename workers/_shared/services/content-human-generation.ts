import { generationReadSession } from "../repositories/generation-read-session";
import { assertContentQualityUsable } from "./content-quality-review";
import { z } from "zod";
import { createHumanContentRuntimeStore, readVerifiedEvents, type HumanContentOperation } from "../repositories/human-content-runtime-store";
import { domainStorageJson } from "../repositories/generation-domain-storage";
import { domainOperationSchema, domainPreparedSchema } from "./generation-domain-contract";
import { readIntentDomain, prepareReadHumanResult } from "./generation-domain-reader";
import { generationAggregateVersion } from "./generation-bridge";
import { lifecycleDigest, lifecycleId } from "./generation-lifecycle-contract";
import { hash } from "./transcript-content";
export const contentHumanCommandSchema = z.strictObject({ requestKey: z.uuid(), expectedVersion: z.int().positive(), operation: domainOperationSchema });

/** Explicit human commands. Review/confirmation has no provider side effect. */
export async function executeContentHumanCommand(db: D1Database, owner: { jobId: string; sermonId: string; quizSetId: string }, raw: unknown, actor: string) {
  db = generationReadSession(db);
  lifecycleDigest.parse(actor); lifecycleId.parse(owner.jobId);
  const command = contentHumanCommandSchema.parse(raw), eventId = command.requestKey;
  const prior = await db.prepare("SELECT event_id FROM sermon_content_human_events WHERE sermon_id=? AND command_key=?")
    .bind(owner.sermonId, command.requestKey).first<{ event_id: string }>();
  if (prior) {
    const [event] = await readVerifiedEvents(db, owner.sermonId, [prior.event_id]);
    const wrapped = z.object({ command: domainPreparedSchema }).parse(event?.payload), p = wrapped.command;
    if (p.owner.jobId !== owner.jobId || p.owner.quizSetId !== owner.quizSetId || p.event.actorDigest !== actor ||
      p.expectedInput.version + (p.before.state === "present" ? p.before.eventCount : 0) !== command.expectedVersion ||
      domainStorageJson(p.operation) !== domainStorageJson(command.operation)) throw new Error("GENERATION_REQUEST_CONFLICT");
    return { outcome: "replayed" as const, eventId: prior.event_id };
  }
  if (command.operation.family === "correction") throw new Error("GENERATION_DOMAIN_INVALID");
  const op = command.operation.operation;
  const target = "analysisId" in op ? op.analysisId : "summaryId" in op ? op.summaryId : "poolId" in op ? op.poolId : null;
  const captured = await readIntentDomain(db, owner, { targets: target ? [target] : [] }), a = captured.basis.authority;
  if (generationAggregateVersion(a) !== command.expectedVersion || a.input.state !== "present" || a.content.state !== "present") throw new Error("GENERATION_AUTHORITY_CHANGED");
  if (!["running", "awaiting_intent_review", "review_ready", "needs_revision"].includes(a.status)) throw new Error("GENERATION_DOMAIN_NOT_READY");
  const c = a.content, i = a.input, now = new Date().toISOString();
  if (target && ["confirm", "review"].includes(op.kind)) await assertContentQualityUsable(db, owner.sermonId, [target]);
  const identity = { contextId: `human-${eventId}`, fingerprint: await hash(domainStorageJson({ owner, command, actor })) };
  const prepared = await prepareReadHumanResult(captured.basis, identity, { operation: command.operation }, { id: eventId, actorDigest: actor, createdAt: now });
  if (prepared.outcome !== "prepared") throw new Error("GENERATION_DOMAIN_INVALID");
  const p = prepared.value, family = p.operation.family, operation = `${family}_${op.kind}` as HumanContentOperation;
  if (family === "correction") throw new Error("GENERATION_DOMAIN_INVALID");
  const difficulty = "difficulty" in op ? op.difficulty : null;
  const base = op.kind === "set_status" ? op.poolId : "baseAnalysisId" in op ? op.baseAnalysisId : "baseSummaryId" in op ? op.baseSummaryId : "basePoolId" in op ? op.basePoolId : null;
  const restoring = op.kind === "restore";
  const saved = await createHumanContentRuntimeStore(db).appendHuman({ sermonId: owner.sermonId, eventId, commandKey: command.requestKey,
    actorId: actor, createdAt: now, expectedInput: { version: i.version, sourceId: i.sourceId, documentId: i.documentId,
      documentSha256: i.documentSha256, confirmationId: i.confirmationId }, expectedCurrent: {
      eventCount: c.eventCount, lastEventId: c.lastEventId, selectedAnalysisEventId: c.intent?.selectedId ?? null,
      intentCritiqueEventId: c.availableCritique?.id ?? c.intent?.critique?.id ?? null, intentConfirmationEventId: c.intent?.confirmation?.id ?? null,
      summarySnapshotEventId: c.summary?.id ?? null, summaryReviewEventId: c.summary?.review?.id ?? null,
      childPoolEventId: c.child?.id ?? null, childReviewEventId: c.child?.review?.id ?? null,
      adultPoolEventId: c.adult?.id ?? null, adultReviewEventId: c.adult?.review?.id ?? null },
    operation, difficulty, baseSnapshotEventId: base, targetSnapshotEventId: restoring || op.kind === "set_status" ? null : target,
    restoreSourceEventId: restoring ? target : null, critiqueEventId: op.kind === "confirm" ? c.intent?.critique?.id ?? null : null,
    intentConfirmationEventId: family !== "intent" ? c.intent?.confirmation?.id ?? null : null,
    expectedCurrentReviewEventId: family === "summary" ? c.summary?.review?.id ?? null : difficulty ? c[difficulty]?.review?.id ?? null : null,
    payload: { contractVersion: 1, operation, command: p, materializedSnapshot: p.materializedSnapshot } });
  return { outcome: saved.outcome, eventId: saved.eventId };
}
