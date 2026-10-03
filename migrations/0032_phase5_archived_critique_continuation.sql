-- Reuse the original paid critique under the approved whole-input location policy.
-- No history, cost, original response or existing migration is rewritten.
--> statement-breakpoint
DROP TRIGGER archived_intent_recovery_insert_guard;
--> statement-breakpoint
CREATE TRIGGER archived_intent_recovery_insert_guard BEFORE INSERT ON generation_archived_intent_recoveries BEGIN
  -- Keep independent assertions below D1's expression-depth bound.
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_jobs j
      JOIN generation_full_v3_requests v ON v.job_id=j.id
      JOIN generation_step_outcomes o ON o.job_id=j.id AND o.step_key=j.current_step AND o.attempt=NEW.attempt
      JOIN generation_step_receipts r ON r.generation_job_id=j.id AND r.step_key=o.step_key
      JOIN generation_contexts c ON c.id=o.context_id
    WHERE j.id=NEW.source_job_id AND j.sermon_id=NEW.sermon_id AND j.quiz_set_id=NEW.quiz_set_id
      AND j.status='failed' AND j.current_step IN ('intent_analysis','intent_critique') AND j.request_scope='full' AND j.request_contract_version=2
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
      AND call.task IN ('intent_analysis','intent_critique') AND call.step_key=call.task
      AND call.task=(SELECT current_step FROM generation_jobs WHERE id=NEW.source_job_id) AND call.attempt_number=NEW.attempt
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
  SELECT CASE WHEN EXISTS(SELECT 1 FROM generation_step_result_links WHERE generation_job_id=NEW.source_job_id AND step_key=(SELECT current_step FROM generation_jobs WHERE id=NEW.source_job_id))
    OR EXISTS(SELECT 1 FROM generation_placement_selections WHERE job_id=NEW.source_job_id)
    OR EXISTS(SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id)
    OR EXISTS(SELECT 1 FROM sermon_content_events WHERE sermon_id=NEW.sermon_id AND event_id=NEW.event_id)
    OR EXISTS(SELECT 1 FROM generation_jobs WHERE sermon_id=NEW.sermon_id
      AND status IN ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review'))
  THEN RAISE(ABORT,'archived_intent_recovery_conflict') END;
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
        AND recovery.source_job_id=NEW.generation_job_id AND NEW.step_key=(SELECT current_step FROM generation_jobs WHERE id=recovery.source_job_id)
        AND NEW.kind=NEW.step_key AND NEW.kind IN ('intent_analysis','intent_critique') AND NEW.difficulty IS NULL
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
--> statement-breakpoint
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
      AND request.analysis_event_id=NEW.analysis_event_id AND (request.critique_event_id IS NULL OR EXISTS (
        SELECT 1 FROM generation_archived_intent_recoveries cr
        JOIN sermon_content_events ce ON ce.sermon_id=cr.sermon_id AND ce.event_id=cr.event_id
        JOIN generation_contexts cc ON cc.id=cr.context_id AND cc.state='sealed'
        WHERE cr.event_id=request.critique_event_id AND cr.sermon_id=NEW.sermon_id AND cr.quiz_set_id=j.quiz_set_id
          AND ce.kind='intent_critique' AND ce.state='sealed' AND ce.base_analysis_event_id=NEW.analysis_event_id
          AND cc.input_version=request.input_version AND cc.document_id=request.document_id
          AND cc.document_sha256=request.document_sha256 AND cc.confirmation_id=request.confirmation_id
          AND cc.metadata_revision=request.metadata_revision))
      AND request.intent_confirmation_event_id IS NULL AND request.content_count=content_head.event_count
      AND request.last_content_event_id=content_head.last_event_id
      AND current_content.selected_analysis_event_id=NEW.analysis_event_id
      AND current_content.intent_critique_event_id IS request.critique_event_id AND current_content.intent_confirmation_event_id IS NULL
      AND event.generation_job_id=old.id AND event.kind='intent_analysis' AND event.state='sealed'
  ) THEN RAISE(ABORT, 'generation_intent_analysis_reuse_proof') END;
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
  AND NOT EXISTS (
    SELECT 1 FROM generation_jobs j
    JOIN generation_full_v3_requests v ON v.job_id=j.id
    JOIN generation_intent_analysis_reuse reuse ON reuse.job_id=j.id
    JOIN generation_contexts request ON request.id=j.request_context_id AND request.state='sealed'
    JOIN generation_contexts capture ON capture.id=NEW.context_id
    JOIN generation_archived_intent_recoveries cr ON cr.event_id=request.critique_event_id
      AND cr.sermon_id=j.sermon_id AND cr.quiz_set_id=j.quiz_set_id
    JOIN sermon_content_events ce ON ce.sermon_id=cr.sermon_id AND ce.event_id=cr.event_id
    WHERE j.id=NEW.job_id AND j.request_scope='full' AND j.status='running' AND j.current_step='intent_critique'
      AND ce.kind='intent_critique' AND ce.state='sealed' AND ce.base_analysis_event_id=reuse.analysis_event_id
      AND capture.analysis_event_id=reuse.analysis_event_id AND capture.critique_event_id=ce.event_id
      AND capture.input_version=request.input_version AND capture.document_id=request.document_id
      AND capture.document_sha256=request.document_sha256 AND capture.confirmation_id=request.confirmation_id
      AND capture.content_count=request.content_count AND capture.last_content_event_id=request.last_content_event_id
      AND capture.metadata_revision=request.metadata_revision
      AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=j.id AND r.step_key='intent_critique')
  ) THEN RAISE(ABORT, 'lifecycle_intent_wait') END;
END;
