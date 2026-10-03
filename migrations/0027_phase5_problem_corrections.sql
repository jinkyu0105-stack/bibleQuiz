CREATE TABLE `quiz_problem_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_set_id` text NOT NULL,
	`cycle` integer NOT NULL,
	`source_json` text NOT NULL,
	`levels_json` text NOT NULL,
	`review_revision` integer NOT NULL,
	`display_revision` integer NOT NULL,
	`closes_at` text NOT NULL,
	`notice` text NOT NULL,
	`reason` text NOT NULL,
	`request_sha256` text NOT NULL,
	`actor_digest` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_problem_cycle` ON `quiz_problem_cases` (`quiz_set_id`,`cycle`);--> statement-breakpoint
CREATE TABLE `quiz_problem_cleanup` (
	`case_id` text PRIMARY KEY NOT NULL,
	`draft_revision` integer NOT NULL,
	`hashes_json` text NOT NULL,
	`purged_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `quiz_problem_cases`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `quiz_problem_drafts` (
	`case_id` text NOT NULL,
	`revision` integer NOT NULL,
	`request_key` text NOT NULL,
	`request_sha256` text NOT NULL,
	`actor_digest` text NOT NULL,
	`kind` text NOT NULL,
	`body_json` text NOT NULL,
	`body_sha256` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`case_id`, `revision`),
	FOREIGN KEY (`case_id`) REFERENCES `quiz_problem_cases`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_problem_draft_key` ON `quiz_problem_drafts` (`case_id`,`request_key`);--> statement-breakpoint
CREATE TABLE `quiz_problem_outcomes` (
	`case_id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`draft_revision` integer NOT NULL,
	`request_key` text NOT NULL,
	`request_sha256` text NOT NULL,
	`actor_digest` text NOT NULL,
	`reason` text NOT NULL,
	`content_json` text NOT NULL,
	`body_sha256` text NOT NULL,
	`display_revision` integer NOT NULL,
	`non_ranked` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `quiz_problem_cases`(`id`) ON UPDATE no action ON DELETE restrict
);

