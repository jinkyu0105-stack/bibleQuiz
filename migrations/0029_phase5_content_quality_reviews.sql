CREATE TABLE `sermon_content_quality_reviews` (
	`sermon_id` text NOT NULL,
	`snapshot_event_id` text NOT NULL,
	`revision` integer NOT NULL,
	`quiz_set_id` text NOT NULL,
	`request_key` text NOT NULL,
	`request_sha256` text NOT NULL,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`criteria_json` text NOT NULL,
	`admin_note` text,
	`edited_revision_id` text,
	`actor_digest` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`sermon_id`, `snapshot_event_id`, `revision`),
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`snapshot_event_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`edited_revision_id`) REFERENCES `sermon_content_events`(`sermon_id`,`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sermon_content_quality_revision_check" CHECK(typeof("sermon_content_quality_reviews"."revision")='integer' and "sermon_content_quality_reviews"."revision">0),
	CONSTRAINT "sermon_content_quality_scope_check" CHECK("sermon_content_quality_reviews"."scope" in ('intent','summary','child','adult')),
	CONSTRAINT "sermon_content_quality_status_check" CHECK("sermon_content_quality_reviews"."status" in ('good','edited_then_use','regenerate')),
	CONSTRAINT "sermon_content_quality_criteria_check" CHECK(json_valid("sermon_content_quality_reviews"."criteria_json") and json_type("sermon_content_quality_reviews"."criteria_json")='object'),
	CONSTRAINT "sermon_content_quality_note_check" CHECK("sermon_content_quality_reviews"."admin_note" is null or length("sermon_content_quality_reviews"."admin_note") between 1 and 2000),
	CONSTRAINT "sermon_content_quality_request_hash_check" CHECK(length("sermon_content_quality_reviews"."request_sha256")=64 and "sermon_content_quality_reviews"."request_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "sermon_content_quality_actor_check" CHECK(length("sermon_content_quality_reviews"."actor_digest")=64 and "sermon_content_quality_reviews"."actor_digest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sermon_content_quality_request_uidx` ON `sermon_content_quality_reviews` (`request_key`);
--> statement-breakpoint
CREATE TRIGGER sermon_content_quality_insert_guard BEFORE INSERT ON sermon_content_quality_reviews BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM sermon_content_events e JOIN quiz_sets q ON q.sermon_id=e.sermon_id
    WHERE e.sermon_id=NEW.sermon_id AND e.event_id=NEW.snapshot_event_id AND e.state='sealed'
      AND q.id=NEW.quiz_set_id AND q.status IN ('draft','review_ready','needs_revision')
      AND ((NEW.scope='intent' AND e.kind IN ('intent_analysis','intent_critique'))
        OR (NEW.scope='summary' AND e.kind='summary')
        OR (NEW.scope IN ('child','adult') AND e.kind='candidate' AND e.difficulty=NEW.scope))
  ) OR EXISTS(SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id)
  OR NEW.revision<>coalesce((SELECT max(r.revision) FROM sermon_content_quality_reviews r
    WHERE r.sermon_id=NEW.sermon_id AND r.snapshot_event_id=NEW.snapshot_event_id),0)+1
  OR (NEW.status='edited_then_use')<>(NEW.edited_revision_id IS NOT NULL)
  OR (NEW.edited_revision_id IS NOT NULL AND (NEW.edited_revision_id<>NEW.snapshot_event_id OR NOT EXISTS (
    SELECT 1 FROM sermon_content_human_events h WHERE h.sermon_id=NEW.sermon_id AND h.event_id=NEW.edited_revision_id
      AND h.operation IN ('intent_edit','summary_edit','candidate_edit'))))
  THEN RAISE(ABORT,'content_quality_insert') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_quality_no_update BEFORE UPDATE ON sermon_content_quality_reviews BEGIN
  SELECT RAISE(ABORT,'content_quality_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_quality_no_delete BEFORE DELETE ON sermon_content_quality_reviews BEGIN
  SELECT RAISE(ABORT,'content_quality_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_quality_human_gate BEFORE INSERT ON sermon_content_human_events
WHEN NEW.operation IN ('intent_confirm','summary_review','candidate_review') BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM sermon_content_quality_reviews r WHERE r.sermon_id=NEW.sermon_id
      AND r.snapshot_event_id=NEW.target_snapshot_event_id AND r.status='regenerate'
      AND r.revision=(SELECT max(latest.revision) FROM sermon_content_quality_reviews latest
        WHERE latest.sermon_id=r.sermon_id AND latest.snapshot_event_id=r.snapshot_event_id)
  ) THEN RAISE(ABORT,'content_quality_regenerate') END;
END;
--> statement-breakpoint
CREATE TRIGGER sermon_content_quality_publish_gate BEFORE INSERT ON published_quiz_content BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM sermon_content_current c JOIN quiz_sets q ON q.sermon_id=c.sermon_id
      JOIN sermon_content_quality_reviews r ON r.sermon_id=c.sermon_id
      WHERE q.id=NEW.quiz_set_id AND r.snapshot_event_id IN
        (c.selected_analysis_event_id,c.summary_snapshot_event_id,c.child_pool_event_id,c.adult_pool_event_id)
        AND r.status='regenerate'
        AND r.revision=(SELECT max(latest.revision) FROM sermon_content_quality_reviews latest
          WHERE latest.sermon_id=r.sermon_id AND latest.snapshot_event_id=r.snapshot_event_id)
  ) THEN RAISE(ABORT,'content_quality_regenerate') END;
END;
