-- Continue a full v3 request from a verified archived analysis without a new analysis call.
-- The original failed job, rejected outcome and paid usage remain unchanged.

DROP TRIGGER generation_intent_analysis_reuse_proof;
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
  ) AND NOT EXISTS (
    SELECT 1 FROM generation_jobs j
    JOIN generation_full_v3_requests v ON v.job_id=j.id
    JOIN generation_archived_intent_recoveries recovery ON recovery.event_id=NEW.analysis_event_id
      AND recovery.source_job_id=NEW.source_job_id AND recovery.sermon_id=NEW.sermon_id
    JOIN generation_jobs old ON old.id=recovery.source_job_id
    JOIN generation_contexts source ON source.id=recovery.context_id AND source.state='sealed'
    JOIN generation_contexts request ON request.id=j.request_context_id
    JOIN sermon_content_events event ON event.sermon_id=NEW.sermon_id AND event.event_id=NEW.analysis_event_id
    JOIN sermon_content_current current_content ON current_content.sermon_id=NEW.sermon_id
    JOIN sermon_content_heads content_head ON content_head.sermon_id=NEW.sermon_id
    JOIN sermon_input_heads input_head ON input_head.sermon_id=NEW.sermon_id
    JOIN sermon_metadata_drafts metadata ON metadata.sermon_id=NEW.sermon_id
    WHERE j.id=NEW.job_id AND j.request_scope='full' AND j.status='dispatch_pending' AND j.state_version=0
      AND j.sermon_id=old.sermon_id AND j.quiz_set_id=old.quiz_set_id AND recovery.quiz_set_id=j.quiz_set_id
      AND old.status='failed' AND old.current_step='intent_analysis'
      AND NOT EXISTS (SELECT 1 FROM generation_job_dispatches d WHERE d.generation_job_id=j.id)
      AND j.start_input_version=source.input_version AND j.start_input_version=input_head.version
      AND j.start_source_id=source.source_id AND j.start_document_id=source.document_id
      AND j.start_document_sha256=source.document_sha256 AND j.start_confirmation_id=source.confirmation_id
      AND j.start_metadata_revision=source.metadata_revision AND j.start_metadata_revision=metadata.metadata_revision
      AND request.analysis_event_id=NEW.analysis_event_id AND request.critique_event_id IS NULL
      AND request.intent_confirmation_event_id IS NULL AND request.content_count=content_head.event_count
      AND request.last_content_event_id=content_head.last_event_id
      AND current_content.selected_analysis_event_id=NEW.analysis_event_id
      AND current_content.intent_critique_event_id IS NULL AND current_content.intent_confirmation_event_id IS NULL
      AND event.generation_job_id=old.id AND event.kind='intent_analysis' AND event.state='sealed'
  ) THEN RAISE(ABORT, 'generation_intent_analysis_reuse_proof') END;
END;
--> statement-breakpoint

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

DROP TRIGGER lifecycle_intent_wait;
--> statement-breakpoint
CREATE TRIGGER lifecycle_intent_wait BEFORE INSERT ON generation_wait_contexts
WHEN NEW.kind='intent_review'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_step_outcomes critique
    LEFT JOIN generation_intent_analysis_reuse reuse ON reuse.job_id=critique.job_id
    LEFT JOIN generation_step_outcomes analysis ON analysis.job_id=coalesce(reuse.source_job_id,critique.job_id)
      AND analysis.step_key='intent_analysis'
    LEFT JOIN generation_archived_intent_recoveries recovery ON recovery.event_id=reuse.analysis_event_id
      AND recovery.source_job_id=reuse.source_job_id AND recovery.sermon_id=reuse.sermon_id
    JOIN generation_jobs j ON j.id=critique.job_id
    WHERE critique.job_id=NEW.job_id AND critique.step_key='intent_critique' AND critique.outcome='success'
      AND ((analysis.outcome='success' AND (reuse.job_id IS NOT NULL OR analysis.event_no<critique.event_no))
        OR (recovery.event_id IS NOT NULL AND j.request_scope='full'
          AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=j.id)
          AND EXISTS (SELECT 1 FROM generation_contexts capture
            WHERE capture.id=NEW.context_id AND capture.analysis_event_id=recovery.event_id)))
      AND j.current_step='intent_critique' AND j.event_count=critique.event_no)
  THEN RAISE(ABORT, 'lifecycle_intent_wait') END;
END;
--> statement-breakpoint
