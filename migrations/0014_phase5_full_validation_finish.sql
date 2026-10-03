CREATE TABLE `generation_final_validation_proofs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`context_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`ticket_fingerprint` text NOT NULL,
	`preview_fingerprint` text NOT NULL,
	`event_no` integer NOT NULL,
	`state_version` integer NOT NULL,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ticket_id`) REFERENCES `final_check_tickets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`job_id`,`event_no`,`state_version`) REFERENCES `generation_transition_evidence`(`job_id`,`event_no`,`after_version`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "generation_final_validation_proofs_ticket_hash" CHECK(length(ticket_fingerprint)=64 and ticket_fingerprint not glob '*[^0-9a-f]*'),
	CONSTRAINT "generation_final_validation_proofs_preview_hash" CHECK(length(preview_fingerprint)=64 and preview_fingerprint not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `generation_full_v3_requests` (
	`job_id` text PRIMARY KEY NOT NULL,
	`request_context_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`request_context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE restrict
);

--> statement-breakpoint
DROP TRIGGER IF EXISTS lifecycle_stage_advance;
--> statement-breakpoint
CREATE TRIGGER lifecycle_stage_advance_legacy BEFORE UPDATE ON generation_jobs
WHEN NEW.status='running' AND NOT EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.id)
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
CREATE TRIGGER lifecycle_full_v3_request_insert BEFORE INSERT ON generation_full_v3_requests BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_jobs j
    WHERE j.id=NEW.job_id AND j.request_scope='full' AND j.request_contract_version=2
      AND j.request_context_id=NEW.request_context_id AND j.status='dispatch_pending' AND j.state_version=0
      AND NOT EXISTS (SELECT 1 FROM generation_transition_evidence e WHERE e.job_id=j.id)
      AND NOT EXISTS (SELECT 1 FROM generation_job_dispatches d WHERE d.generation_job_id=j.id))
  THEN RAISE(ABORT, 'lifecycle_full_v3_request_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_full_v3_request_update BEFORE UPDATE ON generation_full_v3_requests BEGIN SELECT RAISE(ABORT, 'immutable v3 request'); END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_full_v3_request_delete BEFORE DELETE ON generation_full_v3_requests BEGIN SELECT RAISE(ABORT, 'immutable v3 request'); END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_full_v3_stage_advance BEFORE UPDATE ON generation_jobs
WHEN NEW.status='running' AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.id)
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM generation_transition_evidence e
    WHERE e.job_id=NEW.id AND e.event_no=NEW.event_count AND e.reason='stage_completed' AND NOT (
      e.step_key IS NULL AND e.attempt IS NULL AND e.command_ordinal IS NULL AND e.dispatch_id IS NULL
      AND OLD.status='running' AND NEW.active_wait_generation IS NULL
      AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.id AND r.state IN ('claimed','effect_started','retryable_failed','uncertain'))
      AND NOT EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.id AND c.state IN ('pending','running','uncertain'))
      AND ((OLD.current_step='input_resolve' AND NEW.current_step='transcript_review' AND EXISTS
        (SELECT 1 FROM generation_contexts c WHERE c.id=e.context_id AND c.input_state='present'))
        OR (OLD.current_step='intent_analysis' AND NEW.current_step='intent_critique' AND EXISTS
          (SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.id AND o.step_key='intent_analysis' AND o.outcome='success' AND o.event_no=OLD.event_count))
        OR ((OLD.current_step='summary' AND NEW.current_step='child_candidates'
          OR OLD.current_step='child_candidates' AND NEW.current_step='adult_candidates'
          OR OLD.current_step='adult_candidates' AND NEW.current_step='content_review')
          AND EXISTS (SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.id AND o.step_key=OLD.current_step AND o.outcome='success' AND o.event_no=OLD.event_count))
        OR (OLD.current_step='content_review' AND NEW.current_step='place_child'
          AND NEW.settings_revision IS NOT NULL AND NEW.selection_revision IS NOT NULL
          AND EXISTS (SELECT 1 FROM sermon_content_current h WHERE h.sermon_id=NEW.sermon_id AND h.summary_review_event_id IS NOT NULL
            AND h.child_review_event_id IS NOT NULL AND h.adult_review_event_id IS NOT NULL))
        OR ((OLD.current_step='place_child' AND NEW.current_step='place_adult'
          OR OLD.current_step='place_adult' AND NEW.current_step='final_validate')
          AND EXISTS (SELECT 1 FROM sermon_content_current h WHERE h.sermon_id=NEW.sermon_id
            AND h.summary_review_event_id IS NOT NULL AND h.child_review_event_id IS NOT NULL AND h.adult_review_event_id IS NOT NULL))
        OR (OLD.current_step='final_validate' AND NEW.current_step='finish'
          AND EXISTS (SELECT 1 FROM generation_final_validation_proofs p WHERE p.job_id=NEW.id AND p.event_no=e.event_no AND p.state_version=NEW.state_version))
      ))) THEN RAISE(ABORT, 'lifecycle_full_v3_stage_advance') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_full_v3_proof_insert BEFORE INSERT ON generation_final_validation_proofs BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM generation_full_v3_requests v
    JOIN generation_jobs j ON j.id=v.job_id
    JOIN generation_contexts c ON c.id=NEW.context_id
    JOIN generation_transition_evidence e ON e.job_id=j.id AND e.event_no=NEW.event_no
    JOIN final_check_tickets t ON t.id=NEW.ticket_id
    WHERE v.job_id=NEW.job_id AND v.request_context_id=NEW.context_id AND j.request_context_id=c.id
      AND j.status='running' AND j.current_step='final_validate' AND j.state_version+1=NEW.state_version
      AND j.event_count+1=NEW.event_no AND j.settings_revision IS NOT NULL AND j.selection_revision IS NOT NULL
      AND c.kind='request' AND c.state='sealed' AND c.fingerprint=j.request_fingerprint
      AND e.reason='stage_completed' AND e.before_stage='final_validate' AND e.after_stage='finish'
      AND e.after_version=NEW.state_version AND e.context_id=c.id
      AND t.state='sealed' AND t.sermon_id=j.sermon_id AND t.quiz_set_id=j.quiz_set_id
      AND t.ticket_fingerprint=NEW.ticket_fingerprint)
  THEN RAISE(ABORT, 'lifecycle_full_v3_proof_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_full_v3_proof_update BEFORE UPDATE ON generation_final_validation_proofs BEGIN SELECT RAISE(ABORT, 'immutable final validation proof'); END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_full_v3_proof_delete BEFORE DELETE ON generation_final_validation_proofs BEGIN SELECT RAISE(ABORT, 'immutable final validation proof'); END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_full_v3_finish BEFORE UPDATE ON generation_jobs
WHEN NEW.status IN ('review_ready','needs_revision') AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.id)
BEGIN
  SELECT CASE WHEN OLD.status<>'running' OR OLD.current_step<>'finish' OR NEW.current_step<>'finish'
    OR NEW.status<>'review_ready' OR NEW.active_wait_generation IS NOT NULL OR NEW.request_scope<>'full'
    OR NEW.settings_revision IS NOT OLD.settings_revision OR NEW.selection_revision IS NOT OLD.selection_revision
    OR NOT EXISTS (SELECT 1 FROM generation_transition_evidence e
      JOIN generation_final_validation_proofs p ON p.job_id=NEW.id
      JOIN final_check_tickets t ON t.id=p.ticket_id
      JOIN final_check_ticket_inputs ti ON ti.ticket_id=t.id
      JOIN generation_contexts c ON c.id=p.context_id
      JOIN sermon_metadata_drafts m ON m.sermon_id=NEW.sermon_id
      JOIN sermon_content_current current_content ON current_content.sermon_id=NEW.sermon_id
      WHERE e.job_id=NEW.id AND e.event_no=NEW.event_count AND e.reason='review_ready'
        AND e.before_stage='finish' AND e.after_stage='finish' AND e.context_id=p.context_id
        AND e.step_key IS NULL AND e.attempt IS NULL AND e.command_ordinal IS NULL AND e.dispatch_id IS NULL
        AND p.event_no=OLD.event_count AND p.state_version=OLD.state_version
        AND t.state='sealed' AND t.ticket_fingerprint=p.ticket_fingerprint
        AND c.state='sealed' AND c.kind='request' AND c.fingerprint=e.fingerprint
        AND m.metadata_revision=t.metadata_revision
        AND t.input_version=(SELECT version FROM sermon_input_heads WHERE sermon_id=NEW.sermon_id)
        AND t.content_event_count=(SELECT event_count FROM sermon_content_heads WHERE sermon_id=NEW.sermon_id)
        AND current_content.event_count=t.content_event_count
        AND ti.intent_confirmation_event_id=current_content.intent_confirmation_event_id
        AND ti.summary_snapshot_event_id=current_content.summary_snapshot_event_id
        AND ti.summary_review_event_id=current_content.summary_review_event_id
        AND ti.child_pool_event_id=current_content.child_pool_event_id
        AND ti.child_review_event_id=current_content.child_review_event_id
        AND ti.adult_pool_event_id=current_content.adult_pool_event_id
        AND ti.adult_review_event_id=current_content.adult_review_event_id)
    OR EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.id AND r.state IN ('claimed','effect_started','retryable_failed','uncertain'))
    OR EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.job_id=NEW.id AND c.state IN ('pending','running','uncertain'))
    OR EXISTS (SELECT 1 FROM generation_job_dispatches d WHERE d.generation_job_id=NEW.id AND d.state NOT IN ('acknowledged','stale','terminal_failed'))
    OR EXISTS (SELECT 1 FROM ai_provider_calls c WHERE c.generation_job_id=NEW.id AND (c.state<>'completed'
      OR NOT EXISTS (SELECT 1 FROM ai_usage_settlements s WHERE s.call_id=c.id)))
  THEN RAISE(ABORT, 'lifecycle_full_v3_finish') END;
