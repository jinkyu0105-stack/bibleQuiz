CREATE TABLE `generation_archived_intent_recoveries` (
	`event_id` text PRIMARY KEY NOT NULL,
	`sermon_id` text NOT NULL,
	`quiz_set_id` text NOT NULL,
	`source_job_id` text NOT NULL,
	`context_id` text NOT NULL,
	`context_fingerprint` text NOT NULL,
	`attempt` integer NOT NULL,
	`call_id` text NOT NULL,
	`usage_id` text NOT NULL,
	`request_sha256` text NOT NULL,
	`response_sha256` text NOT NULL,
	`instructions_sha256` text NOT NULL,
	`payload_sha256` text NOT NULL,
	`actor_digest` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`call_id`) REFERENCES `ai_provider_calls`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`usage_id`) REFERENCES `ai_usage_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "generation_archived_intent_attempt" CHECK(typeof("generation_archived_intent_recoveries"."attempt")='integer' and "generation_archived_intent_recoveries"."attempt">0),
	CONSTRAINT "generation_archived_intent_hash_0" CHECK(length("generation_archived_intent_recoveries"."context_fingerprint")=64 and "generation_archived_intent_recoveries"."context_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_archived_intent_hash_1" CHECK(length("generation_archived_intent_recoveries"."request_sha256")=64 and "generation_archived_intent_recoveries"."request_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_archived_intent_hash_2" CHECK(length("generation_archived_intent_recoveries"."response_sha256")=64 and "generation_archived_intent_recoveries"."response_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_archived_intent_hash_3" CHECK(length("generation_archived_intent_recoveries"."instructions_sha256")=64 and "generation_archived_intent_recoveries"."instructions_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_archived_intent_hash_4" CHECK(length("generation_archived_intent_recoveries"."payload_sha256")=64 and "generation_archived_intent_recoveries"."payload_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_archived_intent_hash_5" CHECK(length("generation_archived_intent_recoveries"."actor_digest")=64 and "generation_archived_intent_recoveries"."actor_digest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_archived_intent_source_uidx` ON `generation_archived_intent_recoveries` (`source_job_id`);
