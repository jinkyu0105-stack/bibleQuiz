import {
  contextChunkSchema, generationContextEnvelopeSchema, generationContextSchema,
  type ContextEnvelope, type GenerationContext,
} from "./generation-lifecycle-contract";
import { assessFinalCapture, generationAggregateVersion, nextGenerationStage } from "./generation-bridge";
import { sha256Bytes } from "../storage/sha256";
import { utf8ByteLength } from "../storage/utf8-byte-length";

export const GENERATION_CONTEXT_LIMITS = {
  request: { maxContextBytes: 65536, maxChunks: 4, maxReferencedEvents: 32 },
  step: { maxContextBytes: 65536, maxChunks: 4, maxReferencedEvents: 32 },
  wait: { maxContextBytes: 32768, maxChunks: 2, maxReferencedEvents: 32 },
} as const;
export const GENERATION_CONTEXT_CHUNK_BYTES = 16384;
export class GenerationContextError extends Error {
  constructor(readonly code: "CONTEXT_INVALID" | "CONTEXT_LIMIT" | "CONTEXT_CORRUPT") { super(code); this.name = "GenerationContextError"; }
}
function invalid(): never { throw new GenerationContextError("CONTEXT_INVALID"); }
function corrupt(): never { throw new GenerationContextError("CONTEXT_CORRUPT"); }
function limit(): never { throw new GenerationContextError("CONTEXT_LIMIT"); }

/** No coercion, normalization, dropped undefined, non-JSON objects or unsafe numbers.
 * UTF-16 lexical key order is versioned; array order and string bytes are preserved. */
