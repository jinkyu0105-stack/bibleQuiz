-- P5-44: local physical rehearsal complete; operational rollout remains gated.
-- Private writer/reader and G03 integration are pending; see docs/P5-44_MIGRATION_REVIEW.md.
-- No developer/Preview/Production application; no legacy backfill.
-- D1 rebuilds run in one migration transaction. Keep foreign_keys enabled.
-- RESTRICT's deferred counters require a final FK assertion before resetting
-- defer_foreign_keys; do not remove the assertion or split this migration.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE p544_migration_assert (violations INTEGER NOT NULL CHECK(violations=0));
--> statement-breakpoint
INSERT INTO p544_migration_assert SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
INSERT INTO p544_migration_assert SELECT count(*) FROM (SELECT generation_job_id FROM generation_step_receipts WHERE state IN ('claimed','effect_started','uncertain') GROUP BY generation_job_id HAVING count(*)>1);
--> statement-breakpoint
DROP TRIGGER generation_job_insert_guard;
--> statement-breakpoint
DROP TRIGGER generation_job_update_guard;
--> statement-breakpoint
DROP TRIGGER generation_job_delete_guard;
--> statement-breakpoint
DROP TRIGGER generation_event_insert_guard;
--> statement-breakpoint
DROP TRIGGER generation_event_update_guard;
--> statement-breakpoint
DROP TRIGGER generation_event_delete_guard;
--> statement-breakpoint
DROP TRIGGER generation_receipt_insert_guard;
--> statement-breakpoint
DROP TRIGGER generation_receipt_update_guard;
--> statement-breakpoint
DROP TRIGGER generation_receipt_delete_guard;
--> statement-breakpoint
DROP TRIGGER generation_dispatch_insert_guard;
--> statement-breakpoint
DROP TRIGGER generation_dispatch_update_guard;
--> statement-breakpoint
DROP TRIGGER generation_dispatch_delete_guard;
--> statement-breakpoint
DROP TRIGGER sermon_content_event_insert_guard;
--> statement-breakpoint
DROP TRIGGER ai_final_audit_insert_guard;
--> statement-breakpoint
DROP TRIGGER ai_provider_call_insert_guard;
--> statement-breakpoint
DROP TRIGGER generation_result_link_insert_guard;
--> statement-breakpoint
DROP TRIGGER generation_ai_receipt_success_guard;
--> statement-breakpoint
CREATE TABLE `ai_usage_observations` (
	`call_id` text PRIMARY KEY NOT NULL,
	`usage_event_id` text NOT NULL,
	`job_id` text NOT NULL,
	`sermon_id` text NOT NULL,
	`quiz_set_id` text NOT NULL,
	`step_key` text NOT NULL,
	`attempt` integer NOT NULL,
	`context_id` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`task` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`reasoning_effort` text,
	`provider_request_id_opaque` text,
	`input_tokens` integer,
	`cached_input_tokens` integer,
	`reasoning_tokens` integer,
	`output_tokens` integer,
	`audio_input_tokens` integer,
	`audio_seconds` integer,
	`pricing_version` text NOT NULL,
	`estimated_cost_micro_usd` integer NOT NULL,
	`usage_source` text NOT NULL,
	`started_at` text NOT NULL,
	`observed_at` text NOT NULL,
	`fingerprint` text NOT NULL,
	FOREIGN KEY (`call_id`) REFERENCES `ai_provider_calls`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`step_key`,`context_id`) REFERENCES `generation_step_contexts`(`job_id`,`step_key`,`context_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "ai_usage_observations_c0" CHECK(length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_usage_observations_c1" CHECK(length(input_fingerprint)=64 and input_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_usage_observations_c2" CHECK(typeof(attempt)='integer' and attempt between 1 and 9007199254740991),
	CONSTRAINT "ai_usage_observations_c3" CHECK(typeof(estimated_cost_micro_usd)='integer' and estimated_cost_micro_usd between 0 and 9007199254740991),
	CONSTRAINT "ai_usage_observations_c4" CHECK(usage_source in ('provider_reported','provider_partial')),
	CONSTRAINT "ai_usage_observations_c5" CHECK(observed_at>=started_at),
	CONSTRAINT "ai_usage_observations_c6" CHECK(input_tokens is not null or cached_input_tokens is not null or reasoning_tokens is not null or output_tokens is not null or audio_input_tokens is not null or audio_seconds is not null),
	CONSTRAINT "ai_usage_observations_c7" CHECK((input_tokens is null or (typeof(input_tokens)='integer' and input_tokens between 0 and 9007199254740991))),
	CONSTRAINT "ai_usage_observations_c8" CHECK((cached_input_tokens is null or (typeof(cached_input_tokens)='integer' and cached_input_tokens between 0 and 9007199254740991))),
	CONSTRAINT "ai_usage_observations_c9" CHECK((reasoning_tokens is null or (typeof(reasoning_tokens)='integer' and reasoning_tokens between 0 and 9007199254740991))),
	CONSTRAINT "ai_usage_observations_c10" CHECK((output_tokens is null or (typeof(output_tokens)='integer' and output_tokens between 0 and 9007199254740991))),
	CONSTRAINT "ai_usage_observations_c11" CHECK((audio_input_tokens is null or (typeof(audio_input_tokens)='integer' and audio_input_tokens between 0 and 9007199254740991))),
	CONSTRAINT "ai_usage_observations_c12" CHECK((audio_seconds is null or (typeof(audio_seconds)='integer' and audio_seconds between 0 and 9007199254740991)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_observations_u0` ON `ai_usage_observations` (`usage_event_id`);--> statement-breakpoint
CREATE TABLE `ai_usage_settlements` (
	`call_id` text PRIMARY KEY NOT NULL,
	`usage_event_id` text NOT NULL,
	`job_id` text NOT NULL,
	`step_key` text NOT NULL,
	`attempt` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`settled_at` text NOT NULL,
	FOREIGN KEY (`call_id`) REFERENCES `ai_usage_observations`(`call_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`usage_event_id`) REFERENCES `ai_usage_events`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`step_key`,`attempt`) REFERENCES `generation_step_outcomes`(`job_id`,`step_key`,`attempt`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "ai_usage_settlements_c0" CHECK(length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_settlements_u0` ON `ai_usage_settlements` (`usage_event_id`);--> statement-breakpoint
CREATE TABLE `generation_context_chunks` (
	`context_id` text NOT NULL,
	`position` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`sha256` text NOT NULL,
	`body` blob NOT NULL,
	`verified` integer NOT NULL,
	PRIMARY KEY(`context_id`, `position`),
	FOREIGN KEY (`context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_context_chunks_c0" CHECK(typeof(position)='integer' and position between 0 and 3),
	CONSTRAINT "generation_context_chunks_c1" CHECK(typeof(body)='blob' and byte_length=length(body) and byte_length between 1 and 16384),
	CONSTRAINT "generation_context_chunks_c2" CHECK(length(sha256)=64 and sha256 not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_context_chunks_c3" CHECK(verified=1)
);
--> statement-breakpoint
CREATE TABLE `generation_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`sermon_id` text NOT NULL,
	`quiz_set_id` text NOT NULL,
	`kind` text NOT NULL,
	`contract_version` integer NOT NULL,
	`validator_version` integer NOT NULL,
	`assembly_version` integer NOT NULL,
	`codec` text NOT NULL,
	`fingerprint` text NOT NULL,
	`byte_length` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`reference_count` integer NOT NULL,
	`state` text NOT NULL,
	`required_state` text NOT NULL,
	`created_at` text NOT NULL,
	`input_state` text NOT NULL,
	`input_version` integer,
	`source_id` text,
	`document_id` text,
	`document_sha256` text,
	`confirmation_id` text,
	`content_count` integer NOT NULL,
	`last_content_event_id` text,
	`analysis_event_id` text,
	`critique_event_id` text,
	`intent_confirmation_event_id` text,
	`summary_event_id` text,
	`summary_review_event_id` text,
	`child_event_id` text,
	`child_review_event_id` text,
	`adult_event_id` text,
	`adult_review_event_id` text,
	`metadata_revision` integer NOT NULL,
	`settings_revision` integer,
	`selection_revision` integer,
	`ticket_id` text,
	`ticket_fingerprint` text,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`id`,`required_state`) REFERENCES `generation_contexts`(`id`,`state`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`source_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`document_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`confirmation_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`last_content_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`analysis_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`critique_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`intent_confirmation_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`summary_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`summary_review_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`child_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`child_review_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`adult_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`adult_review_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`ticket_id`) REFERENCES `final_check_tickets`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_contexts_c0" CHECK(kind in ('request','step','wait')),
	CONSTRAINT "generation_contexts_c1" CHECK(contract_version=2 and validator_version=1 and assembly_version=1 and codec='generation-context-json-utf8-v1'),
	CONSTRAINT "generation_contexts_c2" CHECK(length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_contexts_c3" CHECK(state in ('assembling','sealed') and required_state='sealed'),
	CONSTRAINT "generation_contexts_c4" CHECK(typeof(byte_length)='integer' and byte_length between 1 and case when kind='wait' then 32768 else 65536 end and typeof(chunk_count)='integer' and chunk_count=(byte_length+16383)/16384),
	CONSTRAINT "generation_contexts_c5" CHECK(typeof(reference_count)='integer' and reference_count between 0 and 32),
	CONSTRAINT "generation_contexts_c6" CHECK(typeof(content_count)='integer' and content_count between 0 and 9007199254740991),
	CONSTRAINT "generation_contexts_c7" CHECK(typeof(metadata_revision)='integer' and metadata_revision between 1 and 9007199254740991),
	CONSTRAINT "generation_contexts_c8" CHECK((input_state='absent' and input_version is null and source_id is null and document_id is null and document_sha256 is null and confirmation_id is null) or (input_state='present' and input_version is not null and typeof(input_version)='integer' and input_version between 1 and 9007199254740991 and source_id is not null and document_id is not null and document_sha256 is not null and length(document_sha256)=64 and document_sha256 not glob '*[^0-9a-f]*')),
	CONSTRAINT "generation_contexts_c9" CHECK((content_count=0 and last_content_event_id is null and analysis_event_id is null and critique_event_id is null and intent_confirmation_event_id is null and summary_event_id is null and summary_review_event_id is null and child_event_id is null and child_review_event_id is null and adult_event_id is null and adult_review_event_id is null) or (content_count>0 and last_content_event_id is not null)),
	CONSTRAINT "generation_contexts_c10" CHECK((ticket_id is null and ticket_fingerprint is null) or (ticket_id is not null and ticket_fingerprint is not null and length(ticket_fingerprint)=64 and ticket_fingerprint not glob '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_contexts_u0` ON `generation_contexts` (`id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_contexts_u1` ON `generation_contexts` (`job_id`,`id`,`kind`);--> statement-breakpoint
CREATE TABLE `generation_control_commands` (
	`job_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`command_key` text NOT NULL,
	`wait_generation` integer NOT NULL,
	`context_id` text NOT NULL,
	`actor_digest` text NOT NULL,
	`fingerprint` text NOT NULL,
	`state` text NOT NULL,
	`step_key` text NOT NULL,
	`outcome_attempt` integer,
	`created_at` text NOT NULL,
	PRIMARY KEY(`job_id`, `ordinal`),
	FOREIGN KEY (`job_id`,`wait_generation`) REFERENCES `generation_wait_contexts`(`job_id`,`wait_generation`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`step_key`,`outcome_attempt`) REFERENCES `generation_step_outcomes`(`job_id`,`step_key`,`attempt`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_control_commands_c0" CHECK(typeof(ordinal)='integer' and ordinal between 1 and 9007199254740991),
	CONSTRAINT "generation_control_commands_c1" CHECK(length(actor_digest)=64 and actor_digest not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_control_commands_c2" CHECK(length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_control_commands_c3" CHECK(state in ('pending','running','succeeded','rejected','stale','uncertain')),
	CONSTRAINT "generation_control_commands_c4" CHECK(step_key='correction_' || ordinal)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_control_commands_u0` ON `generation_control_commands` (`job_id`,`command_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_control_commands_u1` ON `generation_control_commands` (`context_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_commands_one_open_job` ON `generation_control_commands` (`job_id`) WHERE state in ('pending','running','uncertain');--> statement-breakpoint
CREATE TABLE `generation_dispatch_attempts` (
	`dispatch_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`claim_token` text NOT NULL,
	`lease_expires_at` text NOT NULL,
	`state` text NOT NULL,
	`reserved_at` text NOT NULL,
	`send_started_at` text,
	`ended_at` text,
	PRIMARY KEY(`dispatch_id`, `attempt`),
	FOREIGN KEY (`dispatch_id`) REFERENCES `generation_job_dispatches`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_dispatch_attempts_c0" CHECK(typeof(attempt)='integer' and attempt between 1 and 9007199254740991),
	CONSTRAINT "generation_dispatch_attempts_c1" CHECK(state in ('reserved','send_started','expired','observed')),
	CONSTRAINT "generation_dispatch_attempts_c2" CHECK(lease_expires_at>reserved_at and ((state in ('reserved','expired') and send_started_at is null) or (state in ('send_started','observed') and send_started_at is not null and send_started_at>=reserved_at))),
	CONSTRAINT "generation_dispatch_attempts_c3" CHECK((state in ('expired','observed') and ended_at is not null) or (state in ('reserved','send_started') and ended_at is null))
);
--> statement-breakpoint
CREATE TABLE `generation_dispatch_receipts` (
	`dispatch_id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`workflow_instance_id` text NOT NULL,
	`request_context_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`payload_fingerprint` text NOT NULL,
	`context_id` text NOT NULL,
	`wait_generation` integer,
	`command_ordinal` integer,
	`event_no` integer NOT NULL,
	`state_version` integer NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`dispatch_id`) REFERENCES `generation_job_dispatches`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`request_context_id`) REFERENCES `generation_request_contexts`(`job_id`,`context_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`wait_generation`) REFERENCES `generation_wait_contexts`(`job_id`,`wait_generation`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`command_ordinal`) REFERENCES `generation_control_commands`(`job_id`,`ordinal`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`event_no`,`state_version`) REFERENCES `generation_transition_evidence`(`job_id`,`event_no`,`after_version`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_dispatch_receipts_c0" CHECK(length(request_fingerprint)=64 and request_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_dispatch_receipts_c1" CHECK(length(payload_fingerprint)=64 and payload_fingerprint not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_dispatch_receipts_u0` ON `generation_dispatch_receipts` (`job_id`,`event_no`);--> statement-breakpoint
CREATE TABLE `generation_request_contexts` (
	`job_id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_request_contexts_c0" CHECK(length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_request_contexts_u0` ON `generation_request_contexts` (`context_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_request_contexts_u1` ON `generation_request_contexts` (`job_id`,`context_id`);--> statement-breakpoint
CREATE TABLE `generation_step_contexts` (
	`job_id` text NOT NULL,
	`step_key` text NOT NULL,
	`context_id` text NOT NULL,
	`request_context_id` text NOT NULL,
	`task` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`predecessor_event_no` integer NOT NULL,
	`predecessor_state_version` integer NOT NULL,
	`predecessor_kind` text NOT NULL,
	`command_ordinal` integer,
	PRIMARY KEY(`job_id`, `step_key`),
	FOREIGN KEY (`job_id`,`step_key`) REFERENCES `generation_step_receipts`(`generation_job_id`,`step_key`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`request_context_id`) REFERENCES `generation_request_contexts`(`job_id`,`context_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`predecessor_event_no`,`predecessor_state_version`) REFERENCES `generation_transition_evidence`(`job_id`,`event_no`,`after_version`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`command_ordinal`) REFERENCES `generation_control_commands`(`job_id`,`ordinal`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_step_contexts_c0" CHECK(length(input_fingerprint)=64 and input_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_step_contexts_c1" CHECK(predecessor_kind in ('request','outcome','wait_consume'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_step_contexts_u0` ON `generation_step_contexts` (`context_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_step_contexts_u1` ON `generation_step_contexts` (`job_id`,`step_key`,`context_id`);--> statement-breakpoint
CREATE TABLE `generation_step_outcomes` (
	`job_id` text NOT NULL,
	`step_key` text NOT NULL,
	`attempt` integer NOT NULL,
	`context_id` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`task` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text NOT NULL,
	`event_no` integer NOT NULL,
	`state_version` integer NOT NULL,
	`call_id` text,
	`usage_event_id` text,
	`result_step_key` text,
	`before_input_version` integer,
	`after_input_version` integer,
	`before_content_count` integer NOT NULL,
	`after_content_count` integer NOT NULL,
	PRIMARY KEY(`job_id`, `step_key`, `attempt`),
	FOREIGN KEY (`job_id`,`step_key`,`context_id`) REFERENCES `generation_step_contexts`(`job_id`,`step_key`,`context_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`event_no`,`state_version`) REFERENCES `generation_transition_evidence`(`job_id`,`event_no`,`after_version`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`call_id`) REFERENCES `ai_provider_calls`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`usage_event_id`) REFERENCES `ai_usage_events`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`result_step_key`) REFERENCES `generation_step_result_links`(`generation_job_id`,`step_key`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_step_outcomes_c0" CHECK(typeof(attempt)='integer' and attempt between 1 and 9007199254740991),
	CONSTRAINT "generation_step_outcomes_c1" CHECK(length(input_fingerprint)=64 and input_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_step_outcomes_c2" CHECK(outcome in ('success','rejected','stale','uncertain')),
	CONSTRAINT "generation_step_outcomes_c3" CHECK(reason in ('none','domain_invalid','authority_changed','usage_unknown')),
	CONSTRAINT "generation_step_outcomes_c4" CHECK((outcome='success' and reason='none' and result_step_key=step_key and result_step_key is not null and call_id is not null and usage_event_id is not null) or (outcome<>'success' and reason<>'none' and result_step_key is null)),
	CONSTRAINT "generation_step_outcomes_c5" CHECK(typeof(before_content_count)='integer' and before_content_count between 0 and 9007199254740991),
	CONSTRAINT "generation_step_outcomes_c6" CHECK(typeof(after_content_count)='integer' and after_content_count between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_step_outcomes_u0` ON `generation_step_outcomes` (`job_id`,`event_no`);--> statement-breakpoint
CREATE TABLE `generation_transition_evidence` (
	`job_id` text NOT NULL,
	`event_no` integer NOT NULL,
	`before_version` integer,
	`after_version` integer NOT NULL,
	`before_status` text,
	`after_status` text NOT NULL,
	`before_stage` text,
	`after_stage` text NOT NULL,
	`before_wait` integer,
	`after_wait` integer,
	`reason` text NOT NULL,
	`context_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`step_key` text,
	`attempt` integer,
	`dispatch_id` text,
	`command_ordinal` integer,
	PRIMARY KEY(`job_id`, `event_no`),
	FOREIGN KEY (`job_id`,`event_no`,`after_version`) REFERENCES `generation_job_events`(`generation_job_id`,`event_no`,`job_state_version`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`dispatch_id`) REFERENCES `generation_job_dispatches`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`command_ordinal`) REFERENCES `generation_control_commands`(`job_id`,`ordinal`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_transition_evidence_c0" CHECK(typeof(event_no)='integer' and event_no between 1 and 9007199254740991),
	CONSTRAINT "generation_transition_evidence_c1" CHECK(typeof(after_version)='integer' and after_version between 0 and 9007199254740991),
	CONSTRAINT "generation_transition_evidence_c2" CHECK((before_version is null and before_status is null and before_stage is null and before_wait is null and event_no=1 and after_version=0 and reason='job_created' and after_status='dispatch_pending') or (before_version is not null and before_status is not null and before_stage is not null and after_version=before_version+1 and event_no=after_version+1 and reason<>'job_created')),
	CONSTRAINT "generation_transition_evidence_c3" CHECK(reason in ('job_created','received','step_succeeded','step_rejected','step_stale','step_uncertain','stage_completed','wait_entered','review_ready','needs_revision','job_stale')),
	CONSTRAINT "generation_transition_evidence_c4" CHECK(length(fingerprint)=64 and fingerprint not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_transition_evidence_u0` ON `generation_transition_evidence` (`job_id`,`event_no`,`after_version`);--> statement-breakpoint
CREATE TABLE `generation_wait_contexts` (
	`job_id` text NOT NULL,
	`wait_generation` integer NOT NULL,
	`context_id` text NOT NULL,
	`request_context_id` text NOT NULL,
	`kind` text NOT NULL,
	`enter_event_no` integer NOT NULL,
	`enter_state_version` integer NOT NULL,
	`parent_wait_generation` integer,
	`command_ordinal` integer,
	`parent_step_key` text,
	`parent_attempt` integer,
	PRIMARY KEY(`job_id`, `wait_generation`),
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`request_context_id`) REFERENCES `generation_request_contexts`(`job_id`,`context_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`enter_event_no`,`enter_state_version`) REFERENCES `generation_transition_evidence`(`job_id`,`event_no`,`after_version`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`parent_wait_generation`) REFERENCES `generation_wait_contexts`(`job_id`,`wait_generation`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`command_ordinal`) REFERENCES `generation_control_commands`(`job_id`,`ordinal`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`job_id`,`parent_step_key`,`parent_attempt`) REFERENCES `generation_step_outcomes`(`job_id`,`step_key`,`attempt`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_wait_contexts_c0" CHECK(typeof(wait_generation)='integer' and wait_generation between 1 and 9007199254740991),
	CONSTRAINT "generation_wait_contexts_c1" CHECK(kind in ('transcript_review','intent_review')),
	CONSTRAINT "generation_wait_contexts_c2" CHECK((parent_wait_generation is null and command_ordinal is null and parent_step_key is null and parent_attempt is null) or (parent_wait_generation is not null and parent_wait_generation<wait_generation and command_ordinal is not null and ((parent_step_key is null and parent_attempt is null) or (parent_step_key is not null and parent_attempt is not null))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_wait_contexts_u0` ON `generation_wait_contexts` (`context_id`);--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE `__new_generation_job_dispatches` (
	`context_id` text,
	`command_ordinal` integer,
	`required_attempt` integer,
	`receiver_dispatch_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`generation_job_id` text NOT NULL,
	`dispatch_no` integer NOT NULL,
	`kind` text NOT NULL,
	`dispatch_key` text NOT NULL,
	`workflow_instance_id` text NOT NULL,
	`job_state_version` integer NOT NULL,
	`wait_generation` integer,
	`payload_fingerprint` text NOT NULL,
	`state` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`claim_token` text,
	`lease_expires_at` text,
	`error_code` text,
	`error_message_safe` text,
	`error_fingerprint` text,
	`created_at` text NOT NULL,
	`last_attempted_at` text,
	`acknowledged_at` text,
	FOREIGN KEY (`generation_job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`generation_job_id`,`command_ordinal`) REFERENCES `generation_control_commands`(`job_id`,`ordinal`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`id`,`required_attempt`) REFERENCES `generation_dispatch_attempts`(`dispatch_id`,`attempt`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`receiver_dispatch_id`) REFERENCES `generation_dispatch_receipts`(`dispatch_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_job_dispatches_id_check" CHECK(length(id) between 1 and 128),
	CONSTRAINT "generation_job_dispatches_number_check" CHECK(typeof(dispatch_no) = 'integer' and dispatch_no between 1 and 9007199254740991 and typeof(job_state_version) = 'integer' and job_state_version between 0 and 9007199254740991),
	CONSTRAINT "generation_job_dispatches_kind_check" CHECK((kind = 'start' and dispatch_no = 1 and wait_generation is null) or (kind in ('resume_transcript_review','resume_intent_review','correction') and typeof(wait_generation) = 'integer' and wait_generation between 1 and 9007199254740991)),
	CONSTRAINT "generation_job_dispatches_key_check" CHECK(length(dispatch_key) between 1 and 128),
	CONSTRAINT "generation_job_dispatches_workflow_check" CHECK(length(workflow_instance_id) between 1 and 128),
	CONSTRAINT "generation_job_dispatches_payload_check" CHECK(length(payload_fingerprint) = 64 and payload_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_job_dispatches_state_check" CHECK(state in ('pending','claimed','acknowledged','retryable_failed','uncertain','terminal_failed','stale')),
	CONSTRAINT "generation_job_dispatches_attempt_check" CHECK(typeof(attempt_count) = 'integer' and attempt_count between 0 and 9007199254740991),
	CONSTRAINT "generation_job_dispatches_claim_check" CHECK((state = 'claimed' and claim_token is not null and length(claim_token) between 1 and 128 and lease_expires_at is not null) or (state <> 'claimed' and claim_token is null and lease_expires_at is null)),
	CONSTRAINT "generation_job_dispatches_ack_check" CHECK((state = 'acknowledged' and acknowledged_at is not null) or (state <> 'acknowledged' and acknowledged_at is null)),
	CONSTRAINT "generation_job_dispatches_error_check" CHECK((error_code is null and error_message_safe is null and error_fingerprint is null) or (length(error_code) between 1 and 64 and error_code not glob '*[^A-Z0-9_]*' and error_message_safe = error_code and length(error_fingerprint) = 64 and error_fingerprint not glob '*[^0-9a-f]*')),
	CONSTRAINT "generation_job_dispatches_attempt_time_check" CHECK(last_attempted_at is null or last_attempted_at >= created_at)
);
--> statement-breakpoint
INSERT INTO `__new_generation_job_dispatches`("context_id", "command_ordinal", "required_attempt", "receiver_dispatch_id", "id", "generation_job_id", "dispatch_no", "kind", "dispatch_key", "workflow_instance_id", "job_state_version", "wait_generation", "payload_fingerprint", "state", "attempt_count", "claim_token", "lease_expires_at", "error_code", "error_message_safe", "error_fingerprint", "created_at", "last_attempted_at", "acknowledged_at") SELECT NULL, NULL, NULL, NULL, "id", "generation_job_id", "dispatch_no", "kind", "dispatch_key", "workflow_instance_id", "job_state_version", "wait_generation", "payload_fingerprint", "state", "attempt_count", "claim_token", "lease_expires_at", "error_code", "error_message_safe", "error_fingerprint", "created_at", "last_attempted_at", "acknowledged_at" FROM `generation_job_dispatches`;--> statement-breakpoint
DROP TABLE `generation_job_dispatches`;--> statement-breakpoint
ALTER TABLE `__new_generation_job_dispatches` RENAME TO `generation_job_dispatches`;--> statement-breakpoint
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_job_dispatches_key_uidx` ON `generation_job_dispatches` (`dispatch_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_job_dispatches_job_no_uidx` ON `generation_job_dispatches` (`generation_job_id`,`dispatch_no`);--> statement-breakpoint
CREATE TABLE `__new_generation_job_events` (
	`generation_job_id` text NOT NULL,
	`event_no` integer NOT NULL,
	`job_state_version` integer NOT NULL,
	`attempt_number` integer NOT NULL,
	`step_key` text,
	`level` text NOT NULL,
	`event_code` text NOT NULL,
	`message_safe` text NOT NULL,
	`metadata_json_safe` text,
	`elapsed_ms` integer,
	`created_at` text NOT NULL,
	PRIMARY KEY(`generation_job_id`, `event_no`),
	FOREIGN KEY (`generation_job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "generation_job_events_number_check" CHECK(typeof(event_no) = 'integer' and event_no between 1 and 9007199254740991 and typeof(job_state_version) = 'integer' and job_state_version between 0 and 9007199254740991 and typeof(attempt_number) = 'integer' and attempt_number between 1 and 9007199254740991),
	CONSTRAINT "generation_job_events_step_key_check" CHECK(step_key is null or length(step_key) between 1 and 128),
	CONSTRAINT "generation_job_events_level_check" CHECK(level in ('info','warning','error')),
	CONSTRAINT "generation_job_events_code_check" CHECK(event_code in ('job_created','dispatch_acknowledged','state_changed','step_succeeded','job_stale','job_failed','received','step_rejected','step_stale','step_uncertain','stage_completed','wait_entered','review_ready','needs_revision') and message_safe = event_code),
	CONSTRAINT "generation_job_events_metadata_check" CHECK(metadata_json_safe is null or (length(metadata_json_safe) between 2 and 2048 and json_valid(metadata_json_safe) and json_type(metadata_json_safe) = 'object')),
	CONSTRAINT "generation_job_events_elapsed_check" CHECK(elapsed_ms is null or (typeof(elapsed_ms) = 'integer' and elapsed_ms between 0 and 86400000))
);
--> statement-breakpoint
INSERT INTO `__new_generation_job_events`("generation_job_id", "event_no", "job_state_version", "attempt_number", "step_key", "level", "event_code", "message_safe", "metadata_json_safe", "elapsed_ms", "created_at") SELECT "generation_job_id", "event_no", "job_state_version", "attempt_number", "step_key", "level", "event_code", "message_safe", "metadata_json_safe", "elapsed_ms", "created_at" FROM `generation_job_events`;--> statement-breakpoint
DROP TABLE `generation_job_events`;--> statement-breakpoint
ALTER TABLE `__new_generation_job_events` RENAME TO `generation_job_events`;--> statement-breakpoint
CREATE UNIQUE INDEX `generation_job_events_required_uidx` ON `generation_job_events` (`generation_job_id`,`event_no`,`job_state_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_job_events_state_uidx` ON `generation_job_events` (`generation_job_id`,`job_state_version`);--> statement-breakpoint
CREATE TABLE `__new_generation_jobs` (
	`request_context_id` text,
	`evidence_event_no` integer,
	`active_wait_generation` integer,
	`id` text PRIMARY KEY NOT NULL,
	`sermon_id` text NOT NULL,
	`quiz_set_id` text NOT NULL,
	`request_scope` text NOT NULL,
	`request_contract_version` integer NOT NULL,
	`request_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`workflow_instance_id` text NOT NULL,
	`start_input_state` text NOT NULL,
	`start_input_version` integer,
	`start_source_id` text,
	`start_document_id` text,
	`start_document_sha256` text,
	`start_confirmation_id` text,
	`start_metadata_revision` integer NOT NULL,
	`settings_revision` integer,
	`selection_revision` integer,
	`status` text NOT NULL,
	`current_step` text NOT NULL,
	`state_version` integer NOT NULL,
	`event_count` integer NOT NULL,
	`wait_kind` text,
	`wait_generation` integer NOT NULL,
	`wait_input_fingerprint` text,
	`error_code` text,
	`error_message_safe` text,
	`error_fingerprint` text,
	`created_by_actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	`required_event_no` integer NOT NULL,
	`required_event_state_version` integer NOT NULL,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`id`,`request_context_id`) REFERENCES `generation_request_contexts`(`job_id`,`context_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`id`,`evidence_event_no`) REFERENCES `generation_transition_evidence`(`job_id`,`event_no`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`id`,`active_wait_generation`) REFERENCES `generation_wait_contexts`(`job_id`,`wait_generation`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`id`,`required_event_no`,`required_event_state_version`) REFERENCES `generation_job_events`(`generation_job_id`,`event_no`,`job_state_version`) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`start_source_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`start_document_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`start_confirmation_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "generation_jobs_v2_links" CHECK((request_contract_version=1 and request_context_id is null and evidence_event_no is null and active_wait_generation is null) or (request_contract_version=2 and request_context_id is not null and evidence_event_no is not null and evidence_event_no=event_count and ((wait_kind is null and active_wait_generation is null) or (wait_kind is not null and active_wait_generation is not null and active_wait_generation=wait_generation)))),
	CONSTRAINT "generation_jobs_id_check" CHECK(length(id) between 1 and 128),
	CONSTRAINT "generation_jobs_scope_check" CHECK(request_scope in ('full','transcript_correction','intent','summary','child','adult','single_entry','final_audit')),
	CONSTRAINT "generation_jobs_contract_check" CHECK(request_contract_version in (1,2)),
	CONSTRAINT "generation_jobs_request_key_check" CHECK(length(request_key) between 1 and 128),
	CONSTRAINT "generation_jobs_request_fingerprint_check" CHECK(length(request_fingerprint) = 64 and request_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_jobs_workflow_instance_check" CHECK(length(workflow_instance_id) between 1 and 128),
	CONSTRAINT "generation_jobs_input_state_check" CHECK((start_input_state = 'absent' and start_input_version is null and start_source_id is null and start_document_id is null and start_document_sha256 is null and start_confirmation_id is null) or (start_input_state = 'present' and typeof(start_input_version) = 'integer' and start_input_version between 1 and 9007199254740991 and start_source_id is not null and start_document_id is not null and length(start_document_sha256) = 64 and start_document_sha256 not glob '*[^0-9a-f]*')),
	CONSTRAINT "generation_jobs_metadata_revision_check" CHECK(typeof(start_metadata_revision) = 'integer' and start_metadata_revision between 1 and 9007199254740991),
	CONSTRAINT "generation_jobs_optional_revision_check" CHECK((settings_revision is null or (typeof(settings_revision) = 'integer' and settings_revision between 1 and 9007199254740991)) and (selection_revision is null or (typeof(selection_revision) = 'integer' and selection_revision between 1 and 9007199254740991))),
	CONSTRAINT "generation_jobs_status_check" CHECK(status in ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review','review_ready','needs_revision','stale','failed')),
	CONSTRAINT "generation_jobs_current_step_check" CHECK(length(current_step) between 1 and 128),
	CONSTRAINT "generation_jobs_counter_check" CHECK(typeof(state_version) = 'integer' and state_version between 0 and 9007199254740991 and typeof(event_count) = 'integer' and event_count between 1 and 9007199254740991 and required_event_no = event_count and required_event_state_version = state_version),
	CONSTRAINT "generation_jobs_wait_check" CHECK(typeof(wait_generation) = 'integer' and wait_generation between 0 and 9007199254740991 and ((status = 'awaiting_transcript_review' and wait_kind = 'transcript_review' and wait_generation >= 1 and length(wait_input_fingerprint) = 64 and wait_input_fingerprint not glob '*[^0-9a-f]*') or (status = 'awaiting_intent_review' and wait_kind = 'intent_review' and wait_generation >= 1 and length(wait_input_fingerprint) = 64 and wait_input_fingerprint not glob '*[^0-9a-f]*') or (status not in ('awaiting_transcript_review','awaiting_intent_review') and wait_kind is null and wait_input_fingerprint is null))),
	CONSTRAINT "generation_jobs_error_check" CHECK((error_code is null and error_message_safe is null and error_fingerprint is null) or (length(error_code) between 1 and 64 and error_code not glob '*[^A-Z0-9_]*' and error_message_safe = error_code and length(error_fingerprint) = 64 and error_fingerprint not glob '*[^0-9a-f]*')),
	CONSTRAINT "generation_jobs_actor_check" CHECK(length(created_by_actor_id) = 64 and created_by_actor_id not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_jobs_time_check" CHECK(updated_at >= created_at and (completed_at is null or completed_at >= created_at))
);
--> statement-breakpoint
INSERT INTO `__new_generation_jobs`("request_context_id", "evidence_event_no", "active_wait_generation", "id", "sermon_id", "quiz_set_id", "request_scope", "request_contract_version", "request_key", "request_fingerprint", "workflow_instance_id", "start_input_state", "start_input_version", "start_source_id", "start_document_id", "start_document_sha256", "start_confirmation_id", "start_metadata_revision", "settings_revision", "selection_revision", "status", "current_step", "state_version", "event_count", "wait_kind", "wait_generation", "wait_input_fingerprint", "error_code", "error_message_safe", "error_fingerprint", "created_by_actor_id", "created_at", "updated_at", "completed_at", "required_event_no", "required_event_state_version") SELECT NULL, NULL, NULL, "id", "sermon_id", "quiz_set_id", "request_scope", "request_contract_version", "request_key", "request_fingerprint", "workflow_instance_id", "start_input_state", "start_input_version", "start_source_id", "start_document_id", "start_document_sha256", "start_confirmation_id", "start_metadata_revision", "settings_revision", "selection_revision", "status", "current_step", "state_version", "event_count", "wait_kind", "wait_generation", "wait_input_fingerprint", "error_code", "error_message_safe", "error_fingerprint", "created_by_actor_id", "created_at", "updated_at", "completed_at", "required_event_no", "required_event_state_version" FROM `generation_jobs`;--> statement-breakpoint
DROP TABLE `generation_jobs`;--> statement-breakpoint
ALTER TABLE `__new_generation_jobs` RENAME TO `generation_jobs`;--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_request_key_uidx` ON `generation_jobs` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_workflow_instance_uidx` ON `generation_jobs` (`workflow_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_required_event_uidx` ON `generation_jobs` (`id`,`required_event_no`,`required_event_state_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_one_active_quiz_set_uidx` ON `generation_jobs` (`quiz_set_id`) WHERE "generation_jobs"."status" in ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review');--> statement-breakpoint
CREATE TABLE `__new_generation_step_receipts` (
	`context_id` text,
	`outcome_attempt` integer,
	`generation_job_id` text NOT NULL,
	`step_key` text NOT NULL,
	`task` text NOT NULL,
	`effect_class` text NOT NULL,
	`input_contract_version` integer NOT NULL,
	`input_fingerprint` text NOT NULL,
	`input_version` integer,
	`source_id` text,
	`document_id` text,
	`document_sha256` text,
	`confirmation_id` text,
	`metadata_revision` integer,
	`binding_id` text,
	`ticket_id` text,
	`state` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`claim_token` text,
	`lease_expires_at` text,
	`provider_request_id_opaque` text,
	`result_kind` text,
	`result_id` text,
	`result_version` integer,
	`result_fingerprint` text,
	`error_code` text,
	`error_message_safe` text,
	`error_fingerprint` text,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	PRIMARY KEY(`generation_job_id`, `step_key`),
	FOREIGN KEY (`generation_job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_job_id`,`step_key`,`context_id`) REFERENCES `generation_step_contexts`(`job_id`,`step_key`,`context_id`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`generation_job_id`,`step_key`,`outcome_attempt`) REFERENCES `generation_step_outcomes`(`job_id`,`step_key`,`attempt`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_step_receipts_step_key_check" CHECK(length(step_key) between 1 and 128),
	CONSTRAINT "generation_step_receipts_task_check" CHECK(task in ('fetch_transcript','correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','place_grid','validate','final_audit')),
	CONSTRAINT "generation_step_receipts_effect_check" CHECK(effect_class in ('pure','source_network','ai_provider','domain_write')),
	CONSTRAINT "generation_step_receipts_input_check" CHECK(input_contract_version in (1,2) and length(input_fingerprint) = 64 and input_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_step_receipts_input_tuple_check" CHECK((input_version is null and source_id is null and document_id is null and document_sha256 is null and confirmation_id is null) or (typeof(input_version) = 'integer' and input_version between 1 and 9007199254740991 and source_id is not null and document_id is not null and length(document_sha256) = 64 and document_sha256 not glob '*[^0-9a-f]*')),
	CONSTRAINT "generation_step_receipts_optional_revision_check" CHECK(metadata_revision is null or (typeof(metadata_revision) = 'integer' and metadata_revision between 1 and 9007199254740991)),
	CONSTRAINT "generation_step_receipts_binding_check" CHECK((binding_id is null or length(binding_id) between 1 and 128) and (ticket_id is null or length(ticket_id) between 1 and 128)),
	CONSTRAINT "generation_step_receipts_state_check" CHECK(state in ('claimed','effect_started','succeeded','retryable_failed','uncertain','terminal_failed','stale')),
	CONSTRAINT "generation_step_receipts_attempt_check" CHECK(typeof(attempt_count) = 'integer' and attempt_count between 1 and 9007199254740991),
	CONSTRAINT "generation_step_receipts_claim_check" CHECK((state in ('claimed','effect_started') and claim_token is not null and length(claim_token) between 1 and 128 and lease_expires_at is not null) or (state not in ('claimed','effect_started') and claim_token is null and lease_expires_at is null)),
	CONSTRAINT "generation_step_receipts_provider_check" CHECK(provider_request_id_opaque is null or (length(provider_request_id_opaque) = 64 and provider_request_id_opaque not glob '*[^0-9a-f]*')),
	CONSTRAINT "generation_step_receipts_result_check" CHECK((state = 'succeeded' and result_kind is not null and length(result_kind) between 1 and 64 and result_id is not null and length(result_id) between 1 and 128 and typeof(result_version) = 'integer' and result_version between 1 and 9007199254740991 and length(result_fingerprint) = 64 and result_fingerprint not glob '*[^0-9a-f]*' and completed_at is not null) or (state <> 'succeeded' and result_kind is null and result_id is null and result_version is null and result_fingerprint is null)),
	CONSTRAINT "generation_step_receipts_error_check" CHECK((error_code is null and error_message_safe is null and error_fingerprint is null) or (length(error_code) between 1 and 64 and error_code not glob '*[^A-Z0-9_]*' and error_message_safe = error_code and length(error_fingerprint) = 64 and error_fingerprint not glob '*[^0-9a-f]*')),
	CONSTRAINT "generation_step_receipts_time_check" CHECK(updated_at >= started_at and (completed_at is null or completed_at >= started_at))
);
--> statement-breakpoint
INSERT INTO `__new_generation_step_receipts`("context_id", "outcome_attempt", "generation_job_id", "step_key", "task", "effect_class", "input_contract_version", "input_fingerprint", "input_version", "source_id", "document_id", "document_sha256", "confirmation_id", "metadata_revision", "binding_id", "ticket_id", "state", "attempt_count", "claim_token", "lease_expires_at", "provider_request_id_opaque", "result_kind", "result_id", "result_version", "result_fingerprint", "error_code", "error_message_safe", "error_fingerprint", "started_at", "updated_at", "completed_at") SELECT NULL, NULL, "generation_job_id", "step_key", "task", "effect_class", "input_contract_version", "input_fingerprint", "input_version", "source_id", "document_id", "document_sha256", "confirmation_id", "metadata_revision", "binding_id", "ticket_id", "state", "attempt_count", "claim_token", "lease_expires_at", "provider_request_id_opaque", "result_kind", "result_id", "result_version", "result_fingerprint", "error_code", "error_message_safe", "error_fingerprint", "started_at", "updated_at", "completed_at" FROM `generation_step_receipts`;--> statement-breakpoint
DROP TABLE `generation_step_receipts`;--> statement-breakpoint
ALTER TABLE `__new_generation_step_receipts` RENAME TO `generation_step_receipts`;--> statement-breakpoint
CREATE UNIQUE INDEX `generation_receipts_one_open_job` ON `generation_step_receipts` (`generation_job_id`) WHERE state in ('claimed','effect_started','uncertain');--> statement-breakpoint
ALTER TABLE `ai_provider_calls` ADD `settlement_call_id` text REFERENCES ai_usage_settlements(call_id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TRIGGER generation_job_insert_guard BEFORE INSERT ON generation_jobs BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = NEW.id OR j.request_key = NEW.request_key OR j.workflow_instance_id = NEW.workflow_instance_id)
    OR NOT EXISTS (SELECT 1 FROM quiz_sets q WHERE q.id = NEW.quiz_set_id AND q.sermon_id = NEW.sermon_id)
    OR NOT EXISTS (SELECT 1 FROM sermon_metadata_drafts m WHERE m.sermon_id = NEW.sermon_id AND m.metadata_revision = NEW.start_metadata_revision)
    OR NEW.status <> 'dispatch_pending' OR NEW.current_step <> 'dispatch'
    OR NEW.state_version <> 0 OR NEW.event_count <> 1
    OR NEW.required_event_no <> 1 OR NEW.required_event_state_version <> 0
    OR NEW.wait_generation <> 0 OR NEW.completed_at IS NOT NULL
    OR (NEW.start_input_state = 'absent' AND EXISTS (SELECT 1 FROM sermon_input_heads h WHERE h.sermon_id = NEW.sermon_id))
    OR (NEW.start_input_state = 'present' AND NOT EXISTS (
      SELECT 1 FROM sermon_input_heads h
      JOIN sermon_input_events s ON s.sermon_id = h.sermon_id AND s.id = NEW.start_source_id AND s.kind = 'source' AND s.state = 'sealed'
      JOIN sermon_input_events d ON d.sermon_id = h.sermon_id AND d.id = NEW.start_document_id AND d.source_id = s.id AND d.document_sha256 = NEW.start_document_sha256 AND d.state = 'sealed'
      LEFT JOIN sermon_input_events c ON c.sermon_id = h.sermon_id AND c.id = NEW.start_confirmation_id AND c.source_id = s.id AND c.document_id = d.id AND c.kind = 'confirm' AND c.state = 'sealed'
      WHERE h.sermon_id = NEW.sermon_id AND h.version = NEW.start_input_version
        AND (NEW.start_confirmation_id IS NULL OR c.id IS NOT NULL)
    ))
    THEN RAISE(ABORT, 'generation job insert rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_job_update_guard BEFORE UPDATE ON generation_jobs BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.sermon_id IS NOT OLD.sermon_id OR NEW.quiz_set_id IS NOT OLD.quiz_set_id
    OR NEW.request_scope IS NOT OLD.request_scope OR NEW.request_contract_version IS NOT OLD.request_contract_version
    OR NEW.request_key IS NOT OLD.request_key OR NEW.request_fingerprint IS NOT OLD.request_fingerprint
    OR NEW.workflow_instance_id IS NOT OLD.workflow_instance_id OR NEW.start_input_state IS NOT OLD.start_input_state
    OR NEW.start_input_version IS NOT OLD.start_input_version OR NEW.start_source_id IS NOT OLD.start_source_id
    OR NEW.start_document_id IS NOT OLD.start_document_id OR NEW.start_document_sha256 IS NOT OLD.start_document_sha256
    OR NEW.start_confirmation_id IS NOT OLD.start_confirmation_id OR NEW.start_metadata_revision IS NOT OLD.start_metadata_revision
    OR NEW.settings_revision IS NOT OLD.settings_revision OR NEW.selection_revision IS NOT OLD.selection_revision
    OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id OR NEW.created_at IS NOT OLD.created_at
    OR NEW.state_version <> OLD.state_version + 1 OR NEW.event_count <> OLD.event_count + 1
    OR NEW.required_event_no <> NEW.event_count OR NEW.required_event_state_version <> NEW.state_version
    OR OLD.status IN ('review_ready','needs_revision','stale','failed')
    OR NOT ((OLD.status = 'queued' AND NEW.status IN ('dispatch_pending','failed','stale'))
      OR (OLD.status = 'dispatch_pending' AND NEW.status IN ('running','failed','stale'))
      OR (OLD.status = 'running' AND NEW.status IN ('running','awaiting_transcript_review','awaiting_intent_review','review_ready','needs_revision','failed','stale'))
      OR (OLD.status = 'awaiting_transcript_review' AND NEW.status IN ('running','awaiting_transcript_review','failed','stale'))
      OR (OLD.status = 'awaiting_intent_review' AND NEW.status IN ('running','failed','stale')))
    OR (NEW.status IN ('review_ready','needs_revision','stale','failed') AND NEW.completed_at IS NULL)
    OR (NEW.status NOT IN ('review_ready','needs_revision','stale','failed') AND NEW.completed_at IS NOT NULL)
    THEN RAISE(ABORT, 'generation job transition rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_job_delete_guard BEFORE DELETE ON generation_jobs BEGIN
  SELECT RAISE(ABORT, 'immutable generation job');
END;
--> statement-breakpoint
CREATE TRIGGER generation_event_insert_guard BEFORE INSERT ON generation_job_events BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = NEW.generation_job_id
      AND j.event_count = NEW.event_no AND j.state_version = NEW.job_state_version
      AND j.required_event_no = NEW.event_no AND j.required_event_state_version = NEW.job_state_version)
    OR (NEW.event_code = 'job_created' AND (NEW.event_no <> 1 OR NEW.job_state_version <> 0 OR NOT EXISTS (
      SELECT 1 FROM generation_job_dispatches d JOIN generation_jobs j ON j.id = d.generation_job_id
      WHERE d.generation_job_id = NEW.generation_job_id AND d.dispatch_no = 1 AND d.kind = 'start'
        AND d.state = 'pending' AND d.job_state_version = 0 AND d.workflow_instance_id = j.workflow_instance_id)))
    OR (NEW.event_code = 'dispatch_acknowledged' AND NOT EXISTS (
      SELECT 1 FROM generation_job_dispatches d WHERE d.generation_job_id = NEW.generation_job_id AND d.state = 'acknowledged'))
    OR (NEW.event_code = 'step_succeeded' AND (NEW.step_key IS NULL OR NOT EXISTS (
      SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id = NEW.generation_job_id AND r.step_key = NEW.step_key AND r.state = 'succeeded')))
    OR (NEW.event_code = 'job_stale' AND NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = NEW.generation_job_id AND j.status = 'stale'))
    OR (NEW.event_code = 'job_failed' AND NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = NEW.generation_job_id AND j.status = 'failed'))
    OR EXISTS (SELECT 1 FROM json_each(coalesce(NEW.metadata_json_safe, '{}'))
      WHERE key NOT IN ('jobId','eventCode','stepKey','attempt','durationMs','count','providerRequestIdOpaque'))
    OR (json_type(NEW.metadata_json_safe, '$.jobId') IS NOT NULL AND json_extract(NEW.metadata_json_safe, '$.jobId') IS NOT NEW.generation_job_id)
    OR (json_type(NEW.metadata_json_safe, '$.eventCode') IS NOT NULL AND json_extract(NEW.metadata_json_safe, '$.eventCode') IS NOT NEW.event_code)
    OR (json_type(NEW.metadata_json_safe, '$.stepKey') IS NOT NULL AND json_extract(NEW.metadata_json_safe, '$.stepKey') IS NOT NEW.step_key)
    OR (json_type(NEW.metadata_json_safe, '$.attempt') IS NOT NULL AND (json_type(NEW.metadata_json_safe, '$.attempt') <> 'integer' OR json_extract(NEW.metadata_json_safe, '$.attempt') < 1))
    OR (json_type(NEW.metadata_json_safe, '$.durationMs') IS NOT NULL AND (json_type(NEW.metadata_json_safe, '$.durationMs') <> 'integer' OR json_extract(NEW.metadata_json_safe, '$.durationMs') < 0))
    OR (json_type(NEW.metadata_json_safe, '$.count') IS NOT NULL AND (json_type(NEW.metadata_json_safe, '$.count') <> 'integer' OR json_extract(NEW.metadata_json_safe, '$.count') < 0))
    OR (json_type(NEW.metadata_json_safe, '$.providerRequestIdOpaque') IS NOT NULL AND (
      json_type(NEW.metadata_json_safe, '$.providerRequestIdOpaque') <> 'text'
      OR length(json_extract(NEW.metadata_json_safe, '$.providerRequestIdOpaque')) <> 64
      OR json_extract(NEW.metadata_json_safe, '$.providerRequestIdOpaque') glob '*[^0-9a-f]*'))
    THEN RAISE(ABORT, 'generation event rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_event_update_guard BEFORE UPDATE ON generation_job_events BEGIN
  SELECT RAISE(ABORT, 'immutable generation event');
END;
--> statement-breakpoint
CREATE TRIGGER generation_event_delete_guard BEFORE DELETE ON generation_job_events BEGIN
  SELECT RAISE(ABORT, 'immutable generation event');
END;
--> statement-breakpoint
CREATE TRIGGER generation_receipt_insert_guard BEFORE INSERT ON generation_step_receipts BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id = NEW.generation_job_id AND r.step_key = NEW.step_key)
    OR NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = NEW.generation_job_id AND j.status IN ('running','awaiting_transcript_review','awaiting_intent_review'))
    OR NEW.state <> 'claimed' OR NEW.attempt_count <> 1
    OR NEW.claim_token IS NULL OR NEW.lease_expires_at IS NULL OR NEW.updated_at IS NOT NEW.started_at
    THEN RAISE(ABORT, 'generation receipt insert rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_receipt_update_guard BEFORE UPDATE ON generation_step_receipts BEGIN
  SELECT CASE WHEN NEW.generation_job_id IS NOT OLD.generation_job_id OR NEW.step_key IS NOT OLD.step_key
    OR NEW.task IS NOT OLD.task OR NEW.effect_class IS NOT OLD.effect_class
    OR NEW.input_contract_version IS NOT OLD.input_contract_version OR NEW.input_fingerprint IS NOT OLD.input_fingerprint
    OR NEW.input_version IS NOT OLD.input_version OR NEW.source_id IS NOT OLD.source_id OR NEW.document_id IS NOT OLD.document_id
    OR NEW.document_sha256 IS NOT OLD.document_sha256 OR NEW.confirmation_id IS NOT OLD.confirmation_id
    OR NEW.metadata_revision IS NOT OLD.metadata_revision OR NEW.binding_id IS NOT OLD.binding_id OR NEW.ticket_id IS NOT OLD.ticket_id
    OR NEW.started_at IS NOT OLD.started_at OR OLD.state IN ('succeeded','terminal_failed','stale')
    OR NOT ((OLD.state = 'claimed' AND NEW.state IN ('claimed','effect_started','succeeded','retryable_failed','uncertain','terminal_failed','stale'))
      OR (OLD.state = 'effect_started' AND NEW.state IN ('succeeded','uncertain','terminal_failed','stale'))
      OR (OLD.state = 'retryable_failed' AND NEW.state IN ('claimed','terminal_failed','stale'))
      OR (OLD.state = 'uncertain' AND NEW.state IN ('succeeded','terminal_failed','stale')))
    OR (NEW.state = 'claimed' AND NEW.attempt_count <> OLD.attempt_count + 1)
    OR (NEW.state <> 'claimed' AND NEW.attempt_count <> OLD.attempt_count)
    THEN RAISE(ABORT, 'generation receipt transition rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_receipt_delete_guard BEFORE DELETE ON generation_step_receipts BEGIN
  SELECT RAISE(ABORT, 'immutable generation receipt');
END;
--> statement-breakpoint
CREATE TRIGGER generation_dispatch_insert_guard BEFORE INSERT ON generation_job_dispatches BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_job_dispatches d WHERE d.id = NEW.id OR d.dispatch_key = NEW.dispatch_key OR (d.generation_job_id = NEW.generation_job_id AND d.dispatch_no = NEW.dispatch_no))
    OR NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = NEW.generation_job_id AND j.workflow_instance_id = NEW.workflow_instance_id)
    OR NEW.state <> 'pending' OR NEW.attempt_count <> 0 OR NEW.claim_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL
    OR (NEW.kind = 'start' AND NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = NEW.generation_job_id AND j.status = 'dispatch_pending' AND j.state_version = NEW.job_state_version))
    OR (NEW.kind = 'resume_transcript_review' AND NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = NEW.generation_job_id AND j.status = 'awaiting_transcript_review' AND j.state_version = NEW.job_state_version AND j.wait_generation = NEW.wait_generation))
    OR (NEW.kind = 'resume_intent_review' AND NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id = NEW.generation_job_id AND j.status = 'awaiting_intent_review' AND j.state_version = NEW.job_state_version AND j.wait_generation = NEW.wait_generation))
    OR (NEW.kind='correction' AND NOT EXISTS (SELECT 1 FROM generation_jobs j JOIN generation_control_commands c ON c.job_id=j.id AND c.ordinal=NEW.command_ordinal WHERE j.id=NEW.generation_job_id AND j.request_scope='full' AND j.status='awaiting_transcript_review' AND j.state_version=NEW.job_state_version AND j.wait_generation=NEW.wait_generation AND c.state='pending' AND c.wait_generation=j.wait_generation AND c.context_id=NEW.context_id))
    THEN RAISE(ABORT, 'generation dispatch insert rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_dispatch_update_guard BEFORE UPDATE ON generation_job_dispatches BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.generation_job_id IS NOT OLD.generation_job_id
    OR NEW.dispatch_no IS NOT OLD.dispatch_no OR NEW.kind IS NOT OLD.kind OR NEW.dispatch_key IS NOT OLD.dispatch_key
    OR NEW.workflow_instance_id IS NOT OLD.workflow_instance_id OR NEW.job_state_version IS NOT OLD.job_state_version
    OR NEW.wait_generation IS NOT OLD.wait_generation OR NEW.payload_fingerprint IS NOT OLD.payload_fingerprint
    OR NEW.created_at IS NOT OLD.created_at OR OLD.state IN ('acknowledged','terminal_failed','stale')
    OR NOT ((OLD.state = 'pending' AND NEW.state IN ('claimed','retryable_failed','uncertain','terminal_failed','stale'))
      OR (OLD.state = 'claimed' AND NEW.state IN ('claimed','acknowledged','retryable_failed','uncertain','terminal_failed','stale'))
      OR (OLD.state = 'retryable_failed' AND NEW.state IN ('claimed','terminal_failed','stale'))
      OR (OLD.state = 'uncertain' AND NEW.state IN ('acknowledged','terminal_failed','stale')))
    OR (NEW.state = 'claimed' AND NEW.attempt_count <> OLD.attempt_count + 1)
    OR (NEW.state <> 'claimed' AND NEW.attempt_count <> OLD.attempt_count)
    THEN RAISE(ABORT, 'generation dispatch transition rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_dispatch_delete_guard BEFORE DELETE ON generation_job_dispatches BEGIN
  SELECT RAISE(ABORT, 'immutable generation dispatch');
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_event_insert_guard BEFORE INSERT ON sermon_content_events BEGIN
  SELECT CASE WHEN NEW.state <> 'assembling'
    OR NEW.content_sequence <> coalesce((SELECT event_count FROM sermon_content_heads WHERE sermon_id=NEW.sermon_id),0)+1
    OR NEW.aggregate_version <> NEW.input_version + NEW.content_sequence
    OR NOT EXISTS (
      SELECT 1 FROM sermon_input_heads h
      JOIN sermon_input_events d ON d.sermon_id=h.sermon_id AND d.version=h.version AND d.state='sealed'
      JOIN sermon_input_events s ON s.sermon_id=d.sermon_id AND s.id=NEW.source_id AND s.kind='source' AND s.state='sealed'
      LEFT JOIN sermon_input_events c ON c.sermon_id=d.sermon_id AND c.id=NEW.confirmation_id AND c.kind='confirm' AND c.state='sealed'
      WHERE h.sermon_id=NEW.sermon_id AND h.version=NEW.input_version
        AND d.source_id=NEW.source_id AND d.document_id=NEW.document_id AND d.document_sha256=NEW.document_sha256
        AND (NEW.confirmation_id IS NULL OR (c.source_id=NEW.source_id AND c.document_id=NEW.document_id)))
    OR (NEW.origin='ai' AND (NEW.created_by_actor_id IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id
      WHERE r.generation_job_id=NEW.generation_job_id AND r.step_key=NEW.step_key
        AND r.state IN ('claimed','effect_started') AND j.sermon_id=NEW.sermon_id
        AND r.input_version=NEW.input_version AND r.source_id=NEW.source_id AND r.document_id=NEW.document_id
        AND r.document_sha256=NEW.document_sha256 AND r.confirmation_id IS NEW.confirmation_id
        AND ((NEW.kind='intent_analysis' AND r.task='intent_analysis')
          OR (NEW.kind='intent_critique' AND r.task='intent_critique')
          OR (NEW.kind='summary' AND r.task='summary')
          OR (NEW.kind='candidate' AND NEW.difficulty='child' AND r.task='child_candidates')
          OR (NEW.kind='candidate' AND NEW.difficulty='adult' AND r.task='adult_candidates')))))
    OR (NEW.origin='human' AND (NEW.created_by_actor_id IS NULL OR NEW.generation_job_id IS NOT NULL OR NEW.step_key IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM sermon_content_current c WHERE c.sermon_id=NEW.sermon_id
        AND c.event_count=NEW.content_sequence-1)))
    OR (NEW.kind='intent_analysis' AND (NEW.base_analysis_event_id IS NOT NULL OR NEW.analysis_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NOT NULL))
    OR (NEW.kind='intent_critique' AND (NEW.base_analysis_event_id IS NULL OR NEW.analysis_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NOT NULL))
    OR (NEW.kind='intent_confirmation' AND (NEW.analysis_event_id IS NULL OR NEW.base_analysis_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NOT NULL))
    OR (NEW.kind IN ('summary','candidate') AND (NEW.analysis_event_id IS NULL OR NEW.intent_confirmation_event_id IS NULL OR NEW.base_analysis_event_id IS NOT NULL))
    THEN RAISE(ABORT, 'sermon content event rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_final_audit_insert_guard BEFORE INSERT ON ai_final_audit_results BEGIN
  SELECT CASE WHEN NEW.state<>'assembling' OR NOT EXISTS (
    SELECT 1 FROM generation_step_receipts r JOIN final_check_tickets t ON t.id=NEW.final_check_ticket_id
    WHERE r.generation_job_id=NEW.generation_job_id AND r.step_key=NEW.step_key AND r.task='final_audit'
      AND r.state IN ('claimed','effect_started') AND r.ticket_id=t.id AND t.state='sealed')
    THEN RAISE(ABORT, 'final audit result rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_provider_call_insert_guard BEFORE INSERT ON ai_provider_calls BEGIN
  SELECT CASE WHEN NEW.state<>'effect_started' OR NOT EXISTS (
    SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id
    WHERE r.generation_job_id=NEW.generation_job_id AND r.step_key=NEW.step_key AND r.task=NEW.task
      AND r.effect_class='ai_provider' AND r.state='effect_started' AND r.attempt_count=NEW.attempt_number
      AND r.input_fingerprint=NEW.input_fingerprint AND j.quiz_set_id=NEW.quiz_set_id AND j.sermon_id=NEW.sermon_id)
    THEN RAISE(ABORT, 'provider call rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_result_link_insert_guard BEFORE INSERT ON generation_step_result_links BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.generation_job_id
      AND r.step_key=NEW.step_key AND r.task=NEW.task AND r.state IN ('claimed','effect_started'))
    OR NOT EXISTS (SELECT 1 FROM ai_usage_events u WHERE u.id=NEW.usage_event_id
      AND u.generation_job_id=NEW.generation_job_id AND u.step_key=NEW.step_key AND u.task=NEW.task)
    OR (NEW.task='correction' AND (NEW.correction_sermon_id IS NULL OR NEW.correction_event_id IS NULL
      OR NEW.content_sermon_id IS NOT NULL OR NEW.content_event_id IS NOT NULL OR NEW.final_audit_result_id IS NOT NULL))
    OR (NEW.task IN ('intent_analysis','intent_critique','summary','child_candidates','adult_candidates')
      AND (NEW.content_sermon_id IS NULL OR NEW.content_event_id IS NULL OR NEW.correction_sermon_id IS NOT NULL
        OR NEW.correction_event_id IS NOT NULL OR NEW.final_audit_result_id IS NOT NULL))
    OR (NEW.task='final_audit' AND (NEW.final_audit_result_id IS NULL OR NEW.correction_sermon_id IS NOT NULL
      OR NEW.correction_event_id IS NOT NULL OR NEW.content_sermon_id IS NOT NULL OR NEW.content_event_id IS NOT NULL))
    OR (NEW.task='correction' AND NOT EXISTS (
      SELECT 1 FROM sermon_input_events p JOIN generation_step_receipts r
        ON r.generation_job_id=NEW.generation_job_id AND r.step_key=NEW.step_key
      JOIN generation_jobs j ON j.id=r.generation_job_id
      WHERE p.sermon_id=NEW.correction_sermon_id AND p.id=NEW.correction_event_id AND p.sermon_id=j.sermon_id
        AND p.kind='proposal' AND p.state='sealed' AND p.source_id=r.source_id AND p.document_id=r.document_id
        AND p.document_sha256=r.document_sha256 AND p.version=r.input_version+1
        AND NEW.result_kind='correction_proposal' AND NEW.result_id=p.id AND NEW.result_version=p.version
        AND NEW.result_fingerprint=p.payload_sha256))
    OR (NEW.task IN ('intent_analysis','intent_critique','summary','child_candidates','adult_candidates') AND NOT EXISTS (
      SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.content_sermon_id AND e.event_id=NEW.content_event_id
        AND e.generation_job_id=NEW.generation_job_id AND e.step_key=NEW.step_key AND e.state='sealed'
        AND ((NEW.task='intent_analysis' AND e.kind='intent_analysis' AND e.difficulty IS NULL AND NEW.result_kind='intent_analysis_event')
          OR (NEW.task='intent_critique' AND e.kind='intent_critique' AND e.difficulty IS NULL AND NEW.result_kind='intent_critique_event')
          OR (NEW.task='summary' AND e.kind='summary' AND e.difficulty IS NULL AND NEW.result_kind='summary_event')
          OR (NEW.task='child_candidates' AND e.kind='candidate' AND e.difficulty='child' AND NEW.result_kind='child_candidates_event')
          OR (NEW.task='adult_candidates' AND e.kind='candidate' AND e.difficulty='adult' AND NEW.result_kind='adult_candidates_event'))
        AND NEW.result_id=e.event_id AND NEW.result_version=e.aggregate_version AND NEW.result_fingerprint=e.payload_sha256))
    OR (NEW.task='final_audit' AND NOT EXISTS (
      SELECT 1 FROM ai_final_audit_results a WHERE a.id=NEW.final_audit_result_id
        AND a.generation_job_id=NEW.generation_job_id AND a.step_key=NEW.step_key AND a.state='sealed'
        AND NEW.result_kind='final_audit_result' AND NEW.result_id=a.id
        AND NEW.result_version=a.result_version AND NEW.result_fingerprint=a.result_fingerprint))
    THEN RAISE(ABORT, 'generation result link rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_ai_receipt_success_guard BEFORE UPDATE ON generation_step_receipts
WHEN NEW.state='succeeded' AND NEW.task IN ('correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','final_audit') BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_step_result_links l
    WHERE l.generation_job_id=NEW.generation_job_id AND l.step_key=NEW.step_key AND l.task=NEW.task
      AND l.result_kind=NEW.result_kind AND l.result_id=NEW.result_id
      AND l.result_version=NEW.result_version AND l.result_fingerprint=NEW.result_fingerprint)
    THEN RAISE(ABORT, 'generation result link required') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_usage_observations_no_replace BEFORE INSERT ON ai_usage_observations BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ai_usage_observations x WHERE x.call_id=NEW.call_id) OR EXISTS (SELECT 1 FROM ai_usage_observations x WHERE x.usage_event_id=NEW.usage_event_id) THEN RAISE(ABORT, 'ai_usage_observations_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_usage_observations_no_delete BEFORE DELETE ON ai_usage_observations BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER ai_usage_observations_no_update BEFORE UPDATE ON ai_usage_observations BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER ai_usage_settlements_no_replace BEFORE INSERT ON ai_usage_settlements BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ai_usage_settlements x WHERE x.call_id=NEW.call_id) OR EXISTS (SELECT 1 FROM ai_usage_settlements x WHERE x.usage_event_id=NEW.usage_event_id) THEN RAISE(ABORT, 'ai_usage_settlements_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_usage_settlements_no_delete BEFORE DELETE ON ai_usage_settlements BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER ai_usage_settlements_no_update BEFORE UPDATE ON ai_usage_settlements BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_context_chunks_no_replace BEFORE INSERT ON generation_context_chunks BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_context_chunks x WHERE x.context_id=NEW.context_id AND x.position=NEW.position) THEN RAISE(ABORT, 'generation_context_chunks_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_context_chunks_no_delete BEFORE DELETE ON generation_context_chunks BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_context_chunks_no_update BEFORE UPDATE ON generation_context_chunks BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_contexts_no_replace BEFORE INSERT ON generation_contexts BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_contexts x WHERE x.id=NEW.id) OR EXISTS (SELECT 1 FROM generation_contexts x WHERE x.id=NEW.id AND x.state=NEW.state) OR EXISTS (SELECT 1 FROM generation_contexts x WHERE x.job_id=NEW.job_id AND x.id=NEW.id AND x.kind=NEW.kind) THEN RAISE(ABORT, 'generation_contexts_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_contexts_no_delete BEFORE DELETE ON generation_contexts BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_control_commands_no_replace BEFORE INSERT ON generation_control_commands BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_control_commands x WHERE x.job_id=NEW.job_id AND x.ordinal=NEW.ordinal) OR EXISTS (SELECT 1 FROM generation_control_commands x WHERE x.job_id=NEW.job_id AND x.command_key=NEW.command_key) OR EXISTS (SELECT 1 FROM generation_control_commands x WHERE x.context_id=NEW.context_id) THEN RAISE(ABORT, 'generation_control_commands_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_control_commands_no_delete BEFORE DELETE ON generation_control_commands BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_dispatch_attempts_no_replace BEFORE INSERT ON generation_dispatch_attempts BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_dispatch_attempts x WHERE x.dispatch_id=NEW.dispatch_id AND x.attempt=NEW.attempt) THEN RAISE(ABORT, 'generation_dispatch_attempts_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_dispatch_attempts_no_delete BEFORE DELETE ON generation_dispatch_attempts BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_dispatch_receipts_no_replace BEFORE INSERT ON generation_dispatch_receipts BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_dispatch_receipts x WHERE x.dispatch_id=NEW.dispatch_id) OR EXISTS (SELECT 1 FROM generation_dispatch_receipts x WHERE x.job_id=NEW.job_id AND x.event_no=NEW.event_no) THEN RAISE(ABORT, 'generation_dispatch_receipts_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_dispatch_receipts_no_delete BEFORE DELETE ON generation_dispatch_receipts BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_dispatch_receipts_no_update BEFORE UPDATE ON generation_dispatch_receipts BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_request_contexts_no_replace BEFORE INSERT ON generation_request_contexts BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_request_contexts x WHERE x.job_id=NEW.job_id) OR EXISTS (SELECT 1 FROM generation_request_contexts x WHERE x.context_id=NEW.context_id) OR EXISTS (SELECT 1 FROM generation_request_contexts x WHERE x.job_id=NEW.job_id AND x.context_id=NEW.context_id) THEN RAISE(ABORT, 'generation_request_contexts_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_request_contexts_no_delete BEFORE DELETE ON generation_request_contexts BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_request_contexts_no_update BEFORE UPDATE ON generation_request_contexts BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_step_contexts_no_replace BEFORE INSERT ON generation_step_contexts BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_step_contexts x WHERE x.job_id=NEW.job_id AND x.step_key=NEW.step_key) OR EXISTS (SELECT 1 FROM generation_step_contexts x WHERE x.context_id=NEW.context_id) OR EXISTS (SELECT 1 FROM generation_step_contexts x WHERE x.job_id=NEW.job_id AND x.step_key=NEW.step_key AND x.context_id=NEW.context_id) THEN RAISE(ABORT, 'generation_step_contexts_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_step_contexts_no_delete BEFORE DELETE ON generation_step_contexts BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_step_contexts_no_update BEFORE UPDATE ON generation_step_contexts BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_step_outcomes_no_replace BEFORE INSERT ON generation_step_outcomes BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_step_outcomes x WHERE x.job_id=NEW.job_id AND x.step_key=NEW.step_key AND x.attempt=NEW.attempt) OR EXISTS (SELECT 1 FROM generation_step_outcomes x WHERE x.job_id=NEW.job_id AND x.event_no=NEW.event_no) THEN RAISE(ABORT, 'generation_step_outcomes_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_step_outcomes_no_delete BEFORE DELETE ON generation_step_outcomes BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_step_outcomes_no_update BEFORE UPDATE ON generation_step_outcomes BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_transition_evidence_no_replace BEFORE INSERT ON generation_transition_evidence BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_transition_evidence x WHERE x.job_id=NEW.job_id AND x.event_no=NEW.event_no) OR EXISTS (SELECT 1 FROM generation_transition_evidence x WHERE x.job_id=NEW.job_id AND x.event_no=NEW.event_no AND x.after_version=NEW.after_version) THEN RAISE(ABORT, 'generation_transition_evidence_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_transition_evidence_no_delete BEFORE DELETE ON generation_transition_evidence BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_transition_evidence_no_update BEFORE UPDATE ON generation_transition_evidence BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_wait_contexts_no_replace BEFORE INSERT ON generation_wait_contexts BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_wait_contexts x WHERE x.job_id=NEW.job_id AND x.wait_generation=NEW.wait_generation) OR EXISTS (SELECT 1 FROM generation_wait_contexts x WHERE x.context_id=NEW.context_id) THEN RAISE(ABORT, 'generation_wait_contexts_no_replace') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_wait_contexts_no_delete BEFORE DELETE ON generation_wait_contexts BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER generation_wait_contexts_no_update BEFORE UPDATE ON generation_wait_contexts BEGIN
SELECT RAISE(ABORT, 'immutable lifecycle record');
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_job_v2_insert BEFORE INSERT ON generation_jobs BEGIN
  SELECT CASE WHEN NEW.request_contract_version<>2 THEN RAISE(ABORT, 'lifecycle_job_v2_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_job_v2_update BEFORE UPDATE ON generation_jobs BEGIN
  SELECT CASE WHEN OLD.request_contract_version<>2 OR NEW.request_context_id IS NOT OLD.request_context_id THEN RAISE(ABORT, 'lifecycle_job_v2_update') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_generation_job_dispatches_insert BEFORE INSERT ON generation_job_dispatches BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.request_contract_version=2) THEN RAISE(ABORT, 'lifecycle_generation_job_dispatches_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_generation_job_dispatches_update BEFORE UPDATE ON generation_job_dispatches BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.request_contract_version=2) THEN RAISE(ABORT, 'lifecycle_generation_job_dispatches_update') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_generation_step_receipts_insert BEFORE INSERT ON generation_step_receipts BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.request_contract_version=2) THEN RAISE(ABORT, 'lifecycle_generation_step_receipts_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_generation_step_receipts_update BEFORE UPDATE ON generation_step_receipts BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.request_contract_version=2) THEN RAISE(ABORT, 'lifecycle_generation_step_receipts_update') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_generation_job_events_insert BEFORE INSERT ON generation_job_events BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.request_contract_version=2) THEN RAISE(ABORT, 'lifecycle_generation_job_events_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_ai_provider_calls_insert BEFORE INSERT ON ai_provider_calls BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.request_contract_version=2) THEN RAISE(ABORT, 'lifecycle_ai_provider_calls_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_ai_provider_calls_update BEFORE UPDATE ON ai_provider_calls BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.request_contract_version=2) THEN RAISE(ABORT, 'lifecycle_ai_provider_calls_update') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_ai_usage_events_insert BEFORE INSERT ON ai_usage_events BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.request_contract_version=2) THEN RAISE(ABORT, 'lifecycle_ai_usage_events_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_generation_step_result_links_insert BEFORE INSERT ON generation_step_result_links BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.request_contract_version=2) THEN RAISE(ABORT, 'lifecycle_generation_step_result_links_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_context_insert BEFORE INSERT ON generation_contexts BEGIN
  SELECT CASE WHEN NEW.state<>'assembling' OR NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.job_id AND j.sermon_id=NEW.sermon_id AND j.quiz_set_id=NEW.quiz_set_id AND j.request_contract_version=2 AND j.status NOT IN ('review_ready','needs_revision','stale','failed')) OR NOT ((NEW.input_state='absent' AND NOT EXISTS(SELECT 1 FROM sermon_input_heads h WHERE h.sermon_id=NEW.sermon_id)) OR (NEW.input_state='present' AND EXISTS(SELECT 1 FROM sermon_input_heads h WHERE h.sermon_id=NEW.sermon_id AND h.version=NEW.input_version))) OR NOT ((NEW.content_count=0 AND NOT EXISTS(SELECT 1 FROM sermon_content_heads h WHERE h.sermon_id=NEW.sermon_id)) OR EXISTS(SELECT 1 FROM sermon_content_heads h WHERE h.sermon_id=NEW.sermon_id AND h.event_count=NEW.content_count AND h.last_event_id=NEW.last_content_event_id)) OR NOT EXISTS (SELECT 1 FROM sermon_metadata_drafts m WHERE m.sermon_id=NEW.sermon_id AND m.metadata_revision=NEW.metadata_revision) THEN RAISE(ABORT, 'lifecycle_context_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_context_seal BEFORE UPDATE ON generation_contexts BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.sermon_id IS NOT OLD.sermon_id OR NEW.quiz_set_id IS NOT OLD.quiz_set_id OR NEW.kind IS NOT OLD.kind OR NEW.contract_version IS NOT OLD.contract_version OR NEW.validator_version IS NOT OLD.validator_version OR NEW.assembly_version IS NOT OLD.assembly_version OR NEW.codec IS NOT OLD.codec OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.byte_length IS NOT OLD.byte_length OR NEW.chunk_count IS NOT OLD.chunk_count OR NEW.reference_count IS NOT OLD.reference_count OR NEW.required_state IS NOT OLD.required_state OR NEW.created_at IS NOT OLD.created_at OR NEW.input_state IS NOT OLD.input_state OR NEW.input_version IS NOT OLD.input_version OR NEW.source_id IS NOT OLD.source_id OR NEW.document_id IS NOT OLD.document_id OR NEW.document_sha256 IS NOT OLD.document_sha256 OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.content_count IS NOT OLD.content_count OR NEW.last_content_event_id IS NOT OLD.last_content_event_id OR NEW.analysis_event_id IS NOT OLD.analysis_event_id OR NEW.critique_event_id IS NOT OLD.critique_event_id OR NEW.intent_confirmation_event_id IS NOT OLD.intent_confirmation_event_id OR NEW.summary_event_id IS NOT OLD.summary_event_id OR NEW.summary_review_event_id IS NOT OLD.summary_review_event_id OR NEW.child_event_id IS NOT OLD.child_event_id OR NEW.child_review_event_id IS NOT OLD.child_review_event_id OR NEW.adult_event_id IS NOT OLD.adult_event_id OR NEW.adult_review_event_id IS NOT OLD.adult_review_event_id OR NEW.metadata_revision IS NOT OLD.metadata_revision OR NEW.settings_revision IS NOT OLD.settings_revision OR NEW.selection_revision IS NOT OLD.selection_revision OR NEW.ticket_id IS NOT OLD.ticket_id OR NEW.ticket_fingerprint IS NOT OLD.ticket_fingerprint OR OLD.state<>'assembling' OR NEW.state<>'sealed' OR NOT EXISTS (SELECT 1 FROM generation_context_chunks c WHERE c.context_id=NEW.id GROUP BY c.context_id HAVING count(*)=NEW.chunk_count AND sum(c.byte_length)=NEW.byte_length AND min(c.position)=0 AND max(c.position)=NEW.chunk_count-1) OR EXISTS(SELECT 1 FROM generation_context_chunks c WHERE c.context_id=NEW.id AND c.position<NEW.chunk_count-1 AND c.byte_length<>16384) OR (NEW.kind='request' AND NOT EXISTS (SELECT 1 FROM generation_request_contexts r WHERE r.context_id=NEW.id AND r.job_id=NEW.job_id AND r.fingerprint=NEW.fingerprint)) OR (NEW.kind='step' AND NOT EXISTS (SELECT 1 FROM generation_step_contexts s WHERE s.context_id=NEW.id AND s.job_id=NEW.job_id) AND NOT EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.context_id=NEW.id AND c.job_id=NEW.job_id AND c.state='pending')) OR (NEW.kind='wait' AND NOT EXISTS (SELECT 1 FROM generation_wait_contexts w WHERE w.context_id=NEW.id AND w.job_id=NEW.job_id)) OR (NEW.input_state='present' AND NOT EXISTS (SELECT 1 FROM sermon_input_events s JOIN sermon_input_events d ON d.sermon_id=s.sermon_id AND d.id=NEW.document_id WHERE s.sermon_id=NEW.sermon_id AND s.id=NEW.source_id AND s.kind='source' AND s.state='sealed' AND d.state='sealed' AND d.source_id=s.id AND d.document_sha256=NEW.document_sha256 AND d.kind IN ('source','edit','restore','merge'))) OR (NEW.confirmation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_input_events c WHERE c.sermon_id=NEW.sermon_id AND c.id=NEW.confirmation_id AND c.kind='confirm' AND c.state='sealed' AND c.source_id=NEW.source_id AND c.document_id=NEW.document_id AND c.document_sha256=NEW.document_sha256)) OR (NEW.analysis_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.analysis_event_id AND e.state='sealed' AND e.kind='intent_analysis')) OR (NEW.critique_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.critique_event_id AND e.state='sealed' AND e.kind='intent_critique')) OR (NEW.intent_confirmation_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.intent_confirmation_event_id AND e.state='sealed' AND e.kind='intent_confirmation')) OR (NEW.summary_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.summary_event_id AND e.state='sealed' AND e.kind='summary' AND e.origin IN ('ai','human'))) OR (NEW.child_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.child_event_id AND e.state='sealed' AND e.kind='candidate' AND e.difficulty='child')) OR (NEW.adult_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.adult_event_id AND e.state='sealed' AND e.kind='candidate' AND e.difficulty='adult')) OR (NEW.summary_review_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e JOIN sermon_content_human_events h ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.summary_review_event_id AND e.state='sealed' AND h.operation='summary_review' AND h.target_snapshot_event_id=NEW.summary_event_id)) OR (NEW.child_review_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e JOIN sermon_content_human_events h ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.child_review_event_id AND e.state='sealed' AND h.operation='candidate_review' AND h.target_snapshot_event_id=NEW.child_event_id)) OR (NEW.adult_review_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e JOIN sermon_content_human_events h ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.adult_review_event_id AND e.state='sealed' AND h.operation='candidate_review' AND h.target_snapshot_event_id=NEW.adult_event_id)) OR (NEW.ticket_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM final_check_tickets t WHERE t.id=NEW.ticket_id AND t.sermon_id=NEW.sermon_id AND t.quiz_set_id=NEW.quiz_set_id AND t.state='sealed' AND t.ticket_fingerprint=NEW.ticket_fingerprint)) THEN RAISE(ABORT, 'lifecycle_context_seal') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_chunk_insert BEFORE INSERT ON generation_context_chunks BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_contexts c WHERE c.id=NEW.context_id AND c.state='assembling' AND NEW.position<c.chunk_count AND NEW.byte_length= CASE WHEN NEW.position=c.chunk_count-1 THEN c.byte_length-16384*NEW.position ELSE 16384 END ) THEN RAISE(ABORT, 'lifecycle_chunk_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_request_link BEFORE INSERT ON generation_request_contexts BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_contexts c JOIN generation_jobs j ON j.id=c.job_id WHERE c.id=NEW.context_id AND c.job_id=NEW.job_id AND c.kind='request' AND c.state='assembling' AND c.fingerprint=NEW.fingerprint AND j.request_fingerprint=NEW.fingerprint AND j.request_context_id=c.id AND j.start_input_state=c.input_state AND j.start_input_version IS c.input_version AND j.start_source_id IS c.source_id AND j.start_document_id IS c.document_id AND j.start_document_sha256 IS c.document_sha256 AND j.start_confirmation_id IS c.confirmation_id AND j.start_metadata_revision=c.metadata_revision AND j.settings_revision IS c.settings_revision AND j.selection_revision IS c.selection_revision) THEN RAISE(ABORT, 'lifecycle_request_link') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_step_link BEFORE INSERT ON generation_step_contexts BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_contexts c JOIN generation_step_receipts r ON r.generation_job_id=c.job_id AND r.step_key=NEW.step_key JOIN generation_jobs j ON j.id=c.job_id JOIN generation_transition_evidence e ON e.job_id=j.id AND e.event_no=NEW.predecessor_event_no AND e.after_version=NEW.predecessor_state_version WHERE c.id=NEW.context_id AND c.job_id=NEW.job_id AND c.kind='step' AND r.context_id=c.id AND r.task=NEW.task AND r.input_fingerprint=NEW.input_fingerprint AND c.fingerprint=NEW.input_fingerprint AND r.input_version IS c.input_version AND r.source_id IS c.source_id AND r.document_id IS c.document_id AND r.document_sha256 IS c.document_sha256 AND r.confirmation_id IS c.confirmation_id AND r.metadata_revision IS c.metadata_revision AND r.state='claimed' AND r.attempt_count=1 AND j.status='running' AND e.event_no=j.event_count AND e.after_version=j.state_version AND ((NEW.predecessor_kind='request' AND e.reason IN ('job_created','received')) OR (NEW.predecessor_kind='wait_consume' AND e.reason='received') OR (NEW.predecessor_kind='outcome' AND e.reason IN ('step_succeeded','stage_completed')))) THEN RAISE(ABORT, 'lifecycle_step_link') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_evidence_insert BEFORE INSERT ON generation_transition_evidence BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j JOIN generation_contexts c ON c.job_id=j.id WHERE j.id=NEW.job_id AND c.id=NEW.context_id AND c.fingerprint=NEW.fingerprint AND j.request_contract_version=2 AND ((NEW.reason='job_created' AND j.state_version=0 AND j.event_count=1 AND j.request_context_id=c.id AND c.kind='request') OR (NEW.reason<>'job_created' AND j.state_version=NEW.before_version AND j.event_count+1=NEW.event_no AND j.status=NEW.before_status AND j.current_step=NEW.before_stage AND j.active_wait_generation IS NEW.before_wait AND j.status NOT IN ('review_ready','needs_revision','stale','failed')))) THEN RAISE(ABORT, 'lifecycle_evidence_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_job_evidence BEFORE UPDATE ON generation_jobs BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_transition_evidence e WHERE e.job_id=NEW.id AND e.event_no=NEW.event_count AND e.before_version=OLD.state_version AND e.before_status=OLD.status AND e.before_stage=OLD.current_step AND e.before_wait IS OLD.active_wait_generation AND e.after_version=NEW.state_version AND e.after_status=NEW.status AND e.after_stage=NEW.current_step AND e.after_wait IS NEW.active_wait_generation) OR (NEW.status IN ('review_ready','needs_revision') AND (EXISTS(SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.id AND r.state IN ('claimed','effect_started','uncertain')) OR EXISTS(SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.id AND c.state IN ('pending','running','uncertain')))) THEN RAISE(ABORT, 'lifecycle_job_evidence') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_event_bundle BEFORE INSERT ON generation_job_events BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_transition_evidence e JOIN generation_contexts c ON c.id=e.context_id WHERE e.job_id=NEW.generation_job_id AND e.event_no=NEW.event_no AND e.after_version=NEW.job_state_version AND e.step_key IS NEW.step_key AND (e.attempt IS NULL OR e.attempt=NEW.attempt_number) AND c.state='sealed' AND (e.reason=NEW.event_code OR (e.reason='received' AND NEW.event_code='dispatch_acknowledged'))) OR (NEW.event_code IN ('received','dispatch_acknowledged') AND NOT EXISTS (SELECT 1 FROM generation_dispatch_receipts r JOIN generation_job_dispatches d ON d.id=r.dispatch_id WHERE r.job_id=NEW.generation_job_id AND r.event_no=NEW.event_no AND r.state_version=NEW.job_state_version AND d.state='acknowledged' AND d.receiver_dispatch_id=d.id)) OR (NEW.event_code IN ('step_succeeded','step_rejected','step_stale','step_uncertain') AND NOT EXISTS (SELECT 1 FROM generation_step_outcomes o JOIN generation_step_receipts r ON r.generation_job_id=o.job_id AND r.step_key=o.step_key WHERE o.job_id=NEW.generation_job_id AND o.event_no=NEW.event_no AND o.step_key=NEW.step_key AND o.attempt=NEW.attempt_number AND r.outcome_attempt=o.attempt AND r.attempt_count=o.attempt AND r.state= CASE o.outcome WHEN 'success' THEN 'succeeded' WHEN 'rejected' THEN 'terminal_failed' WHEN 'stale' THEN 'stale' ELSE 'uncertain' END )) OR (NEW.event_code='wait_entered' AND NOT EXISTS (SELECT 1 FROM generation_wait_contexts w WHERE w.job_id=NEW.generation_job_id AND w.enter_event_no=NEW.event_no AND w.enter_state_version=NEW.job_state_version)) THEN RAISE(ABORT, 'lifecycle_event_bundle') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_wait_link BEFORE INSERT ON generation_wait_contexts BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_contexts c JOIN generation_transition_evidence e ON e.job_id=c.job_id AND e.event_no=NEW.enter_event_no JOIN generation_jobs j ON j.id=c.job_id WHERE c.id=NEW.context_id AND c.kind='wait' AND c.job_id=NEW.job_id AND e.after_version=NEW.enter_state_version AND e.after_wait=NEW.wait_generation AND e.reason IN ('wait_entered','step_succeeded','step_rejected') AND e.after_status= CASE NEW.kind WHEN 'transcript_review' THEN 'awaiting_transcript_review' ELSE 'awaiting_intent_review' END AND NEW.wait_generation=j.wait_generation+1) OR (NEW.parent_wait_generation IS NOT NULL AND NOT EXISTS (SELECT 1 FROM generation_control_commands c LEFT JOIN generation_step_outcomes o ON o.job_id=c.job_id AND o.step_key=c.step_key AND o.attempt=NEW.parent_attempt WHERE c.job_id=NEW.job_id AND c.ordinal=NEW.command_ordinal AND c.wait_generation=NEW.parent_wait_generation AND ((c.step_key=NEW.parent_step_key AND c.outcome_attempt=NEW.parent_attempt AND c.state IN ('succeeded','rejected') AND o.outcome IN ('success','rejected')) OR (c.state='rejected' AND c.outcome_attempt IS NULL AND NEW.parent_step_key IS NULL AND NEW.parent_attempt IS NULL)))) THEN RAISE(ABORT, 'lifecycle_wait_link') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_receipt_insert BEFORE INSERT ON generation_step_receipts BEGIN
  SELECT CASE WHEN NEW.input_contract_version<>2 OR NEW.context_id IS NULL OR NEW.outcome_attempt IS NOT NULL OR NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.status='running' AND j.current_step=NEW.step_key) OR EXISTS(SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.generation_job_id AND c.state IN ('pending','running','uncertain') AND NOT(c.state='running' AND c.step_key=NEW.step_key AND c.context_id=NEW.context_id)) THEN RAISE(ABORT, 'lifecycle_receipt_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_receipt_transition BEFORE UPDATE ON generation_step_receipts BEGIN
  SELECT CASE WHEN NEW.context_id IS NOT OLD.context_id OR NOT EXISTS (SELECT 1 FROM generation_contexts c JOIN generation_jobs j ON j.id=c.job_id WHERE c.id=NEW.context_id AND c.state='sealed' AND j.id=NEW.generation_job_id AND j.status='running' AND j.current_step=NEW.step_key) OR (NEW.state='claimed' AND (OLD.effect_class NOT IN ('pure','domain_write') OR OLD.state NOT IN ('claimed','retryable_failed') OR (OLD.state='claimed' AND NEW.updated_at<OLD.lease_expires_at) OR NEW.claim_token=OLD.claim_token OR NEW.outcome_attempt IS NOT NULL)) OR (NEW.state IN ('succeeded','terminal_failed','stale','uncertain') AND (NEW.outcome_attempt IS NULL OR NEW.outcome_attempt<>NEW.attempt_count OR NOT EXISTS (SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.generation_job_id AND o.step_key=NEW.step_key AND o.attempt=NEW.attempt_count AND o.context_id=NEW.context_id AND NEW.state= CASE o.outcome WHEN 'success' THEN 'succeeded' WHEN 'rejected' THEN 'terminal_failed' WHEN 'stale' THEN 'stale' ELSE 'uncertain' END ))) OR (NEW.state='effect_started' AND (NEW.claim_token IS NOT OLD.claim_token OR NEW.lease_expires_at IS NOT OLD.lease_expires_at)) THEN RAISE(ABORT, 'lifecycle_receipt_transition') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_dispatch_insert BEFORE INSERT ON generation_job_dispatches BEGIN
  SELECT CASE WHEN NEW.context_id IS NULL OR NEW.required_attempt IS NOT NULL OR NEW.receiver_dispatch_id IS NOT NULL OR NEW.dispatch_no<>(SELECT coalesce(max(dispatch_no),0)+1 FROM generation_job_dispatches WHERE generation_job_id=NEW.generation_job_id) OR (NEW.kind='correction')<>(NEW.command_ordinal IS NOT NULL) OR NOT EXISTS (SELECT 1 FROM generation_contexts c WHERE c.id=NEW.context_id AND c.job_id=NEW.generation_job_id AND ((NEW.kind='start' AND c.kind='request') OR (NEW.kind='correction' AND c.kind='step') OR (NEW.kind IN ('resume_transcript_review','resume_intent_review') AND c.kind='wait'))) OR (NEW.kind LIKE 'resume_%' AND EXISTS(SELECT 1 FROM generation_job_dispatches d WHERE d.generation_job_id=NEW.generation_job_id AND d.kind=NEW.kind AND d.wait_generation=NEW.wait_generation)) THEN RAISE(ABORT, 'lifecycle_dispatch_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_dispatch_transition BEFORE UPDATE ON generation_job_dispatches BEGIN
  SELECT CASE WHEN NEW.context_id IS NOT OLD.context_id OR NEW.command_ordinal IS NOT OLD.command_ordinal OR NOT EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.status NOT IN ('review_ready','needs_revision','stale','failed') AND j.state_version=NEW.job_state_version AND j.wait_generation=coalesce(NEW.wait_generation,0)) OR (NEW.state='claimed' AND (NEW.required_attempt IS NULL OR NEW.required_attempt<>NEW.attempt_count OR (OLD.state='claimed' AND NOT EXISTS (SELECT 1 FROM generation_dispatch_attempts a WHERE a.dispatch_id=OLD.id AND a.attempt=OLD.attempt_count AND a.state='expired' AND a.send_started_at IS NULL AND a.ended_at=NEW.last_attempted_at)))) OR (NEW.state='acknowledged' AND (NEW.receiver_dispatch_id IS NOT NEW.id OR NOT EXISTS (SELECT 1 FROM generation_dispatch_receipts r WHERE r.dispatch_id=NEW.id AND r.received_at=NEW.acknowledged_at))) OR (NEW.state<>'acknowledged' AND NEW.receiver_dispatch_id IS NOT NULL) OR (NEW.state='retryable_failed' AND EXISTS(SELECT 1 FROM generation_dispatch_attempts a WHERE a.dispatch_id=NEW.id AND a.send_started_at IS NOT NULL)) THEN RAISE(ABORT, 'lifecycle_dispatch_transition') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_attempt_insert BEFORE INSERT ON generation_dispatch_attempts BEGIN
  SELECT CASE WHEN NEW.state<>'reserved' OR NEW.send_started_at IS NOT NULL OR NEW.ended_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM generation_job_dispatches d JOIN generation_jobs j ON j.id=d.generation_job_id WHERE d.id=NEW.dispatch_id AND d.state='claimed' AND d.attempt_count=NEW.attempt AND d.required_attempt=NEW.attempt AND d.claim_token=NEW.claim_token AND d.lease_expires_at=NEW.lease_expires_at AND d.last_attempted_at=NEW.reserved_at AND j.state_version=d.job_state_version) OR NEW.attempt<>(SELECT coalesce(max(attempt),0)+1 FROM generation_dispatch_attempts WHERE dispatch_id=NEW.dispatch_id) THEN RAISE(ABORT, 'lifecycle_attempt_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_attempt_transition BEFORE UPDATE ON generation_dispatch_attempts BEGIN
  SELECT CASE WHEN NEW.dispatch_id IS NOT OLD.dispatch_id OR NEW.attempt IS NOT OLD.attempt OR NEW.claim_token IS NOT OLD.claim_token OR NEW.lease_expires_at IS NOT OLD.lease_expires_at OR NEW.reserved_at IS NOT OLD.reserved_at OR NOT((OLD.state='reserved' AND NEW.state='send_started' AND NEW.send_started_at<OLD.lease_expires_at) OR (OLD.state='reserved' AND NEW.state='expired' AND NEW.ended_at>=OLD.lease_expires_at) OR (OLD.state='send_started' AND NEW.state='observed' AND NEW.send_started_at IS OLD.send_started_at)) OR NOT EXISTS (SELECT 1 FROM generation_job_dispatches d JOIN generation_jobs j ON j.id=d.generation_job_id WHERE d.id=NEW.dispatch_id AND d.attempt_count=NEW.attempt AND d.required_attempt=NEW.attempt AND ((NEW.state='observed' AND d.state='acknowledged') OR (d.state='claimed' AND d.claim_token=NEW.claim_token AND d.lease_expires_at=NEW.lease_expires_at)) AND j.state_version=d.job_state_version) THEN RAISE(ABORT, 'lifecycle_attempt_transition') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_receiver_insert BEFORE INSERT ON generation_dispatch_receipts BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_job_dispatches d JOIN generation_jobs j ON j.id=d.generation_job_id JOIN generation_request_contexts r ON r.job_id=j.id JOIN generation_contexts c ON c.id=d.context_id JOIN generation_dispatch_attempts a ON a.dispatch_id=d.id AND a.attempt=d.attempt_count JOIN generation_transition_evidence e ON e.job_id=j.id AND e.event_no=NEW.event_no WHERE d.id=NEW.dispatch_id AND d.generation_job_id=NEW.job_id AND d.workflow_instance_id=NEW.workflow_instance_id AND j.workflow_instance_id=NEW.workflow_instance_id AND d.context_id=NEW.context_id AND d.payload_fingerprint=NEW.payload_fingerprint AND d.wait_generation IS NEW.wait_generation AND d.command_ordinal IS NEW.command_ordinal AND r.context_id=NEW.request_context_id AND r.fingerprint=NEW.request_fingerprint AND j.request_fingerprint=NEW.request_fingerprint AND j.state_version=d.job_state_version AND j.status NOT IN ('review_ready','needs_revision','stale','failed') AND c.state='sealed' AND d.state IN ('claimed','uncertain') AND a.state='send_started' AND e.reason='received' AND e.dispatch_id=d.id AND e.context_id=c.id AND e.after_version=NEW.state_version AND e.after_status='running' AND e.before_version=j.state_version AND ((d.kind='start' AND j.status='dispatch_pending') OR (d.kind='correction' AND j.status='awaiting_transcript_review') OR (d.kind='resume_transcript_review' AND j.status='awaiting_transcript_review' AND j.wait_generation=d.wait_generation) OR (d.kind='resume_intent_review' AND j.status='awaiting_intent_review' AND j.wait_generation=d.wait_generation))) OR EXISTS(SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.job_id AND r.state IN ('claimed','effect_started','uncertain')) OR (NEW.command_ordinal IS NULL AND EXISTS(SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.job_id AND c.state IN ('pending','running','uncertain'))) THEN RAISE(ABORT, 'lifecycle_receiver_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_command_insert BEFORE INSERT ON generation_control_commands BEGIN
  SELECT CASE WHEN NEW.state<>'pending' OR NEW.outcome_attempt IS NOT NULL OR NEW.ordinal<>(SELECT coalesce(max(ordinal),0)+1 FROM generation_control_commands WHERE job_id=NEW.job_id) OR NOT EXISTS (SELECT 1 FROM generation_jobs j JOIN generation_wait_contexts w ON w.job_id=j.id AND w.wait_generation=j.wait_generation JOIN generation_contexts c ON c.id=NEW.context_id JOIN generation_contexts wc ON wc.id=w.context_id JOIN sermon_input_events s ON s.sermon_id=c.sermon_id AND s.id=c.source_id WHERE j.id=NEW.job_id AND j.request_scope='full' AND j.status='awaiting_transcript_review' AND j.active_wait_generation=NEW.wait_generation AND w.enter_state_version=j.state_version AND c.job_id=j.id AND c.kind='step' AND c.state='assembling' AND c.fingerprint=NEW.fingerprint AND c.source_id=wc.source_id AND s.kind='source' AND s.source_type IN ('caption_plain','caption_timed') AND c.metadata_revision=wc.metadata_revision AND c.settings_revision IS wc.settings_revision) OR EXISTS(SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.job_id AND r.state IN ('claimed','effect_started','uncertain')) THEN RAISE(ABORT, 'lifecycle_command_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_command_transition BEFORE UPDATE ON generation_control_commands BEGIN
  SELECT CASE WHEN NEW.job_id IS NOT OLD.job_id OR NEW.ordinal IS NOT OLD.ordinal OR NEW.command_key IS NOT OLD.command_key OR NEW.wait_generation IS NOT OLD.wait_generation OR NEW.context_id IS NOT OLD.context_id OR NEW.actor_digest IS NOT OLD.actor_digest OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.step_key IS NOT OLD.step_key OR NEW.created_at IS NOT OLD.created_at OR OLD.state IN ('succeeded','rejected','stale') OR NOT((OLD.state='pending' AND NEW.state IN ('running','rejected','stale')) OR (OLD.state='running' AND NEW.state IN ('succeeded','rejected','stale','uncertain'))) OR (NEW.state='running' AND NOT EXISTS (SELECT 1 FROM generation_dispatch_receipts r JOIN generation_transition_evidence e ON e.job_id=r.job_id AND e.event_no=r.event_no WHERE r.job_id=NEW.job_id AND r.command_ordinal=NEW.ordinal AND r.wait_generation=NEW.wait_generation AND e.after_stage=NEW.step_key)) OR (NEW.state IN ('succeeded','uncertain') AND NEW.outcome_attempt IS NULL) OR (NEW.state='succeeded' AND NOT EXISTS (SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.job_id AND o.step_key=NEW.step_key AND o.attempt=NEW.outcome_attempt AND o.outcome='success')) THEN RAISE(ABORT, 'lifecycle_command_transition') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_outcome_insert BEFORE INSERT ON generation_step_outcomes BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_step_receipts r JOIN generation_contexts c ON c.id=r.context_id JOIN generation_transition_evidence e ON e.job_id=r.generation_job_id AND e.event_no=NEW.event_no WHERE r.generation_job_id=NEW.job_id AND r.step_key=NEW.step_key AND r.attempt_count=NEW.attempt AND r.context_id=NEW.context_id AND r.input_fingerprint=NEW.input_fingerprint AND r.task=NEW.task AND c.state='sealed' AND c.input_version IS NEW.before_input_version AND c.content_count=NEW.before_content_count AND r.state IN ('claimed','effect_started') AND e.context_id=c.id AND e.step_key=r.step_key AND e.attempt=r.attempt_count AND e.after_version=NEW.state_version AND e.reason= CASE NEW.outcome WHEN 'success' THEN 'step_succeeded' WHEN 'rejected' THEN 'step_rejected' WHEN 'stale' THEN 'step_stale' ELSE 'step_uncertain' END ) OR (NEW.call_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ai_provider_calls c WHERE c.id=NEW.call_id AND c.generation_job_id=NEW.job_id AND c.step_key=NEW.step_key AND c.attempt_number=NEW.attempt AND c.task=NEW.task AND c.input_fingerprint=NEW.input_fingerprint)) OR (NEW.usage_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ai_usage_observations o WHERE o.call_id=NEW.call_id AND o.usage_event_id=NEW.usage_event_id AND o.job_id=NEW.job_id AND o.step_key=NEW.step_key AND o.attempt=NEW.attempt)) OR (NEW.outcome='success' AND NOT EXISTS (SELECT 1 FROM generation_step_result_links l JOIN ai_usage_events u ON u.id=l.usage_event_id WHERE l.generation_job_id=NEW.job_id AND l.step_key=NEW.step_key AND l.task=NEW.task AND l.usage_event_id=NEW.usage_event_id AND u.provider_call_id=NEW.call_id)) OR (NEW.outcome<>'success' AND EXISTS(SELECT 1 FROM generation_step_result_links l WHERE l.generation_job_id=NEW.job_id AND l.step_key=NEW.step_key)) OR (NEW.outcome='uncertain' AND (NEW.reason<>'usage_unknown' OR NEW.usage_event_id IS NOT NULL)) THEN RAISE(ABORT, 'lifecycle_outcome_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_observation_insert BEFORE INSERT ON ai_usage_observations BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ai_provider_calls c JOIN generation_step_contexts s ON s.job_id=c.generation_job_id AND s.step_key=c.step_key JOIN generation_contexts x ON x.id=s.context_id WHERE c.id=NEW.call_id AND c.generation_job_id=NEW.job_id AND c.sermon_id=NEW.sermon_id AND c.quiz_set_id=NEW.quiz_set_id AND c.step_key=NEW.step_key AND c.attempt_number=NEW.attempt AND s.context_id=NEW.context_id AND x.state='sealed' AND c.input_fingerprint=NEW.input_fingerprint AND c.task=NEW.task AND c.provider=NEW.provider AND c.model=NEW.model AND c.reasoning_effort IS NEW.reasoning_effort AND c.provider_request_id_opaque IS NEW.provider_request_id_opaque AND c.started_at=NEW.started_at AND c.state IN ('effect_started','uncertain')) OR EXISTS(SELECT 1 FROM ai_usage_events u WHERE u.provider_call_id=NEW.call_id) THEN RAISE(ABORT, 'lifecycle_observation_insert') END;
END;
--> statement-breakpoint
DROP TRIGGER ai_provider_call_update_guard;
--> statement-breakpoint
CREATE TRIGGER ai_provider_call_update_guard BEFORE UPDATE ON ai_provider_calls BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.generation_job_id IS NOT OLD.generation_job_id OR NEW.step_key IS NOT OLD.step_key OR NEW.attempt_number IS NOT OLD.attempt_number OR NEW.quiz_set_id IS NOT OLD.quiz_set_id OR NEW.sermon_id IS NOT OLD.sermon_id OR NEW.task IS NOT OLD.task OR NEW.input_fingerprint IS NOT OLD.input_fingerprint OR NEW.provider IS NOT OLD.provider OR NEW.model IS NOT OLD.model OR NEW.reasoning_effort IS NOT OLD.reasoning_effort OR NEW.provider_request_id_opaque IS NOT OLD.provider_request_id_opaque OR NEW.started_at IS NOT OLD.started_at OR NOT((OLD.state='effect_started' AND NEW.state IN ('completed','uncertain')) OR (OLD.state='uncertain' AND NEW.state='completed')) OR (NEW.state='uncertain' AND NEW.settlement_call_id IS NOT NULL) OR (NEW.state='completed' AND (NEW.settlement_call_id IS NOT NEW.id OR NOT EXISTS (SELECT 1 FROM ai_usage_observations o WHERE o.call_id=NEW.id AND o.observed_at<=NEW.completed_at))) THEN RAISE(ABORT, 'ai_provider_call_update_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_usage_exact BEFORE INSERT ON ai_usage_events BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ai_usage_observations o WHERE o.call_id=NEW.provider_call_id AND o.usage_event_id=NEW.id AND o.job_id IS NEW.generation_job_id AND o.step_key IS NEW.step_key AND o.attempt IS NEW.attempt_number AND o.quiz_set_id IS NEW.quiz_set_id AND o.sermon_id IS NEW.sermon_id AND o.task IS NEW.task AND o.provider IS NEW.provider AND o.model IS NEW.model AND o.input_tokens IS NEW.input_tokens AND o.cached_input_tokens IS NEW.cached_input_tokens AND o.reasoning_tokens IS NEW.reasoning_tokens AND o.output_tokens IS NEW.output_tokens AND o.audio_input_tokens IS NEW.audio_input_tokens AND o.audio_seconds IS NEW.audio_seconds AND o.pricing_version IS NEW.pricing_version AND o.estimated_cost_micro_usd IS NEW.estimated_cost_micro_usd AND o.usage_source IS NEW.usage_source AND o.observed_at IS NEW.observed_at) THEN RAISE(ABORT, 'lifecycle_usage_exact') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_settlement_insert BEFORE INSERT ON ai_usage_settlements BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ai_usage_observations o JOIN ai_usage_events u ON u.id=o.usage_event_id JOIN ai_provider_calls c ON c.id=o.call_id JOIN generation_step_outcomes x ON x.job_id=NEW.job_id AND x.step_key=NEW.step_key AND x.attempt=NEW.attempt JOIN generation_step_receipts r ON r.generation_job_id=x.job_id AND r.step_key=x.step_key WHERE o.call_id=NEW.call_id AND o.usage_event_id=NEW.usage_event_id AND o.job_id=NEW.job_id AND o.step_key=NEW.step_key AND o.attempt=NEW.attempt AND o.fingerprint=NEW.fingerprint AND x.call_id=NEW.call_id AND c.state='completed' AND c.settlement_call_id=c.id AND NEW.settled_at>=o.observed_at AND ((x.outcome='success' AND x.usage_event_id=u.id AND r.state='succeeded') OR (x.outcome IN ('rejected','stale','uncertain') AND r.state IN ('terminal_failed','stale','uncertain') AND (x.usage_event_id IS NULL OR x.usage_event_id=u.id) AND NOT EXISTS(SELECT 1 FROM generation_step_result_links l WHERE l.generation_job_id=x.job_id AND l.step_key=x.step_key)))) THEN RAISE(ABORT, 'lifecycle_settlement_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_finish_current BEFORE UPDATE ON generation_jobs
WHEN NEW.status IN ('review_ready','needs_revision')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_transition_evidence e JOIN generation_contexts c ON c.id=e.context_id
    JOIN sermon_metadata_drafts m ON m.sermon_id=c.sermon_id
    JOIN generation_step_outcomes o ON o.job_id=e.job_id AND o.outcome='success' AND (o.context_id=c.id OR NEW.request_scope='intent')
    WHERE e.job_id=NEW.id AND e.event_no=NEW.event_count AND m.metadata_revision=c.metadata_revision
      AND ( CASE WHEN NEW.request_scope='intent' THEN c.input_version ELSE o.after_input_version END ) IS (SELECT version FROM sermon_input_heads WHERE sermon_id=c.sermon_id)
      AND ( CASE WHEN NEW.request_scope='intent' THEN c.content_count ELSE o.after_content_count END )=coalesce((SELECT event_count FROM sermon_content_heads WHERE sermon_id=c.sermon_id),0))
  THEN RAISE(ABORT, 'lifecycle_finish_current') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_usage_observations_value_guard BEFORE INSERT ON ai_usage_observations BEGIN
  SELECT CASE WHEN (NEW.call_id IS NOT NULL AND (typeof(NEW.call_id)<>'text' OR length(NEW.call_id) NOT BETWEEN 1 AND 128 OR NEW.call_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.usage_event_id IS NOT NULL AND (typeof(NEW.usage_event_id)<>'text' OR length(NEW.usage_event_id) NOT BETWEEN 1 AND 128 OR NEW.usage_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.job_id IS NOT NULL AND (typeof(NEW.job_id)<>'text' OR length(NEW.job_id) NOT BETWEEN 1 AND 128 OR NEW.job_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.sermon_id IS NOT NULL AND (typeof(NEW.sermon_id)<>'text' OR length(NEW.sermon_id) NOT BETWEEN 1 AND 128 OR NEW.sermon_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.quiz_set_id IS NOT NULL AND (typeof(NEW.quiz_set_id)<>'text' OR length(NEW.quiz_set_id) NOT BETWEEN 1 AND 128 OR NEW.quiz_set_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.step_key IS NOT NULL AND (typeof(NEW.step_key)<>'text' OR length(NEW.step_key) NOT BETWEEN 1 AND 128 OR NEW.step_key GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.attempt IS NOT NULL AND (typeof(NEW.attempt)<>'integer' OR NEW.attempt<0 OR NEW.attempt>9007199254740991)) OR (NEW.context_id IS NOT NULL AND (typeof(NEW.context_id)<>'text' OR length(NEW.context_id) NOT BETWEEN 1 AND 128 OR NEW.context_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.input_tokens IS NOT NULL AND (typeof(NEW.input_tokens)<>'integer' OR NEW.input_tokens<0 OR NEW.input_tokens>9007199254740991)) OR (NEW.cached_input_tokens IS NOT NULL AND (typeof(NEW.cached_input_tokens)<>'integer' OR NEW.cached_input_tokens<0 OR NEW.cached_input_tokens>9007199254740991)) OR (NEW.reasoning_tokens IS NOT NULL AND (typeof(NEW.reasoning_tokens)<>'integer' OR NEW.reasoning_tokens<0 OR NEW.reasoning_tokens>9007199254740991)) OR (NEW.output_tokens IS NOT NULL AND (typeof(NEW.output_tokens)<>'integer' OR NEW.output_tokens<0 OR NEW.output_tokens>9007199254740991)) OR (NEW.audio_input_tokens IS NOT NULL AND (typeof(NEW.audio_input_tokens)<>'integer' OR NEW.audio_input_tokens<0 OR NEW.audio_input_tokens>9007199254740991)) OR (NEW.audio_seconds IS NOT NULL AND (typeof(NEW.audio_seconds)<>'integer' OR NEW.audio_seconds<0 OR NEW.audio_seconds>9007199254740991)) OR (NEW.estimated_cost_micro_usd IS NOT NULL AND (typeof(NEW.estimated_cost_micro_usd)<>'integer' OR NEW.estimated_cost_micro_usd<0 OR NEW.estimated_cost_micro_usd>9007199254740991)) THEN RAISE(ABORT, 'ai_usage_observations_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_usage_settlements_value_guard BEFORE INSERT ON ai_usage_settlements BEGIN
  SELECT CASE WHEN (NEW.call_id IS NOT NULL AND (typeof(NEW.call_id)<>'text' OR length(NEW.call_id) NOT BETWEEN 1 AND 128 OR NEW.call_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.usage_event_id IS NOT NULL AND (typeof(NEW.usage_event_id)<>'text' OR length(NEW.usage_event_id) NOT BETWEEN 1 AND 128 OR NEW.usage_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.job_id IS NOT NULL AND (typeof(NEW.job_id)<>'text' OR length(NEW.job_id) NOT BETWEEN 1 AND 128 OR NEW.job_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.step_key IS NOT NULL AND (typeof(NEW.step_key)<>'text' OR length(NEW.step_key) NOT BETWEEN 1 AND 128 OR NEW.step_key GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.attempt IS NOT NULL AND (typeof(NEW.attempt)<>'integer' OR NEW.attempt<0 OR NEW.attempt>9007199254740991)) THEN RAISE(ABORT, 'ai_usage_settlements_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_context_chunks_value_guard BEFORE INSERT ON generation_context_chunks BEGIN
  SELECT CASE WHEN (NEW.context_id IS NOT NULL AND (typeof(NEW.context_id)<>'text' OR length(NEW.context_id) NOT BETWEEN 1 AND 128 OR NEW.context_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.position IS NOT NULL AND (typeof(NEW.position)<>'integer' OR NEW.position<0 OR NEW.position>9007199254740991)) THEN RAISE(ABORT, 'generation_context_chunks_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_contexts_value_guard BEFORE INSERT ON generation_contexts BEGIN
  SELECT CASE WHEN (NEW.id IS NOT NULL AND (typeof(NEW.id)<>'text' OR length(NEW.id) NOT BETWEEN 1 AND 128 OR NEW.id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.job_id IS NOT NULL AND (typeof(NEW.job_id)<>'text' OR length(NEW.job_id) NOT BETWEEN 1 AND 128 OR NEW.job_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.sermon_id IS NOT NULL AND (typeof(NEW.sermon_id)<>'text' OR length(NEW.sermon_id) NOT BETWEEN 1 AND 128 OR NEW.sermon_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.quiz_set_id IS NOT NULL AND (typeof(NEW.quiz_set_id)<>'text' OR length(NEW.quiz_set_id) NOT BETWEEN 1 AND 128 OR NEW.quiz_set_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.contract_version IS NOT NULL AND (typeof(NEW.contract_version)<>'integer' OR NEW.contract_version<0 OR NEW.contract_version>9007199254740991)) OR (NEW.validator_version IS NOT NULL AND (typeof(NEW.validator_version)<>'integer' OR NEW.validator_version<0 OR NEW.validator_version>9007199254740991)) OR (NEW.assembly_version IS NOT NULL AND (typeof(NEW.assembly_version)<>'integer' OR NEW.assembly_version<0 OR NEW.assembly_version>9007199254740991)) OR (NEW.input_version IS NOT NULL AND (typeof(NEW.input_version)<>'integer' OR NEW.input_version<0 OR NEW.input_version>9007199254740991)) OR (NEW.source_id IS NOT NULL AND (typeof(NEW.source_id)<>'text' OR length(NEW.source_id) NOT BETWEEN 1 AND 128 OR NEW.source_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.document_id IS NOT NULL AND (typeof(NEW.document_id)<>'text' OR length(NEW.document_id) NOT BETWEEN 1 AND 128 OR NEW.document_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.confirmation_id IS NOT NULL AND (typeof(NEW.confirmation_id)<>'text' OR length(NEW.confirmation_id) NOT BETWEEN 1 AND 128 OR NEW.confirmation_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.content_count IS NOT NULL AND (typeof(NEW.content_count)<>'integer' OR NEW.content_count<0 OR NEW.content_count>9007199254740991)) OR (NEW.last_content_event_id IS NOT NULL AND (typeof(NEW.last_content_event_id)<>'text' OR length(NEW.last_content_event_id) NOT BETWEEN 1 AND 128 OR NEW.last_content_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.analysis_event_id IS NOT NULL AND (typeof(NEW.analysis_event_id)<>'text' OR length(NEW.analysis_event_id) NOT BETWEEN 1 AND 128 OR NEW.analysis_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.critique_event_id IS NOT NULL AND (typeof(NEW.critique_event_id)<>'text' OR length(NEW.critique_event_id) NOT BETWEEN 1 AND 128 OR NEW.critique_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.intent_confirmation_event_id IS NOT NULL AND (typeof(NEW.intent_confirmation_event_id)<>'text' OR length(NEW.intent_confirmation_event_id) NOT BETWEEN 1 AND 128 OR NEW.intent_confirmation_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.summary_event_id IS NOT NULL AND (typeof(NEW.summary_event_id)<>'text' OR length(NEW.summary_event_id) NOT BETWEEN 1 AND 128 OR NEW.summary_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.summary_review_event_id IS NOT NULL AND (typeof(NEW.summary_review_event_id)<>'text' OR length(NEW.summary_review_event_id) NOT BETWEEN 1 AND 128 OR NEW.summary_review_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.child_event_id IS NOT NULL AND (typeof(NEW.child_event_id)<>'text' OR length(NEW.child_event_id) NOT BETWEEN 1 AND 128 OR NEW.child_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.child_review_event_id IS NOT NULL AND (typeof(NEW.child_review_event_id)<>'text' OR length(NEW.child_review_event_id) NOT BETWEEN 1 AND 128 OR NEW.child_review_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.adult_event_id IS NOT NULL AND (typeof(NEW.adult_event_id)<>'text' OR length(NEW.adult_event_id) NOT BETWEEN 1 AND 128 OR NEW.adult_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.adult_review_event_id IS NOT NULL AND (typeof(NEW.adult_review_event_id)<>'text' OR length(NEW.adult_review_event_id) NOT BETWEEN 1 AND 128 OR NEW.adult_review_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.metadata_revision IS NOT NULL AND (typeof(NEW.metadata_revision)<>'integer' OR NEW.metadata_revision<0 OR NEW.metadata_revision>9007199254740991)) OR (NEW.settings_revision IS NOT NULL AND (typeof(NEW.settings_revision)<>'integer' OR NEW.settings_revision<0 OR NEW.settings_revision>9007199254740991)) OR (NEW.selection_revision IS NOT NULL AND (typeof(NEW.selection_revision)<>'integer' OR NEW.selection_revision<0 OR NEW.selection_revision>9007199254740991)) OR (NEW.ticket_id IS NOT NULL AND (typeof(NEW.ticket_id)<>'text' OR length(NEW.ticket_id) NOT BETWEEN 1 AND 128 OR NEW.ticket_id GLOB '*[^A-Za-z0-9_-]*')) THEN RAISE(ABORT, 'generation_contexts_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_control_commands_value_guard BEFORE INSERT ON generation_control_commands BEGIN
  SELECT CASE WHEN (NEW.job_id IS NOT NULL AND (typeof(NEW.job_id)<>'text' OR length(NEW.job_id) NOT BETWEEN 1 AND 128 OR NEW.job_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.ordinal IS NOT NULL AND (typeof(NEW.ordinal)<>'integer' OR NEW.ordinal<0 OR NEW.ordinal>9007199254740991)) OR (NEW.command_key IS NOT NULL AND (typeof(NEW.command_key)<>'text' OR length(NEW.command_key) NOT BETWEEN 1 AND 128 OR NEW.command_key GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.wait_generation IS NOT NULL AND (typeof(NEW.wait_generation)<>'integer' OR NEW.wait_generation<0 OR NEW.wait_generation>9007199254740991)) OR (NEW.context_id IS NOT NULL AND (typeof(NEW.context_id)<>'text' OR length(NEW.context_id) NOT BETWEEN 1 AND 128 OR NEW.context_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.step_key IS NOT NULL AND (typeof(NEW.step_key)<>'text' OR length(NEW.step_key) NOT BETWEEN 1 AND 128 OR NEW.step_key GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.outcome_attempt IS NOT NULL AND (typeof(NEW.outcome_attempt)<>'integer' OR NEW.outcome_attempt<0 OR NEW.outcome_attempt>9007199254740991)) THEN RAISE(ABORT, 'generation_control_commands_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_dispatch_attempts_value_guard BEFORE INSERT ON generation_dispatch_attempts BEGIN
  SELECT CASE WHEN (NEW.dispatch_id IS NOT NULL AND (typeof(NEW.dispatch_id)<>'text' OR length(NEW.dispatch_id) NOT BETWEEN 1 AND 128 OR NEW.dispatch_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.attempt IS NOT NULL AND (typeof(NEW.attempt)<>'integer' OR NEW.attempt<0 OR NEW.attempt>9007199254740991)) OR (NEW.claim_token IS NOT NULL AND (typeof(NEW.claim_token)<>'text' OR length(NEW.claim_token) NOT BETWEEN 1 AND 128 OR NEW.claim_token GLOB '*[^A-Za-z0-9_-]*')) THEN RAISE(ABORT, 'generation_dispatch_attempts_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_dispatch_receipts_value_guard BEFORE INSERT ON generation_dispatch_receipts BEGIN
  SELECT CASE WHEN (NEW.dispatch_id IS NOT NULL AND (typeof(NEW.dispatch_id)<>'text' OR length(NEW.dispatch_id) NOT BETWEEN 1 AND 128 OR NEW.dispatch_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.job_id IS NOT NULL AND (typeof(NEW.job_id)<>'text' OR length(NEW.job_id) NOT BETWEEN 1 AND 128 OR NEW.job_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.workflow_instance_id IS NOT NULL AND (typeof(NEW.workflow_instance_id)<>'text' OR length(NEW.workflow_instance_id) NOT BETWEEN 1 AND 128 OR NEW.workflow_instance_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.request_context_id IS NOT NULL AND (typeof(NEW.request_context_id)<>'text' OR length(NEW.request_context_id) NOT BETWEEN 1 AND 128 OR NEW.request_context_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.context_id IS NOT NULL AND (typeof(NEW.context_id)<>'text' OR length(NEW.context_id) NOT BETWEEN 1 AND 128 OR NEW.context_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.wait_generation IS NOT NULL AND (typeof(NEW.wait_generation)<>'integer' OR NEW.wait_generation<0 OR NEW.wait_generation>9007199254740991)) OR (NEW.command_ordinal IS NOT NULL AND (typeof(NEW.command_ordinal)<>'integer' OR NEW.command_ordinal<0 OR NEW.command_ordinal>9007199254740991)) OR (NEW.event_no IS NOT NULL AND (typeof(NEW.event_no)<>'integer' OR NEW.event_no<0 OR NEW.event_no>9007199254740991)) OR (NEW.state_version IS NOT NULL AND (typeof(NEW.state_version)<>'integer' OR NEW.state_version<0 OR NEW.state_version>9007199254740991)) THEN RAISE(ABORT, 'generation_dispatch_receipts_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_request_contexts_value_guard BEFORE INSERT ON generation_request_contexts BEGIN
  SELECT CASE WHEN (NEW.job_id IS NOT NULL AND (typeof(NEW.job_id)<>'text' OR length(NEW.job_id) NOT BETWEEN 1 AND 128 OR NEW.job_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.context_id IS NOT NULL AND (typeof(NEW.context_id)<>'text' OR length(NEW.context_id) NOT BETWEEN 1 AND 128 OR NEW.context_id GLOB '*[^A-Za-z0-9_-]*')) THEN RAISE(ABORT, 'generation_request_contexts_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_step_contexts_value_guard BEFORE INSERT ON generation_step_contexts BEGIN
  SELECT CASE WHEN (NEW.job_id IS NOT NULL AND (typeof(NEW.job_id)<>'text' OR length(NEW.job_id) NOT BETWEEN 1 AND 128 OR NEW.job_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.step_key IS NOT NULL AND (typeof(NEW.step_key)<>'text' OR length(NEW.step_key) NOT BETWEEN 1 AND 128 OR NEW.step_key GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.context_id IS NOT NULL AND (typeof(NEW.context_id)<>'text' OR length(NEW.context_id) NOT BETWEEN 1 AND 128 OR NEW.context_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.request_context_id IS NOT NULL AND (typeof(NEW.request_context_id)<>'text' OR length(NEW.request_context_id) NOT BETWEEN 1 AND 128 OR NEW.request_context_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.predecessor_event_no IS NOT NULL AND (typeof(NEW.predecessor_event_no)<>'integer' OR NEW.predecessor_event_no<0 OR NEW.predecessor_event_no>9007199254740991)) OR (NEW.predecessor_state_version IS NOT NULL AND (typeof(NEW.predecessor_state_version)<>'integer' OR NEW.predecessor_state_version<0 OR NEW.predecessor_state_version>9007199254740991)) OR (NEW.command_ordinal IS NOT NULL AND (typeof(NEW.command_ordinal)<>'integer' OR NEW.command_ordinal<0 OR NEW.command_ordinal>9007199254740991)) THEN RAISE(ABORT, 'generation_step_contexts_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_step_outcomes_value_guard BEFORE INSERT ON generation_step_outcomes BEGIN
  SELECT CASE WHEN (NEW.job_id IS NOT NULL AND (typeof(NEW.job_id)<>'text' OR length(NEW.job_id) NOT BETWEEN 1 AND 128 OR NEW.job_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.step_key IS NOT NULL AND (typeof(NEW.step_key)<>'text' OR length(NEW.step_key) NOT BETWEEN 1 AND 128 OR NEW.step_key GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.attempt IS NOT NULL AND (typeof(NEW.attempt)<>'integer' OR NEW.attempt<0 OR NEW.attempt>9007199254740991)) OR (NEW.context_id IS NOT NULL AND (typeof(NEW.context_id)<>'text' OR length(NEW.context_id) NOT BETWEEN 1 AND 128 OR NEW.context_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.event_no IS NOT NULL AND (typeof(NEW.event_no)<>'integer' OR NEW.event_no<0 OR NEW.event_no>9007199254740991)) OR (NEW.state_version IS NOT NULL AND (typeof(NEW.state_version)<>'integer' OR NEW.state_version<0 OR NEW.state_version>9007199254740991)) OR (NEW.call_id IS NOT NULL AND (typeof(NEW.call_id)<>'text' OR length(NEW.call_id) NOT BETWEEN 1 AND 128 OR NEW.call_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.usage_event_id IS NOT NULL AND (typeof(NEW.usage_event_id)<>'text' OR length(NEW.usage_event_id) NOT BETWEEN 1 AND 128 OR NEW.usage_event_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.before_input_version IS NOT NULL AND (typeof(NEW.before_input_version)<>'integer' OR NEW.before_input_version<0 OR NEW.before_input_version>9007199254740991)) OR (NEW.after_input_version IS NOT NULL AND (typeof(NEW.after_input_version)<>'integer' OR NEW.after_input_version<0 OR NEW.after_input_version>9007199254740991)) OR (NEW.before_content_count IS NOT NULL AND (typeof(NEW.before_content_count)<>'integer' OR NEW.before_content_count<0 OR NEW.before_content_count>9007199254740991)) OR (NEW.after_content_count IS NOT NULL AND (typeof(NEW.after_content_count)<>'integer' OR NEW.after_content_count<0 OR NEW.after_content_count>9007199254740991)) THEN RAISE(ABORT, 'generation_step_outcomes_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_transition_evidence_value_guard BEFORE INSERT ON generation_transition_evidence BEGIN
  SELECT CASE WHEN (NEW.job_id IS NOT NULL AND (typeof(NEW.job_id)<>'text' OR length(NEW.job_id) NOT BETWEEN 1 AND 128 OR NEW.job_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.event_no IS NOT NULL AND (typeof(NEW.event_no)<>'integer' OR NEW.event_no<0 OR NEW.event_no>9007199254740991)) OR (NEW.before_version IS NOT NULL AND (typeof(NEW.before_version)<>'integer' OR NEW.before_version<0 OR NEW.before_version>9007199254740991)) OR (NEW.after_version IS NOT NULL AND (typeof(NEW.after_version)<>'integer' OR NEW.after_version<0 OR NEW.after_version>9007199254740991)) OR (NEW.before_wait IS NOT NULL AND (typeof(NEW.before_wait)<>'integer' OR NEW.before_wait<0 OR NEW.before_wait>9007199254740991)) OR (NEW.after_wait IS NOT NULL AND (typeof(NEW.after_wait)<>'integer' OR NEW.after_wait<0 OR NEW.after_wait>9007199254740991)) OR (NEW.context_id IS NOT NULL AND (typeof(NEW.context_id)<>'text' OR length(NEW.context_id) NOT BETWEEN 1 AND 128 OR NEW.context_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.step_key IS NOT NULL AND (typeof(NEW.step_key)<>'text' OR length(NEW.step_key) NOT BETWEEN 1 AND 128 OR NEW.step_key GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.attempt IS NOT NULL AND (typeof(NEW.attempt)<>'integer' OR NEW.attempt<0 OR NEW.attempt>9007199254740991)) OR (NEW.dispatch_id IS NOT NULL AND (typeof(NEW.dispatch_id)<>'text' OR length(NEW.dispatch_id) NOT BETWEEN 1 AND 128 OR NEW.dispatch_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.command_ordinal IS NOT NULL AND (typeof(NEW.command_ordinal)<>'integer' OR NEW.command_ordinal<0 OR NEW.command_ordinal>9007199254740991)) THEN RAISE(ABORT, 'generation_transition_evidence_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_wait_contexts_value_guard BEFORE INSERT ON generation_wait_contexts BEGIN
  SELECT CASE WHEN (NEW.job_id IS NOT NULL AND (typeof(NEW.job_id)<>'text' OR length(NEW.job_id) NOT BETWEEN 1 AND 128 OR NEW.job_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.wait_generation IS NOT NULL AND (typeof(NEW.wait_generation)<>'integer' OR NEW.wait_generation<0 OR NEW.wait_generation>9007199254740991)) OR (NEW.context_id IS NOT NULL AND (typeof(NEW.context_id)<>'text' OR length(NEW.context_id) NOT BETWEEN 1 AND 128 OR NEW.context_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.request_context_id IS NOT NULL AND (typeof(NEW.request_context_id)<>'text' OR length(NEW.request_context_id) NOT BETWEEN 1 AND 128 OR NEW.request_context_id GLOB '*[^A-Za-z0-9_-]*')) OR (NEW.enter_event_no IS NOT NULL AND (typeof(NEW.enter_event_no)<>'integer' OR NEW.enter_event_no<0 OR NEW.enter_event_no>9007199254740991)) OR (NEW.enter_state_version IS NOT NULL AND (typeof(NEW.enter_state_version)<>'integer' OR NEW.enter_state_version<0 OR NEW.enter_state_version>9007199254740991)) OR (NEW.parent_wait_generation IS NOT NULL AND (typeof(NEW.parent_wait_generation)<>'integer' OR NEW.parent_wait_generation<0 OR NEW.parent_wait_generation>9007199254740991)) OR (NEW.command_ordinal IS NOT NULL AND (typeof(NEW.command_ordinal)<>'integer' OR NEW.command_ordinal<0 OR NEW.command_ordinal>9007199254740991)) OR (NEW.parent_attempt IS NOT NULL AND (typeof(NEW.parent_attempt)<>'integer' OR NEW.parent_attempt<0 OR NEW.parent_attempt>9007199254740991)) THEN RAISE(ABORT, 'generation_wait_contexts_value_guard') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_receiver_stage BEFORE INSERT ON generation_dispatch_receipts BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_job_dispatches d JOIN generation_jobs j ON j.id=d.generation_job_id JOIN generation_transition_evidence e ON e.job_id=j.id AND e.event_no=NEW.event_no WHERE d.id=NEW.dispatch_id AND ((d.kind='start' AND e.after_stage= CASE j.request_scope WHEN 'full' THEN 'input_resolve' WHEN 'transcript_correction' THEN 'correction' WHEN 'intent' THEN 'transcript_review' WHEN 'summary' THEN 'summary' WHEN 'child' THEN 'child_candidates' WHEN 'adult' THEN 'adult_candidates' WHEN 'final_audit' THEN 'content_review' END ) OR (d.kind='correction' AND EXISTS(SELECT 1 FROM generation_control_commands c WHERE c.job_id=j.id AND c.ordinal=d.command_ordinal AND c.state='pending' AND c.step_key=e.after_stage AND c.wait_generation=j.active_wait_generation AND c.context_id=d.context_id)) OR (d.kind='resume_transcript_review' AND e.after_stage='intent_analysis') OR (d.kind='resume_intent_review' AND e.after_stage= CASE j.request_scope WHEN 'intent' THEN 'finish' WHEN 'full' THEN 'summary' END ))) THEN RAISE(ABORT, 'lifecycle_receiver_stage') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_step_task_stage BEFORE INSERT ON generation_step_contexts BEGIN
  SELECT CASE WHEN NEW.task<> CASE WHEN NEW.step_key='input_resolve' THEN 'fetch_transcript' WHEN NEW.step_key IN ('place_child','place_adult') THEN 'place_grid' WHEN NEW.step_key='final_validate' THEN 'validate' WHEN NEW.step_key GLOB 'correction_[0-9]*' THEN 'correction' ELSE NEW.step_key END OR (NEW.command_ordinal IS NOT NULL AND NOT EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.job_id AND c.ordinal=NEW.command_ordinal AND c.context_id=NEW.context_id AND c.step_key=NEW.step_key AND c.state='running')) THEN RAISE(ABORT, 'lifecycle_step_task_stage') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_outcome_heads BEFORE INSERT ON generation_step_outcomes BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_contexts c WHERE c.id=NEW.context_id AND NEW.after_input_version IS (SELECT h.version FROM sermon_input_heads h WHERE h.sermon_id=c.sermon_id) AND NEW.after_content_count=coalesce((SELECT h.event_count FROM sermon_content_heads h WHERE h.sermon_id=c.sermon_id),0)) OR (NEW.task IN ('correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','final_audit') AND NEW.call_id IS NULL AND NOT (NEW.outcome='stale' AND EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.job_id AND r.step_key=NEW.step_key AND r.state='claimed'))) THEN RAISE(ABORT, 'lifecycle_outcome_heads') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_finish_proofs BEFORE UPDATE ON generation_jobs BEGIN
  SELECT CASE WHEN NEW.status='review_ready' AND (NEW.request_scope IN ('full','final_audit','single_entry') OR NOT EXISTS (SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.id AND o.outcome='success' AND o.task= CASE NEW.request_scope WHEN 'transcript_correction' THEN 'correction' WHEN 'intent' THEN 'intent_critique' WHEN 'summary' THEN 'summary' WHEN 'child' THEN 'child_candidates' WHEN 'adult' THEN 'adult_candidates' END )) THEN RAISE(ABORT, 'lifecycle_finish_proofs') END;
END;
--> statement-breakpoint
-- P5-44b: wait identity and pending correction registration are one sealed bundle.
CREATE TRIGGER lifecycle_wait_identity BEFORE INSERT ON generation_wait_contexts BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_jobs j
    JOIN generation_contexts c ON c.id=NEW.context_id
    JOIN generation_transition_evidence e ON e.job_id=j.id AND e.event_no=NEW.enter_event_no
    WHERE j.id=NEW.job_id AND NEW.request_context_id=j.request_context_id
      AND c.state='assembling' AND c.input_state='present'
      AND ((NEW.kind='transcript_review' AND j.request_scope IN ('full','intent'))
        OR (NEW.kind='intent_review' AND j.request_scope IN ('full','intent')))
      AND (e.reason<>'wait_entered' OR (e.context_id=c.id AND e.fingerprint=c.fingerprint))
  ) OR EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.job_id
    AND r.state IN ('claimed','effect_started','uncertain'))
  THEN RAISE(ABORT, 'lifecycle_wait_identity') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_wait_job BEFORE UPDATE ON generation_jobs BEGIN
  SELECT CASE WHEN NEW.wait_kind IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM generation_wait_contexts w JOIN generation_contexts c ON c.id=w.context_id
    WHERE w.job_id=NEW.id AND w.wait_generation=NEW.active_wait_generation
      AND w.kind=NEW.wait_kind AND w.enter_state_version=NEW.state_version
      AND w.enter_event_no=NEW.event_count AND c.state='sealed'
      AND c.fingerprint=NEW.wait_input_fingerprint
  ) THEN RAISE(ABORT, 'lifecycle_wait_job') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_command_expected BEFORE INSERT ON generation_control_commands BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_contexts c
    JOIN generation_wait_contexts w ON w.job_id=NEW.job_id AND w.wait_generation=NEW.wait_generation
    JOIN generation_contexts wc ON wc.id=w.context_id
    WHERE c.id=NEW.context_id AND wc.state='sealed' AND w.kind='transcript_review'
      AND c.input_state=wc.input_state AND c.input_version IS wc.input_version
      AND c.source_id IS wc.source_id AND c.document_id IS wc.document_id
      AND c.document_sha256 IS wc.document_sha256 AND c.confirmation_id IS wc.confirmation_id
      AND c.content_count=wc.content_count AND c.last_content_event_id IS wc.last_content_event_id
      AND c.analysis_event_id IS wc.analysis_event_id AND c.critique_event_id IS wc.critique_event_id
      AND c.intent_confirmation_event_id IS wc.intent_confirmation_event_id
      AND c.summary_event_id IS wc.summary_event_id AND c.summary_review_event_id IS wc.summary_review_event_id
      AND c.child_event_id IS wc.child_event_id AND c.child_review_event_id IS wc.child_review_event_id
      AND c.adult_event_id IS wc.adult_event_id AND c.adult_review_event_id IS wc.adult_review_event_id
      AND c.metadata_revision=wc.metadata_revision AND c.settings_revision IS wc.settings_revision
      AND c.selection_revision IS wc.selection_revision AND c.ticket_id IS wc.ticket_id
      AND c.ticket_fingerprint IS wc.ticket_fingerprint
  ) THEN RAISE(ABORT, 'lifecycle_command_expected') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_correction_dispatch BEFORE INSERT ON generation_job_dispatches
WHEN NEW.kind='correction'
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_contexts c WHERE c.id=NEW.context_id AND c.state='assembling')
    OR EXISTS (SELECT 1 FROM generation_job_dispatches d WHERE d.generation_job_id=NEW.generation_job_id
      AND d.kind='correction' AND d.command_ordinal=NEW.command_ordinal)
  THEN RAISE(ABORT, 'lifecycle_correction_dispatch') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_command_dispatch_seal BEFORE UPDATE ON generation_contexts
WHEN NEW.kind='step' AND EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.context_id=NEW.id)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_control_commands c JOIN generation_jobs j ON j.id=c.job_id
    JOIN generation_job_dispatches d ON d.generation_job_id=c.job_id AND d.command_ordinal=c.ordinal
    WHERE c.context_id=NEW.id AND c.state='pending' AND j.status='awaiting_transcript_review'
      AND d.kind='correction' AND d.context_id=NEW.id AND d.state='pending'
      AND d.wait_generation=c.wait_generation AND d.wait_generation=j.active_wait_generation
      AND d.job_state_version=j.state_version
  ) THEN RAISE(ABORT, 'lifecycle_command_dispatch_seal') END;
END;
--> statement-breakpoint
-- P5-44c: one consumer of an active wait; correction consumes its whole bundle.
CREATE TRIGGER lifecycle_resume_identity BEFORE INSERT ON generation_job_dispatches
WHEN NEW.kind IN ('resume_transcript_review','resume_intent_review')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_jobs j JOIN generation_wait_contexts w ON w.job_id=j.id
    JOIN generation_contexts c ON c.id=w.context_id
    WHERE j.id=NEW.generation_job_id AND w.wait_generation=j.active_wait_generation
      AND w.wait_generation=NEW.wait_generation AND w.enter_state_version=NEW.job_state_version
      AND NEW.context_id=w.context_id AND NEW.kind='resume_' || w.kind AND c.state='sealed'
  ) THEN RAISE(ABORT, 'lifecycle_resume_identity') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_wait_receiver BEFORE INSERT ON generation_dispatch_receipts
WHEN NEW.wait_generation IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_jobs j JOIN generation_wait_contexts w ON w.job_id=j.id
    JOIN generation_transition_evidence e ON e.job_id=j.id AND e.event_no=NEW.event_no
    JOIN generation_job_dispatches d ON d.id=NEW.dispatch_id
    WHERE j.id=NEW.job_id AND w.wait_generation=j.active_wait_generation
      AND w.wait_generation=NEW.wait_generation AND w.enter_state_version=j.state_version
      AND e.before_wait=NEW.wait_generation AND e.after_wait IS NULL
      AND e.command_ordinal IS NEW.command_ordinal AND e.attempt=d.attempt_count
  ) OR (NEW.command_ordinal IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM generation_contexts c JOIN sermon_input_heads h ON h.sermon_id=c.sermon_id
    JOIN sermon_input_events i ON i.sermon_id=h.sermon_id AND i.version=h.version
    JOIN sermon_metadata_drafts m ON m.sermon_id=c.sermon_id
    WHERE c.id=NEW.context_id AND c.input_state='present' AND h.version=c.input_version
      AND i.state='sealed' AND i.source_id=c.source_id AND i.document_id=c.document_id
      AND i.document_sha256=c.document_sha256 AND i.confirmation_id IS c.confirmation_id
      AND m.metadata_revision=c.metadata_revision
      AND c.content_count=coalesce((SELECT ch.event_count FROM sermon_content_heads ch WHERE ch.sermon_id=c.sermon_id),0)
      AND c.last_content_event_id IS (SELECT ch.last_event_id FROM sermon_content_heads ch WHERE ch.sermon_id=c.sermon_id)
  )) THEN RAISE(ABORT, 'lifecycle_wait_receiver') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_command_consume BEFORE UPDATE ON generation_control_commands
WHEN NEW.state='running'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_jobs j JOIN generation_dispatch_receipts r ON r.job_id=j.id
    JOIN generation_job_dispatches d ON d.id=r.dispatch_id
    JOIN generation_transition_evidence e ON e.job_id=j.id AND e.event_no=r.event_no
    WHERE j.id=NEW.job_id AND j.status='awaiting_transcript_review'
      AND j.active_wait_generation=NEW.wait_generation AND r.wait_generation=NEW.wait_generation
      AND r.command_ordinal=NEW.ordinal AND r.context_id=NEW.context_id
      AND d.kind='correction' AND d.state='acknowledged' AND d.receiver_dispatch_id=d.id
      AND e.before_version=j.state_version AND e.after_version=j.state_version+1
      AND e.after_stage=NEW.step_key AND e.command_ordinal=NEW.ordinal
  ) THEN RAISE(ABORT, 'lifecycle_command_consume') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_superseded_resume BEFORE UPDATE ON generation_job_dispatches
WHEN NEW.kind IN ('resume_transcript_review','resume_intent_review') AND NEW.state='stale'
  AND EXISTS (SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.status='awaiting_transcript_review')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_jobs j JOIN generation_control_commands c ON c.job_id=j.id
    JOIN generation_dispatch_receipts r ON r.job_id=j.id AND r.command_ordinal=c.ordinal
    JOIN generation_transition_evidence e ON e.job_id=j.id AND e.event_no=r.event_no
    WHERE j.id=NEW.generation_job_id AND c.state='running' AND c.wait_generation=NEW.wait_generation
      AND r.wait_generation=NEW.wait_generation AND e.before_version=j.state_version
      AND e.before_wait=j.active_wait_generation AND e.after_wait IS NULL
   ) AND NOT EXISTS (
    SELECT 1 FROM generation_jobs j JOIN generation_control_commands c ON c.job_id=j.id
    JOIN generation_transition_evidence e ON e.job_id=j.id AND e.command_ordinal=c.ordinal
    WHERE j.id=NEW.generation_job_id AND c.state='rejected' AND c.outcome_attempt IS NULL
      AND c.wait_generation=NEW.wait_generation AND e.before_version=j.state_version
      AND e.before_wait=j.active_wait_generation AND e.after_wait=j.wait_generation+1 AND e.reason='wait_entered'
   ) AND NOT EXISTS (
    SELECT 1 FROM generation_jobs j JOIN generation_transition_evidence e ON e.job_id=j.id
    WHERE j.id=NEW.generation_job_id AND e.event_no=j.event_count+1 AND e.before_version=j.state_version
      AND e.reason='job_stale' AND e.after_status='stale'
  ) THEN RAISE(ABORT, 'lifecycle_superseded_resume') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_wait_consume_job BEFORE UPDATE ON generation_jobs
WHEN OLD.status IN ('awaiting_transcript_review','awaiting_intent_review') AND NEW.status='running'
BEGIN
  SELECT CASE WHEN NEW.wait_generation<>OLD.wait_generation OR NEW.active_wait_generation IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM generation_transition_evidence e
      JOIN generation_dispatch_receipts r ON r.job_id=e.job_id AND r.event_no=e.event_no
      JOIN generation_job_dispatches d ON d.id=r.dispatch_id
      WHERE e.job_id=NEW.id AND e.event_no=NEW.event_count AND e.reason='received'
        AND e.dispatch_id=d.id AND e.before_version=OLD.state_version AND e.after_version=NEW.state_version
        AND r.wait_generation=OLD.active_wait_generation AND d.state='acknowledged'
        AND d.receiver_dispatch_id=d.id AND e.command_ordinal IS d.command_ordinal
        AND ((d.kind IN ('resume_transcript_review','resume_intent_review') AND NOT EXISTS (
          SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.id AND c.state IN ('pending','running','uncertain')))
        OR (d.kind='correction' AND EXISTS (
          SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.id AND c.ordinal=d.command_ordinal
            AND c.state='running' AND c.step_key=NEW.current_step AND c.context_id=d.context_id
            AND c.wait_generation=OLD.active_wait_generation)
          AND NOT EXISTS (SELECT 1 FROM generation_job_dispatches old_resume WHERE old_resume.generation_job_id=NEW.id
            AND old_resume.kind IN ('resume_transcript_review','resume_intent_review')
            AND old_resume.wait_generation=OLD.active_wait_generation
            AND old_resume.state NOT IN ('stale','terminal_failed'))))
    ) THEN RAISE(ABORT, 'lifecycle_wait_consume_job') END;
END;
--> statement-breakpoint
-- P5-44d: a consumed correction uses its original sealed command context.
CREATE TRIGGER lifecycle_correction_step BEFORE INSERT ON generation_step_contexts
WHEN NEW.command_ordinal IS NOT NULL OR EXISTS (
  SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.job_id AND c.step_key=NEW.step_key)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_control_commands c
    JOIN generation_contexts x ON x.id=c.context_id
    JOIN generation_jobs j ON j.id=c.job_id
    JOIN generation_transition_evidence e ON e.job_id=j.id AND e.event_no=NEW.predecessor_event_no
    JOIN generation_dispatch_receipts d ON d.dispatch_id=e.dispatch_id AND d.job_id=j.id
    WHERE c.job_id=NEW.job_id AND c.ordinal=NEW.command_ordinal AND c.state='running'
      AND c.step_key=NEW.step_key AND c.context_id=NEW.context_id AND NEW.task='correction'
      AND NEW.request_context_id=j.request_context_id AND NEW.predecessor_kind='wait_consume'
      AND x.state='sealed' AND x.fingerprint=NEW.input_fingerprint
      AND e.reason='received' AND e.command_ordinal=c.ordinal AND e.context_id=x.id
      AND e.after_version=NEW.predecessor_state_version AND e.after_stage=c.step_key
      AND e.before_wait=c.wait_generation AND e.after_wait IS NULL
      AND d.command_ordinal=c.ordinal AND d.context_id=x.id AND d.wait_generation=c.wait_generation
      AND d.event_no=e.event_no AND d.state_version=e.after_version
      AND x.input_version=(SELECT h.version FROM sermon_input_heads h WHERE h.sermon_id=x.sermon_id)
      AND x.metadata_revision=(SELECT m.metadata_revision FROM sermon_metadata_drafts m WHERE m.sermon_id=x.sermon_id)
      AND x.content_count=coalesce((SELECT h.event_count FROM sermon_content_heads h WHERE h.sermon_id=x.sermon_id),0)
      AND x.last_content_event_id IS (SELECT h.last_event_id FROM sermon_content_heads h WHERE h.sermon_id=x.sermon_id)
  ) THEN RAISE(ABORT, 'lifecycle_correction_step') END;
END;
--> statement-breakpoint
-- The immutable outcome fixes both the proposal append and the next wait.
CREATE TRIGGER lifecycle_correction_outcome BEFORE INSERT ON generation_step_outcomes
WHEN NEW.outcome='success' AND EXISTS (
  SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.job_id AND c.step_key=NEW.step_key)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_control_commands c
    JOIN generation_step_contexts s ON s.job_id=c.job_id AND s.step_key=c.step_key
    JOIN generation_step_receipts r ON r.generation_job_id=c.job_id AND r.step_key=c.step_key
    JOIN generation_transition_evidence e ON e.job_id=c.job_id AND e.event_no=NEW.event_no
    JOIN generation_step_result_links l ON l.generation_job_id=c.job_id AND l.step_key=c.step_key
    WHERE c.job_id=NEW.job_id AND c.step_key=NEW.step_key AND c.state='running'
      AND s.command_ordinal=c.ordinal AND c.context_id=NEW.context_id AND NEW.task='correction'
      AND r.state='effect_started' AND r.attempt_count=NEW.attempt
      AND e.command_ordinal=c.ordinal AND e.dispatch_id IS NULL AND e.before_stage=c.step_key
      AND e.after_status='awaiting_transcript_review' AND e.after_stage='transcript_review'
      AND e.before_wait IS NULL AND e.after_wait=c.wait_generation+1
      AND NEW.after_input_version=NEW.before_input_version+1 AND l.result_version=NEW.after_input_version
      AND NEW.after_content_count=NEW.before_content_count
  ) THEN RAISE(ABORT, 'lifecycle_correction_outcome') END;
END;
--> statement-breakpoint
-- Bind the new wait to this success, its exact attempt, and unchanged authority.
CREATE TRIGGER lifecycle_correction_wait BEFORE INSERT ON generation_wait_contexts
WHEN EXISTS (SELECT 1 FROM generation_transition_evidence e WHERE e.job_id=NEW.job_id
  AND e.event_no=NEW.enter_event_no AND e.reason='step_succeeded' AND e.command_ordinal IS NOT NULL)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_control_commands c
    JOIN generation_step_outcomes o ON o.job_id=c.job_id AND o.step_key=c.step_key AND o.attempt=c.outcome_attempt
    JOIN generation_transition_evidence e ON e.job_id=o.job_id AND e.event_no=o.event_no
    JOIN ai_usage_settlements settlement ON settlement.call_id=o.call_id
      AND settlement.usage_event_id=o.usage_event_id AND settlement.job_id=o.job_id
      AND settlement.step_key=o.step_key AND settlement.attempt=o.attempt
    JOIN generation_contexts old ON old.id=c.context_id
    JOIN generation_contexts next ON next.id=NEW.context_id
    WHERE c.job_id=NEW.job_id AND c.ordinal=NEW.command_ordinal AND c.state='succeeded'
      AND c.wait_generation=NEW.parent_wait_generation AND NEW.wait_generation=c.wait_generation+1
      AND NEW.kind='transcript_review' AND c.step_key=NEW.parent_step_key AND o.attempt=NEW.parent_attempt
      AND o.outcome='success' AND o.context_id=old.id AND o.event_no=NEW.enter_event_no
      AND o.state_version=NEW.enter_state_version AND e.command_ordinal=c.ordinal
      AND next.input_state=old.input_state AND next.input_version=o.after_input_version
      AND next.source_id IS old.source_id AND next.document_id IS old.document_id
      AND next.document_sha256 IS old.document_sha256 AND next.confirmation_id IS old.confirmation_id
      AND next.content_count=o.after_content_count AND next.last_content_event_id IS old.last_content_event_id
      AND next.analysis_event_id IS old.analysis_event_id AND next.critique_event_id IS old.critique_event_id
      AND next.intent_confirmation_event_id IS old.intent_confirmation_event_id
      AND next.summary_event_id IS old.summary_event_id AND next.summary_review_event_id IS old.summary_review_event_id
      AND next.child_event_id IS old.child_event_id AND next.child_review_event_id IS old.child_review_event_id
      AND next.adult_event_id IS old.adult_event_id AND next.adult_review_event_id IS old.adult_review_event_id
      AND next.metadata_revision=old.metadata_revision AND next.settings_revision IS old.settings_revision
      AND next.selection_revision IS old.selection_revision AND next.ticket_id IS old.ticket_id
      AND next.ticket_fingerprint IS old.ticket_fingerprint
  ) THEN RAISE(ABORT, 'lifecycle_correction_wait') END;
END;
--> statement-breakpoint
-- A command may be declined before its first step claim; no fake step/call is created.
CREATE TRIGGER lifecycle_command_rewait BEFORE UPDATE ON generation_control_commands
WHEN NEW.state='rejected' AND NEW.outcome_attempt IS NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_jobs j
    JOIN generation_transition_evidence e ON e.job_id=j.id AND e.event_no=j.event_count+1
    JOIN generation_contexts next ON next.id=e.context_id
    JOIN generation_contexts original ON original.id=OLD.context_id
    JOIN sermon_input_events latest ON latest.sermon_id=next.sermon_id AND latest.version=next.input_version
    WHERE j.id=NEW.job_id AND j.request_scope='full' AND original.state='sealed' AND next.kind='wait'
      AND next.job_id=j.id AND e.reason='wait_entered' AND e.command_ordinal=NEW.ordinal
      AND e.step_key IS NULL AND e.attempt IS NULL AND e.dispatch_id IS NULL
      AND e.after_status='awaiting_transcript_review' AND e.after_stage='transcript_review'
      AND e.after_wait=OLD.wait_generation+1 AND e.before_version=j.state_version
      AND j.wait_generation=OLD.wait_generation
      AND ((OLD.state='pending' AND j.status='awaiting_transcript_review' AND j.active_wait_generation=OLD.wait_generation)
        OR (OLD.state='running' AND j.status='running' AND j.current_step=OLD.step_key AND j.active_wait_generation IS NULL))
      AND next.input_state='present' AND next.input_version>original.input_version
      AND next.source_id=original.source_id AND latest.state='sealed'
      AND latest.source_id=next.source_id AND latest.document_id=next.document_id
      AND latest.document_sha256=next.document_sha256 AND latest.confirmation_id IS next.confirmation_id
      AND next.input_version=(SELECT h.version FROM sermon_input_heads h WHERE h.sermon_id=next.sermon_id)
      AND next.content_count=original.content_count AND next.last_content_event_id IS original.last_content_event_id
      AND next.analysis_event_id IS original.analysis_event_id AND next.critique_event_id IS original.critique_event_id
      AND next.intent_confirmation_event_id IS original.intent_confirmation_event_id
      AND next.summary_event_id IS original.summary_event_id AND next.summary_review_event_id IS original.summary_review_event_id
      AND next.child_event_id IS original.child_event_id AND next.child_review_event_id IS original.child_review_event_id
      AND next.adult_event_id IS original.adult_event_id AND next.adult_review_event_id IS original.adult_review_event_id
      AND next.metadata_revision=original.metadata_revision AND next.settings_revision IS original.settings_revision
      AND next.selection_revision IS original.selection_revision AND next.ticket_id IS original.ticket_id
      AND next.ticket_fingerprint IS original.ticket_fingerprint
  ) OR EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.job_id AND r.step_key=NEW.step_key)
    OR EXISTS (SELECT 1 FROM ai_provider_calls c WHERE c.generation_job_id=NEW.job_id AND c.step_key=NEW.step_key)
  THEN RAISE(ABORT, 'lifecycle_command_rewait') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_rewait_link BEFORE INSERT ON generation_wait_contexts
WHEN (NEW.parent_wait_generation IS NOT NULL AND NEW.parent_attempt IS NULL)
  OR EXISTS (SELECT 1 FROM generation_transition_evidence e WHERE e.job_id=NEW.job_id
    AND e.event_no=NEW.enter_event_no AND e.reason='wait_entered' AND e.command_ordinal IS NOT NULL)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_control_commands c
    JOIN generation_transition_evidence e ON e.job_id=c.job_id AND e.command_ordinal=c.ordinal
    WHERE c.job_id=NEW.job_id AND c.ordinal=NEW.command_ordinal AND c.state='rejected' AND c.outcome_attempt IS NULL
      AND c.wait_generation=NEW.parent_wait_generation AND NEW.wait_generation=c.wait_generation+1
      AND NEW.parent_step_key IS NULL AND NEW.kind='transcript_review'
      AND e.event_no=NEW.enter_event_no AND e.after_version=NEW.enter_state_version
      AND e.reason='wait_entered' AND e.context_id=NEW.context_id AND e.after_wait=NEW.wait_generation
  ) OR EXISTS (SELECT 1 FROM generation_job_dispatches d WHERE d.generation_job_id=NEW.job_id
      AND d.wait_generation=NEW.parent_wait_generation AND d.state NOT IN ('stale','acknowledged','terminal_failed'))
  THEN RAISE(ABORT, 'lifecycle_rewait_link') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_rewait_job BEFORE UPDATE ON generation_jobs
WHEN OLD.status='awaiting_transcript_review' AND NEW.status='awaiting_transcript_review'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_wait_contexts w JOIN generation_control_commands c ON c.job_id=w.job_id AND c.ordinal=w.command_ordinal
    WHERE w.job_id=NEW.id AND w.wait_generation=NEW.active_wait_generation AND w.wait_generation=OLD.wait_generation+1
      AND w.parent_wait_generation=OLD.active_wait_generation AND w.enter_event_no=NEW.event_count
      AND w.parent_attempt IS NULL AND c.state='rejected' AND c.outcome_attempt IS NULL
  ) THEN RAISE(ABORT, 'lifecycle_rewait_job') END;
END;
--> statement-breakpoint
-- Snapshot projections are current when sealed, then immutable historical data.
CREATE TRIGGER lifecycle_context_current BEFORE UPDATE ON generation_contexts
BEGIN
  SELECT CASE WHEN (NEW.input_state='present' AND NOT EXISTS (
    SELECT 1 FROM sermon_input_heads h JOIN sermon_input_events i ON i.sermon_id=h.sermon_id AND i.version=h.version
    WHERE h.sermon_id=NEW.sermon_id AND h.version=NEW.input_version AND i.state='sealed'
      AND i.source_id=NEW.source_id AND i.document_id=NEW.document_id AND i.document_sha256=NEW.document_sha256
      AND i.confirmation_id IS NEW.confirmation_id))
    OR (NEW.input_state='absent' AND (NEW.content_count<>0 OR EXISTS (SELECT 1 FROM sermon_input_heads h WHERE h.sermon_id=NEW.sermon_id)))
    OR NOT EXISTS (SELECT 1 FROM sermon_metadata_drafts m WHERE m.sermon_id=NEW.sermon_id AND m.metadata_revision=NEW.metadata_revision)
    OR (NEW.content_count=0 AND EXISTS (SELECT 1 FROM sermon_content_heads h WHERE h.sermon_id=NEW.sermon_id))
    OR (NEW.content_count>0 AND NOT EXISTS (
      SELECT 1 FROM sermon_content_current c WHERE c.sermon_id=NEW.sermon_id
        AND c.event_count=NEW.content_count AND c.last_event_id=NEW.last_content_event_id
        AND c.selected_analysis_event_id IS NEW.analysis_event_id AND c.intent_critique_event_id IS NEW.critique_event_id
        AND c.intent_confirmation_event_id IS NEW.intent_confirmation_event_id
        AND c.summary_snapshot_event_id IS NEW.summary_event_id AND c.summary_review_event_id IS NEW.summary_review_event_id
        AND c.child_pool_event_id IS NEW.child_event_id AND c.child_review_event_id IS NEW.child_review_event_id
        AND c.adult_pool_event_id IS NEW.adult_event_id AND c.adult_review_event_id IS NEW.adult_review_event_id))
  THEN RAISE(ABORT, 'lifecycle_context_current') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_step_identity BEFORE INSERT ON generation_step_contexts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_jobs j JOIN generation_contexts c ON c.id=NEW.context_id
    JOIN generation_step_receipts r ON r.generation_job_id=j.id AND r.step_key=NEW.step_key
    JOIN generation_contexts request ON request.id=j.request_context_id
    WHERE j.id=NEW.job_id AND NEW.request_context_id=j.request_context_id
      AND c.sermon_id=j.sermon_id AND c.quiz_set_id=j.quiz_set_id
      AND c.settings_revision IS request.settings_revision AND c.selection_revision IS request.selection_revision
      AND r.ticket_id IS c.ticket_id
      AND ((NEW.task IN ('correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','final_audit')
        AND r.effect_class='ai_provider' AND c.input_state='present')
        OR (NEW.task IN ('fetch_transcript','place_grid','validate') AND (r.effect_class IN ('pure','domain_write') OR (NEW.task='fetch_transcript' AND r.effect_class='source_network'))))
      AND ((j.request_scope='full' AND (NEW.task<>'correction' OR NEW.command_ordinal IS NOT NULL))
        OR (j.request_scope='transcript_correction' AND NEW.step_key='correction')
        OR (j.request_scope='intent' AND NEW.step_key IN ('intent_analysis','intent_critique'))
        OR (j.request_scope='summary' AND NEW.step_key='summary')
        OR (j.request_scope='child' AND NEW.step_key='child_candidates')
        OR (j.request_scope='adult' AND NEW.step_key='adult_candidates')
        OR (j.request_scope='final_audit' AND NEW.step_key IN ('place_child','place_adult','final_validate','final_audit')))
  ) THEN RAISE(ABORT, 'lifecycle_step_identity') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_receipt_retry BEFORE UPDATE ON generation_step_receipts
BEGIN
  SELECT CASE WHEN (NEW.state='retryable_failed' AND (OLD.state<>'claimed' OR OLD.effect_class NOT IN ('pure','domain_write')
      OR NEW.outcome_attempt IS NOT NULL OR EXISTS (SELECT 1 FROM ai_provider_calls c WHERE c.generation_job_id=NEW.generation_job_id AND c.step_key=NEW.step_key)))
    OR (NEW.state='claimed' AND (NEW.claim_token IS NULL OR NEW.lease_expires_at<=NEW.updated_at
      OR NEW.claim_token IS OLD.claim_token OR NEW.completed_at IS NOT NULL))
    OR (NEW.state='effect_started' AND EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.generation_job_id
      AND c.step_key=NEW.step_key AND c.state<>'running'))
  THEN RAISE(ABORT, 'lifecycle_receipt_retry') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_outcome_effect BEFORE INSERT ON generation_step_outcomes
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_step_contexts s JOIN generation_transition_evidence e ON e.job_id=s.job_id AND e.event_no=NEW.event_no
    WHERE s.job_id=NEW.job_id AND s.step_key=NEW.step_key AND e.command_ordinal IS s.command_ordinal
      AND ((NEW.outcome='success' AND NEW.reason='none')
        OR (NEW.outcome='rejected' AND NEW.reason='domain_invalid' AND e.after_status='failed' AND NEW.usage_event_id IS NOT NULL)
        OR (NEW.outcome='stale' AND NEW.reason='authority_changed' AND e.after_status='stale')
        OR (NEW.outcome='uncertain' AND NEW.reason='usage_unknown' AND e.after_status IN ('running','stale'))))
    OR (NEW.call_id IS NULL AND (NEW.usage_event_id IS NOT NULL OR NEW.outcome NOT IN ('stale')
      OR EXISTS (SELECT 1 FROM ai_provider_calls c WHERE c.generation_job_id=NEW.job_id AND c.step_key=NEW.step_key)))
    OR (NEW.call_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ai_provider_calls c WHERE c.id=NEW.call_id
        AND ((NEW.usage_event_id IS NOT NULL AND c.state='completed' AND c.settlement_call_id=c.id)
          OR (NEW.usage_event_id IS NULL AND c.state='uncertain'
            AND NOT EXISTS (SELECT 1 FROM ai_usage_observations o WHERE o.call_id=c.id)))))
  THEN RAISE(ABORT, 'lifecycle_outcome_effect') END;
END;
--> statement-breakpoint
-- Final event closes the outcome/call/usage/settlement cycle for every AI task.
CREATE TRIGGER lifecycle_event_settlement BEFORE INSERT ON generation_job_events
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.generation_job_id AND o.event_no=NEW.event_no
      AND o.usage_event_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ai_usage_settlements s WHERE s.call_id=o.call_id AND s.usage_event_id=o.usage_event_id
          AND s.job_id=o.job_id AND s.step_key=o.step_key AND s.attempt=o.attempt))
  THEN RAISE(ABORT, 'lifecycle_event_settlement') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_terminal_open BEFORE UPDATE ON generation_jobs
WHEN NEW.status IN ('review_ready','needs_revision','failed','stale')
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.id AND r.state IN ('claimed','effect_started','retryable_failed'))
    OR EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.id AND c.state IN ('pending','running'))
    OR EXISTS (SELECT 1 FROM generation_job_dispatches d WHERE d.generation_job_id=NEW.id AND d.state NOT IN ('acknowledged','stale','terminal_failed'))
  THEN RAISE(ABORT, 'lifecycle_terminal_open') END;
END;
--> statement-breakpoint
-- P5-44: scope progression is backed by completed outcomes, never a free stage jump.
CREATE TRIGGER lifecycle_stage_advance BEFORE UPDATE ON generation_jobs
WHEN NEW.status='running'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM generation_transition_evidence e WHERE e.job_id=NEW.id AND e.event_no=NEW.event_count
      AND e.reason='stage_completed' AND NOT (
        e.step_key IS NULL AND e.attempt IS NULL AND e.command_ordinal IS NULL AND e.dispatch_id IS NULL
        AND OLD.status='running' AND NEW.active_wait_generation IS NULL
        AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.id AND r.state IN ('claimed','effect_started','retryable_failed','uncertain'))
        AND ((NEW.request_scope='full' AND OLD.current_step='input_resolve' AND NEW.current_step='transcript_review'
          AND EXISTS (SELECT 1 FROM generation_contexts c WHERE c.id=e.context_id AND c.input_state='present'))
          OR (NEW.request_scope='intent' AND OLD.current_step='transcript_review' AND NEW.current_step='intent_analysis'
            AND EXISTS (SELECT 1 FROM generation_contexts c WHERE c.id=e.context_id AND c.confirmation_id IS NOT NULL))
          OR (OLD.current_step='intent_analysis' AND NEW.current_step='intent_critique' AND EXISTS (
            SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.id AND o.step_key='intent_analysis' AND o.outcome='success' AND o.event_no=OLD.event_count))
          OR (NEW.request_scope='full' AND OLD.current_step IN ('summary','child_candidates')
            AND NEW.current_step= CASE OLD.current_step WHEN 'summary' THEN 'child_candidates' ELSE 'adult_candidates' END
            AND EXISTS (SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.id AND o.step_key=OLD.current_step AND o.outcome='success' AND o.event_no=OLD.event_count)))))
  THEN RAISE(ABORT, 'lifecycle_stage_advance') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_success_stage BEFORE INSERT ON generation_step_outcomes
WHEN NEW.outcome='success' AND NEW.step_key NOT GLOB 'correction_[0-9]*'
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_transition_evidence e
    WHERE e.job_id=NEW.job_id AND e.event_no=NEW.event_no AND e.before_status='running'
      AND e.after_status='running' AND e.before_stage=NEW.step_key AND e.after_stage=NEW.step_key
      AND e.before_wait IS NULL AND e.after_wait IS NULL)
  THEN RAISE(ABORT, 'lifecycle_success_stage') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_effect_current BEFORE UPDATE ON generation_step_receipts
WHEN NEW.state IN ('claimed','effect_started')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_contexts c JOIN sermon_metadata_drafts m ON m.sermon_id=c.sermon_id
    WHERE c.id=NEW.context_id AND m.metadata_revision=c.metadata_revision
      AND c.input_version IS (SELECT version FROM sermon_input_heads WHERE sermon_id=c.sermon_id)
      AND c.content_count=coalesce((SELECT event_count FROM sermon_content_heads WHERE sermon_id=c.sermon_id),0))
  THEN RAISE(ABORT, 'lifecycle_effect_current') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_command_stale BEFORE UPDATE ON generation_control_commands
WHEN NEW.state='stale'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_jobs j JOIN generation_transition_evidence e ON e.job_id=j.id AND e.event_no=j.event_count+1
    WHERE j.id=NEW.job_id AND e.before_version=j.state_version AND e.after_status='stale'
      AND ((NEW.outcome_attempt IS NULL AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=j.id AND r.step_key=NEW.step_key))
        OR EXISTS (SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=j.id AND o.step_key=NEW.step_key
          AND o.attempt=NEW.outcome_attempt AND o.outcome='stale' AND o.event_no=e.event_no)))
  THEN RAISE(ABORT, 'lifecycle_command_stale') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_finish_scope BEFORE UPDATE ON generation_jobs
WHEN NEW.status IN ('review_ready','needs_revision')
BEGIN
  SELECT CASE WHEN OLD.status<>'running' OR NEW.active_wait_generation IS NOT NULL
    OR NEW.status='needs_revision' OR NEW.request_scope IN ('full','final_audit','single_entry')
    OR NOT EXISTS (
      SELECT 1 FROM generation_transition_evidence e JOIN generation_step_outcomes o ON o.job_id=e.job_id AND (o.context_id=e.context_id OR NEW.request_scope='intent')
      JOIN generation_step_receipts r ON r.generation_job_id=o.job_id AND r.step_key=o.step_key AND r.outcome_attempt=o.attempt
      JOIN ai_usage_settlements s ON s.call_id=o.call_id AND s.usage_event_id=o.usage_event_id
      WHERE e.job_id=NEW.id AND e.event_no=NEW.event_count AND e.reason='review_ready' AND e.after_stage='finish'
        AND e.step_key IS NULL AND e.attempt IS NULL AND e.command_ordinal IS NULL AND e.dispatch_id IS NULL
        AND o.outcome='success' AND r.state='succeeded'
        AND o.task= CASE NEW.request_scope WHEN 'transcript_correction' THEN 'correction' WHEN 'intent' THEN 'intent_critique'
          WHEN 'summary' THEN 'summary' WHEN 'child' THEN 'child_candidates' WHEN 'adult' THEN 'adult_candidates' END
        AND ((NEW.request_scope<>'intent' AND o.event_no=OLD.event_count AND OLD.current_step=o.step_key)
          OR (NEW.request_scope='intent' AND OLD.current_step='finish' AND EXISTS (
            SELECT 1 FROM generation_dispatch_receipts received JOIN generation_job_dispatches d ON d.id=received.dispatch_id
            JOIN generation_wait_contexts w ON w.job_id=received.job_id AND w.wait_generation=received.wait_generation
            JOIN generation_step_outcomes a ON a.job_id=w.job_id AND a.step_key='intent_analysis'
            JOIN generation_contexts capture ON capture.id=w.context_id
            JOIN generation_step_result_links al ON al.generation_job_id=a.job_id AND al.step_key=a.step_key
            JOIN generation_step_result_links cl ON cl.generation_job_id=o.job_id AND cl.step_key=o.step_key
            WHERE received.job_id=NEW.id AND received.event_no=OLD.event_count AND d.kind='resume_intent_review'
              AND w.kind='intent_review' AND w.enter_event_no>o.event_no AND a.outcome='success' AND a.event_no<o.event_no
              AND e.context_id=capture.id AND capture.intent_confirmation_event_id IS NOT NULL
              AND capture.analysis_event_id=al.content_event_id AND capture.critique_event_id=cl.content_event_id)))
    )
  THEN RAISE(ABORT, 'lifecycle_finish_scope') END;
END;
--> statement-breakpoint
-- Restrict reason/status combinations before they can become predecessor proof.
CREATE TRIGGER lifecycle_evidence_shape BEFORE INSERT ON generation_transition_evidence
BEGIN
  SELECT CASE WHEN NOT (
    (NEW.reason='job_created' AND NEW.after_status='dispatch_pending' AND NEW.after_stage='dispatch')
    OR (NEW.reason IN ('received','stage_completed') AND NEW.after_status='running' AND NEW.after_wait IS NULL)
    OR (NEW.reason='wait_entered' AND NEW.after_status IN ('awaiting_transcript_review','awaiting_intent_review') AND NEW.after_wait IS NOT NULL)
    OR (NEW.reason='step_succeeded' AND NEW.after_status IN ('running','awaiting_transcript_review'))
    OR (NEW.reason='step_rejected' AND NEW.after_status='failed' AND NEW.after_wait IS NULL)
    OR (NEW.reason IN ('step_stale','job_stale') AND NEW.after_status='stale' AND NEW.after_wait IS NULL)
    OR (NEW.reason='step_uncertain' AND NEW.after_status IN ('running','stale') AND NEW.after_wait IS NULL)
    OR (NEW.reason='review_ready' AND NEW.after_status='review_ready' AND NEW.after_stage='finish' AND NEW.after_wait IS NULL)
    OR (NEW.reason='needs_revision' AND NEW.after_status='needs_revision' AND NEW.after_wait IS NULL))
    OR (NEW.reason IN ('step_succeeded','step_rejected','step_stale','step_uncertain') AND (NEW.step_key IS NULL OR NEW.attempt IS NULL OR NEW.dispatch_id IS NOT NULL))
    OR (NEW.reason IN ('step_rejected','step_stale','step_uncertain') AND NEW.after_stage<>NEW.before_stage)
    OR (NEW.reason='received' AND (NEW.dispatch_id IS NULL OR NEW.attempt IS NULL OR NEW.step_key IS NOT NULL))
    OR (NEW.reason IN ('job_created','stage_completed','wait_entered','review_ready','needs_revision','job_stale')
      AND (NEW.step_key IS NOT NULL OR NEW.attempt IS NOT NULL OR NEW.dispatch_id IS NOT NULL))
  THEN RAISE(ABORT, 'lifecycle_evidence_shape') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_success_delta BEFORE INSERT ON generation_step_outcomes
WHEN NEW.outcome='success'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_contexts c JOIN generation_step_receipts r ON r.context_id=c.id
    JOIN sermon_metadata_drafts m ON m.sermon_id=c.sermon_id
    JOIN generation_step_result_links l ON l.generation_job_id=NEW.job_id AND l.step_key=NEW.step_key
    WHERE c.id=NEW.context_id AND r.state='effect_started' AND m.metadata_revision=c.metadata_revision
      AND ((NEW.task='correction' AND NEW.after_input_version=NEW.before_input_version+1 AND NEW.after_content_count=NEW.before_content_count)
        OR (NEW.task IN ('intent_analysis','intent_critique','summary','child_candidates','adult_candidates')
          AND NEW.after_input_version=NEW.before_input_version AND NEW.after_content_count=NEW.before_content_count+1
          AND EXISTS (SELECT 1 FROM sermon_content_events content JOIN sermon_content_heads h ON h.sermon_id=content.sermon_id
            WHERE content.sermon_id=l.content_sermon_id AND content.event_id=l.content_event_id
              AND content.content_sequence=NEW.after_content_count AND h.last_event_id=content.event_id
              AND EXISTS (SELECT 1 FROM sermon_content_current current WHERE current.sermon_id=content.sermon_id
                AND current.event_count=NEW.after_content_count AND current.last_event_id=content.event_id)))
        OR (NEW.task='final_audit' AND NEW.after_input_version=NEW.before_input_version AND NEW.after_content_count=NEW.before_content_count)))
  THEN RAISE(ABORT, 'lifecycle_success_delta') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_intent_wait BEFORE INSERT ON generation_wait_contexts
WHEN NEW.kind='intent_review'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_step_outcomes critique JOIN generation_step_outcomes analysis ON analysis.job_id=critique.job_id
    JOIN generation_jobs j ON j.id=critique.job_id
    WHERE critique.job_id=NEW.job_id AND critique.step_key='intent_critique' AND critique.outcome='success'
      AND analysis.step_key='intent_analysis' AND analysis.outcome='success' AND analysis.event_no<critique.event_no
      AND j.current_step='intent_critique' AND j.event_count=critique.event_no)
  THEN RAISE(ABORT, 'lifecycle_intent_wait') END;
END;
--> statement-breakpoint
-- Assert final FKs before resetting only the deferred rebuild counters.
INSERT INTO p544_migration_assert SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE p544_migration_assert;
--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
