import { z } from "zod";

import {
  GenerationRuntimeStoreError,
  type ClaimGenerationStepCommand,
  type CompleteGenerationStepCommand,
  type GenerationDispatchRecord,
  type GenerationDomainResultPort,
  type GenerationJobRecord,
  type GenerationResultReference,
  type GenerationRuntimeStore,
} from "../repositories/generation-runtime-store";
import {
  type AiGenerationDomainResult,
  type AiGenerationProviderCall,
  type AiGenerationTask,
  type AiGenerationUsage,
  type GenerationAiResultStore,
} from "../repositories/generation-ai-result-store";
import { sha256Bytes } from "../storage/sha256";

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

async function safeFingerprint(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value));
}

export type GenerationDispatchPayload = Readonly<{
  contractVersion: 1;
  jobId: string;
  workflowInstanceId: string;
  dispatchKind: GenerationDispatchRecord["kind"];
  dispatchKey: string;
  jobStateVersion: number;
  waitGeneration: number | null;
  requestFingerprint: string;
}>;

export type GenerationDispatchSendResult =
  | { outcome: "accepted" }
  | { outcome: "response_lost" }
  | { outcome: "already_exists" }
  | { outcome: "confirmed_missing" };

export type GenerationDispatchProbeResult =
  | { outcome: "missing" | "unavailable" }
  | {
    outcome: "exists";
    requestFingerprint: string | null;
    dispatchAcknowledged: boolean;
  };

export interface GenerationDispatchTransport {
  send(payload: GenerationDispatchPayload): Promise<GenerationDispatchSendResult>;
  probe(workflowInstanceId: string, dispatchKey: string): Promise<GenerationDispatchProbeResult>;
}

export type DispatchGenerationResult =
  | { outcome: "acknowledged" | "replayed" | "retryable" | "uncertain" | "terminal"; dispatchId: string };

async function resolveDispatchProbe(
  store: GenerationRuntimeStore,
  transport: GenerationDispatchTransport,
  dispatch: GenerationDispatchRecord,
  job: GenerationJobRecord,
  now: string,
): Promise<DispatchGenerationResult> {
  let probe: GenerationDispatchProbeResult;
  try {
    probe = await transport.probe(dispatch.workflow_instance_id, dispatch.dispatch_key);
  } catch {
    probe = { outcome: "unavailable" };
  }
  if (probe.outcome === "exists" && probe.requestFingerprint !== null &&
    probe.requestFingerprint !== job.request_fingerprint) {
    await store.failDispatchMismatch(dispatch.id, dispatch.attempt_count,
      await safeFingerprint("GENERATION_WORKFLOW_MISMATCH"), now);
    return { outcome: "terminal", dispatchId: dispatch.id };
  }
  if (probe.outcome === "exists" && probe.requestFingerprint === job.request_fingerprint && probe.dispatchAcknowledged) {
    const outcome = await store.acknowledgeDispatch(dispatch.id, dispatch.attempt_count, now);
    return { outcome: outcome === "replayed" ? "replayed" : "acknowledged", dispatchId: dispatch.id };
  }
  if (dispatch.state === "uncertain") return { outcome: "uncertain", dispatchId: dispatch.id };
  if (probe.outcome === "missing") {
    await store.markDispatchRetryableOrUncertain(dispatch.id, dispatch.attempt_count, "retryable_failed",
      "GENERATION_WORKFLOW_MISSING", await safeFingerprint("GENERATION_WORKFLOW_MISSING"), now);
    return { outcome: "retryable", dispatchId: dispatch.id };
  }
  await store.markDispatchRetryableOrUncertain(dispatch.id, dispatch.attempt_count, "uncertain",
    "GENERATION_WORKFLOW_UNCERTAIN", await safeFingerprint("GENERATION_WORKFLOW_UNCERTAIN"), now);
  return { outcome: "uncertain", dispatchId: dispatch.id };
}

/**
 * Private synthetic dispatcher boundary. It never creates an instance ID and
 * never treats an exception or signal payload as proof of external success.
 */
export async function dispatchGeneration(
  store: GenerationRuntimeStore,
  transport: GenerationDispatchTransport,
  input: {
    dispatchId: string;
    claimToken: string;
    leaseExpiresAt: string;
    now: string;
  },
): Promise<DispatchGenerationResult> {
  const claim = await store.claimDispatch(input.dispatchId, input.claimToken, input.leaseExpiresAt, input.now);
  if (claim.outcome === "acknowledged") return { outcome: "replayed", dispatchId: claim.dispatch.id };
  if (claim.outcome === "terminal") return { outcome: "terminal", dispatchId: claim.dispatch.id };
  if (claim.outcome === "busy") return { outcome: "uncertain", dispatchId: claim.dispatch.id };
  if (claim.outcome === "uncertain") {
    return resolveDispatchProbe(store, transport, claim.dispatch, claim.job, input.now);
  }
  const payload: GenerationDispatchPayload = Object.freeze({
    contractVersion: 1,
    jobId: claim.job.id,
    workflowInstanceId: claim.job.workflow_instance_id,
    dispatchKind: claim.dispatch.kind,
    dispatchKey: claim.dispatch.dispatch_key,
    jobStateVersion: claim.dispatch.job_state_version,
    waitGeneration: claim.dispatch.wait_generation,
    requestFingerprint: claim.job.request_fingerprint,
  });
  let sent: GenerationDispatchSendResult;
  try {
    sent = await transport.send(payload);
  } catch {
    sent = { outcome: "response_lost" };
  }
  if (sent.outcome === "confirmed_missing") {
    await store.markDispatchRetryableOrUncertain(claim.dispatch.id, claim.dispatch.attempt_count,
      "retryable_failed", "GENERATION_WORKFLOW_MISSING",
      await safeFingerprint("GENERATION_WORKFLOW_MISSING"), input.now);
    return { outcome: "retryable", dispatchId: claim.dispatch.id };
  }
  return resolveDispatchProbe(store, transport, claim.dispatch, claim.job, input.now);
}

