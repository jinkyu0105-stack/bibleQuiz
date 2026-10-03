import { z } from "zod";

import { transcriptSourcePayloadSchema, transcriptContentSchema, transcriptHumanContextSchema } from "./transcript-input-contract";
export { transcriptSourcePayloadSchema, transcriptContentSchema, transcriptHumanContextSchema } from "./transcript-input-contract";
import { intentEventSchema, intentOperationSchema } from "./sermon-intent-contract";
import { candidateEventSchema, candidateOperationSchema } from "./sermon-candidates-contract";
import { summaryEventSchema, summaryOperationSchema } from "./sermon-summary-contract";
import {
  correctionDecisionRecordSchema, correctionDecisionsSchema, correctionProposalInputSchema,
  correctionProposalSchema, mergedCorrectionSchema,
} from "./transcript-correction-contract";

// Private Worker contracts. Neither state nor successful results are public DTOs.
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const version = z.int().nonnegative();
const sourceSchema = z.strictObject({
  id, sourceRevision: z.int().positive(), payload: transcriptSourcePayloadSchema,
});
const revisionSchema = z.strictObject({
  id, sourceId: id, parentRevisionId: id.nullable(),
  kind: z.enum(["imported", "manual_edit", "restored", "merged"]),
  restoredFromRevisionId: id.nullable(),
  mergedCorrection: mergedCorrectionSchema.nullable().default(null),
  content: transcriptContentSchema,
  // Separate from the source hash: exact UTF-8 of plain text, or segment text joined with LF.
  checksumFormat: z.literal("sha256:utf8-working-text:v1"),
  transcriptSha256: sha256,
  createdBy: id, createdAt: z.iso.datetime(),
});
const confirmationSchema = z.strictObject({
  id, sourceId: id, revisionId: id, transcriptSha256: sha256,
  confirmedBy: id, confirmedAt: z.iso.datetime(),
});
export const privateTranscriptStateSchema = z.strictObject({
  contractVersion: z.literal(1), sermonId: id, version: z.int().positive(),
  sources: z.array(sourceSchema).min(1), revisions: z.array(revisionSchema).min(1),
  confirmations: z.array(confirmationSchema),
  correctionProposals: z.array(correctionProposalSchema).default([]),
  correctionDecisions: z.array(correctionDecisionRecordSchema).default([]),
  intentEvents: z.array(intentEventSchema).default([]),
  summaryEvents: z.array(summaryEventSchema).default([]),
  candidateEvents: z.array(candidateEventSchema).default([]),
  currentSourceId: id, currentRevisionId: id, currentConfirmationId: id.nullable(),
});
const expectedHead = {
  expectedVersion: version,
  sourceId: id, revisionId: id, transcriptSha256: sha256,
};
export const transcriptCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("import_source"), expectedVersion: version, payload: transcriptSourcePayloadSchema }),
  z.strictObject({ action: z.literal("edit"), ...expectedHead, content: transcriptContentSchema }),
  z.strictObject({ action: z.literal("restore"), ...expectedHead, restoreRevisionId: id }),
  z.strictObject({ action: z.literal("confirm"), ...expectedHead, reviewed: z.literal(true) }),
  z.strictObject({ action: z.literal("propose_corrections"), ...expectedHead, proposal: correctionProposalInputSchema }),
  z.strictObject({ action: z.literal("decide_corrections"), ...expectedHead, proposalId: id,
    decisions: correctionDecisionsSchema, reviewed: z.literal(true) }),
  z.strictObject({ action: z.literal("merge_corrections"), ...expectedHead, proposalId: id }),
  z.strictObject({ action: z.literal("intent"), ...expectedHead, operation: intentOperationSchema }),
  z.strictObject({ action: z.literal("candidates"), ...expectedHead, operation: candidateOperationSchema }),
  z.strictObject({ action: z.literal("summary"), ...expectedHead, operation: summaryOperationSchema }),
]);
export type TranscriptState = z.infer<typeof privateTranscriptStateSchema>;
export type TranscriptContent = z.infer<typeof transcriptContentSchema>;
export type TranscriptCommand = z.infer<typeof transcriptCommandSchema>;
export type TranscriptHumanContext = z.infer<typeof transcriptHumanContextSchema>;
export type TranscriptSourcePayload = z.infer<typeof transcriptSourcePayloadSchema>;
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type PrivateTranscriptState = DeepReadonly<TranscriptState>;

