CREATE TABLE `leaderboard_snapshot_entries` (
	`snapshot_id` text NOT NULL,
	`rank` integer NOT NULL,
	`submission_id` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `rank`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `leaderboard_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "leaderboard_snapshot_entries_rank_check" CHECK("leaderboard_snapshot_entries"."rank" between 1 and 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_snapshot_entries_submission_uidx` ON `leaderboard_snapshot_entries` (`snapshot_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `leaderboard_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_variant_id` text NOT NULL,
	`winner_count` integer NOT NULL,
	`finalized_at` text NOT NULL,
	FOREIGN KEY (`quiz_variant_id`) REFERENCES `quiz_variants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "leaderboard_snapshots_id_check" CHECK(length("leaderboard_snapshots"."id") between 1 and 128),
	CONSTRAINT "leaderboard_snapshots_winner_count_check" CHECK("leaderboard_snapshots"."winner_count" between 1 and 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_snapshots_variant_uidx` ON `leaderboard_snapshots` (`quiz_variant_id`);