import { sql } from "drizzle-orm";
import {
  check,
  blob,
  foreignKey,
  type SQLiteTableExtraConfigValue,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export interface BibleReference {
  book: string;
  chapter: number;
  verseEnd: number;
  verseStart: number;
}

export interface TranscriptSegment {
  endMs: number;
  startMs: number;
  text: string;
}

export interface PublicGridCell {
  acrossNumber?: number;
  column: number;
  downNumber?: number;
  isBlocked: boolean;
  row: number;
}

export interface PublicGrid {
  cells: PublicGridCell[];
  size: number;
}

export interface ValidationReport {
  errors: string[];
  generatedAt: string;
  warnings: string[];
}

export interface PublishedAiProvenance {
  model: string;
  purpose: string;
  responseId?: string;
}

export type SolutionCells = Record<string, string>;
export type EntryAnswers = Record<string, string>;
export type SubmissionAnswers = Record<string, string>;
export type AuditSafeMetadata = Record<string, boolean | number | string | null>;

export const bibleTranslations = sqliteTable(
  "bible_translations",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    edition: text("edition").notNull(),
    publicationYear: integer("publication_year"),
    publisherOrRightsholder: text("publisher_or_rightsholder").notNull(),
    mode: text("mode", {
      enum: ["reference_only", "licensed_api", "licensed_local"],
    })
      .notNull()
      .default("reference_only"),
    sourceUrl: text("source_url"),
    licenseUrl: text("license_url"),
    permissionEvidencePath: text("permission_evidence_path"),
    allowedWeb: integer("allowed_web", { mode: "boolean" })
      .notNull()
      .default(false),
    allowedArchive: integer("allowed_archive", { mode: "boolean" })
      .notNull()
      .default(false),
    allowedPng: integer("allowed_png", { mode: "boolean" })
      .notNull()
      .default(false),
    allowedPdf: integer("allowed_pdf", { mode: "boolean" })
      .notNull()
      .default(false),
    requiredAttribution: text("required_attribution"),
    permissionTerritory: text("permission_territory"),
    permissionStartsAt: text("permission_starts_at"),
    permissionExpiresAt: text("permission_expires_at"),
    feeAmount: integer("fee_amount"),
    feeCurrency: text("fee_currency"),
    renewalReminderDays: integer("renewal_reminder_days"),
    cachePolicy: text("cache_policy"),
    deletionPolicy: text("deletion_policy"),
    sourceSha256: text("source_sha256"),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    approvedBy: text("approved_by"),
    approvedAt: text("approved_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "bible_translations_mode_check",
      sql`${table.mode} in ('reference_only', 'licensed_api', 'licensed_local')`,
    ),
    check(
      "bible_translations_status_check",
      sql`${table.status} in ('pending', 'approved', 'rejected')`,
    ),
    check(
      "bible_translations_permission_window_check",
      sql`${table.permissionExpiresAt} is null or ${table.permissionStartsAt} is null or ${table.permissionExpiresAt} > ${table.permissionStartsAt}`,
    ),
    check(
      "bible_translations_fee_amount_check",
      sql`${table.feeAmount} is null or ${table.feeAmount} >= 0`,
    ),
    check(
      "bible_translations_renewal_days_check",
      sql`${table.renewalReminderDays} is null or ${table.renewalReminderDays} >= 0`,
    ),
  ],
);

