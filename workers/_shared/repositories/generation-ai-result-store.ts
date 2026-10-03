import { z } from "zod";

import type {
  GenerationResultProbe,
  GenerationResultReference,
} from "./generation-runtime-store";
import { sha256Bytes } from "../storage/sha256";
import { correctionDocumentProposalSchema } from "../services/transcript-correction-document";
import { transcriptSourcePayloadSchema } from "../services/transcript-input-contract";
import { createSermonInputStore } from "./sermon-input-store";
import { verifyContent } from "../services/transcript-content";
import { withinTranscriptCharacterLimit } from "../services/transcript-character-limit";

const id = z.string().min(1).max(128);
const inputEventId = id.regex(/^[A-Za-z0-9_-]+$/u);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const timestamp = z.iso.datetime();
const aiTask = z.enum([
  "correction",
  "intent_analysis",
  "intent_critique",
  "summary",
  "child_candidates",
  "adult_candidates",
  "final_audit",
]);

export type AiGenerationTask = z.infer<typeof aiTask>;

const usageSchema = z.strictObject({
  id,
  inputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  audioInputTokens: z.number().int().nonnegative().nullable(),
  audioSeconds: z.number().int().nonnegative().nullable(),
  pricingVersion: id,
  estimatedCostMicroUsd: z.number().int().nonnegative(),
  usageSource: z.enum(["provider_reported", "provider_partial"]),
  observedAt: timestamp,
}).refine((value) => [
  value.inputTokens,
  value.cachedInputTokens,
  value.reasoningTokens,
  value.outputTokens,
  value.audioInputTokens,
  value.audioSeconds,
].some((metric) => metric !== null));

export type AiGenerationUsage = z.input<typeof usageSchema>;

const correctionResultSchema = z.strictObject({
  type: z.literal("correction"),
  eventId: inputEventId,
  actorId: digest,
  payload: z.unknown(),
});

const contentResultSchema = z.strictObject({
  type: z.literal("content"),
  eventId: id,
  expectedContentEventCount: z.number().int().nonnegative(),
  kind: z.enum(["intent_analysis", "intent_critique", "summary", "candidate"]),
  difficulty: z.enum(["child", "adult"]).nullable(),
  baseAnalysisEventId: id.nullable(),
  analysisEventId: id.nullable(),
  intentConfirmationEventId: id.nullable(),
  payload: z.unknown(),
});

const finalAuditResultSchema = z.strictObject({
  type: z.literal("final_audit"),
  resultId: id,
  finalCheckTicketId: id,
  payload: z.unknown(),
});

const resultSchema = z.discriminatedUnion("type", [
  correctionResultSchema,
  contentResultSchema,
  finalAuditResultSchema,
]);

export type AiGenerationDomainResult = z.input<typeof resultSchema>;

const providerCallSchema = z.strictObject({
  id,
  provider: z.string().min(1).max(64),
  model: id,
  reasoningEffort: z.string().min(1).max(32).nullable(),
  providerRequestIdOpaque: digest.nullable(),
});

export type AiGenerationProviderCall = z.input<typeof providerCallSchema>;

const startCallSchema = z.strictObject({
  jobId: id,
  stepKey: id,
  task: aiTask,
  inputFingerprint: digest,
  expectedAttempt: z.number().int().positive(),
  claimToken: id,
  call: providerCallSchema,
  startedAt: timestamp,
});

export type StartAiProviderCallCommand = z.input<typeof startCallSchema>;

const commitSchema = z.strictObject({
  jobId: id,
  stepKey: id,
  task: aiTask,
  inputFingerprint: digest,
  expectedAttempt: z.number().int().positive(),
  callId: id,
  usage: usageSchema,
  result: resultSchema,
  nextStep: id,
  completedAt: timestamp,
});

export type CommitAiGenerationSuccessCommand = z.input<typeof commitSchema>;

const failureSchema = z.strictObject({
  jobId: id,
  stepKey: id,
  task: aiTask,
  inputFingerprint: digest,
  expectedAttempt: z.number().int().positive(),
  callId: id,
  usage: usageSchema,
  completedAt: timestamp,
});

export type CommitAiGenerationFailureCommand = z.input<typeof failureSchema>;

type AiStoreFailureCode =
  | "GENERATION_AI_INVALID"
  | "GENERATION_AI_STATE_CONFLICT"
  | "GENERATION_AI_STEP_UNCERTAIN"
  | "GENERATION_AI_STORAGE_CORRUPT";

export class GenerationAiResultStoreError extends Error {
  constructor(readonly code: AiStoreFailureCode) {
    super(code);
  }
}

function fail(code: AiStoreFailureCode): never {
  throw new GenerationAiResultStoreError(code);
}

function resultChanges(result: unknown): number | null {
  if (!result || typeof result !== "object" || Reflect.get(result, "success") !== true) return null;
  const meta = Reflect.get(result, "meta");
  const changes = meta && typeof meta === "object" ? Reflect.get(meta, "changes") : null;
  return typeof changes === "number" && Number.isSafeInteger(changes) && changes >= 0 ? changes : null;
}

function exactBatch(results: unknown, expected: readonly number[]): boolean {
  return Array.isArray(results) && results.length === expected.length &&
    results.every((result, index) => resultChanges(result) === expected[index]);
}

function jsonBytes(value: unknown): Uint8Array {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    return fail("GENERATION_AI_INVALID");
  }
  if (text === undefined || text.length === 0) return fail("GENERATION_AI_INVALID");
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength < 1 || bytes.byteLength > 67_108_864) return fail("GENERATION_AI_INVALID");
  return bytes;
}