--> statement-breakpoint
-- Receipt and content event must commit together; the circular event FK above is deferred.
CREATE TRIGGER archived_intent_recovery_insert_guard BEFORE INSERT ON generation_archived_intent_recoveries BEGIN
  -- Keep independent assertions below D1's expression-depth bound.
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_jobs j
      JOIN generation_full_v3_requests v ON v.job_id=j.id
      JOIN generation_step_outcomes o ON o.job_id=j.id AND o.step_key='intent_analysis' AND o.attempt=NEW.attempt
      JOIN generation_step_receipts r ON r.generation_job_id=j.id AND r.step_key=o.step_key
      JOIN generation_contexts c ON c.id=o.context_id
    WHERE j.id=NEW.source_job_id AND j.sermon_id=NEW.sermon_id AND j.quiz_set_id=NEW.quiz_set_id
      AND j.status='failed' AND j.current_step='intent_analysis' AND j.request_scope='full' AND j.request_contract_version=2
      AND o.outcome='rejected' AND o.reason='domain_invalid' AND o.call_id=NEW.call_id AND o.usage_event_id=NEW.usage_id
      AND o.result_step_key IS NULL AND o.event_no=j.event_count AND o.state_version=j.state_version
      AND r.state='terminal_failed' AND r.result_id IS NULL AND r.context_id=NEW.context_id
      AND r.attempt_count=NEW.attempt AND r.outcome_attempt=NEW.attempt AND r.input_fingerprint=NEW.context_fingerprint
      AND c.id=NEW.context_id AND c.state='sealed' AND c.kind='step' AND c.job_id=j.id
      AND c.fingerprint=NEW.context_fingerprint AND c.fingerprint=o.input_fingerprint AND c.confirmation_id IS NOT NULL
  ) THEN RAISE(ABORT,'archived_intent_recovery_source') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM ai_provider_calls call
      JOIN ai_usage_observations observed ON observed.call_id=call.id
      JOIN ai_usage_events u ON u.id=observed.usage_event_id AND u.provider_call_id=call.id
      JOIN ai_usage_settlements settled ON settled.call_id=call.id AND settled.usage_event_id=u.id
    WHERE call.id=NEW.call_id AND u.id=NEW.usage_id AND call.generation_job_id=NEW.source_job_id
      AND call.state='completed' AND call.settlement_call_id=call.id AND call.sermon_id=NEW.sermon_id AND call.quiz_set_id=NEW.quiz_set_id
      AND call.task='intent_analysis' AND call.step_key='intent_analysis' AND call.attempt_number=NEW.attempt
      AND call.provider='openai' AND call.model='gpt-5.6-terra' AND call.reasoning_effort='high'
      AND observed.input_fingerprint=NEW.context_fingerprint AND settled.fingerprint=observed.fingerprint
      AND NEW.created_at>=settled.settled_at AND NEW.created_at>=observed.observed_at
  ) THEN RAISE(ABORT,'archived_intent_recovery_usage') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_contexts c JOIN generation_jobs j ON j.id=c.job_id
      JOIN quiz_sets q ON q.id=j.quiz_set_id AND q.sermon_id=j.sermon_id
      JOIN sermon_input_heads ih ON ih.sermon_id=j.sermon_id
      JOIN sermon_input_events input ON input.sermon_id=ih.sermon_id AND input.version=ih.version
      JOIN sermon_metadata_drafts m ON m.sermon_id=j.sermon_id
    WHERE c.id=NEW.context_id AND q.status IN ('draft','needs_revision','review_ready') AND m.metadata_revision=c.metadata_revision
      AND input.state='sealed' AND ih.version=c.input_version AND input.source_id=c.source_id
      AND input.document_id=c.document_id AND input.document_sha256=c.document_sha256 AND input.confirmation_id=c.confirmation_id
      AND coalesce((SELECT event_count FROM sermon_content_heads WHERE sermon_id=j.sermon_id),0)=c.content_count
      AND (SELECT last_event_id FROM sermon_content_heads WHERE sermon_id=j.sermon_id) IS c.last_content_event_id
      AND j.settings_revision IS c.settings_revision AND j.selection_revision IS c.selection_revision
  ) THEN RAISE(ABORT,'archived_intent_recovery_context') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM generation_step_result_links WHERE generation_job_id=NEW.source_job_id AND step_key='intent_analysis')
    OR EXISTS(SELECT 1 FROM generation_placement_selections WHERE job_id=NEW.source_job_id)
    OR EXISTS(SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id)
    OR EXISTS(SELECT 1 FROM sermon_content_events WHERE sermon_id=NEW.sermon_id AND event_id=NEW.event_id)
    OR EXISTS(SELECT 1 FROM generation_jobs WHERE sermon_id=NEW.sermon_id
      AND status IN ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review'))
  THEN RAISE(ABORT,'archived_intent_recovery_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER archived_intent_recovery_no_update BEFORE UPDATE ON generation_archived_intent_recoveries BEGIN
  SELECT RAISE(ABORT,'immutable archived intent recovery');
END;
--> statement-breakpoint
CREATE TRIGGER archived_intent_recovery_no_delete BEFORE DELETE ON generation_archived_intent_recoveries BEGIN
  SELECT RAISE(ABORT,'immutable archived intent recovery');
END;
--> statement-breakpoint
DROP TRIGGER sermon_content_event_insert_guard;
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
    OR (NEW.origin='ai' AND (NEW.created_by_actor_id IS NOT NULL OR (NOT EXISTS (
      SELECT 1 FROM generation_archived_intent_recoveries recovery
      WHERE recovery.event_id=NEW.event_id AND recovery.sermon_id=NEW.sermon_id
        AND recovery.source_job_id=NEW.generation_job_id AND NEW.step_key='intent_analysis'
        AND NEW.kind='intent_analysis' AND NEW.difficulty IS NULL
        AND recovery.payload_sha256=NEW.payload_sha256 AND recovery.created_at=NEW.created_at
    ) AND NOT EXISTS (
      SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id
      WHERE r.generation_job_id=NEW.generation_job_id AND r.step_key=NEW.step_key
        AND r.state IN ('claimed','effect_started') AND j.sermon_id=NEW.sermon_id
        AND r.input_version=NEW.input_version AND r.source_id=NEW.source_id AND r.document_id=NEW.document_id
        AND r.document_sha256=NEW.document_sha256 AND r.confirmation_id IS NEW.confirmation_id
        AND ((NEW.kind='intent_analysis' AND r.task='intent_analysis')
          OR (NEW.kind='intent_critique' AND r.task='intent_critique')
          OR (NEW.kind='summary' AND r.task='summary')
          OR (NEW.kind='candidate' AND NEW.difficulty='child' AND r.task='child_candidates')
          OR (NEW.kind='candidate' AND NEW.difficulty='adult' AND r.task='adult_candidates'))))))
    OR (NEW.origin='human' AND (NEW.created_by_actor_id IS NULL OR NEW.generation_job_id IS NOT NULL OR NEW.step_key IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM sermon_content_current c WHERE c.sermon_id=NEW.sermon_id
        AND c.event_count=NEW.content_sequence-1)))
    OR (NEW.kind='intent_analysis' AND (NEW.base_analysis_event_id IS NOT NULL OR NEW.analysis_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NOT NULL))
    OR (NEW.kind='intent_critique' AND (NEW.base_analysis_event_id IS NULL OR NEW.analysis_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NOT NULL))
    OR (NEW.kind='intent_confirmation' AND (NEW.analysis_event_id IS NULL OR NEW.base_analysis_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NOT NULL))
    OR (NEW.kind IN ('summary','candidate') AND (NEW.analysis_event_id IS NULL OR NEW.intent_confirmation_event_id IS NULL OR NEW.base_analysis_event_id IS NOT NULL))
    THEN RAISE(ABORT, 'sermon content event rejected') END;
END;
