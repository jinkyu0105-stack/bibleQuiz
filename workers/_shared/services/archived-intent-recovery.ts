import { z } from "zod";
import { createGenerationLifecycleStore } from "../repositories/generation-lifecycle-store";
import { domainStorageJson } from "../repositories/generation-domain-storage";
import { sha256Bytes } from "../storage/sha256";
import { createAiDraftProvider } from "./ai-draft-provider";
import { aiDraftRequestSchema, aiDraftTaskSchemas } from "./ai-draft-provider-contract";
import { generationAggregateVersion } from "./generation-bridge";
import { fingerprintLifecycleValue, sameLifecycleValue as same } from "./generation-context-codec";
import { domainTranscriptBinding } from "./generation-domain";
import { prepareReadIntentResult, readIntentDomain } from "./generation-domain-reader";
import { lifecycleDigest, lifecycleId } from "./generation-lifecycle-contract";
import { createOpenAiDraftTransport, type OpenAiObservation } from "./openai-draft-transport";
import { intentFields } from "./sermon-intent-contract";
import { resolveGeneratedClaimReferences } from "./generated-claim-references";

export const archivedIntentRecoveryPinSchema = z.strictObject({
  sourceJobId: lifecycleId, sermonId: lifecycleId, quizSetId: lifecycleId, attempt: z.int().positive(),
  requestSha256: lifecycleDigest, responseSha256: lifecycleDigest, instructionsSha256: lifecycleDigest,
});
const requestArchive = z.strictObject({ body: z.string() });
const responseArchive = z.strictObject({ status: z.literal(200), body: z.string() });
const wireSchema = z.object({ model: z.literal("gpt-5.6-terra"), instructions: z.string(), input: z.string(),
  store: z.literal(false), reasoning: z.object({ effort: z.literal("high") }),
  text: z.object({ format: z.object({ name: z.enum(["intent_analysis_v1", "intent_analysis_v2", "intent_analysis_v3", "intent_analysis_v4",
    "intent_critique_v1", "intent_critique_v2", "intent_critique_v3", "intent_critique_v4", "summary_v1", "summary_v2", "summary_v3", "summary_v4"]) }) }) });
type Failure = "ARCHIVE_INVALID" | "ARCHIVE_CHANGED" | "SOURCE_NOT_ELIGIBLE" | "CONTEXT_CHANGED" |
  "USAGE_MISMATCH" | "CONTENT_INVALID" | "READ_UNAVAILABLE";
class RecoveryError extends Error { constructor(readonly code: Failure) { super(code); } }
function requireThat(value: unknown, code: Failure): asserts value { if (!value) throw new RecoveryError(code); }
const hash = (text: string) => sha256Bytes(new TextEncoder().encode(text));

/** Local preparation only: no credentials, live transport, SQL mutations, dispatch
 * or write permit. Pins must come from the previously retained archive inventory.
 * They prove consistency with that inventory, not a provider-signed attestation. */
