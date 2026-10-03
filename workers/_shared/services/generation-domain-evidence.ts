import { z } from "zod";
import { bridgeContentSchema, bridgeInputSchema, generationAuthoritySnapshotSchema, generationWaitSchema } from "./generation-bridge-contract";
import { assessGenerationWait, assessFinalCapture } from "./generation-bridge";
import { historicalOutcomeSchema, outcomeIdentitySchema } from "./generation-lifecycle-contract";
import { isHistoricalOutcomeConsistent } from "./generation-lifecycle";
import { isPreparedDomain, preparedDomainFingerprint } from "./generation-domain";
import { sameLifecycleValue as same } from "./generation-context-codec";

/** Proofs here are invocation handles revalidated from a basis, not D1 proofs.
 * The old bridge remains conservative unless the entire invalidation chain exists. */
export function assessDomainIntentWait(rawWait: unknown, rawCurrent: unknown, transitions: readonly unknown[]) {
  const w = generationWaitSchema.safeParse(rawWait), s = generationAuthoritySnapshotSchema.safeParse(rawCurrent);
  if (!w.success || !s.success || transitions.length > 32) return { outcome: "corrupt" as const };
  if (transitions.length === 0) return assessGenerationWait(w.data, s.data);
  if (w.data.kind !== "intent_review") return { outcome: "stale" as const };
  let current = w.data.content;
  for (const p of transitions) {
    if (!isPreparedDomain(p) || p.origin !== "human" || p.operation.family !== "intent" ||
      !["edit", "select", "confirm"].includes(p.operation.operation.kind) ||
      p.owner.jobId !== w.data.jobId || p.owner.sermonId !== w.data.sermonId || p.owner.quizSetId !== w.data.quizSetId ||
      !same(p.expectedInput, w.data.input) || !same(p.before, current) || p.after.state !== "present" ||
      p.after.intent?.rootAnalysisId !== w.data.rootAnalysisId) return { outcome: "stale" as const };
    current = p.after;
  }
  if (!same(current, s.data.content) || current.state !== "present" || w.data.content.state !== "present") return { outcome: "stale" as const };
  // Only downstream review invalidation proved by the shared reducer may differ.
  return assessGenerationWait({ ...w.data, content: { ...w.data.content,
    summary: current.summary, child: current.child, adult: current.adult } }, s.data);
}

/** Actual nested binding/capture checks are the P5-41 implementation. No final
 * placement, audit or storage readiness is implied by this pure verdict. */
export const assessDomainFinalCapture = assessFinalCapture;

const head = z.strictObject({ input: bridgeInputSchema, content: bridgeContentSchema });
const physicalSchema = z.strictObject({
  identity: outcomeIdentitySchema, beforeInputVersion: z.int().positive().nullable(), beforeContentCount: z.int().nonnegative(),
  afterInputVersion: z.int().positive().nullable(), afterContentCount: z.int().nonnegative(),
});
const failureWitnessSchema = z.strictObject({ identity: outcomeIdentitySchema, authority: head });
const projectionSchema = z.strictObject({ physical: physicalSchema, original: generationAuthoritySnapshotSchema,
  outcome: historicalOutcomeSchema, failureAuthority: failureWitnessSchema.nullable() });
/** Supplies complete semantic pointers only when the exact original capture and
 * own after witness are present. Counts alone and legacy rows stay not_ready.
 * Future reader must verify persisted receipts/artifacts/usage separately. */
export function projectDomainHistoricalOutcome(raw: unknown, prepared?: unknown) {
  if (typeof raw === "object" && raw !== null && Reflect.get(raw, "legacy") === true) return { outcome: "not_ready" as const };
  const p = projectionSchema.safeParse(raw);
  if (!p.success) return { outcome: "corrupt" as const };
  const { physical: f, original, outcome: o, failureAuthority } = p.data;
  if (!isHistoricalOutcomeConsistent(o) || !same(f.identity, o.identity) ||
    original.jobId !== o.identity.jobId || original.sermonId !== o.identity.sermonId || original.quizSetId !== o.identity.quizSetId ||
    !same(o.before, { input: original.input, content: original.content }) ||
    o.evidence.before?.stateVersion !== original.jobStateVersion) return { outcome: "corrupt" as const };
  for (const [actual, inputVersion, count] of [
    [o.before, f.beforeInputVersion, f.beforeContentCount], [o.after, f.afterInputVersion, f.afterContentCount],
  ] as const) {
    if ((actual.input.state === "present" ? actual.input.version : null) !== inputVersion ||
      (actual.content.state === "present" ? actual.content.eventCount : 0) !== count) return { outcome: "corrupt" as const };
  }
  if (o.outcome === "success") {
    if (!isPreparedDomain(prepared)) return { outcome: "not_ready" as const };
    const task = prepared.operation.family === "correction" ? "correction" : prepared.operation.family === "summary" ? "summary" :
      prepared.operation.family === "candidate" ? `${prepared.operation.operation.difficulty}_candidates` :
        prepared.operation.operation.kind === "analysis" ? "intent_analysis" : prepared.operation.operation.kind === "critique" ? "intent_critique" : null;
    if (prepared.origin !== "ai" || task !== o.identity.task || !same(prepared.owner, { jobId: original.jobId, sermonId: original.sermonId, quizSetId: original.quizSetId }) ||
      !same(prepared.context, o.identity.context) || prepared.event.id !== o.result?.id || preparedDomainFingerprint(prepared) !== o.result?.fingerprint || !same(prepared.before, o.before.content) ||
      !same(prepared.expectedInput, o.before.input) || !same(prepared.after, o.after.content) || failureAuthority !== null) return { outcome: "corrupt" as const };
    const expectedInput = task === "correction" ? { ...prepared.expectedInput, version: prepared.expectedInput.version + 1 } : prepared.expectedInput;
    const expectedVersion = task === "correction" ? expectedInput.version : expectedInput.version + (prepared.after.state === "present" ? prepared.after.eventCount : 0);
    if (!same(expectedInput, o.after.input) || o.result.version !== expectedVersion) return { outcome: "corrupt" as const };
  } else {
    if (!failureAuthority) return { outcome: "not_ready" as const };
    if (!same(failureAuthority.identity, o.identity) || !same(failureAuthority.authority, o.after) || prepared !== undefined) return { outcome: "corrupt" as const };
  }
  return { outcome: "projected" as const, value: o };
}
