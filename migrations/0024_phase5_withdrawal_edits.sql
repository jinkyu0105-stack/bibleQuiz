CREATE TABLE `withdrawal_edit_revisions` (
	`quiz_set_id` text NOT NULL,
	`revision` integer NOT NULL,
	`review_revision` integer NOT NULL,
	`request_key` text NOT NULL,
	`request_sha256` text NOT NULL,
	`edits_json` text NOT NULL,
	`actor_digest` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`quiz_set_id`, `revision`),
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_withdrawals`(`quiz_set_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "withdrawal_edit_revision_check" CHECK(typeof("withdrawal_edit_revisions"."revision")='integer' and "withdrawal_edit_revisions"."revision">0 and "withdrawal_edit_revisions"."review_revision">1),
	CONSTRAINT "withdrawal_edit_json_check" CHECK(json_valid("withdrawal_edit_revisions"."edits_json") and json_type("withdrawal_edit_revisions"."edits_json")='array'),
	CONSTRAINT "withdrawal_edit_hash_check" CHECK(length("withdrawal_edit_revisions"."request_sha256")=64 and "withdrawal_edit_revisions"."request_sha256" not glob '*[^0-9a-f]*' and length("withdrawal_edit_revisions"."actor_digest")=64 and "withdrawal_edit_revisions"."actor_digest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `withdrawal_edit_request_unique` ON `withdrawal_edit_revisions` (`quiz_set_id`,`request_key`);
--> statement-breakpoint
CREATE TRIGGER withdrawal_edits_insert BEFORE INSERT ON withdrawal_edit_revisions BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_withdrawals w JOIN quiz_sets q ON q.id=w.quiz_set_id
    WHERE w.quiz_set_id=NEW.quiz_set_id AND w.review_revision=NEW.review_revision
      AND q.status='review_ready' AND q.submission_state='paused'
      AND NEW.revision=coalesce((SELECT max(revision) FROM withdrawal_edit_revisions WHERE quiz_set_id=q.id),0)+1
      AND NOT EXISTS(SELECT 1 FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status!='withdrawn')
      AND NOT EXISTS(SELECT 1 FROM submissions s JOIN quiz_variants v ON v.id=s.quiz_variant_id WHERE v.quiz_set_id=q.id)
      AND json_array_length(NEW.edits_json)>0
      AND NOT EXISTS(SELECT 1 FROM json_each(NEW.edits_json) e WHERE NOT EXISTS(
        SELECT 1 FROM json_each(w.review_json,'$.variants') v,json_each(v.value,'$.entries') n
        WHERE json_extract(v.value,'$.difficulty')=json_extract(e.value,'$.difficulty')
          AND json_extract(n.value,'$.id')=json_extract(e.value,'$.entryId')))
  ) THEN RAISE(ABORT,'withdrawal_edit_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER withdrawal_edits_update BEFORE UPDATE ON withdrawal_edit_revisions
  BEGIN SELECT RAISE(ABORT,'immutable withdrawal edit'); END;
--> statement-breakpoint
CREATE TRIGGER withdrawal_edits_delete BEFORE DELETE ON withdrawal_edit_revisions
  BEGIN SELECT RAISE(ABORT,'immutable withdrawal edit'); END;
