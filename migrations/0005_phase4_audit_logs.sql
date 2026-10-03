CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_email` text,
	`safe_metadata_json` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "audit_logs_id_check" CHECK(length("audit_logs"."id") between 1 and 128),
	CONSTRAINT "audit_logs_entity_check" CHECK(length(trim("audit_logs"."entity_type")) between 1 and 64 and length(trim("audit_logs"."entity_id")) between 1 and 128),
	CONSTRAINT "audit_logs_action_check" CHECK(length(trim("audit_logs"."action")) between 1 and 128),
	CONSTRAINT "audit_logs_actor_type_check" CHECK("audit_logs"."actor_type" in ('access_admin', 'self_service', 'system')),
	CONSTRAINT "audit_logs_actor_identity_check" CHECK(("audit_logs"."actor_type" = 'access_admin' and "audit_logs"."actor_email" is not null and length(trim("audit_logs"."actor_email")) between 3 and 320) or ("audit_logs"."actor_type" <> 'access_admin' and "audit_logs"."actor_email" is null)),
	CONSTRAINT "audit_logs_safe_metadata_json_check" CHECK(json_valid("audit_logs"."safe_metadata_json") and json_type("audit_logs"."safe_metadata_json") = 'object')
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_created_idx` ON `audit_logs` (`entity_type`,`entity_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`,`id`);