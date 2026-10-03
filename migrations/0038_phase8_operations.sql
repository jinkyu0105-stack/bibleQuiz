CREATE TABLE `backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`environment` text NOT NULL,
	`kind` text NOT NULL,
	`r2_object_key` text,
	`status` text NOT NULL,
	`size_bytes` integer,
	`sha256` text,
	`source_d1_bookmark` text,
	`error_code` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`rotated_at` text,
	CONSTRAINT "backup_runs_environment_check" CHECK("backup_runs"."environment" in ('preview','production','local')),
	CONSTRAINT "backup_runs_kind_check" CHECK("backup_runs"."kind" in ('weekly','pre_migration','manual','deletion_manifest')),
	CONSTRAINT "backup_runs_status_check" CHECK("backup_runs"."status" in ('queued','running','verified','failed','rotated')),
	CONSTRAINT "backup_runs_size_check" CHECK("backup_runs"."size_bytes" is null or "backup_runs"."size_bytes" > 0),
	CONSTRAINT "backup_runs_verified_check" CHECK("backup_runs"."status" not in ('verified','rotated') or ("backup_runs"."size_bytes" is not null and length("backup_runs"."sha256") = 64 and "backup_runs"."completed_at" is not null and "backup_runs"."r2_object_key" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backup_runs_r2_object_key_unique` ON `backup_runs` (`r2_object_key`);--> statement-breakpoint
CREATE INDEX `backup_runs_status_started_idx` ON `backup_runs` (`environment`,`status`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `backup_runs_one_running_idx` ON `backup_runs` (`environment`) WHERE "backup_runs"."status" = 'running';--> statement-breakpoint
CREATE TABLE `monthly_operations_checks` (
	`year_month` text PRIMARY KEY NOT NULL,
	`pricing_versions_json` text NOT NULL,
	`checked_services_json` text NOT NULL,
	`checked_by` text NOT NULL,
	`checked_at` text NOT NULL,
	CONSTRAINT "monthly_operations_month_check" CHECK(length("monthly_operations_checks"."year_month")=7),
	CONSTRAINT "monthly_operations_json_check" CHECK(json_valid("monthly_operations_checks"."pricing_versions_json") and json_valid("monthly_operations_checks"."checked_services_json"))
);
--> statement-breakpoint
CREATE TABLE `pricing_catalog` (
	`service` text PRIMARY KEY NOT NULL,
	`plan_name` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`free_limits_json` text NOT NULL,
	`official_source_url` text NOT NULL,
	`pricing_version` text NOT NULL,
	`pricing_checked_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`refresh_lease_until` text,
	`refresh_lease_id` text,
	CONSTRAINT "pricing_limits_json_check" CHECK(json_valid("pricing_catalog"."free_limits_json"))
);
--> statement-breakpoint
CREATE TABLE `service_usage_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`metrics_json` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text NOT NULL,
	`error_code` text,
	CONSTRAINT "service_usage_json_check" CHECK(json_valid("service_usage_snapshots"."metrics_json")),
	CONSTRAINT "service_usage_source_check" CHECK("service_usage_snapshots"."source" in ('app_events','cloudflare_graphql','provider_api','configured'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_usage_period_idx` ON `service_usage_snapshots` (`service`,`scope`,`scope_id`,`period_start`,`period_end`);