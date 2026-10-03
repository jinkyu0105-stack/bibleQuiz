CREATE TABLE `ai_final_audit_chunks` (
	`audit_result_id` text NOT NULL,
	`position` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`chunk_sha256` text NOT NULL,
	`body` blob NOT NULL,
	`verified` integer NOT NULL,
	PRIMARY KEY(`audit_result_id`, `position`),
	FOREIGN KEY (`audit_result_id`) REFERENCES `ai_final_audit_results`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_final_audit_chunks_position_check" CHECK(typeof(position) = 'integer' and position between 0 and 4095),
	CONSTRAINT "ai_final_audit_chunks_size_check" CHECK(typeof(byte_length) = 'integer' and byte_length between 1 and 65536 and length(body) = byte_length),
	CONSTRAINT "ai_final_audit_chunks_hash_check" CHECK(length(chunk_sha256) = 64 and chunk_sha256 not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_final_audit_chunks_verified_check" CHECK(verified = 1)
);
--> statement-breakpoint
CREATE TABLE `ai_final_audit_results` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_job_id` text NOT NULL,
	`step_key` text NOT NULL,
	`final_check_ticket_id` text NOT NULL,
	`result_version` integer NOT NULL,
	`result_fingerprint` text NOT NULL,
	`payload_sha256` text NOT NULL,
	`payload_byte_length` integer NOT NULL,
	`payload_chunk_count` integer NOT NULL,
	`advisory_mode` text NOT NULL,
	`publish_decision` text NOT NULL,
	`state` text NOT NULL,
	`required_state` text DEFAULT 'sealed' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`final_check_ticket_id`) REFERENCES `final_check_tickets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_job_id`,`step_key`) REFERENCES `generation_step_receipts`(`generation_job_id`,`step_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`id`,`required_state`) REFERENCES `ai_final_audit_results`(`id`,`state`) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "ai_final_audit_results_id_check" CHECK(length(id) between 1 and 128),
	CONSTRAINT "ai_final_audit_results_version_check" CHECK(result_version = 1),
	CONSTRAINT "ai_final_audit_results_fingerprint_check" CHECK(length(result_fingerprint) = 64 and result_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_final_audit_results_payload_check" CHECK(length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*' and typeof(payload_byte_length) = 'integer' and payload_byte_length between 1 and 67108864 and typeof(payload_chunk_count) = 'integer' and payload_chunk_count between 1 and 4096),
	CONSTRAINT "ai_final_audit_results_mode_check" CHECK(advisory_mode = 'advisory_only' and publish_decision = 'not_evaluated'),
	CONSTRAINT "ai_final_audit_results_state_check" CHECK(state in ('assembling','sealed') and required_state = 'sealed')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_final_audit_results_job_step_uidx` ON `ai_final_audit_results` (`generation_job_id`,`step_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_final_audit_results_seal_uidx` ON `ai_final_audit_results` (`id`,`state`);--> statement-breakpoint
CREATE TABLE `ai_provider_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_job_id` text NOT NULL,
	`step_key` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`quiz_set_id` text NOT NULL,
	`sermon_id` text NOT NULL,
	`task` text NOT NULL,
	`input_fingerprint` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`reasoning_effort` text,
	`state` text NOT NULL,
	`provider_request_id_opaque` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_job_id`,`step_key`) REFERENCES `generation_step_receipts`(`generation_job_id`,`step_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_provider_calls_id_check" CHECK(length(id) between 1 and 128),
	CONSTRAINT "ai_provider_calls_attempt_check" CHECK(typeof(attempt_number) = 'integer' and attempt_number between 1 and 9007199254740991),
	CONSTRAINT "ai_provider_calls_task_check" CHECK(task in ('correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','final_audit')),
	CONSTRAINT "ai_provider_calls_input_check" CHECK(length(input_fingerprint) = 64 and input_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_provider_calls_provider_check" CHECK(length(provider) between 1 and 64 and length(model) between 1 and 128 and (reasoning_effort is null or length(reasoning_effort) between 1 and 32)),
	CONSTRAINT "ai_provider_calls_state_check" CHECK(state in ('effect_started','completed','uncertain')),
	CONSTRAINT "ai_provider_calls_request_check" CHECK(provider_request_id_opaque is null or (length(provider_request_id_opaque) = 64 and provider_request_id_opaque not glob '*[^0-9a-f]*')),
	CONSTRAINT "ai_provider_calls_time_check" CHECK((state = 'effect_started' and completed_at is null) or (state in ('completed','uncertain') and completed_at is not null and completed_at >= started_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_provider_calls_job_step_attempt_uidx` ON `ai_provider_calls` (`generation_job_id`,`step_key`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `ai_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_call_id` text NOT NULL,
	`generation_job_id` text NOT NULL,
	`step_key` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`quiz_set_id` text NOT NULL,
	`sermon_id` text NOT NULL,
	`task` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer,
	`cached_input_tokens` integer,
	`reasoning_tokens` integer,
	`output_tokens` integer,
	`audio_input_tokens` integer,
	`audio_seconds` integer,
	`pricing_version` text NOT NULL,
	`estimated_cost_micro_usd` integer NOT NULL,
	`usage_source` text NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`provider_call_id`) REFERENCES `ai_provider_calls`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_job_id`,`step_key`) REFERENCES `generation_step_receipts`(`generation_job_id`,`step_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_usage_events_id_check" CHECK(length(id) between 1 and 128),
	CONSTRAINT "ai_usage_events_attempt_check" CHECK(typeof(attempt_number) = 'integer' and attempt_number between 1 and 9007199254740991),
	CONSTRAINT "ai_usage_events_task_check" CHECK(task in ('correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','final_audit')),
	CONSTRAINT "ai_usage_events_provider_check" CHECK(length(provider) between 1 and 64 and length(model) between 1 and 128 and length(pricing_version) between 1 and 128),
	CONSTRAINT "ai_usage_events_numbers_check" CHECK((input_tokens is null or (typeof(input_tokens) = 'integer' and input_tokens >= 0)) and (cached_input_tokens is null or (typeof(cached_input_tokens) = 'integer' and cached_input_tokens >= 0)) and (reasoning_tokens is null or (typeof(reasoning_tokens) = 'integer' and reasoning_tokens >= 0)) and (output_tokens is null or (typeof(output_tokens) = 'integer' and output_tokens >= 0)) and (audio_input_tokens is null or (typeof(audio_input_tokens) = 'integer' and audio_input_tokens >= 0)) and (audio_seconds is null or (typeof(audio_seconds) = 'integer' and audio_seconds >= 0)) and typeof(estimated_cost_micro_usd) = 'integer' and estimated_cost_micro_usd >= 0),
	CONSTRAINT "ai_usage_events_report_check" CHECK(input_tokens is not null or cached_input_tokens is not null or reasoning_tokens is not null or output_tokens is not null or audio_input_tokens is not null or audio_seconds is not null),
	CONSTRAINT "ai_usage_events_source_check" CHECK(usage_source in ('provider_reported','provider_partial'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_events_provider_call_uidx` ON `ai_usage_events` (`provider_call_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_events_job_step_attempt_uidx` ON `ai_usage_events` (`generation_job_id`,`step_key`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `final_check_ticket_chunks` (
	`ticket_id` text NOT NULL,
	`position` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`chunk_sha256` text NOT NULL,
	`body` blob NOT NULL,
	`verified` integer NOT NULL,
	PRIMARY KEY(`ticket_id`, `position`),
	FOREIGN KEY (`ticket_id`) REFERENCES `final_check_tickets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "final_check_ticket_chunks_position_check" CHECK(typeof(position) = 'integer' and position between 0 and 4095),
	CONSTRAINT "final_check_ticket_chunks_size_check" CHECK(typeof(byte_length) = 'integer' and byte_length between 1 and 65536 and length(body) = byte_length),
	CONSTRAINT "final_check_ticket_chunks_hash_check" CHECK(length(chunk_sha256) = 64 and chunk_sha256 not glob '*[^0-9a-f]*'),
	CONSTRAINT "final_check_ticket_chunks_verified_check" CHECK(verified = 1)
);
--> statement-breakpoint
CREATE TABLE `final_check_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`sermon_id` text NOT NULL,
	`quiz_set_id` text NOT NULL,
	`aggregate_version` integer NOT NULL,
	`metadata_revision` integer NOT NULL,
	`input_version` integer NOT NULL,
	`content_event_count` integer NOT NULL,
	`summary_review_id` text NOT NULL,
	`child_review_id` text NOT NULL,
	`adult_review_id` text NOT NULL,
	`child_placement_ticket_id` text NOT NULL,
	`adult_placement_ticket_id` text NOT NULL,
	`ticket_fingerprint` text NOT NULL,
	`payload_sha256` text NOT NULL,
	`payload_byte_length` integer NOT NULL,
	`payload_chunk_count` integer NOT NULL,
	`state` text NOT NULL,
	`required_state` text DEFAULT 'sealed' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`id`,`required_state`) REFERENCES `final_check_tickets`(`id`,`state`) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "final_check_tickets_id_check" CHECK(length(id) between 1 and 128),
	CONSTRAINT "final_check_tickets_version_check" CHECK(typeof(aggregate_version) = 'integer' and aggregate_version between 1 and 9007199254740991 and typeof(metadata_revision) = 'integer' and metadata_revision between 1 and 9007199254740991 and typeof(input_version) = 'integer' and input_version between 1 and 9007199254740991 and typeof(content_event_count) = 'integer' and content_event_count between 0 and 9007199254740991 and aggregate_version = input_version + content_event_count),
	CONSTRAINT "final_check_tickets_reference_check" CHECK(length(summary_review_id) between 1 and 128 and length(child_review_id) between 1 and 128 and length(adult_review_id) between 1 and 128 and length(child_placement_ticket_id) between 1 and 128 and length(adult_placement_ticket_id) between 1 and 128),
	CONSTRAINT "final_check_tickets_fingerprint_check" CHECK(length(ticket_fingerprint) = 64 and ticket_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "final_check_tickets_payload_check" CHECK(length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*' and typeof(payload_byte_length) = 'integer' and payload_byte_length between 1 and 67108864 and typeof(payload_chunk_count) = 'integer' and payload_chunk_count between 1 and 4096),
	CONSTRAINT "final_check_tickets_state_check" CHECK(state in ('assembling','sealed') and required_state = 'sealed')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `final_check_tickets_fingerprint_uidx` ON `final_check_tickets` (`ticket_fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `final_check_tickets_seal_uidx` ON `final_check_tickets` (`id`,`state`);--> statement-breakpoint
CREATE TABLE `generation_step_result_links` (
	`generation_job_id` text NOT NULL,
	`step_key` text NOT NULL,
	`task` text NOT NULL,
	`correction_sermon_id` text,
	`correction_event_id` text,
	`content_sermon_id` text,
	`content_event_id` text,
	`final_audit_result_id` text,
	`usage_event_id` text NOT NULL,
	`result_kind` text NOT NULL,
	`result_id` text NOT NULL,
	`result_version` integer NOT NULL,
	`result_fingerprint` text NOT NULL,
	PRIMARY KEY(`generation_job_id`, `step_key`),
	FOREIGN KEY (`final_audit_result_id`) REFERENCES `ai_final_audit_results`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usage_event_id`) REFERENCES `ai_usage_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_job_id`,`step_key`) REFERENCES `generation_step_receipts`(`generation_job_id`,`step_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`correction_sermon_id`,`correction_event_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`content_sermon_id`,`content_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "generation_step_result_links_task_check" CHECK(task in ('correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','final_audit')),
	CONSTRAINT "generation_step_result_links_target_check" CHECK(((correction_sermon_id is not null and correction_event_id is not null) + (content_sermon_id is not null and content_event_id is not null) + (final_audit_result_id is not null)) = 1),
	CONSTRAINT "generation_step_result_links_reference_check" CHECK(length(result_kind) between 1 and 64 and length(result_id) between 1 and 128 and typeof(result_version) = 'integer' and result_version between 1 and 9007199254740991 and length(result_fingerprint) = 64 and result_fingerprint not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `sermon_content_chunks` (
	`sermon_id` text NOT NULL,
	`event_id` text NOT NULL,
	`position` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`chunk_sha256` text NOT NULL,
	`body` blob NOT NULL,
	`verified` integer NOT NULL,
	PRIMARY KEY(`sermon_id`, `event_id`, `position`),
	FOREIGN KEY (`sermon_id`,`event_id`) REFERENCES `sermon_content_payloads`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sermon_content_chunks_position_check" CHECK(typeof(position) = 'integer' and position between 0 and 4095),
	CONSTRAINT "sermon_content_chunks_size_check" CHECK(typeof(byte_length) = 'integer' and byte_length between 1 and 65536 and length(body) = byte_length),
	CONSTRAINT "sermon_content_chunks_hash_check" CHECK(length(chunk_sha256) = 64 and chunk_sha256 not glob '*[^0-9a-f]*'),
	CONSTRAINT "sermon_content_chunks_verified_check" CHECK(verified = 1)
);
--> statement-breakpoint
CREATE TABLE `sermon_content_events` (
	`sermon_id` text NOT NULL,
	`event_id` text NOT NULL,
	`content_sequence` integer NOT NULL,
	`aggregate_version` integer NOT NULL,
	`origin` text NOT NULL,
	`kind` text NOT NULL,
	`difficulty` text,
	`generation_job_id` text,
	`step_key` text,
	`input_version` integer NOT NULL,
	`source_id` text NOT NULL,
	`document_id` text NOT NULL,
	`document_sha256` text NOT NULL,
	`confirmation_id` text,
	`base_analysis_event_id` text,
	`analysis_event_id` text,
	`intent_confirmation_event_id` text,
	`payload_sha256` text NOT NULL,
	`payload_byte_length` integer NOT NULL,
	`payload_chunk_count` integer NOT NULL,
	`state` text NOT NULL,
	`required_state` text DEFAULT 'sealed' NOT NULL,
	`created_by_actor_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`sermon_id`, `event_id`),
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`generation_job_id`,`step_key`) REFERENCES `generation_step_receipts`(`generation_job_id`,`step_key`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`source_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`document_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`confirmation_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`base_analysis_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`analysis_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`intent_confirmation_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`event_id`,`required_state`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`,`state`) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "sermon_content_events_id_check" CHECK(length(event_id) between 1 and 128),
	CONSTRAINT "sermon_content_events_counter_check" CHECK(typeof(content_sequence) = 'integer' and content_sequence between 1 and 9007199254740991 and typeof(aggregate_version) = 'integer' and aggregate_version between 2 and 9007199254740991),
	CONSTRAINT "sermon_content_events_origin_check" CHECK(origin in ('ai','human')),
	CONSTRAINT "sermon_content_events_kind_check" CHECK(kind in ('intent_analysis','intent_critique','intent_confirmation','summary','candidate')),
	CONSTRAINT "sermon_content_events_difficulty_check" CHECK((kind = 'candidate' and difficulty in ('child','adult')) or (kind <> 'candidate' and difficulty is null)),
	CONSTRAINT "sermon_content_events_generation_check" CHECK((origin = 'ai' and generation_job_id is not null and step_key is not null) or (origin = 'human' and generation_job_id is null and step_key is null)),
	CONSTRAINT "sermon_content_events_input_check" CHECK(typeof(input_version) = 'integer' and input_version between 1 and 9007199254740991 and length(document_sha256) = 64 and document_sha256 not glob '*[^0-9a-f]*'),
	CONSTRAINT "sermon_content_events_payload_check" CHECK(length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*' and typeof(payload_byte_length) = 'integer' and payload_byte_length between 1 and 67108864 and typeof(payload_chunk_count) = 'integer' and payload_chunk_count between 1 and 4096),
	CONSTRAINT "sermon_content_events_state_check" CHECK(state in ('assembling','sealed') and required_state = 'sealed'),
	CONSTRAINT "sermon_content_events_actor_check" CHECK(created_by_actor_id is null or (length(created_by_actor_id) = 64 and created_by_actor_id not glob '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sermon_content_events_sequence_uidx` ON `sermon_content_events` (`sermon_id`,`content_sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `sermon_content_events_seal_uidx` ON `sermon_content_events` (`sermon_id`,`event_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `sermon_content_events_job_step_uidx` ON `sermon_content_events` (`generation_job_id`,`step_key`);--> statement-breakpoint
CREATE TABLE `sermon_content_heads` (
	`sermon_id` text PRIMARY KEY NOT NULL,
	`event_count` integer NOT NULL,
	`last_event_id` text NOT NULL,
	`required_event_count` integer NOT NULL,
	`required_event_id` text NOT NULL,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`event_count`,`last_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`content_sequence`,`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sermon_content_heads_counter_check" CHECK(typeof(event_count) = 'integer' and event_count between 1 and 9007199254740991 and required_event_count = event_count and required_event_id = last_event_id)
);
--> statement-breakpoint
CREATE TABLE `sermon_content_payloads` (
	`sermon_id` text NOT NULL,
	`event_id` text NOT NULL,
	`codec` text NOT NULL,
	`chunk_bytes` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`payload_sha256` text NOT NULL,
	`verified` integer NOT NULL,
	PRIMARY KEY(`sermon_id`, `event_id`),
	FOREIGN KEY (`sermon_id`,`event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sermon_content_payloads_codec_check" CHECK(codec = 'content-event-json-utf8-v1' and chunk_bytes = 65536),
	CONSTRAINT "sermon_content_payloads_size_check" CHECK(typeof(chunk_count) = 'integer' and chunk_count between 1 and 4096 and typeof(byte_length) = 'integer' and byte_length between 1 and 67108864),
	CONSTRAINT "sermon_content_payloads_hash_check" CHECK(length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*'),
	CONSTRAINT "sermon_content_payloads_verified_check" CHECK(verified in (0,1))
);
--> statement-breakpoint
-- Reviewed additions: Drizzle cannot express the deferred self-seal cycles or
-- the task/current-input/payload guards below. All result tables are private.
CREATE UNIQUE INDEX sermon_content_events_head_uidx ON sermon_content_events (sermon_id,content_sequence,event_id);
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
    OR (NEW.origin='ai' AND NOT EXISTS (
      SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id
      WHERE r.generation_job_id=NEW.generation_job_id AND r.step_key=NEW.step_key
        AND r.state IN ('claimed','effect_started') AND j.sermon_id=NEW.sermon_id
        AND r.input_version=NEW.input_version AND r.source_id=NEW.source_id AND r.document_id=NEW.document_id
        AND r.document_sha256=NEW.document_sha256 AND r.confirmation_id IS NEW.confirmation_id
        AND ((NEW.kind='intent_analysis' AND r.task='intent_analysis')
          OR (NEW.kind='intent_critique' AND r.task='intent_critique')
          OR (NEW.kind='summary' AND r.task='summary')
          OR (NEW.kind='candidate' AND NEW.difficulty='child' AND r.task='child_candidates')
          OR (NEW.kind='candidate' AND NEW.difficulty='adult' AND r.task='adult_candidates'))))
    OR (NEW.origin='human' AND (NEW.kind<>'intent_confirmation' OR NEW.created_by_actor_id IS NULL))
    OR (NEW.kind='intent_analysis' AND (NEW.base_analysis_event_id IS NOT NULL OR NEW.analysis_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NOT NULL))
    OR (NEW.kind='intent_critique' AND (NEW.base_analysis_event_id IS NULL OR NEW.analysis_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NOT NULL))
    OR (NEW.kind='intent_confirmation' AND (NEW.analysis_event_id IS NULL OR NEW.base_analysis_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NOT NULL))
    OR (NEW.kind IN ('summary','candidate') AND (NEW.analysis_event_id IS NULL OR NEW.intent_confirmation_event_id IS NULL OR NEW.base_analysis_event_id IS NOT NULL))
    THEN RAISE(ABORT, 'sermon content event rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_head_insert_guard BEFORE INSERT ON sermon_content_heads BEGIN
  SELECT CASE WHEN NEW.event_count<>1 OR NOT EXISTS (
    SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.last_event_id
      AND e.content_sequence=NEW.event_count AND e.state='assembling')
    THEN RAISE(ABORT, 'sermon content head rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_head_update_guard BEFORE UPDATE ON sermon_content_heads BEGIN
  SELECT CASE WHEN NEW.sermon_id IS NOT OLD.sermon_id OR NEW.event_count<>OLD.event_count+1
    OR NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id
      AND e.event_id=NEW.last_event_id AND e.content_sequence=NEW.event_count AND e.state='assembling')
    THEN RAISE(ABORT, 'sermon content head rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_payload_insert_guard BEFORE INSERT ON sermon_content_payloads BEGIN
  SELECT CASE WHEN NEW.verified<>0 OR NOT EXISTS (
    SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.event_id
      AND e.state='assembling' AND e.payload_sha256=NEW.payload_sha256
      AND e.payload_byte_length=NEW.byte_length AND e.payload_chunk_count=NEW.chunk_count)
    THEN RAISE(ABORT, 'sermon content payload rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_chunk_insert_guard BEFORE INSERT ON sermon_content_chunks BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sermon_content_payloads p WHERE p.sermon_id=NEW.sermon_id AND p.event_id=NEW.event_id
      AND p.verified=0 AND NEW.position<p.chunk_count)
    THEN RAISE(ABORT, 'sermon content chunk rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_payload_verify_guard BEFORE UPDATE ON sermon_content_payloads BEGIN
  SELECT CASE WHEN OLD.verified<>0 OR NEW.verified<>1
    OR NEW.sermon_id IS NOT OLD.sermon_id OR NEW.event_id IS NOT OLD.event_id OR NEW.codec IS NOT OLD.codec
    OR NEW.chunk_bytes<>OLD.chunk_bytes OR NEW.chunk_count<>OLD.chunk_count OR NEW.byte_length<>OLD.byte_length
    OR NEW.payload_sha256 IS NOT OLD.payload_sha256
    OR (SELECT count(*) FROM sermon_content_chunks c WHERE c.sermon_id=NEW.sermon_id AND c.event_id=NEW.event_id)<>NEW.chunk_count
    OR (SELECT coalesce(sum(c.byte_length),0) FROM sermon_content_chunks c WHERE c.sermon_id=NEW.sermon_id AND c.event_id=NEW.event_id)<>NEW.byte_length
    THEN RAISE(ABORT, 'sermon content payload verify rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_event_seal_guard BEFORE UPDATE ON sermon_content_events BEGIN
  SELECT CASE WHEN OLD.state<>'assembling' OR NEW.state<>'sealed'
    OR NEW.sermon_id IS NOT OLD.sermon_id OR NEW.event_id IS NOT OLD.event_id
    OR NEW.content_sequence<>OLD.content_sequence OR NEW.aggregate_version<>OLD.aggregate_version
    OR NEW.origin IS NOT OLD.origin OR NEW.kind IS NOT OLD.kind OR NEW.difficulty IS NOT OLD.difficulty
    OR NEW.generation_job_id IS NOT OLD.generation_job_id OR NEW.step_key IS NOT OLD.step_key
    OR NEW.input_version<>OLD.input_version OR NEW.source_id IS NOT OLD.source_id OR NEW.document_id IS NOT OLD.document_id
    OR NEW.document_sha256 IS NOT OLD.document_sha256 OR NEW.confirmation_id IS NOT OLD.confirmation_id
    OR NEW.base_analysis_event_id IS NOT OLD.base_analysis_event_id OR NEW.analysis_event_id IS NOT OLD.analysis_event_id
    OR NEW.intent_confirmation_event_id IS NOT OLD.intent_confirmation_event_id
    OR NEW.payload_sha256 IS NOT OLD.payload_sha256 OR NEW.payload_byte_length<>OLD.payload_byte_length
    OR NEW.payload_chunk_count<>OLD.payload_chunk_count OR NEW.required_state IS NOT OLD.required_state
    OR NEW.created_by_actor_id IS NOT OLD.created_by_actor_id OR NEW.created_at IS NOT OLD.created_at
    OR NOT EXISTS (SELECT 1 FROM sermon_content_heads h WHERE h.sermon_id=NEW.sermon_id
      AND h.event_count=NEW.content_sequence AND h.last_event_id=NEW.event_id)
    OR NOT EXISTS (SELECT 1 FROM sermon_content_payloads p WHERE p.sermon_id=NEW.sermon_id AND p.event_id=NEW.event_id
      AND p.verified=1 AND p.payload_sha256=NEW.payload_sha256 AND p.byte_length=NEW.payload_byte_length
      AND p.chunk_count=NEW.payload_chunk_count)
    OR NOT EXISTS (SELECT 1 FROM sermon_input_heads h JOIN sermon_input_events d ON d.sermon_id=h.sermon_id AND d.version=h.version
      WHERE h.sermon_id=NEW.sermon_id AND h.version=NEW.input_version AND d.state='sealed'
        AND d.source_id=NEW.source_id AND d.document_id=NEW.document_id AND d.document_sha256=NEW.document_sha256
        AND d.confirmation_id IS NEW.confirmation_id)
    OR (NEW.kind='intent_critique' AND NOT EXISTS (SELECT 1 FROM sermon_content_events a WHERE a.sermon_id=NEW.sermon_id
      AND a.event_id=NEW.base_analysis_event_id AND a.kind='intent_analysis' AND a.state='sealed'))
    OR (NEW.kind='intent_confirmation' AND NOT EXISTS (SELECT 1 FROM sermon_content_events a WHERE a.sermon_id=NEW.sermon_id
      AND a.event_id=NEW.analysis_event_id AND a.kind='intent_analysis' AND a.state='sealed'))
    OR (NEW.kind IN ('summary','candidate') AND NOT EXISTS (
      SELECT 1 FROM sermon_content_events c JOIN sermon_content_events a ON a.sermon_id=c.sermon_id AND a.event_id=c.analysis_event_id
      WHERE c.sermon_id=NEW.sermon_id AND c.event_id=NEW.intent_confirmation_event_id AND c.kind='intent_confirmation'
        AND c.state='sealed' AND a.event_id=NEW.analysis_event_id AND a.kind='intent_analysis' AND a.state='sealed'))
    THEN RAISE(ABORT, 'sermon content seal rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_event_delete_guard BEFORE DELETE ON sermon_content_events BEGIN SELECT RAISE(ABORT, 'immutable sermon content'); END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_payload_delete_guard BEFORE DELETE ON sermon_content_payloads BEGIN SELECT RAISE(ABORT, 'immutable sermon content'); END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_chunk_update_guard BEFORE UPDATE ON sermon_content_chunks BEGIN SELECT RAISE(ABORT, 'immutable sermon content'); END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_chunk_delete_guard BEFORE DELETE ON sermon_content_chunks BEGIN SELECT RAISE(ABORT, 'immutable sermon content'); END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_head_delete_guard BEFORE DELETE ON sermon_content_heads BEGIN SELECT RAISE(ABORT, 'immutable sermon content'); END;
--> statement-breakpoint
CREATE TRIGGER final_check_ticket_insert_guard BEFORE INSERT ON final_check_tickets BEGIN
  SELECT CASE WHEN NEW.state<>'assembling'
    OR NOT EXISTS (SELECT 1 FROM quiz_sets q WHERE q.id=NEW.quiz_set_id AND q.sermon_id=NEW.sermon_id)
    OR NOT EXISTS (SELECT 1 FROM sermon_metadata_drafts m WHERE m.sermon_id=NEW.sermon_id AND m.metadata_revision=NEW.metadata_revision)
    OR NOT EXISTS (SELECT 1 FROM sermon_input_heads i WHERE i.sermon_id=NEW.sermon_id AND i.version=NEW.input_version)
    OR (NEW.content_event_count=0 AND EXISTS (SELECT 1 FROM sermon_content_heads h WHERE h.sermon_id=NEW.sermon_id))
    OR (NEW.content_event_count>0 AND NOT EXISTS (SELECT 1 FROM sermon_content_heads h WHERE h.sermon_id=NEW.sermon_id AND h.event_count=NEW.content_event_count))
    THEN RAISE(ABORT, 'final check ticket rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER final_check_ticket_chunk_insert_guard BEFORE INSERT ON final_check_ticket_chunks BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM final_check_tickets t WHERE t.id=NEW.ticket_id
    AND t.state='assembling' AND NEW.position<t.payload_chunk_count)
    THEN RAISE(ABORT, 'final check ticket chunk rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER final_check_ticket_seal_guard BEFORE UPDATE ON final_check_tickets BEGIN
  SELECT CASE WHEN OLD.state<>'assembling' OR NEW.state<>'sealed'
    OR NEW.id IS NOT OLD.id OR NEW.sermon_id IS NOT OLD.sermon_id OR NEW.quiz_set_id IS NOT OLD.quiz_set_id
    OR NEW.aggregate_version<>OLD.aggregate_version OR NEW.metadata_revision<>OLD.metadata_revision
    OR NEW.input_version<>OLD.input_version OR NEW.content_event_count<>OLD.content_event_count
    OR NEW.summary_review_id IS NOT OLD.summary_review_id OR NEW.child_review_id IS NOT OLD.child_review_id
    OR NEW.adult_review_id IS NOT OLD.adult_review_id OR NEW.child_placement_ticket_id IS NOT OLD.child_placement_ticket_id
    OR NEW.adult_placement_ticket_id IS NOT OLD.adult_placement_ticket_id OR NEW.ticket_fingerprint IS NOT OLD.ticket_fingerprint
    OR NEW.payload_sha256 IS NOT OLD.payload_sha256 OR NEW.payload_byte_length<>OLD.payload_byte_length
    OR NEW.payload_chunk_count<>OLD.payload_chunk_count OR NEW.required_state IS NOT OLD.required_state OR NEW.created_at IS NOT OLD.created_at
    OR (SELECT count(*) FROM final_check_ticket_chunks c WHERE c.ticket_id=NEW.id)<>NEW.payload_chunk_count
    OR (SELECT coalesce(sum(c.byte_length),0) FROM final_check_ticket_chunks c WHERE c.ticket_id=NEW.id)<>NEW.payload_byte_length
    THEN RAISE(ABORT, 'final check ticket seal rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER final_check_ticket_delete_guard BEFORE DELETE ON final_check_tickets BEGIN SELECT RAISE(ABORT, 'immutable final check ticket'); END;
--> statement-breakpoint
CREATE TRIGGER final_check_ticket_chunk_update_guard BEFORE UPDATE ON final_check_ticket_chunks BEGIN SELECT RAISE(ABORT, 'immutable final check ticket'); END;
--> statement-breakpoint
CREATE TRIGGER final_check_ticket_chunk_delete_guard BEFORE DELETE ON final_check_ticket_chunks BEGIN SELECT RAISE(ABORT, 'immutable final check ticket'); END;
--> statement-breakpoint
CREATE TRIGGER ai_final_audit_insert_guard BEFORE INSERT ON ai_final_audit_results BEGIN
  SELECT CASE WHEN NEW.state<>'assembling' OR NOT EXISTS (
    SELECT 1 FROM generation_step_receipts r JOIN final_check_tickets t ON t.id=NEW.final_check_ticket_id
    WHERE r.generation_job_id=NEW.generation_job_id AND r.step_key=NEW.step_key AND r.task='final_audit'
      AND r.state IN ('claimed','effect_started') AND r.ticket_id=t.id AND t.state='sealed')
    THEN RAISE(ABORT, 'final audit result rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_final_audit_chunk_insert_guard BEFORE INSERT ON ai_final_audit_chunks BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ai_final_audit_results a WHERE a.id=NEW.audit_result_id
    AND a.state='assembling' AND NEW.position<a.payload_chunk_count)
    THEN RAISE(ABORT, 'final audit chunk rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_final_audit_seal_guard BEFORE UPDATE ON ai_final_audit_results BEGIN
  SELECT CASE WHEN OLD.state<>'assembling' OR NEW.state<>'sealed'
    OR NEW.id IS NOT OLD.id OR NEW.generation_job_id IS NOT OLD.generation_job_id OR NEW.step_key IS NOT OLD.step_key
    OR NEW.final_check_ticket_id IS NOT OLD.final_check_ticket_id OR NEW.result_version<>OLD.result_version
    OR NEW.result_fingerprint IS NOT OLD.result_fingerprint OR NEW.payload_sha256 IS NOT OLD.payload_sha256
    OR NEW.payload_byte_length<>OLD.payload_byte_length OR NEW.payload_chunk_count<>OLD.payload_chunk_count
    OR NEW.advisory_mode IS NOT OLD.advisory_mode OR NEW.publish_decision IS NOT OLD.publish_decision
    OR NEW.required_state IS NOT OLD.required_state OR NEW.created_at IS NOT OLD.created_at
    OR (SELECT count(*) FROM ai_final_audit_chunks c WHERE c.audit_result_id=NEW.id)<>NEW.payload_chunk_count
    OR (SELECT coalesce(sum(c.byte_length),0) FROM ai_final_audit_chunks c WHERE c.audit_result_id=NEW.id)<>NEW.payload_byte_length
    THEN RAISE(ABORT, 'final audit seal rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_final_audit_delete_guard BEFORE DELETE ON ai_final_audit_results BEGIN SELECT RAISE(ABORT, 'immutable final audit'); END;
--> statement-breakpoint
CREATE TRIGGER ai_final_audit_chunk_update_guard BEFORE UPDATE ON ai_final_audit_chunks BEGIN SELECT RAISE(ABORT, 'immutable final audit'); END;
--> statement-breakpoint
CREATE TRIGGER ai_final_audit_chunk_delete_guard BEFORE DELETE ON ai_final_audit_chunks BEGIN SELECT RAISE(ABORT, 'immutable final audit'); END;
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
CREATE TRIGGER ai_provider_call_update_guard BEFORE UPDATE ON ai_provider_calls BEGIN
  SELECT CASE WHEN OLD.state<>'effect_started' OR NEW.state NOT IN ('completed','uncertain')
    OR NEW.id IS NOT OLD.id OR NEW.generation_job_id IS NOT OLD.generation_job_id OR NEW.step_key IS NOT OLD.step_key
    OR NEW.attempt_number<>OLD.attempt_number OR NEW.quiz_set_id IS NOT OLD.quiz_set_id OR NEW.sermon_id IS NOT OLD.sermon_id
    OR NEW.task IS NOT OLD.task OR NEW.input_fingerprint IS NOT OLD.input_fingerprint OR NEW.provider IS NOT OLD.provider
    OR NEW.model IS NOT OLD.model OR NEW.reasoning_effort IS NOT OLD.reasoning_effort OR NEW.started_at IS NOT OLD.started_at
    THEN RAISE(ABORT, 'provider call transition rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_provider_call_delete_guard BEFORE DELETE ON ai_provider_calls BEGIN SELECT RAISE(ABORT, 'immutable provider call'); END;
--> statement-breakpoint
CREATE TRIGGER ai_usage_event_insert_guard BEFORE INSERT ON ai_usage_events BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ai_provider_calls c WHERE c.id=NEW.provider_call_id
    AND c.state='completed' AND c.generation_job_id=NEW.generation_job_id AND c.step_key=NEW.step_key
    AND c.attempt_number=NEW.attempt_number AND c.quiz_set_id=NEW.quiz_set_id AND c.sermon_id=NEW.sermon_id
    AND c.task=NEW.task AND c.provider=NEW.provider AND c.model=NEW.model)
    THEN RAISE(ABORT, 'usage event rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER ai_usage_event_update_guard BEFORE UPDATE ON ai_usage_events BEGIN SELECT RAISE(ABORT, 'immutable usage event'); END;
--> statement-breakpoint
CREATE TRIGGER ai_usage_event_delete_guard BEFORE DELETE ON ai_usage_events BEGIN SELECT RAISE(ABORT, 'immutable usage event'); END;
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
CREATE TRIGGER generation_result_link_update_guard BEFORE UPDATE ON generation_step_result_links BEGIN SELECT RAISE(ABORT, 'immutable generation result link'); END;
--> statement-breakpoint
CREATE TRIGGER generation_result_link_delete_guard BEFORE DELETE ON generation_step_result_links BEGIN SELECT RAISE(ABORT, 'immutable generation result link'); END;
--> statement-breakpoint
CREATE TRIGGER generation_ai_receipt_success_guard BEFORE UPDATE ON generation_step_receipts
WHEN NEW.state='succeeded' AND NEW.task IN ('correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','final_audit') BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_step_result_links l
    WHERE l.generation_job_id=NEW.generation_job_id AND l.step_key=NEW.step_key AND l.task=NEW.task
      AND l.result_kind=NEW.result_kind AND l.result_id=NEW.result_id
      AND l.result_version=NEW.result_version AND l.result_fingerprint=NEW.result_fingerprint)
    THEN RAISE(ABORT, 'generation result link required') END;
END;
