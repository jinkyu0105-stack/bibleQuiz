CREATE TABLE `published_display_corrections` (
	`quiz_set_id` text NOT NULL,
	`revision` integer NOT NULL,
	`request_key` text NOT NULL,
	`before_title` text NOT NULL,
	`before_sermon_date` text NOT NULL,
	`title` text NOT NULL,
	`sermon_date` text NOT NULL,
	`reason` text NOT NULL,
	`actor_digest` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`quiz_set_id`, `revision`),
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "published_display_revision_check" CHECK(typeof("published_display_corrections"."revision")='integer' and "published_display_corrections"."revision" between 1 and 9007199254740991),
	CONSTRAINT "published_display_title_check" CHECK(length(trim("published_display_corrections"."title")) between 1 and 300 and length(trim("published_display_corrections"."before_title")) between 1 and 300),
	CONSTRAINT "published_display_reason_check" CHECK(length(trim("published_display_corrections"."reason")) between 2 and 500),
	CONSTRAINT "published_display_actor_check" CHECK(length("published_display_corrections"."actor_digest")=64 and "published_display_corrections"."actor_digest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `published_display_request_uidx` ON `published_display_corrections` (`quiz_set_id`,`request_key`);--> statement-breakpoint
CREATE TRIGGER published_display_insert_guard BEFORE INSERT ON published_display_corrections BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM quiz_sets q JOIN sermons s ON s.id=q.sermon_id
    LEFT JOIN published_quiz_content p ON p.quiz_set_id=q.id
    WHERE q.id=NEW.quiz_set_id AND q.status IN ('published','archived')
      AND NEW.revision=coalesce((SELECT max(c.revision) FROM published_display_corrections c WHERE c.quiz_set_id=q.id),0)+1
      AND NEW.before_title=coalesce((SELECT c.title FROM published_display_corrections c WHERE c.quiz_set_id=q.id ORDER BY c.revision DESC LIMIT 1),p.title,s.sermon_title)
      AND NEW.before_sermon_date=coalesce((SELECT c.sermon_date FROM published_display_corrections c WHERE c.quiz_set_id=q.id ORDER BY c.revision DESC LIMIT 1),p.sermon_date,s.sermon_date)
      AND (NEW.title<>NEW.before_title OR NEW.sermon_date<>NEW.before_sermon_date)
  ) THEN RAISE(ABORT,'display correction conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER published_display_no_update BEFORE UPDATE ON published_display_corrections BEGIN
  SELECT RAISE(ABORT,'display correction immutable');
END;
--> statement-breakpoint
CREATE TRIGGER published_display_no_delete BEFORE DELETE ON published_display_corrections BEGIN
  SELECT RAISE(ABORT,'display correction immutable');
END;
