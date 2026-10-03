import { z } from "zod";

export const adminSermonIdSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);

const privateIdSchema = adminSermonIdSchema;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const ADMIN_SERMON_INPUT_HISTORY_LIMIT = 512;
export const ADMIN_SERMON_INPUT_DECISION_BATCH_LIMIT = 256;
export const ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_BYTES = 4 * 1024 * 1024;
export const ADMIN_SERMON_INPUT_CORRECTION_DETAIL_MAX_CHUNKS = 256;

export const adminSermonInputImportRequestSchema = z.strictObject({
  // P5-28a exposes first-source registration only. Source replacement needs a
  // separately approved server command because D-030 did not settle that flow.
  expectedVersion: z.literal(0),
  sourceMode: z.enum(["manual_paste", "sermon_notes"]),
  manualSourceKind: z.enum([
    "youtube_visible_transcript",
    "sermon_manuscript",
    "sermon_summary",
  ]),
  sourceCoverage: z.enum(["full_transcript", "partial_notes"]),
  rawTranscriptText: z.string().max(1_048_576),
});

export const adminSermonInputContentSchema = z.discriminatedUnion("format", [
  z.strictObject({
    format: z.literal("plain_text"),
    text: z.string().max(1_048_576),
  }),
  z.strictObject({
    format: z.literal("timed_segments"),
    segments: z.array(z.strictObject({
      segmentId: privateIdSchema,
      text: z.string().min(1).max(20_000),
      start: z.number().finite().nonnegative(),
      duration: z.number().finite().nonnegative(),
    })).min(1).max(20_000),
  }),
]);

const adminSermonInputExpectationShape = {
  expectedVersion: z.number().int().positive(),
  sourceId: privateIdSchema,
  documentId: privateIdSchema,
  documentSha256: sha256Schema,
};

export const adminSermonInputCorrectionItemSchema = z.strictObject({
  id: privateIdSchema,
  segmentId: privateIdSchema.nullable(),
  start: z.number().finite().nonnegative().nullable(),
  duration: z.number().finite().nonnegative().nullable(),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  originalText: z.string().max(20_000),
  proposedText: z.string().max(20_000),
  changeType: z.enum([
    "recognition",
    "spacing",
    "spelling",
    "punctuation",
    "terminology",
    "repetition",
  ]),
  reason: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  riskFlags: z.array(z.enum([
    "biblical_term",
    "number",
    "negation",
    "deletion",
    "needs_review",
  ])).max(5),
  contextBefore: z.string().max(120),
  contextAfter: z.string().max(120),
});

const adminSermonInputProposalSchema = z.strictObject({
  sourceId: privateIdSchema,
  sourceSha256: sha256Schema,
  baseDocumentId: privateIdSchema,
  baseDocumentSha256: sha256Schema,
  items: z.array(adminSermonInputCorrectionItemSchema).min(1).max(1000),
});

export const adminSermonInputDecisionsSchema = z.array(z.strictObject({
  itemId: privateIdSchema,
  decision: z.enum(["accepted", "rejected"]),
})).min(1).max(1000);

export const adminSermonInputCommandRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("edit"),
    ...adminSermonInputExpectationShape,
    content: adminSermonInputContentSchema,
  }),
  z.strictObject({
    action: z.literal("restore"),
    ...adminSermonInputExpectationShape,
    restoreDocumentId: privateIdSchema,
  }),
  z.strictObject({
    action: z.literal("confirm"),
    ...adminSermonInputExpectationShape,
    reviewed: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("propose_corrections"),
    ...adminSermonInputExpectationShape,
    proposal: adminSermonInputProposalSchema,
  }),
  z.strictObject({
    action: z.literal("decide_corrections"),
    ...adminSermonInputExpectationShape,
    proposalId: privateIdSchema,
    decisions: adminSermonInputDecisionsSchema,
    reviewed: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("merge_corrections"),
    ...adminSermonInputExpectationShape,
    proposalId: privateIdSchema,
  }),
  z.strictObject({
    action: z.literal("apply_correction_document"),
    ...adminSermonInputExpectationShape,
    proposalId: privateIdSchema,
    reviewed: z.literal(true),
    content: adminSermonInputContentSchema.optional(),
  }),
]);

const adminSermonInputSourceSchema = z.discriminatedUnion("sourceMode", [
  z.strictObject({
    sourceMode: z.enum(["manual_paste", "sermon_notes"]),
    manualSourceKind: z.enum([
      "youtube_visible_transcript",
      "sermon_manuscript",
      "sermon_summary",
    ]),
    sourceCoverage: z.enum(["full_transcript", "partial_notes"]),
  }),
  z.strictObject({
    sourceMode: z.literal("public_unofficial"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/u),
    language: z.enum(["ko", "ko-KR"]),
    trackId: z.string().regex(/^[.A-Za-z0-9_-]{1,128}$/u),
    generated: z.boolean(),
    retrievedAt: z.iso.datetime(),
    providerId: z.literal("accountless-youtube-spike"),
    providerVersion: z.literal("0.1.0"),
  }),
]);

export const adminSermonInputCurrentSchema = z.strictObject({
  version: z.number().int().positive(),
  sourceType: z.enum([
    "caption_plain",
    "caption_timed",
    "sermon_manuscript",
    "sermon_summary",
  ]),
  sourceId: privateIdSchema,
  documentId: privateIdSchema,
  documentSha256: sha256Schema,
  confirmationId: privateIdSchema.nullable(),
  source: adminSermonInputSourceSchema,
  content: adminSermonInputContentSchema,
});

