CREATE TABLE `final_check_ticket_inputs` (
	`ticket_id` text PRIMARY KEY NOT NULL,
	`sermon_id` text NOT NULL,
	`intent_confirmation_event_id` text NOT NULL,
	`summary_snapshot_event_id` text NOT NULL,
	`summary_review_event_id` text NOT NULL,
	`child_pool_event_id` text NOT NULL,
	`child_review_event_id` text NOT NULL,
	`adult_pool_event_id` text NOT NULL,
	`adult_review_event_id` text NOT NULL,
	`child_placement_ticket_fingerprint` text NOT NULL,
	`adult_placement_ticket_fingerprint` text NOT NULL,
	`child_selection_index` integer NOT NULL,
	`adult_selection_index` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `final_check_tickets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`intent_confirmation_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`summary_snapshot_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`summary_review_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`child_pool_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`child_review_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`adult_pool_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`adult_review_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "final_check_ticket_inputs_fingerprint_check" CHECK(length(child_placement_ticket_fingerprint) = 64 and child_placement_ticket_fingerprint not glob '*[^0-9a-f]*' and length(adult_placement_ticket_fingerprint) = 64 and adult_placement_ticket_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "final_check_ticket_inputs_selection_check" CHECK(typeof(child_selection_index) = 'integer' and child_selection_index between 0 and 2 and typeof(adult_selection_index) = 'integer' and adult_selection_index between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE `sermon_content_current` (
	`sermon_id` text PRIMARY KEY NOT NULL,
	`event_count` integer NOT NULL,
	`last_event_id` text NOT NULL,
	`selected_analysis_event_id` text,
	`intent_critique_event_id` text,
	`intent_confirmation_event_id` text,
	`summary_snapshot_event_id` text,
	`summary_review_event_id` text,
	`child_pool_event_id` text,
	`child_review_event_id` text,
	`adult_pool_event_id` text,
	`adult_review_event_id` text,
	`required_event_count` integer NOT NULL,
	`required_event_id` text NOT NULL,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`event_count`,`last_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`content_sequence`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`selected_analysis_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`intent_critique_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`intent_confirmation_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`summary_snapshot_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`summary_review_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`child_pool_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`child_review_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`adult_pool_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`adult_review_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sermon_content_current_counter_check" CHECK(typeof(event_count) = 'integer' and event_count between 1 and 9007199254740991 and required_event_count = event_count and required_event_id = last_event_id)
);
--> statement-breakpoint
CREATE TABLE `sermon_content_human_events` (
	`sermon_id` text NOT NULL,
	`event_id` text NOT NULL,
	`operation` text NOT NULL,
	`command_key` text NOT NULL,
	`base_snapshot_event_id` text,
	`target_snapshot_event_id` text,
	`restore_source_event_id` text,
	`critique_event_id` text,
	`intent_confirmation_event_id` text,
	`expected_current_review_event_id` text,
	`created_by_actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`sermon_id`, `event_id`),
	FOREIGN KEY (`sermon_id`,`event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`base_snapshot_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`target_snapshot_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`restore_source_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`critique_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`intent_confirmation_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`expected_current_review_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sermon_content_human_events_operation_check" CHECK(operation in ('intent_edit','intent_select','intent_confirm','summary_edit','summary_select','summary_restore','summary_review','candidate_edit','candidate_set_status','candidate_select','candidate_restore','candidate_review')),
	CONSTRAINT "sermon_content_human_events_command_check" CHECK(length(command_key) between 1 and 128),
	CONSTRAINT "sermon_content_human_events_actor_check" CHECK(length(created_by_actor_id) = 64 and created_by_actor_id not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sermon_content_human_events_command_uidx` ON `sermon_content_human_events` (`command_key`);
--> statement-breakpoint
-- Reviewed additions: Drizzle cannot express the operation-specific current
-- transition or final-ticket current-input guards below. Migration 0011 stays
-- immutable; this migration replaces only its content insert guard with the
-- same AI rules plus the reviewed human-event entry conditions.
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
CREATE TRIGGER sermon_content_human_insert_guard BEFORE INSERT ON sermon_content_human_events BEGIN
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.event_id
        AND e.origin='human' AND e.state='assembling' AND e.created_by_actor_id=NEW.created_by_actor_id
        AND e.created_at=NEW.created_at
        AND ((NEW.operation IN ('intent_edit','intent_select') AND e.kind='intent_analysis' AND e.difficulty IS NULL)
          OR (NEW.operation='intent_confirm' AND e.kind='intent_confirmation' AND e.difficulty IS NULL)
          OR (NEW.operation LIKE 'summary_%' AND e.kind='summary' AND e.difficulty IS NULL)
          OR (NEW.operation LIKE 'candidate_%' AND e.kind='candidate' AND e.difficulty IN ('child','adult'))))
    OR (NEW.operation='intent_edit' AND (NEW.base_snapshot_event_id IS NULL OR NEW.target_snapshot_event_id IS NOT NULL
      OR NEW.restore_source_event_id IS NOT NULL OR NEW.critique_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NOT NULL
      OR NEW.expected_current_review_event_id IS NOT NULL))
    OR (NEW.operation='intent_select' AND (NEW.base_snapshot_event_id IS NOT NULL OR NEW.target_snapshot_event_id IS NULL
      OR NEW.restore_source_event_id IS NOT NULL OR NEW.critique_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NOT NULL
      OR NEW.expected_current_review_event_id IS NOT NULL))
    OR (NEW.operation='intent_confirm' AND (NEW.base_snapshot_event_id IS NOT NULL OR NEW.target_snapshot_event_id IS NULL
      OR NEW.restore_source_event_id IS NOT NULL OR NEW.critique_event_id IS NULL OR NEW.intent_confirmation_event_id IS NOT NULL
      OR NEW.expected_current_review_event_id IS NOT NULL))
    OR (NEW.operation IN ('summary_edit','candidate_edit','candidate_set_status')
      AND (NEW.base_snapshot_event_id IS NULL OR NEW.target_snapshot_event_id IS NOT NULL OR NEW.restore_source_event_id IS NOT NULL
        OR NEW.critique_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NULL))
    OR (NEW.operation IN ('summary_select','summary_review','candidate_select','candidate_review')
      AND (NEW.base_snapshot_event_id IS NOT NULL OR NEW.target_snapshot_event_id IS NULL OR NEW.restore_source_event_id IS NOT NULL
        OR NEW.critique_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NULL))
    OR (NEW.operation IN ('summary_restore','candidate_restore')
      AND (NEW.base_snapshot_event_id IS NULL OR NEW.target_snapshot_event_id IS NOT NULL OR NEW.restore_source_event_id IS NULL
        OR NEW.critique_event_id IS NOT NULL OR NEW.intent_confirmation_event_id IS NULL))
    THEN RAISE(ABORT, 'human content detail rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_current_insert_guard BEFORE INSERT ON sermon_content_current BEGIN
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM sermon_content_heads h JOIN sermon_content_events e
        ON e.sermon_id=h.sermon_id AND e.content_sequence=h.event_count AND e.event_id=h.last_event_id
      WHERE h.sermon_id=NEW.sermon_id AND h.event_count=NEW.event_count AND h.last_event_id=NEW.last_event_id
        AND e.state='sealed' AND e.origin='ai')
    OR (NEW.selected_analysis_event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id
        AND e.event_id=NEW.selected_analysis_event_id AND e.kind='intent_analysis' AND e.state='sealed'))
    OR (NEW.intent_critique_event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id
        AND e.event_id=NEW.intent_critique_event_id AND e.kind='intent_critique' AND e.state='sealed'
        AND e.base_analysis_event_id=NEW.selected_analysis_event_id))
    OR (NEW.intent_confirmation_event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sermon_content_events e JOIN sermon_content_human_events h
        ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id
      WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.intent_confirmation_event_id
        AND e.kind='intent_confirmation' AND e.state='sealed' AND h.operation='intent_confirm'
        AND h.target_snapshot_event_id=NEW.selected_analysis_event_id
        AND h.critique_event_id=NEW.intent_critique_event_id))
    THEN RAISE(ABORT, 'sermon content current insert rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_current_update_guard BEFORE UPDATE ON sermon_content_current BEGIN
  SELECT CASE WHEN NEW.sermon_id IS NOT OLD.sermon_id OR NEW.event_count<>OLD.event_count+1
    OR NOT EXISTS (SELECT 1 FROM sermon_content_heads h WHERE h.sermon_id=NEW.sermon_id
      AND h.event_count=NEW.event_count AND h.last_event_id=NEW.last_event_id)
    OR NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id
      AND e.event_id=NEW.last_event_id AND e.content_sequence=NEW.event_count AND e.state='assembling')
    OR NOT EXISTS (
      SELECT 1 FROM sermon_content_events e LEFT JOIN sermon_content_human_events h
        ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id
      WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.last_event_id
        AND ((e.origin='ai' AND (
          (e.kind='intent_analysis'
            AND ((OLD.selected_analysis_event_id IS NULL AND NEW.selected_analysis_event_id=e.event_id)
              OR (OLD.selected_analysis_event_id IS NOT NULL AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id))
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id
            AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS OLD.child_review_event_id
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS OLD.adult_review_event_id)
          OR (e.kind='intent_critique' AND e.base_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id AND NEW.intent_critique_event_id=e.event_id
            AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS OLD.child_review_event_id
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS OLD.adult_review_event_id)
          OR (e.kind='summary' AND e.analysis_event_id IS OLD.selected_analysis_event_id
            AND e.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND ((OLD.summary_snapshot_event_id IS NULL AND NEW.summary_snapshot_event_id=e.event_id)
              OR (OLD.summary_snapshot_event_id IS NOT NULL AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id))
            AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS OLD.child_review_event_id
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS OLD.adult_review_event_id)
          OR (e.kind='candidate' AND e.difficulty='child' AND e.analysis_event_id IS OLD.selected_analysis_event_id
            AND e.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND ((OLD.child_pool_event_id IS NULL AND NEW.child_pool_event_id=e.event_id)
              OR (OLD.child_pool_event_id IS NOT NULL AND NEW.child_pool_event_id IS OLD.child_pool_event_id))
            AND NEW.child_review_event_id IS OLD.child_review_event_id
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS OLD.adult_review_event_id)
          OR (e.kind='candidate' AND e.difficulty='adult' AND e.analysis_event_id IS OLD.selected_analysis_event_id
            AND e.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND ((OLD.adult_pool_event_id IS NULL AND NEW.adult_pool_event_id=e.event_id)
              OR (OLD.adult_pool_event_id IS NOT NULL AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id))
            AND NEW.adult_review_event_id IS OLD.adult_review_event_id
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS OLD.child_review_event_id)))
        OR (e.origin='human' AND (
          (h.operation LIKE 'summary_%' AND h.expected_current_review_event_id IS OLD.summary_review_event_id)
          OR (h.operation LIKE 'candidate_%' AND e.difficulty='child' AND h.expected_current_review_event_id IS OLD.child_review_event_id)
          OR (h.operation LIKE 'candidate_%' AND e.difficulty='adult' AND h.expected_current_review_event_id IS OLD.adult_review_event_id)
          OR (h.operation LIKE 'intent_%' AND h.expected_current_review_event_id IS NULL))
        AND (
          (h.operation='intent_edit' AND h.base_snapshot_event_id IS OLD.selected_analysis_event_id
            AND NEW.selected_analysis_event_id=e.event_id AND NEW.intent_critique_event_id IS NULL
            AND NEW.intent_confirmation_event_id IS NULL AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id
            AND NEW.summary_review_event_id IS NULL AND NEW.child_pool_event_id IS OLD.child_pool_event_id
            AND NEW.child_review_event_id IS NULL AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id
            AND NEW.adult_review_event_id IS NULL)
          OR (h.operation='intent_select' AND NEW.selected_analysis_event_id=h.target_snapshot_event_id
            AND NEW.intent_critique_event_id IS NULL AND NEW.intent_confirmation_event_id IS NULL
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id IS NULL
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS NULL
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS NULL)
          OR (h.operation='intent_confirm' AND h.target_snapshot_event_id IS OLD.selected_analysis_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id=h.critique_event_id AND NEW.intent_confirmation_event_id=e.event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id
            AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS OLD.child_review_event_id
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS OLD.adult_review_event_id)
          OR (h.operation IN ('summary_edit','summary_restore') AND h.base_snapshot_event_id IS OLD.summary_snapshot_event_id
            AND h.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id=e.event_id AND NEW.summary_review_event_id IS NULL
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS OLD.child_review_event_id
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS OLD.adult_review_event_id)
          OR (h.operation='summary_select' AND h.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id=h.target_snapshot_event_id AND NEW.summary_review_event_id IS NULL
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS OLD.child_review_event_id
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS OLD.adult_review_event_id)
          OR (h.operation='summary_review' AND h.target_snapshot_event_id IS OLD.summary_snapshot_event_id
            AND h.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id=e.event_id
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS OLD.child_review_event_id
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS OLD.adult_review_event_id)
          OR (e.difficulty='child' AND h.operation IN ('candidate_edit','candidate_set_status','candidate_restore')
            AND h.base_snapshot_event_id IS OLD.child_pool_event_id AND h.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND NEW.child_pool_event_id=e.event_id AND NEW.child_review_event_id IS NULL
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS OLD.adult_review_event_id)
          OR (e.difficulty='adult' AND h.operation IN ('candidate_edit','candidate_set_status','candidate_restore')
            AND h.base_snapshot_event_id IS OLD.adult_pool_event_id AND h.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND NEW.adult_pool_event_id=e.event_id AND NEW.adult_review_event_id IS NULL
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS OLD.child_review_event_id)
          OR (e.difficulty='child' AND h.operation='candidate_select' AND h.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND NEW.child_pool_event_id=h.target_snapshot_event_id AND NEW.child_review_event_id IS NULL
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS OLD.adult_review_event_id)
          OR (e.difficulty='adult' AND h.operation='candidate_select' AND h.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND NEW.adult_pool_event_id=h.target_snapshot_event_id AND NEW.adult_review_event_id IS NULL
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS OLD.child_review_event_id)
          OR (e.difficulty='child' AND h.operation='candidate_review' AND h.target_snapshot_event_id IS OLD.child_pool_event_id
            AND h.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id=e.event_id
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id IS OLD.adult_review_event_id)
          OR (e.difficulty='adult' AND h.operation='candidate_review' AND h.target_snapshot_event_id IS OLD.adult_pool_event_id
            AND h.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id AND NEW.intent_confirmation_event_id IS OLD.intent_confirmation_event_id
            AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id AND NEW.summary_review_event_id IS OLD.summary_review_event_id
            AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id AND NEW.adult_review_event_id=e.event_id
            AND NEW.child_pool_event_id IS OLD.child_pool_event_id AND NEW.child_review_event_id IS OLD.child_review_event_id)))))
    THEN RAISE(ABORT, 'sermon content current transition rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_human_seal_guard BEFORE UPDATE ON sermon_content_events
WHEN OLD.origin='human' AND OLD.state='assembling' AND NEW.state='sealed' BEGIN
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM sermon_content_human_events h JOIN sermon_content_current c ON c.sermon_id=h.sermon_id
      WHERE h.sermon_id=NEW.sermon_id AND h.event_id=NEW.event_id
        AND h.created_by_actor_id=NEW.created_by_actor_id AND h.created_at=NEW.created_at
        AND c.event_count=NEW.content_sequence AND c.last_event_id=NEW.event_id)
    OR (NEW.kind='intent_confirmation' AND NOT EXISTS (
      SELECT 1 FROM sermon_content_human_events h
      JOIN sermon_content_events a ON a.sermon_id=h.sermon_id AND a.event_id=h.target_snapshot_event_id
      JOIN sermon_content_events k ON k.sermon_id=h.sermon_id AND k.event_id=h.critique_event_id
      WHERE h.sermon_id=NEW.sermon_id AND h.event_id=NEW.event_id AND h.operation='intent_confirm'
        AND a.kind='intent_analysis' AND a.state='sealed' AND k.kind='intent_critique' AND k.state='sealed'
        AND k.base_analysis_event_id=a.event_id AND NEW.analysis_event_id=a.event_id))
    OR (NEW.kind='summary' AND NOT EXISTS (
      SELECT 1 FROM sermon_content_human_events h JOIN sermon_content_events c
        ON c.sermon_id=h.sermon_id AND c.event_id=h.intent_confirmation_event_id
      WHERE h.sermon_id=NEW.sermon_id AND h.event_id=NEW.event_id AND h.operation LIKE 'summary_%'
        AND c.kind='intent_confirmation' AND c.state='sealed' AND NEW.intent_confirmation_event_id=c.event_id))
    OR (NEW.kind='candidate' AND NOT EXISTS (
      SELECT 1 FROM sermon_content_human_events h JOIN sermon_content_events c
        ON c.sermon_id=h.sermon_id AND c.event_id=h.intent_confirmation_event_id
      WHERE h.sermon_id=NEW.sermon_id AND h.event_id=NEW.event_id AND h.operation LIKE 'candidate_%'
        AND c.kind='intent_confirmation' AND c.state='sealed' AND NEW.intent_confirmation_event_id=c.event_id))
    THEN RAISE(ABORT, 'human content seal rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_human_update_guard BEFORE UPDATE ON sermon_content_human_events BEGIN SELECT RAISE(ABORT, 'immutable human content detail'); END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_human_delete_guard BEFORE DELETE ON sermon_content_human_events BEGIN SELECT RAISE(ABORT, 'immutable human content detail'); END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_current_delete_guard BEFORE DELETE ON sermon_content_current BEGIN SELECT RAISE(ABORT, 'sermon content current cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER final_check_ticket_input_insert_guard BEFORE INSERT ON final_check_ticket_inputs BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM final_check_tickets t WHERE t.id=NEW.ticket_id
      AND t.sermon_id=NEW.sermon_id AND t.state='assembling'
      AND t.summary_review_id=NEW.summary_review_event_id AND t.child_review_id=NEW.child_review_event_id
      AND t.adult_review_id=NEW.adult_review_event_id
      AND t.child_placement_ticket_id=NEW.child_placement_ticket_fingerprint
      AND t.adult_placement_ticket_id=NEW.adult_placement_ticket_fingerprint)
    OR NOT EXISTS (SELECT 1 FROM sermon_content_current c WHERE c.sermon_id=NEW.sermon_id
      AND c.intent_confirmation_event_id=NEW.intent_confirmation_event_id
      AND c.summary_snapshot_event_id=NEW.summary_snapshot_event_id AND c.summary_review_event_id=NEW.summary_review_event_id
      AND c.child_pool_event_id=NEW.child_pool_event_id AND c.child_review_event_id=NEW.child_review_event_id
      AND c.adult_pool_event_id=NEW.adult_pool_event_id AND c.adult_review_event_id=NEW.adult_review_event_id)
    OR NOT EXISTS (SELECT 1 FROM sermon_content_human_events h JOIN sermon_content_events e
        ON e.sermon_id=h.sermon_id AND e.event_id=h.event_id
      WHERE h.sermon_id=NEW.sermon_id AND h.event_id=NEW.intent_confirmation_event_id
        AND h.operation='intent_confirm' AND e.kind='intent_confirmation' AND e.state='sealed')
    OR NOT EXISTS (SELECT 1 FROM sermon_content_human_events h JOIN sermon_content_events e
        ON e.sermon_id=h.sermon_id AND e.event_id=h.event_id
      WHERE h.sermon_id=NEW.sermon_id AND h.event_id=NEW.summary_review_event_id
        AND h.operation='summary_review' AND h.target_snapshot_event_id=NEW.summary_snapshot_event_id
        AND h.intent_confirmation_event_id=NEW.intent_confirmation_event_id AND e.kind='summary' AND e.state='sealed')
    OR NOT EXISTS (SELECT 1 FROM sermon_content_human_events h JOIN sermon_content_events e
        ON e.sermon_id=h.sermon_id AND e.event_id=h.event_id
      WHERE h.sermon_id=NEW.sermon_id AND h.event_id=NEW.child_review_event_id
        AND h.operation='candidate_review' AND h.target_snapshot_event_id=NEW.child_pool_event_id
        AND h.intent_confirmation_event_id=NEW.intent_confirmation_event_id
        AND e.kind='candidate' AND e.difficulty='child' AND e.state='sealed')
    OR NOT EXISTS (SELECT 1 FROM sermon_content_human_events h JOIN sermon_content_events e
        ON e.sermon_id=h.sermon_id AND e.event_id=h.event_id
      WHERE h.sermon_id=NEW.sermon_id AND h.event_id=NEW.adult_review_event_id
        AND h.operation='candidate_review' AND h.target_snapshot_event_id=NEW.adult_pool_event_id
        AND h.intent_confirmation_event_id=NEW.intent_confirmation_event_id
        AND e.kind='candidate' AND e.difficulty='adult' AND e.state='sealed')
    THEN RAISE(ABORT, 'final check ticket input rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER final_check_ticket_current_seal_guard BEFORE UPDATE ON final_check_tickets
WHEN OLD.state='assembling' AND NEW.state='sealed' BEGIN
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM final_check_ticket_inputs i
      JOIN sermon_content_current c ON c.sermon_id=i.sermon_id
      JOIN sermon_content_heads h ON h.sermon_id=i.sermon_id
      JOIN sermon_input_heads x ON x.sermon_id=i.sermon_id
      JOIN sermon_metadata_drafts m ON m.sermon_id=i.sermon_id
      JOIN quiz_sets q ON q.id=NEW.quiz_set_id AND q.sermon_id=i.sermon_id
      WHERE i.ticket_id=NEW.id AND i.sermon_id=NEW.sermon_id
        AND x.version=NEW.input_version AND h.event_count=NEW.content_event_count
        AND c.event_count=NEW.content_event_count AND c.last_event_id=h.last_event_id
        AND m.metadata_revision=NEW.metadata_revision
        AND NEW.aggregate_version=NEW.input_version+NEW.content_event_count
        AND c.intent_confirmation_event_id=i.intent_confirmation_event_id
        AND c.summary_snapshot_event_id=i.summary_snapshot_event_id AND c.summary_review_event_id=i.summary_review_event_id
        AND c.child_pool_event_id=i.child_pool_event_id AND c.child_review_event_id=i.child_review_event_id
        AND c.adult_pool_event_id=i.adult_pool_event_id AND c.adult_review_event_id=i.adult_review_event_id
        AND NEW.summary_review_id=i.summary_review_event_id AND NEW.child_review_id=i.child_review_event_id
        AND NEW.adult_review_id=i.adult_review_event_id
        AND NEW.child_placement_ticket_id=i.child_placement_ticket_fingerprint
        AND NEW.adult_placement_ticket_id=i.adult_placement_ticket_fingerprint)
    THEN RAISE(ABORT, 'final check ticket current seal rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER final_check_ticket_input_update_guard BEFORE UPDATE ON final_check_ticket_inputs BEGIN SELECT RAISE(ABORT, 'immutable final check ticket input'); END;
--> statement-breakpoint
CREATE TRIGGER final_check_ticket_input_delete_guard BEFORE DELETE ON final_check_ticket_inputs BEGIN SELECT RAISE(ABORT, 'immutable final check ticket input'); END;