export const sermons = sqliteTable(
  "sermons",
  {
    id: text("id").primaryKey(),
    slug: text("slug").unique(),
    slugSuffix: text("slug_suffix").notNull().unique(),
    churchName: text("church_name").notNull(),
    youtubeUrl: text("youtube_url").notNull(),
    youtubeVideoId: text("youtube_video_id").notNull().unique(),
    sermonTitle: text("sermon_title").notNull(),
    sermonDate: text("sermon_date").notNull(),
    bibleTranslationId: text("bible_translation_id")
      .notNull()
      .references(() => bibleTranslations.id, { onDelete: "restrict" }),
    bibleReferenceJson: text("bible_reference_json", { mode: "json" })
      .$type<BibleReference[]>()
      .notNull(),
    bibleReferenceLabel: text("bible_reference_label").notNull(),
    bibleTextSnapshot: text("bible_text_snapshot"),
    bibleSourceSha256: text("bible_source_sha256"),
    aiSummary: text("ai_summary"),
    aiSummaryDisclosure: text("ai_summary_disclosure"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("sermons_sermon_date_id_idx").on(
      sql`${table.sermonDate} desc`,
      sql`${table.id} desc`,
    ),
  ],
);

export const sermonTranscripts = sqliteTable(
  "sermon_transcripts",
  {
    id: text("id").primaryKey(),
    sermonId: text("sermon_id")
      .notNull()
      .references(() => sermons.id, { onDelete: "cascade" }),
    sourceRevision: integer("source_revision").notNull(),
    language: text("language").notNull(),
    trackId: text("track_id"),
    provider: text("provider"),
    providerVersion: text("provider_version"),
    sourceMode: text("source_mode", {
      enum: [
        "public_unofficial",
        "manual_paste",
        "manual_upload",
        "sermon_notes",
        "audio_transcription",
        "youtube_oauth",
      ],
    }).notNull(),
    manualSourceKind: text("manual_source_kind", {
      enum: [
        "youtube_visible_transcript",
        "sermon_manuscript",
        "sermon_summary",
      ],
    }),
    sourceCoverage: text("source_coverage", {
      enum: ["full_transcript", "partial_notes"],
    }).notNull(),
    isAutoGenerated: integer("is_auto_generated", { mode: "boolean" })
      .notNull()
      .default(false),
    rawText: text("raw_text").notNull(),
    rawSha256: text("raw_sha256").notNull(),
    rawSegmentsJson: text("raw_segments_json", { mode: "json" }).$type<
      TranscriptSegment[]
    >(),
    confirmedText: text("confirmed_text"),
    confirmedSha256: text("confirmed_sha256"),
    status: text("status", {
      enum: ["imported", "editing", "correction_pending", "confirmed"],
    })
      .notNull()
      .default("imported"),
    // transcript_revisions is introduced with the correction workflow. Until
    // then this keeps the selected revision ID without a premature FK.
    confirmedRevisionId: text("confirmed_revision_id"),
    confirmedBy: text("confirmed_by"),
    confirmedAt: text("confirmed_at"),
    retentionMode: text("retention_mode", {
      enum: ["keep_private", "delete_text_after_publish"],
    })
      .notNull()
      .default("keep_private"),
    fetchedAt: text("fetched_at").notNull(),
  },
  (table) => [
    uniqueIndex("sermon_transcripts_sermon_revision_uidx").on(
      table.sermonId,
      table.sourceRevision,
    ),
    check(
      "sermon_transcripts_source_revision_check",
      sql`${table.sourceRevision} >= 1`,
    ),
    check(
      "sermon_transcripts_source_mode_check",
      sql`${table.sourceMode} in ('public_unofficial', 'manual_paste', 'manual_upload', 'sermon_notes', 'audio_transcription', 'youtube_oauth')`,
    ),
    check(
      "sermon_transcripts_manual_source_kind_check",
      sql`${table.manualSourceKind} is null or ${table.manualSourceKind} in ('youtube_visible_transcript', 'sermon_manuscript', 'sermon_summary')`,
    ),
    check(
      "sermon_transcripts_source_coverage_check",
      sql`${table.sourceCoverage} in ('full_transcript', 'partial_notes')`,
    ),
    check(
      "sermon_transcripts_status_check",
      sql`${table.status} in ('imported', 'editing', 'correction_pending', 'confirmed')`,
    ),
    check(
      "sermon_transcripts_retention_mode_check",
      sql`${table.retentionMode} in ('keep_private', 'delete_text_after_publish')`,
    ),
    check(
      "sermon_transcripts_confirmed_fields_check",
      sql`${table.status} <> 'confirmed' or (${table.confirmedText} is not null and ${table.confirmedSha256} is not null and ${table.confirmedAt} is not null)`,
    ),
  ],
);

export const quizSets = sqliteTable(
  "quiz_sets",
  {
    id: text("id").primaryKey(),
    sermonId: text("sermon_id")
      .notNull()
      .unique()
      .references(() => sermons.id, { onDelete: "cascade" }),
    confirmedTranscriptId: text("confirmed_transcript_id").references(
      () => sermonTranscripts.id,
      { onDelete: "set null" },
    ),
    confirmedTranscriptSha256: text("confirmed_transcript_sha256"),
    status: text("status", {
      enum: ["draft", "review_ready", "needs_revision", "published", "archived"],
    })
      .notNull()
      .default("draft"),
    submissionState: text("submission_state", { enum: ["open", "paused"] })
      .notNull()
      .default("open"),
    submissionPausedAt: text("submission_paused_at"),
    submissionPausedBy: text("submission_paused_by"),
    submissionPauseReason: text("submission_pause_reason"),
    publishedFromRevisionNumber: integer("published_from_revision_number"),
    publishedAiProvenanceJson: text("published_ai_provenance_json", {
      mode: "json",
    }).$type<PublishedAiProvenance[]>(),
    publishedAt: text("published_at"),
    opensAt: text("opens_at"),
    closesAt: text("closes_at"),
    archivedAt: text("archived_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("quiz_sets_state_closes_at_idx").on(
      table.status,
      table.submissionState,
      table.closesAt,
    ),
    index("quiz_sets_archive_idx").on(
      table.status,
      sql`${table.id} desc`,
    ),
    check(
      "quiz_sets_publish_window_check",
      sql`${table.status} not in ('published', 'archived') or (${table.opensAt} is not null and ${table.closesAt} is not null and ${table.closesAt} > ${table.opensAt})`,
    ),
    check(
      "quiz_sets_status_check",
      sql`${table.status} in ('draft', 'review_ready', 'needs_revision', 'published', 'archived')`,
    ),
    check(
      "quiz_sets_submission_state_check",
      sql`${table.submissionState} in ('open', 'paused')`,
    ),
    check(
      "quiz_sets_pause_metadata_check",
      sql`${table.submissionState} <> 'paused' or ${table.submissionPausedAt} is not null`,
    ),
  ],
);

/** Permanent public content and private provenance. It has no reference to draft history. */
// Permanent display corrections are independent of drafts and the immutable publication.
export const publishedDisplayCorrections = sqliteTable("published_display_corrections", {
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  requestKey: text("request_key").notNull(),
  beforeTitle: text("before_title").notNull(),
  beforeSermonDate: text("before_sermon_date").notNull(),
  title: text("title").notNull(),
  sermonDate: text("sermon_date").notNull(),
  reason: text("reason").notNull(),
  actorDigest: text("actor_digest").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [
  primaryKey({ columns: [table.quizSetId, table.revision] }),
  uniqueIndex("published_display_request_uidx").on(table.quizSetId, table.requestKey),
  check("published_display_revision_check", sql`typeof(${table.revision})='integer' and ${table.revision} between 1 and 9007199254740991`),
  check("published_display_title_check", sql`length(trim(${table.title})) between 1 and 300 and length(trim(${table.beforeTitle})) between 1 and 300`),
  check("published_display_reason_check", sql`length(trim(${table.reason})) between 2 and 500`),
  check("published_display_actor_check", sql`length(${table.actorDigest})=64 and ${table.actorDigest} not glob '*[^0-9a-f]*'`),
]);

export const publishedQuizContent = sqliteTable("published_quiz_content", {
  quizSetId: text("quiz_set_id").primaryKey().references(() => quizSets.id, { onDelete: "restrict" }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  sermonDate: text("sermon_date").notNull(),
  churchName: text("church_name").notNull(),
  bibleReferenceLabel: text("bible_reference_label").notNull(),
  translation: text("translation").notNull(),
  bibleReadingUrl: text("bible_reading_url").notNull(),
  summary: text("summary").notNull(),
  disclosure: text("disclosure").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  inputVersion: integer("input_version").notNull(),
  contentEventCount: integer("content_event_count").notNull(),
  metadataRevision: integer("metadata_revision").notNull(),
  selectionRevision: integer("selection_revision").notNull(),
  requestKey: text("request_key").notNull().unique(),
  ticketFingerprint: text("ticket_fingerprint").notNull(),
  generationJobId: text("generation_job_id").notNull(),
  provenanceJson: text("provenance_json").notNull(),
  publishedByDigest: text("published_by_digest").notNull(),
  publishedAt: text("published_at").notNull(),
}, (table) => [
  check("published_quiz_content_source_sha_check", sql`length(${table.sourceSha256}) = 64 and ${table.sourceSha256} not glob '*[^0-9a-f]*'`),
  check("published_quiz_content_ticket_sha_check", sql`length(${table.ticketFingerprint}) = 64 and ${table.ticketFingerprint} not glob '*[^0-9a-f]*'`),
  check("published_quiz_content_actor_check", sql`length(${table.publishedByDigest}) = 64 and ${table.publishedByDigest} not glob '*[^0-9a-f]*'`),
  check("published_quiz_content_provenance_check", sql`json_valid(${table.provenanceJson})`),
]);

// Immutable withdrawal evidence and a private editing revision copied from permanent content.
export const quizWithdrawals = sqliteTable("quiz_withdrawals", {
  quizSetId: text("quiz_set_id").primaryKey().references(() => quizSets.id, { onDelete: "restrict" }),
  requestKey: text("request_key").notNull().unique(),
  publishedAt: text("published_at").notNull(),
  displayRevision: integer("display_revision").notNull(),
  reviewRevision: integer("review_revision").notNull(),
  reviewJson: text("review_json").notNull(),
  reason: text("reason").notNull(),
  actorDigest: text("actor_digest").notNull(),
  withdrawnAt: text("withdrawn_at").notNull(),
}, table => [
  check("quiz_withdrawals_review_check", sql`json_valid(${table.reviewJson})`),
  check("quiz_withdrawals_revision_check", sql`${table.reviewRevision}>1 and ${table.displayRevision}>=0`),
  check("quiz_withdrawals_actor_check", sql`length(${table.actorDigest})=64 and ${table.actorDigest} not glob '*[^0-9a-f]*'`),
]);

/** Unpublished withdrawal edits; source publication and withdrawal rows stay immutable. */
export const withdrawalEditRevisions = sqliteTable("withdrawal_edit_revisions", {
  quizSetId: text("quiz_set_id").notNull().references(() => quizWithdrawals.quizSetId, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  reviewRevision: integer("review_revision").notNull(),
  requestKey: text("request_key").notNull(),
  requestSha256: text("request_sha256").notNull(),
  editsJson: text("edits_json").notNull(),
  actorDigest: text("actor_digest").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [
  primaryKey({ columns: [table.quizSetId, table.revision] }),
  uniqueIndex("withdrawal_edit_request_unique").on(table.quizSetId, table.requestKey),
  check("withdrawal_edit_revision_check", sql`typeof(${table.revision})='integer' and ${table.revision}>0 and ${table.reviewRevision}>1`),
  check("withdrawal_edit_json_check", sql`json_valid(${table.editsJson}) and json_type(${table.editsJson})='array'`),
  check("withdrawal_edit_hash_check", sql`length(${table.requestSha256})=64 and ${table.requestSha256} not glob '*[^0-9a-f]*' and length(${table.actorDigest})=64 and ${table.actorDigest} not glob '*[^0-9a-f]*'`),
]);

/** Expiry evidence for unpublished withdrawal edits; publication identities remain intact. */
export const withdrawalEditCleanup = sqliteTable("withdrawal_edit_cleanup", {
  quizSetId: text("quiz_set_id").primaryKey().references(() => quizWithdrawals.quizSetId, { onDelete: "restrict" }),
  headRevision: integer("head_revision").notNull(),
  lastSavedAt: text("last_saved_at").notNull(),
  dueAt: text("due_at").notNull(),
  purgedAt: text("purged_at").notNull(),
  payloadHashesJson: text("payload_hashes_json").notNull(),
}, table => [
  check("withdrawal_cleanup_revision", sql`${table.headRevision}>0`),
  check("withdrawal_cleanup_time", sql`${table.purgedAt}>=${table.dueAt}`),
  check("withdrawal_cleanup_hashes", sql`json_valid(${table.payloadHashesJson}) and json_type(${table.payloadHashesJson})='object'`),
]);

/** Permanent withdrawal sources; edits and reviews belong to an explicit editing cycle. */
export const quizRevisionSessions = sqliteTable("quiz_revision_sessions", {
  id: text("id").primaryKey(),
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "restrict" }),
  cycle: integer("cycle").notNull(),
  kind: text("kind", { enum: ["start", "withdraw"] }).notNull(),
  reviewRevision: integer("review_revision").notNull(),
  publishedAt: text("published_at").notNull(),
  displayRevision: integer("display_revision").notNull(),
  sourceJson: text("source_json").notNull(),
  requestSha256: text("request_sha256").notNull(),
  actorDigest: text("actor_digest").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
}, t => [uniqueIndex("quiz_revision_cycle_unique").on(t.quizSetId, t.cycle),
  check("quiz_revision_source_json", sql`json_valid(${t.sourceJson})`),
  check("quiz_revision_cycle_check", sql`${t.cycle}>0 and ${t.reviewRevision}>1 and ${t.displayRevision}>=0`)]);

export const quizRevisionDrafts = sqliteTable("quiz_revision_drafts", {
  sessionId: text("session_id").notNull().references(() => quizRevisionSessions.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  requestKey: text("request_key").notNull(),
  requestSha256: text("request_sha256").notNull(),
  actorDigest: text("actor_digest").notNull(),
  kind: text("kind", { enum: ["start", "save", "layout", "review"] }).notNull(),
  bodyJson: text("body_json").notNull(),
  bodySha256: text("body_sha256").notNull(),
  createdAt: text("created_at").notNull(),
}, t => [primaryKey({ columns: [t.sessionId, t.revision] }), uniqueIndex("quiz_revision_draft_request_unique").on(t.sessionId,t.requestKey),
  check("quiz_revision_draft_json", sql`json_valid(${t.bodyJson})`), check("quiz_revision_draft_positive", sql`${t.revision}>0`)]);

/** Public metadata and minimal proof survive draft expiration; solutions remain in their private table. */
export const quizRepublications = sqliteTable("quiz_republications", {
  sessionId: text("session_id").primaryKey().references(() => quizRevisionSessions.id, { onDelete: "restrict" }),
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  draftRevision: integer("draft_revision").notNull(),
  requestKey: text("request_key").notNull(), requestSha256: text("request_sha256").notNull(),
  actorDigest: text("actor_digest").notNull(), bodySha256: text("body_sha256").notNull(),
  slug: text("slug").notNull(), title: text("title").notNull(), sermonDate: text("sermon_date").notNull(),
  churchName: text("church_name").notNull(), bibleReferenceLabel: text("bible_reference_label").notNull(),
  translation: text("translation").notNull(), bibleReadingUrl: text("bible_reading_url").notNull(),
  summary: text("summary").notNull(), disclosure: text("disclosure").notNull(), displayRevision: integer("display_revision").notNull(),
  publishedAt: text("published_at").notNull(), closesAt: text("closes_at").notNull(),
}, t => [uniqueIndex("quiz_republication_revision_unique").on(t.quizSetId,t.revision), uniqueIndex("quiz_republication_request_unique").on(t.quizSetId,t.requestKey)]);

export const quizRevisionCleanup = sqliteTable("quiz_revision_cleanup", {
  sessionId: text("session_id").primaryKey().references(() => quizRevisionSessions.id, { onDelete: "restrict" }),
  headRevision: integer("head_revision").notNull(), dueAt: text("due_at").notNull(), purgedAt: text("purged_at").notNull(),
  hashesJson: text("hashes_json").notNull(),
}, t => [check("quiz_revision_cleanup_json", sql`json_valid(${t.hashesJson})`), check("quiz_revision_cleanup_time", sql`${t.purgedAt}>=${t.dueAt}`)]);

export const quizVariants = sqliteTable(
  "quiz_variants",
  {
    id: text("id").primaryKey(),
    quizSetId: text("quiz_set_id")
      .notNull()
      .references(() => quizSets.id, { onDelete: "cascade" }),
    difficulty: text("difficulty", { enum: ["child", "adult"] }).notNull(),
    revision: integer("revision").notNull(),
    lifecycleStatus: text("lifecycle_status", {
      enum: ["active", "superseded", "withdrawn"],
    })
      .notNull()
      .default("active"),
    resultsStatus: text("results_status", {
      enum: ["valid", "invalidated", "non_ranked_correction"],
    })
      .notNull()
      .default("valid"),
    replacesVariantId: text("replaces_variant_id").references(
      (): AnySQLiteColumn => quizVariants.id,
      { onDelete: "set null" },
    ),
    correctsVariantId: text("corrects_variant_id").references(
      (): AnySQLiteColumn => quizVariants.id,
      { onDelete: "set null" },
    ),
    lifecycleReason: text("lifecycle_reason"),
    lifecycleChangedAt: text("lifecycle_changed_at"),
    gridSize: integer("grid_size").notNull().default(5),
    publicGridJson: text("public_grid_json", { mode: "json" })
      .$type<PublicGrid>()
      .notNull(),
    wordCount: integer("word_count").notNull(),
    activeCellCount: integer("active_cell_count").notNull(),
    intersectionCount: integer("intersection_count").notNull(),
    winnerCount: integer("winner_count").notNull().default(3),
    validationReportJson: text("validation_report_json", { mode: "json" })
      .$type<ValidationReport>()
      .notNull(),
    desktopBackgroundPath: text("desktop_background_path"),
    mobileBackgroundPath: text("mobile_background_path"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("quiz_variants_set_difficulty_revision_uidx").on(
      table.quizSetId,
      table.difficulty,
      table.revision,
    ),
    uniqueIndex("quiz_variants_one_active_difficulty_uidx")
      .on(table.quizSetId, table.difficulty)
      .where(sql`${table.lifecycleStatus} = 'active'`),
    index("quiz_variants_results_status_idx").on(table.resultsStatus),
    index("quiz_variants_replaces_variant_id_idx").on(table.replacesVariantId),
    check("quiz_variants_revision_check", sql`${table.revision} >= 1`),
    check(
      "quiz_variants_difficulty_check",
      sql`${table.difficulty} in ('child', 'adult')`,
    ),
    check(
      "quiz_variants_lifecycle_status_check",
      sql`${table.lifecycleStatus} in ('active', 'superseded', 'withdrawn')`,
    ),
    check(
      "quiz_variants_results_status_check",
      sql`${table.resultsStatus} in ('valid', 'invalidated', 'non_ranked_correction')`,
    ),
    check(
      "quiz_variants_grid_size_check",
      sql`${table.gridSize} between 5 and 10`,
    ),
    check("quiz_variants_word_count_check", sql`${table.wordCount} >= 0`),
    check(
      "quiz_variants_active_cell_count_check",
      sql`${table.activeCellCount} >= 0`,
    ),
    check(
      "quiz_variants_intersection_count_check",
      sql`${table.intersectionCount} >= 0`,
    ),
    check(
      "quiz_variants_winner_count_check",
      sql`${table.winnerCount} between 1 and 10`,
    ),
  ],
);

// Despite the table name, evidence is private and must never be selected by public repositories.
export const quizEntriesPublic = sqliteTable("quiz_entries_public", {
  id: text("id").primaryKey(),
  quizVariantId: text("quiz_variant_id").notNull().references(() => quizVariants.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  direction: text("direction", { enum: ["across", "down"] }).notNull(),
  startRow: integer("start_row").notNull(),
  startCol: integer("start_col").notNull(),
  length: integer("length").notNull(),
  clue: text("clue").notNull(),
  transcriptEvidenceJson: text("transcript_evidence_json", { mode: "json" }).$type<unknown>(),
  displayOrder: integer("display_order").notNull(),
}, (table) => [
  uniqueIndex("quiz_entries_variant_number_direction_uidx").on(table.quizVariantId, table.number, table.direction),
  check("quiz_entries_number_check", sql`${table.number} >= 1`),
  check("quiz_entries_direction_check", sql`${table.direction} in ('across', 'down')`),
  check("quiz_entries_coordinate_check", sql`${table.startRow} between 0 and 9 and ${table.startCol} between 0 and 9`),
  check("quiz_entries_length_check", sql`${table.length} between 2 and 10`),
  check("quiz_entries_order_check", sql`${table.displayOrder} >= 0`),
]);

// Server-only answer material. Public repositories must never import this table.
export const quizSolutions = sqliteTable("quiz_solutions", {
  quizVariantId: text("quiz_variant_id")
    .primaryKey()
    .references(() => quizVariants.id, { onDelete: "cascade" }),
  canonicalCellOrderJson: text("canonical_cell_order_json", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  solutionCellsJson: text("solution_cells_json", { mode: "json" })
    .$type<SolutionCells>()
    .notNull(),
  entryAnswersJson: text("entry_answers_json", { mode: "json" })
    .$type<EntryAnswers>()
    .notNull(),
  solutionSha256: text("solution_sha256").notNull(),
}, (table) => [
  check("quiz_solutions_canonical_json_check", sql`json_valid(${table.canonicalCellOrderJson})`),
  check("quiz_solutions_cells_json_check", sql`json_valid(${table.solutionCellsJson})`),
  check("quiz_solutions_entries_json_check", sql`json_valid(${table.entryAnswersJson})`),
  check(
    "quiz_solutions_sha256_check",
    sql`length(${table.solutionSha256}) = 64 and ${table.solutionSha256} not glob '*[^0-9a-f]*'`,
  ),
]);

export const anonymousSessions = sqliteTable("anonymous_sessions", {
  sessionHash: text("session_hash").primaryKey(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("anonymous_sessions_expires_at_idx").on(table.expiresAt),
  check(
    "anonymous_sessions_hash_check",
    sql`length(${table.sessionHash}) = 64 and ${table.sessionHash} not glob '*[^0-9a-f]*'`,
  ),
  check(
    "anonymous_sessions_time_check",
    sql`${table.lastSeenAt} >= ${table.createdAt} and ${table.expiresAt} > ${table.lastSeenAt}`,
  ),
]);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  quizVariantId: text("quiz_variant_id")
    .notNull()
    .references(() => quizVariants.id, { onDelete: "restrict" }),
  quizRevision: integer("quiz_revision").notNull(),
  sessionHash: text("session_hash")
    .notNull()
    .references(() => anonymousSessions.sessionHash, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  displayName: text("display_name"),
  comment: text("comment"),
  answersJson: text("answers_json", { mode: "json" }).$type<SubmissionAnswers>(),
  correctnessMask: text("correctness_mask").notNull(),
  correctCells: integer("correct_cells").notNull(),
  totalCells: integer("total_cells").notNull(),
  correctWords: integer("correct_words").notNull(),
  totalWords: integer("total_words").notNull(),
  scoreBasisPoints: integer("score_basis_points").notNull(),
  isFullyCorrect: integer("is_fully_correct", { mode: "boolean" }).notNull(),
  status: text("status", { enum: ["visible", "hidden", "deleted"] })
    .notNull()
    .default("visible"),
  submittedAt: text("submitted_at").notNull(),
  hiddenAt: text("hidden_at"),
  deletedAt: text("deleted_at"),
}, (table) => [
  uniqueIndex("submissions_variant_session_uidx").on(table.quizVariantId, table.sessionHash),
  uniqueIndex("submissions_variant_session_idempotency_uidx").on(
    table.quizVariantId,
    table.sessionHash,
    table.idempotencyKey,
  ),
  index("submissions_variant_status_submitted_idx").on(
    table.quizVariantId,
    table.status,
    table.submittedAt,
    table.id,
  ),
  index("submissions_variant_full_correct_submitted_idx").on(
    table.quizVariantId,
    table.status,
    table.isFullyCorrect,
    table.submittedAt,
    table.id,
  ),
  check("submissions_revision_check", sql`${table.quizRevision} >= 1`),
  check(
    "submissions_request_hash_check",
    sql`length(${table.requestHash}) = 64 and ${table.requestHash} not glob '*[^0-9a-f]*'`,
  ),
  check(
    "submissions_idempotency_key_check",
    sql`length(${table.idempotencyKey}) = 36 and ${table.idempotencyKey} = lower(${table.idempotencyKey}) and ${table.idempotencyKey} glob '????????-????-7???-[89ab]???-????????????' and ${table.idempotencyKey} not glob '*[^0-9a-f-]*'`,
  ),
  check("submissions_answers_json_check", sql`${table.answersJson} is null or json_valid(${table.answersJson})`),
  check(
    "submissions_cell_score_check",
    sql`${table.totalCells} between 1 and 100 and ${table.correctCells} between 0 and ${table.totalCells}`,
  ),
  check(
    "submissions_word_score_check",
    sql`${table.totalWords} between 1 and 100 and ${table.correctWords} between 0 and ${table.totalWords}`,
  ),
  check(
    "submissions_basis_points_check",
    sql`${table.scoreBasisPoints} = round(${table.correctCells} * 10000.0 / ${table.totalCells})`,
  ),
  check(
    "submissions_correctness_mask_check",
    sql`length(${table.correctnessMask}) = ${table.totalCells} and ${table.correctnessMask} not glob '*[^01]*' and length(${table.correctnessMask}) - length(replace(${table.correctnessMask}, '1', '')) = ${table.correctCells}`,
  ),
  check(
    "submissions_fully_correct_check",
    sql`${table.isFullyCorrect} = (${table.correctCells} = ${table.totalCells})`,
  ),
  check(
    "submissions_status_check",
    sql`${table.status} in ('visible', 'hidden', 'deleted')`,
  ),
  check(
    "submissions_content_status_check",
    sql`(${table.status} = 'visible' and ${table.displayName} is not null and ${table.answersJson} is not null and ${table.hiddenAt} is null and ${table.deletedAt} is null) or (${table.status} = 'hidden' and ${table.displayName} is not null and ${table.answersJson} is not null and ${table.hiddenAt} is not null and ${table.deletedAt} is null) or (${table.status} = 'deleted' and ${table.displayName} is null and ${table.comment} is null and ${table.answersJson} is null and ${table.deletedAt} is not null)`,
  ),
]);

export const leaderboardSnapshots = sqliteTable("leaderboard_snapshots", {
  id: text("id").primaryKey(),
  quizVariantId: text("quiz_variant_id")
    .notNull()
    .references(() => quizVariants.id, { onDelete: "restrict" }),
  winnerCount: integer("winner_count").notNull(),
  finalizedAt: text("finalized_at").notNull(),
}, (table) => [
  uniqueIndex("leaderboard_snapshots_variant_uidx").on(table.quizVariantId),
  check(
    "leaderboard_snapshots_id_check",
    sql`length(${table.id}) between 1 and 128`,
  ),
  check(
    "leaderboard_snapshots_winner_count_check",
    sql`${table.winnerCount} between 1 and 10`,
  ),
]);

export const leaderboardSnapshotEntries = sqliteTable("leaderboard_snapshot_entries", {
  snapshotId: text("snapshot_id")
    .notNull()
    .references(() => leaderboardSnapshots.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  submissionId: text("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "restrict" }),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.rank] }),
  uniqueIndex("leaderboard_snapshot_entries_submission_uidx").on(
    table.snapshotId,
    table.submissionId,
  ),
  check(
    "leaderboard_snapshot_entries_rank_check",
    sql`${table.rank} between 1 and 10`,
  ),
]);

// Append-only operational record. This table deliberately has no foreign key:
// an audit record must survive later retention or deletion of its target.
export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actorType: text("actor_type", {
    enum: ["access_admin", "self_service", "system"],
  }).notNull(),
  actorEmail: text("actor_email"),
  safeMetadataJson: text("safe_metadata_json", { mode: "json" })
    .$type<AuditSafeMetadata>()
    .notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("audit_logs_entity_created_idx").on(
    table.entityType,
    table.entityId,
    table.createdAt,
    table.id,
  ),
  index("audit_logs_created_idx").on(table.createdAt, table.id),
  check("audit_logs_id_check", sql`length(${table.id}) between 1 and 128`),
  check(
    "audit_logs_entity_check",
    sql`length(trim(${table.entityType})) between 1 and 64 and length(trim(${table.entityId})) between 1 and 128`,
  ),
  check(
    "audit_logs_action_check",
    sql`length(trim(${table.action})) between 1 and 128`,
  ),
  check(
    "audit_logs_actor_type_check",
    sql`${table.actorType} in ('access_admin', 'self_service', 'system')`,
  ),
  check(
    "audit_logs_actor_identity_check",
    sql`(${table.actorType} = 'access_admin' and ${table.actorEmail} is not null and length(trim(${table.actorEmail})) between 3 and 320) or (${table.actorType} <> 'access_admin' and ${table.actorEmail} is null)`,
  ),
  check(
    "audit_logs_safe_metadata_json_check",
    sql`json_valid(${table.safeMetadataJson}) and json_type(${table.safeMetadataJson}) = 'object'`,
  ),
]);

export const moderationActions = sqliteTable("moderation_actions", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "restrict" }),
  action: text("action", { enum: ["hide", "unhide", "delete"] }).notNull(),
  actorEmail: text("actor_email").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("moderation_actions_submission_created_idx").on(
    table.submissionId,
    table.createdAt,
    table.id,
  ),
  check("moderation_actions_id_check", sql`length(${table.id}) between 1 and 128`),
  check(
    "moderation_actions_action_check",
    sql`${table.action} in ('hide', 'unhide', 'delete')`,
  ),
  check(
    "moderation_actions_actor_email_check",
    sql`length(trim(${table.actorEmail})) between 3 and 320`,
  ),
  check(
    "moderation_actions_reason_check",
    sql`length(trim(${table.reason})) between 2 and 500 and instr(${table.reason}, char(10)) = 0 and instr(${table.reason}, char(13)) = 0`,
  ),
]);

// Server-only impersonation protection. Baseline church/role names remain in
// code; this table stores administrator-managed people and explicit aliases.
export const reservedNames = sqliteTable("reserved_names", {
  id: text("id").primaryKey(),
  protectedGroupId: text("protected_group_id"),
  displayLabel: text("display_label").notNull(),
  normalizedValue: text("normalized_value").notNull(),
  category: text("category", {
    enum: ["church", "role", "person", "alias"],
  }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("reserved_names_normalized_value_uidx").on(table.normalizedValue),
  index("reserved_names_enabled_value_idx").on(table.enabled, table.normalizedValue),
  check("reserved_names_id_check", sql`length(${table.id}) between 1 and 128`),
  check(
    "reserved_names_group_check",
    sql`${table.protectedGroupId} is null or length(${table.protectedGroupId}) between 1 and 128`,
  ),
  check(
    "reserved_names_display_label_check",
    sql`length(trim(${table.displayLabel})) between 1 and 200`,
  ),
  check(
    "reserved_names_normalized_value_check",
    sql`length(${table.normalizedValue}) between 1 and 512 and ${table.normalizedValue} = trim(${table.normalizedValue})`,
  ),
  check(
    "reserved_names_category_check",
    sql`${table.category} in ('church', 'role', 'person', 'alias')`,
  ),
  check("reserved_names_enabled_check", sql`${table.enabled} in (0, 1)`),
  check(
    "reserved_names_created_by_check",
    sql`length(trim(${table.createdBy})) between 1 and 320`,
  ),
  check(
    "reserved_names_time_check",
    sql`${table.updatedAt} >= ${table.createdAt}`,
  ),
]);

// Server-only deterministic filters. Patterns are normalized before storage;
// raw public text and exact matched evidence must never be returned publicly.
export const moderationTerms = sqliteTable("moderation_terms", {
  id: text("id").primaryKey(),
  scope: text("scope", { enum: ["name", "comment", "answer", "all"] }).notNull(),
  normalizedPattern: text("normalized_pattern").notNull(),
  matchMode: text("match_mode", { enum: ["exact", "contains"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("moderation_terms_scope_pattern_mode_uidx").on(
    table.scope,
    table.normalizedPattern,
    table.matchMode,
  ),
  index("moderation_terms_enabled_scope_idx").on(table.enabled, table.scope, table.id),
  check("moderation_terms_id_check", sql`length(${table.id}) between 1 and 128`),
  check(
    "moderation_terms_scope_check",
    sql`${table.scope} in ('name', 'comment', 'answer', 'all')`,
  ),
  check(
    "moderation_terms_pattern_check",
    sql`length(${table.normalizedPattern}) between 1 and 512 and ${table.normalizedPattern} = trim(${table.normalizedPattern})`,
  ),
  check(
    "moderation_terms_match_mode_check",
    sql`${table.matchMode} in ('exact', 'contains')`,
  ),
  check("moderation_terms_enabled_check", sql`${table.enabled} in (0, 1)`),
  check(
    "moderation_terms_created_by_check",
    sql`length(trim(${table.createdBy})) between 1 and 320`,
  ),
  check(
    "moderation_terms_time_check",
    sql`${table.updatedAt} >= ${table.createdAt}`,
  ),
]);

// Exact, scope-specific exceptions only. A contains exception would be broad
// enough to defeat unrelated moderation rules and is intentionally impossible.
export const moderationExceptions = sqliteTable("moderation_exceptions", {
  id: text("id").primaryKey(),
  scope: text("scope", { enum: ["name", "comment", "answer"] }).notNull(),
  normalizedValue: text("normalized_value").notNull(),
  reason: text("reason").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("moderation_exceptions_normalized_value_uidx").on(table.normalizedValue),
  index("moderation_exceptions_enabled_scope_idx").on(table.enabled, table.scope, table.id),
  check("moderation_exceptions_id_check", sql`length(${table.id}) between 1 and 128`),
  check(
    "moderation_exceptions_scope_check",
    sql`${table.scope} in ('name', 'comment', 'answer')`,
  ),
  check(
    "moderation_exceptions_value_check",
    sql`length(${table.normalizedValue}) between 1 and 512 and ${table.normalizedValue} = trim(${table.normalizedValue})`,
  ),
  check(
    "moderation_exceptions_reason_check",
    sql`length(trim(${table.reason})) between 1 and 1000`,
  ),
  check("moderation_exceptions_enabled_check", sql`${table.enabled} in (0, 1)`),
  check(
    "moderation_exceptions_created_by_check",
    sql`length(trim(${table.createdBy})) between 1 and 320`,
  ),
  check(
    "moderation_exceptions_time_check",
    sql`${table.updatedAt} >= ${table.createdAt}`,
  ),
]);

// Private inquiry record; the receipt itself is never stored.
export const privacyRequests = sqliteTable("privacy_requests", {
  id: text("id").primaryKey(),
  lookupTokenHash: text("lookup_token_hash").notNull().unique(),
  requestHash: text("request_hash").notNull(),
  requestType: text("request_type", { enum: ["delete_submission", "privacy_question"] }).notNull(),
  quizSlug: text("quiz_slug"), submittedName: text("submitted_name"), message: text("message").notNull(),
  status: text("status", { enum: ["received", "reviewing", "resolved", "rejected"] }).notNull().default("received"),
  adminResponse: text("admin_response"), resolvedBy: text("resolved_by"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), resolvedAt: text("resolved_at"), purgeAfter: text("purge_after"),
}, table => [
  index("privacy_requests_status_created_idx").on(table.status, table.createdAt),
  check("privacy_requests_hash_check", sql`length(${table.lookupTokenHash})=64 and ${table.lookupTokenHash} not glob '*[^0-9a-f]*' and length(${table.requestHash})=64`),
  check("privacy_requests_type_check", sql`${table.requestType} in ('delete_submission','privacy_question')`),
  check("privacy_requests_status_check", sql`${table.status} in ('received','reviewing','resolved','rejected')`),
  check("privacy_requests_message_check", sql`length(trim(${table.message})) between 2 and 1000`),
  check("privacy_requests_reply_check", sql`${table.adminResponse} is null or length(${table.adminResponse})<=1000`),
]);

export const siteState = sqliteTable("site_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Private editing snapshot. Never joined by the public sermon repository. */
export const sermonMetadataDrafts = sqliteTable(
  "sermon_metadata_drafts",
  {
    sermonId: text("sermon_id").primaryKey().notNull()
      .references(() => sermons.id, { onDelete: "restrict" }),
    contractVersion: integer("contract_version").notNull(),
    metadataRevision: integer("metadata_revision").notNull(),
    title: text("title").notNull(),
    sermonDate: text("sermon_date").notNull(),
    bibleReferenceJson: text("bible_reference_json").notNull(),
  },
  (table) => [
    check("sermon_metadata_drafts_contract_check", sql`${table.contractVersion} = 1`),
    check("sermon_metadata_drafts_revision_check",
      sql`typeof(${table.metadataRevision}) = 'integer' and ${table.metadataRevision} between 1 and 9007199254740991`),
    check("sermon_metadata_drafts_title_check", sql`length(${table.title}) between 1 and 300`),
    check("sermon_metadata_drafts_reference_json_check",
      sql`json_valid(${table.bibleReferenceJson}) and json_type(${table.bibleReferenceJson}) = 'object'`),
  ],
);


// Private append-only envelopes. Cross-row seal/immutability guards live in 0008.
export const sermonHistoryHeads = sqliteTable("sermon_history_heads", {
  sermonId: text("sermon_id").notNull(),
  version: integer("version").notNull(),
  commitId: text("commit_id").notNull(),
  currentSourceId: text("current_source_id").notNull(),
  currentRevisionId: text("current_revision_id").notNull(),
  currentConfirmationId: text("current_confirmation_id"),
  storageFormatVersion: integer("storage_format_version").notNull(),
  contractVersion: integer("contract_version").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.sermonId] }),
  foreignKey({ name: "history_heads_sermon_fk", columns: [table.sermonId], foreignColumns: [sermons.id] }).onDelete("restrict"),
  foreignKey({ name: "history_heads_current_source_id_fk", columns: [table.sermonId, table.currentSourceId], foreignColumns: [sermonHistoryRecords.sermonId, sermonHistoryRecords.recordId] }).onDelete("restrict"),
  foreignKey({ name: "history_heads_current_revision_id_fk", columns: [table.sermonId, table.currentRevisionId], foreignColumns: [sermonHistoryRecords.sermonId, sermonHistoryRecords.recordId] }).onDelete("restrict"),
  foreignKey({ name: "history_heads_current_confirmation_id_fk", columns: [table.sermonId, table.currentConfirmationId], foreignColumns: [sermonHistoryRecords.sermonId, sermonHistoryRecords.recordId] }).onDelete("restrict"),
  foreignKey({ name: "history_heads_commit_fk", columns: [table.sermonId, table.version, table.commitId], foreignColumns: [sermonHistoryCommits.sermonId, sermonHistoryCommits.version, sermonHistoryCommits.commitId] }).onDelete("restrict"),
  check("history_heads_sermon_id_check", sql`length(sermon_id) between 1 and 128`),
  check("history_heads_version_check", sql`(typeof(version) = 'integer' and version between 1 and 9007199254740991)`),
  check("history_heads_commit_id_check", sql`length(commit_id) between 1 and 128`),
  check("history_heads_current_source_id_check", sql`length(current_source_id) between 1 and 128`),
  check("history_heads_current_revision_id_check", sql`length(current_revision_id) between 1 and 128`),
  check("history_heads_current_confirmation_id_check", sql`current_confirmation_id is null or length(current_confirmation_id) between 1 and 128`),
  check("history_heads_storage_format_version_check", sql`(typeof(storage_format_version) = 'integer' and storage_format_version between 1 and 9007199254740991)`),
  check("history_heads_contract_version_check", sql`(typeof(contract_version) = 'integer' and contract_version between 1 and 9007199254740991)`),
  check("history_heads_format_check", sql`storage_format_version = 1 and contract_version = 1`),
]);

export const sermonHistoryCommits = sqliteTable("sermon_history_commits", {
  sermonId: text("sermon_id").notNull(),
  version: integer("version").notNull(),
  commitId: text("commit_id").notNull(),
  currentSourceId: text("current_source_id").notNull(),
  currentRevisionId: text("current_revision_id").notNull(),
  currentConfirmationId: text("current_confirmation_id"),
  attemptId: text("attempt_id").notNull(),
  previousVersion: integer("previous_version"),
  previousCommitId: text("previous_commit_id"),
  state: text("state").notNull(),
  requiredSealState: text("required_seal_state").notNull().default("sealed"),
  command: text("command").notNull(),
  sourcesCount: integer("sources_count").notNull(),
  revisionsCount: integer("revisions_count").notNull(),
  confirmationsCount: integer("confirmations_count").notNull(),
  correctionProposalsCount: integer("correctionProposals_count").notNull(),
  correctionDecisionsCount: integer("correctionDecisions_count").notNull(),
  intentEventsCount: integer("intentEvents_count").notNull(),
  summaryEventsCount: integer("summaryEvents_count").notNull(),
  candidateEventsCount: integer("candidateEvents_count").notNull(),
  recordCount: integer("record_count").notNull(),
  referenceCount: integer("reference_count").notNull(),
  manifestCount: integer("manifest_count").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  byteLength: integer("byte_length").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.sermonId, table.version] }),
  uniqueIndex("history_commits_sealed_state_uidx").on(table.sermonId, table.version, table.state),
  foreignKey({ name: "history_commits_required_seal_fk", columns: [table.sermonId, table.version, table.requiredSealState], foreignColumns: [sermonHistoryCommits.sermonId, sermonHistoryCommits.version, sermonHistoryCommits.state] }).onDelete("restrict"),
  check("history_commits_required_seal_check", sql`required_seal_state = 'sealed'`),
  foreignKey({ name: "history_commits_sermon_fk", columns: [table.sermonId], foreignColumns: [sermons.id] }).onDelete("restrict"),
  foreignKey({ name: "history_commits_current_source_id_fk", columns: [table.sermonId, table.currentSourceId], foreignColumns: [sermonHistoryRecords.sermonId, sermonHistoryRecords.recordId] }).onDelete("restrict"),
  foreignKey({ name: "history_commits_current_revision_id_fk", columns: [table.sermonId, table.currentRevisionId], foreignColumns: [sermonHistoryRecords.sermonId, sermonHistoryRecords.recordId] }).onDelete("restrict"),
  foreignKey({ name: "history_commits_current_confirmation_id_fk", columns: [table.sermonId, table.currentConfirmationId], foreignColumns: [sermonHistoryRecords.sermonId, sermonHistoryRecords.recordId] }).onDelete("restrict"),
  foreignKey({ name: "history_commits_previous_fk", columns: [table.sermonId, table.previousVersion, table.previousCommitId], foreignColumns: [sermonHistoryCommits.sermonId, sermonHistoryCommits.version, sermonHistoryCommits.commitId] }).onDelete("restrict"),
  uniqueIndex("history_commits_id_uidx").on(table.sermonId, table.commitId),
  uniqueIndex("history_commits_version_id_uidx").on(table.sermonId, table.version, table.commitId),
  uniqueIndex("history_commits_attempt_uidx").on(table.attemptId),
  check("history_commits_sermon_id_check", sql`length(sermon_id) between 1 and 128`),
  check("history_commits_version_check", sql`(typeof(version) = 'integer' and version between 1 and 9007199254740991)`),
  check("history_commits_commit_id_check", sql`length(commit_id) between 1 and 128`),
  check("history_commits_current_source_id_check", sql`length(current_source_id) between 1 and 128`),
  check("history_commits_current_revision_id_check", sql`length(current_revision_id) between 1 and 128`),
  check("history_commits_current_confirmation_id_check", sql`current_confirmation_id is null or length(current_confirmation_id) between 1 and 128`),
  check("history_commits_attempt_id_check", sql`length(attempt_id) between 1 and 128`),
  check("history_commits_previous_version_check", sql`previous_version is null or (typeof(previous_version) = 'integer' and previous_version between 1 and 9007199254740991)`),
  check("history_commits_previous_commit_id_check", sql`previous_commit_id is null or length(previous_commit_id) between 1 and 128`),
  check("history_commits_state_check", sql`length(state) between 1 and 128`),
  check("history_commits_command_check", sql`length(command) between 1 and 128`),
  check("history_commits_sources_count_check", sql`(typeof(sources_count) = 'integer' and sources_count between 0 and 9007199254740991)`),
  check("history_commits_revisions_count_check", sql`(typeof(revisions_count) = 'integer' and revisions_count between 0 and 9007199254740991)`),
  check("history_commits_confirmations_count_check", sql`(typeof(confirmations_count) = 'integer' and confirmations_count between 0 and 9007199254740991)`),
  check("history_commits_correctionProposals_count_check", sql`(typeof(correctionProposals_count) = 'integer' and correctionProposals_count between 0 and 9007199254740991)`),
  check("history_commits_correctionDecisions_count_check", sql`(typeof(correctionDecisions_count) = 'integer' and correctionDecisions_count between 0 and 9007199254740991)`),
  check("history_commits_intentEvents_count_check", sql`(typeof(intentEvents_count) = 'integer' and intentEvents_count between 0 and 9007199254740991)`),
  check("history_commits_summaryEvents_count_check", sql`(typeof(summaryEvents_count) = 'integer' and summaryEvents_count between 0 and 9007199254740991)`),
  check("history_commits_candidateEvents_count_check", sql`(typeof(candidateEvents_count) = 'integer' and candidateEvents_count between 0 and 9007199254740991)`),
  check("history_commits_record_count_check", sql`(typeof(record_count) = 'integer' and record_count between 0 and 9007199254740991)`),
  check("history_commits_reference_count_check", sql`(typeof(reference_count) = 'integer' and reference_count between 0 and 9007199254740991)`),
  check("history_commits_manifest_count_check", sql`(typeof(manifest_count) = 'integer' and manifest_count between 0 and 9007199254740991)`),
  check("history_commits_chunk_count_check", sql`(typeof(chunk_count) = 'integer' and chunk_count between 0 and 9007199254740991)`),
  check("history_commits_byte_length_check", sql`(typeof(byte_length) = 'integer' and byte_length between 1 and 9007199254740991)`),
  check("history_commits_state_enum_check", sql`state in ('assembling', 'sealed')`),
  check("history_commits_previous_check", sql`(version = 1 and previous_version is null and previous_commit_id is null and command = 'import') or (version > 1 and previous_version is not null and previous_version = version - 1 and previous_commit_id is not null)`),
  check("history_commits_command_enum_check", sql`command in ('import', 'revisions', 'confirmations', 'correctionProposals', 'correctionDecisions', 'intentEvents', 'summaryEvents', 'candidateEvents')`),
]);

export const sermonHistoryRecords = sqliteTable("sermon_history_records", {
  sermonId: text("sermon_id").notNull(),
  recordId: text("record_id").notNull(),
  stream: text("stream").notNull(),
  streamPosition: integer("stream_position").notNull(),
  commitVersion: integer("commit_version").notNull(),
  commitSlot: integer("commit_slot").notNull(),
  sourceRevision: integer("source_revision"),
  difficulty: text("difficulty"),
  verified: integer("verified").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.sermonId, table.recordId] }),
  foreignKey({ name: "history_records_commit_fk", columns: [table.sermonId, table.commitVersion], foreignColumns: [sermonHistoryCommits.sermonId, sermonHistoryCommits.version] }).onDelete("restrict"),
  uniqueIndex("history_records_stream_position_uidx").on(table.sermonId, table.stream, table.streamPosition),
  uniqueIndex("history_records_commit_slot_uidx").on(table.sermonId, table.commitVersion, table.commitSlot),
  uniqueIndex("history_records_source_revision_uidx").on(table.sermonId, table.sourceRevision),
  check("history_records_sermon_id_check", sql`length(sermon_id) between 1 and 128`),
  check("history_records_record_id_check", sql`length(record_id) between 1 and 128`),
  check("history_records_stream_check", sql`length(stream) between 1 and 128`),
  check("history_records_stream_position_check", sql`(typeof(stream_position) = 'integer' and stream_position between 1 and 9007199254740991)`),
  check("history_records_commit_version_check", sql`(typeof(commit_version) = 'integer' and commit_version between 1 and 9007199254740991)`),
  check("history_records_commit_slot_check", sql`(typeof(commit_slot) = 'integer' and commit_slot between 0 and 9007199254740991)`),
  check("history_records_source_revision_check", sql`source_revision is null or (typeof(source_revision) = 'integer' and source_revision between 1 and 9007199254740991)`),
  check("history_records_difficulty_check", sql`difficulty is null or length(difficulty) between 1 and 128`),
  check("history_records_verified_check", sql`(typeof(verified) = 'integer' and verified between 0 and 1)`),
  check("history_records_stream_enum_check", sql`stream in ('sources', 'revisions', 'confirmations', 'correctionProposals', 'correctionDecisions', 'intentEvents', 'summaryEvents', 'candidateEvents')`),
  check("history_records_projection_check", sql`(stream = 'sources' and source_revision is not null and source_revision = stream_position) or (stream <> 'sources' and source_revision is null)`),
  check("history_records_difficulty_enum_check", sql`(stream = 'candidateEvents' and difficulty is not null and difficulty in ('child','adult')) or (stream <> 'candidateEvents' and difficulty is null)`),
]);

