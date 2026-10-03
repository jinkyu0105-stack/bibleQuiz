CREATE TABLE `sermon_content_domain_lineage` (
	`sermon_id` text NOT NULL,
	`event_id` text NOT NULL,
	`family` text NOT NULL,
	`root_analysis_event_id` text,
	`critique_event_id` text,
	`target_snapshot_event_id` text,
	PRIMARY KEY(`sermon_id`, `event_id`),
	FOREIGN KEY (`sermon_id`,`event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`root_analysis_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`critique_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`target_snapshot_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sermon_content_domain_family" CHECK(family in ('intent','summary','candidate')),
	CONSTRAINT "sermon_content_domain_root" CHECK((family='intent' and root_analysis_event_id is not null) or (family<>'intent' and root_analysis_event_id is null and critique_event_id is null))
);
--> statement-breakpoint
-- New lineage is created in the same transaction as an assembling event. No old row is backfilled.
CREATE TRIGGER sermon_content_domain_lineage_insert BEFORE INSERT ON sermon_content_domain_lineage BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.event_id AND e.state='assembling'
    AND ((NEW.family='intent' AND e.kind IN ('intent_analysis','intent_critique','intent_confirmation')) OR (NEW.family='summary' AND e.kind='summary') OR (NEW.family='candidate' AND e.kind='candidate')))
    OR (NEW.root_analysis_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events r WHERE r.sermon_id=NEW.sermon_id AND r.event_id=NEW.root_analysis_event_id AND r.kind='intent_analysis' AND r.origin='ai' AND (r.state='sealed' OR r.event_id=NEW.event_id)))
    OR (NEW.critique_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events k WHERE k.sermon_id=NEW.sermon_id AND k.event_id=NEW.critique_event_id AND k.kind='intent_critique' AND k.base_analysis_event_id=NEW.root_analysis_event_id AND (k.state='sealed' OR k.event_id=NEW.event_id)))
    OR (NEW.target_snapshot_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events t WHERE t.sermon_id=NEW.sermon_id AND t.event_id=NEW.target_snapshot_event_id AND t.state='sealed'))
  THEN RAISE(ABORT,'domain lineage invalid') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_domain_lineage_no_update BEFORE UPDATE ON sermon_content_domain_lineage BEGIN SELECT RAISE(ABORT,'immutable domain lineage'); END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_domain_lineage_no_delete BEFORE DELETE ON sermon_content_domain_lineage BEGIN SELECT RAISE(ABORT,'immutable domain lineage'); END;
--> statement-breakpoint
DROP TRIGGER sermon_content_current_insert_guard;
--> statement-breakpoint
CREATE TRIGGER sermon_content_current_insert_guard BEFORE INSERT ON sermon_content_current BEGIN
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM sermon_content_heads h JOIN sermon_content_events e
        ON e.sermon_id=h.sermon_id AND e.content_sequence=h.event_count AND e.event_id=h.last_event_id
      WHERE h.sermon_id=NEW.sermon_id AND h.event_count=NEW.event_count AND h.last_event_id=NEW.last_event_id
        AND e.state='sealed' AND e.origin='ai')
    OR (NEW.selected_analysis_event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id
        AND e.event_id=NEW.selected_analysis_event_id AND (e.kind='intent_analysis' OR (e.kind='intent_critique' AND EXISTS (SELECT 1 FROM sermon_content_domain_lineage dl WHERE dl.sermon_id=e.sermon_id AND dl.event_id=e.event_id AND dl.family='intent' AND dl.critique_event_id=e.event_id))) AND e.state='sealed'))
    OR (NEW.intent_critique_event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id
        AND e.event_id=NEW.intent_critique_event_id AND e.kind='intent_critique' AND e.state='sealed'
        AND e.base_analysis_event_id=coalesce((SELECT root_analysis_event_id FROM sermon_content_domain_lineage WHERE sermon_id=NEW.sermon_id AND event_id=NEW.selected_analysis_event_id),NEW.selected_analysis_event_id)))
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
DROP TRIGGER sermon_content_event_seal_guard;
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
      AND a.event_id=NEW.analysis_event_id AND (a.kind='intent_analysis' OR (a.kind='intent_critique' AND EXISTS (SELECT 1 FROM sermon_content_domain_lineage dl WHERE dl.sermon_id=a.sermon_id AND dl.event_id=a.event_id AND dl.family='intent' AND dl.critique_event_id=a.event_id))) AND a.state='sealed'))
    OR (NEW.kind IN ('summary','candidate') AND NOT EXISTS (
      SELECT 1 FROM sermon_content_events c JOIN sermon_content_events a ON a.sermon_id=c.sermon_id AND a.event_id=c.analysis_event_id
      WHERE c.sermon_id=NEW.sermon_id AND c.event_id=NEW.intent_confirmation_event_id AND c.kind='intent_confirmation'
        AND c.state='sealed' AND a.event_id=NEW.analysis_event_id AND (a.kind='intent_analysis' OR (a.kind='intent_critique' AND EXISTS (SELECT 1 FROM sermon_content_domain_lineage dl WHERE dl.sermon_id=a.sermon_id AND dl.event_id=a.event_id AND dl.family='intent' AND dl.critique_event_id=a.event_id))) AND a.state='sealed'))
    THEN RAISE(ABORT, 'sermon content seal rejected') END;
