CREATE TABLE `generation_intent_analysis_reuse` (
	`job_id` text PRIMARY KEY NOT NULL,
	`source_job_id` text NOT NULL,
	`sermon_id` text NOT NULL,
	`analysis_event_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`analysis_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict
);

--> statement-breakpoint
CREATE TRIGGER generation_intent_analysis_reuse_proof BEFORE INSERT ON generation_intent_analysis_reuse BEGIN
  SELECT CASE WHEN NEW.job_id=NEW.source_job_id OR NOT EXISTS (
    SELECT 1 FROM generation_jobs j JOIN generation_jobs old ON old.id=NEW.source_job_id
    JOIN generation_step_receipts analysis ON analysis.generation_job_id=old.id AND analysis.step_key='intent_analysis'
    JOIN generation_step_outcomes proof ON proof.job_id=old.id AND proof.step_key='intent_analysis' AND proof.outcome='success'
    JOIN generation_step_result_links link ON link.generation_job_id=old.id AND link.step_key='intent_analysis'
    JOIN sermon_content_events event ON event.sermon_id=NEW.sermon_id AND event.event_id=NEW.analysis_event_id
    JOIN generation_step_receipts critique ON critique.generation_job_id=old.id AND critique.step_key='intent_critique'
    WHERE j.id=NEW.job_id AND j.request_scope='intent' AND j.request_contract_version=2
      AND old.request_scope='intent' AND old.request_contract_version=2
      AND j.sermon_id=old.sermon_id AND j.quiz_set_id=old.quiz_set_id AND j.sermon_id=NEW.sermon_id
      AND j.start_input_version=analysis.input_version AND j.start_source_id=analysis.source_id
      AND j.start_document_id=analysis.document_id AND j.start_document_sha256=analysis.document_sha256
      AND j.start_confirmation_id=analysis.confirmation_id
      AND link.content_event_id=NEW.analysis_event_id AND event.kind='intent_analysis' AND event.state='sealed'
      AND event.generation_job_id=old.id AND analysis.result_id=NEW.analysis_event_id
      AND (EXISTS (SELECT 1 FROM generation_step_outcomes failed WHERE failed.job_id=old.id
        AND failed.step_key='intent_critique' AND failed.outcome IN ('uncertain','rejected'))
        OR (critique.state IN ('claimed','effect_started') AND critique.lease_expires_at<=NEW.created_at
          AND NOT EXISTS (SELECT 1 FROM generation_step_outcomes ended WHERE ended.job_id=old.id AND ended.step_key='intent_critique')))
  ) THEN RAISE(ABORT, 'generation_intent_analysis_reuse_proof') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_intent_analysis_reuse_immutable_update BEFORE UPDATE ON generation_intent_analysis_reuse BEGIN
  SELECT RAISE(ABORT, 'generation_intent_analysis_reuse_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER generation_intent_analysis_reuse_immutable_delete BEFORE DELETE ON generation_intent_analysis_reuse BEGIN
  SELECT RAISE(ABORT, 'generation_intent_analysis_reuse_immutable');
END;

--> statement-breakpoint
DROP TRIGGER lifecycle_stage_advance_legacy;
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
          OR (NEW.request_scope='intent' AND OLD.current_step='transcript_review' AND NEW.current_step='intent_critique'
            AND EXISTS (SELECT 1 FROM generation_intent_analysis_reuse reuse JOIN generation_contexts c ON c.id=e.context_id
              WHERE reuse.job_id=NEW.id AND c.confirmation_id IS NOT NULL))
          OR (OLD.current_step='intent_analysis' AND NEW.current_step='intent_critique' AND EXISTS (
            SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.id AND o.step_key='intent_analysis' AND o.outcome='success' AND o.event_no=OLD.event_count))
          OR (NEW.request_scope='full' AND OLD.current_step IN ('summary','child_candidates')
            AND NEW.current_step= CASE OLD.current_step WHEN 'summary' THEN 'child_candidates' ELSE 'adult_candidates' END
            AND EXISTS (SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.id AND o.step_key=OLD.current_step AND o.outcome='success' AND o.event_no=OLD.event_count)))))
  THEN RAISE(ABORT, 'lifecycle_stage_advance') END;
END;

--> statement-breakpoint
DROP TRIGGER lifecycle_intent_wait;
--> statement-breakpoint
CREATE TRIGGER lifecycle_intent_wait BEFORE INSERT ON generation_wait_contexts
WHEN NEW.kind='intent_review'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_step_outcomes critique LEFT JOIN generation_intent_analysis_reuse reuse ON reuse.job_id=critique.job_id
    JOIN generation_step_outcomes analysis ON analysis.job_id=coalesce(reuse.source_job_id,critique.job_id)
    JOIN generation_jobs j ON j.id=critique.job_id
    WHERE critique.job_id=NEW.job_id AND critique.step_key='intent_critique' AND critique.outcome='success'
      AND analysis.step_key='intent_analysis' AND analysis.outcome='success'
      AND (reuse.job_id IS NOT NULL OR analysis.event_no<critique.event_no)
      AND j.current_step='intent_critique' AND j.event_count=critique.event_no)
  THEN RAISE(ABORT, 'lifecycle_intent_wait') END;
END;

--> statement-breakpoint
DROP TRIGGER lifecycle_finish_scope_legacy;
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
            LEFT JOIN generation_intent_analysis_reuse reuse ON reuse.job_id=w.job_id
            JOIN generation_step_outcomes a ON a.job_id=coalesce(reuse.source_job_id,w.job_id) AND a.step_key='intent_analysis'
            JOIN generation_contexts capture ON capture.id=w.context_id
            JOIN generation_step_result_links al ON al.generation_job_id=a.job_id AND al.step_key=a.step_key
            JOIN generation_step_result_links cl ON cl.generation_job_id=o.job_id AND cl.step_key=o.step_key
            WHERE received.job_id=NEW.id AND received.event_no=OLD.event_count AND d.kind='resume_intent_review'
              AND w.kind='intent_review' AND w.enter_event_no>o.event_no AND a.outcome='success'
              AND (reuse.job_id IS NOT NULL OR a.event_no<o.event_no)
              AND (reuse.job_id IS NULL OR reuse.analysis_event_id=al.content_event_id)
              AND e.context_id=capture.id AND ((capture.intent_confirmation_event_id IS NOT NULL
                AND capture.analysis_event_id=al.content_event_id AND capture.critique_event_id=cl.content_event_id)
              OR EXISTS (
                SELECT 1 FROM sermon_content_current current_content
                JOIN sermon_content_domain_lineage selected_lineage ON selected_lineage.sermon_id=current_content.sermon_id
                  AND selected_lineage.event_id=current_content.selected_analysis_event_id
                WHERE current_content.sermon_id=NEW.sermon_id AND current_content.intent_confirmation_event_id IS NOT NULL
                  AND selected_lineage.root_analysis_event_id=al.content_event_id
                  AND selected_lineage.critique_event_id=cl.content_event_id)))))
    )
  THEN RAISE(ABORT, 'lifecycle_finish_scope') END;
END;