export const sermonHistoryReferences = sqliteTable("sermon_history_references", {
  sermonId: text("sermon_id").notNull(),
  ownerRecordId: text("owner_record_id").notNull(),
  referencePosition: integer("reference_position").notNull(),
  relation: text("relation").notNull(),
  targetRecordId: text("target_record_id").notNull(),
  targetStream: text("target_stream").notNull(),
  targetMemberId: text("target_member_id"),
  payloadPath: text("payload_path").notNull(),
  verified: integer("verified").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.sermonId, table.ownerRecordId, table.referencePosition] }),
  foreignKey({ name: "history_references_owner_record_id_fk", columns: [table.sermonId, table.ownerRecordId], foreignColumns: [sermonHistoryRecords.sermonId, sermonHistoryRecords.recordId] }).onDelete("restrict"),
  foreignKey({ name: "history_references_target_record_id_fk", columns: [table.sermonId, table.targetRecordId], foreignColumns: [sermonHistoryRecords.sermonId, sermonHistoryRecords.recordId] }).onDelete("restrict"),
  index("history_references_target_idx").on(table.sermonId, table.targetRecordId),
  check("history_references_sermon_id_check", sql`length(sermon_id) between 1 and 128`),
  check("history_references_owner_record_id_check", sql`length(owner_record_id) between 1 and 128`),
  check("history_references_reference_position_check", sql`(typeof(reference_position) = 'integer' and reference_position between 1 and 9007199254740991)`),
  check("history_references_relation_check", sql`length(relation) between 1 and 128`),
  check("history_references_target_record_id_check", sql`length(target_record_id) between 1 and 128`),
  check("history_references_target_stream_check", sql`length(target_stream) between 1 and 128`),
  check("history_references_target_member_id_check", sql`target_member_id is null or length(target_member_id) between 1 and 128`),
  check("history_references_payload_path_check", sql`length(payload_path) between 1 and 512`),
  check("history_references_verified_check", sql`(typeof(verified) = 'integer' and verified between 0 and 1)`),
  check("history_references_target_stream_enum_check", sql`target_stream in ('sources', 'revisions', 'confirmations', 'correctionProposals', 'correctionDecisions', 'intentEvents', 'summaryEvents', 'candidateEvents')`),
]);

export const sermonHistoryPayloads = sqliteTable("sermon_history_payloads", {
  sermonId: text("sermon_id").notNull(),
  recordId: text("record_id").notNull(),
  codec: text("codec").notNull(),
  chunkBytes: integer("chunk_bytes").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  byteLength: integer("byte_length").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  verified: integer("verified").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.sermonId, table.recordId] }),
  foreignKey({ name: "history_payloads_record_fk", columns: [table.sermonId, table.recordId], foreignColumns: [sermonHistoryRecords.sermonId, sermonHistoryRecords.recordId] }).onDelete("restrict"),
  check("history_payloads_sermon_id_check", sql`length(sermon_id) between 1 and 128`),
  check("history_payloads_record_id_check", sql`length(record_id) between 1 and 128`),
  check("history_payloads_codec_check", sql`length(codec) between 1 and 128`),
  check("history_payloads_chunk_bytes_check", sql`(typeof(chunk_bytes) = 'integer' and chunk_bytes between 1 and 9007199254740991)`),
  check("history_payloads_chunk_count_check", sql`(typeof(chunk_count) = 'integer' and chunk_count between 0 and 9007199254740991)`),
  check("history_payloads_byte_length_check", sql`(typeof(byte_length) = 'integer' and byte_length between 1 and 9007199254740991)`),
  check("history_payloads_payload_sha256_check", sql`length(payload_sha256) between 1 and 128`),
  check("history_payloads_verified_check", sql`(typeof(verified) = 'integer' and verified between 0 and 1)`),
  check("history_payloads_codec_enum_check", sql`codec = 'record-json-utf8-v1' and chunk_bytes = 65536 and chunk_count = (byte_length - 1) / 65536 + 1`),
  check("history_payloads_sha256_check", sql`length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*'`),
]);

export const sermonHistoryChunks = sqliteTable("sermon_history_chunks", {
  sermonId: text("sermon_id").notNull(),
  recordId: text("record_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  byteLength: integer("byte_length").notNull(),
  chunkSha256: text("chunk_sha256").notNull(),
  body: blob("body", { mode: "buffer" }).notNull(),
  verified: integer("verified").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.sermonId, table.recordId, table.chunkIndex] }),
  foreignKey({ name: "history_chunks_payload_fk", columns: [table.sermonId, table.recordId], foreignColumns: [sermonHistoryPayloads.sermonId, sermonHistoryPayloads.recordId] }).onDelete("restrict"),
  check("history_chunks_sermon_id_check", sql`length(sermon_id) between 1 and 128`),
  check("history_chunks_record_id_check", sql`length(record_id) between 1 and 128`),
  check("history_chunks_chunk_index_check", sql`(typeof(chunk_index) = 'integer' and chunk_index between 0 and 9007199254740991)`),
  check("history_chunks_byte_length_check", sql`(typeof(byte_length) = 'integer' and byte_length between 1 and 9007199254740991)`),
  check("history_chunks_chunk_sha256_check", sql`length(chunk_sha256) between 1 and 128`),
  check("history_chunks_verified_check", sql`(typeof(verified) = 'integer' and verified between 0 and 1)`),
  check("history_chunks_sha256_check", sql`length(chunk_sha256) = 64 and chunk_sha256 not glob '*[^0-9a-f]*'`),
  check("history_chunks_body_check", sql`typeof(body) = 'blob' and byte_length = length(body) and byte_length between 1 and 65536`),
]);

