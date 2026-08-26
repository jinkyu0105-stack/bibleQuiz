import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
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

export const siteState = sqliteTable("site_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const foundationSchema = {
  bibleTranslations,
  quizSets,
  quizVariants,
  sermonTranscripts,
  sermons,
  siteState,
};

export type BibleTranslationRow = typeof bibleTranslations.$inferSelect;
export type NewBibleTranslationRow = typeof bibleTranslations.$inferInsert;
export type NewSermonRow = typeof sermons.$inferInsert;
export type SermonRow = typeof sermons.$inferSelect;
