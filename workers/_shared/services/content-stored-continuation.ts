import { z } from "zod";
import { createGenerationLifecycleStore } from "../repositories/generation-lifecycle-store";
import { readIntentDomain } from "./generation-domain-reader";
import { requestFullGeneration } from "./content-intent-generation";

const commandSchema = z.strictObject({ requestKey: z.uuid(), expectedVersion: z.int().positive() });

/** Continue verified stored content. The failed job and every paid receipt remain immutable. */
export async function resumeStoredContent(db: D1Database, previous: { jobId: string; sermonId: string; quizSetId: string }, raw: unknown, actor: string) {
  const command = commandSchema.parse(raw), store = createGenerationLifecycleStore(db);
  const old = await store.readJob(previous.jobId);
  const source = await readIntentDomain(db, previous), selection = source.basis.authority.selection;
  if (old.outcome !== "present" || !["failed", "stale"].includes(old.value.status) || old.value.execution_contract_version !== 3 ||
    old.value.sermon_id !== previous.sermonId || old.value.quiz_set_id !== previous.quizSetId || selection.state !== "present") {
    throw new Error("GENERATION_CONTINUATION_NOT_READY");
  }
  const request = await requestFullGeneration(db, previous.sermonId, { ...command, quizSetId: previous.quizSetId,
    selection: selection.value, reuseCurrentContent: true }, actor);
  const owner = { ...previous, jobId: request.jobId }, job = await store.readJob(owner.jobId);
  if (job.outcome !== "present") throw new Error("GENERATION_JOB_UNAVAILABLE");
  if (job.value.status === "dispatch_pending") {
    const now = new Date().toISOString(), token = crypto.randomUUID();
    const claimed = await store.claimDispatch(request.dispatchId, token, now, new Date(Date.parse(now) + 60_000).toISOString());
    if (claimed.outcome !== "claimed") throw new Error("GENERATION_CONTINUATION_BUSY");
    await store.reserveSend(request.dispatchId, claimed.attempt, token, now);
    const dispatch = await store.readDispatch(request.dispatchId);
    if (dispatch.outcome !== "present") throw new Error("GENERATION_CONTINUATION_UNAVAILABLE");
    const received = await store.receive(request.dispatchId, dispatch.value.identity.wire, owner.jobId,
      (await readIntentDomain(db, owner)).basis.authority, now);
    if (!["received", "replayed"].includes(received.outcome)) throw new Error("GENERATION_CONTINUATION_UNAVAILABLE");
  }
  const current = await store.readJob(owner.jobId);
  if (current.outcome !== "present") throw new Error("GENERATION_JOB_UNAVAILABLE");
  if (current.value.status === "running" && current.value.current_step === "input_resolve") {
    const advanced = await store.advance(owner.jobId, current.value.request_context_id, "content_review", new Date().toISOString());
    if (!["saved", "replayed"].includes(advanced.outcome)) throw new Error("GENERATION_CONTINUATION_UNAVAILABLE");
  } else if (!["content_review", "place_child", "place_adult", "final_validate", "finish"].includes(current.value.current_step)) {
    throw new Error("GENERATION_CONTINUATION_NOT_READY");
  }
  return { outcome: "awaiting_content_review" as const, jobId: owner.jobId, paidCalls: 0 };
}