export const adminSermonInputDataSchema = z.strictObject({
  input: adminSermonInputCurrentSchema.nullable(),
});

export const adminSermonInputMutationHeadSchema = z.strictObject({
  eventId: privateIdSchema,
  version: z.number().int().positive(),
  sourceType: z.enum([
    "caption_plain",
    "caption_timed",
    "sermon_manuscript",
    "sermon_summary",
  ]),
  sourceId: privateIdSchema,
  documentId: privateIdSchema,
  documentSha256: sha256Schema,
  confirmationId: privateIdSchema.nullable(),
});

export const adminSermonInputMutationDataSchema = z.strictObject({
  head: adminSermonInputMutationHeadSchema,
});

export const adminSermonInputSuccessSchema = z.strictObject({
  data: adminSermonInputDataSchema,
});

export const adminSermonInputMutationSuccessSchema = z.strictObject({
  data: adminSermonInputMutationDataSchema,
});

const adminSermonInputEventKindSchema = z.enum([
  "source",
  "edit",
  "restore",
  "confirm",
  "proposal",
  "decision",
  "merge",
]);

export const adminSermonInputHistoryEventSchema = z.strictObject({
  eventId: privateIdSchema,
  version: z.number().int().positive(),
  kind: adminSermonInputEventKindSchema,
  documentId: privateIdSchema,
  parentDocumentId: privateIdSchema.nullable(),
  relatedId: privateIdSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export const adminSermonInputHistorySchema = z.strictObject({
  head: z.strictObject({
    version: z.number().int().positive(),
    sourceType: z.enum([
      "caption_plain",
      "caption_timed",
      "sermon_manuscript",
      "sermon_summary",
    ]),
    sourceId: privateIdSchema,
    documentId: privateIdSchema,
    confirmationId: privateIdSchema.nullable(),
  }),
  events: z.array(adminSermonInputHistoryEventSchema)
    .min(1)
    .max(ADMIN_SERMON_INPUT_HISTORY_LIMIT),
});

export const adminSermonInputHistoryDataSchema = z.strictObject({
  history: adminSermonInputHistorySchema.nullable(),
});

export const adminSermonInputHistorySuccessSchema = z.strictObject({
  data: adminSermonInputHistoryDataSchema,
});

export const adminSermonInputComparisonQuerySchema = z.strictObject({
  sourceId: privateIdSchema,
  leftDocumentId: privateIdSchema,
  rightDocumentId: privateIdSchema,
});

const adminSermonInputSelectedDocumentSchema = z.strictObject({
  documentId: privateIdSchema,
  content: adminSermonInputContentSchema,
});

export const adminSermonInputComparisonDataSchema = z.strictObject({
  comparison: z.strictObject({
    sourceId: privateIdSchema,
    left: adminSermonInputSelectedDocumentSchema,
    right: adminSermonInputSelectedDocumentSchema,
  }),
});

export const adminSermonInputComparisonSuccessSchema = z.strictObject({
  data: adminSermonInputComparisonDataSchema,
});

const legacyCorrectionDetailSchema = z.strictObject({
  proposal: z.strictObject({
    proposalId: privateIdSchema,
    version: z.number().int().positive(),
    sourceId: privateIdSchema,
    baseDocumentId: privateIdSchema,
    createdAt: z.iso.datetime(),
    items: z.array(adminSermonInputCorrectionItemSchema).min(1).max(1000),
  }),
  decisions: z.array(z.strictObject({
    decisionId: privateIdSchema,
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    decisions: adminSermonInputDecisionsSchema,
  })).max(ADMIN_SERMON_INPUT_DECISION_BATCH_LIMIT),
});

const documentCorrectionDetailSchema = z.strictObject({
  proposal: z.strictObject({
    kind: z.literal("correction_document_v1"),
    proposalId: privateIdSchema,
    version: z.number().int().positive(),
    sourceId: privateIdSchema,
    baseDocumentId: privateIdSchema,
    createdAt: z.iso.datetime(),
    content: adminSermonInputContentSchema,
  }),
});

export const adminSermonInputCorrectionDetailSchema = z.union([
  documentCorrectionDetailSchema, legacyCorrectionDetailSchema,
]);

export const adminSermonInputCorrectionDataSchema = z.strictObject({
  correction: adminSermonInputCorrectionDetailSchema,
});

export const adminSermonInputCorrectionSuccessSchema = z.strictObject({
  data: adminSermonInputCorrectionDataSchema,
});

export type AdminSermonInputImportRequest = z.infer<typeof adminSermonInputImportRequestSchema>;
export type AdminSermonInputCommandRequest = z.infer<typeof adminSermonInputCommandRequestSchema>;
export type AdminSermonInputCurrent = z.infer<typeof adminSermonInputCurrentSchema>;
export type AdminSermonInputData = z.infer<typeof adminSermonInputDataSchema>;
export type AdminSermonInputMutationData = z.infer<typeof adminSermonInputMutationDataSchema>;
export type AdminSermonInputHistory = z.infer<typeof adminSermonInputHistorySchema>;
export type AdminSermonInputHistoryEvent = z.infer<typeof adminSermonInputHistoryEventSchema>;
export type AdminSermonInputComparisonData = z.infer<typeof adminSermonInputComparisonDataSchema>;
export type AdminSermonInputCorrectionDetail = z.infer<typeof adminSermonInputCorrectionDetailSchema>;