function blobChunks(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 65_536) {
    chunks.push(bytes.slice(offset, Math.min(offset + 65_536, bytes.byteLength)));
  }
  if (chunks.length < 1 || chunks.length > 4096) return fail("GENERATION_AI_INVALID");
  return chunks;
}

function textChunks(bytes: Uint8Array): string[] {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 16_384, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--;
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function bytesFromD1(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return Uint8Array.from(value as number[]);
  }
  return null;
}

async function rows(database: D1Database, sql: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  const result = await database.prepare(sql).bind(...values).all();
  if (!result.success || !Array.isArray(result.results)) return fail("GENERATION_AI_STORAGE_CORRUPT");
  return result.results as Record<string, unknown>[];
}

type ReceiptContext = {
  generation_job_id: string;
  step_key: string;
  task: AiGenerationTask;
  effect_class: "ai_provider";
  input_fingerprint: string;
  input_version: number;
  source_id: string;
  document_id: string;
  document_sha256: string;
  confirmation_id: string | null;
  ticket_id: string | null;
  state: string;
  attempt_count: number;
  claim_token: string | null;
  result_kind: string | null;
  result_id: string | null;
  result_version: number | null;
  result_fingerprint: string | null;
  sermon_id: string;
  quiz_set_id: string;
  state_version: number;
  event_count: number;
  job_status: string;
};

async function receiptContext(database: D1Database, jobId: string, stepKey: string): Promise<ReceiptContext | null> {
  const found = await rows(database, `SELECT r.generation_job_id,r.step_key,r.task,r.effect_class,r.input_fingerprint,
    r.input_version,r.source_id,r.document_id,r.document_sha256,r.confirmation_id,r.ticket_id,r.state,
    r.attempt_count,r.claim_token,r.result_kind,r.result_id,r.result_version,r.result_fingerprint,
    j.sermon_id,j.quiz_set_id,j.state_version,j.event_count,j.status AS job_status
    FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id
    WHERE r.generation_job_id=? AND r.step_key=?`, [jobId, stepKey]);
  if (found.length > 1) return fail("GENERATION_AI_STORAGE_CORRUPT");
  if (found.length === 0) return null;
  const parsed = z.strictObject({
    generation_job_id: id,
    step_key: id,
    task: aiTask,
    effect_class: z.literal("ai_provider"),
    input_fingerprint: digest,
    input_version: z.number().int().positive(),
    source_id: id,
    document_id: id,
    document_sha256: digest,
    confirmation_id: id.nullable(),
    ticket_id: id.nullable(),
    state: z.string(),
    attempt_count: z.number().int().positive(),
    claim_token: id.nullable(),
    result_kind: z.string().nullable(),
    result_id: id.nullable(),
    result_version: z.number().int().positive().nullable(),
    result_fingerprint: digest.nullable(),
    sermon_id: id,
    quiz_set_id: id,
    state_version: z.number().int().nonnegative(),
    event_count: z.number().int().positive(),
    job_status: z.string(),
  }).safeParse(found[0]);
  return parsed.success ? parsed.data : fail("GENERATION_AI_STORAGE_CORRUPT");
}

function taskMatchesResult(task: AiGenerationTask, result: z.output<typeof resultSchema>): boolean {
  if (task === "correction") return result.type === "correction";
  if (task === "final_audit") return result.type === "final_audit";
  if (result.type !== "content") return false;
  return (task === "intent_analysis" && result.kind === "intent_analysis" && result.difficulty === null) ||
    (task === "intent_critique" && result.kind === "intent_critique" && result.difficulty === null) ||
    (task === "summary" && result.kind === "summary" && result.difficulty === null) ||
    (task === "child_candidates" && result.kind === "candidate" && result.difficulty === "child") ||
    (task === "adult_candidates" && result.kind === "candidate" && result.difficulty === "adult");
}

function resultKind(task: AiGenerationTask): string {
  if (task === "correction") return "correction_proposal";
  if (task === "final_audit") return "final_audit_result";
  if (task === "intent_analysis") return "intent_analysis_event";
  if (task === "intent_critique") return "intent_critique_event";
  if (task === "summary") return "summary_event";
  return task === "child_candidates" ? "child_candidates_event" : "adult_candidates_event";
}

