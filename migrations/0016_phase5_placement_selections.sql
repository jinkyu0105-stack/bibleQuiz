CREATE TABLE `generation_placement_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`revision` integer NOT NULL,
	`ticket_id` text NOT NULL,
	`actor_digest` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ticket_id`) REFERENCES `final_check_tickets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "generation_placement_selection_revision" CHECK(typeof(revision)='integer' and revision between 2 and 9007199254740991),
	CONSTRAINT "generation_placement_selection_actor" CHECK(length(actor_digest)=64 and actor_digest not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_placement_selections_revision` ON `generation_placement_selections` (`job_id`,`revision`);--> statement-breakpoint
CREATE TRIGGER generation_placement_selection_insert BEFORE INSERT ON generation_placement_selections BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM generation_jobs j JOIN generation_full_v3_requests v ON v.job_id=j.id
    JOIN quiz_sets q ON q.id=j.quiz_set_id AND q.sermon_id=j.sermon_id
    JOIN final_check_tickets t ON t.id=NEW.ticket_id AND t.sermon_id=j.sermon_id AND t.quiz_set_id=j.quiz_set_id
    JOIN sermon_input_heads h ON h.sermon_id=j.sermon_id
    JOIN sermon_content_current c ON c.sermon_id=j.sermon_id
    JOIN sermon_metadata_drafts m ON m.sermon_id=j.sermon_id
    WHERE j.id=NEW.job_id AND j.request_scope='full' AND q.status IN ('draft','needs_revision','review_ready')
      AND ((j.status='running' AND j.current_step='content_review') OR (j.status='review_ready' AND j.current_step='finish'))
      AND j.active_wait_generation IS NULL AND t.state='sealed'
      AND t.input_version=h.version AND t.content_event_count=c.event_count AND t.metadata_revision=m.metadata_revision
      AND NEW.revision=coalesce((SELECT max(s.revision) FROM generation_placement_selections s WHERE s.job_id=j.id),j.selection_revision)+1
      AND NOT EXISTS (SELECT 1 FROM generation_jobs newer WHERE newer.sermon_id=j.sermon_id AND newer.request_scope='full'
        AND (newer.created_at>j.created_at OR newer.created_at=j.created_at AND newer.id>j.id))
      AND NOT EXISTS (SELECT 1 FROM generation_step_receipts r WHERE r.generation_job_id=j.id AND r.state IN ('claimed','effect_started','retryable_failed','uncertain'))
  ) THEN RAISE(ABORT, 'generation_placement_selection_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER generation_placement_selection_update BEFORE UPDATE ON generation_placement_selections BEGIN SELECT RAISE(ABORT, 'immutable placement selection'); END;
--> statement-breakpoint
CREATE TRIGGER generation_placement_selection_delete BEFORE DELETE ON generation_placement_selections BEGIN SELECT RAISE(ABORT, 'immutable placement selection'); END;
