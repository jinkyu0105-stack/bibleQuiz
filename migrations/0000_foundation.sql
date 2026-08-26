CREATE TABLE `bible_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`edition` text NOT NULL,
	`publication_year` integer,
	`publisher_or_rightsholder` text NOT NULL,
	`mode` text DEFAULT 'reference_only' NOT NULL,
	`source_url` text,
	`license_url` text,
	`permission_evidence_path` text,
	`allowed_web` integer DEFAULT false NOT NULL,
	`allowed_archive` integer DEFAULT false NOT NULL,
	`allowed_png` integer DEFAULT false NOT NULL,
	`allowed_pdf` integer DEFAULT false NOT NULL,
	`required_attribution` text,
	`permission_territory` text,
	`permission_starts_at` text,
	`permission_expires_at` text,
	`fee_amount` integer,
	`fee_currency` text,
	`renewal_reminder_days` integer,
	`cache_policy` text,
	`deletion_policy` text,
	`source_sha256` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "bible_translations_mode_check" CHECK("bible_translations"."mode" in ('reference_only', 'licensed_api', 'licensed_local')),
	CONSTRAINT "bible_translations_status_check" CHECK("bible_translations"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "bible_translations_permission_window_check" CHECK("bible_translations"."permission_expires_at" is null or "bible_translations"."permission_starts_at" is null or "bible_translations"."permission_expires_at" > "bible_translations"."permission_starts_at"),
	CONSTRAINT "bible_translations_fee_amount_check" CHECK("bible_translations"."fee_amount" is null or "bible_translations"."fee_amount" >= 0),
	CONSTRAINT "bible_translations_renewal_days_check" CHECK("bible_translations"."renewal_reminder_days" is null or "bible_translations"."renewal_reminder_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE `quiz_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`sermon_id` text NOT NULL,
	`confirmed_transcript_id` text,
	`confirmed_transcript_sha256` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`submission_state` text DEFAULT 'open' NOT NULL,
	`submission_paused_at` text,
	`submission_paused_by` text,
	`submission_pause_reason` text,
	`published_from_revision_number` integer,
	`published_ai_provenance_json` text,
	`published_at` text,
	`opens_at` text,
	`closes_at` text,
	`archived_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmed_transcript_id`) REFERENCES `sermon_transcripts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "quiz_sets_publish_window_check" CHECK("quiz_sets"."status" not in ('published', 'archived') or ("quiz_sets"."opens_at" is not null and "quiz_sets"."closes_at" is not null and "quiz_sets"."closes_at" > "quiz_sets"."opens_at")),
	CONSTRAINT "quiz_sets_status_check" CHECK("quiz_sets"."status" in ('draft', 'review_ready', 'needs_revision', 'published', 'archived')),
	CONSTRAINT "quiz_sets_submission_state_check" CHECK("quiz_sets"."submission_state" in ('open', 'paused')),
	CONSTRAINT "quiz_sets_pause_metadata_check" CHECK("quiz_sets"."submission_state" <> 'paused' or "quiz_sets"."submission_paused_at" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_sets_sermon_id_unique` ON `quiz_sets` (`sermon_id`);--> statement-breakpoint