// D-031 local-only input path. One event stores one new record; importing a source
// does not also create a revision. 0009 adds transaction/immutability guards.
export const sermonInputEvents = sqliteTable("sermon_input_events", {
  sermonId: text("sermon_id").notNull().references(() => sermons.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  id: text("id").notNull(),
  kind: text("kind").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  documentId: text("document_id").notNull(),
  confirmationId: text("confirmation_id"),
  parentDocumentId: text("parent_document_id"),
  relatedId: text("related_id"),
  documentSha256: text("document_sha256").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  byteLength: integer("byte_length").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: text("created_at").notNull(),
  state: text("state").notNull(),
  requiredState: text("required_state").notNull().default("sealed"),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.sermonId, table.version] }),
  uniqueIndex("input_events_id_uidx").on(table.sermonId, table.id),
  uniqueIndex("input_events_seal_uidx").on(table.sermonId, table.version, table.state),
  index("input_events_related_idx").on(table.sermonId, table.relatedId, table.kind, table.version),
  foreignKey({ columns: [table.sermonId, table.version, table.requiredState], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.version, sermonInputEvents.state] }),
  foreignKey({ columns: [table.sermonId, table.sourceId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }),
  foreignKey({ columns: [table.sermonId, table.documentId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }),
  foreignKey({ columns: [table.sermonId, table.confirmationId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }),
  foreignKey({ columns: [table.sermonId, table.parentDocumentId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }),
  foreignKey({ columns: [table.sermonId, table.relatedId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }),
  check("input_events_version_check", sql`typeof(version) = 'integer' and version between 1 and 9007199254740991`),
  check("input_events_kind_check", sql`kind in ('source','edit','restore','confirm','proposal','decision','merge')`),
  check("input_events_source_type_check", sql`source_type in ('caption_plain','caption_timed','sermon_manuscript','sermon_summary')`),
  check("input_events_state_check", sql`state in ('pending','sealed') and required_state = 'sealed'`),
  check("input_events_size_check", sql`typeof(chunk_count) = 'integer' and chunk_count between 1 and 4096 and typeof(byte_length) = 'integer' and byte_length between 1 and 67108864`),
  check("input_events_hash_check", sql`length(document_sha256) = 64 and document_sha256 not glob '*[^0-9a-f]*' and length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*'`),
]);

export const sermonInputChunks = sqliteTable("sermon_input_chunks", {
  sermonId: text("sermon_id").notNull(),
  eventId: text("event_id").notNull(),
  position: integer("position").notNull(),
  body: text("body").notNull(),
}, (table) => [
  primaryKey({ columns: [table.sermonId, table.eventId, table.position] }),
  foreignKey({ columns: [table.sermonId, table.eventId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }),
  check("input_chunks_position_check", sql`typeof(position) = 'integer' and position between 0 and 4095`),
  check("input_chunks_body_check", sql`typeof(body) = 'text' and length(cast(body as blob)) between 1 and 65536`),
]);

export const sermonInputHeads = sqliteTable("sermon_input_heads", {
  sermonId: text("sermon_id").primaryKey().notNull(),
  version: integer("version").notNull(),
}, (table) => [
  foreignKey({ columns: [table.sermonId, table.version], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.version] }),
]);

// Private generation coordination envelopes. Cross-row transition, immutable
// request, and required-event guards are reviewed additions in migration 0010.
export const generationJobs = sqliteTable("generation_jobs", {
  requestContextId: text("request_context_id"),
  evidenceEventNo: integer("evidence_event_no"),
  activeWaitGeneration: integer("active_wait_generation"),
  id: text("id").primaryKey(),
  sermonId: text("sermon_id").notNull().references(() => sermons.id, { onDelete: "restrict" }),
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "restrict" }),
  requestScope: text("request_scope").notNull(),
  requestContractVersion: integer("request_contract_version").notNull(),
  requestKey: text("request_key").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  workflowInstanceId: text("workflow_instance_id").notNull(),
  startInputState: text("start_input_state").notNull(),
  startInputVersion: integer("start_input_version"),
  startSourceId: text("start_source_id"),
  startDocumentId: text("start_document_id"),
  startDocumentSha256: text("start_document_sha256"),
  startConfirmationId: text("start_confirmation_id"),
  startMetadataRevision: integer("start_metadata_revision").notNull(),
  settingsRevision: integer("settings_revision"),
  selectionRevision: integer("selection_revision"),
  status: text("status").notNull(),
  currentStep: text("current_step").notNull(),
  stateVersion: integer("state_version").notNull(),
  eventCount: integer("event_count").notNull(),
  waitKind: text("wait_kind"),
  waitGeneration: integer("wait_generation").notNull(),
  waitInputFingerprint: text("wait_input_fingerprint"),
  errorCode: text("error_code"),
  errorMessageSafe: text("error_message_safe"),
  errorFingerprint: text("error_fingerprint"),
  createdByActorId: text("created_by_actor_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
  requiredEventNo: integer("required_event_no").notNull(),
  requiredEventStateVersion: integer("required_event_state_version").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  foreignKey({ columns: [table.id, table.requestContextId], foreignColumns: [generationRequestContexts.jobId, generationRequestContexts.contextId] }),
  foreignKey({ columns: [table.id, table.evidenceEventNo], foreignColumns: [generationTransitionEvidence.jobId, generationTransitionEvidence.eventNo] }),
  foreignKey({ columns: [table.id, table.activeWaitGeneration], foreignColumns: [generationWaitContexts.jobId, generationWaitContexts.waitGeneration] }),
  check("generation_jobs_v2_links", sql`(request_contract_version=1 and request_context_id is null and evidence_event_no is null and active_wait_generation is null) or (request_contract_version=2 and request_context_id is not null and evidence_event_no is not null and evidence_event_no=event_count and ((wait_kind is null and active_wait_generation is null) or (wait_kind is not null and active_wait_generation is not null and active_wait_generation=wait_generation)))`),

  uniqueIndex("generation_jobs_request_key_uidx").on(table.requestKey),
  uniqueIndex("generation_jobs_workflow_instance_uidx").on(table.workflowInstanceId),
  uniqueIndex("generation_jobs_required_event_uidx").on(table.id, table.requiredEventNo, table.requiredEventStateVersion),
  uniqueIndex("generation_jobs_one_active_quiz_set_uidx")
    .on(table.quizSetId)
    .where(sql`${table.status} in ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review') and not (${table.requestScope}='full' and ${table.status}='running' and ${table.currentStep}='content_review')`),
  foreignKey({ name: "generation_jobs_required_event_fk", columns: [table.id, table.requiredEventNo, table.requiredEventStateVersion], foreignColumns: [generationJobEvents.generationJobId, generationJobEvents.eventNo, generationJobEvents.jobStateVersion] }).onDelete("restrict"),
  foreignKey({ name: "generation_jobs_start_source_fk", columns: [table.sermonId, table.startSourceId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }).onDelete("restrict"),
  foreignKey({ name: "generation_jobs_start_document_fk", columns: [table.sermonId, table.startDocumentId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }).onDelete("restrict"),
  foreignKey({ name: "generation_jobs_start_confirmation_fk", columns: [table.sermonId, table.startConfirmationId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }).onDelete("restrict"),
  check("generation_jobs_id_check", sql`length(id) between 1 and 128`),
  check("generation_jobs_scope_check", sql`request_scope in ('full','transcript_correction','intent','summary','child','adult','single_entry','final_audit')`),
  check("generation_jobs_contract_check", sql`request_contract_version in (1,2)`),
  check("generation_jobs_request_key_check", sql`length(request_key) between 1 and 128`),
  check("generation_jobs_request_fingerprint_check", sql`length(request_fingerprint) = 64 and request_fingerprint not glob '*[^0-9a-f]*'`),
  check("generation_jobs_workflow_instance_check", sql`length(workflow_instance_id) between 1 and 128`),
  check("generation_jobs_input_state_check", sql`(start_input_state = 'absent' and start_input_version is null and start_source_id is null and start_document_id is null and start_document_sha256 is null and start_confirmation_id is null) or (start_input_state = 'present' and typeof(start_input_version) = 'integer' and start_input_version between 1 and 9007199254740991 and start_source_id is not null and start_document_id is not null and length(start_document_sha256) = 64 and start_document_sha256 not glob '*[^0-9a-f]*')`),
  check("generation_jobs_metadata_revision_check", sql`typeof(start_metadata_revision) = 'integer' and start_metadata_revision between 1 and 9007199254740991`),
  check("generation_jobs_optional_revision_check", sql`(settings_revision is null or (typeof(settings_revision) = 'integer' and settings_revision between 1 and 9007199254740991)) and (selection_revision is null or (typeof(selection_revision) = 'integer' and selection_revision between 1 and 9007199254740991))`),
  check("generation_jobs_status_check", sql`status in ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review','review_ready','needs_revision','stale','failed')`),
  check("generation_jobs_current_step_check", sql`length(current_step) between 1 and 128`),
  check("generation_jobs_counter_check", sql`typeof(state_version) = 'integer' and state_version between 0 and 9007199254740991 and typeof(event_count) = 'integer' and event_count between 1 and 9007199254740991 and required_event_no = event_count and required_event_state_version = state_version`),
  check("generation_jobs_wait_check", sql`typeof(wait_generation) = 'integer' and wait_generation between 0 and 9007199254740991 and ((status = 'awaiting_transcript_review' and wait_kind = 'transcript_review' and wait_generation >= 1 and length(wait_input_fingerprint) = 64 and wait_input_fingerprint not glob '*[^0-9a-f]*') or (status = 'awaiting_intent_review' and wait_kind = 'intent_review' and wait_generation >= 1 and length(wait_input_fingerprint) = 64 and wait_input_fingerprint not glob '*[^0-9a-f]*') or (status not in ('awaiting_transcript_review','awaiting_intent_review') and wait_kind is null and wait_input_fingerprint is null))`),
  check("generation_jobs_error_check", sql`(error_code is null and error_message_safe is null and error_fingerprint is null) or (length(error_code) between 1 and 64 and error_code not glob '*[^A-Z0-9_]*' and error_message_safe = error_code and length(error_fingerprint) = 64 and error_fingerprint not glob '*[^0-9a-f]*')`),
  check("generation_jobs_actor_check", sql`length(created_by_actor_id) = 64 and created_by_actor_id not glob '*[^0-9a-f]*'`),
  check("generation_jobs_time_check", sql`updated_at >= created_at and (completed_at is null or completed_at >= created_at)`),
]);

export const generationJobEvents = sqliteTable("generation_job_events", {
  generationJobId: text("generation_job_id").notNull().references(() => generationJobs.id, { onDelete: "restrict" }),
  eventNo: integer("event_no").notNull(),
  jobStateVersion: integer("job_state_version").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  stepKey: text("step_key"),
  level: text("level").notNull(),
  eventCode: text("event_code").notNull(),
  messageSafe: text("message_safe").notNull(),
  metadataJsonSafe: text("metadata_json_safe"),
  elapsedMs: integer("elapsed_ms"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.generationJobId, table.eventNo] }),
  uniqueIndex("generation_job_events_required_uidx").on(table.generationJobId, table.eventNo, table.jobStateVersion),
  uniqueIndex("generation_job_events_state_uidx").on(table.generationJobId, table.jobStateVersion),
  check("generation_job_events_number_check", sql`typeof(event_no) = 'integer' and event_no between 1 and 9007199254740991 and typeof(job_state_version) = 'integer' and job_state_version between 0 and 9007199254740991 and typeof(attempt_number) = 'integer' and attempt_number between 1 and 9007199254740991`),
  check("generation_job_events_step_key_check", sql`step_key is null or length(step_key) between 1 and 128`),
  check("generation_job_events_level_check", sql`level in ('info','warning','error')`),
  check("generation_job_events_code_check", sql`event_code in ('job_created','dispatch_acknowledged','state_changed','step_succeeded','job_stale','job_failed','received','step_rejected','step_stale','step_uncertain','stage_completed','wait_entered','review_ready','needs_revision') and message_safe = event_code`),
  check("generation_job_events_metadata_check", sql`metadata_json_safe is null or (length(metadata_json_safe) between 2 and 2048 and json_valid(metadata_json_safe) and json_type(metadata_json_safe) = 'object')`),
  check("generation_job_events_elapsed_check", sql`elapsed_ms is null or (typeof(elapsed_ms) = 'integer' and elapsed_ms between 0 and 86400000)`),
]);

export const generationStepReceipts = sqliteTable("generation_step_receipts", {
  contextId: text("context_id"),
  outcomeAttempt: integer("outcome_attempt"),
  generationJobId: text("generation_job_id").notNull().references(() => generationJobs.id, { onDelete: "restrict" }),
  stepKey: text("step_key").notNull(),
  task: text("task").notNull(),
  effectClass: text("effect_class").notNull(),
  inputContractVersion: integer("input_contract_version").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  inputVersion: integer("input_version"),
  sourceId: text("source_id"),
  documentId: text("document_id"),
  documentSha256: text("document_sha256"),
  confirmationId: text("confirmation_id"),
  metadataRevision: integer("metadata_revision"),
  bindingId: text("binding_id"),
  ticketId: text("ticket_id"),
  state: text("state").notNull(),
  attemptCount: integer("attempt_count").notNull(),
  claimToken: text("claim_token"),
  leaseExpiresAt: text("lease_expires_at"),
  providerRequestIdOpaque: text("provider_request_id_opaque"),
  resultKind: text("result_kind"),
  resultId: text("result_id"),
  resultVersion: integer("result_version"),
  resultFingerprint: text("result_fingerprint"),
  errorCode: text("error_code"),
  errorMessageSafe: text("error_message_safe"),
  errorFingerprint: text("error_fingerprint"),
  startedAt: text("started_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
}, (table): SQLiteTableExtraConfigValue[] => [
  foreignKey({ columns: [table.generationJobId, table.stepKey, table.contextId], foreignColumns: [generationStepContexts.jobId, generationStepContexts.stepKey, generationStepContexts.contextId] }),
  foreignKey({ columns: [table.generationJobId, table.stepKey, table.outcomeAttempt], foreignColumns: [generationStepOutcomes.jobId, generationStepOutcomes.stepKey, generationStepOutcomes.attempt] }),
  uniqueIndex("generation_receipts_one_open_job").on(table.generationJobId).where(sql`state in ('claimed','effect_started','uncertain')`),

  primaryKey({ columns: [table.generationJobId, table.stepKey] }),
  check("generation_step_receipts_step_key_check", sql`length(step_key) between 1 and 128`),
  check("generation_step_receipts_task_check", sql`task in ('fetch_transcript','correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','place_grid','validate','final_audit')`),
  check("generation_step_receipts_effect_check", sql`effect_class in ('pure','source_network','ai_provider','domain_write')`),
  check("generation_step_receipts_input_check", sql`input_contract_version in (1,2) and length(input_fingerprint) = 64 and input_fingerprint not glob '*[^0-9a-f]*'`),
  check("generation_step_receipts_input_tuple_check", sql`(input_version is null and source_id is null and document_id is null and document_sha256 is null and confirmation_id is null) or (typeof(input_version) = 'integer' and input_version between 1 and 9007199254740991 and source_id is not null and document_id is not null and length(document_sha256) = 64 and document_sha256 not glob '*[^0-9a-f]*')`),
  check("generation_step_receipts_optional_revision_check", sql`metadata_revision is null or (typeof(metadata_revision) = 'integer' and metadata_revision between 1 and 9007199254740991)`),
  check("generation_step_receipts_binding_check", sql`(binding_id is null or length(binding_id) between 1 and 128) and (ticket_id is null or length(ticket_id) between 1 and 128)`),
  check("generation_step_receipts_state_check", sql`state in ('claimed','effect_started','succeeded','retryable_failed','uncertain','terminal_failed','stale')`),
  check("generation_step_receipts_attempt_check", sql`typeof(attempt_count) = 'integer' and attempt_count between 1 and 9007199254740991`),
  check("generation_step_receipts_claim_check", sql`(state in ('claimed','effect_started') and claim_token is not null and length(claim_token) between 1 and 128 and lease_expires_at is not null) or (state not in ('claimed','effect_started') and claim_token is null and lease_expires_at is null)`),
  check("generation_step_receipts_provider_check", sql`provider_request_id_opaque is null or (length(provider_request_id_opaque) = 64 and provider_request_id_opaque not glob '*[^0-9a-f]*')`),
  check("generation_step_receipts_result_check", sql`(state = 'succeeded' and result_kind is not null and length(result_kind) between 1 and 64 and result_id is not null and length(result_id) between 1 and 128 and typeof(result_version) = 'integer' and result_version between 1 and 9007199254740991 and length(result_fingerprint) = 64 and result_fingerprint not glob '*[^0-9a-f]*' and completed_at is not null) or (state <> 'succeeded' and result_kind is null and result_id is null and result_version is null and result_fingerprint is null)`),
  check("generation_step_receipts_error_check", sql`(error_code is null and error_message_safe is null and error_fingerprint is null) or (length(error_code) between 1 and 64 and error_code not glob '*[^A-Z0-9_]*' and error_message_safe = error_code and length(error_fingerprint) = 64 and error_fingerprint not glob '*[^0-9a-f]*')`),
  check("generation_step_receipts_time_check", sql`updated_at >= started_at and (completed_at is null or completed_at >= started_at)`),
]);

export const generationJobDispatches = sqliteTable("generation_job_dispatches", {
  contextId: text("context_id"),
  commandOrdinal: integer("command_ordinal"),
  requiredAttempt: integer("required_attempt"),
  receiverDispatchId: text("receiver_dispatch_id"),
  id: text("id").primaryKey(),
  generationJobId: text("generation_job_id").notNull().references(() => generationJobs.id, { onDelete: "restrict" }),
  dispatchNo: integer("dispatch_no").notNull(),
  kind: text("kind").notNull(),
  dispatchKey: text("dispatch_key").notNull(),
  workflowInstanceId: text("workflow_instance_id").notNull(),
  jobStateVersion: integer("job_state_version").notNull(),
  waitGeneration: integer("wait_generation"),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  state: text("state").notNull(),
  attemptCount: integer("attempt_count").notNull(),
  claimToken: text("claim_token"),
  leaseExpiresAt: text("lease_expires_at"),
  errorCode: text("error_code"),
  errorMessageSafe: text("error_message_safe"),
  errorFingerprint: text("error_fingerprint"),
  createdAt: text("created_at").notNull(),
  lastAttemptedAt: text("last_attempted_at"),
  acknowledgedAt: text("acknowledged_at"),
}, (table): SQLiteTableExtraConfigValue[] => [
  foreignKey({ columns: [table.contextId], foreignColumns: [generationContexts.id] }),
  foreignKey({ columns: [table.generationJobId, table.commandOrdinal], foreignColumns: [generationControlCommands.jobId, generationControlCommands.ordinal] }),
  foreignKey({ columns: [table.id, table.requiredAttempt], foreignColumns: [generationDispatchAttempts.dispatchId, generationDispatchAttempts.attempt] }),
  foreignKey({ columns: [table.receiverDispatchId], foreignColumns: [generationDispatchReceipts.dispatchId] }),

  uniqueIndex("generation_job_dispatches_key_uidx").on(table.dispatchKey),
  uniqueIndex("generation_job_dispatches_job_no_uidx").on(table.generationJobId, table.dispatchNo),
  check("generation_job_dispatches_id_check", sql`length(id) between 1 and 128`),
  check("generation_job_dispatches_number_check", sql`typeof(dispatch_no) = 'integer' and dispatch_no between 1 and 9007199254740991 and typeof(job_state_version) = 'integer' and job_state_version between 0 and 9007199254740991`),
  check("generation_job_dispatches_kind_check", sql`(kind = 'start' and dispatch_no = 1 and wait_generation is null) or (kind in ('resume_transcript_review','resume_intent_review','correction') and typeof(wait_generation) = 'integer' and wait_generation between 1 and 9007199254740991)`),
  check("generation_job_dispatches_key_check", sql`length(dispatch_key) between 1 and 128`),
  check("generation_job_dispatches_workflow_check", sql`length(workflow_instance_id) between 1 and 128`),
  check("generation_job_dispatches_payload_check", sql`length(payload_fingerprint) = 64 and payload_fingerprint not glob '*[^0-9a-f]*'`),
  check("generation_job_dispatches_state_check", sql`state in ('pending','claimed','acknowledged','retryable_failed','uncertain','terminal_failed','stale')`),
  check("generation_job_dispatches_attempt_check", sql`typeof(attempt_count) = 'integer' and attempt_count between 0 and 9007199254740991`),
  check("generation_job_dispatches_claim_check", sql`(state = 'claimed' and claim_token is not null and length(claim_token) between 1 and 128 and lease_expires_at is not null) or (state <> 'claimed' and claim_token is null and lease_expires_at is null)`),
  check("generation_job_dispatches_ack_check", sql`(state = 'acknowledged' and acknowledged_at is not null) or (state <> 'acknowledged' and acknowledged_at is null)`),
  check("generation_job_dispatches_error_check", sql`(error_code is null and error_message_safe is null and error_fingerprint is null) or (length(error_code) between 1 and 64 and error_code not glob '*[^A-Z0-9_]*' and error_message_safe = error_code and length(error_fingerprint) = 64 and error_fingerprint not glob '*[^0-9a-f]*')`),
  check("generation_job_dispatches_attempt_time_check", sql`last_attempted_at is null or last_attempted_at >= created_at`),
]);

// Private AI/domain result envelopes. Cross-row payload seals, current-input
// guards, task-specific result links, and immutable transition guards are
// reviewed additions in migration 0011.
export const sermonContentEvents = sqliteTable("sermon_content_events", {
  sermonId: text("sermon_id").notNull().references(() => sermons.id, { onDelete: "restrict" }),
  eventId: text("event_id").notNull(),
  contentSequence: integer("content_sequence").notNull(),
  aggregateVersion: integer("aggregate_version").notNull(),
  origin: text("origin").notNull(),
  kind: text("kind").notNull(),
  difficulty: text("difficulty"),
  generationJobId: text("generation_job_id"),
  stepKey: text("step_key"),
  inputVersion: integer("input_version").notNull(),
  sourceId: text("source_id").notNull(),
  documentId: text("document_id").notNull(),
  documentSha256: text("document_sha256").notNull(),
  confirmationId: text("confirmation_id"),
  baseAnalysisEventId: text("base_analysis_event_id"),
  analysisEventId: text("analysis_event_id"),
  intentConfirmationEventId: text("intent_confirmation_event_id"),
  payloadSha256: text("payload_sha256").notNull(),
  payloadByteLength: integer("payload_byte_length").notNull(),
  payloadChunkCount: integer("payload_chunk_count").notNull(),
  state: text("state").notNull(),
  requiredState: text("required_state").notNull().default("sealed"),
  createdByActorId: text("created_by_actor_id"),
  createdAt: text("created_at").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.sermonId, table.eventId] }),
  uniqueIndex("sermon_content_events_sequence_uidx").on(table.sermonId, table.contentSequence),
  uniqueIndex("sermon_content_events_seal_uidx").on(table.sermonId, table.eventId, table.state),
  uniqueIndex("sermon_content_events_job_step_uidx").on(table.generationJobId, table.stepKey),
  foreignKey({ columns: [table.generationJobId, table.stepKey], foreignColumns: [generationStepReceipts.generationJobId, generationStepReceipts.stepKey] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.sourceId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.documentId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.confirmationId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.baseAnalysisEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.analysisEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.intentConfirmationEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ name: "sermon_content_events_required_seal_fk", columns: [table.sermonId, table.eventId, table.requiredState], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId, sermonContentEvents.state] }).onDelete("restrict"),
  check("sermon_content_events_id_check", sql`length(event_id) between 1 and 128`),
  check("sermon_content_events_counter_check", sql`typeof(content_sequence) = 'integer' and content_sequence between 1 and 9007199254740991 and typeof(aggregate_version) = 'integer' and aggregate_version between 2 and 9007199254740991`),
  check("sermon_content_events_origin_check", sql`origin in ('ai','human')`),
  check("sermon_content_events_kind_check", sql`kind in ('intent_analysis','intent_critique','intent_confirmation','summary','candidate')`),
  check("sermon_content_events_difficulty_check", sql`(kind = 'candidate' and difficulty in ('child','adult')) or (kind <> 'candidate' and difficulty is null)`),
  check("sermon_content_events_generation_check", sql`(origin = 'ai' and generation_job_id is not null and step_key is not null) or (origin = 'human' and generation_job_id is null and step_key is null)`),
  check("sermon_content_events_input_check", sql`typeof(input_version) = 'integer' and input_version between 1 and 9007199254740991 and length(document_sha256) = 64 and document_sha256 not glob '*[^0-9a-f]*'`),
  check("sermon_content_events_payload_check", sql`length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*' and typeof(payload_byte_length) = 'integer' and payload_byte_length between 1 and 67108864 and typeof(payload_chunk_count) = 'integer' and payload_chunk_count between 1 and 4096`),
  check("sermon_content_events_state_check", sql`state in ('assembling','sealed') and required_state = 'sealed'`),
  check("sermon_content_events_actor_check", sql`created_by_actor_id is null or (length(created_by_actor_id) = 64 and created_by_actor_id not glob '*[^0-9a-f]*')`),
]);

