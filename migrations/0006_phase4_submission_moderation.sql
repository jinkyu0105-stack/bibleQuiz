CREATE TABLE `moderation_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_email` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "moderation_actions_id_check" CHECK(length("moderation_actions"."id") between 1 and 128),
	CONSTRAINT "moderation_actions_action_check" CHECK("moderation_actions"."action" in ('hide', 'unhide', 'delete')),
	CONSTRAINT "moderation_actions_actor_email_check" CHECK(length(trim("moderation_actions"."actor_email")) between 3 and 320),
	CONSTRAINT "moderation_actions_reason_check" CHECK(length(trim("moderation_actions"."reason")) between 2 and 500 and instr("moderation_actions"."reason", char(10)) = 0 and instr("moderation_actions"."reason", char(13)) = 0)
);
--> statement-breakpoint
CREATE INDEX `moderation_actions_submission_created_idx` ON `moderation_actions` (`submission_id`,`created_at`,`id`);