END;
--> statement-breakpoint
DROP TRIGGER sermon_content_human_seal_guard;
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
        AND (a.kind='intent_analysis' OR (a.kind='intent_critique' AND EXISTS (SELECT 1 FROM sermon_content_domain_lineage dl WHERE dl.sermon_id=a.sermon_id AND dl.event_id=a.event_id AND dl.family='intent' AND dl.critique_event_id=a.event_id))) AND a.state='sealed' AND k.kind='intent_critique' AND k.state='sealed'
        AND k.base_analysis_event_id=coalesce((SELECT root_analysis_event_id FROM sermon_content_domain_lineage WHERE sermon_id=a.sermon_id AND event_id=a.event_id),a.event_id) AND NEW.analysis_event_id=a.event_id))
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
DROP TRIGGER lifecycle_context_seal;
--> statement-breakpoint
CREATE TRIGGER lifecycle_context_seal BEFORE UPDATE ON generation_contexts BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.sermon_id IS NOT OLD.sermon_id OR NEW.quiz_set_id IS NOT OLD.quiz_set_id OR NEW.kind IS NOT OLD.kind OR NEW.contract_version IS NOT OLD.contract_version OR NEW.validator_version IS NOT OLD.validator_version OR NEW.assembly_version IS NOT OLD.assembly_version OR NEW.codec IS NOT OLD.codec OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.byte_length IS NOT OLD.byte_length OR NEW.chunk_count IS NOT OLD.chunk_count OR NEW.reference_count IS NOT OLD.reference_count OR NEW.required_state IS NOT OLD.required_state OR NEW.created_at IS NOT OLD.created_at OR NEW.input_state IS NOT OLD.input_state OR NEW.input_version IS NOT OLD.input_version OR NEW.source_id IS NOT OLD.source_id OR NEW.document_id IS NOT OLD.document_id OR NEW.document_sha256 IS NOT OLD.document_sha256 OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.content_count IS NOT OLD.content_count OR NEW.last_content_event_id IS NOT OLD.last_content_event_id OR NEW.analysis_event_id IS NOT OLD.analysis_event_id OR NEW.critique_event_id IS NOT OLD.critique_event_id OR NEW.intent_confirmation_event_id IS NOT OLD.intent_confirmation_event_id OR NEW.summary_event_id IS NOT OLD.summary_event_id OR NEW.summary_review_event_id IS NOT OLD.summary_review_event_id OR NEW.child_event_id IS NOT OLD.child_event_id OR NEW.child_review_event_id IS NOT OLD.child_review_event_id OR NEW.adult_event_id IS NOT OLD.adult_event_id OR NEW.adult_review_event_id IS NOT OLD.adult_review_event_id OR NEW.metadata_revision IS NOT OLD.metadata_revision OR NEW.settings_revision IS NOT OLD.settings_revision OR NEW.selection_revision IS NOT OLD.selection_revision OR NEW.ticket_id IS NOT OLD.ticket_id OR NEW.ticket_fingerprint IS NOT OLD.ticket_fingerprint OR OLD.state<>'assembling' OR NEW.state<>'sealed' OR NOT EXISTS (SELECT 1 FROM generation_context_chunks c WHERE c.context_id=NEW.id GROUP BY c.context_id HAVING count(*)=NEW.chunk_count AND sum(c.byte_length)=NEW.byte_length AND min(c.position)=0 AND max(c.position)=NEW.chunk_count-1) OR EXISTS(SELECT 1 FROM generation_context_chunks c WHERE c.context_id=NEW.id AND c.position<NEW.chunk_count-1 AND c.byte_length<>16384) OR (NEW.kind='request' AND NOT EXISTS (SELECT 1 FROM generation_request_contexts r WHERE r.context_id=NEW.id AND r.job_id=NEW.job_id AND r.fingerprint=NEW.fingerprint)) OR (NEW.kind='step' AND NOT EXISTS (SELECT 1 FROM generation_step_contexts s WHERE s.context_id=NEW.id AND s.job_id=NEW.job_id) AND NOT EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.context_id=NEW.id AND c.job_id=NEW.job_id AND c.state='pending')) OR (NEW.kind='wait' AND NOT EXISTS (SELECT 1 FROM generation_wait_contexts w WHERE w.context_id=NEW.id AND w.job_id=NEW.job_id)) OR (NEW.input_state='present' AND NOT EXISTS (SELECT 1 FROM sermon_input_events s JOIN sermon_input_events d ON d.sermon_id=s.sermon_id AND d.id=NEW.document_id WHERE s.sermon_id=NEW.sermon_id AND s.id=NEW.source_id AND s.kind='source' AND s.state='sealed' AND d.state='sealed' AND d.source_id=s.id AND d.document_sha256=NEW.document_sha256 AND d.kind IN ('source','edit','restore','merge'))) OR (NEW.confirmation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_input_events c WHERE c.sermon_id=NEW.sermon_id AND c.id=NEW.confirmation_id AND c.kind='confirm' AND c.state='sealed' AND c.source_id=NEW.source_id AND c.document_id=NEW.document_id AND c.document_sha256=NEW.document_sha256)) OR (NEW.analysis_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.analysis_event_id AND e.state='sealed' AND (e.kind='intent_analysis' OR (e.kind='intent_critique' AND EXISTS (SELECT 1 FROM sermon_content_domain_lineage dl WHERE dl.sermon_id=e.sermon_id AND dl.event_id=e.event_id AND dl.family='intent' AND dl.critique_event_id=e.event_id))))) OR (NEW.critique_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.critique_event_id AND e.state='sealed' AND e.kind='intent_critique')) OR (NEW.intent_confirmation_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.intent_confirmation_event_id AND e.state='sealed' AND e.kind='intent_confirmation')) OR (NEW.summary_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.summary_event_id AND e.state='sealed' AND e.kind='summary' AND e.origin IN ('ai','human'))) OR (NEW.child_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.child_event_id AND e.state='sealed' AND e.kind='candidate' AND e.difficulty='child')) OR (NEW.adult_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.adult_event_id AND e.state='sealed' AND e.kind='candidate' AND e.difficulty='adult')) OR (NEW.summary_review_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e JOIN sermon_content_human_events h ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.summary_review_event_id AND e.state='sealed' AND h.operation='summary_review' AND h.target_snapshot_event_id=NEW.summary_event_id)) OR (NEW.child_review_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e JOIN sermon_content_human_events h ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.child_review_event_id AND e.state='sealed' AND h.operation='candidate_review' AND h.target_snapshot_event_id=NEW.child_event_id)) OR (NEW.adult_review_event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_content_events e JOIN sermon_content_human_events h ON h.sermon_id=e.sermon_id AND h.event_id=e.event_id WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.adult_review_event_id AND e.state='sealed' AND h.operation='candidate_review' AND h.target_snapshot_event_id=NEW.adult_event_id)) OR (NEW.ticket_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM final_check_tickets t WHERE t.id=NEW.ticket_id AND t.sermon_id=NEW.sermon_id AND t.quiz_set_id=NEW.quiz_set_id AND t.state='sealed' AND t.ticket_fingerprint=NEW.ticket_fingerprint)) THEN RAISE(ABORT, 'lifecycle_context_seal') END;
END;
--> statement-breakpoint
DROP TRIGGER sermon_content_current_update_guard;
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
          OR (e.kind='intent_critique'
            AND NEW.selected_analysis_event_id IS OLD.selected_analysis_event_id
            AND ((e.base_analysis_event_id IS OLD.selected_analysis_event_id AND NEW.intent_critique_event_id=e.event_id)
              OR (EXISTS (SELECT 1 FROM sermon_content_domain_lineage dl WHERE dl.sermon_id=e.sermon_id AND dl.event_id=e.event_id AND dl.root_analysis_event_id=e.base_analysis_event_id)
                AND NEW.intent_critique_event_id IS OLD.intent_critique_event_id))
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
            AND NEW.selected_analysis_event_id=e.event_id AND NEW.intent_critique_event_id IS (SELECT critique_event_id FROM sermon_content_domain_lineage WHERE sermon_id=e.sermon_id AND event_id=e.event_id)
            AND NEW.intent_confirmation_event_id IS NULL AND NEW.summary_snapshot_event_id IS OLD.summary_snapshot_event_id
            AND NEW.summary_review_event_id IS NULL AND NEW.child_pool_event_id IS OLD.child_pool_event_id
            AND NEW.child_review_event_id IS NULL AND NEW.adult_pool_event_id IS OLD.adult_pool_event_id
            AND NEW.adult_review_event_id IS NULL)
          OR (h.operation='intent_select' AND NEW.selected_analysis_event_id=h.target_snapshot_event_id
            AND NEW.intent_critique_event_id IS (CASE WHEN EXISTS(SELECT 1 FROM sermon_content_domain_lineage WHERE sermon_id=e.sermon_id AND event_id=e.event_id) THEN (SELECT critique_event_id FROM sermon_content_domain_lineage WHERE sermon_id=e.sermon_id AND event_id=h.target_snapshot_event_id) ELSE NULL END) AND NEW.intent_confirmation_event_id IS NULL
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
