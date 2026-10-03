CREATE TABLE `withdrawal_edit_cleanup` (
	`quiz_set_id` text PRIMARY KEY NOT NULL,
	`head_revision` integer NOT NULL,
	`last_saved_at` text NOT NULL,
	`due_at` text NOT NULL,
	`purged_at` text NOT NULL,
	`payload_hashes_json` text NOT NULL,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_withdrawals`(`quiz_set_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "withdrawal_cleanup_revision" CHECK("withdrawal_edit_cleanup"."head_revision">0),
	CONSTRAINT "withdrawal_cleanup_time" CHECK("withdrawal_edit_cleanup"."purged_at">="withdrawal_edit_cleanup"."due_at"),
	CONSTRAINT "withdrawal_cleanup_hashes" CHECK(json_valid("withdrawal_edit_cleanup"."payload_hashes_json") and json_type("withdrawal_edit_cleanup"."payload_hashes_json")='object')
);

--> statement-breakpoint
CREATE TRIGGER withdrawal_cleanup_insert BEFORE INSERT ON withdrawal_edit_cleanup BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_sets q JOIN quiz_withdrawals w ON w.quiz_set_id=q.id
    WHERE q.id=NEW.quiz_set_id AND q.status='review_ready' AND q.submission_state='paused'
      AND NEW.head_revision=(SELECT max(revision) FROM withdrawal_edit_revisions WHERE quiz_set_id=q.id)
      AND NEW.last_saved_at=(SELECT max(created_at) FROM withdrawal_edit_revisions WHERE quiz_set_id=q.id)
      AND NEW.due_at=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_saved_at,'+7 days')
      AND NOT EXISTS(SELECT 1 FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status!='withdrawn')
      AND NOT EXISTS(SELECT 1 FROM submissions s JOIN quiz_variants v ON v.id=s.quiz_variant_id WHERE v.quiz_set_id=q.id)
      AND NOT EXISTS(SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id
        WHERE j.sermon_id=q.sermon_id AND r.state IN ('claimed','effect_started') AND r.lease_expires_at>NEW.purged_at)
      AND (SELECT count(*) FROM json_each(NEW.payload_hashes_json))=(SELECT count(*) FROM withdrawal_edit_revisions WHERE quiz_set_id=q.id)
      AND NOT EXISTS(SELECT 1 FROM withdrawal_edit_revisions e WHERE e.quiz_set_id=q.id AND NOT EXISTS(
        SELECT 1 FROM json_each(NEW.payload_hashes_json) h WHERE h.key=cast(e.revision AS text)
          AND h.type='text' AND length(h.value)=64 AND h.value NOT GLOB '*[^0-9a-f]*'))
  ) THEN RAISE(ABORT,'withdrawal_cleanup_conflict') END;
END;
--> statement-breakpoint
-- Retain every identity and request fingerprint. Permit only the marked payload expiry.
DROP TRIGGER withdrawal_edits_update;
--> statement-breakpoint
CREATE TRIGGER withdrawal_edits_update BEFORE UPDATE ON withdrawal_edit_revisions
WHEN NOT (NEW.edits_json='[]' AND NEW.quiz_set_id IS OLD.quiz_set_id AND NEW.revision IS OLD.revision
  AND NEW.review_revision IS OLD.review_revision AND NEW.request_key IS OLD.request_key
  AND NEW.request_sha256 IS OLD.request_sha256 AND NEW.actor_digest IS OLD.actor_digest AND NEW.created_at IS OLD.created_at
  AND EXISTS(SELECT 1 FROM withdrawal_edit_cleanup c WHERE c.quiz_set_id=OLD.quiz_set_id AND OLD.revision<=c.head_revision))
BEGIN SELECT RAISE(ABORT,'immutable withdrawal edit'); END;
--> statement-breakpoint
CREATE TRIGGER withdrawal_cleanup_apply AFTER INSERT ON withdrawal_edit_cleanup BEGIN
  UPDATE withdrawal_edit_revisions SET edits_json='[]' WHERE quiz_set_id=NEW.quiz_set_id;
END;
--> statement-breakpoint
CREATE TRIGGER withdrawal_cleanup_no_new_edits BEFORE INSERT ON withdrawal_edit_revisions
WHEN EXISTS(SELECT 1 FROM withdrawal_edit_cleanup WHERE quiz_set_id=NEW.quiz_set_id)
BEGIN SELECT RAISE(ABORT,'withdrawal_edit_expired'); END;
--> statement-breakpoint
CREATE TRIGGER withdrawal_cleanup_update BEFORE UPDATE ON withdrawal_edit_cleanup
BEGIN SELECT RAISE(ABORT,'immutable withdrawal cleanup'); END;
--> statement-breakpoint
CREATE TRIGGER withdrawal_cleanup_delete BEFORE DELETE ON withdrawal_edit_cleanup
BEGIN SELECT RAISE(ABORT,'immutable withdrawal cleanup'); END;
