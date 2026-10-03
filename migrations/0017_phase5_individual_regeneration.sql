DROP INDEX `generation_jobs_one_active_quiz_set_uidx`;--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_one_active_quiz_set_uidx` ON `generation_jobs` (`quiz_set_id`) WHERE "generation_jobs"."status" in ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review') and not ("generation_jobs"."request_scope"='full' and "generation_jobs"."status"='running' and "generation_jobs"."current_step"='content_review');
--> statement-breakpoint
-- Only a v3 full job paused for human content review may coexist with one v2 partial job.
CREATE TRIGGER generation_individual_overlap_insert BEFORE INSERT ON generation_jobs
WHEN NEW.status IN ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review','review_ready','needs_revision')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM generation_jobs other WHERE other.quiz_set_id=NEW.quiz_set_id AND other.id<>NEW.id
      AND other.status IN ('queued','dispatch_pending','running','awaiting_transcript_review','awaiting_intent_review')
      AND NOT (
        (NEW.request_contract_version=2 AND NEW.request_scope IN ('summary','child','adult')
          AND other.sermon_id=NEW.sermon_id AND other.request_scope='full' AND other.status='running' AND other.current_step='content_review'
          AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=other.id)
          AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=other.id AND r.state IN ('claimed','effect_started','retryable_failed','uncertain'))
          AND NOT EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.job_id=other.id AND c.state IN ('pending','running','uncertain')))
        OR (NEW.request_scope='full' AND NEW.status='running' AND NEW.current_step='content_review'
          AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.id)
          AND other.sermon_id=NEW.sermon_id AND other.request_contract_version=2 AND other.request_scope IN ('summary','child','adult'))
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
        (NEW.request_contract_version=2 AND NEW.request_scope IN ('summary','child','adult')
          AND other.sermon_id=NEW.sermon_id AND other.request_scope='full' AND other.status='running' AND other.current_step='content_review'
          AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=other.id)
          AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=other.id AND r.state IN ('claimed','effect_started','retryable_failed','uncertain'))
          AND NOT EXISTS (SELECT 1 FROM generation_control_commands c WHERE c.job_id=other.id AND c.state IN ('pending','running','uncertain')))
        OR (NEW.request_scope='full' AND NEW.status='running' AND NEW.current_step='content_review'
          AND EXISTS (SELECT 1 FROM generation_full_v3_requests v WHERE v.job_id=NEW.id)
          AND other.sermon_id=NEW.sermon_id AND other.request_contract_version=2 AND other.request_scope IN ('summary','child','adult'))
      )
  ) THEN RAISE(ABORT, 'generation_individual_overlap') END;
END;
--> statement-breakpoint
