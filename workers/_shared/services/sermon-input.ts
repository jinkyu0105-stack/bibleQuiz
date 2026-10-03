import { string, int, strictObject, array, discriminatedUnion, literal, type z } from "zod";
import {
  ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_BYTES,
  ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_CHUNKS,
  ADMIN_SERMON_INPUT_HISTORY_LIMIT,
} from "../../../shared/api/admin-sermon-input";
import type {
  InputAppend,
  InputEvent,
  InputHeadMetadata,
  InputHistoryMetadata,
  SermonInputStore,
} from "../repositories/sermon-input-store";
import { correctionDecisionsSchema, correctionItemSchema } from "./transcript-correction-contract";
import { correctionDocumentProposalSchema } from "./transcript-correction-document";
import { mergeAcceptedCorrections, verifyCorrectionItems } from "./transcript-corrections";
import { transcriptContentSchema, transcriptHumanContextSchema, transcriptSourcePayloadSchema, type TranscriptContent, type TranscriptSourcePayload } from "./transcript-input-contract";
import { hash, originalContent, textOf, validText, verifyContent, verifySource } from "./transcript-content";
import { consumePreparedManualSource, manualTranscriptMaxBytes, type PrivateManualTranscriptSource } from "./manual-transcript-source";
import { prepareInputSchema } from "./prepare-input-schema";
import { withinTranscriptCharacterLimit } from "./transcript-character-limit";

const id = string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const sha = string().regex(/^[0-9a-f]{64}$/u);
const importVersionSchema = int().nonnegative();
const expected = { expectedVersion: int().positive(), sourceId: id, documentId: id, documentSha256: sha };
const proposalSchema = strictObject({ sourceId: id, sourceSha256: sha, baseDocumentId: id, baseDocumentSha256: sha,
  items: array(correctionItemSchema).min(1).max(1000) });
export const sermonInputCommandSchema = discriminatedUnion("action", [
  strictObject({ action: literal("import_source"), expectedVersion: importVersionSchema, payload: transcriptSourcePayloadSchema }),
  strictObject({ action: literal("edit"), ...expected, content: transcriptContentSchema }),
  strictObject({ action: literal("restore"), ...expected, restoreDocumentId: id }),
  strictObject({ action: literal("confirm"), ...expected, reviewed: literal(true) }),
  strictObject({ action: literal("propose_corrections"), ...expected, proposal: proposalSchema }),
  strictObject({ action: literal("decide_corrections"), ...expected, proposalId: id, decisions: correctionDecisionsSchema, reviewed: literal(true) }),
  strictObject({ action: literal("merge_corrections"), ...expected, proposalId: id }),
  strictObject({ action: literal("apply_correction_document"), ...expected, proposalId: id,
    reviewed: literal(true), content: transcriptContentSchema.optional() }),
]);
type Command = z.infer<typeof sermonInputCommandSchema>;
prepareInputSchema(sermonInputCommandSchema);
const errors = {
  INPUT_TOO_LARGE: "설교 자막은 공백·줄바꿈을 포함해 3만 자 이하로 입력해 주세요.",
  INPUT_INVALID: "저장할 자료와 요청 내용을 확인해 주세요.",
  INPUT_CONFLICT: "다른 저장이 먼저 처리됐습니다. 최신 내용을 확인해 주세요.",
  INPUT_READ_ONLY: "목사님이 제공한 설교 원고·요약본은 수정하지 않습니다.",
  INPUT_SAVE_UNCERTAIN: "저장 결과를 확인하지 못했습니다. 자동 재저장은 하지 않았습니다.",
} as const;
class InputError extends Error { constructor(readonly code: keyof typeof errors) { super(code); } }
function reject(): never { throw new InputError("INPUT_INVALID"); }
function sourceType(source: TranscriptSourcePayload): InputEvent["source_type"] {
  return source.sourceMode === "public_unofficial" ? "caption_timed" : source.manualSourceKind === "youtube_visible_transcript" ? "caption_plain" : source.manualSourceKind;
}
function verifySelectedContent(content: TranscriptContent, timedSource?: TranscriptSourcePayload) {
  if (!withinTranscriptCharacterLimit(content.format === "plain_text" ? content.text : content.segments)) throw new InputError("INPUT_TOO_LARGE");
  if (timedSource) { verifyContent(content, timedSource); return; }
  if (content.format !== "plain_text" || !validText(content.text) || new TextEncoder().encode(content.text).byteLength > manualTranscriptMaxBytes) reject();
}
function isDocumentRecord(record: Pick<InputEvent, "kind">): boolean {
  return ["source", "edit", "restore", "merge"].includes(record.kind);
}

