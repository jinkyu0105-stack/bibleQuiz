CREATE TABLE `generation_job_dispatches` (
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
	CONSTRAINT "generation_job_dispatches_id_check" CHECK(length(id) between 1 and 128),
	CONSTRAINT "generation_job_dispatches_number_check" CHECK(typeof(dispatch_no) = 'integer' and dispatch_no between 1 and 9007199254740991 and typeof(job_state_version) = 'integer' and job_state_version between 0 and 9007199254740991),
	CONSTRAINT "generation_job_dispatches_kind_check" CHECK((kind = 'start' and dispatch_no = 1 and wait_generation is null) or (kind in ('resume_transcript_review','resume_intent_review') and typeof(wait_generation) = 'integer' and wait_generation between 1 and 9007199254740991)),
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
CREATE UNIQUE INDEX `generation_job_dispatches_key_uidx` ON `generation_job_dispatches` (`dispatch_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_job_dispatches_job_no_uidx` ON `generation_job_dispatches` (`generation_job_id`,`dispatch_no`);--> statement-breakpoint
CREATE TABLE `generation_job_events` (
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
	CONSTRAINT "generation_job_events_code_check" CHECK(event_code in ('job_created','dispatch_acknowledged','state_changed','step_succeeded','job_stale','job_failed') and message_safe = event_code),
	CONSTRAINT "generation_job_events_metadata_check" CHECK(metadata_json_safe is null or (length(metadata_json_safe) between 2 and 2048 and json_valid(metadata_json_safe) and json_type(metadata_json_safe) = 'object')),
	CONSTRAINT "generation_job_events_elapsed_check" CHECK(elapsed_ms is null or (typeof(elapsed_ms) = 'integer' and elapsed_ms between 0 and 86400000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_job_events_required_uidx` ON `generation_job_events` (`generation_job_id`,`event_no`,`job_state_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_job_events_state_uidx` ON `generation_job_events` (`generation_job_id`,`job_state_version`);--> statement-breakpoint
CREATE TABLE `generation_jobs` (
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
	FOREIGN KEY (`id`,`required_event_no`,`required_event_state_version`) REFERENCES `generation_job_events`(`generation_job_id`,`event_no`,`job_state_version`) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`start_source_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`start_document_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`start_confirmation_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "generation_jobs_id_check" CHECK(length(id) between 1 and 128),
	CONSTRAINT "generation_jobs_scope_check" CHECK(request_scope in ('full','transcript_correction','intent','summary','child','adult','single_entry','final_audit')),
	CONSTRAINT "generation_jobs_contract_check" CHECK(request_contract_version = 1),
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
CREATE UNIQUE INDEX `generation_jobs_request_key_uidx` ON `generation_jobs` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_workflow_instance_uidx` ON `generation_jobs` (`workflow_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_required_event_uidx` ON `generation_jobs` (`id`,`required_event_no`,`required_event_state_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_one_active_quiz_set_uidx` ON `generation_jobs` (`quiz_set_id`) WHERE "generation_jobs"."status" in ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review');--> statement-breakpoint
CREATE TABLE `generation_step_receipts` (
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
	CONSTRAINT "generation_step_receipts_step_key_check" CHECK(length(step_key) between 1 and 128),
	CONSTRAINT "generation_step_receipts_task_check" CHECK(task in ('fetch_transcript','correction','intent_analysis','intent_critique','summary','child_candidates','adult_candidates','place_grid','validate','final_audit')),
	CONSTRAINT "generation_step_receipts_effect_check" CHECK(effect_class in ('pure','source_network','ai_provider','domain_write')),
	CONSTRAINT "generation_step_receipts_input_check" CHECK(input_contract_version = 1 and length(input_fingerprint) = 64 and input_fingerprint not glob '*[^0-9a-f]*'),
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
-- Reviewed additions: Drizzle cannot express the deferred job→required-event
-- cycle or the cross-row transition/immutability guards below.
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
      OR (OLD.status = 'awaiting_transcript_review' AND NEW.status IN ('running','failed','stale'))
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
    OR NOT ((OLD.state = 'claimed' AND NEW.state IN ('effect_started','succeeded','retryable_failed','uncertain','terminal_failed','stale'))
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
      OR (OLD.state = 'claimed' AND NEW.state IN ('acknowledged','retryable_failed','uncertain','terminal_failed','stale'))
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