END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_full_v3_no_audit_receipt BEFORE INSERT ON generation_step_receipts
WHEN EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.generation_job_id)
BEGIN SELECT CASE WHEN NEW.task='final_audit' OR NEW.step_key='final_audit' THEN RAISE(ABORT, 'lifecycle_full_v3_no_audit_receipt') END; END;
--> statement-breakpoint
CREATE TRIGGER lifecycle_full_v3_no_audit_call BEFORE INSERT ON ai_provider_calls
WHEN EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.generation_job_id)
BEGIN SELECT CASE WHEN NEW.task='final_audit' THEN RAISE(ABORT, 'lifecycle_full_v3_no_audit_call') END; END;

--> statement-breakpoint
DROP TRIGGER IF EXISTS lifecycle_finish_current;
--> statement-breakpoint
CREATE TRIGGER lifecycle_finish_current_legacy BEFORE UPDATE ON generation_jobs
WHEN NEW.status IN ('review_ready','needs_revision') AND NOT EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.id)
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
DROP TRIGGER IF EXISTS lifecycle_finish_proofs;
--> statement-breakpoint
CREATE TRIGGER lifecycle_finish_proofs_legacy BEFORE UPDATE ON generation_jobs
WHEN NOT EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.id) BEGIN
  SELECT CASE WHEN NEW.status='review_ready' AND (NEW.request_scope IN ('full','final_audit','single_entry') OR NOT EXISTS (SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.id AND o.outcome='success' AND o.task= CASE NEW.request_scope WHEN 'transcript_correction' THEN 'correction' WHEN 'intent' THEN 'intent_critique' WHEN 'summary' THEN 'summary' WHEN 'child' THEN 'child_candidates' WHEN 'adult' THEN 'adult_candidates' END )) THEN RAISE(ABORT, 'lifecycle_finish_proofs') END;
END;

--> statement-breakpoint
DROP TRIGGER IF EXISTS lifecycle_finish_scope;
--> statement-breakpoint
CREATE TRIGGER lifecycle_finish_scope_legacy BEFORE UPDATE ON generation_jobs
WHEN NEW.status IN ('review_ready','needs_revision') AND NOT EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.id)
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
