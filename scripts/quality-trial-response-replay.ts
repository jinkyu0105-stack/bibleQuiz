import { z } from "zod";
import { createOpenAiDraftTransport } from "../workers/_shared/services/openai-draft-transport";
import { createAiDraftProvider, aiDraftDiagnosticForCopy } from "../workers/_shared/services/ai-draft-provider";
import { diagnoseIntentEvidence, verifyIntentCritique } from "../workers/_shared/services/sermon-intent";
import { aiDraftTaskSchemas } from "../workers/_shared/services/ai-draft-provider-contract";

const savedRequest = z.strictObject({ body: z.string() });
const savedResponse = z.strictObject({ body: z.string(), status: z.int().min(200).max(599) });
const wireSchema = z.object({ model: z.literal("gpt-5.6-terra"), input: z.string(),
  text: z.object({ format: z.object({ name: z.enum(["intent_analysis_v1", "intent_critique_v1", "intent_analysis_v2", "intent_critique_v2", "intent_analysis_v3", "intent_critique_v3", "intent_analysis_v4", "intent_critique_v4"]) }) }) });
/** Offline content diagnosis only. This never constructs an app command or writes a DB. */
export async function replayArchivedIntent(requestFile: unknown, responseFile: unknown) {
  try {
    const request = wireSchema.parse(JSON.parse(savedRequest.parse(requestFile).body));
    const response = savedResponse.parse(responseFile);
    const task = request.text.format.name.startsWith("intent_analysis_") ? "intent_analysis" : "intent_critique";
    const input = aiDraftTaskSchemas[task].input.parse(JSON.parse(request.input));
    // Synthetic context passes the provider's syntax boundary only; original DB authority is not inferred.
    const binding = { sourceId: "offline", sourceRevision: 1, sourceSha256: "0".repeat(64), revisionId: "offline",
      transcriptSha256: "0".repeat(64), checksumFormat: "sha256:utf8-working-text:v1", confirmationId: "offline", version: 1 };
    let usageObserved = false;
    const transport = createOpenAiDraftTransport({ apiKey: "offline-unused", observe: async () => { usageObserved = true; },
      fetch: async () => new Response(response.body, { status: response.status }) });
    const generated = await createAiDraftProvider(transport, { timeoutMs: 10_000 }).generate({ task,
      context: { sermonId: "offline", binding, ...(task === "intent_critique" ? { baseAnalysisId: "offline" } : {}) }, input });
    const safe = aiDraftDiagnosticForCopy(generated);
    if (generated.outcome !== "structured_output") return { stage: "provider", ...safe, usageObserved, paidCalls: 0 };
    const analysis = generated.result.task === "intent_analysis" ? generated.result.content :
      generated.result.task === "intent_critique" ? generated.result.content.analysis : null;
    if (!analysis) throw new Error("ARCHIVE_TASK_INVALID");
    const issue = diagnoseIntentEvidence(input.transcript, analysis);
    if (issue) return { stage: "evidence", issue, usageObserved, paidCalls: 0 };
    if (generated.result.task === "intent_critique") {
      const original = aiDraftTaskSchemas.intent_critique.input.parse(input);
      try { verifyIntentCritique(original.analysis, generated.result.content.critique, () => { throw new Error("invalid"); }); }
      catch { return { stage: "critique", code: "critique_reference", usageObserved, paidCalls: 0 }; }
    }
    const evidence = Object.values(analysis).flatMap(claims => claims.flatMap(claim => claim.evidence));
    return { stage: "content_valid_only", originalDbAuthorityVerified: false, usageObserved, paidCalls: 0,
      evidenceCount: evidence.length, unverifiedEvidenceCount: evidence.filter(e => e.locationStatus === "unverified").length };
  } catch { return { stage: "archive_invalid", paidCalls: 0 }; }
}
