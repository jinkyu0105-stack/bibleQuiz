CREATE TABLE `quiz_withdrawals` (
	`quiz_set_id` text PRIMARY KEY NOT NULL,
	`request_key` text NOT NULL,
	`published_at` text NOT NULL,
	`display_revision` integer NOT NULL,
	`review_revision` integer NOT NULL,
	`review_json` text NOT NULL,
	`reason` text NOT NULL,
	`actor_digest` text NOT NULL,
	`withdrawn_at` text NOT NULL,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "quiz_withdrawals_review_check" CHECK(json_valid("quiz_withdrawals"."review_json")),
	CONSTRAINT "quiz_withdrawals_revision_check" CHECK("quiz_withdrawals"."review_revision">1 and "quiz_withdrawals"."display_revision">=0),
	CONSTRAINT "quiz_withdrawals_actor_check" CHECK(length("quiz_withdrawals"."actor_digest")=64 and "quiz_withdrawals"."actor_digest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_withdrawals_request_key_unique` ON `quiz_withdrawals` (`request_key`);
--> statement-breakpoint
-- A successful submission includes hidden/deleted tombstones, on every revision.
-- Capture, guard, state changes and service audit belong to one D1 batch.
CREATE TRIGGER quiz_withdrawals_insert BEFORE INSERT ON quiz_withdrawals BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_sets q WHERE q.id=NEW.quiz_set_id
    AND q.status='published' AND q.published_at=NEW.published_at AND q.closes_at>NEW.withdrawn_at
    AND NEW.display_revision=coalesce((SELECT max(revision) FROM published_display_corrections WHERE quiz_set_id=q.id),0)
    AND NOT EXISTS(SELECT 1 FROM submissions s JOIN quiz_variants v ON v.id=s.quiz_variant_id WHERE v.quiz_set_id=q.id)
    AND NOT EXISTS(SELECT 1 FROM leaderboard_snapshots l JOIN quiz_variants v ON v.id=l.quiz_variant_id WHERE v.quiz_set_id=q.id)
    AND (SELECT count(*) FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status='active' AND v.results_status='valid')=2
    AND NOT EXISTS(SELECT 1 FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status='active' AND
      (NOT EXISTS(SELECT 1 FROM quiz_solutions s WHERE s.quiz_variant_id=v.id)
       OR (SELECT count(*) FROM quiz_entries_public e WHERE e.quiz_variant_id=v.id)<>v.word_count))
    AND NEW.review_revision=(SELECT max(revision)+1 FROM quiz_variants WHERE quiz_set_id=q.id)
    AND json_array_length(NEW.review_json,'$.variants')=2
  ) THEN RAISE(ABORT,'quiz_withdrawal_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_withdrawals_apply AFTER INSERT ON quiz_withdrawals BEGIN
  UPDATE quiz_variants SET lifecycle_status='withdrawn',lifecycle_reason=NEW.reason,lifecycle_changed_at=NEW.withdrawn_at
    WHERE quiz_set_id=NEW.quiz_set_id AND lifecycle_status='active';
  UPDATE quiz_sets SET status='review_ready',submission_state='paused',submission_paused_at=NEW.withdrawn_at,
    submission_pause_reason=NEW.reason,updated_at=NEW.withdrawn_at WHERE id=NEW.quiz_set_id;
  UPDATE site_state SET value=coalesce((SELECT q.id FROM quiz_sets q
    WHERE (q.status='published' AND q.submission_state='open' AND q.opens_at<=NEW.withdrawn_at AND q.closes_at>NEW.withdrawn_at OR q.status='archived')
      AND (SELECT count(*) FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status='active' AND v.results_status='valid')=2
    ORDER BY CASE q.status WHEN 'published' THEN 0 ELSE 1 END,q.published_at DESC,q.id DESC LIMIT 1),''),updated_at=NEW.withdrawn_at
    WHERE key='featured_quiz_set_id' AND value=NEW.quiz_set_id;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_withdrawals_update BEFORE UPDATE ON quiz_withdrawals BEGIN SELECT RAISE(ABORT,'immutable withdrawal'); END;
--> statement-breakpoint
CREATE TRIGGER quiz_withdrawals_delete BEFORE DELETE ON quiz_withdrawals BEGIN SELECT RAISE(ABORT,'immutable withdrawal'); END;
--> statement-breakpoint
-- The original publication ticket cannot revive withdrawn variants. A future
-- reviewed revision publisher must introduce its own narrowly validated transition.
CREATE TRIGGER quiz_withdrawals_no_republish BEFORE UPDATE OF status ON quiz_sets
  WHEN NEW.status='published' AND OLD.status<>'published' AND EXISTS(SELECT 1 FROM quiz_withdrawals WHERE quiz_set_id=NEW.id)
  BEGIN SELECT RAISE(ABORT,'withdrawn_requires_new_review'); END;