/** Trusted server port; no implementation or persistence is shipped in P5-07.
 * read returns authoritative state, never a client-supplied snapshot.
 * compareAndSwap MUST atomically compare the persisted version (null means absent)
 * and append source/revision/confirmation/proposal/decision records plus the new head
 * in one transaction. Decisions are immutable batches; their items transition only
 * from pending to accepted/rejected. Proposal registration and decisions also increment version.
 * Existing history is immutable. A conflict writes NOTHING and returns false.
 * P5-09 intent events participate in this SAME transaction/version as transcript
 * edits and confirmations. An independent intent write after a transcript read is unsafe.
 * P5-10 summary events share this same CAS, including input binding version checks.
 * P5-11 difficulty candidate events also share this CAS; no independent candidate writes.
 * Never implement as an ordinary read followed by an unconditional write.
 */
export interface TranscriptRevisionStore {
  read(sermonId: string): Promise<unknown | null>;
  compareAndSwap(sermonId: string, expectedVersion: number | null, next: PrivateTranscriptState): Promise<boolean>;
}

export const transcriptRevisionFailureMessages = {
  INVALID_TRANSCRIPT_REQUEST: "자막 수정 요청의 형식을 확인해 주세요.",
  HUMAN_REVIEW_REQUIRED: "인증된 관리자의 직접 검수와 확정이 필요합니다.",
  TRANSCRIPT_STATE_INVALID: "자막 수정 이력의 연결 상태를 확인해 주세요.",
  TRANSCRIPT_CHECKSUM_MISMATCH: "자막 내용과 checksum이 일치하지 않습니다.",
  TRANSCRIPT_CONTENT_INVALID: "자막이 비어 있거나 텍스트·시간 구간이 올바르지 않습니다.",
  TRANSCRIPT_REVISION_CONFLICT: "자막이 다른 요청에서 변경되었습니다. 최신 수정본을 다시 확인해 주세요.",
  TRANSCRIPT_NOT_CONFIRMED: "현재 수정본을 사람이 최종 확정해야 합니다.",
  TRANSCRIPT_CORRECTION_INVALID: "교정 제안의 바탕 수정본·구간·결정 내용을 확인해 주세요.",
  SERMON_INTENT_INVALID: "설교 의도 분석·비판·근거·확정 이력을 확인해 주세요.",
  SERMON_INTENT_NOT_CONFIRMED: "현재 자막에 연결된 설교 의도를 사람이 확정해야 합니다.",
  SERMON_SUMMARY_INVALID: "설교 요약·의도 연결·근거·검수 이력을 확인해 주세요.",
  SERMON_SUMMARY_NOT_REVIEWED: "현재 자막과 의도에 맞는 요약을 검수해 주세요.",
  SERMON_SUMMARY_DISCLOSURE_UNSUPPORTED: "이 자료 유형과 범위의 공개 요약 고지 정책을 먼저 확인해 주세요.",
  SERMON_CANDIDATES_INVALID: "문제 후보의 정답·단서·난이도·근거·검수 이력을 확인해 주세요.",
  SERMON_CANDIDATES_NOT_REVIEWED: "현재 자막과 의도에 맞는 문제 후보를 검수해 주세요.",
  TRANSCRIPT_VALIDATION_FAILED: "자막 검증을 완료하지 못했습니다.",
} as const;
export type TranscriptRevisionFailureCode = keyof typeof transcriptRevisionFailureMessages;
export type TranscriptRevisionFailure = {
  outcome: "failed"; code: TranscriptRevisionFailureCode; message: string;
};
