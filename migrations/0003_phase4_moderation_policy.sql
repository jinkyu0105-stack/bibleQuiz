CREATE TABLE `moderation_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`normalized_value` text NOT NULL,
	`reason` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "moderation_exceptions_id_check" CHECK(length("moderation_exceptions"."id") between 1 and 128),
	CONSTRAINT "moderation_exceptions_scope_check" CHECK("moderation_exceptions"."scope" in ('name', 'comment', 'answer')),
	CONSTRAINT "moderation_exceptions_value_check" CHECK(length("moderation_exceptions"."normalized_value") between 1 and 512 and "moderation_exceptions"."normalized_value" = trim("moderation_exceptions"."normalized_value")),
	CONSTRAINT "moderation_exceptions_reason_check" CHECK(length(trim("moderation_exceptions"."reason")) between 1 and 1000),
	CONSTRAINT "moderation_exceptions_enabled_check" CHECK("moderation_exceptions"."enabled" in (0, 1)),
	CONSTRAINT "moderation_exceptions_created_by_check" CHECK(length(trim("moderation_exceptions"."created_by")) between 1 and 320),
	CONSTRAINT "moderation_exceptions_time_check" CHECK("moderation_exceptions"."updated_at" >= "moderation_exceptions"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moderation_exceptions_normalized_value_uidx` ON `moderation_exceptions` (`normalized_value`);--> statement-breakpoint
CREATE INDEX `moderation_exceptions_enabled_scope_idx` ON `moderation_exceptions` (`enabled`,`scope`,`id`);--> statement-breakpoint
CREATE TABLE `moderation_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`normalized_pattern` text NOT NULL,
	`match_mode` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "moderation_terms_id_check" CHECK(length("moderation_terms"."id") between 1 and 128),
	CONSTRAINT "moderation_terms_scope_check" CHECK("moderation_terms"."scope" in ('name', 'comment', 'answer', 'all')),
	CONSTRAINT "moderation_terms_pattern_check" CHECK(length("moderation_terms"."normalized_pattern") between 1 and 512 and "moderation_terms"."normalized_pattern" = trim("moderation_terms"."normalized_pattern")),
	CONSTRAINT "moderation_terms_match_mode_check" CHECK("moderation_terms"."match_mode" in ('exact', 'contains')),
	CONSTRAINT "moderation_terms_enabled_check" CHECK("moderation_terms"."enabled" in (0, 1)),
	CONSTRAINT "moderation_terms_created_by_check" CHECK(length(trim("moderation_terms"."created_by")) between 1 and 320),
	CONSTRAINT "moderation_terms_time_check" CHECK("moderation_terms"."updated_at" >= "moderation_terms"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moderation_terms_scope_pattern_mode_uidx` ON `moderation_terms` (`scope`,`normalized_pattern`,`match_mode`);--> statement-breakpoint
CREATE INDEX `moderation_terms_enabled_scope_idx` ON `moderation_terms` (`enabled`,`scope`,`id`);--> statement-breakpoint
CREATE TABLE `reserved_names` (
	`id` text PRIMARY KEY NOT NULL,
	`protected_group_id` text,
	`display_label` text NOT NULL,
	`normalized_value` text NOT NULL,
	`category` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "reserved_names_id_check" CHECK(length("reserved_names"."id") between 1 and 128),
	CONSTRAINT "reserved_names_group_check" CHECK("reserved_names"."protected_group_id" is null or length("reserved_names"."protected_group_id") between 1 and 128),
	CONSTRAINT "reserved_names_display_label_check" CHECK(length(trim("reserved_names"."display_label")) between 1 and 200),
	CONSTRAINT "reserved_names_normalized_value_check" CHECK(length("reserved_names"."normalized_value") between 1 and 512 and "reserved_names"."normalized_value" = trim("reserved_names"."normalized_value")),
	CONSTRAINT "reserved_names_category_check" CHECK("reserved_names"."category" in ('church', 'role', 'person', 'alias')),
	CONSTRAINT "reserved_names_enabled_check" CHECK("reserved_names"."enabled" in (0, 1)),
	CONSTRAINT "reserved_names_created_by_check" CHECK(length(trim("reserved_names"."created_by")) between 1 and 320),
	CONSTRAINT "reserved_names_time_check" CHECK("reserved_names"."updated_at" >= "reserved_names"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reserved_names_normalized_value_uidx` ON `reserved_names` (`normalized_value`);--> statement-breakpoint
CREATE INDEX `reserved_names_enabled_value_idx` ON `reserved_names` (`enabled`,`normalized_value`);