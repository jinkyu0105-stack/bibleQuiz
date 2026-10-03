import { z } from "zod";
import { locateGeneratedEvidence } from "./ai-evidence-location";
import { resolveGeneratedClaimReferences } from "./generated-claim-references";

import {
  aiDraftCompletionSchema, aiDraftFailureCodeSchema, aiDraftRequestSchema, aiDraftResultSchema, aiDraftTaskSchemas,
  type AiDraftFailureCode, type AiDraftRequest, type AiDraftResult,
} from "./ai-draft-provider-contract";
import type { DeepReadonly } from "./transcript-revision-contract";

type ProviderInput = AiDraftRequest extends infer Request
  ? Request extends AiDraftRequest ? Pick<Request, "task" | "input"> : never : never;

/** Explicitly injected only; no SDK, global fetch, model, secret, retries or persistence. */
export interface AiDraftTransport {
  complete(request: DeepReadonly<ProviderInput>, signal: AbortSignal): Promise<unknown>;
}
export type AiDraftProviderResult =
  | { outcome: "structured_output"; validation: "requires_domain_validation"; result: DeepReadonly<AiDraftResult> }
  | { outcome: "failed"; code: AiDraftFailureCode };
export interface AiDraftProvider {
  generate(serverRequest: unknown): Promise<AiDraftProviderResult>;
}
const optionsSchema = z.strictObject({ timeoutMs: z.int().positive().max(2_147_483_647) });
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
const failed = (code: AiDraftFailureCode) => ({ outcome: "failed" as const, code });

/**
 * Validates syntax and captures context, not current eligibility or semantics.
 * The server must prepare from authoritative reads and subsequently pass the
 * ORIGINAL context/content through P5-08~11 or P5-15. Never rebind delayed output
 * to a fresh head. Success here is private, unregistered and not publishable.
 */
export function createAiDraftProvider(transport: AiDraftTransport, options: unknown): AiDraftProvider {
  return {
    async generate(serverRequest) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const settings = optionsSchema.safeParse(options);
        const parsed = aiDraftRequestSchema.safeParse(serverRequest);
        if (!settings.success || !parsed.success) return failed("AI_DRAFT_INPUT_INVALID");
        // Zod creates an independent snapshot before the first await. The
        // transport receives only content input; context never crosses it.
        const request = freeze(parsed.data);
        const controller = new AbortController();
        const deadline = new Promise<unknown>((resolve) => {
          timer = setTimeout(() => {
            // Settle timeout before abort handlers can reject the operation.
            resolve({ outcome: "failed", reason: "timeout" });
            controller.abort();
          }, settings.data.timeoutMs);
        });
        let completion: unknown;
        try {
          completion = await Promise.race([
            Promise.resolve().then(() => transport.complete(
              freeze({ task: request.task, input: request.input }) as DeepReadonly<ProviderInput>, controller.signal,
            )),
            deadline,
          ]);
        } catch { return failed("AI_DRAFT_TRANSPORT_FAILED"); }
        const envelope = aiDraftCompletionSchema.safeParse(completion);
        if (!envelope.success) return failed("AI_DRAFT_COMPLETION_INVALID");
        if (envelope.data.outcome === "failed") {
          const codes = {
            timeout: "AI_DRAFT_TIMEOUT", transport: "AI_DRAFT_TRANSPORT_FAILED",
            refused: "AI_DRAFT_REFUSED", incomplete: "AI_DRAFT_INCOMPLETE",
          } as const;
          return failed(codes[envelope.data.reason]);
        }
        if (envelope.data.task !== request.task) return failed("AI_DRAFT_TASK_MISMATCH");
        const output = envelope.data.output;
        let content: unknown;
        if (output.format === "json") {
          try { content = JSON.parse(output.text); }
          catch { return failed("AI_DRAFT_JSON_INVALID"); }
        } else content = output.value;
        try { content = locateGeneratedEvidence(request.task, request.input.transcript, content); }
        catch { return failed("AI_DRAFT_OUTPUT_INVALID"); }
        if (request.task === "summary" || request.task === "child_candidates" || request.task === "adult_candidates")
          content = resolveGeneratedClaimReferences(request.input.intent, content).content;
        const checked = aiDraftTaskSchemas[request.task].output.safeParse(content);
        if (!checked.success) return failed("AI_DRAFT_OUTPUT_INVALID");
        const result = aiDraftResultSchema.parse({ task: request.task, context: request.context, content: checked.data });
        return { outcome: "structured_output", validation: "requires_domain_validation", result: freeze(result) };
      } catch {
        // No arbitrary exception, Zod issue, refusal text, response body or cause.
        return failed("AI_DRAFT_INPUT_INVALID");
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}

/** Deliberately omit even successful content/context from copyable diagnostics. */
export function aiDraftDiagnosticForCopy(result: AiDraftProviderResult) {
  if (result.outcome === "structured_output") return { outcome: "structured_output" as const };
  const code = aiDraftFailureCodeSchema.safeParse(result.code);
  return failed(code.success ? code.data : "AI_DRAFT_INPUT_INVALID");
}