--> statement-breakpoint
CREATE TRIGGER quiz_problem_start BEFORE INSERT ON quiz_problem_cases BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_sets q WHERE q.id=NEW.quiz_set_id AND q.status IN ('published','archived')
 AND q.closes_at=NEW.closes_at AND NEW.cycle=coalesce((SELECT max(cycle) FROM quiz_problem_cases WHERE quiz_set_id=q.id),0)+1
 AND NEW.review_revision=(SELECT max(revision)+1 FROM quiz_variants WHERE quiz_set_id=q.id)
 AND NEW.display_revision=coalesce((SELECT max(revision) FROM published_display_corrections WHERE quiz_set_id=q.id),0)
 AND EXISTS(SELECT 1 FROM submissions sub JOIN quiz_variants v ON v.id=sub.quiz_variant_id WHERE v.quiz_set_id=q.id)
 AND NOT EXISTS(SELECT 1 FROM quiz_problem_cases c WHERE c.quiz_set_id=q.id AND NOT EXISTS(SELECT 1 FROM quiz_problem_outcomes WHERE case_id=c.id) AND NOT EXISTS(SELECT 1 FROM quiz_problem_cleanup WHERE case_id=c.id))
 AND (SELECT count(*) FROM quiz_variants WHERE quiz_set_id=q.id AND lifecycle_status='active')=2
 AND json_array_length(NEW.source_json,'$.variants')=2
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.source_json,'$.variants') v WHERE NOT EXISTS(SELECT 1 FROM quiz_variants old WHERE old.quiz_set_id=q.id AND old.id=json_extract(v.value,'$.sourceVariantId') AND old.revision=json_extract(v.value,'$.sourceRevision') AND old.lifecycle_status='active'))
 AND json_array_length(NEW.levels_json) BETWEEN 1 AND 2
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.levels_json) WHERE value NOT IN ('child','adult'))
 AND (SELECT count(DISTINCT value) FROM json_each(NEW.levels_json))=json_array_length(NEW.levels_json)
 ) THEN RAISE(ABORT,'problem_start_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_problem_pause AFTER INSERT ON quiz_problem_cases BEGIN
 UPDATE quiz_sets SET submission_state='paused',submission_paused_at=NEW.created_at,submission_paused_by=NEW.actor_digest,submission_pause_reason=NEW.notice,updated_at=NEW.created_at WHERE id=NEW.quiz_set_id;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_problem_no_resume BEFORE UPDATE OF submission_state ON quiz_sets
 WHEN NEW.submission_state='open' AND EXISTS(SELECT 1 FROM quiz_problem_cases c WHERE c.quiz_set_id=NEW.id AND c.cycle=(SELECT max(cycle) FROM quiz_problem_cases WHERE quiz_set_id=NEW.id) AND NOT EXISTS(SELECT 1 FROM quiz_problem_outcomes WHERE case_id=c.id))
 BEGIN SELECT RAISE(ABORT,'problem_pending'); END;
--> statement-breakpoint
CREATE TRIGGER quiz_problem_draft_insert BEFORE INSERT ON quiz_problem_drafts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_problem_cases c JOIN quiz_sets q ON q.id=c.quiz_set_id
 WHERE c.id=NEW.case_id AND c.cycle=(SELECT max(cycle) FROM quiz_problem_cases WHERE quiz_set_id=q.id)
 AND q.status IN ('published','archived') AND q.submission_state='paused'
 AND NOT EXISTS(SELECT 1 FROM quiz_problem_outcomes WHERE case_id=c.id) AND NOT EXISTS(SELECT 1 FROM quiz_problem_cleanup WHERE case_id=c.id)
 AND NEW.revision=coalesce((SELECT max(revision) FROM quiz_problem_drafts WHERE case_id=c.id),0)+1
 AND NEW.created_at>=coalesce((SELECT max(created_at) FROM quiz_problem_drafts WHERE case_id=c.id),c.created_at)
 AND NOT EXISTS(SELECT 1 FROM json_each(c.source_json,'$.variants') v WHERE NOT EXISTS(SELECT 1 FROM quiz_variants old WHERE old.id=json_extract(v.value,'$.sourceVariantId') AND old.lifecycle_status='active'))
 AND ((NEW.kind IN ('start','save','layout') AND (SELECT sum(value) FROM json_each(NEW.body_json,'$.reviewed'))=0)
 OR (NEW.kind='review' AND EXISTS(SELECT 1 FROM quiz_problem_drafts prev WHERE prev.case_id=c.id AND prev.revision=NEW.revision-1
 AND json_extract(prev.body_json,'$.content')=json_extract(NEW.body_json,'$.content') AND json_extract(prev.body_json,'$.layouts')=json_extract(NEW.body_json,'$.layouts')
 AND NOT EXISTS(SELECT 1 FROM json_each(prev.body_json,'$.reviewed') r WHERE r.value>json_extract(NEW.body_json,'$.reviewed.'||r.key))
 AND (SELECT sum(value) FROM json_each(NEW.body_json,'$.reviewed'))=(SELECT sum(value)+1 FROM json_each(prev.body_json,'$.reviewed'))))))
 THEN RAISE(ABORT,'problem_draft_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_problem_outcome_insert BEFORE INSERT ON quiz_problem_outcomes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_problem_cases c JOIN quiz_sets q ON q.id=c.quiz_set_id
 JOIN quiz_problem_drafts d ON d.case_id=c.id AND d.revision=NEW.draft_revision
 WHERE c.id=NEW.case_id AND c.cycle=(SELECT max(cycle) FROM quiz_problem_cases WHERE quiz_set_id=q.id)
 AND q.status IN ('published','archived') AND q.submission_state='paused'
 AND NEW.created_at>=d.created_at AND NEW.draft_revision=(SELECT max(revision) FROM quiz_problem_drafts WHERE case_id=c.id)
 AND NEW.non_ranked=(q.status='archived' OR q.closes_at<=NEW.created_at)
 AND (NEW.action='cancel' OR (NEW.action='publish'
 AND NOT EXISTS(SELECT 1 FROM quiz_problem_cleanup WHERE case_id=c.id)
 AND NEW.body_sha256=d.body_sha256 AND NEW.content_json=json_extract(d.body_json,'$.content')
 AND NEW.display_revision=c.display_revision AND NEW.display_revision=coalesce((SELECT max(revision) FROM published_display_corrections WHERE quiz_set_id=q.id),0)
 AND json_extract(d.body_json,'$.reviewed.summary')=1 AND json_extract(d.body_json,'$.reviewed.child')=1 AND json_extract(d.body_json,'$.reviewed.adult')=1)))
 THEN RAISE(ABORT,'problem_outcome_conflict') END;
 SELECT CASE WHEN NEW.action='publish' AND EXISTS(SELECT 1 FROM quiz_problem_cases c,json_each(c.source_json,'$.variants') original
 WHERE c.id=NEW.case_id AND json_extract(original.value,'$.difficulty') IN (SELECT value FROM json_each(c.levels_json)) AND NOT EXISTS(
 SELECT 1 FROM quiz_variants old JOIN quiz_variants replacement ON replacement.replaces_variant_id=old.id
 JOIN quiz_solutions sol ON sol.quiz_variant_id=replacement.id
 JOIN quiz_problem_drafts d ON d.case_id=c.id AND d.revision=NEW.draft_revision
 WHERE old.id=json_extract(original.value,'$.sourceVariantId') AND old.lifecycle_status='superseded' AND old.results_status='invalidated'
 AND replacement.id='rev-'||NEW.request_key||'-'||old.difficulty AND replacement.quiz_set_id=c.quiz_set_id AND replacement.difficulty=old.difficulty
 AND replacement.lifecycle_status='active' AND replacement.revision=c.review_revision
 AND ((NEW.non_ranked=1 AND replacement.results_status='non_ranked_correction') OR (NEW.non_ranked=0 AND replacement.results_status='valid'))
 AND replacement.grid_size=json_extract(d.body_json,'$.layouts.'||old.difficulty||'.grid.gridSize')
 AND replacement.word_count=json_array_length(d.body_json,'$.layouts.'||old.difficulty||'.grid.entries')
 AND replacement.word_count=(SELECT count(*) FROM quiz_entries_public WHERE quiz_variant_id=replacement.id)
 AND replacement.active_cell_count=json_array_length(d.body_json,'$.layouts.'||old.difficulty||'.grid.cells')
 AND sol.solution_cells_json=json_extract(d.body_json,'$.layouts.'||old.difficulty||'.solution.cells')
 AND NOT EXISTS(SELECT 1 FROM json_each(d.body_json,'$.layouts.'||old.difficulty||'.grid.entries') e WHERE NOT EXISTS(
 SELECT 1 FROM quiz_entries_public pe WHERE pe.quiz_variant_id=replacement.id AND pe.id=replacement.id||'-e'||e.key
 AND pe.clue=json_extract(e.value,'$.clue') AND pe.length=json_extract(e.value,'$.length') AND pe.number=json_extract(e.value,'$.number')
 AND pe.direction=json_extract(e.value,'$.direction') AND pe.start_row=json_extract(e.value,'$.start.row') AND pe.start_col=json_extract(e.value,'$.start.column')
 AND json_extract(sol.entry_answers_json,'$.'||pe.id)=json_extract(d.body_json,'$.layouts.'||old.difficulty||'.solution.entries.'||json_extract(e.value,'$.id'))))
 )) THEN RAISE(ABORT,'problem_rows_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_problem_outcome_apply AFTER INSERT ON quiz_problem_outcomes BEGIN
 UPDATE quiz_sets SET submission_state=CASE WHEN NEW.non_ranked=1 THEN 'paused' ELSE 'open' END,
 submission_pause_reason=CASE WHEN NEW.non_ranked=1 THEN '마감된 퀴즈입니다. 정정본은 기록 없이 풀어볼 수 있습니다.' ELSE NULL END,updated_at=NEW.created_at
 WHERE id=(SELECT quiz_set_id FROM quiz_problem_cases WHERE id=NEW.case_id);
END;
--> statement-breakpoint
CREATE VIEW quiz_content_versions AS
 SELECT quiz_set_id,revision,title,sermon_date,church_name,bible_reference_label,summary,disclosure,translation,bible_reading_url,display_revision FROM quiz_republications
 UNION ALL
 SELECT c.quiz_set_id,c.review_revision,json_extract(o.content_json,'$.metadata.title'),json_extract(o.content_json,'$.metadata.sermonDate'),
 json_extract(o.content_json,'$.churchName'),json_extract(o.content_json,'$.bibleReferenceLabel'),json_extract(o.content_json,'$.summary'),
 json_extract(c.source_json,'$.disclosure'),json_extract(c.source_json,'$.translation'),json_extract(c.source_json,'$.bibleReadingUrl'),o.display_revision
 FROM quiz_problem_cases c JOIN quiz_problem_outcomes o ON o.case_id=c.id WHERE o.action='publish';

--> statement-breakpoint
DROP TRIGGER published_display_insert_guard;
--> statement-breakpoint
CREATE TRIGGER published_display_insert_guard BEFORE INSERT ON published_display_corrections BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM quiz_sets q JOIN sermons s ON s.id=q.sermon_id
    LEFT JOIN published_quiz_content p ON p.quiz_set_id=q.id
    WHERE q.id=NEW.quiz_set_id AND q.status IN ('published','archived')
      AND NEW.revision=coalesce((SELECT max(c.revision) FROM published_display_corrections c WHERE c.quiz_set_id=q.id),0)+1
      AND NEW.before_title=coalesce((SELECT c.title FROM published_display_corrections c WHERE c.quiz_set_id=q.id AND c.revision>coalesce((SELECT display_revision FROM quiz_content_versions WHERE quiz_set_id=q.id ORDER BY revision DESC LIMIT 1),-1) ORDER BY c.revision DESC LIMIT 1),(SELECT title FROM quiz_content_versions WHERE quiz_set_id=q.id ORDER BY revision DESC LIMIT 1),p.title,s.sermon_title)
      AND NEW.before_sermon_date=coalesce((SELECT c.sermon_date FROM published_display_corrections c WHERE c.quiz_set_id=q.id AND c.revision>coalesce((SELECT display_revision FROM quiz_content_versions WHERE quiz_set_id=q.id ORDER BY revision DESC LIMIT 1),-1) ORDER BY c.revision DESC LIMIT 1),(SELECT sermon_date FROM quiz_content_versions WHERE quiz_set_id=q.id ORDER BY revision DESC LIMIT 1),p.sermon_date,s.sermon_date)
      AND (NEW.title<>NEW.before_title OR NEW.sermon_date<>NEW.before_sermon_date)
  ) THEN RAISE(ABORT,'display correction conflict') END;
