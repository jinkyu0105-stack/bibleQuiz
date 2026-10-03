CREATE TABLE `generation_display_finals` (
	`ticket_id` text NOT NULL,
	`difficulty` text NOT NULL,
	`sermon_id` text NOT NULL,
	`quiz_set_id` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`body_sha256` text NOT NULL,
	`body_json` text NOT NULL,
	PRIMARY KEY(`ticket_id`, `difficulty`),
	FOREIGN KEY (`ticket_id`) REFERENCES `final_check_tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "generation_display_finals_difficulty" CHECK(difficulty in ('child','adult')),
	CONSTRAINT "generation_display_finals_hash" CHECK(length(source_fingerprint)=64 and source_fingerprint not glob '*[^0-9a-f]*' and length(body_sha256)=64 and body_sha256 not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_display_finals_json" CHECK(json_valid(body_json))
);
--> statement-breakpoint
CREATE TABLE `generation_display_snapshots` (
	`sermon_id` text NOT NULL,
	`event_id` text NOT NULL,
	`quiz_set_id` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`body_sha256` text NOT NULL,
	`body_json` text NOT NULL,
	PRIMARY KEY(`sermon_id`, `event_id`),
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sermon_id`,`event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "generation_display_snapshots_hash" CHECK(length(source_fingerprint)=64 and source_fingerprint not glob '*[^0-9a-f]*' and length(body_sha256)=64 and body_sha256 not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_display_snapshots_json" CHECK(json_valid(body_json))
);
