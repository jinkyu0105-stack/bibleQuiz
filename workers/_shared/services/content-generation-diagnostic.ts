import { aiDraftDiagnosticForCopy, type AiDraftProviderResult } from "./ai-draft-provider";
import type { AiDraftTask } from "./ai-draft-provider-contract";
import { diagnoseIntentEvidence } from "./sermon-intent";
import type { DeepReadonly, TranscriptContent } from "./transcript-revision-contract";

/** No exceptions, Zod messages, provider text, claim IDs or quotes cross this boundary. */
export function contentValidationDiagnostic(task: AiDraftTask, generated: AiDraftProviderResult,
  prepared: "prepared" | "invalid" | "unavailable" | "limit_exceeded" | null, transcript: DeepReadonly<TranscriptContent>) {
  const diagnostic = aiDraftDiagnosticForCopy(generated);
  if (diagnostic.outcome === "failed") return { stage: "provider" as const, task, reason: diagnostic.code, evidence: null };
  if (prepared === "prepared") return null;
  const result = generated.outcome === "structured_output" ? generated.result : null;
  const analysis = result?.task === "intent_analysis" ? result.content : result?.task === "intent_critique" ? result.content.analysis : null;
  return { stage: "domain" as const, task, reason: prepared ?? "unavailable",
    evidence: analysis ? diagnoseIntentEvidence(transcript, analysis) : null };
}
