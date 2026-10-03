CREATE TABLE `anonymous_sessions` (
	`session_hash` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "anonymous_sessions_hash_check" CHECK(length("anonymous_sessions"."session_hash") = 64 and "anonymous_sessions"."session_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "anonymous_sessions_time_check" CHECK("anonymous_sessions"."last_seen_at" >= "anonymous_sessions"."created_at" and "anonymous_sessions"."expires_at" > "anonymous_sessions"."last_seen_at")
);
--> statement-breakpoint
CREATE INDEX `anonymous_sessions_expires_at_idx` ON `anonymous_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `quiz_solutions` (
	`quiz_variant_id` text PRIMARY KEY NOT NULL,
	`canonical_cell_order_json` text NOT NULL,
	`solution_cells_json` text NOT NULL,
	`entry_answers_json` text NOT NULL,
	`solution_sha256` text NOT NULL,
	FOREIGN KEY (`quiz_variant_id`) REFERENCES `quiz_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quiz_solutions_canonical_json_check" CHECK(json_valid("quiz_solutions"."canonical_cell_order_json")),
	CONSTRAINT "quiz_solutions_cells_json_check" CHECK(json_valid("quiz_solutions"."solution_cells_json")),
	CONSTRAINT "quiz_solutions_entries_json_check" CHECK(json_valid("quiz_solutions"."entry_answers_json")),
	CONSTRAINT "quiz_solutions_sha256_check" CHECK(length("quiz_solutions"."solution_sha256") = 64 and "quiz_solutions"."solution_sha256" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_variant_id` text NOT NULL,
	`quiz_revision` integer NOT NULL,
	`session_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`display_name` text,
	`comment` text,
	`answers_json` text,
	`correctness_mask` text NOT NULL,
	`correct_cells` integer NOT NULL,
	`total_cells` integer NOT NULL,
	`correct_words` integer NOT NULL,
	`total_words` integer NOT NULL,
	`score_basis_points` integer NOT NULL,
	`is_fully_correct` integer NOT NULL,
	`status` text DEFAULT 'visible' NOT NULL,
	`submitted_at` text NOT NULL,
	`hidden_at` text,
	`deleted_at` text,
	FOREIGN KEY (`quiz_variant_id`) REFERENCES `quiz_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_hash`) REFERENCES `anonymous_sessions`(`session_hash`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "submissions_revision_check" CHECK("submissions"."quiz_revision" >= 1),
	CONSTRAINT "submissions_request_hash_check" CHECK(length("submissions"."request_hash") = 64 and "submissions"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "submissions_idempotency_key_check" CHECK(length("submissions"."idempotency_key") = 36 and "submissions"."idempotency_key" = lower("submissions"."idempotency_key") and "submissions"."idempotency_key" glob '????????-????-7???-[89ab]???-????????????' and "submissions"."idempotency_key" not glob '*[^0-9a-f-]*'),
	CONSTRAINT "submissions_answers_json_check" CHECK("submissions"."answers_json" is null or json_valid("submissions"."answers_json")),
	CONSTRAINT "submissions_cell_score_check" CHECK("submissions"."total_cells" between 1 and 100 and "submissions"."correct_cells" between 0 and "submissions"."total_cells"),
	CONSTRAINT "submissions_word_score_check" CHECK("submissions"."total_words" between 1 and 100 and "submissions"."correct_words" between 0 and "submissions"."total_words"),
	CONSTRAINT "submissions_basis_points_check" CHECK("submissions"."score_basis_points" = round("submissions"."correct_cells" * 10000.0 / "submissions"."total_cells")),
	CONSTRAINT "submissions_correctness_mask_check" CHECK(length("submissions"."correctness_mask") = "submissions"."total_cells" and "submissions"."correctness_mask" not glob '*[^01]*' and length("submissions"."correctness_mask") - length(replace("submissions"."correctness_mask", '1', '')) = "submissions"."correct_cells"),
	CONSTRAINT "submissions_fully_correct_check" CHECK("submissions"."is_fully_correct" = ("submissions"."correct_cells" = "submissions"."total_cells")),
	CONSTRAINT "submissions_status_check" CHECK("submissions"."status" in ('visible', 'hidden', 'deleted')),
	CONSTRAINT "submissions_content_status_check" CHECK(("submissions"."status" = 'visible' and "submissions"."display_name" is not null and "submissions"."answers_json" is not null and "submissions"."hidden_at" is null and "submissions"."deleted_at" is null) or ("submissions"."status" = 'hidden' and "submissions"."display_name" is not null and "submissions"."answers_json" is not null and "submissions"."hidden_at" is not null and "submissions"."deleted_at" is null) or ("submissions"."status" = 'deleted' and "submissions"."display_name" is null and "submissions"."comment" is null and "submissions"."answers_json" is null and "submissions"."deleted_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_variant_session_uidx` ON `submissions` (`quiz_variant_id`,`session_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_variant_session_idempotency_uidx` ON `submissions` (`quiz_variant_id`,`session_hash`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `submissions_variant_status_submitted_idx` ON `submissions` (`quiz_variant_id`,`status`,`submitted_at`,`id`);--> statement-breakpoint
CREATE INDEX `submissions_variant_full_correct_submitted_idx` ON `submissions` (`quiz_variant_id`,`status`,`is_fully_correct`,`submitted_at`,`id`);