export const sermonContentPayloads = sqliteTable("sermon_content_payloads", {
  sermonId: text("sermon_id").notNull(),
  eventId: text("event_id").notNull(),
  codec: text("codec").notNull(),
  chunkBytes: integer("chunk_bytes").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  byteLength: integer("byte_length").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  verified: integer("verified").notNull(),
}, (table) => [
  primaryKey({ columns: [table.sermonId, table.eventId] }),
  foreignKey({ columns: [table.sermonId, table.eventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  check("sermon_content_payloads_codec_check", sql`codec = 'content-event-json-utf8-v1' and chunk_bytes = 65536`),
  check("sermon_content_payloads_size_check", sql`typeof(chunk_count) = 'integer' and chunk_count between 1 and 4096 and typeof(byte_length) = 'integer' and byte_length between 1 and 67108864`),
  check("sermon_content_payloads_hash_check", sql`length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*'`),
  check("sermon_content_payloads_verified_check", sql`verified in (0,1)`),
]);

export const sermonContentChunks = sqliteTable("sermon_content_chunks", {
  sermonId: text("sermon_id").notNull(),
  eventId: text("event_id").notNull(),
  position: integer("position").notNull(),
  byteLength: integer("byte_length").notNull(),
  chunkSha256: text("chunk_sha256").notNull(),
  body: blob("body").notNull(),
  verified: integer("verified").notNull(),
}, (table) => [
  primaryKey({ columns: [table.sermonId, table.eventId, table.position] }),
  foreignKey({ columns: [table.sermonId, table.eventId], foreignColumns: [sermonContentPayloads.sermonId, sermonContentPayloads.eventId] }).onDelete("restrict"),
  check("sermon_content_chunks_position_check", sql`typeof(position) = 'integer' and position between 0 and 4095`),
  check("sermon_content_chunks_size_check", sql`typeof(byte_length) = 'integer' and byte_length between 1 and 65536 and length(body) = byte_length`),
  check("sermon_content_chunks_hash_check", sql`length(chunk_sha256) = 64 and chunk_sha256 not glob '*[^0-9a-f]*'`),
  check("sermon_content_chunks_verified_check", sql`verified = 1`),
]);

export const sermonContentHeads = sqliteTable("sermon_content_heads", {
  sermonId: text("sermon_id").primaryKey().notNull().references(() => sermons.id, { onDelete: "restrict" }),
  eventCount: integer("event_count").notNull(),
  lastEventId: text("last_event_id").notNull(),
  requiredEventCount: integer("required_event_count").notNull(),
  requiredEventId: text("required_event_id").notNull(),
}, (table) => [
  foreignKey({ columns: [table.sermonId, table.eventCount, table.lastEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.contentSequence, sermonContentEvents.eventId] }).onDelete("restrict"),
  check("sermon_content_heads_counter_check", sql`typeof(event_count) = 'integer' and event_count between 1 and 9007199254740991 and required_event_count = event_count and required_event_id = last_event_id`),
]);

// Human review commands remain append-only content events. These rows provide
// the operation-specific, same-sermon references that the shared event envelope
// cannot express on its own. Cross-row semantics are reviewed in migration 0012.
export const sermonContentHumanEvents = sqliteTable("sermon_content_human_events", {
  sermonId: text("sermon_id").notNull(),
  eventId: text("event_id").notNull(),
  operation: text("operation").notNull(),
  commandKey: text("command_key").notNull(),
  baseSnapshotEventId: text("base_snapshot_event_id"),
  targetSnapshotEventId: text("target_snapshot_event_id"),
  restoreSourceEventId: text("restore_source_event_id"),
  critiqueEventId: text("critique_event_id"),
  intentConfirmationEventId: text("intent_confirmation_event_id"),
  expectedCurrentReviewEventId: text("expected_current_review_event_id"),
  createdByActorId: text("created_by_actor_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.sermonId, table.eventId] }),
  uniqueIndex("sermon_content_human_events_command_uidx").on(table.commandKey),
  foreignKey({ columns: [table.sermonId, table.eventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.baseSnapshotEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.targetSnapshotEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.restoreSourceEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.critiqueEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.intentConfirmationEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.expectedCurrentReviewEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  check("sermon_content_human_events_operation_check", sql`operation in ('intent_edit','intent_select','intent_confirm','summary_edit','summary_select','summary_restore','summary_review','candidate_edit','candidate_set_status','candidate_select','candidate_restore','candidate_review')`),
  check("sermon_content_human_events_command_check", sql`length(command_key) between 1 and 128`),
  check("sermon_content_human_events_actor_check", sql`length(created_by_actor_id) = 64 and created_by_actor_id not glob '*[^0-9a-f]*'`),
]);

/** Private, append-only human assessments of verified content snapshots. */
export const sermonContentQualityReviews = sqliteTable("sermon_content_quality_reviews", {
  sermonId: text("sermon_id").notNull(),
  snapshotEventId: text("snapshot_event_id").notNull(),
  revision: integer("revision").notNull(),
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "restrict" }),
  requestKey: text("request_key").notNull(),
  requestSha256: text("request_sha256").notNull(),
  scope: text("scope").notNull(),
  status: text("status").notNull(),
  criteriaJson: text("criteria_json").notNull(),
  adminNote: text("admin_note"),
  editedRevisionId: text("edited_revision_id"),
  actorDigest: text("actor_digest").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [
  primaryKey({ columns: [table.sermonId, table.snapshotEventId, table.revision] }),
  uniqueIndex("sermon_content_quality_request_uidx").on(table.requestKey),
  foreignKey({ columns: [table.sermonId, table.snapshotEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.editedRevisionId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  check("sermon_content_quality_revision_check", sql`typeof(${table.revision})='integer' and ${table.revision}>0`),
  check("sermon_content_quality_scope_check", sql`${table.scope} in ('intent','summary','child','adult')`),
  check("sermon_content_quality_status_check", sql`${table.status} in ('good','edited_then_use','regenerate')`),
  check("sermon_content_quality_criteria_check", sql`json_valid(${table.criteriaJson}) and json_type(${table.criteriaJson})='object'`),
  check("sermon_content_quality_note_check", sql`${table.adminNote} is null or length(${table.adminNote}) between 1 and 2000`),
  check("sermon_content_quality_request_hash_check", sql`length(${table.requestSha256})=64 and ${table.requestSha256} not glob '*[^0-9a-f]*'`),
  check("sermon_content_quality_actor_check", sql`length(${table.actorDigest})=64 and ${table.actorDigest} not glob '*[^0-9a-f]*'`),
]);

// Mutable bounded projection of the append-only content history. Every stored
// reference stays in the same sermon; migration 0012 checks operation-specific
// transitions and keeps its count aligned with sermon_content_heads.
export const sermonContentCurrent = sqliteTable("sermon_content_current", {
  sermonId: text("sermon_id").primaryKey().notNull().references(() => sermons.id, { onDelete: "restrict" }),
  eventCount: integer("event_count").notNull(),
  lastEventId: text("last_event_id").notNull(),
  selectedAnalysisEventId: text("selected_analysis_event_id"),
  intentCritiqueEventId: text("intent_critique_event_id"),
  intentConfirmationEventId: text("intent_confirmation_event_id"),
  summarySnapshotEventId: text("summary_snapshot_event_id"),
  summaryReviewEventId: text("summary_review_event_id"),
  childPoolEventId: text("child_pool_event_id"),
  childReviewEventId: text("child_review_event_id"),
  adultPoolEventId: text("adult_pool_event_id"),
  adultReviewEventId: text("adult_review_event_id"),
  requiredEventCount: integer("required_event_count").notNull(),
  requiredEventId: text("required_event_id").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  foreignKey({ columns: [table.sermonId, table.eventCount, table.lastEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.contentSequence, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.selectedAnalysisEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.intentCritiqueEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.intentConfirmationEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.summarySnapshotEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.summaryReviewEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.childPoolEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.childReviewEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.adultPoolEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.adultReviewEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  check("sermon_content_current_counter_check", sql`typeof(event_count) = 'integer' and event_count between 1 and 9007199254740991 and required_event_count = event_count and required_event_id = last_event_id`),
]);

export const finalCheckTickets = sqliteTable("final_check_tickets", {
  id: text("id").primaryKey(),
  sermonId: text("sermon_id").notNull().references(() => sermons.id, { onDelete: "restrict" }),
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "restrict" }),
  aggregateVersion: integer("aggregate_version").notNull(),
  metadataRevision: integer("metadata_revision").notNull(),
  inputVersion: integer("input_version").notNull(),
  contentEventCount: integer("content_event_count").notNull(),
  summaryReviewId: text("summary_review_id").notNull(),
  childReviewId: text("child_review_id").notNull(),
  adultReviewId: text("adult_review_id").notNull(),
  childPlacementTicketId: text("child_placement_ticket_id").notNull(),
  adultPlacementTicketId: text("adult_placement_ticket_id").notNull(),
  ticketFingerprint: text("ticket_fingerprint").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  payloadByteLength: integer("payload_byte_length").notNull(),
  payloadChunkCount: integer("payload_chunk_count").notNull(),
  state: text("state").notNull(),
  requiredState: text("required_state").notNull().default("sealed"),
  createdAt: text("created_at").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  uniqueIndex("final_check_tickets_fingerprint_uidx").on(table.ticketFingerprint),
  uniqueIndex("final_check_tickets_seal_uidx").on(table.id, table.state),
  foreignKey({ name: "final_check_tickets_required_seal_fk", columns: [table.id, table.requiredState], foreignColumns: [finalCheckTickets.id, finalCheckTickets.state] }).onDelete("restrict"),
  check("final_check_tickets_id_check", sql`length(id) between 1 and 128`),
  check("final_check_tickets_version_check", sql`typeof(aggregate_version) = 'integer' and aggregate_version between 1 and 9007199254740991 and typeof(metadata_revision) = 'integer' and metadata_revision between 1 and 9007199254740991 and typeof(input_version) = 'integer' and input_version between 1 and 9007199254740991 and typeof(content_event_count) = 'integer' and content_event_count between 0 and 9007199254740991 and aggregate_version = input_version + content_event_count`),
  check("final_check_tickets_reference_check", sql`length(summary_review_id) between 1 and 128 and length(child_review_id) between 1 and 128 and length(adult_review_id) between 1 and 128 and length(child_placement_ticket_id) between 1 and 128 and length(adult_placement_ticket_id) between 1 and 128`),
  check("final_check_tickets_fingerprint_check", sql`length(ticket_fingerprint) = 64 and ticket_fingerprint not glob '*[^0-9a-f]*'`),
  check("final_check_tickets_payload_check", sql`length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*' and typeof(payload_byte_length) = 'integer' and payload_byte_length between 1 and 67108864 and typeof(payload_chunk_count) = 'integer' and payload_chunk_count between 1 and 4096`),
  check("final_check_tickets_state_check", sql`state in ('assembling','sealed') and required_state = 'sealed'`),
]);

// Exact current human-review inputs for one sealed final ticket. The legacy
// review/placement text columns remain compatibility projections only.
export const finalCheckTicketInputs = sqliteTable("final_check_ticket_inputs", {
  ticketId: text("ticket_id").primaryKey().notNull().references(() => finalCheckTickets.id, { onDelete: "restrict" }),
  sermonId: text("sermon_id").notNull().references(() => sermons.id, { onDelete: "restrict" }),
  intentConfirmationEventId: text("intent_confirmation_event_id").notNull(),
  summarySnapshotEventId: text("summary_snapshot_event_id").notNull(),
  summaryReviewEventId: text("summary_review_event_id").notNull(),
  childPoolEventId: text("child_pool_event_id").notNull(),
  childReviewEventId: text("child_review_event_id").notNull(),
  adultPoolEventId: text("adult_pool_event_id").notNull(),
  adultReviewEventId: text("adult_review_event_id").notNull(),
  childPlacementTicketFingerprint: text("child_placement_ticket_fingerprint").notNull(),
  adultPlacementTicketFingerprint: text("adult_placement_ticket_fingerprint").notNull(),
  childSelectionIndex: integer("child_selection_index").notNull(),
  adultSelectionIndex: integer("adult_selection_index").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  foreignKey({ columns: [table.sermonId, table.intentConfirmationEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.summarySnapshotEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.summaryReviewEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.childPoolEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.childReviewEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.adultPoolEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.adultReviewEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  check("final_check_ticket_inputs_fingerprint_check", sql`length(child_placement_ticket_fingerprint) = 64 and child_placement_ticket_fingerprint not glob '*[^0-9a-f]*' and length(adult_placement_ticket_fingerprint) = 64 and adult_placement_ticket_fingerprint not glob '*[^0-9a-f]*'`),
  check("final_check_ticket_inputs_selection_check", sql`typeof(child_selection_index) = 'integer' and child_selection_index between 0 and 2 and typeof(adult_selection_index) = 'integer' and adult_selection_index between 0 and 2`),
]);

export const finalCheckTicketChunks = sqliteTable("final_check_ticket_chunks", {
  ticketId: text("ticket_id").notNull().references(() => finalCheckTickets.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  byteLength: integer("byte_length").notNull(),
  chunkSha256: text("chunk_sha256").notNull(),
  body: blob("body").notNull(),
  verified: integer("verified").notNull(),
}, (table) => [
  primaryKey({ columns: [table.ticketId, table.position] }),
  check("final_check_ticket_chunks_position_check", sql`typeof(position) = 'integer' and position between 0 and 4095`),
  check("final_check_ticket_chunks_size_check", sql`typeof(byte_length) = 'integer' and byte_length between 1 and 65536 and length(body) = byte_length`),
  check("final_check_ticket_chunks_hash_check", sql`length(chunk_sha256) = 64 and chunk_sha256 not glob '*[^0-9a-f]*'`),
  check("final_check_ticket_chunks_verified_check", sql`verified = 1`),
]);

export const aiFinalAuditResults = sqliteTable("ai_final_audit_results", {
  id: text("id").primaryKey(),
  generationJobId: text("generation_job_id").notNull(),
  stepKey: text("step_key").notNull(),
  finalCheckTicketId: text("final_check_ticket_id").notNull().references(() => finalCheckTickets.id, { onDelete: "restrict" }),
  resultVersion: integer("result_version").notNull(),
  resultFingerprint: text("result_fingerprint").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  payloadByteLength: integer("payload_byte_length").notNull(),
  payloadChunkCount: integer("payload_chunk_count").notNull(),
  advisoryMode: text("advisory_mode").notNull(),
  publishDecision: text("publish_decision").notNull(),
  state: text("state").notNull(),
  requiredState: text("required_state").notNull().default("sealed"),
  createdAt: text("created_at").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  uniqueIndex("ai_final_audit_results_job_step_uidx").on(table.generationJobId, table.stepKey),
  uniqueIndex("ai_final_audit_results_seal_uidx").on(table.id, table.state),
  foreignKey({ columns: [table.generationJobId, table.stepKey], foreignColumns: [generationStepReceipts.generationJobId, generationStepReceipts.stepKey] }).onDelete("restrict"),
  foreignKey({ name: "ai_final_audit_results_required_seal_fk", columns: [table.id, table.requiredState], foreignColumns: [aiFinalAuditResults.id, aiFinalAuditResults.state] }).onDelete("restrict"),
  check("ai_final_audit_results_id_check", sql`length(id) between 1 and 128`),
  check("ai_final_audit_results_version_check", sql`result_version = 1`),
  check("ai_final_audit_results_fingerprint_check", sql`length(result_fingerprint) = 64 and result_fingerprint not glob '*[^0-9a-f]*'`),
  check("ai_final_audit_results_payload_check", sql`length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*' and typeof(payload_byte_length) = 'integer' and payload_byte_length between 1 and 67108864 and typeof(payload_chunk_count) = 'integer' and payload_chunk_count between 1 and 4096`),
  check("ai_final_audit_results_mode_check", sql`advisory_mode = 'advisory_only' and publish_decision = 'not_evaluated'`),
  check("ai_final_audit_results_state_check", sql`state in ('assembling','sealed') and required_state = 'sealed'`),
]);

export const aiFinalAuditChunks = sqliteTable("ai_final_audit_chunks", {
  auditResultId: text("audit_result_id").notNull().references(() => aiFinalAuditResults.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  byteLength: integer("byte_length").notNull(),
  chunkSha256: text("chunk_sha256").notNull(),
  body: blob("body").notNull(),
  verified: integer("verified").notNull(),
}, (table) => [
  primaryKey({ columns: [table.auditResultId, table.position] }),
  check("ai_final_audit_chunks_position_check", sql`typeof(position) = 'integer' and position between 0 and 4095`),
  check("ai_final_audit_chunks_size_check", sql`typeof(byte_length) = 'integer' and byte_length between 1 and 65536 and length(body) = byte_length`),
  check("ai_final_audit_chunks_hash_check", sql`length(chunk_sha256) = 64 and chunk_sha256 not glob '*[^0-9a-f]*'`),
  check("ai_final_audit_chunks_verified_check", sql`verified = 1`),
]);

export const aiProviderCalls = sqliteTable("ai_provider_calls", {
  settlementCallId: text("settlement_call_id"),
  id: text("id").primaryKey(),
  generationJobId: text("generation_job_id").notNull(),
  stepKey: text("step_key").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "restrict" }),
  sermonId: text("sermon_id").notNull().references(() => sermons.id, { onDelete: "restrict" }),
  task: text("task").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  reasoningEffort: text("reasoning_effort"),
  state: text("state").notNull(),
  providerRequestIdOpaque: text("provider_request_id_opaque"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
}, (table): SQLiteTableExtraConfigValue[] => [
  foreignKey({ columns: [table.settlementCallId], foreignColumns: [aiUsageSettlements.callId] }),

  uniqueIndex("ai_provider_calls_job_step_attempt_uidx").on(table.generationJobId, table.stepKey, table.attemptNumber),
  foreignKey({ columns: [table.generationJobId, table.stepKey], foreignColumns: [generationStepReceipts.generationJobId, generationStepReceipts.stepKey] }).onDelete("restrict"),
  check("ai_provider_calls_id_check", sql`length(id) between 1 and 128`),
  check("ai_provider_calls_attempt_check", sql`typeof(attempt_number) = 'integer' and attempt_number between 1 and 9007199254740991`),
  check("ai_provider_calls_task_check", sql`task in ('correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','final_audit')`),
  check("ai_provider_calls_input_check", sql`length(input_fingerprint) = 64 and input_fingerprint not glob '*[^0-9a-f]*'`),
  check("ai_provider_calls_provider_check", sql`length(provider) between 1 and 64 and length(model) between 1 and 128 and (reasoning_effort is null or length(reasoning_effort) between 1 and 32)`),
  check("ai_provider_calls_state_check", sql`state in ('effect_started','completed','uncertain')`),
  check("ai_provider_calls_request_check", sql`provider_request_id_opaque is null or (length(provider_request_id_opaque) = 64 and provider_request_id_opaque not glob '*[^0-9a-f]*')`),
  check("ai_provider_calls_time_check", sql`(state = 'effect_started' and completed_at is null) or (state in ('completed','uncertain') and completed_at is not null and completed_at >= started_at)`),
]);

// Private wire bytes, including malformed/refused responses. Never a public DTO.
export const aiResponseArchives = sqliteTable("ai_response_archives", {
  callId: text("call_id").notNull().references(() => aiProviderCalls.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  state: text("state").notNull(),
  httpStatus: integer("http_status"),
  byteLength: integer("byte_length").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [
  primaryKey({ columns: [table.callId, table.kind] }),
  check("ai_response_archives_kind_check", sql`kind in ('request','response')`),
  check("ai_response_archives_state_check", sql`state in ('assembling','sealed')`),
  check("ai_response_archives_status_check", sql`(kind='request' and http_status is null) or (kind='response' and http_status is not null and http_status between 100 and 599)`),
  check("ai_response_archives_size_check", sql`typeof(byte_length)='integer' and byte_length between 0 and 67108864 and typeof(chunk_count)='integer' and chunk_count=(byte_length+65535)/65536`),
  check("ai_response_archives_hash_check", sql`length(sha256)=64 and sha256 not glob '*[^0-9a-f]*'`),
]);

export const aiResponseArchiveChunks = sqliteTable("ai_response_archive_chunks", {
  callId: text("call_id").notNull(),
  kind: text("kind").notNull(),
  position: integer("position").notNull(),
  body: blob("body").notNull(),
}, table => [
  primaryKey({ columns: [table.callId, table.kind, table.position] }),
  foreignKey({ columns: [table.callId, table.kind], foreignColumns: [aiResponseArchives.callId, aiResponseArchives.kind] }).onDelete("restrict"),
  check("ai_response_archive_chunks_position_check", sql`typeof(position)='integer' and position between 0 and 1023`),
  check("ai_response_archive_chunks_body_check", sql`typeof(body)='blob' and length(body) between 1 and 65536`),
]);

export const aiUsageEvents = sqliteTable("ai_usage_events", {
  id: text("id").primaryKey(),
  providerCallId: text("provider_call_id").notNull().references(() => aiProviderCalls.id, { onDelete: "restrict" }),
  generationJobId: text("generation_job_id").notNull(),
  stepKey: text("step_key").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "restrict" }),
  sermonId: text("sermon_id").notNull().references(() => sermons.id, { onDelete: "restrict" }),
  task: text("task").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens"),
  cachedInputTokens: integer("cached_input_tokens"),
  reasoningTokens: integer("reasoning_tokens"),
  outputTokens: integer("output_tokens"),
  audioInputTokens: integer("audio_input_tokens"),
  audioSeconds: integer("audio_seconds"),
  pricingVersion: text("pricing_version").notNull(),
  estimatedCostMicroUsd: integer("estimated_cost_micro_usd").notNull(),
  usageSource: text("usage_source").notNull(),
  observedAt: text("observed_at").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  uniqueIndex("ai_usage_events_provider_call_uidx").on(table.providerCallId),
  uniqueIndex("ai_usage_events_job_step_attempt_uidx").on(table.generationJobId, table.stepKey, table.attemptNumber),
  foreignKey({ columns: [table.generationJobId, table.stepKey], foreignColumns: [generationStepReceipts.generationJobId, generationStepReceipts.stepKey] }).onDelete("restrict"),
  check("ai_usage_events_id_check", sql`length(id) between 1 and 128`),
  check("ai_usage_events_attempt_check", sql`typeof(attempt_number) = 'integer' and attempt_number between 1 and 9007199254740991`),
  check("ai_usage_events_task_check", sql`task in ('correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','final_audit')`),
  check("ai_usage_events_provider_check", sql`length(provider) between 1 and 64 and length(model) between 1 and 128 and length(pricing_version) between 1 and 128`),
  check("ai_usage_events_numbers_check", sql`(input_tokens is null or (typeof(input_tokens) = 'integer' and input_tokens >= 0)) and (cached_input_tokens is null or (typeof(cached_input_tokens) = 'integer' and cached_input_tokens >= 0)) and (reasoning_tokens is null or (typeof(reasoning_tokens) = 'integer' and reasoning_tokens >= 0)) and (output_tokens is null or (typeof(output_tokens) = 'integer' and output_tokens >= 0)) and (audio_input_tokens is null or (typeof(audio_input_tokens) = 'integer' and audio_input_tokens >= 0)) and (audio_seconds is null or (typeof(audio_seconds) = 'integer' and audio_seconds >= 0)) and typeof(estimated_cost_micro_usd) = 'integer' and estimated_cost_micro_usd >= 0`),
  check("ai_usage_events_report_check", sql`input_tokens is not null or cached_input_tokens is not null or reasoning_tokens is not null or output_tokens is not null or audio_input_tokens is not null or audio_seconds is not null`),
  check("ai_usage_events_source_check", sql`usage_source in ('provider_reported','provider_partial')`),
]);

export const generationStepResultLinks = sqliteTable("generation_step_result_links", {
  generationJobId: text("generation_job_id").notNull(),
  stepKey: text("step_key").notNull(),
  task: text("task").notNull(),
  correctionSermonId: text("correction_sermon_id"),
  correctionEventId: text("correction_event_id"),
  contentSermonId: text("content_sermon_id"),
  contentEventId: text("content_event_id"),
  finalAuditResultId: text("final_audit_result_id").references(() => aiFinalAuditResults.id, { onDelete: "restrict" }),
  usageEventId: text("usage_event_id").notNull().references(() => aiUsageEvents.id, { onDelete: "restrict" }),
  resultKind: text("result_kind").notNull(),
  resultId: text("result_id").notNull(),
  resultVersion: integer("result_version").notNull(),
  resultFingerprint: text("result_fingerprint").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.generationJobId, table.stepKey] }),
  foreignKey({ columns: [table.generationJobId, table.stepKey], foreignColumns: [generationStepReceipts.generationJobId, generationStepReceipts.stepKey] }).onDelete("restrict"),
  foreignKey({ columns: [table.correctionSermonId, table.correctionEventId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }).onDelete("restrict"),
  foreignKey({ columns: [table.contentSermonId, table.contentEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  check("generation_step_result_links_task_check", sql`task in ('correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','final_audit')`),
  check("generation_step_result_links_target_check", sql`((correction_sermon_id is not null and correction_event_id is not null) + (content_sermon_id is not null and content_event_id is not null) + (final_audit_result_id is not null)) = 1`),
  check("generation_step_result_links_reference_check", sql`length(result_kind) between 1 and 64 and length(result_id) between 1 and 128 and typeof(result_version) = 'integer' and result_version between 1 and 9007199254740991 and length(result_fingerprint) = 64 and result_fingerprint not glob '*[^0-9a-f]*'`),
]);

export const foundationSchema = {
  anonymousSessions,
  auditLogs,
  bibleTranslations,
  moderationExceptions,
  moderationActions,
  moderationTerms,
  quizSets,
  publishedQuizContent,
  publishedDisplayCorrections,
  quizEntriesPublic,
  quizSolutions,
  quizVariants,
  reservedNames,
  sermonTranscripts,
  sermonMetadataDrafts,
  sermons,
  siteState,
  submissions,
};

export type BibleTranslationRow = typeof bibleTranslations.$inferSelect;
export type NewBibleTranslationRow = typeof bibleTranslations.$inferInsert;
export type NewSermonRow = typeof sermons.$inferInsert;
export type SermonRow = typeof sermons.$inferSelect;
export type NewAnonymousSessionRow = typeof anonymousSessions.$inferInsert;
export type NewAuditLogRow = typeof auditLogs.$inferInsert;
export type NewModerationActionRow = typeof moderationActions.$inferInsert;
export type NewSubmissionRow = typeof submissions.$inferInsert;
export type NewModerationExceptionRow = typeof moderationExceptions.$inferInsert;
export type NewModerationTermRow = typeof moderationTerms.$inferInsert;
export type NewReservedNameRow = typeof reservedNames.$inferInsert;
export type ModerationExceptionRow = typeof moderationExceptions.$inferSelect;
export type ModerationActionRow = typeof moderationActions.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type ModerationTermRow = typeof moderationTerms.$inferSelect;
export type QuizSolutionRow = typeof quizSolutions.$inferSelect;
export type ReservedNameRow = typeof reservedNames.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;

// P5-44: private lifecycle v2. Migration 0013 adds deferred cycles and guards.
export const generationContexts = sqliteTable("generation_contexts", {
  id: text("id").notNull(),
  jobId: text("job_id").notNull(),
  sermonId: text("sermon_id").notNull(),
  quizSetId: text("quiz_set_id").notNull(),
  kind: text("kind").notNull(),
  contractVersion: integer("contract_version").notNull(),
  validatorVersion: integer("validator_version").notNull(),
  assemblyVersion: integer("assembly_version").notNull(),
  codec: text("codec").notNull(),
  fingerprint: text("fingerprint").notNull(),
  byteLength: integer("byte_length").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  referenceCount: integer("reference_count").notNull(),
  state: text("state").notNull(),
  requiredState: text("required_state").notNull(),
  createdAt: text("created_at").notNull(),
  inputState: text("input_state").notNull(),
  inputVersion: integer("input_version"),
  sourceId: text("source_id"),
  documentId: text("document_id"),
  documentSha256: text("document_sha256"),
  confirmationId: text("confirmation_id"),
  contentCount: integer("content_count").notNull(),
  lastContentEventId: text("last_content_event_id"),
  analysisEventId: text("analysis_event_id"),
  critiqueEventId: text("critique_event_id"),
  intentConfirmationEventId: text("intent_confirmation_event_id"),
  summaryEventId: text("summary_event_id"),
  summaryReviewEventId: text("summary_review_event_id"),
  childEventId: text("child_event_id"),
  childReviewEventId: text("child_review_event_id"),
  adultEventId: text("adult_event_id"),
  adultReviewEventId: text("adult_review_event_id"),
  metadataRevision: integer("metadata_revision").notNull(),
  settingsRevision: integer("settings_revision"),
  selectionRevision: integer("selection_revision"),
  ticketId: text("ticket_id"),
  ticketFingerprint: text("ticket_fingerprint"),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.id] }),
  uniqueIndex("generation_contexts_u0").on(table.id, table.state),
  uniqueIndex("generation_contexts_u1").on(table.jobId, table.id, table.kind),
  foreignKey({ name: "generation_contexts_fk0", columns: [table.jobId], foreignColumns: [generationJobs.id] }),
  foreignKey({ name: "generation_contexts_fk1", columns: [table.sermonId], foreignColumns: [sermons.id] }),
  foreignKey({ name: "generation_contexts_fk2", columns: [table.quizSetId], foreignColumns: [quizSets.id] }),
  foreignKey({ name: "generation_contexts_fk3", columns: [table.id, table.requiredState], foreignColumns: [generationContexts.id, generationContexts.state] }),
  foreignKey({ name: "generation_contexts_fk4", columns: [table.sermonId, table.sourceId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }),
  foreignKey({ name: "generation_contexts_fk5", columns: [table.sermonId, table.documentId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }),
  foreignKey({ name: "generation_contexts_fk6", columns: [table.sermonId, table.confirmationId], foreignColumns: [sermonInputEvents.sermonId, sermonInputEvents.id] }),
  foreignKey({ name: "generation_contexts_fk7", columns: [table.sermonId, table.lastContentEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }),
  foreignKey({ name: "generation_contexts_fk8", columns: [table.sermonId, table.analysisEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }),
  foreignKey({ name: "generation_contexts_fk9", columns: [table.sermonId, table.critiqueEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }),
  foreignKey({ name: "generation_contexts_fk10", columns: [table.sermonId, table.intentConfirmationEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }),
  foreignKey({ name: "generation_contexts_fk11", columns: [table.sermonId, table.summaryEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }),
  foreignKey({ name: "generation_contexts_fk12", columns: [table.sermonId, table.summaryReviewEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }),
  foreignKey({ name: "generation_contexts_fk13", columns: [table.sermonId, table.childEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }),
  foreignKey({ name: "generation_contexts_fk14", columns: [table.sermonId, table.childReviewEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }),
  foreignKey({ name: "generation_contexts_fk15", columns: [table.sermonId, table.adultEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }),
  foreignKey({ name: "generation_contexts_fk16", columns: [table.sermonId, table.adultReviewEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }),
  foreignKey({ name: "generation_contexts_fk17", columns: [table.ticketId], foreignColumns: [finalCheckTickets.id] }),
  check("generation_contexts_c0", sql`kind in ('request','step','wait')`),
  check("generation_contexts_c1", sql`contract_version=2 and validator_version=1 and assembly_version=1 and codec='generation-context-json-utf8-v1'`),
  check("generation_contexts_c2", sql`length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*'`),
  check("generation_contexts_c3", sql`state in ('assembling','sealed') and required_state='sealed'`),
  check("generation_contexts_c4", sql`typeof(byte_length)='integer' and byte_length between 1 and case when kind='wait' then 32768 else 65536 end and typeof(chunk_count)='integer' and chunk_count=(byte_length+16383)/16384`),
  check("generation_contexts_c5", sql`typeof(reference_count)='integer' and reference_count between 0 and 32`),
  check("generation_contexts_c6", sql`typeof(content_count)='integer' and content_count between 0 and 9007199254740991`),
  check("generation_contexts_c7", sql`typeof(metadata_revision)='integer' and metadata_revision between 1 and 9007199254740991`),
  check("generation_contexts_c8", sql`(input_state='absent' and input_version is null and source_id is null and document_id is null and document_sha256 is null and confirmation_id is null) or (input_state='present' and input_version is not null and typeof(input_version)='integer' and input_version between 1 and 9007199254740991 and source_id is not null and document_id is not null and document_sha256 is not null and length(document_sha256)=64 and document_sha256 not glob '*[^0-9a-f]*')`),
  check("generation_contexts_c9", sql`(content_count=0 and last_content_event_id is null and analysis_event_id is null and critique_event_id is null and intent_confirmation_event_id is null and summary_event_id is null and summary_review_event_id is null and child_event_id is null and child_review_event_id is null and adult_event_id is null and adult_review_event_id is null) or (content_count>0 and last_content_event_id is not null)`),
  check("generation_contexts_c10", sql`(ticket_id is null and ticket_fingerprint is null) or (ticket_id is not null and ticket_fingerprint is not null and length(ticket_fingerprint)=64 and ticket_fingerprint not glob '*[^0-9a-f]*')`),
]);

export const generationContextChunks = sqliteTable("generation_context_chunks", {
  contextId: text("context_id").notNull(),
  position: integer("position").notNull(),
  byteLength: integer("byte_length").notNull(),
  sha256: text("sha256").notNull(),
  body: blob("body", { mode: "buffer" }).notNull(),
  verified: integer("verified").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.contextId, table.position] }),
  foreignKey({ name: "generation_context_chunks_fk0", columns: [table.contextId], foreignColumns: [generationContexts.id] }),
  check("generation_context_chunks_c0", sql`typeof(position)='integer' and position between 0 and 3`),
  check("generation_context_chunks_c1", sql`typeof(body)='blob' and byte_length=length(body) and byte_length between 1 and 16384`),
  check("generation_context_chunks_c2", sql`length(sha256)=64 and sha256 not glob '*[^0-9a-f]*'`),
  check("generation_context_chunks_c3", sql`verified=1`),
]);

export const generationRequestContexts = sqliteTable("generation_request_contexts", {
  jobId: text("job_id").notNull(),
  contextId: text("context_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.jobId] }),
  uniqueIndex("generation_request_contexts_u0").on(table.contextId),
  uniqueIndex("generation_request_contexts_u1").on(table.jobId, table.contextId),
  foreignKey({ name: "generation_request_contexts_fk0", columns: [table.jobId], foreignColumns: [generationJobs.id] }),
  foreignKey({ name: "generation_request_contexts_fk1", columns: [table.contextId], foreignColumns: [generationContexts.id] }),
  check("generation_request_contexts_c0", sql`length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*'`),
]);

export const generationStepContexts = sqliteTable("generation_step_contexts", {
  jobId: text("job_id").notNull(),
  stepKey: text("step_key").notNull(),
  contextId: text("context_id").notNull(),
  requestContextId: text("request_context_id").notNull(),
  task: text("task").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  predecessorEventNo: integer("predecessor_event_no").notNull(),
  predecessorStateVersion: integer("predecessor_state_version").notNull(),
  predecessorKind: text("predecessor_kind").notNull(),
  commandOrdinal: integer("command_ordinal"),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.jobId, table.stepKey] }),
  uniqueIndex("generation_step_contexts_u0").on(table.contextId),
  uniqueIndex("generation_step_contexts_u1").on(table.jobId, table.stepKey, table.contextId),
  foreignKey({ name: "generation_step_contexts_fk0", columns: [table.jobId, table.stepKey], foreignColumns: [generationStepReceipts.generationJobId, generationStepReceipts.stepKey] }),
  foreignKey({ name: "generation_step_contexts_fk1", columns: [table.contextId], foreignColumns: [generationContexts.id] }),
  foreignKey({ name: "generation_step_contexts_fk2", columns: [table.jobId, table.requestContextId], foreignColumns: [generationRequestContexts.jobId, generationRequestContexts.contextId] }),
  foreignKey({ name: "generation_step_contexts_fk3", columns: [table.jobId, table.predecessorEventNo, table.predecessorStateVersion], foreignColumns: [generationTransitionEvidence.jobId, generationTransitionEvidence.eventNo, generationTransitionEvidence.afterVersion] }),
  foreignKey({ name: "generation_step_contexts_fk4", columns: [table.jobId, table.commandOrdinal], foreignColumns: [generationControlCommands.jobId, generationControlCommands.ordinal] }),
  check("generation_step_contexts_c0", sql`length(input_fingerprint)=64 and input_fingerprint not glob '*[^0-9a-f]*'`),
  check("generation_step_contexts_c1", sql`predecessor_kind in ('request','outcome','wait_consume')`),
]);

export const generationWaitContexts = sqliteTable("generation_wait_contexts", {
  jobId: text("job_id").notNull(),
  waitGeneration: integer("wait_generation").notNull(),
  contextId: text("context_id").notNull(),
  requestContextId: text("request_context_id").notNull(),
  kind: text("kind").notNull(),
  enterEventNo: integer("enter_event_no").notNull(),
  enterStateVersion: integer("enter_state_version").notNull(),
  parentWaitGeneration: integer("parent_wait_generation"),
  commandOrdinal: integer("command_ordinal"),
  parentStepKey: text("parent_step_key"),
  parentAttempt: integer("parent_attempt"),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.jobId, table.waitGeneration] }),
  uniqueIndex("generation_wait_contexts_u0").on(table.contextId),
  foreignKey({ name: "generation_wait_contexts_fk0", columns: [table.jobId], foreignColumns: [generationJobs.id] }),
  foreignKey({ name: "generation_wait_contexts_fk1", columns: [table.contextId], foreignColumns: [generationContexts.id] }),
  foreignKey({ name: "generation_wait_contexts_fk2", columns: [table.jobId, table.requestContextId], foreignColumns: [generationRequestContexts.jobId, generationRequestContexts.contextId] }),
  foreignKey({ name: "generation_wait_contexts_fk3", columns: [table.jobId, table.enterEventNo, table.enterStateVersion], foreignColumns: [generationTransitionEvidence.jobId, generationTransitionEvidence.eventNo, generationTransitionEvidence.afterVersion] }),
  foreignKey({ name: "generation_wait_contexts_fk4", columns: [table.jobId, table.parentWaitGeneration], foreignColumns: [generationWaitContexts.jobId, generationWaitContexts.waitGeneration] }),
  foreignKey({ name: "generation_wait_contexts_fk5", columns: [table.jobId, table.commandOrdinal], foreignColumns: [generationControlCommands.jobId, generationControlCommands.ordinal] }),
  foreignKey({ name: "generation_wait_contexts_fk6", columns: [table.jobId, table.parentStepKey, table.parentAttempt], foreignColumns: [generationStepOutcomes.jobId, generationStepOutcomes.stepKey, generationStepOutcomes.attempt] }),
  check("generation_wait_contexts_c0", sql`typeof(wait_generation)='integer' and wait_generation between 1 and 9007199254740991`),
  check("generation_wait_contexts_c1", sql`kind in ('transcript_review','intent_review')`),
  check("generation_wait_contexts_c2", sql`(parent_wait_generation is null and command_ordinal is null and parent_step_key is null and parent_attempt is null) or (parent_wait_generation is not null and parent_wait_generation<wait_generation and command_ordinal is not null and ((parent_step_key is null and parent_attempt is null) or (parent_step_key is not null and parent_attempt is not null)))`),
]);

export const generationDispatchAttempts = sqliteTable("generation_dispatch_attempts", {
  dispatchId: text("dispatch_id").notNull(),
  attempt: integer("attempt").notNull(),
  claimToken: text("claim_token").notNull(),
  leaseExpiresAt: text("lease_expires_at").notNull(),
  state: text("state").notNull(),
  reservedAt: text("reserved_at").notNull(),
  sendStartedAt: text("send_started_at"),
  endedAt: text("ended_at"),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.dispatchId, table.attempt] }),
  foreignKey({ name: "generation_dispatch_attempts_fk0", columns: [table.dispatchId], foreignColumns: [generationJobDispatches.id] }),
  check("generation_dispatch_attempts_c0", sql`typeof(attempt)='integer' and attempt between 1 and 9007199254740991`),
  check("generation_dispatch_attempts_c1", sql`state in ('reserved','send_started','expired','observed')`),
  check("generation_dispatch_attempts_c2", sql`lease_expires_at>reserved_at and ((state in ('reserved','expired') and send_started_at is null) or (state in ('send_started','observed') and send_started_at is not null and send_started_at>=reserved_at))`),
  check("generation_dispatch_attempts_c3", sql`(state in ('expired','observed') and ended_at is not null) or (state in ('reserved','send_started') and ended_at is null)`),
]);

export const generationDispatchReceipts = sqliteTable("generation_dispatch_receipts", {
  dispatchId: text("dispatch_id").notNull(),
  jobId: text("job_id").notNull(),
  workflowInstanceId: text("workflow_instance_id").notNull(),
  requestContextId: text("request_context_id").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  contextId: text("context_id").notNull(),
  waitGeneration: integer("wait_generation"),
  commandOrdinal: integer("command_ordinal"),
  eventNo: integer("event_no").notNull(),
  stateVersion: integer("state_version").notNull(),
  receivedAt: text("received_at").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.dispatchId] }),
  uniqueIndex("generation_dispatch_receipts_u0").on(table.jobId, table.eventNo),
  foreignKey({ name: "generation_dispatch_receipts_fk0", columns: [table.dispatchId], foreignColumns: [generationJobDispatches.id] }),
  foreignKey({ name: "generation_dispatch_receipts_fk1", columns: [table.jobId, table.requestContextId], foreignColumns: [generationRequestContexts.jobId, generationRequestContexts.contextId] }),
  foreignKey({ name: "generation_dispatch_receipts_fk2", columns: [table.contextId], foreignColumns: [generationContexts.id] }),
  foreignKey({ name: "generation_dispatch_receipts_fk3", columns: [table.jobId, table.waitGeneration], foreignColumns: [generationWaitContexts.jobId, generationWaitContexts.waitGeneration] }),
  foreignKey({ name: "generation_dispatch_receipts_fk4", columns: [table.jobId, table.commandOrdinal], foreignColumns: [generationControlCommands.jobId, generationControlCommands.ordinal] }),
  foreignKey({ name: "generation_dispatch_receipts_fk5", columns: [table.jobId, table.eventNo, table.stateVersion], foreignColumns: [generationTransitionEvidence.jobId, generationTransitionEvidence.eventNo, generationTransitionEvidence.afterVersion] }),
  check("generation_dispatch_receipts_c0", sql`length(request_fingerprint)=64 and request_fingerprint not glob '*[^0-9a-f]*'`),
  check("generation_dispatch_receipts_c1", sql`length(payload_fingerprint)=64 and payload_fingerprint not glob '*[^0-9a-f]*'`),
]);

export const generationControlCommands = sqliteTable("generation_control_commands", {
  jobId: text("job_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  commandKey: text("command_key").notNull(),
  waitGeneration: integer("wait_generation").notNull(),
  contextId: text("context_id").notNull(),
  actorDigest: text("actor_digest").notNull(),
  fingerprint: text("fingerprint").notNull(),
  state: text("state").notNull(),
  stepKey: text("step_key").notNull(),
  outcomeAttempt: integer("outcome_attempt"),
  createdAt: text("created_at").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.jobId, table.ordinal] }),
  uniqueIndex("generation_control_commands_u0").on(table.jobId, table.commandKey),
  uniqueIndex("generation_control_commands_u1").on(table.contextId),
  foreignKey({ name: "generation_control_commands_fk0", columns: [table.jobId, table.waitGeneration], foreignColumns: [generationWaitContexts.jobId, generationWaitContexts.waitGeneration] }),
  foreignKey({ name: "generation_control_commands_fk1", columns: [table.contextId], foreignColumns: [generationContexts.id] }),
  foreignKey({ name: "generation_control_commands_fk2", columns: [table.jobId, table.stepKey, table.outcomeAttempt], foreignColumns: [generationStepOutcomes.jobId, generationStepOutcomes.stepKey, generationStepOutcomes.attempt] }),
  check("generation_control_commands_c0", sql`typeof(ordinal)='integer' and ordinal between 1 and 9007199254740991`),
  check("generation_control_commands_c1", sql`length(actor_digest)=64 and actor_digest not glob '*[^0-9a-f]*'`),
  check("generation_control_commands_c2", sql`length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*'`),
  check("generation_control_commands_c3", sql`state in ('pending','running','succeeded','rejected','stale','uncertain')`),
  check("generation_control_commands_c4", sql`step_key='correction_' || ordinal`),
  uniqueIndex("generation_commands_one_open_job").on(table.jobId).where(sql`state in ('pending','running','uncertain')`),
]);

export const generationTransitionEvidence = sqliteTable("generation_transition_evidence", {
  jobId: text("job_id").notNull(),
  eventNo: integer("event_no").notNull(),
  beforeVersion: integer("before_version"),
  afterVersion: integer("after_version").notNull(),
  beforeStatus: text("before_status"),
  afterStatus: text("after_status").notNull(),
  beforeStage: text("before_stage"),
  afterStage: text("after_stage").notNull(),
  beforeWait: integer("before_wait"),
  afterWait: integer("after_wait"),
  reason: text("reason").notNull(),
  contextId: text("context_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  stepKey: text("step_key"),
  attempt: integer("attempt"),
  dispatchId: text("dispatch_id"),
  commandOrdinal: integer("command_ordinal"),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.jobId, table.eventNo] }),
  uniqueIndex("generation_transition_evidence_u0").on(table.jobId, table.eventNo, table.afterVersion),
  foreignKey({ name: "generation_transition_evidence_fk0", columns: [table.jobId, table.eventNo, table.afterVersion], foreignColumns: [generationJobEvents.generationJobId, generationJobEvents.eventNo, generationJobEvents.jobStateVersion] }),
  foreignKey({ name: "generation_transition_evidence_fk1", columns: [table.contextId], foreignColumns: [generationContexts.id] }),
  foreignKey({ name: "generation_transition_evidence_fk2", columns: [table.dispatchId], foreignColumns: [generationJobDispatches.id] }),
  foreignKey({ name: "generation_transition_evidence_fk3", columns: [table.jobId, table.commandOrdinal], foreignColumns: [generationControlCommands.jobId, generationControlCommands.ordinal] }),
  check("generation_transition_evidence_c0", sql`typeof(event_no)='integer' and event_no between 1 and 9007199254740991`),
  check("generation_transition_evidence_c1", sql`typeof(after_version)='integer' and after_version between 0 and 9007199254740991`),
  check("generation_transition_evidence_c2", sql`(before_version is null and before_status is null and before_stage is null and before_wait is null and event_no=1 and after_version=0 and reason='job_created' and after_status='dispatch_pending') or (before_version is not null and before_status is not null and before_stage is not null and after_version=before_version+1 and event_no=after_version+1 and reason<>'job_created')`),
  check("generation_transition_evidence_c3", sql`reason in ('job_created','received','step_succeeded','step_rejected','step_stale','step_uncertain','stage_completed','wait_entered','review_ready','needs_revision','job_stale')`),
  check("generation_transition_evidence_c4", sql`length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*'`),
]);

export const generationStepOutcomes = sqliteTable("generation_step_outcomes", {
  jobId: text("job_id").notNull(),
  stepKey: text("step_key").notNull(),
  attempt: integer("attempt").notNull(),
  contextId: text("context_id").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  task: text("task").notNull(),
  outcome: text("outcome").notNull(),
  reason: text("reason").notNull(),
  eventNo: integer("event_no").notNull(),
  stateVersion: integer("state_version").notNull(),
  callId: text("call_id"),
  usageEventId: text("usage_event_id"),
  resultStepKey: text("result_step_key"),
  beforeInputVersion: integer("before_input_version"),
  afterInputVersion: integer("after_input_version"),
  beforeContentCount: integer("before_content_count").notNull(),
  afterContentCount: integer("after_content_count").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.jobId, table.stepKey, table.attempt] }),
  uniqueIndex("generation_step_outcomes_u0").on(table.jobId, table.eventNo),
  foreignKey({ name: "generation_step_outcomes_fk0", columns: [table.jobId, table.stepKey, table.contextId], foreignColumns: [generationStepContexts.jobId, generationStepContexts.stepKey, generationStepContexts.contextId] }),
  foreignKey({ name: "generation_step_outcomes_fk1", columns: [table.jobId, table.eventNo, table.stateVersion], foreignColumns: [generationTransitionEvidence.jobId, generationTransitionEvidence.eventNo, generationTransitionEvidence.afterVersion] }),
  foreignKey({ name: "generation_step_outcomes_fk2", columns: [table.callId], foreignColumns: [aiProviderCalls.id] }),
  foreignKey({ name: "generation_step_outcomes_fk3", columns: [table.usageEventId], foreignColumns: [aiUsageEvents.id] }),
  foreignKey({ name: "generation_step_outcomes_fk4", columns: [table.jobId, table.resultStepKey], foreignColumns: [generationStepResultLinks.generationJobId, generationStepResultLinks.stepKey] }),
  check("generation_step_outcomes_c0", sql`typeof(attempt)='integer' and attempt between 1 and 9007199254740991`),
  check("generation_step_outcomes_c1", sql`length(input_fingerprint)=64 and input_fingerprint not glob '*[^0-9a-f]*'`),
  check("generation_step_outcomes_c2", sql`outcome in ('success','rejected','stale','uncertain')`),
  check("generation_step_outcomes_c3", sql`reason in ('none','domain_invalid','authority_changed','usage_unknown')`),
  check("generation_step_outcomes_c4", sql`(outcome='success' and reason='none' and result_step_key=step_key and result_step_key is not null and call_id is not null and usage_event_id is not null) or (outcome<>'success' and reason<>'none' and result_step_key is null)`),
  check("generation_step_outcomes_c5", sql`typeof(before_content_count)='integer' and before_content_count between 0 and 9007199254740991`),
  check("generation_step_outcomes_c6", sql`typeof(after_content_count)='integer' and after_content_count between 0 and 9007199254740991`),
]);

export const aiUsageObservations = sqliteTable("ai_usage_observations", {
  callId: text("call_id").notNull(),
  usageEventId: text("usage_event_id").notNull(),
  jobId: text("job_id").notNull(),
  sermonId: text("sermon_id").notNull(),
  quizSetId: text("quiz_set_id").notNull(),
  stepKey: text("step_key").notNull(),
  attempt: integer("attempt").notNull(),
  contextId: text("context_id").notNull(),
  inputFingerprint: text("input_fingerprint").notNull(),
  task: text("task").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  reasoningEffort: text("reasoning_effort"),
  providerRequestIdOpaque: text("provider_request_id_opaque"),
  inputTokens: integer("input_tokens"),
  cachedInputTokens: integer("cached_input_tokens"),
  reasoningTokens: integer("reasoning_tokens"),
  outputTokens: integer("output_tokens"),
  audioInputTokens: integer("audio_input_tokens"),
  audioSeconds: integer("audio_seconds"),
  pricingVersion: text("pricing_version").notNull(),
  estimatedCostMicroUsd: integer("estimated_cost_micro_usd").notNull(),
  usageSource: text("usage_source").notNull(),
  startedAt: text("started_at").notNull(),
  observedAt: text("observed_at").notNull(),
  fingerprint: text("fingerprint").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.callId] }),
  uniqueIndex("ai_usage_observations_u0").on(table.usageEventId),
  foreignKey({ name: "ai_usage_observations_fk0", columns: [table.callId], foreignColumns: [aiProviderCalls.id] }),
  foreignKey({ name: "ai_usage_observations_fk1", columns: [table.jobId, table.stepKey, table.contextId], foreignColumns: [generationStepContexts.jobId, generationStepContexts.stepKey, generationStepContexts.contextId] }),
  check("ai_usage_observations_c0", sql`length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*'`),
  check("ai_usage_observations_c1", sql`length(input_fingerprint)=64 and input_fingerprint not glob '*[^0-9a-f]*'`),
  check("ai_usage_observations_c2", sql`typeof(attempt)='integer' and attempt between 1 and 9007199254740991`),
  check("ai_usage_observations_c3", sql`typeof(estimated_cost_micro_usd)='integer' and estimated_cost_micro_usd between 0 and 9007199254740991`),
  check("ai_usage_observations_c4", sql`usage_source in ('provider_reported','provider_partial')`),
  check("ai_usage_observations_c5", sql`observed_at>=started_at`),
  check("ai_usage_observations_c6", sql`input_tokens is not null or cached_input_tokens is not null or reasoning_tokens is not null or output_tokens is not null or audio_input_tokens is not null or audio_seconds is not null`),
  check("ai_usage_observations_c7", sql`(input_tokens is null or (typeof(input_tokens)='integer' and input_tokens between 0 and 9007199254740991))`),
  check("ai_usage_observations_c8", sql`(cached_input_tokens is null or (typeof(cached_input_tokens)='integer' and cached_input_tokens between 0 and 9007199254740991))`),
  check("ai_usage_observations_c9", sql`(reasoning_tokens is null or (typeof(reasoning_tokens)='integer' and reasoning_tokens between 0 and 9007199254740991))`),
  check("ai_usage_observations_c10", sql`(output_tokens is null or (typeof(output_tokens)='integer' and output_tokens between 0 and 9007199254740991))`),
  check("ai_usage_observations_c11", sql`(audio_input_tokens is null or (typeof(audio_input_tokens)='integer' and audio_input_tokens between 0 and 9007199254740991))`),
  check("ai_usage_observations_c12", sql`(audio_seconds is null or (typeof(audio_seconds)='integer' and audio_seconds between 0 and 9007199254740991))`),
]);

