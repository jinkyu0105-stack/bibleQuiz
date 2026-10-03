CREATE TABLE `privacy_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`lookup_token_hash` text NOT NULL,
	`request_hash` text NOT NULL,
	`request_type` text NOT NULL,
	`quiz_slug` text,
	`submitted_name` text,
	`message` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`admin_response` text,
	`resolved_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`resolved_at` text,
	`purge_after` text,
	CONSTRAINT "privacy_requests_hash_check" CHECK(length("privacy_requests"."lookup_token_hash")=64 and "privacy_requests"."lookup_token_hash" not glob '*[^0-9a-f]*' and length("privacy_requests"."request_hash")=64),
	CONSTRAINT "privacy_requests_type_check" CHECK("privacy_requests"."request_type" in ('delete_submission','privacy_question')),
	CONSTRAINT "privacy_requests_status_check" CHECK("privacy_requests"."status" in ('received','reviewing','resolved','rejected')),
	CONSTRAINT "privacy_requests_message_check" CHECK(length(trim("privacy_requests"."message")) between 2 and 1000),
	CONSTRAINT "privacy_requests_reply_check" CHECK("privacy_requests"."admin_response" is null or length("privacy_requests"."admin_response")<=1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_requests_lookup_token_hash_unique` ON `privacy_requests` (`lookup_token_hash`);--> statement-breakpoint
CREATE INDEX `privacy_requests_status_created_idx` ON `privacy_requests` (`status`,`created_at`);