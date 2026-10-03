-- Resume stored, current content into human review without AI receipts.
-- Final review, placement, validation and publication guards remain required.

DROP TRIGGER lifecycle_full_v3_stage_advance;
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
        OR (OLD.current_step='input_resolve' AND NEW.current_step='content_review'
          AND e.context_id=NEW.request_context_id
          AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.id)
          AND EXISTS (SELECT 1 FROM generation_contexts c
            JOIN sermon_content_current h ON h.sermon_id=NEW.sermon_id
            JOIN sermon_input_heads i ON i.sermon_id=NEW.sermon_id
            JOIN sermon_metadata_drafts m ON m.sermon_id=NEW.sermon_id
            WHERE c.id=e.context_id AND c.kind='request' AND c.state='sealed'
              AND c.input_version=i.version AND c.confirmation_id IS NOT NULL
              AND c.metadata_revision=m.metadata_revision AND c.content_count=h.event_count
              AND c.intent_confirmation_event_id IS NOT NULL
              AND c.intent_confirmation_event_id=h.intent_confirmation_event_id
              AND c.summary_event_id=h.summary_snapshot_event_id
              AND c.child_event_id=h.child_pool_event_id AND c.adult_event_id=h.adult_pool_event_id))
        OR (OLD.current_step='intent_analysis' AND NEW.current_step='intent_critique' AND EXISTS
          (SELECT 1 FROM generation_step_outcomes o WHERE o.job_id=NEW.id AND o.step_key='intent_analysis' AND o.outcome='success' AND o.event_no=OLD.event_count))
        OR (OLD.current_step='intent_analysis' AND NEW.current_step='intent_critique'
          AND e.context_id=NEW.request_context_id
          AND EXISTS (SELECT 1 FROM generation_intent_analysis_reuse reuse
            JOIN generation_archived_intent_recoveries recovery ON recovery.event_id=reuse.analysis_event_id
              AND recovery.source_job_id=reuse.source_job_id AND recovery.sermon_id=reuse.sermon_id
            WHERE reuse.job_id=NEW.id)
          AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=NEW.id AND r.step_key='intent_analysis'))
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