CREATE INDEX `quiz_sets_state_closes_at_idx` ON `quiz_sets` (`status`,`submission_state`,`closes_at`);--> statement-breakpoint
CREATE INDEX `quiz_sets_archive_idx` ON `quiz_sets` (`status`,"id" desc);--> statement-breakpoint
CREATE TABLE `quiz_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_set_id` text NOT NULL,
	`difficulty` text NOT NULL,
	`revision` integer NOT NULL,
	`lifecycle_status` text DEFAULT 'active' NOT NULL,
	`results_status` text DEFAULT 'valid' NOT NULL,
	`replaces_variant_id` text,
	`corrects_variant_id` text,
	`lifecycle_reason` text,
	`lifecycle_changed_at` text,
	`grid_size` integer DEFAULT 5 NOT NULL,
	`public_grid_json` text NOT NULL,
	`word_count` integer NOT NULL,
	`active_cell_count` integer NOT NULL,
	`intersection_count` integer NOT NULL,
	`winner_count` integer DEFAULT 3 NOT NULL,
	`validation_report_json` text NOT NULL,
	`desktop_background_path` text,
	`mobile_background_path` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`replaces_variant_id`) REFERENCES `quiz_variants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`corrects_variant_id`) REFERENCES `quiz_variants`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "quiz_variants_revision_check" CHECK("quiz_variants"."revision" >= 1),
	CONSTRAINT "quiz_variants_difficulty_check" CHECK("quiz_variants"."difficulty" in ('child', 'adult')),
	CONSTRAINT "quiz_variants_lifecycle_status_check" CHECK("quiz_variants"."lifecycle_status" in ('active', 'superseded', 'withdrawn')),
	CONSTRAINT "quiz_variants_results_status_check" CHECK("quiz_variants"."results_status" in ('valid', 'invalidated', 'non_ranked_correction')),
	CONSTRAINT "quiz_variants_grid_size_check" CHECK("quiz_variants"."grid_size" between 5 and 10),
	CONSTRAINT "quiz_variants_word_count_check" CHECK("quiz_variants"."word_count" >= 0),
	CONSTRAINT "quiz_variants_active_cell_count_check" CHECK("quiz_variants"."active_cell_count" >= 0),
	CONSTRAINT "quiz_variants_intersection_count_check" CHECK("quiz_variants"."intersection_count" >= 0),
	CONSTRAINT "quiz_variants_winner_count_check" CHECK("quiz_variants"."winner_count" between 1 and 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_variants_set_difficulty_revision_uidx` ON `quiz_variants` (`quiz_set_id`,`difficulty`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_variants_one_active_difficulty_uidx` ON `quiz_variants` (`quiz_set_id`,`difficulty`) WHERE "quiz_variants"."lifecycle_status" = 'active';--> statement-breakpoint
CREATE INDEX `quiz_variants_results_status_idx` ON `quiz_variants` (`results_status`);--> statement-breakpoint
CREATE INDEX `quiz_variants_replaces_variant_id_idx` ON `quiz_variants` (`replaces_variant_id`);--> statement-breakpoint
CREATE TABLE `sermon_transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`sermon_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`language` text NOT NULL,
	`track_id` text,
	`provider` text,
	`provider_version` text,
	`source_mode` text NOT NULL,
	`manual_source_kind` text,
	`source_coverage` text NOT NULL,
	`is_auto_generated` integer DEFAULT false NOT NULL,
	`raw_text` text NOT NULL,
	`raw_sha256` text NOT NULL,
	`raw_segments_json` text,
	`confirmed_text` text,
	`confirmed_sha256` text,
	`status` text DEFAULT 'imported' NOT NULL,
	`confirmed_revision_id` text,
	`confirmed_by` text,
	`confirmed_at` text,
	`retention_mode` text DEFAULT 'keep_private' NOT NULL,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sermon_transcripts_source_revision_check" CHECK("sermon_transcripts"."source_revision" >= 1),
	CONSTRAINT "sermon_transcripts_source_mode_check" CHECK("sermon_transcripts"."source_mode" in ('public_unofficial', 'manual_paste', 'manual_upload', 'sermon_notes', 'audio_transcription', 'youtube_oauth')),
	CONSTRAINT "sermon_transcripts_manual_source_kind_check" CHECK("sermon_transcripts"."manual_source_kind" is null or "sermon_transcripts"."manual_source_kind" in ('youtube_visible_transcript', 'sermon_manuscript', 'sermon_summary')),
	CONSTRAINT "sermon_transcripts_source_coverage_check" CHECK("sermon_transcripts"."source_coverage" in ('full_transcript', 'partial_notes')),
	CONSTRAINT "sermon_transcripts_status_check" CHECK("sermon_transcripts"."status" in ('imported', 'editing', 'correction_pending', 'confirmed')),
	CONSTRAINT "sermon_transcripts_retention_mode_check" CHECK("sermon_transcripts"."retention_mode" in ('keep_private', 'delete_text_after_publish')),
	CONSTRAINT "sermon_transcripts_confirmed_fields_check" CHECK("sermon_transcripts"."status" <> 'confirmed' or ("sermon_transcripts"."confirmed_text" is not null and "sermon_transcripts"."confirmed_sha256" is not null and "sermon_transcripts"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sermon_transcripts_sermon_revision_uidx` ON `sermon_transcripts` (`sermon_id`,`source_revision`);--> statement-breakpoint
CREATE TABLE `sermons` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text,
	`slug_suffix` text NOT NULL,
	`church_name` text NOT NULL,
	`youtube_url` text NOT NULL,
	`youtube_video_id` text NOT NULL,
	`sermon_title` text NOT NULL,
	`sermon_date` text NOT NULL,
	`bible_translation_id` text NOT NULL,
	`bible_reference_json` text NOT NULL,
	`bible_reference_label` text NOT NULL,
	`bible_text_snapshot` text,
	`bible_source_sha256` text,
	`ai_summary` text,
	`ai_summary_disclosure` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`bible_translation_id`) REFERENCES `bible_translations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sermons_slug_unique` ON `sermons` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `sermons_slug_suffix_unique` ON `sermons` (`slug_suffix`);--> statement-breakpoint
CREATE UNIQUE INDEX `sermons_youtube_video_id_unique` ON `sermons` (`youtube_video_id`);--> statement-breakpoint
CREATE INDEX `sermons_sermon_date_id_idx` ON `sermons` ("sermon_date" desc,"id" desc);--> statement-breakpoint
CREATE TABLE `site_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