async function payloadDigest(database: D1Database, link: Record<string, unknown>): Promise<string | null> {
  let expectedHash: unknown;
  let expectedBytes: unknown;
  let expectedChunks: unknown;
  let chunkRows: Record<string, unknown>[];
  if (link.task === "correction") {
    const records = await rows(database, `SELECT payload_sha256,byte_length,chunk_count,state FROM sermon_input_events
      WHERE sermon_id=? AND id=? AND kind='proposal'`, [link.correction_sermon_id, link.correction_event_id]);
    if (records.length !== 1 || records[0]?.state !== "sealed") return null;
    expectedHash = records[0]?.payload_sha256;
    expectedBytes = records[0]?.byte_length;
    expectedChunks = records[0]?.chunk_count;
    chunkRows = await rows(database, `SELECT position,body FROM sermon_input_chunks
      WHERE sermon_id=? AND event_id=? ORDER BY position`, [link.correction_sermon_id, link.correction_event_id]);
    if (chunkRows.length !== expectedChunks || chunkRows.some((row, index) => row.position !== index || typeof row.body !== "string")) return null;
    const bytes = new TextEncoder().encode(chunkRows.map((row) => row.body as string).join(""));
    if (bytes.byteLength !== expectedBytes) return null;
    return await sha256Bytes(bytes) === expectedHash ? expectedHash as string : null;
  }
  if (link.task === "final_audit") {
    const records = await rows(database, `SELECT result_fingerprint,payload_sha256,payload_byte_length,payload_chunk_count,state
      FROM ai_final_audit_results WHERE id=?`, [link.final_audit_result_id]);
    if (records.length !== 1 || records[0]?.state !== "sealed" || records[0]?.result_fingerprint !== link.result_fingerprint) return null;
    expectedHash = records[0]?.payload_sha256;
    expectedBytes = records[0]?.payload_byte_length;
    expectedChunks = records[0]?.payload_chunk_count;
    chunkRows = await rows(database, `SELECT position,byte_length,chunk_sha256,body FROM ai_final_audit_chunks
      WHERE audit_result_id=? ORDER BY position`, [link.final_audit_result_id]);
  } else {
    const records = await rows(database, `SELECT e.payload_sha256,e.payload_byte_length,e.payload_chunk_count,e.state,
      p.verified FROM sermon_content_events e JOIN sermon_content_payloads p
      ON p.sermon_id=e.sermon_id AND p.event_id=e.event_id WHERE e.sermon_id=? AND e.event_id=?`,
    [link.content_sermon_id, link.content_event_id]);
    if (records.length !== 1 || records[0]?.state !== "sealed" || records[0]?.verified !== 1) return null;
    expectedHash = records[0]?.payload_sha256;
    expectedBytes = records[0]?.payload_byte_length;
    expectedChunks = records[0]?.payload_chunk_count;
    chunkRows = await rows(database, `SELECT position,byte_length,chunk_sha256,body FROM sermon_content_chunks
      WHERE sermon_id=? AND event_id=? ORDER BY position`, [link.content_sermon_id, link.content_event_id]);
  }
  if (typeof expectedHash !== "string" || typeof expectedBytes !== "number" || typeof expectedChunks !== "number" ||
    chunkRows.length !== expectedChunks) return null;
  const bodies: Uint8Array[] = [];
  for (const [index, row] of chunkRows.entries()) {
    const body = bytesFromD1(row.body);
    if (!body || row.position !== index || row.byte_length !== body.byteLength ||
      await sha256Bytes(body) !== row.chunk_sha256) return null;
    bodies.push(body);
  }
  const joined = new Uint8Array(bodies.reduce((sum, body) => sum + body.byteLength, 0));
  let offset = 0;
  for (const body of bodies) {
    joined.set(body, offset);
    offset += body.byteLength;
  }
  return joined.byteLength === expectedBytes && await sha256Bytes(joined) === expectedHash ? expectedHash : null;
}