export type GenerationAuthorityResult =
  | { outcome: "waiting" }
  | { outcome: "ready"; lineageFingerprint: string; resumePayloadFingerprint: string }
  | { outcome: "stale"; reasonFingerprint: string };

export interface GenerationAuthorityReader {
  readCurrent(job: GenerationJobRecord): Promise<GenerationAuthorityResult>;
}

const authorityResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("waiting") }),
  z.strictObject({
    outcome: z.literal("ready"),
    lineageFingerprint: digestSchema,
    resumePayloadFingerprint: digestSchema,
  }),
  z.strictObject({ outcome: z.literal("stale"), reasonFingerprint: digestSchema }),
]);

/** Signal data is deliberately ignored. The authority port must read current
 * input/intent/metadata state from its own authoritative store. */
export async function reconcileGenerationAuthority(
  store: GenerationRuntimeStore,
  authority: GenerationAuthorityReader,
  input: { jobId: string; signalPayload: unknown; now: string },
): Promise<
  | { outcome: "waiting" | "stale" }
  | { outcome: "resume_created" | "resume_replayed"; dispatchId: string }
> {
  void input.signalPayload;
  const job = await store.jobById(input.jobId);
  if (!job) throw new GenerationRuntimeStoreError("GENERATION_STATE_CONFLICT");
  let raw: GenerationAuthorityResult;
  try {
    raw = await authority.readCurrent(job);
  } catch {
    return { outcome: "waiting" };
  }
  const parsed = authorityResultSchema.safeParse(raw);
  if (!parsed.success) return { outcome: "waiting" };
  const result = parsed.data;
  if (result.outcome === "stale") {
    await store.markJobStale(job.id, result.reasonFingerprint, input.now);
    return { outcome: "stale" };
  }
  if (result.outcome === "waiting") return { outcome: "waiting" };
  if (!job.wait_kind || !job.wait_input_fingerprint ||
    !["awaiting_transcript_review", "awaiting_intent_review"].includes(job.status)) {
    return { outcome: "waiting" };
  }
  if (result.lineageFingerprint !== job.wait_input_fingerprint) {
    await store.markJobStale(job.id, await safeFingerprint("GENERATION_AUTHORITY_STALE"), input.now);
    return { outcome: "stale" };
  }
  const resume = await store.ensureResumeDispatch(job.id, result.resumePayloadFingerprint, input.now);
  return {
    outcome: resume.outcome === "created" ? "resume_created" : "resume_replayed",
    dispatchId: resume.dispatch.id,
  };
}

export type GenerationStepTransportResult =
  | { outcome: "completed"; result: GenerationResultReference }
  | { outcome: "response_lost" };

export interface GenerationStepTransport {
  invoke(input: Readonly<{
    jobId: string;
    stepKey: string;
    inputFingerprint: string;
    attempt: number;
  }>): Promise<GenerationStepTransportResult>;
}

export type AiGenerationStepTransportResult =
  | { outcome: "completed"; result: AiGenerationDomainResult; usage: AiGenerationUsage }
  | { outcome: "rejected_with_usage"; usage: AiGenerationUsage }
  | { outcome: "response_lost" };

export interface AiGenerationStepTransport {
  invoke(input: Readonly<{
    jobId: string;
    stepKey: string;
    inputFingerprint: string;
    attempt: number;
    providerCallId: string;
  }>): Promise<AiGenerationStepTransportResult>;
}

/** Synthetic step runner used to prove receipt replay and the external-effect
 * uncertainty boundary. It is not a provider or network implementation. */
export async function runGenerationStep(
  store: GenerationRuntimeStore,
  transport: GenerationStepTransport,
  resultPort: GenerationDomainResultPort,
  input: {
    claim: ClaimGenerationStepCommand;
    providerRequestIdOpaque: string | null;
    nextStep: string;
    effectStartedAt: string;
    completedAt: string;
  },
): Promise<
  | { outcome: "succeeded" | "replayed"; result: GenerationResultReference }
  | { outcome: "busy" | "uncertain" | "terminal" }
