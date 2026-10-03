import type { FinalCheckTicket } from "./final-check-contract";
import type { FinalCheckMetadataStore } from "./final-check-metadata-contract";
import { createFinalCheckService } from "./final-check";
import {
  finalAuditInputSchema,
  finalAuditOutputSchema,
  finalAuditReportSchema,
  type FinalAuditInput,
  type FinalAuditOutput,
} from "./final-audit-contract";
import { intentFields } from "./sermon-intent-contract";
import type { DeepReadonly, TranscriptRevisionStore } from "./transcript-revision-contract";
import { createTranscriptRevisionService } from "./transcript-revisions";

type ErrorCode = "FINAL_AUDIT_INPUT_INVALID" | "FINAL_AUDIT_NOT_READY" |
  "FINAL_AUDIT_STALE" | "FINAL_AUDIT_OUTPUT_INVALID";

class FinalAuditError extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}
function reject(code: ErrorCode): never { throw new FinalAuditError(code); }
function failure(error: unknown) {
  return {
    outcome: "failed" as const,
    code: error instanceof FinalAuditError ? error.code : "FINAL_AUDIT_INPUT_INVALID" as const,
  };
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = Object.entries(a), right = Object.entries(b);
  return left.length === right.length && left.every(([key, value]) =>
    Object.hasOwn(b, key) && equal(value, (b as Record<string, unknown>)[key]));
}
function mapFinalCheckFailure(code: string): never {
  if (code === "FINAL_CHECK_STALE") reject("FINAL_AUDIT_STALE");
  if (code === "FINAL_CHECK_NOT_READY" || code === "FINAL_CHECK_LAYOUT_UNAVAILABLE" ||
    code === "FINAL_CHECK_DISCLOSURE_UNSUPPORTED") reject("FINAL_AUDIT_NOT_READY");
  reject("FINAL_AUDIT_INPUT_INVALID");
}

/**
 * Builds and validates an advisory final audit without IO or writes.
 * A future adapter may send only `input` to a provider. It must retain `ticket`
 * server-side and call validateWarnings after the response arrives.
 */
export function createFinalAuditService(
  store: TranscriptRevisionStore,
  metadataStore: FinalCheckMetadataStore,
) {
  const finalCheck = createFinalCheckService(store, metadataStore);
  const revisions = createTranscriptRevisionService(store);

  async function currentInput(sermonId: string, input: unknown) {
    const checked = await finalCheck.check(sermonId, input);
    if (checked.outcome !== "input_validated") mapFinalCheckFailure(checked.code);
    const { intent, summary, variants } = checked.result.privateData;
    if (!intent.current || !intent.confirmationId || !summary.current || !summary.reviewId) {
      reject("FINAL_AUDIT_NOT_READY");
    }
    // Read the authoritative confirmed transcript after the final check. This catches
    // a transcript change in the narrow hand-off between composition and audit input.
    const confirmed = await revisions.readConfirmed(sermonId);
    if (confirmed.outcome !== "confirmed") reject("FINAL_AUDIT_STALE");
    const transcriptBinding = checked.result.ticket.binding.transcript;
    const transcriptRevision = confirmed.state.revisions.find((revision) =>
      revision.id === transcriptBinding.revisionId);
    if (confirmed.state.version !== checked.result.ticket.expectedVersion ||
      confirmed.state.currentSourceId !== transcriptBinding.sourceId ||
      confirmed.state.currentRevisionId !== transcriptBinding.revisionId ||
      confirmed.state.currentConfirmationId !== transcriptBinding.confirmationId ||
      !transcriptRevision || transcriptRevision.transcriptSha256 !== transcriptBinding.transcriptSha256) {
      reject("FINAL_AUDIT_STALE");
    }
    const currentMetadata = await metadataStore.read(sermonId);
    if (!equal(currentMetadata, checked.result.ticket.metadata)) reject("FINAL_AUDIT_STALE");
    const candidateVariant = (difficulty: "child" | "adult") => ({
      difficulty,
      candidates: variants[difficulty].provenance.map((item) => ({
        entryId: item.entryId,
        candidate: item.candidate,
      })),
    });
    const auditInput = finalAuditInputSchema.safeParse({
      contractVersion: 1,
      sermonId,
      metadata: checked.result.preview.metadata,
      transcript: transcriptRevision.content,
      intent: {
        analysisId: intent.current.id,
        confirmationId: intent.confirmationId,
        analysis: intent.current.analysis,
      },
      summary: {
        summaryId: summary.current.id,
        reviewId: summary.reviewId,
        draft: summary.current.draft,
      },
      variants: {
        child: candidateVariant("child"),
        adult: candidateVariant("adult"),
      },
    });
    if (!auditInput.success) reject("FINAL_AUDIT_INPUT_INVALID");
    return { ticket: checked.result.ticket, input: auditInput.data };
  }

  function validateReferences(input: FinalAuditInput, output: FinalAuditOutput) {
    const claimIds = new Set(intentFields.flatMap((field) =>
      input.intent.analysis[field].map((claim) => claim.id)));
    const paragraphIds = new Set(input.summary.draft.paragraphs.map((paragraph) => paragraph.id));
    const candidates = new Set(([
      ...input.variants.child.candidates.map((item) => ({ ...item, difficulty: "child" as const })),
      ...input.variants.adult.candidates.map((item) => ({ ...item, difficulty: "adult" as const })),
    ]).map((item) => `${item.difficulty}:${item.entryId}:${item.candidate.id}`));
    for (const warning of output.warnings) {
      if ("intentClaimIds" in warning && warning.intentClaimIds.some((id) => !claimIds.has(id))) {
        reject("FINAL_AUDIT_OUTPUT_INVALID");
      }
      if ("summaryParagraphIds" in warning && warning.summaryParagraphIds.some((id) => !paragraphIds.has(id))) {
        reject("FINAL_AUDIT_OUTPUT_INVALID");
      }
      if ("candidateReferences" in warning && warning.candidateReferences.some((reference) =>
        !candidates.has(`${reference.difficulty}:${reference.entryId}:${reference.candidateId}`))) {
        reject("FINAL_AUDIT_OUTPUT_INVALID");
      }
    }
  }

  return {
    /** Captures a current provider-safe input. This performs no provider call. */
    async prepare(sermonId: string, ticket: unknown) {
      try {
        const prepared = await currentInput(sermonId, ticket);
        return { outcome: "final_audit_input" as const, ...freeze(prepared) };
      } catch (error) { return failure(error); }
    },

    /** Re-runs the hard input check, then validates warning references only. */
    async validateWarnings(sermonId: string, ticket: unknown, providerOutput: unknown) {
      try {
        const current = await currentInput(sermonId, ticket);
        const output = finalAuditOutputSchema.safeParse(providerOutput);
        if (!output.success) reject("FINAL_AUDIT_OUTPUT_INVALID");
        validateReferences(current.input, output.data);
        const report = finalAuditReportSchema.parse({
          effect: "advisory_only",
          publishDecision: "not_evaluated",
          warnings: output.data.warnings,
        });
        return {
          outcome: "final_audit_warnings" as const,
          ticket: freeze(current.ticket as FinalCheckTicket),
          report: freeze(report),
        };
      } catch (error) { return failure(error); }
    },
  };
}
