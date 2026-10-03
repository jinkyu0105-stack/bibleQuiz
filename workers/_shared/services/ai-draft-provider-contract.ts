import { z } from "zod";

import { finalAuditInputSchema, finalAuditOutputSchema } from "./final-audit-contract";
import { finalCheckTicketSchema } from "./final-check-contract";
import { intentAnalysisSchema, intentCritiqueSchema, intentFields, intentTranscriptBindingSchema } from "./sermon-intent-contract";
import { candidateReplacementSchema, sermonCandidateSchema, sermonCandidateDraftSchema } from "./sermon-candidates-contract";
import { sermonSummaryDraftSchema, summaryBindingSchema } from "./sermon-summary-contract";
import { correctionProposalInputSchema } from "./transcript-correction-contract";
import { correctionDocumentOutputSchema } from "./transcript-correction-document";
import { transcriptContentSchema } from "./transcript-revision-contract";

// Worker-only. The caller supplies authoritative, already validated input before
// invoking this boundary. Shape validation is not authentication or a current-head check.
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const generatedAnalysis = intentAnalysisSchema.refine((analysis) =>
  intentFields.every((field) => analysis[field].every((claim) => claim.origin !== "admin_context")),
);
const generatedCandidates = sermonCandidateDraftSchema.refine((draft) =>
  draft.candidates.every((candidate) => candidate.grounding.origin === "transcript"),
);
const transcriptInput = z.strictObject({ transcript: transcriptContentSchema });
const intentContext = z.strictObject({ sermonId: id, binding: intentTranscriptBindingSchema });
const confirmedIntentContext = z.strictObject({ sermonId: id, binding: summaryBindingSchema });
const confirmedIntentInput = transcriptInput.extend({ intent: intentAnalysisSchema });

const candidateContext = confirmedIntentContext.extend({ target: candidateReplacementSchema.optional() });
const candidateInput = confirmedIntentInput.extend({ replacement: z.strictObject({ candidate: sermonCandidateSchema,
  otherCandidates: z.array(sermonCandidateSchema) }).optional() });

/** Reuse existing schemas; never accept a complete command as generated content. */
export const aiDraftTaskSchemas = {
  correction: {
    context: correctionProposalInputSchema.omit({ items: true }).extend({ sermonId: id, expectedVersion: z.int().positive() }),
    input: transcriptInput,
    output: correctionDocumentOutputSchema,
  },
  intent_analysis: { context: intentContext, input: transcriptInput, output: generatedAnalysis },
  intent_critique: {
    context: intentContext.extend({ baseAnalysisId: id }),
    input: transcriptInput.extend({ analysis: generatedAnalysis }),
    output: z.strictObject({ analysis: generatedAnalysis, critique: intentCritiqueSchema }),
  },
  summary: { context: confirmedIntentContext, input: confirmedIntentInput, output: sermonSummaryDraftSchema },
  child_candidates: { context: candidateContext, input: candidateInput, output: generatedCandidates },
  adult_candidates: { context: candidateContext, input: candidateInput, output: generatedCandidates },
  final_audit: { context: finalCheckTicketSchema, input: finalAuditInputSchema, output: finalAuditOutputSchema },
} as const;

export const aiDraftTaskSchema = z.enum([
  "correction", "intent_analysis", "intent_critique", "summary", "child_candidates", "adult_candidates", "final_audit",
]);
export type AiDraftTask = z.infer<typeof aiDraftTaskSchema>;

function requestSchema<T extends AiDraftTask, C extends z.ZodType, I extends z.ZodType>(task: T, spec: { context: C; input: I }) {
  return z.strictObject({ task: z.literal(task), context: spec.context, input: spec.input });
}
export const aiDraftRequestSchema = z.discriminatedUnion("task", [
  requestSchema("correction", aiDraftTaskSchemas.correction), requestSchema("intent_analysis", aiDraftTaskSchemas.intent_analysis), requestSchema("intent_critique", aiDraftTaskSchemas.intent_critique),
  requestSchema("summary", aiDraftTaskSchemas.summary), requestSchema("child_candidates", aiDraftTaskSchemas.child_candidates), requestSchema("adult_candidates", aiDraftTaskSchemas.adult_candidates), requestSchema("final_audit", aiDraftTaskSchemas.final_audit),
]);

function resultSchema<T extends AiDraftTask, C extends z.ZodType, O extends z.ZodType>(task: T, spec: { context: C; output: O }) {
  return z.strictObject({ task: z.literal(task), context: spec.context, content: spec.output });
}
export const aiDraftResultSchema = z.discriminatedUnion("task", [
  resultSchema("correction", { context: aiDraftTaskSchemas.correction.context,
    output: z.union([correctionDocumentOutputSchema, correctionProposalInputSchema.pick({ items: true })]) }),
  resultSchema("intent_analysis", aiDraftTaskSchemas.intent_analysis), resultSchema("intent_critique", aiDraftTaskSchemas.intent_critique),
  resultSchema("summary", aiDraftTaskSchemas.summary), resultSchema("child_candidates", aiDraftTaskSchemas.child_candidates), resultSchema("adult_candidates", aiDraftTaskSchemas.adult_candidates), resultSchema("final_audit", aiDraftTaskSchemas.final_audit),
]);

// This envelope is authored by the injected transport shim, NOT by the model.
// It must correlate the completion with its original invocation. Model content
// cannot supply a binding, difficulty, task selector, human identity or usage.
export const aiDraftCompletionSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("completed"), task: aiDraftTaskSchema,
    output: z.discriminatedUnion("format", [
      z.strictObject({ format: z.literal("json"), text: z.string() }),
      z.strictObject({ format: z.literal("structured"), value: z.unknown() }),
    ]),
  }),
  z.strictObject({ outcome: z.literal("failed"), reason: z.enum(["timeout", "transport", "refused", "incomplete"]) }),
]);

export type AiDraftRequest = z.infer<typeof aiDraftRequestSchema>;
export type AiDraftResult = z.infer<typeof aiDraftResultSchema>;
export const aiDraftFailureCodeSchema = z.enum([
  "AI_DRAFT_INPUT_INVALID", "AI_DRAFT_COMPLETION_INVALID", "AI_DRAFT_TASK_MISMATCH",
  "AI_DRAFT_JSON_INVALID", "AI_DRAFT_OUTPUT_INVALID", "AI_DRAFT_TIMEOUT",
  "AI_DRAFT_TRANSPORT_FAILED", "AI_DRAFT_REFUSED", "AI_DRAFT_INCOMPLETE",
  "AI_DRAFT_EVIDENCE_SOURCE_INVALID", "AI_DRAFT_EVIDENCE_NOT_FOUND", "AI_DRAFT_EVIDENCE_AMBIGUOUS",
]);
export type AiDraftFailureCode = z.infer<typeof aiDraftFailureCodeSchema>;