END;



--> statement-breakpoint
CREATE TRIGGER quiz_problem_cases_update BEFORE UPDATE ON quiz_problem_cases BEGIN SELECT RAISE(ABORT,'immutable problem record'); END;

--> statement-breakpoint
CREATE TRIGGER quiz_problem_cases_delete BEFORE DELETE ON quiz_problem_cases BEGIN SELECT RAISE(ABORT,'immutable problem record'); END;

--> statement-breakpoint
CREATE TRIGGER quiz_problem_outcomes_update BEFORE UPDATE ON quiz_problem_outcomes BEGIN SELECT RAISE(ABORT,'immutable problem record'); END;

--> statement-breakpoint
CREATE TRIGGER quiz_problem_outcomes_delete BEFORE DELETE ON quiz_problem_outcomes BEGIN SELECT RAISE(ABORT,'immutable problem record'); END;

--> statement-breakpoint
CREATE TRIGGER quiz_problem_cleanup_update BEFORE UPDATE ON quiz_problem_cleanup BEGIN SELECT RAISE(ABORT,'immutable problem record'); END;

--> statement-breakpoint
CREATE TRIGGER quiz_problem_cleanup_delete BEFORE DELETE ON quiz_problem_cleanup BEGIN SELECT RAISE(ABORT,'immutable problem record'); END;

