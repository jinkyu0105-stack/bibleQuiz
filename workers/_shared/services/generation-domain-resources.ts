import { correctionDocumentProposalSchema } from "./transcript-correction-document";
import { aiDraftTaskSchemas, type AiDraftTask } from "./ai-draft-provider-contract";
import { canonicalDomainJson, domainLimit, type DomainResourceBudget } from "./generation-domain-codec";
import { domainPreparedSchema } from "./generation-domain-contract";

/** Existing schemas have no finite upper bound for these fields. Infinity is
 * reported, never silently replaced by P5-45's synthetic 128KiB ceiling. */
export const DOMAIN_OUTPUT_BOUNDS = {
  correction: { schemaBound: "finite", maxItems: 1000, maxItemStringCodeUnits: 40996,
    // Legacy items shape only. Current document output is measured at storage.
    // Conservative bound: all seven string lengths at six escaped UTF-8 bytes/unit,
    // plus 1024 bytes/item for keys, enum strings and finite numeric spellings.
    maxOutputBytes: 12 + 1000 * (40996 * 6 + 1024) + 999 },
  intent_analysis: { schemaBound: "unbounded", fields: ["claims", "claim.text", "claim.evidence", "evidence.quote"] },
  intent_critique: { schemaBound: "unbounded", fields: ["analysis", "concerns", "concern.note"] },
  summary: { schemaBound: "unbounded", fields: ["paragraphs", "paragraph.text", "intentClaimIds", "evidence"] },
  child_candidates: { schemaBound: "unbounded", fields: ["candidates", "clue", "explanations", "grounding"] },
  adult_candidates: { schemaBound: "unbounded", fields: ["candidates", "clue", "explanations", "grounding"] },
  final_audit: { schemaBound: "deferred", fields: ["final_domain_migration"] },
} as const;
/** Current correction documents use measured existing input storage limits.
 * Other tasks still require an end-to-end domain storage envelope. */
export function domainStorageBudgetStatus(task: AiDraftTask, storedDocument?: {
  payload: unknown; byteLength: number; chunkCount: number; statementCount: number; displayProjection?: boolean;
}) {
  if (task === "correction" && storedDocument && correctionDocumentProposalSchema.safeParse(storedDocument.payload).success &&
    Number.isSafeInteger(storedDocument.byteLength) && storedDocument.byteLength > 0 && storedDocument.byteLength <= 67_108_864 &&
    Number.isSafeInteger(storedDocument.chunkCount) && storedDocument.chunkCount > 0 && storedDocument.chunkCount <= 4096 &&
    Number.isSafeInteger(storedDocument.statementCount) && storedDocument.statementCount === storedDocument.chunkCount + 3) {
    return { outcome: "ready" as const, path: "correction_document_v1" as const,
      byteLength: storedDocument.byteLength, chunkCount: storedDocument.chunkCount, statementCount: storedDocument.statementCount };
  }
  if (task !== "correction" && task !== "final_audit" && storedDocument) {
    const p = domainPreparedSchema.safeParse(storedDocument.payload), size = storedDocument;
    const taskMatches = p.success && (p.data.operation.family === "intent" ?
      p.data.operation.operation.kind === (task === "intent_analysis" ? "analysis" : task === "intent_critique" ? "critique" : "unsupported") :
      p.data.operation.family === "summary" ? task === "summary" && p.data.operation.operation.kind === "generate" :
      p.data.operation.family === "candidate" && task === `${p.data.operation.operation.difficulty}_candidates` && p.data.operation.operation.kind === "generate");
    if (p.success && p.data.origin === "ai" && taskMatches && p.data.materializedSnapshot !== null && Number.isSafeInteger(size.byteLength) && size.byteLength > 0 && size.byteLength <= 67_108_864 &&
      size.chunkCount === Math.ceil(size.byteLength / 65536) && Number.isSafeInteger(size.statementCount) && size.statementCount === size.chunkCount + (size.displayProjection === false ? 7 : 8)) {
      return { outcome: "ready" as const, path: "content_domain_v1" as const,
        byteLength: size.byteLength, chunkCount: size.chunkCount, statementCount: size.statementCount };
    }
  }
  return { outcome: "not_ready" as const, reason: "resource_budget_unresolved" as const, bound: DOMAIN_OUTPUT_BOUNDS[task] };
}
export function measureDomainResources(task: AiDraftTask, output: unknown, envelope: unknown, basis: unknown,
  referencedEvents: number, targetEvents: number, batchStatements: number | null, budget: DomainResourceBudget) {
  if (!aiDraftTaskSchemas[task].output.safeParse(output).success) return { outcome: "invalid" as const };
  return { ...measureDomainEnvelope(output, envelope, basis, referencedEvents, targetEvents, batchStatements, budget), storage: domainStorageBudgetStatus(task) };
}
export function measureDomainEnvelope(output: unknown, envelope: unknown, basis: unknown,
  referencedEvents: number, targetEvents: number, batchStatements: number | null, budget: DomainResourceBudget) {
  const encode = (v: unknown) => new TextEncoder().encode(canonicalDomainJson(v, budget)).length;
  const outputBytes = encode(output), payloadBytes = encode(envelope);
  const basisBytes = new TextEncoder().encode(canonicalDomainJson(basis, { ...budget,
    maxPayloadBytes: budget.maxDecodedBytes, maxChunks: Math.ceil(budget.maxDecodedBytes / budget.chunkBytes) })).length;
  // Budget all three JSON representations plus UTF-16 staging and byte/chunk copies.
  // This is a conservative serialization accounting unit, NOT a JS heap measurement.
  const decodedBytes = 2 * (outputBytes + payloadBytes + basisBytes), totalBytes = decodedBytes + outputBytes + 2 * payloadBytes + basisBytes;
  if (![referencedEvents, targetEvents, ...(batchStatements === null ? [] : [batchStatements])].every(n => Number.isSafeInteger(n) && n >= 0) ||
    !Number.isSafeInteger(totalBytes)) return { outcome: "invalid" as const };
  const chunks = Math.ceil(payloadBytes / budget.chunkBytes);
  if (referencedEvents > budget.maxReferences || targetEvents > budget.maxTargets || chunks > budget.maxChunks ||
    totalBytes > budget.maxDecodedBytes || (batchStatements !== null && batchStatements > budget.maxBatchStatements)) domainLimit();
  return { outcome: "measured" as const, outputBytes, payloadBytes, chunks, basisBytes, decodedBytes, totalBytes,
    referencedEvents, targetEvents, batchStatements };
}