export const aiUsageSettlements = sqliteTable("ai_usage_settlements", {
  callId: text("call_id").notNull(),
  usageEventId: text("usage_event_id").notNull(),
  jobId: text("job_id").notNull(),
  stepKey: text("step_key").notNull(),
  attempt: integer("attempt").notNull(),
  fingerprint: text("fingerprint").notNull(),
  settledAt: text("settled_at").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.callId] }),
  uniqueIndex("ai_usage_settlements_u0").on(table.usageEventId),
  foreignKey({ name: "ai_usage_settlements_fk0", columns: [table.callId], foreignColumns: [aiUsageObservations.callId] }),
  foreignKey({ name: "ai_usage_settlements_fk1", columns: [table.usageEventId], foreignColumns: [aiUsageEvents.id] }),
  foreignKey({ name: "ai_usage_settlements_fk2", columns: [table.jobId, table.stepKey, table.attempt], foreignColumns: [generationStepOutcomes.jobId, generationStepOutcomes.stepKey, generationStepOutcomes.attempt] }),
  check("ai_usage_settlements_c0", sql`length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*'`),
]);

// Private presentation copies. Never a generation/publication authority. The
// original sealed events and final tickets remain intact; cleanup removes copies.
export const generationDisplaySnapshots = sqliteTable("generation_display_snapshots", {
  sermonId: text("sermon_id").notNull(), eventId: text("event_id").notNull(),
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "cascade" }),
  sourceFingerprint: text("source_fingerprint").notNull(), bodySha256: text("body_sha256").notNull(), bodyJson: text("body_json").notNull(),
}, (t): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [t.sermonId, t.eventId] }),
  foreignKey({ columns: [t.sermonId, t.eventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("cascade"),
  check("generation_display_snapshots_hash", sql`length(source_fingerprint)=64 and source_fingerprint not glob '*[^0-9a-f]*' and length(body_sha256)=64 and body_sha256 not glob '*[^0-9a-f]*'`),
  check("generation_display_snapshots_json", sql`json_valid(body_json)`),
]);
export const generationDisplayFinals = sqliteTable("generation_display_finals", {
  ticketId: text("ticket_id").notNull().references(() => finalCheckTickets.id, { onDelete: "cascade" }),
  difficulty: text("difficulty").notNull(),
  sermonId: text("sermon_id").notNull().references(() => sermons.id, { onDelete: "cascade" }),
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "cascade" }),
  sourceFingerprint: text("source_fingerprint").notNull(), bodySha256: text("body_sha256").notNull(), bodyJson: text("body_json").notNull(),
}, (t): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [t.ticketId, t.difficulty] }),
  check("generation_display_finals_difficulty", sql`difficulty in ('child','adult')`),
  check("generation_display_finals_hash", sql`length(source_fingerprint)=64 and source_fingerprint not glob '*[^0-9a-f]*' and length(body_sha256)=64 and body_sha256 not glob '*[^0-9a-f]*'`),
  check("generation_display_finals_json", sql`json_valid(body_json)`),
]);