export function canonicalGenerationJson(raw: unknown): string {
  let nodes = 0, stringBytes = 0, emittedBytes = 0;
  const seen = new Set<object>();
  const structured = raw !== null && typeof raw === "object";
  function emit(text: string, bytes = text.length): string {
    emittedBytes += bytes;
    // The existing standalone-scalar contract bounds unescaped string bytes;
    // the serialized-size bound applies to objects/arrays, including children.
    if (structured && emittedBytes > 131072) return limit();
    return text;
  }
  function visit(value: unknown, depth: number): string {
    if (++nodes > 8192 || depth > 32) return limit();
    if (value === null) return emit("null");
    if (typeof value === "string") {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return invalid();
      const bytes = utf8ByteLength(value);
      stringBytes += bytes;
      if (stringBytes > 131072) return limit();
      const escaped = JSON.stringify(value);
      return emit(escaped, bytes + escaped.length - value.length);
    }
    if (typeof value === "boolean") return emit(String(value));
    if (typeof value === "number") return Number.isSafeInteger(value) && !Object.is(value, -0) ? emit(String(value)) : invalid();
    if (!value || typeof value !== "object" || seen.has(value)) return invalid();
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return invalid();
    if (Object.getOwnPropertySymbols(value).length) return invalid();
    seen.add(value);
    let result: string;
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) return invalid();
      emit("", 2 + Math.max(0, value.length - 1));
      result = `[${Array.from(value, (v) => visit(v, depth + 1)).join(",")}]`;
    } else {
      const length = Object.keys(value).length;
      emit("", 2 + length + Math.max(0, length - 1));
      result = `{${Object.keys(value).sort().map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor)) return invalid();
        return `${visit(key, depth + 1)}:${visit(descriptor.value, depth + 1)}`;
      }).join(",")}}`;
    }
    seen.delete(value);
    return result;
  }
  return visit(raw, 0);
}
export function sameLifecycleValue(a: unknown, b: unknown): boolean {
  try { return canonicalGenerationJson(a) === canonicalGenerationJson(b); } catch { return false; }
}
export async function fingerprintLifecycleValue(value: unknown): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(canonicalGenerationJson(value)));
}
function owner(c: GenerationContext) { return c.kind === "wait" ? c.wait : c.authority; }
function requiredEvents(c: GenerationContext): Set<string> {
  const s = owner(c), ids = new Set<string>();
  const fields = new Set(["sourceId", "documentId", "confirmationId", "lastEventId", "id", "selectedId", "rootAnalysisId", "targetId", "critiqueId", "intentConfirmationId", "analysisId", "revisionId"]);
  function walk(raw: unknown) {
    if (!raw || typeof raw !== "object") return;
    for (const [key, value] of Object.entries(raw)) {
      if (fields.has(key) && typeof value === "string") ids.add(value);
      else if (value && typeof value === "object") walk(value);
    }
  }
  walk(s.input); walk(s.content);
  return ids;
}
function validateRelations(c: GenerationContext) {
  const s = owner(c), refs = new Set(c.references.map((r) => r.eventId));
  if (c.references.some((r) => r.sermonId !== s.sermonId) || [...requiredEvents(c)].some((ref) => !refs.has(ref))) return invalid();
  if (s.input.state === "present") {
    const input = s.input;
    if (!c.references.some((r) => r.eventId === input.sourceId && r.kind === "input" && (r.sourceSha256 ?? r.sha256) === input.sourceSha256) ||
      !c.references.some((r) => r.eventId === input.documentId && r.kind === "input" && r.sha256 === input.documentSha256)) return invalid();
  }
  if (c.kind === "request") {
    if (c.candidateTarget && ((c.authority.scope !== "child" && c.authority.scope !== "adult") || c.authority.content.state !== "present" ||
      c.authority.content[c.authority.scope]?.id !== c.candidateTarget.basePoolId || !refs.has(c.candidateTarget.basePoolId))) return invalid();
    if (c.authority.jobStateVersion !== 0 || c.authority.status !== "dispatch_pending" || c.authority.wait !== null) return invalid();
  }
  if (c.kind === "wait") {
    if (c.enter.stateVersion !== c.wait.jobStateVersion || (c.parent &&
      (c.parent.waitGeneration + 1 !== c.wait.generation || c.parent.outcome.stateVersion !== c.enter.stateVersion || c.parent.outcome.eventNo !== c.enter.eventNo))) return invalid();
  }
  if (c.kind !== "step") return;
  const a = c.authority, e = c.execution;
  if (a.status !== "running" || a.wait !== null || c.predecessor.stateVersion !== a.jobStateVersion ||
    c.stepKey !== (c.command ? `correction_${c.command.ordinal}` : e.task) || (c.command && (e.task !== "correction" || a.scope !== "full"))) return invalid();
  const completed: import("./generation-bridge-contract").GenerationStage[] = [];
  let supported = false;
  for (let i = 0; i < 15; i++) {
    const next = nextGenerationStage(a.scope, completed);
    if (next.outcome !== "next") break;
    if (next.stage === e.task) supported = true;
    completed.push(next.stage);
  }
  if (!supported && !(c.command && a.scope === "full" && e.task === "correction")) return invalid();
  if (e.task === "input_resolve") return;
  if (e.task === "place_child" || e.task === "place_adult" || e.task === "final_validate" || e.task === "final_audit") {
    if (e.context !== null && assessFinalCapture(a, e.context).outcome !== "ready") return invalid();
    return;
  }
  if (e.context.sermonId !== a.sermonId || a.input.state !== "present") return invalid();
  if (e.task === "correction") {
    if (a.input.sourceKind !== "caption" || e.context.expectedVersion !== generationAggregateVersion(a) ||
      e.context.sourceId !== a.input.sourceId || e.context.sourceSha256 !== a.input.sourceSha256 || e.context.baseRevisionId !== a.input.documentId ||
      e.context.baseTranscriptSha256 !== a.input.documentSha256) return invalid();
    return;
  }
  const binding = "transcript" in e.context.binding ? e.context.binding.transcript : e.context.binding;
  const i = a.input;
  if (binding.version !== generationAggregateVersion(a) || binding.sourceId !== i.sourceId || binding.sourceRevision !== i.sourceRevision ||
    binding.sourceSha256 !== i.sourceSha256 || binding.revisionId !== i.documentId || binding.transcriptSha256 !== i.documentSha256 ||
    binding.confirmationId !== i.confirmationId || binding.checksumFormat !== i.checksumFormat) return invalid();
  if ("transcript" in e.context.binding && (a.content.state !== "present" ||
    e.context.binding.analysisId !== a.content.intent?.selectedId || e.context.binding.intentConfirmationId !== a.content.intent.confirmation?.id)) return invalid();
  if ((e.task === "child_candidates" || e.task === "adult_candidates") && e.context.target &&
    (a.scope !== (e.task === "child_candidates" ? "child" : "adult") || a.content.state !== "present" ||
      a.content[a.scope]?.id !== e.context.target.basePoolId || !refs.has(e.context.target.basePoolId))) return invalid();
  if (e.task === "intent_critique" && (a.content.state !== "present" || !c.references.some(r => r.kind === "content" && r.eventId === e.context.baseAnalysisId))) return invalid();
}
export type ContextEnvelopeInput = Omit<ContextEnvelope, "fingerprint" | "byteLength" | "chunkCount" | "referencedEvents">;
export type EncodedGenerationContext = {
  envelope: ContextEnvelope; chunks: Array<{ position: number; byteLength: number; sha256: string; body: Uint8Array }>;
};
function checkEnvelope(c: GenerationContext, envelope: ContextEnvelope) {
  const s = owner(c);
  if (envelope.kind !== c.kind || envelope.jobId !== s.jobId || envelope.sermonId !== s.sermonId || envelope.quizSetId !== s.quizSetId ||
    envelope.stepKey !== (c.kind === "step" ? c.stepKey : null) ||
    envelope.waitGeneration !== (c.kind === "wait" ? c.wait.generation : null) || envelope.referencedEvents !== c.references.length) return corrupt();
}
export async function encodeGenerationContext(raw: unknown, base: ContextEnvelopeInput): Promise<EncodedGenerationContext> {
  const canonical = canonicalGenerationJson(raw), parsed = generationContextSchema.safeParse(raw);
  if (!parsed.success || canonical !== canonicalGenerationJson(parsed.data)) return invalid();
  const context = parsed.data;
  validateRelations(context);
  if (context.kind === "request" && context.guidance &&
    await sha256Bytes(new TextEncoder().encode(context.guidance.text)) !== context.guidance.sha256) return invalid();
  const bytes = new TextEncoder().encode(canonical), budget = GENERATION_CONTEXT_LIMITS[context.kind];
  if (bytes.byteLength > budget.maxContextBytes || context.references.length > budget.maxReferencedEvents) return limit();
  const chunks: EncodedGenerationContext["chunks"] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += GENERATION_CONTEXT_CHUNK_BYTES) {
    const body = bytes.slice(offset, offset + GENERATION_CONTEXT_CHUNK_BYTES);
    chunks.push({ position: chunks.length, byteLength: body.byteLength, sha256: await sha256Bytes(body), body });
  }
  const parsedEnvelope = generationContextEnvelopeSchema.safeParse({ ...base, fingerprint: await sha256Bytes(bytes),
    byteLength: bytes.byteLength, chunkCount: chunks.length, referencedEvents: context.references.length });
  if (!parsedEnvelope.success) return invalid();
  checkEnvelope(context, parsedEnvelope.data);
  return { envelope: parsedEnvelope.data, chunks };
}
/** Reads only the supplied bytes. FK existence, durable seal and read consistency
 * remain the future storage adapter's responsibility. expected pins original identity. */
