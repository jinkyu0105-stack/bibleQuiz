CREATE TABLE `published_quiz_content` (
	`quiz_set_id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`sermon_date` text NOT NULL,
	`church_name` text NOT NULL,
	`bible_reference_label` text NOT NULL,
	`translation` text NOT NULL,
	`bible_reading_url` text NOT NULL,
	`summary` text NOT NULL,
	`disclosure` text NOT NULL,
	`source_sha256` text NOT NULL,
	`input_version` integer NOT NULL,
	`content_event_count` integer NOT NULL,
	`metadata_revision` integer NOT NULL,
	`selection_revision` integer NOT NULL,
	`request_key` text NOT NULL,
	`ticket_fingerprint` text NOT NULL,
	`generation_job_id` text NOT NULL,
	`provenance_json` text NOT NULL,
	`published_by_digest` text NOT NULL,
	`published_at` text NOT NULL,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "published_quiz_content_source_sha_check" CHECK(length("published_quiz_content"."source_sha256") = 64 and "published_quiz_content"."source_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "published_quiz_content_ticket_sha_check" CHECK(length("published_quiz_content"."ticket_fingerprint") = 64 and "published_quiz_content"."ticket_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "published_quiz_content_actor_check" CHECK(length("published_quiz_content"."published_by_digest") = 64 and "published_quiz_content"."published_by_digest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "published_quiz_content_provenance_check" CHECK(json_valid("published_quiz_content"."provenance_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `published_quiz_content_slug_unique` ON `published_quiz_content` (`slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `published_quiz_content_request_key_unique` ON `published_quiz_content` (`request_key`);
--> statement-breakpoint
-- This is the last insert before the status and featured update in one D1 batch.
-- A changed draft head, review, placement, or job aborts the whole batch.
CREATE TRIGGER published_quiz_content_insert BEFORE INSERT ON published_quiz_content BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM quiz_sets q
    JOIN generation_jobs j ON j.id=NEW.generation_job_id AND j.quiz_set_id=q.id AND j.sermon_id=q.sermon_id
    JOIN generation_full_v3_requests v ON v.job_id=j.id
    JOIN generation_final_validation_proofs p ON p.job_id=j.id
    JOIN final_check_tickets t ON t.id=coalesce((SELECT s.ticket_id FROM generation_placement_selections s
      WHERE s.job_id=j.id ORDER BY s.revision DESC LIMIT 1),p.ticket_id)
    JOIN sermon_input_heads h ON h.sermon_id=j.sermon_id
    JOIN sermon_content_current c ON c.sermon_id=j.sermon_id
    JOIN sermon_metadata_drafts m ON m.sermon_id=j.sermon_id
    JOIN sermons sermon ON sermon.id=q.sermon_id
    WHERE q.id=NEW.quiz_set_id AND q.status IN ('draft','needs_revision','review_ready')
      AND j.status='review_ready' AND j.current_step='finish' AND j.request_scope='full'
      AND j.active_wait_generation IS NULL AND t.state='sealed'
      AND t.sermon_id=j.sermon_id AND t.quiz_set_id=q.id
      AND t.ticket_fingerprint=NEW.ticket_fingerprint
      AND (sermon.slug IS NULL OR sermon.slug=NEW.slug)
      AND t.input_version=h.version AND t.input_version=NEW.input_version
      AND t.content_event_count=c.event_count AND t.content_event_count=NEW.content_event_count
      AND t.metadata_revision=m.metadata_revision AND t.metadata_revision=NEW.metadata_revision
      AND NEW.selection_revision=coalesce((SELECT max(s.revision) FROM generation_placement_selections s WHERE s.job_id=j.id),j.selection_revision)
      AND c.summary_review_event_id=t.summary_review_id
      AND c.child_review_event_id=t.child_review_id AND c.adult_review_event_id=t.adult_review_id
      AND NOT EXISTS (SELECT 1 FROM generation_jobs newer WHERE newer.sermon_id=j.sermon_id AND newer.request_scope='full'
        AND (newer.created_at>j.created_at OR newer.created_at=j.created_at AND newer.id>j.id))
      AND NOT EXISTS (SELECT 1 FROM generation_jobs running WHERE running.sermon_id=j.sermon_id
        AND running.id<>j.id AND running.status IN ('dispatch_pending','running'))
      AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=j.id
        AND r.state IN ('claimed','effect_started','retryable_failed','uncertain'))
      AND (SELECT count(*) FROM quiz_variants x WHERE x.quiz_set_id=q.id AND x.lifecycle_status='active'
        AND x.results_status='valid' AND x.revision=1 AND x.difficulty IN ('child','adult'))=2
      AND NOT EXISTS (SELECT 1 FROM quiz_variants x WHERE x.quiz_set_id=q.id AND
        (NOT EXISTS (SELECT 1 FROM quiz_solutions s WHERE s.quiz_variant_id=x.id)
          OR (SELECT count(*) FROM quiz_entries_public e WHERE e.quiz_variant_id=x.id)<>x.word_count))
  ) THEN RAISE(ABORT,'published_quiz_content_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER published_quiz_content_update BEFORE UPDATE ON published_quiz_content BEGIN SELECT RAISE(ABORT,'immutable published content'); END;
--> statement-breakpoint
CREATE TRIGGER published_quiz_content_delete BEFORE DELETE ON published_quiz_content BEGIN SELECT RAISE(ABORT,'immutable published content'); END;
--> statement-breakpoint
CREATE TRIGGER published_quiz_set_transition BEFORE UPDATE OF status ON quiz_sets WHEN NEW.status='published' AND OLD.status<>'published' BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM published_quiz_content p WHERE p.quiz_set_id=NEW.id
    AND p.published_at=NEW.published_at AND NEW.opens_at=NEW.published_at AND NEW.closes_at>NEW.opens_at)
    THEN RAISE(ABORT,'published_quiz_set_incomplete') END;
END;