export const generationFinalValidationProofs = sqliteTable("generation_final_validation_proofs", {
  jobId: text("job_id").primaryKey().references(() => generationJobs.id, { onDelete: "restrict" }),
  contextId: text("context_id").notNull().references(() => generationContexts.id, { onDelete: "restrict" }),
  ticketId: text("ticket_id").notNull().references(() => finalCheckTickets.id, { onDelete: "restrict" }),
  ticketFingerprint: text("ticket_fingerprint").notNull(),
  previewFingerprint: text("preview_fingerprint").notNull(),
  eventNo: integer("event_no").notNull(),
  stateVersion: integer("state_version").notNull(),
  checkedAt: text("checked_at").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  foreignKey({ name: "generation_final_validation_proofs_event_fk", columns: [table.jobId, table.eventNo, table.stateVersion],
    foreignColumns: [generationTransitionEvidence.jobId, generationTransitionEvidence.eventNo, generationTransitionEvidence.afterVersion] }),
  check("generation_final_validation_proofs_ticket_hash", sql`length(ticket_fingerprint)=64 and ticket_fingerprint not glob '*[^0-9a-f]*'`),
  check("generation_final_validation_proofs_preview_hash", sql`length(preview_fingerprint)=64 and preview_fingerprint not glob '*[^0-9a-f]*'`),
]);