function validateHistoryMetadata(
  head: InputHeadMetadata,
  records: InputHistoryMetadata[],
) {
  if (records.length < 1 || records.length > ADMIN_SERMON_INPUT_HISTORY_LIMIT) {
    throw new Error("Input history unavailable");
  }
  const byId = new Map<string, InputHistoryMetadata>();
  let previousVersion = 0;
  for (const record of records) {
    if (record.source_id !== head.source_id || record.source_type !== head.source_type ||
      record.version <= previousVersion || record.version > head.version || byId.has(record.id)) {
      throw new Error("Input history unavailable");
    }
    const parent = record.parent_document_id === null ? undefined : byId.get(record.parent_document_id);
    const related = record.related_id === null ? undefined : byId.get(record.related_id);
    if (record.kind === "source") {
      if (record.id !== head.source_id || record.document_id !== record.id ||
        record.parent_document_id !== null || record.related_id !== null) throw new Error("Input history unavailable");
    } else if (!parent || !isDocumentRecord(parent) || parent.document_id !== record.parent_document_id) {
      throw new Error("Input history unavailable");
    } else if (["edit", "restore", "merge"].includes(record.kind) && record.document_id !== record.id) {
      throw new Error("Input history unavailable");
    } else if (["confirm", "proposal", "decision"].includes(record.kind) && record.document_id !== record.parent_document_id) {
      throw new Error("Input history unavailable");
    }
    if (record.kind === "restore" && (!related || !isDocumentRecord(related))) throw new Error("Input history unavailable");
    if (["decision", "merge"].includes(record.kind) && related?.kind !== "proposal") throw new Error("Input history unavailable");
    if (["source", "edit", "confirm", "proposal"].includes(record.kind) && record.related_id !== null) throw new Error("Input history unavailable");
    byId.set(record.id, record);
    previousVersion = record.version;
  }
  const finalRecord = records.at(-1);
  const sourceRecord = byId.get(head.source_id);
  const selectedDocument = byId.get(head.document_id);
  const selectedConfirmation = head.confirmation_id === null ? undefined : byId.get(head.confirmation_id);
  if (!finalRecord || finalRecord.id !== head.id || finalRecord.version !== head.version ||
    sourceRecord?.kind !== "source" || !selectedDocument || !isDocumentRecord(selectedDocument) ||
    (head.confirmation_id !== null && (selectedConfirmation?.kind !== "confirm" || selectedConfirmation.document_id !== head.document_id))) {
    throw new Error("Input history unavailable");
  }
  return records.map((record) => ({
    eventId: record.id,
    version: record.version,
    kind: record.kind,
    documentId: record.document_id,
    parentDocumentId: record.parent_document_id,
    relatedId: record.related_id,
    createdAt: record.created_at,
  }));
}
export function inputExpectation(head: Pick<InputEvent, "version" | "source_id" | "document_id" | "document_sha256">) {
  return { expectedVersion: head.version, sourceId: head.source_id, documentId: head.document_id, documentSha256: head.document_sha256 };
}