> {
  const claim = await store.claimStep(input.claim);
  if (claim.outcome === "replayed") return { outcome: "replayed", result: claim.result };
  if (claim.outcome === "busy" || claim.outcome === "terminal") return { outcome: claim.outcome };
  if (claim.outcome === "uncertain") {
    if (claim.receipt.state === "effect_started") {
      await store.markStepUncertain(claim.receipt.generation_job_id, claim.receipt.step_key,
        claim.receipt.attempt_count, input.effectStartedAt);
    }
    return { outcome: "uncertain" };
  }
  const external = claim.receipt.effect_class === "source_network" || claim.receipt.effect_class === "ai_provider";
  if (external) {
    await store.markStepEffectStarted(claim.receipt.generation_job_id, claim.receipt.step_key,
      claim.receipt.attempt_count, claim.receipt.claim_token!, input.providerRequestIdOpaque, input.effectStartedAt);
  }
  let transported: GenerationStepTransportResult;
  try {
    transported = await transport.invoke(Object.freeze({
      jobId: claim.receipt.generation_job_id,
      stepKey: claim.receipt.step_key,
      inputFingerprint: claim.receipt.input_fingerprint,
      attempt: claim.receipt.attempt_count,
    }));
  } catch {
    transported = { outcome: "response_lost" };
  }
  if (transported.outcome === "response_lost") {
    if (external) {
      await store.markStepUncertain(claim.receipt.generation_job_id, claim.receipt.step_key,
        claim.receipt.attempt_count, input.completedAt);
    }
    return { outcome: "uncertain" };
  }
  const completion: CompleteGenerationStepCommand = {
    jobId: claim.receipt.generation_job_id,
    stepKey: claim.receipt.step_key,
    inputFingerprint: claim.receipt.input_fingerprint,
    expectedAttempt: claim.receipt.attempt_count,
    nextStep: input.nextStep,
    now: input.completedAt,
    result: transported.result,
    resultPort,
  };
  const outcome = await store.completeStep(completion);
  return { outcome, result: transported.result };
}

/** Private synthetic AI runner for the 0011 call/usage/result boundary.
 * It deliberately supplies no provider or Workflow implementation. */
export async function runAiGenerationStep(
  store: GenerationRuntimeStore,
  aiStore: GenerationAiResultStore,
  transport: AiGenerationStepTransport,
  input: {
    claim: ClaimGenerationStepCommand;
    call: AiGenerationProviderCall;
    nextStep: string;
    effectStartedAt: string;
    completedAt: string;
  },
): Promise<
  | { outcome: "succeeded" | "replayed"; result: GenerationResultReference }
  | { outcome: "busy" | "uncertain" | "terminal" }
> {
  const claim = await store.claimStep(input.claim);
  if (claim.outcome === "replayed") {
    const probe = await aiStore.probeSucceeded(claim.receipt.generation_job_id, claim.receipt.step_key);
    if (probe !== "exact") throw new Error("GENERATION_AI_STEP_UNCERTAIN");
    return { outcome: "replayed", result: claim.result };
  }
  if (claim.outcome === "busy" || claim.outcome === "terminal") return { outcome: claim.outcome };
  if (claim.outcome === "uncertain") {
    if (claim.receipt.state === "effect_started") {
      await aiStore.markUncertain(claim.receipt.generation_job_id, claim.receipt.step_key,
        claim.receipt.attempt_count, input.completedAt);
    }
    return { outcome: "uncertain" };
  }
  if (claim.receipt.effect_class !== "ai_provider") throw new Error("GENERATION_AI_INVALID");
  const task = claim.receipt.task as AiGenerationTask;
  await aiStore.startProviderCall({
    jobId: claim.receipt.generation_job_id,
    stepKey: claim.receipt.step_key,
    task,
    inputFingerprint: claim.receipt.input_fingerprint,
    expectedAttempt: claim.receipt.attempt_count,
    claimToken: claim.receipt.claim_token!,
    call: input.call,
    startedAt: input.effectStartedAt,
  });
  let transported: AiGenerationStepTransportResult;
  try {
    transported = await transport.invoke(Object.freeze({
      jobId: claim.receipt.generation_job_id,
      stepKey: claim.receipt.step_key,
      inputFingerprint: claim.receipt.input_fingerprint,
      attempt: claim.receipt.attempt_count,
      providerCallId: input.call.id,
    }));
  } catch {
    transported = { outcome: "response_lost" };
  }
  if (transported.outcome === "response_lost") {
    await aiStore.markUncertain(claim.receipt.generation_job_id, claim.receipt.step_key,
      claim.receipt.attempt_count, input.completedAt);
    return { outcome: "uncertain" };
  }
  const common = {
    jobId: claim.receipt.generation_job_id,
    stepKey: claim.receipt.step_key,
    task,
    inputFingerprint: claim.receipt.input_fingerprint,
    expectedAttempt: claim.receipt.attempt_count,
    callId: input.call.id,
    usage: transported.usage,
    completedAt: input.completedAt,
  };
  if (transported.outcome === "rejected_with_usage") {
    await aiStore.commitRejectedWithUsage(common);
    return { outcome: "terminal" };
  }
  return aiStore.commitSuccess({
    ...common,
    result: transported.result,
    nextStep: input.nextStep,
  });
}