/** Local v3 full-generation contract marker. Existing v2 job rows remain byte-for-byte intact. */
export const generationFullV3Requests = sqliteTable("generation_full_v3_requests", {
  jobId: text("job_id").primaryKey().references(() => generationJobs.id, { onDelete: "restrict" }),
  requestContextId: text("request_context_id").notNull().references(() => generationContexts.id, { onDelete: "restrict" }),
  createdAt: text("created_at").notNull(),
});

/** One new intent job can reuse a verified analysis from a failed critique job. */
export const generationIntentAnalysisReuse = sqliteTable("generation_intent_analysis_reuse", {
  jobId: text("job_id").primaryKey().references(() => generationJobs.id, { onDelete: "restrict" }),
  sourceJobId: text("source_job_id").notNull().references(() => generationJobs.id, { onDelete: "restrict" }),
  sermonId: text("sermon_id").notNull(),
  analysisEventId: text("analysis_event_id").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [
  foreignKey({ columns: [table.sermonId, table.analysisEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
]);

/** Immutable semantic lineage for newly validated content. Old payloads are not backfilled. */
export const sermonContentDomainLineage = sqliteTable("sermon_content_domain_lineage", {
  sermonId: text("sermon_id").notNull(),
  eventId: text("event_id").notNull(),
  family: text("family").notNull(),
  rootAnalysisEventId: text("root_analysis_event_id"),
  critiqueEventId: text("critique_event_id"),
  targetSnapshotEventId: text("target_snapshot_event_id"),
}, (table): SQLiteTableExtraConfigValue[] => [
  primaryKey({ columns: [table.sermonId, table.eventId] }),
  foreignKey({ columns: [table.sermonId, table.eventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.rootAnalysisEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.critiqueEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  foreignKey({ columns: [table.sermonId, table.targetSnapshotEventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  check("sermon_content_domain_family", sql`family in ('intent','summary','candidate')`),
  check("sermon_content_domain_root", sql`(family='intent' and root_analysis_event_id is not null) or (family<>'intent' and root_analysis_event_id is null and critique_event_id is null)`),
]);

/** Explicit, immutable layout choices. Generation requests and old final proofs stay intact. */
export const generationPlacementSelections = sqliteTable("generation_placement_selections", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => generationJobs.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(),
  ticketId: text("ticket_id").notNull().references(() => finalCheckTickets.id, { onDelete: "restrict" }),
  actorDigest: text("actor_digest").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [
  uniqueIndex("generation_placement_selections_revision").on(table.jobId, table.revision),
  check("generation_placement_selection_revision", sql`typeof(revision)='integer' and revision between 2 and 9007199254740991`),
  check("generation_placement_selection_actor", sql`length(actor_digest)=64 and actor_digest not glob '*[^0-9a-f]*'`),
]);

// Payload expiry leaves immutable identities, checksums, usage and publication FKs intact.
export const draftCleanupRecords = sqliteTable("draft_cleanup_records", {
  sermonId: text("sermon_id").primaryKey().references(() => sermons.id, { onDelete: "restrict" }),
  purgedAt: text("purged_at").notNull(),
  dueAt: text("due_at").notNull(),
  inputVersion: integer("input_version").notNull(),
  contentCount: integer("content_count").notNull(),
  historyVersion: integer("history_version").notNull(),
  metadataRevision: integer("metadata_revision").notNull(),
  basisFingerprint: text("basis_fingerprint").notNull(),
  sourceMetadataJson: text("source_metadata_json").notNull(),
}, (table) => [
  check("draft_cleanup_time_check", sql`${table.purgedAt} >= ${table.dueAt}`),
  check("draft_cleanup_versions_check", sql`${table.inputVersion} >= 0 and ${table.contentCount} >= 0 and ${table.historyVersion} >= 0 and ${table.metadataRevision} >= 0`),
  check("draft_cleanup_hash_check", sql`length(${table.basisFingerprint}) = 64 and ${table.basisFingerprint} not glob '*[^0-9a-f]*'`),
  check("draft_cleanup_sources_check", sql`json_valid(${table.sourceMetadataJson})`),
]);

// Metadata previously had no save timestamp. Record future edits without
// changing the exact batch-result contract of the legacy history writer.
export const draftActivity = sqliteTable("draft_activity", {
  sermonId: text("sermon_id").primaryKey().references(() => sermons.id, { onDelete: "cascade" }),
  updatedAt: text("updated_at").notNull(),
});

// P5-61: immutable correction source, editable history, terminal decision and body cleanup.
export const quizProblemCases = sqliteTable("quiz_problem_cases", {
  id: text("id").primaryKey(), quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "restrict" }),
  cycle: integer("cycle").notNull(), sourceJson: text("source_json").notNull(), levelsJson: text("levels_json").notNull(),
  reviewRevision: integer("review_revision").notNull(), displayRevision: integer("display_revision").notNull(),
  closesAt: text("closes_at").notNull(), notice: text("notice").notNull(), reason: text("reason").notNull(),
  requestSha256: text("request_sha256").notNull(), actorDigest: text("actor_digest").notNull(), createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("quiz_problem_cycle").on(table.quizSetId, table.cycle)]);
export const quizProblemDrafts = sqliteTable("quiz_problem_drafts", {
  caseId: text("case_id").notNull().references(() => quizProblemCases.id, { onDelete: "restrict" }), revision: integer("revision").notNull(),
  requestKey: text("request_key").notNull(), requestSha256: text("request_sha256").notNull(), actorDigest: text("actor_digest").notNull(),
  kind: text("kind").notNull(), bodyJson: text("body_json").notNull(), bodySha256: text("body_sha256").notNull(), createdAt: text("created_at").notNull(),
}, table => [primaryKey({ columns: [table.caseId,table.revision] }),uniqueIndex("quiz_problem_draft_key").on(table.caseId,table.requestKey)]);
export const quizProblemOutcomes = sqliteTable("quiz_problem_outcomes", {
  caseId: text("case_id").primaryKey().references(() => quizProblemCases.id, { onDelete: "restrict" }),
  action: text("action").notNull(), draftRevision: integer("draft_revision").notNull(), requestKey: text("request_key").notNull(),
  requestSha256: text("request_sha256").notNull(), actorDigest: text("actor_digest").notNull(), reason: text("reason").notNull(),
  contentJson: text("content_json").notNull(), bodySha256: text("body_sha256").notNull(), displayRevision: integer("display_revision").notNull(),
  nonRanked: integer("non_ranked").notNull(), createdAt: text("created_at").notNull(),
});
export const quizProblemCleanup = sqliteTable("quiz_problem_cleanup", {
  caseId: text("case_id").primaryKey().references(() => quizProblemCases.id, { onDelete: "restrict" }),
  draftRevision: integer("draft_revision").notNull(), hashesJson: text("hashes_json").notNull(), purgedAt: text("purged_at").notNull(),
});

// Display-only text; immutable scoring entries and publication snapshots remain untouched.
export const publishedWordingCorrections = sqliteTable("published_wording_corrections", {
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(), requestKey: text("request_key").notNull(),
  contentRevision: integer("content_revision").notNull(), target: text("target").notNull(),
  beforeText: text("before_text").notNull(), afterText: text("after_text").notNull(),
  assessment: text("assessment").notNull(), confirmation: text("confirmation").notNull(),
  reason: text("reason").notNull(), actorDigest: text("actor_digest").notNull(), createdAt: text("created_at").notNull(),
}, table => [
  primaryKey({ columns: [table.quizSetId, table.revision] }),
  uniqueIndex("published_wording_request_uidx").on(table.quizSetId, table.requestKey),
  check("published_wording_revision_check", sql`typeof(${table.revision})='integer' and ${table.revision}>0 and typeof(${table.contentRevision})='integer' and ${table.contentRevision}>=0`),
  check("published_wording_confirmation_check", sql`${table.assessment}='non_semantic_typo' and ${table.confirmation}='meaning_and_answer_unchanged'`),
  check("published_wording_text_check", sql`length(trim(${table.beforeText})) between 1 and 20000 and length(trim(${table.afterText})) between 1 and 20000 and ${table.beforeText}<>${table.afterText}`),
  check("published_wording_reason_check", sql`length(trim(${table.reason})) between 2 and 500`),
  check("published_wording_actor_check", sql`length(${table.actorDigest})=64 and ${table.actorDigest} not glob '*[^0-9a-f]*'`),
]);

// A recovered archived analysis is a new content event, never a rewrite of the failed call.
export const generationArchivedIntentRecoveries = sqliteTable("generation_archived_intent_recoveries", {
  eventId: text("event_id").primaryKey(), sermonId: text("sermon_id").notNull(),
  quizSetId: text("quiz_set_id").notNull().references(() => quizSets.id, { onDelete: "restrict" }),
  sourceJobId: text("source_job_id").notNull().references(() => generationJobs.id, { onDelete: "restrict" }),
  contextId: text("context_id").notNull().references(() => generationContexts.id, { onDelete: "restrict" }),
  contextFingerprint: text("context_fingerprint").notNull(), attempt: integer("attempt").notNull(),
  callId: text("call_id").notNull().references(() => aiProviderCalls.id, { onDelete: "restrict" }),
  usageId: text("usage_id").notNull().references(() => aiUsageEvents.id, { onDelete: "restrict" }),
  requestSha256: text("request_sha256").notNull(), responseSha256: text("response_sha256").notNull(),
  instructionsSha256: text("instructions_sha256").notNull(), payloadSha256: text("payload_sha256").notNull(),
  actorDigest: text("actor_digest").notNull(), createdAt: text("created_at").notNull(),
}, (table): SQLiteTableExtraConfigValue[] => [
  uniqueIndex("generation_archived_intent_source_uidx").on(table.sourceJobId),
  foreignKey({ columns: [table.sermonId, table.eventId], foreignColumns: [sermonContentEvents.sermonId, sermonContentEvents.eventId] }).onDelete("restrict"),
  check("generation_archived_intent_attempt", sql`typeof(${table.attempt})='integer' and ${table.attempt}>0`),
  ...[table.contextFingerprint, table.requestSha256, table.responseSha256, table.instructionsSha256, table.payloadSha256, table.actorDigest]
    .map((column, i) => check(`generation_archived_intent_hash_${i}`, sql`length(${column})=64 and ${column} not glob '*[^0-9a-f]*'`)),
]);

// P8-01: operational records; never contain SQL, signed URLs, tokens or PII.
export const backupRuns = sqliteTable("backup_runs", {
  id: text("id").primaryKey(),
  environment: text("environment", { enum: ["preview", "production", "local"] }).notNull(),
  kind: text("kind", { enum: ["weekly", "pre_migration", "manual", "deletion_manifest"] }).notNull(),
  r2ObjectKey: text("r2_object_key").unique(),
  status: text("status", { enum: ["queued", "running", "verified", "failed", "rotated"] }).notNull(),
  sizeBytes: integer("size_bytes"),
  sha256: text("sha256"),
  sourceD1Bookmark: text("source_d1_bookmark"),
  errorCode: text("error_code"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  rotatedAt: text("rotated_at"),
}, t => [
  index("backup_runs_status_started_idx").on(t.environment, t.status, t.startedAt),
  uniqueIndex("backup_runs_one_running_idx").on(t.environment).where(sql`${t.status} = 'running'`),
  check("backup_runs_environment_check", sql`${t.environment} in ('preview','production','local')`),
  check("backup_runs_kind_check", sql`${t.kind} in ('weekly','pre_migration','manual','deletion_manifest')`),
  check("backup_runs_status_check", sql`${t.status} in ('queued','running','verified','failed','rotated')`),
  check("backup_runs_size_check", sql`${t.sizeBytes} is null or ${t.sizeBytes} > 0`),
  check("backup_runs_verified_check", sql`${t.status} not in ('verified','rotated') or (${t.sizeBytes} is not null and length(${t.sha256}) = 64 and ${t.completedAt} is not null and ${t.r2ObjectKey} is not null)`),
]);
export const serviceUsageSnapshots = sqliteTable("service_usage_snapshots", {
  id: text("id").primaryKey(), service: text("service").notNull(), scope: text("scope").notNull(),
  scopeId: text("scope_id").notNull(), periodStart: text("period_start").notNull(), periodEnd: text("period_end").notNull(),
  metricsJson: text("metrics_json", { mode: "json" }).$type<Record<string, number | null>>().notNull(),
  source: text("source").notNull(), fetchedAt: text("fetched_at").notNull(), errorCode: text("error_code"),
}, t => [uniqueIndex("service_usage_period_idx").on(t.service,t.scope,t.scopeId,t.periodStart,t.periodEnd),
  check("service_usage_json_check", sql`json_valid(${t.metricsJson})`),
  check("service_usage_source_check", sql`${t.source} in ('app_events','cloudflare_graphql','provider_api','configured')`)]);
export const pricingCatalog = sqliteTable("pricing_catalog", {
  service: text("service").primaryKey(), planName: text("plan_name").notNull(),
  currency: text("currency").notNull().default("USD"),
  freeLimitsJson: text("free_limits_json", { mode: "json" }).$type<Record<string, number>>().notNull(),
  officialSourceUrl: text("official_source_url").notNull(), pricingVersion: text("pricing_version").notNull(),
  pricingCheckedAt: text("pricing_checked_at").notNull(), updatedAt: text("updated_at").notNull(),
  refreshLeaseUntil: text("refresh_lease_until"), refreshLeaseId: text("refresh_lease_id"),
}, t => [check("pricing_limits_json_check", sql`json_valid(${t.freeLimitsJson})`)]);
export const monthlyOperationsChecks = sqliteTable("monthly_operations_checks", {
  yearMonth: text("year_month").primaryKey(),
  pricingVersionsJson: text("pricing_versions_json", { mode: "json" }).$type<Record<string, string>>().notNull(),
  checkedServicesJson: text("checked_services_json", { mode: "json" }).$type<string[]>().notNull(),
  checkedBy: text("checked_by").notNull(), checkedAt: text("checked_at").notNull(),
}, t => [check("monthly_operations_month_check", sql`length(${t.yearMonth})=7`),
  check("monthly_operations_json_check", sql`json_valid(${t.pricingVersionsJson}) and json_valid(${t.checkedServicesJson})`)]);