export async function decodeGenerationContext(rawEnvelope: unknown, rawChunks: unknown, expected: ContextEnvelope): Promise<GenerationContext> {
  const parsed = generationContextEnvelopeSchema.safeParse(rawEnvelope), pin = generationContextEnvelopeSchema.safeParse(expected);
  if (!parsed.success || !pin.success || !sameLifecycleValue(parsed.data, pin.data)) return corrupt();
  const e = parsed.data, budget = GENERATION_CONTEXT_LIMITS[e.kind];
  if (e.byteLength > budget.maxContextBytes || e.chunkCount > budget.maxChunks || e.referencedEvents > budget.maxReferencedEvents) return limit();
  if (!Array.isArray(rawChunks) || rawChunks.length !== e.chunkCount) return corrupt();
  const bytes = new Uint8Array(e.byteLength);
  let offset = 0;
  for (const [index, raw] of rawChunks.entries()) {
    const c = contextChunkSchema.safeParse(raw);
    if (!c.success || c.data.position !== index || c.data.byteLength !== c.data.body.byteLength ||
      c.data.byteLength !== Math.min(GENERATION_CONTEXT_CHUNK_BYTES, e.byteLength - offset) || await sha256Bytes(c.data.body) !== c.data.sha256) return corrupt();
    bytes.set(c.data.body, offset); offset += c.data.byteLength;
  }
  if (offset !== e.byteLength || await sha256Bytes(bytes) !== e.fingerprint) return corrupt();
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), raw: unknown = JSON.parse(text);
    if (canonicalGenerationJson(raw) !== text) return corrupt();
    // Chunk lengths/digests and the full digest were checked above. Re-encoding
    // would allocate and hash those identical bytes again. Keep all semantic
    // checks performed by the writer, including schema losslessness and owner.
    const context = generationContextSchema.parse(raw);
    if (canonicalGenerationJson(context) !== text) return corrupt();
    validateRelations(context);
    checkEnvelope(context, e);
    if (context.kind === "request" && context.guidance &&
      await sha256Bytes(new TextEncoder().encode(context.guidance.text)) !== context.guidance.sha256) return corrupt();
    return context;
  } catch { return corrupt(); }
}
export function assessContextIdentity(expected: ContextEnvelope, observed: ContextEnvelope): "exact" | "conflict" {
  const a = generationContextEnvelopeSchema.safeParse(expected), b = generationContextEnvelopeSchema.safeParse(observed);
  return a.success && b.success && sameLifecycleValue(a.data, b.data) ? "exact" : "conflict";
}

