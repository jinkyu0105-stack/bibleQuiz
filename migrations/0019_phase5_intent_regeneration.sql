-- Permit one intent-only v2 job beside a full v3 job paused for content review.
-- Keep all other active-job overlap guards and the existing unique index.
DROP TRIGGER generation_individual_overlap_insert;--> statement-breakpoint
DROP TRIGGER generation_individual_overlap_update;--> statement-breakpoint
CREATE TRIGGER generation_individual_overlap_insert BEFORE INSERT ON generation_jobs
WHEN NEW.status IN ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review','review_ready','needs_revision')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM generation_jobs other WHERE other.quiz_set_id=NEW.quiz_set_id AND other.id<>NEW.id
      AND other.status IN ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review')
      AND NOT (
        (NEW.request_contract_version=2 AND NEW.request_scope IN ('intent','summary','child','adult')
          AND other.sermon_id=NEW.sermon_id AND other.request_scope='full' AND other.status='running' AND other.current_step='content_review'
          AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=other.id)
          AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=other.id AND r.state IN ('claimed','effect_started','retryable_failed','uncertain'))
          AND NOT EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.job_id=other.id AND c.state IN ('pending','running','uncertain')))
        OR (NEW.request_scope='full' AND NEW.status='running' AND NEW.current_step='content_review'
          AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.id)
          AND other.sermon_id=NEW.sermon_id AND other.request_contract_version=2 AND other.request_scope IN ('intent','summary','child','adult'))
      )
  ) THEN RAISE(ABORT, 'generation_individual_overlap') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_individual_overlap_update BEFORE UPDATE ON generation_jobs
WHEN NEW.status IN ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review','review_ready','needs_revision')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM generation_jobs other WHERE other.quiz_set_id=NEW.quiz_set_id AND other.id<>NEW.id
      AND other.status IN ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review')
      AND NOT (
        (NEW.request_contract_version=2 AND NEW.request_scope IN ('intent','summary','child','adult')
          AND other.sermon_id=NEW.sermon_id AND other.request_scope='full' AND other.status='running' AND other.current_step='content_review'
          AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=other.id)
          AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=other.id AND r.state IN ('claimed','effect_started','retryable_failed','uncertain'))
          AND NOT EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.job_id=other.id AND c.state IN ('pending','running','uncertain')))
        OR (NEW.request_scope='full' AND NEW.status='running' AND NEW.current_step='content_review'
          AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.id)
          AND other.sermon_id=NEW.sermon_id AND other.request_contract_version=2 AND other.request_scope IN ('intent','summary','child','adult'))
      )
  ) THEN RAISE(ABORT, 'generation_individual_overlap') END;
END;
--> statement-breakpoint

--> statement-breakpoint
DROP TRIGGER lifecycle_finish_current_legacy;
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
      AND ((NEW.request_scope='intent' AND c.content_count<=coalesce((SELECT event_count FROM sermon_content_heads WHERE sermon_id=c.sermon_id),0)) OR (NEW.request_scope<>'intent' AND o.after_content_count=coalesce((SELECT event_count FROM sermon_content_heads WHERE sermon_id=c.sermon_id),0))))
  THEN RAISE(ABORT, 'lifecycle_finish_current') END;
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
            JOIN generation_step_outcomes a ON a.job_id=w.job_id AND a.step_key='intent_analysis'
            JOIN generation_contexts capture ON capture.id=w.context_id
            JOIN generation_step_result_links al ON al.generation_job_id=a.job_id AND al.step_key=a.step_key
            JOIN generation_step_result_links cl ON cl.generation_job_id=o.job_id AND cl.step_key=o.step_key
            WHERE received.job_id=NEW.id AND received.event_no=OLD.event_count AND d.kind='resume_intent_review'
              AND w.kind='intent_review' AND w.enter_event_no>o.event_no AND a.outcome='success' AND a.event_no<o.event_no
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