/** Private command path. No HTTP, runtime, Workflow, public DTO or legacy migration. */
export function createSermonInputService(store: SermonInputStore) {
  async function source(sermonId: string, sourceId: string) {
    const record = await store.event(sermonId, sourceId);
    if (!record || record.kind !== "source" || record.source_id !== sourceId) return reject();
    const payload = transcriptSourcePayloadSchema.parse(await store.payload(record));
    // Persisted selected payload already has its exact-byte digest verified by store.
    return { record, payload };
  }
  async function contentOfDocument(record: InputEvent, raw?: TranscriptSourcePayload): Promise<TranscriptContent> {
    if (record.document_id === record.source_id && raw) return originalContent(raw);
    const payload = await store.payload(record);
    const content = record.kind === "source" ? originalContent(transcriptSourcePayloadSchema.parse(payload)) : transcriptContentSchema.parse(payload);
    if (await hash(textOf(content)) !== record.document_sha256) reject();
    return content;
  }
  async function document(sermonId: string, documentId: string, sourceId: string, raw?: TranscriptSourcePayload): Promise<TranscriptContent> {
    const record = await store.event(sermonId, documentId);
    if (!record || record.source_id !== sourceId || !isDocumentRecord(record)) return reject();
    return contentOfDocument(record, raw);
  }
  async function execute(sermonId: string, raw: unknown, context: unknown,
    preparedManual?: { source: PrivateManualTranscriptSource; expectedVersion: unknown }) {
    try {
      id.parse(sermonId);
      const human = transcriptHumanContextSchema.parse(context);
      // Only the private wrapper constructs this command and consumes an exact
      // frozen, fully validated source. Recheck the new version, not that source
      // shape again. The public execute boundary still parses unknown commands.
      const command: Command = preparedManual ? {
        action: "import_source", expectedVersion: importVersionSchema.parse(preparedManual.expectedVersion),
        payload: preparedManual.source,
      } : sermonInputCommandSchema.parse(raw);
      // Apply the product cap only to new captions, never to historical reads
      // or pastor-provided manuscripts/summaries. Includes prepared imports.
      if (command.action === "import_source") {
        const source = command.payload;
        const body = source.sourceMode === "public_unofficial" ? source.segments
          : source.manualSourceKind === "youtube_visible_transcript" ? source.rawTranscriptText : null;
        if (body !== null && !withinTranscriptCharacterLimit(body)) throw new InputError("INPUT_TOO_LARGE");
      }
      // A freshly prepared first import needs no previous document metadata.
      // The unchanged input_event_claim trigger atomically requires head=0;
      // a concurrent/stale loser rolls back and uses the existing own-attempt
      // check. Other commands and untrusted imports keep their preflight read.
      const atomicFirstImport = preparedManual !== undefined && command.action === "import_source" && command.expectedVersion === 0;
      const head = atomicFirstImport ? null : await store.head(sermonId);
      if ((head?.version ?? 0) !== command.expectedVersion || command.expectedVersion >= Number.MAX_SAFE_INTEGER) throw new InputError("INPUT_CONFLICT");
      if (command.action !== "import_source" && (!head || command.sourceId !== head.source_id || command.documentId !== head.document_id || command.documentSha256 !== head.document_sha256)) throw new InputError("INPUT_CONFLICT");
      const eventId = crypto.randomUUID();
      const next: InputAppend = { sermon_id: sermonId, version: command.expectedVersion + 1, id: eventId,
        kind: "source", source_type: "caption_plain", source_id: eventId, document_id: eventId, confirmation_id: null,
        parent_document_id: null, related_id: null, document_sha256: "0".repeat(64),
        actor_id: human.adminId, created_at: human.now };
      let payload: unknown;
      if (command.action === "import_source") {
        // Only importPreparedManual can supply a consumed capability for its
        // exact frozen payload. Unknown/serialized inputs still verify fully.
        if (!preparedManual) await verifySource(command.payload);
        payload = command.payload;
        next.source_type = sourceType(command.payload);
        next.document_sha256 = command.payload.sourceMode === "public_unofficial" ? await hash(textOf(originalContent(command.payload))) : command.payload.rawTranscriptSha256;
      } else {
        if (!head) return reject();
        Object.assign(next, { source_type: head.source_type, source_id: head.source_id, document_id: head.document_id,
          parent_document_id: head.document_id, confirmation_id: head.confirmation_id, document_sha256: head.document_sha256 });
        if (command.action === "confirm") {
          // Human review of the exact version/hash; no body copies or history reads.
          next.kind = "confirm"; next.confirmation_id = eventId; payload = { reviewed: true };
        } else {
          if (head.source_type !== "caption_plain" && head.source_type !== "caption_timed") throw new InputError("INPUT_READ_ONLY");
          // Plain captions need no old body to validate a newly submitted body.
          // Timed captions do need the source's segment identities/timings.
          const timedSource = head.source_type === "caption_timed" ? (await source(sermonId, head.source_id)).payload : undefined;
          if (command.action === "edit" || command.action === "restore") {
            const content = command.action === "edit" ? command.content : await document(sermonId, command.restoreDocumentId, head.source_id, timedSource);
            verifySelectedContent(content, timedSource);
            next.kind = command.action;
            next.related_id = command.action === "restore" ? command.restoreDocumentId : null;
            next.document_id = eventId; next.confirmation_id = null;
            next.document_sha256 = await hash(textOf(content)); payload = content;
          } else {
            payload = await correction(command, head, next, timedSource);
          }
        }
      }
      const outcome = await store.append(next, payload);
      if (outcome !== "saved") throw new InputError(outcome === "not_saved" ? "INPUT_CONFLICT" : "INPUT_SAVE_UNCERTAIN");
      return { outcome: "saved" as const, head: { ...next } };
    } catch (error) {
      const code = error instanceof InputError ? error.code : "INPUT_INVALID";
      return { outcome: "failed" as const, code, message: errors[code] };
    }
  }
  async function correction(command: Extract<Command, { action: "propose_corrections" | "decide_corrections" | "merge_corrections" | "apply_correction_document" }>, head: InputEvent, next: InputAppend, raw?: TranscriptSourcePayload) {
    const base = await document(head.sermon_id, head.document_id, head.source_id, raw);
    let proposal: z.infer<typeof proposalSchema> | z.infer<typeof correctionDocumentProposalSchema>;
    if (command.action === "propose_corrections") proposal = command.proposal;
    else {
      const record = await store.event(head.sermon_id, command.proposalId);
      if (!record || record.kind !== "proposal" || record.source_id !== head.source_id || record.document_id !== head.document_id) return reject();
      const stored = await store.payload(record);
      proposal = correctionDocumentProposalSchema.safeParse(stored).success
        ? correctionDocumentProposalSchema.parse(stored) : proposalSchema.parse(stored);
      next.related_id = record.id;
    }
    const rawHash = raw?.sourceMode === "public_unofficial" ? raw.sourceSha256 : (await store.event(head.sermon_id, head.source_id))?.document_sha256;
    if (proposal.sourceId !== head.source_id || proposal.sourceSha256 !== rawHash || proposal.baseDocumentId !== head.document_id || proposal.baseDocumentSha256 !== head.document_sha256) reject();
    if ("kind" in proposal) {
      if (command.action !== "apply_correction_document") reject();
      verifySelectedContent(proposal.content, raw);
      const content = command.content ?? proposal.content;
      verifySelectedContent(content, raw);
      if (content.format !== base.format) reject();
      next.kind = "merge"; next.document_id = next.id; next.confirmation_id = null;
      next.document_sha256 = await hash(textOf(content));
      return content;
    }
    if (command.action === "apply_correction_document") reject();
    verifyCorrectionItems(base, proposal.items, reject);
    if (command.action === "propose_corrections") { next.kind = "proposal"; return proposal; }
    const decided = new Map<string, "accepted" | "rejected">();
    const itemIds = new Set(proposal.items.map((item) => item.id));
    for (const previous of await store.decisions(head.sermon_id, command.proposalId)) {
      if (previous.record.source_id !== head.source_id || previous.record.document_id !== head.document_id || previous.record.version > head.version) reject();
      for (const item of correctionDecisionsSchema.parse(previous.payload)) {
        if (!itemIds.has(item.itemId) || decided.has(item.itemId)) reject();
        decided.set(item.itemId, item.decision);
      }
    }
    if (command.action === "decide_corrections") {
      for (const item of command.decisions) {
        if (!itemIds.has(item.itemId) || decided.has(item.itemId)) reject();
        decided.set(item.itemId, item.decision);
      }
      next.kind = "decision"; return command.decisions;
    }
    const accepted = new Set([...decided].filter(([, decision]) => decision === "accepted").map(([itemId]) => itemId));
    const content = mergeAcceptedCorrections(base, proposal.items, accepted, reject);
    verifySelectedContent(content, raw);
    next.kind = "merge"; next.document_id = next.id; next.confirmation_id = null;
    next.document_sha256 = await hash(textOf(content));
    return content;
  }
  return {
    async current(sermonId: string) {
      id.parse(sermonId);
      if (!await store.sermonExists(sermonId)) return { outcome: "not_found" as const };
      const head = await store.head(sermonId);
      if (head === null) return { outcome: "loaded" as const, input: null };
      const selectedSource = await source(sermonId, head.source_id);
      const content = await document(
        sermonId,
        head.document_id,
        head.source_id,
        selectedSource.payload,
      );
      if (await hash(textOf(content)) !== head.document_sha256) reject();
      const sourceSummary = selectedSource.payload.sourceMode === "public_unofficial"
        ? {
            sourceMode: selectedSource.payload.sourceMode,
            videoId: selectedSource.payload.videoId,
            language: selectedSource.payload.language,
            trackId: selectedSource.payload.trackId,
            generated: selectedSource.payload.generated,
            retrievedAt: selectedSource.payload.retrievedAt,
            providerId: selectedSource.payload.providerId,
            providerVersion: selectedSource.payload.providerVersion,
          }
        : {
            sourceMode: selectedSource.payload.sourceMode,
            manualSourceKind: selectedSource.payload.manualSourceKind,
            sourceCoverage: selectedSource.payload.sourceCoverage,
          };
      return {
        outcome: "loaded" as const,
        input: {
          version: head.version,
          sourceType: head.source_type,
          sourceId: head.source_id,
          documentId: head.document_id,
          documentSha256: head.document_sha256,
          confirmationId: head.confirmation_id,
          source: sourceSummary,
          content,
        },
      };
    },
    execute: (sermonId: string, raw: unknown, context: unknown) => execute(sermonId, raw, context),
    /** Backend-only preparation→import handoff, not a new HTTP/API route. */
    importPreparedManual(sermonId: string, expectedVersion: number, payload: unknown, context: unknown) {
      const prepared = consumePreparedManualSource(payload) ? { source: payload, expectedVersion } : undefined;
      return execute(sermonId, { action: "import_source", expectedVersion, payload }, context, prepared);
    },
    async history(sermonId: string) {
      id.parse(sermonId);
      if (!await store.sermonExists(sermonId)) return { outcome: "not_found" as const };
      const head = await store.metadataHead(sermonId);
      if (head === null) return { outcome: "loaded" as const, history: null };
      const events = validateHistoryMetadata(
        head,
        await store.historyMetadata(sermonId, head.source_id),
      );
      return {
        outcome: "loaded" as const,
        history: {
          head: {
            version: head.version,
            sourceType: head.source_type,
            sourceId: head.source_id,
            documentId: head.document_id,
            confirmationId: head.confirmation_id,
          },
          events,
        },
      };
    },
    /** On-demand inputs for comparison. Saving never invokes this function. */
    async comparison(sermonId: string, sourceId: string, leftId: string, rightId: string) {
      [sermonId, sourceId, leftId, rightId].forEach((value) => id.parse(value));
      if (!await store.sermonExists(sermonId)) return { outcome: "not_found" as const };
      const head = await store.metadataHead(sermonId);
      if (head === null || head.source_id !== sourceId) return { outcome: "selection_not_found" as const };
      const leftRecord = await store.event(sermonId, leftId);
      const rightRecord = await store.event(sermonId, rightId);
      if (!leftRecord || !rightRecord || leftRecord.source_id !== sourceId || rightRecord.source_id !== sourceId ||
        !isDocumentRecord(leftRecord) || !isDocumentRecord(rightRecord)) {
        return { outcome: "selection_not_found" as const };
      }
      return {
        outcome: "loaded" as const,
        comparison: {
          sourceId,
          left: { documentId: leftId, content: await contentOfDocument(leftRecord) },
          right: { documentId: rightId, content: await contentOfDocument(rightRecord) },
        },
      };
    },
    async correctionDetail(sermonId: string, proposalId: string) {
      [sermonId, proposalId].forEach((value) => id.parse(value));
      if (!await store.sermonExists(sermonId)) return { outcome: "not_found" as const };
      const head = await store.metadataHead(sermonId);
      const record = await store.event(sermonId, proposalId);
      if (head === null || !record || record.kind !== "proposal" || record.source_id !== head.source_id) {
        return { outcome: "selection_not_found" as const };
      }
      if (record.byte_length > ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_BYTES ||
        record.chunk_count > ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_CHUNKS) {
        throw new Error("Input correction unavailable");
      }
      const stored = await store.payload(record);
      const documentProposal = correctionDocumentProposalSchema.safeParse(stored);
      if (documentProposal.success) {
        const proposal = documentProposal.data;
        const selectedSource = await source(sermonId, record.source_id);
        const rawHash = selectedSource.payload.sourceMode === "public_unofficial"
          ? selectedSource.payload.sourceSha256 : selectedSource.record.document_sha256;
        if (proposal.sourceId !== record.source_id || proposal.baseDocumentId !== record.document_id ||
          proposal.baseDocumentSha256 !== record.document_sha256 || proposal.sourceSha256 !== rawHash) {
          throw new Error("Input correction unavailable");
        }
        verifySelectedContent(proposal.content, selectedSource.payload.sourceMode === "public_unofficial" ? selectedSource.payload : undefined);
        return { outcome: "loaded" as const, correction: { proposal: {
          kind: "correction_document_v1" as const, proposalId: record.id, version: record.version,
          sourceId: record.source_id, baseDocumentId: record.document_id,
          createdAt: record.created_at, content: proposal.content,
        } } };
      }
      const proposal = proposalSchema.parse(stored);
      if (proposal.sourceId !== record.source_id || proposal.baseDocumentId !== record.document_id ||
        proposal.baseDocumentSha256 !== record.document_sha256) {
        throw new Error("Input correction unavailable");
      }
      const validItemIds = new Set(proposal.items.map((item) => item.id));
      const decidedItemIds = new Set<string>();
      const decisions = [];
      for (const selected of await store.decisions(sermonId, proposalId)) {
        if (selected.record.source_id !== record.source_id || selected.record.document_id !== record.document_id ||
          selected.record.version <= record.version || selected.record.version > head.version) {
          throw new Error("Input correction unavailable");
        }
        const batch = correctionDecisionsSchema.parse(selected.payload);
        for (const decision of batch) {
          if (!validItemIds.has(decision.itemId) || decidedItemIds.has(decision.itemId)) {
            throw new Error("Input correction unavailable");
          }
          decidedItemIds.add(decision.itemId);
        }
        decisions.push({
          decisionId: selected.record.id,
          version: selected.record.version,
          createdAt: selected.record.created_at,
          decisions: batch,
        });
      }
      return {
        outcome: "loaded" as const,
        correction: {
          proposal: {
            proposalId: record.id,
            version: record.version,
            sourceId: record.source_id,
            baseDocumentId: record.document_id,
            createdAt: record.created_at,
            items: proposal.items,
          },
          decisions,
        },
      };
    },
  };
}