export async function prepareArchivedIntentRecovery(db: D1Database, rawPin: unknown, requestText: string, responseText: string) {
  try {
    const pin = archivedIntentRecoveryPinSchema.parse(rawPin);
    requireThat(await hash(requestText) === pin.requestSha256 && await hash(responseText) === pin.responseSha256, "ARCHIVE_CHANGED");
    const wire = wireSchema.parse(JSON.parse(requestArchive.parse(JSON.parse(requestText)).body));
    const savedResponse = responseArchive.parse(JSON.parse(responseText));
    requireThat(await hash(wire.instructions) === pin.instructionsSha256, "ARCHIVE_CHANGED");
    const task = wire.text.format.name.startsWith("summary_") ? "summary" :
      wire.text.format.name.startsWith("intent_critique_") ? "intent_critique" : "intent_analysis";
    const input = aiDraftTaskSchemas[task].input.parse(JSON.parse(wire.input));
    const store = createGenerationLifecycleStore(db);
    const job = await store.readJob(pin.sourceJobId);
    requireThat(job.outcome === "present", "SOURCE_NOT_ELIGIBLE");
    const owner = { jobId: pin.sourceJobId, sermonId: pin.sermonId, quizSetId: pin.quizSetId };
    requireThat(job.value.sermon_id === owner.sermonId && job.value.quiz_set_id === owner.quizSetId &&
      job.value.execution_contract_version === 3 && job.value.request_scope === "full" &&
      job.value.status === "failed" && job.value.current_step === task, "SOURCE_NOT_ELIGIBLE");
    // This reader verifies the failed step, call, settled usage, and absence of a result link.
    const outcome = await store.readOutcome(owner.jobId, task, pin.attempt);
    requireThat(outcome.outcome === "present" && outcome.value.outcome === "rejected" &&
      outcome.value.result === null && outcome.value.usage !== null && outcome.value.callId !== null, "SOURCE_NOT_ELIGIBLE");
    const original = outcome.value, usage = original.usage!;
    requireThat(usage.provider === "openai" && usage.model === wire.model && usage.reasoningEffort === "high" &&
      usage.callId === original.callId && usage.sermonId === owner.sermonId && usage.quizSetId === owner.quizSetId, "USAGE_MISMATCH");
    const step = await store.readContext(original.context.contextId);
    const requestContext = await store.readContext(job.value.request_context_id);
    requireThat(step.outcome === "present" && step.value.context.kind === "step" &&
      step.value.context.execution.task === task && requestContext.outcome === "present" &&
      requestContext.value.context.kind === "request", "SOURCE_NOT_ELIGIBLE");
    const context = step.value.context, request = requestContext.value.context;
    requireThat(step.value.encoded.envelope.fingerprint === original.context.fingerprint &&
      same(context.request, { contextId: job.value.request_context_id, fingerprint: job.value.request_fingerprint }) &&
      requestContext.value.encoded.envelope.fingerprint === job.value.request_fingerprint, "SOURCE_NOT_ELIGIBLE");
    const captured = await readIntentDomain(db, owner), authority = captured.basis.authority;
    requireThat(same(context.authority.input, authority.input) && same(context.authority.content, authority.content) &&
      same(context.authority.metadata, authority.metadata) && same(context.authority.selection, authority.selection) &&
      same(request.authority.input, authority.input) && same(request.authority.metadata, authority.metadata) &&
      domainStorageJson(input.transcript) === domainStorageJson(captured.transcript) && authority.input.state === "present", "CONTEXT_CHANGED");
    const execution = aiDraftRequestSchema.parse({ task, context: context.execution.context, input });
    requireThat(execution.task === "summary" || execution.task === "intent_analysis" || execution.task === "intent_critique", "ARCHIVE_INVALID");
    const transcriptBinding = "transcript" in execution.context.binding ? execution.context.binding.transcript : execution.context.binding;
    requireThat(execution.task === task && execution.context.sermonId === owner.sermonId &&
      same(transcriptBinding, domainTranscriptBinding(authority.input, generationAggregateVersion(authority)!)), "CONTEXT_CHANGED");
    // Only the already archived bytes are delivered to the existing provider parser.
    const observations: OpenAiObservation[] = [];
    const generated = await createAiDraftProvider(createOpenAiDraftTransport({ apiKey: "offline-unused",
      observe: async observation => { observations.push(observation); },
      fetch: async () => new Response(savedResponse.body, { status: savedResponse.status }),
    }), { timeoutMs: 10_000 }).generate(execution);
    requireThat(generated.outcome === "structured_output" && generated.result.task === task, "CONTENT_INVALID");
    const observed = observations[0];
    requireThat(observations.length === 1 && observed && (observed.model === wire.model || observed.model.startsWith(wire.model + "-")) &&
      observed.usage.input_tokens === usage.inputTokens && observed.usage.output_tokens === usage.outputTokens &&
      (observed.usage.input_tokens_details?.cached_tokens ?? null) === usage.cachedInputTokens &&
      (observed.usage.output_tokens_details?.reasoning_tokens ?? null) === usage.reasoningTokens, "USAGE_MISMATCH");
    const recoveryId = `recovery-${await fingerprintLifecycleValue({ pin, context: original.context })}`;
    const prepared = await prepareReadIntentResult(captured.basis, original.context,
      { request: execution, result: generated.result },
      { id: recoveryId, actorDigest: request.actorDigest, createdAt: usage.startedAt });
    requireThat(prepared.outcome === "prepared", "CONTENT_INVALID");
    // Re-read before issuing a preparation artifact; an eventual write must repeat
    // these checks atomically. A serialized package never carries a WeakSet permit.
    const current = await readIntentDomain(db, owner);
    requireThat(same(current.basis.authority, authority) && same(await store.readJob(owner.jobId), job) &&
      (await store.probeOutcome(original)).outcome === "exact", "CONTEXT_CHANGED");
    const analysis = generated.result.task === "intent_analysis" ? generated.result.content :
      generated.result.task === "intent_critique" ? generated.result.content.analysis : null;
    const claims = analysis ? intentFields.flatMap(field => analysis[field]) : [];
    const paragraphs = generated.result.task === "summary" ? generated.result.content.paragraphs : [];
    const archivedDraft = JSON.parse(JSON.parse(savedResponse.body).output.find((v: { type: string }) => v.type === "message")
      .content.find((v: { type: string }) => v.type === "output_text").text).draft;
    const references = execution.task === "summary" ? resolveGeneratedClaimReferences(execution.input.intent, archivedDraft) : null;
    return { outcome: "ready_for_local_review" as const, package: {
      format: "archived-intent-recovery-preparation-v1" as const, recoveryId,
      source: { ...pin, context: original.context, callId: original.callId, usageId: usage.usageId,
        originalOutcome: "rejected" as const, originalJobStatus: "failed" as const,
        model: wire.model, reasoningEffort: wire.reasoning.effort, outputSchema: wire.text.format.name,
        pricingVersion: usage.pricingVersion, estimatedCostMicroUsd: usage.estimatedCostMicroUsd },
      expectedAuthority: authority, result: generated.result,
      checks: { claimCount: claims.length, paragraphCount: paragraphs.length, referenceRepairs: references?.repairs ?? [],
        omittedUnresolvedReferences: references?.omittedUnresolved ?? [],
        evidenceCount: [...claims, ...paragraphs].reduce((n, claim) => n + claim.evidence.length, 0),
        contentAndDomainValidated: true, ledgerMatched: true, inventoryMatched: true },
      boundaries: { providerCalls: 0, appWrites: 0, writePermit: false, humanApproved: false,
        critiquePerformed: task === "intent_critique", originalResponseProviderSignatureVerified: false,
        appRecoveryCommitImplemented: true, retryPaidCallAuthorized: false },
    } };
  } catch (error) {
    return { outcome: "rejected" as const, code: error instanceof RecoveryError ? error.code :
      error instanceof z.ZodError || error instanceof SyntaxError ? "ARCHIVE_INVALID" as const : "READ_UNAVAILABLE" as const };
  }
}
