CREATE TABLE `published_wording_corrections` (
	`quiz_set_id` text NOT NULL,
	`revision` integer NOT NULL,
	`request_key` text NOT NULL,
	`content_revision` integer NOT NULL,
	`target` text NOT NULL,
	`before_text` text NOT NULL,
	`after_text` text NOT NULL,
	`assessment` text NOT NULL,
	`confirmation` text NOT NULL,
	`reason` text NOT NULL,
	`actor_digest` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`quiz_set_id`, `revision`),
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "published_wording_revision_check" CHECK(typeof("published_wording_corrections"."revision")='integer' and "published_wording_corrections"."revision">0 and typeof("published_wording_corrections"."content_revision")='integer' and "published_wording_corrections"."content_revision">=0),
	CONSTRAINT "published_wording_confirmation_check" CHECK("published_wording_corrections"."assessment"='non_semantic_typo' and "published_wording_corrections"."confirmation"='meaning_and_answer_unchanged'),
	CONSTRAINT "published_wording_text_check" CHECK(length(trim("published_wording_corrections"."before_text")) between 1 and 20000 and length(trim("published_wording_corrections"."after_text")) between 1 and 20000 and "published_wording_corrections"."before_text"<>"published_wording_corrections"."after_text"),
	CONSTRAINT "published_wording_reason_check" CHECK(length(trim("published_wording_corrections"."reason")) between 2 and 500),
	CONSTRAINT "published_wording_actor_check" CHECK(length("published_wording_corrections"."actor_digest")=64 and "published_wording_corrections"."actor_digest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `published_wording_request_uidx` ON `published_wording_corrections` (`quiz_set_id`,`request_key`);
--> statement-breakpoint
-- Only public text is projected. Summary corrections belong to a content version;
-- clue corrections belong to an exact entry, including an unchanged difficulty.
CREATE VIEW quiz_wording_current AS
SELECT q.id quiz_set_id, coalesce(r.revision,0) content_revision, 'summary' target,
 'summary' kind, NULL difficulty, NULL number, NULL direction,
 coalesce((SELECT w.after_text FROM published_wording_corrections w WHERE w.quiz_set_id=q.id AND w.target='summary'
   AND w.content_revision=coalesce(r.revision,0) ORDER BY w.revision DESC LIMIT 1),r.summary,p.summary,s.ai_summary) text
FROM quiz_sets q JOIN sermons s ON s.id=q.sermon_id
LEFT JOIN published_quiz_content p ON p.quiz_set_id=q.id
LEFT JOIN quiz_content_versions r ON r.quiz_set_id=q.id AND r.revision=(SELECT max(revision) FROM quiz_content_versions WHERE quiz_set_id=q.id)
UNION ALL
SELECT v.quiz_set_id,coalesce((SELECT max(revision) FROM quiz_content_versions WHERE quiz_set_id=v.quiz_set_id),0),
 e.id,'clue',v.difficulty,e.number,e.direction,
 coalesce((SELECT w.after_text FROM published_wording_corrections w WHERE w.quiz_set_id=v.quiz_set_id AND w.target=e.id ORDER BY w.revision DESC LIMIT 1),e.clue)
FROM quiz_entries_public e JOIN quiz_variants v ON v.id=e.quiz_variant_id WHERE v.lifecycle_status='active';
--> statement-breakpoint
CREATE TRIGGER published_wording_insert_guard BEFORE INSERT ON published_wording_corrections BEGIN
 SELECT RAISE(ABORT,'wording conflict') WHERE
  NEW.revision<>(SELECT coalesce(max(revision),0)+1 FROM published_wording_corrections WHERE quiz_set_id=NEW.quiz_set_id)
  OR NOT EXISTS(SELECT 1 FROM quiz_sets WHERE id=NEW.quiz_set_id AND status IN ('published','archived'))
  OR EXISTS(SELECT 1 FROM quiz_problem_cases c WHERE c.quiz_set_id=NEW.quiz_set_id AND NOT EXISTS(SELECT 1 FROM quiz_problem_outcomes o WHERE o.case_id=c.id)
    AND c.cycle=(SELECT max(cycle) FROM quiz_problem_cases WHERE quiz_set_id=c.quiz_set_id))
  OR NOT EXISTS(SELECT 1 FROM quiz_wording_current w WHERE w.quiz_set_id=NEW.quiz_set_id AND w.content_revision=NEW.content_revision
    AND w.target=NEW.target AND w.text=NEW.before_text AND (w.kind='summary' OR length(NEW.after_text)<=2000));
END;
--> statement-breakpoint
CREATE TRIGGER published_wording_no_update BEFORE UPDATE ON published_wording_corrections BEGIN SELECT RAISE(ABORT,'immutable wording'); END;
--> statement-breakpoint
CREATE TRIGGER published_wording_no_delete BEFORE DELETE ON published_wording_corrections BEGIN SELECT RAISE(ABORT,'immutable wording'); END;