export function createGenerationAiResultStore(database: D1Database) {
  async function probeSucceeded(
    jobId: string,
    stepKey: string,
    expected?: { callId: string; usageId: string; result: GenerationResultReference },
  ): Promise<GenerationResultProbe> {
    try {
      const receipt = await receiptContext(database, jobId, stepKey);
      const links = await rows(database, `SELECT l.*,u.provider_call_id,u.generation_job_id AS usage_job_id,
        u.step_key AS usage_step_key,u.attempt_number AS usage_attempt,u.task AS usage_task,
        c.generation_job_id AS call_job_id,c.step_key AS call_step_key,c.attempt_number AS call_attempt,
        c.task AS call_task,c.state AS call_state
        FROM generation_step_result_links l JOIN ai_usage_events u ON u.id=l.usage_event_id
        JOIN ai_provider_calls c ON c.id=u.provider_call_id
        WHERE l.generation_job_id=? AND l.step_key=?`, [jobId, stepKey]);
      if (!receipt) return links.length === 0 ? "absent" : "mismatch";
      if (receipt.state !== "succeeded") {
        const partial = await rows(database, `SELECT
          (SELECT count(*) FROM ai_provider_calls WHERE generation_job_id=? AND step_key=?) AS calls,
          (SELECT count(*) FROM ai_usage_events WHERE generation_job_id=? AND step_key=?) AS usages,
          (SELECT count(*) FROM generation_step_result_links WHERE generation_job_id=? AND step_key=?) AS links,
          (SELECT count(*) FROM sermon_content_events WHERE generation_job_id=? AND step_key=?) AS content_results,
          (SELECT count(*) FROM ai_final_audit_results WHERE generation_job_id=? AND step_key=?) AS audit_results`,
        [jobId, stepKey, jobId, stepKey, jobId, stepKey, jobId, stepKey, jobId, stepKey]);
        const total = partial.length === 1
          ? ["calls", "usages", "links", "content_results", "audit_results"]
              .reduce((sum, key) => sum + (typeof partial[0]?.[key] === "number" ? partial[0][key] as number : 0), 0)
          : 1;
        return total === 0 ? "absent" : "mismatch";
      }
      if (links.length !== 1) return "mismatch";
      const link = links[0]!;
      if (link.task !== receipt.task || link.result_kind !== receipt.result_kind || link.result_id !== receipt.result_id ||
        link.result_version !== receipt.result_version || link.result_fingerprint !== receipt.result_fingerprint ||
        link.usage_job_id !== jobId || link.usage_step_key !== stepKey || link.usage_attempt !== receipt.attempt_count ||
        link.usage_task !== receipt.task || link.call_job_id !== jobId || link.call_step_key !== stepKey ||
        link.call_attempt !== receipt.attempt_count || link.call_task !== receipt.task || link.call_state !== "completed") return "mismatch";
      if (expected && (link.provider_call_id !== expected.callId || link.usage_event_id !== expected.usageId ||
        receipt.result_kind !== expected.result.kind || receipt.result_id !== expected.result.id ||
        receipt.result_version !== expected.result.version || receipt.result_fingerprint !== expected.result.fingerprint)) return "mismatch";
      const event = await rows(database, `SELECT j.state_version,j.event_count,j.required_event_no,j.required_event_state_version,
        e.event_no,e.job_state_version,e.step_key,e.event_code FROM generation_jobs j
        JOIN generation_job_events e ON e.generation_job_id=j.id AND e.event_no=j.required_event_no
          AND e.job_state_version=j.required_event_state_version WHERE j.id=?`, [jobId]);
      if (event.length !== 1 || event[0]?.event_no !== event[0]?.event_count ||
        event[0]?.job_state_version !== event[0]?.state_version || event[0]?.step_key !== stepKey ||
        event[0]?.event_code !== "step_succeeded") return "mismatch";
      const verified = await payloadDigest(database, link);
      return verified === receipt.result_fingerprint ? "exact" : "mismatch";
    } catch {
      return "unavailable";
    }
  }

  async function startProviderCall(raw: StartAiProviderCallCommand): Promise<"started" | "replayed"> {
    const parsed = startCallSchema.safeParse(raw);
    if (!parsed.success) return fail("GENERATION_AI_INVALID");
    const command = parsed.data;
    const context = await receiptContext(database, command.jobId, command.stepKey);
    if (!context || context.task !== command.task || context.input_fingerprint !== command.inputFingerprint ||
      context.state !== "claimed" || context.attempt_count !== command.expectedAttempt ||
      context.claim_token !== command.claimToken || context.job_status !== "running") return fail("GENERATION_AI_STATE_CONFLICT");
    const statements = [
      database.prepare(`UPDATE generation_step_receipts SET state='effect_started',provider_request_id_opaque=?,updated_at=?
        WHERE generation_job_id=? AND step_key=? AND state='claimed' AND attempt_count=? AND claim_token=?`)
        .bind(command.call.providerRequestIdOpaque, command.startedAt, command.jobId, command.stepKey,
          command.expectedAttempt, command.claimToken),
      database.prepare(`INSERT INTO ai_provider_calls (id,generation_job_id,step_key,attempt_number,quiz_set_id,sermon_id,
        task,input_fingerprint,provider,model,reasoning_effort,state,provider_request_id_opaque,started_at,completed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'effect_started',?,?,NULL)`)
        .bind(command.call.id, command.jobId, command.stepKey, command.expectedAttempt, context.quiz_set_id,
          context.sermon_id, command.task, command.inputFingerprint, command.call.provider, command.call.model,
          command.call.reasoningEffort, command.call.providerRequestIdOpaque, command.startedAt),
    ];
    try {
      const results = await database.batch(statements);
      if (exactBatch(results, [1, 1])) return "started";
    } catch { /* Resolve only this receipt/call identity below. */ }
    const check = await rows(database, `SELECT r.state,r.attempt_count,r.input_fingerprint,c.id,c.task,c.state AS call_state,
      c.provider,c.model,c.reasoning_effort,c.provider_request_id_opaque FROM generation_step_receipts r
      JOIN ai_provider_calls c ON c.generation_job_id=r.generation_job_id AND c.step_key=r.step_key
        AND c.attempt_number=r.attempt_count WHERE r.generation_job_id=? AND r.step_key=?`, [command.jobId, command.stepKey]);
    if (check.length === 1 && check[0]?.state === "effect_started" && check[0]?.attempt_count === command.expectedAttempt &&
      check[0]?.input_fingerprint === command.inputFingerprint && check[0]?.id === command.call.id &&
      check[0]?.task === command.task && check[0]?.call_state === "effect_started" &&
      check[0]?.provider === command.call.provider && check[0]?.model === command.call.model &&
      check[0]?.reasoning_effort === command.call.reasoningEffort &&
      check[0]?.provider_request_id_opaque === command.call.providerRequestIdOpaque) return "replayed";
    return fail("GENERATION_AI_STEP_UNCERTAIN");
  }

  async function preparePayload(result: z.output<typeof resultSchema>) {
    const bytes = jsonBytes(result.payload);
    const payloadSha256 = await sha256Bytes(bytes);
    const chunks = blobChunks(bytes);
    const chunkHashes = await Promise.all(chunks.map(sha256Bytes));
    return { bytes, payloadSha256, chunks, chunkHashes };
  }

  async function commitSuccess(raw: CommitAiGenerationSuccessCommand): Promise<{
    outcome: "succeeded" | "replayed";
    result: GenerationResultReference;
  }> {
    const parsed = commitSchema.safeParse(raw);
    if (!parsed.success || !taskMatchesResult(parsed.data.task, parsed.data.result)) return fail("GENERATION_AI_INVALID");
    const command = parsed.data;
    const prepared = await preparePayload(command.result);
    const resultId = command.result.type === "final_audit"
      ? command.result.resultId
      : command.result.type === "correction"
        ? command.result.eventId
        : command.result.eventId;
    const context = await receiptContext(database, command.jobId, command.stepKey);
    if (!context || context.task !== command.task || context.input_fingerprint !== command.inputFingerprint) {
      return fail("GENERATION_AI_STATE_CONFLICT");
    }
    const resultVersion = command.result.type === "correction" ? context.input_version + 1
      : command.result.type === "content" ? context.input_version + command.result.expectedContentEventCount + 1 : 1;
    const reference: GenerationResultReference = {
      kind: resultKind(command.task), id: resultId, version: resultVersion, fingerprint: prepared.payloadSha256,
    };
    if (context.state === "succeeded") {
      const probe = await probeSucceeded(command.jobId, command.stepKey, {
        callId: command.callId, usageId: command.usage.id, result: reference,
      });
      if (probe === "exact") return { outcome: "replayed", result: reference };
      return fail("GENERATION_AI_STEP_UNCERTAIN");
    }
    if (context.state !== "effect_started" || context.attempt_count !== command.expectedAttempt ||
      context.job_status !== "running") return fail("GENERATION_AI_STEP_UNCERTAIN");
    const callRows = await rows(database, `SELECT provider,model,state FROM ai_provider_calls
      WHERE id=? AND generation_job_id=? AND step_key=? AND attempt_number=?`,
    [command.callId, command.jobId, command.stepKey, command.expectedAttempt]);
    if (callRows.length !== 1 || callRows[0]?.state !== "effect_started") return fail("GENERATION_AI_STEP_UNCERTAIN");
    const provider = callRows[0]?.provider;
    const model = callRows[0]?.model;
    if (typeof provider !== "string" || typeof model !== "string") return fail("GENERATION_AI_STORAGE_CORRUPT");
    const statements: D1PreparedStatement[] = [];
    const changes: number[] = [];
    if (command.result.type === "correction") {
      const correction = command.result;
      const inputRows = await rows(database, `SELECT source_type FROM sermon_input_events WHERE sermon_id=? AND version=?
        AND source_id=? AND document_id=? AND document_sha256=? AND state='sealed'`,
      [context.sermon_id, context.input_version, context.source_id, context.document_id, context.document_sha256]);
      if (inputRows.length !== 1 || typeof inputRows[0]?.source_type !== "string") return fail("GENERATION_AI_STATE_CONFLICT");
      const documentProposal = correctionDocumentProposalSchema.safeParse(correction.payload);
      if (!documentProposal.success) return fail("GENERATION_AI_INVALID");
      {
        const proposal = documentProposal.data;
        if (proposal.sourceId !== context.source_id || proposal.baseDocumentId !== context.document_id ||
          proposal.baseDocumentSha256 !== context.document_sha256 ||
          !["caption_plain", "caption_timed"].includes(inputRows[0].source_type)) return fail("GENERATION_AI_INVALID");
        const inputStore = createSermonInputStore(database);
        const sourceRecord = await inputStore.event(context.sermon_id, context.source_id);
        if (!sourceRecord || sourceRecord.kind !== "source") return fail("GENERATION_AI_STORAGE_CORRUPT");
        const source = transcriptSourcePayloadSchema.safeParse(await inputStore.payload(sourceRecord));
        if (!source.success) return fail("GENERATION_AI_STORAGE_CORRUPT");
        const sourceSha = source.data.sourceMode === "public_unofficial" ? source.data.sourceSha256 : sourceRecord.document_sha256;
        if (proposal.sourceSha256 !== sourceSha ||
          !withinTranscriptCharacterLimit(proposal.content.format === "plain_text" ? proposal.content.text : proposal.content.segments)) return fail("GENERATION_AI_INVALID");
        try { verifyContent(proposal.content, source.data); }
        catch { return fail("GENERATION_AI_INVALID"); }
      }
      const chunks = textChunks(prepared.bytes);
      statements.push(database.prepare(`INSERT INTO sermon_input_events (sermon_id,version,id,kind,source_type,source_id,
        document_id,confirmation_id,parent_document_id,related_id,document_sha256,payload_sha256,chunk_count,byte_length,
        actor_id,created_at,state,required_state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(context.sermon_id, resultVersion, command.result.eventId, "proposal", inputRows[0].source_type,
          context.source_id, context.document_id, context.confirmation_id, context.document_id, null,
          context.document_sha256, prepared.payloadSha256, chunks.length, prepared.bytes.byteLength,
          command.result.actorId, command.completedAt, "pending", "sealed"));
      changes.push(1);
      for (let offset = 0; offset < chunks.length; offset += 8) {
        const page = chunks.slice(offset, offset + 8);
        statements.push(database.prepare(`INSERT INTO sermon_input_chunks (sermon_id,event_id,position,body) VALUES
          ${page.map(() => "(?,?,?,?)").join(",")}`)
          .bind(...page.flatMap((body, index) => [context.sermon_id, correction.eventId, offset + index, body])));
        changes.push(page.length);
      }
      statements.push(
        database.prepare(`UPDATE sermon_input_heads SET version=? WHERE sermon_id=? AND version=?`)
          .bind(resultVersion, context.sermon_id, context.input_version),
        database.prepare(`UPDATE sermon_input_events SET state='sealed' WHERE sermon_id=? AND id=? AND state='pending'`)
          .bind(context.sermon_id, command.result.eventId),
      );
      changes.push(1, 1);
    } else if (command.result.type === "content") {
      const sequence = command.result.expectedContentEventCount + 1;
      statements.push(database.prepare(`INSERT INTO sermon_content_events (sermon_id,event_id,content_sequence,
        aggregate_version,origin,kind,difficulty,generation_job_id,step_key,input_version,source_id,document_id,
        document_sha256,confirmation_id,base_analysis_event_id,analysis_event_id,intent_confirmation_event_id,
        payload_sha256,payload_byte_length,payload_chunk_count,state,required_state,created_by_actor_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(context.sermon_id, command.result.eventId, sequence, resultVersion, "ai", command.result.kind,
          command.result.difficulty, command.jobId, command.stepKey, context.input_version, context.source_id,
          context.document_id, context.document_sha256, context.confirmation_id, command.result.baseAnalysisEventId,
          command.result.analysisEventId, command.result.intentConfirmationEventId, prepared.payloadSha256,
          prepared.bytes.byteLength, prepared.chunks.length, "assembling", "sealed", null, command.completedAt));
      statements.push(database.prepare(`INSERT INTO sermon_content_payloads (sermon_id,event_id,codec,chunk_bytes,
        chunk_count,byte_length,payload_sha256,verified) VALUES (?,?,'content-event-json-utf8-v1',65536,?,?,?,0)`)
        .bind(context.sermon_id, command.result.eventId, prepared.chunks.length, prepared.bytes.byteLength,
          prepared.payloadSha256));
      changes.push(1, 1);
      for (const [position, chunk] of prepared.chunks.entries()) {
        statements.push(database.prepare(`INSERT INTO sermon_content_chunks
          (sermon_id,event_id,position,byte_length,chunk_sha256,body,verified) VALUES (?,?,?,?,?,?,1)`)
          .bind(context.sermon_id, command.result.eventId, position, chunk.byteLength,
            prepared.chunkHashes[position], arrayBuffer(chunk)));
        changes.push(1);
      }
      if (command.result.expectedContentEventCount === 0) {
        statements.push(database.prepare(`INSERT INTO sermon_content_heads
          (sermon_id,event_count,last_event_id,required_event_count,required_event_id) VALUES (?,1,?,1,?)`)
          .bind(context.sermon_id, command.result.eventId, command.result.eventId));
      } else {
        statements.push(database.prepare(`UPDATE sermon_content_heads SET event_count=?,last_event_id=?,
          required_event_count=?,required_event_id=? WHERE sermon_id=? AND event_count=?`)
          .bind(sequence, command.result.eventId, sequence, command.result.eventId,
            context.sermon_id, command.result.expectedContentEventCount));
      }
      statements.push(
        database.prepare(`UPDATE sermon_content_payloads SET verified=1 WHERE sermon_id=? AND event_id=? AND verified=0`)
          .bind(context.sermon_id, command.result.eventId),
        database.prepare(`UPDATE sermon_content_events SET state='sealed' WHERE sermon_id=? AND event_id=? AND state='assembling'`)
          .bind(context.sermon_id, command.result.eventId),
      );
      changes.push(1, 1, 1);
    } else {
      if (context.ticket_id !== command.result.finalCheckTicketId) return fail("GENERATION_AI_STATE_CONFLICT");
      statements.push(database.prepare(`INSERT INTO ai_final_audit_results (id,generation_job_id,step_key,
        final_check_ticket_id,result_version,result_fingerprint,payload_sha256,payload_byte_length,payload_chunk_count,
        advisory_mode,publish_decision,state,required_state,created_at)
        VALUES (?,?,?, ?,1,?,?,?,?, 'advisory_only','not_evaluated','assembling','sealed',?)`)
        .bind(command.result.resultId, command.jobId, command.stepKey, command.result.finalCheckTicketId,
          prepared.payloadSha256, prepared.payloadSha256, prepared.bytes.byteLength, prepared.chunks.length,
          command.completedAt));
      changes.push(1);
      for (const [position, chunk] of prepared.chunks.entries()) {
        statements.push(database.prepare(`INSERT INTO ai_final_audit_chunks
          (audit_result_id,position,byte_length,chunk_sha256,body,verified) VALUES (?,?,?,?,?,1)`)
          .bind(command.result.resultId, position, chunk.byteLength, prepared.chunkHashes[position], arrayBuffer(chunk)));
        changes.push(1);
      }
      statements.push(database.prepare(`UPDATE ai_final_audit_results SET state='sealed' WHERE id=? AND state='assembling'`)
        .bind(command.result.resultId));
      changes.push(1);
    }
    statements.push(
      database.prepare(`UPDATE ai_provider_calls SET state='completed',completed_at=? WHERE id=? AND generation_job_id=?
        AND step_key=? AND attempt_number=? AND state='effect_started'`)
        .bind(command.completedAt, command.callId, command.jobId, command.stepKey, command.expectedAttempt),
      database.prepare(`INSERT INTO ai_usage_events (id,provider_call_id,generation_job_id,step_key,attempt_number,
        quiz_set_id,sermon_id,task,provider,model,input_tokens,cached_input_tokens,reasoning_tokens,output_tokens,
        audio_input_tokens,audio_seconds,pricing_version,estimated_cost_micro_usd,usage_source,observed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(command.usage.id, command.callId, command.jobId, command.stepKey, command.expectedAttempt,
          context.quiz_set_id, context.sermon_id, command.task, provider, model, command.usage.inputTokens,
          command.usage.cachedInputTokens, command.usage.reasoningTokens, command.usage.outputTokens,
          command.usage.audioInputTokens, command.usage.audioSeconds, command.usage.pricingVersion,
          command.usage.estimatedCostMicroUsd, command.usage.usageSource, command.usage.observedAt),
      database.prepare(`INSERT INTO generation_step_result_links (generation_job_id,step_key,task,correction_sermon_id,
        correction_event_id,content_sermon_id,content_event_id,final_audit_result_id,usage_event_id,result_kind,
        result_id,result_version,result_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(command.jobId, command.stepKey, command.task,
          command.result.type === "correction" ? context.sermon_id : null,
          command.result.type === "correction" ? resultId : null,
          command.result.type === "content" ? context.sermon_id : null,
          command.result.type === "content" ? resultId : null,
          command.result.type === "final_audit" ? resultId : null,
          command.usage.id, reference.kind, reference.id, reference.version, reference.fingerprint),
      database.prepare(`UPDATE generation_step_receipts SET state='succeeded',claim_token=NULL,lease_expires_at=NULL,
        result_kind=?,result_id=?,result_version=?,result_fingerprint=?,error_code=NULL,error_message_safe=NULL,
        error_fingerprint=NULL,updated_at=?,completed_at=? WHERE generation_job_id=? AND step_key=?
        AND state='effect_started' AND attempt_count=? AND input_fingerprint=?`)
        .bind(reference.kind, reference.id, reference.version, reference.fingerprint, command.completedAt,
          command.completedAt, command.jobId, command.stepKey, command.expectedAttempt, command.inputFingerprint),
    );
    changes.push(1, 1, 1, 1);
    const nextState = context.state_version + 1;
    const nextEvent = context.event_count + 1;
    statements.push(
      database.prepare(`UPDATE generation_jobs SET current_step=?,state_version=?,event_count=?,required_event_no=?,
        required_event_state_version=?,updated_at=? WHERE id=? AND status='running' AND state_version=? AND event_count=?`)
        .bind(command.nextStep, nextState, nextEvent, nextEvent, nextState, command.completedAt,
          command.jobId, context.state_version, context.event_count),
      database.prepare(`INSERT INTO generation_job_events (generation_job_id,event_no,job_state_version,attempt_number,
        step_key,level,event_code,message_safe,metadata_json_safe,elapsed_ms,created_at)
        VALUES (?,?,?,?,?,'info','step_succeeded','step_succeeded',?,NULL,?)`)
        .bind(command.jobId, nextEvent, nextState, command.expectedAttempt, command.stepKey,
          JSON.stringify({ jobId: command.jobId, eventCode: "step_succeeded", stepKey: command.stepKey,
            attempt: command.expectedAttempt }), command.completedAt),
    );
    changes.push(1, 1);
    try {
      const results = await database.batch(statements);
      if (exactBatch(results, changes)) return { outcome: "succeeded", result: reference };
    } catch { /* Exact own whole-bundle probe below. */ }
    const probe = await probeSucceeded(command.jobId, command.stepKey, {
      callId: command.callId, usageId: command.usage.id, result: reference,
    });
    if (probe === "exact") return { outcome: "replayed", result: reference };
    return fail("GENERATION_AI_STEP_UNCERTAIN");
  }

  async function commitRejectedWithUsage(raw: CommitAiGenerationFailureCommand): Promise<"failed" | "replayed"> {
    const parsed = failureSchema.safeParse(raw);
    if (!parsed.success) return fail("GENERATION_AI_INVALID");
    const command = parsed.data;
    const context = await receiptContext(database, command.jobId, command.stepKey);
    if (!context || context.task !== command.task || context.input_fingerprint !== command.inputFingerprint ||
      context.attempt_count !== command.expectedAttempt) return fail("GENERATION_AI_STATE_CONFLICT");
    const existing = await rows(database, `SELECT u.id,c.id AS call_id,c.state AS call_state,r.state AS receipt_state,
      j.status AS job_status FROM ai_usage_events u JOIN ai_provider_calls c ON c.id=u.provider_call_id
      JOIN generation_step_receipts r ON r.generation_job_id=u.generation_job_id AND r.step_key=u.step_key
      JOIN generation_jobs j ON j.id=r.generation_job_id WHERE u.generation_job_id=? AND u.step_key=?`,
    [command.jobId, command.stepKey]);
    if (existing.length === 1 && existing[0]?.id === command.usage.id && existing[0]?.call_id === command.callId &&
      existing[0]?.call_state === "completed" && existing[0]?.receipt_state === "terminal_failed" &&
      existing[0]?.job_status === "failed") return "replayed";
    if (context.state !== "effect_started" || context.job_status !== "running") return fail("GENERATION_AI_STEP_UNCERTAIN");
    const callRows = await rows(database, "SELECT provider,model,state FROM ai_provider_calls WHERE id=?", [command.callId]);
    if (callRows.length !== 1 || callRows[0]?.state !== "effect_started" ||
      typeof callRows[0]?.provider !== "string" || typeof callRows[0]?.model !== "string") {
      return fail("GENERATION_AI_STEP_UNCERTAIN");
    }
    const code = "GENERATION_DOMAIN_REJECTED";
    const errorFingerprint = await sha256Bytes(new TextEncoder().encode(code));
    const nextState = context.state_version + 1;
    const nextEvent = context.event_count + 1;
    const statements = [
      database.prepare("UPDATE ai_provider_calls SET state='completed',completed_at=? WHERE id=? AND state='effect_started'")
        .bind(command.completedAt, command.callId),
      database.prepare(`INSERT INTO ai_usage_events (id,provider_call_id,generation_job_id,step_key,attempt_number,
        quiz_set_id,sermon_id,task,provider,model,input_tokens,cached_input_tokens,reasoning_tokens,output_tokens,
        audio_input_tokens,audio_seconds,pricing_version,estimated_cost_micro_usd,usage_source,observed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(command.usage.id, command.callId, command.jobId, command.stepKey, command.expectedAttempt,
          context.quiz_set_id, context.sermon_id, command.task, callRows[0].provider, callRows[0].model,
          command.usage.inputTokens, command.usage.cachedInputTokens, command.usage.reasoningTokens,
          command.usage.outputTokens, command.usage.audioInputTokens, command.usage.audioSeconds,
          command.usage.pricingVersion, command.usage.estimatedCostMicroUsd, command.usage.usageSource,
          command.usage.observedAt),
      database.prepare(`UPDATE generation_step_receipts SET state='terminal_failed',claim_token=NULL,lease_expires_at=NULL,
        error_code=?,error_message_safe=?,error_fingerprint=?,updated_at=?,completed_at=?
        WHERE generation_job_id=? AND step_key=? AND state='effect_started' AND attempt_count=?`)
        .bind(code, code, errorFingerprint, command.completedAt, command.completedAt,
          command.jobId, command.stepKey, command.expectedAttempt),
      database.prepare(`UPDATE generation_jobs SET status='failed',current_step=?,state_version=?,event_count=?,
        error_code=?,error_message_safe=?,error_fingerprint=?,completed_at=?,required_event_no=?,
        required_event_state_version=?,updated_at=? WHERE id=? AND status='running' AND state_version=? AND event_count=?`)
        .bind(command.stepKey, nextState, nextEvent, code, code, errorFingerprint, command.completedAt,
          nextEvent, nextState, command.completedAt, command.jobId, context.state_version, context.event_count),
      database.prepare(`INSERT INTO generation_job_events (generation_job_id,event_no,job_state_version,attempt_number,
        step_key,level,event_code,message_safe,metadata_json_safe,elapsed_ms,created_at)
        VALUES (?,?,?,?,?,'error','job_failed','job_failed',?,NULL,?)`)
        .bind(command.jobId, nextEvent, nextState, command.expectedAttempt, command.stepKey,
          JSON.stringify({ jobId: command.jobId, eventCode: "job_failed", stepKey: command.stepKey,
            attempt: command.expectedAttempt }), command.completedAt),
    ];
    try {
      const results = await database.batch(statements);
      if (exactBatch(results, [1, 1, 1, 1, 1])) return "failed";
    } catch { /* Same safe failure identity is checked on the next call. */ }
    const recovered = await rows(database, `SELECT u.id,c.id AS call_id,c.state AS call_state,r.state AS receipt_state,
      j.status AS job_status FROM ai_usage_events u JOIN ai_provider_calls c ON c.id=u.provider_call_id
      JOIN generation_step_receipts r ON r.generation_job_id=u.generation_job_id AND r.step_key=u.step_key
      JOIN generation_jobs j ON j.id=r.generation_job_id WHERE u.generation_job_id=? AND u.step_key=?`,
    [command.jobId, command.stepKey]);
    if (recovered.length === 1 && recovered[0]?.id === command.usage.id && recovered[0]?.call_id === command.callId &&
      recovered[0]?.call_state === "completed" && recovered[0]?.receipt_state === "terminal_failed" &&
      recovered[0]?.job_status === "failed") return "replayed";
    return fail("GENERATION_AI_STEP_UNCERTAIN");
  }

  async function markUncertain(jobId: string, stepKey: string, expectedAttempt: number, now: string): Promise<"uncertain" | "replayed"> {
    if (!id.safeParse(jobId).success || !id.safeParse(stepKey).success || !Number.isSafeInteger(expectedAttempt) ||
      expectedAttempt < 1 || !timestamp.safeParse(now).success) return fail("GENERATION_AI_INVALID");
    const context = await receiptContext(database, jobId, stepKey);
    if (!context || context.attempt_count !== expectedAttempt) return fail("GENERATION_AI_STATE_CONFLICT");
    const callRows = await rows(database, `SELECT id,state FROM ai_provider_calls
      WHERE generation_job_id=? AND step_key=? AND attempt_number=?`, [jobId, stepKey, expectedAttempt]);
    if (context.state === "uncertain" && callRows.length === 1 && callRows[0]?.state === "uncertain") return "replayed";
    if (context.state !== "effect_started" || callRows.length !== 1 || callRows[0]?.state !== "effect_started") {
      return fail("GENERATION_AI_STEP_UNCERTAIN");
    }
    const code = "GENERATION_STEP_UNCERTAIN";
    const errorFingerprint = await sha256Bytes(new TextEncoder().encode(code));
    try {
      const results = await database.batch([
        database.prepare("UPDATE ai_provider_calls SET state='uncertain',completed_at=? WHERE id=? AND state='effect_started'")
          .bind(now, callRows[0]?.id),
        database.prepare(`UPDATE generation_step_receipts SET state='uncertain',claim_token=NULL,lease_expires_at=NULL,
          error_code=?,error_message_safe=?,error_fingerprint=?,updated_at=?
          WHERE generation_job_id=? AND step_key=? AND state='effect_started' AND attempt_count=?`)
          .bind(code, code, errorFingerprint, now, jobId, stepKey, expectedAttempt),
      ]);
      if (exactBatch(results, [1, 1])) return "uncertain";
    } catch { /* Exact uncertain pair is checked by the next call. */ }
    const recovered = await receiptContext(database, jobId, stepKey);
    const recoveredCall = await rows(database, `SELECT state FROM ai_provider_calls
      WHERE generation_job_id=? AND step_key=? AND attempt_number=?`, [jobId, stepKey, expectedAttempt]);
    if (recovered?.state === "uncertain" && recoveredCall.length === 1 && recoveredCall[0]?.state === "uncertain") {
      return "replayed";
    }
    return fail("GENERATION_AI_STEP_UNCERTAIN");
  }

  return { commitRejectedWithUsage, commitSuccess, markUncertain, probeSucceeded, startProviderCall };
}

export type GenerationAiResultStore = ReturnType<typeof createGenerationAiResultStore>;