/** Same authenticated request key/meaning may replay the original context ID.
 * This evaluates a supplied bundle; it does not look up or authenticate a row. */
export async function assessRequestContextReplay(requestKey: string, rawRequest: unknown, stored: EncodedGenerationContext): Promise<
  { outcome: "replayed"; jobId: string; contextId: string } | { outcome: "conflict" | "corrupt" }
> {
  try {
    const original = await decodeGenerationContext(stored.envelope, stored.chunks, stored.envelope);
    if (original.kind !== "request" || stored.envelope.requestKey !== requestKey) return { outcome: "conflict" };
    const proposed = await encodeGenerationContext(rawRequest, stored.envelope);
    if (proposed.envelope.fingerprint !== stored.envelope.fingerprint) return { outcome: "conflict" };
    return { outcome: "replayed", jobId: stored.envelope.jobId, contextId: stored.envelope.contextId };
  } catch { return { outcome: "corrupt" }; }
}

/** Cross-links are value equality only, not FK existence/seal/ownership proof. */
export async function assessOriginalContextLink(child: EncodedGenerationContext, request: EncodedGenerationContext): Promise<{ outcome: "eligible" | "conflict" | "corrupt" }> {
  try {
    const c = await decodeGenerationContext(child.envelope, child.chunks, child.envelope);
    const r = await decodeGenerationContext(request.envelope, request.chunks, request.envelope);
    if (c.kind === "request" || r.kind !== "request" || child.envelope.requestKey !== request.envelope.requestKey ||
      !sameLifecycleValue(c.request, { contextId: request.envelope.contextId, fingerprint: request.envelope.fingerprint }) ||
      owner(c).jobId !== r.authority.jobId || owner(c).sermonId !== r.authority.sermonId || owner(c).quizSetId !== r.authority.quizSetId ||
      (c.kind === "step" && (c.authority.scope !== r.authority.scope || (c.guidance !== null && (r.guidance === null || !sameLifecycleValue(c.guidance, c.request)))))) return { outcome: "conflict" };
    return { outcome: "eligible" };
  } catch { return { outcome: "corrupt" }; }
}