--> statement-breakpoint
CREATE TRIGGER quiz_problem_drafts_delete BEFORE DELETE ON quiz_problem_drafts BEGIN SELECT RAISE(ABORT,'immutable problem draft'); END;
--> statement-breakpoint
CREATE TRIGGER quiz_problem_drafts_update BEFORE UPDATE ON quiz_problem_drafts WHEN NOT (
 NEW.case_id=OLD.case_id AND NEW.revision=OLD.revision AND NEW.request_key=OLD.request_key AND NEW.request_sha256=OLD.request_sha256
 AND NEW.actor_digest=OLD.actor_digest AND NEW.kind=OLD.kind AND NEW.body_sha256=OLD.body_sha256 AND NEW.created_at=OLD.created_at
 AND NEW.body_json='null' AND EXISTS(SELECT 1 FROM quiz_problem_cleanup WHERE case_id=OLD.case_id))
 BEGIN SELECT RAISE(ABORT,'immutable problem draft'); END;
--> statement-breakpoint
CREATE TRIGGER quiz_problem_cleanup_insert BEFORE INSERT ON quiz_problem_cleanup BEGIN
 SELECT CASE WHEN NEW.draft_revision<>(SELECT max(revision) FROM quiz_problem_drafts WHERE case_id=NEW.case_id)
 OR NEW.purged_at<strftime('%Y-%m-%dT%H:%M:%fZ',coalesce((SELECT created_at FROM quiz_problem_outcomes WHERE case_id=NEW.case_id),(SELECT max(created_at) FROM quiz_problem_drafts WHERE case_id=NEW.case_id)),'+7 days')
 OR NEW.hashes_json<>(SELECT json_group_object(revision,body_sha256) FROM (SELECT revision,body_sha256 FROM quiz_problem_drafts WHERE case_id=NEW.case_id ORDER BY revision))
 THEN RAISE(ABORT,'problem_cleanup_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_problem_cleanup_apply AFTER INSERT ON quiz_problem_cleanup BEGIN
 UPDATE quiz_problem_drafts SET body_json='null' WHERE case_id=NEW.case_id;
END;

--> statement-breakpoint
CREATE VIEW quiz_problem_activity AS
 SELECT sermon_id,at FROM quiz_revision_activity
 UNION ALL SELECT q.sermon_id,c.created_at FROM quiz_problem_cases c JOIN quiz_sets q ON q.id=c.quiz_set_id
 UNION ALL SELECT q.sermon_id,d.created_at FROM quiz_problem_drafts d JOIN quiz_problem_cases c ON c.id=d.case_id JOIN quiz_sets q ON q.id=c.quiz_set_id
 UNION ALL SELECT q.sermon_id,o.created_at FROM quiz_problem_outcomes o JOIN quiz_problem_cases c ON c.id=o.case_id JOIN quiz_sets q ON q.id=c.quiz_set_id;
--> statement-breakpoint
CREATE TRIGGER quiz_problem_cleanup_activity BEFORE INSERT ON quiz_problem_cleanup BEGIN
 SELECT CASE WHEN NEW.purged_at<(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',max(a.at),'+7 days') FROM quiz_problem_activity a JOIN quiz_sets q ON q.sermon_id=a.sermon_id JOIN quiz_problem_cases c ON c.quiz_set_id=q.id WHERE c.id=NEW.case_id)
 OR EXISTS(SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id JOIN quiz_sets q ON q.sermon_id=j.sermon_id JOIN quiz_problem_cases c ON c.quiz_set_id=q.id WHERE c.id=NEW.case_id AND r.state IN ('claimed','effect_started') AND r.lease_expires_at>NEW.purged_at)
 THEN RAISE(ABORT,'problem_cleanup_activity') END;
END;
