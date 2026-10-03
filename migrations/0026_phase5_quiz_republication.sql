CREATE TABLE `quiz_republications` (
	`session_id` text PRIMARY KEY NOT NULL,
	`quiz_set_id` text NOT NULL,
	`revision` integer NOT NULL,
	`draft_revision` integer NOT NULL,
	`request_key` text NOT NULL,
	`request_sha256` text NOT NULL,
	`actor_digest` text NOT NULL,
	`body_sha256` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`sermon_date` text NOT NULL,
	`church_name` text NOT NULL,
	`bible_reference_label` text NOT NULL,
	`translation` text NOT NULL,
	`bible_reading_url` text NOT NULL,
	`summary` text NOT NULL,
	`disclosure` text NOT NULL,
	`display_revision` integer NOT NULL,
	`published_at` text NOT NULL,
	`closes_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `quiz_revision_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_republication_revision_unique` ON `quiz_republications` (`quiz_set_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_republication_request_unique` ON `quiz_republications` (`quiz_set_id`,`request_key`);--> statement-breakpoint
CREATE TABLE `quiz_revision_cleanup` (
	`session_id` text PRIMARY KEY NOT NULL,
	`head_revision` integer NOT NULL,
	`due_at` text NOT NULL,
	`purged_at` text NOT NULL,
	`hashes_json` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `quiz_revision_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "quiz_revision_cleanup_json" CHECK(json_valid("quiz_revision_cleanup"."hashes_json")),
	CONSTRAINT "quiz_revision_cleanup_time" CHECK("quiz_revision_cleanup"."purged_at">="quiz_revision_cleanup"."due_at")
);
--> statement-breakpoint
CREATE TABLE `quiz_revision_drafts` (
	`session_id` text NOT NULL,
	`revision` integer NOT NULL,
	`request_key` text NOT NULL,
	`request_sha256` text NOT NULL,
	`actor_digest` text NOT NULL,
	`kind` text NOT NULL,
	`body_json` text NOT NULL,
	`body_sha256` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `revision`),
	FOREIGN KEY (`session_id`) REFERENCES `quiz_revision_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "quiz_revision_draft_json" CHECK(json_valid("quiz_revision_drafts"."body_json")),
	CONSTRAINT "quiz_revision_draft_positive" CHECK("quiz_revision_drafts"."revision">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_revision_draft_request_unique` ON `quiz_revision_drafts` (`session_id`,`request_key`);--> statement-breakpoint
CREATE TABLE `quiz_revision_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_set_id` text NOT NULL,
	`cycle` integer NOT NULL,
	`kind` text NOT NULL,
	`review_revision` integer NOT NULL,
	`published_at` text NOT NULL,
	`display_revision` integer NOT NULL,
	`source_json` text NOT NULL,
	`request_sha256` text NOT NULL,
	`actor_digest` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quiz_set_id`) REFERENCES `quiz_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "quiz_revision_source_json" CHECK(json_valid("quiz_revision_sessions"."source_json")),
	CONSTRAINT "quiz_revision_cycle_check" CHECK("quiz_revision_sessions"."cycle">0 and "quiz_revision_sessions"."review_revision">1 and "quiz_revision_sessions"."display_revision">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_revision_cycle_unique` ON `quiz_revision_sessions` (`quiz_set_id`,`cycle`);
--> statement-breakpoint
CREATE TRIGGER quiz_revision_session_insert BEFORE INSERT ON quiz_revision_sessions BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_sets q WHERE q.id=NEW.quiz_set_id
 AND NOT EXISTS(SELECT 1 FROM submissions sub JOIN quiz_variants v ON v.id=sub.quiz_variant_id WHERE v.quiz_set_id=q.id) AND NOT EXISTS(SELECT 1 FROM leaderboard_snapshots l JOIN quiz_variants v ON v.id=l.quiz_variant_id WHERE v.quiz_set_id=q.id)
 AND NEW.cycle=coalesce((SELECT max(cycle) FROM quiz_revision_sessions WHERE quiz_set_id=q.id),0)+1
 AND NEW.review_revision=(SELECT max(revision)+1 FROM quiz_variants WHERE quiz_set_id=q.id)
 AND NEW.display_revision=coalesce((SELECT max(revision) FROM published_display_corrections WHERE quiz_set_id=q.id),0)
 AND NEW.published_at=q.published_at AND json_array_length(NEW.source_json,'$.variants')=2
 AND ((NEW.kind='start' AND q.status='review_ready' AND q.submission_state='paused'
   AND NOT EXISTS(SELECT 1 FROM quiz_variants WHERE quiz_set_id=q.id AND lifecycle_status<>'withdrawn')
   AND (NOT EXISTS(SELECT 1 FROM quiz_revision_sessions WHERE quiz_set_id=q.id) OR EXISTS(
     SELECT 1 FROM quiz_revision_sessions s JOIN quiz_revision_cleanup c ON c.session_id=s.id WHERE s.quiz_set_id=q.id AND s.cycle=NEW.cycle-1))
   AND NEW.source_json=coalesce((SELECT source_json FROM quiz_revision_sessions WHERE quiz_set_id=q.id ORDER BY cycle DESC LIMIT 1),
     (SELECT review_json FROM quiz_withdrawals WHERE quiz_set_id=q.id)))
 OR (NEW.kind='withdraw' AND q.status='published' AND q.closes_at>NEW.created_at
   AND EXISTS(SELECT 1 FROM quiz_republications WHERE quiz_set_id=q.id AND published_at=q.published_at)
   AND (SELECT count(*) FROM quiz_variants WHERE quiz_set_id=q.id AND lifecycle_status='active' AND results_status='valid')=2
   AND NOT EXISTS(SELECT 1 FROM json_each(NEW.source_json,'$.variants') j WHERE NOT EXISTS(
     SELECT 1 FROM quiz_variants v JOIN quiz_solutions sol ON sol.quiz_variant_id=v.id WHERE v.quiz_set_id=q.id AND v.lifecycle_status='active'
     AND v.id=json_extract(j.value,'$.sourceVariantId') AND v.revision=json_extract(j.value,'$.sourceRevision')
     AND v.public_grid_json=json_extract(j.value,'$.grid') AND sol.solution_cells_json=json_extract(j.value,'$.solutionCells'))))))
 THEN RAISE(ABORT,'revision_session_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_revision_withdraw AFTER INSERT ON quiz_revision_sessions WHEN NEW.kind='withdraw' BEGIN
  UPDATE quiz_variants SET lifecycle_status='withdrawn',lifecycle_reason=NEW.reason,lifecycle_changed_at=NEW.created_at
    WHERE quiz_set_id=NEW.quiz_set_id AND lifecycle_status='active';
  UPDATE quiz_sets SET status='review_ready',submission_state='paused',submission_paused_at=NEW.created_at,
    submission_pause_reason=NEW.reason,updated_at=NEW.created_at WHERE id=NEW.quiz_set_id;
  UPDATE site_state SET value=coalesce((SELECT q.id FROM quiz_sets q
    WHERE (q.status='published' AND q.submission_state='open' AND q.opens_at<=NEW.created_at AND q.closes_at>NEW.created_at OR q.status='archived')
      AND (SELECT count(*) FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status='active' AND v.results_status='valid')=2
    ORDER BY CASE q.status WHEN 'published' THEN 0 ELSE 1 END,q.published_at DESC,q.id DESC LIMIT 1),''),updated_at=NEW.created_at
    WHERE key='featured_quiz_set_id' AND value=NEW.quiz_set_id;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_revision_draft_insert BEFORE INSERT ON quiz_revision_drafts BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_revision_sessions s JOIN quiz_sets q ON q.id=s.quiz_set_id
 WHERE s.id=NEW.session_id AND s.cycle=(SELECT max(cycle) FROM quiz_revision_sessions WHERE quiz_set_id=q.id)
 AND q.status='review_ready' AND q.submission_state='paused' AND NOT EXISTS(SELECT 1 FROM submissions sub JOIN quiz_variants v ON v.id=sub.quiz_variant_id WHERE v.quiz_set_id=q.id) AND NOT EXISTS(SELECT 1 FROM leaderboard_snapshots l JOIN quiz_variants v ON v.id=l.quiz_variant_id WHERE v.quiz_set_id=q.id)
 AND NOT EXISTS(SELECT 1 FROM quiz_variants WHERE quiz_set_id=q.id AND lifecycle_status<>'withdrawn')
 AND NOT EXISTS(SELECT 1 FROM quiz_revision_cleanup WHERE session_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM quiz_republications WHERE session_id=s.id)
 AND NEW.revision=coalesce((SELECT max(revision) FROM quiz_revision_drafts WHERE session_id=s.id),0)+1
 AND NEW.created_at>=coalesce((SELECT max(created_at) FROM quiz_revision_drafts WHERE session_id=s.id),s.created_at)
 AND ((NEW.kind IN ('start','save','layout') AND json_extract(NEW.body_json,'$.reviewed.summary')=0
   AND json_extract(NEW.body_json,'$.reviewed.child')=0 AND json_extract(NEW.body_json,'$.reviewed.adult')=0)
 OR (NEW.kind='review' AND EXISTS(SELECT 1 FROM quiz_revision_drafts prev WHERE prev.session_id=s.id AND prev.revision=NEW.revision-1
   AND json_extract(prev.body_json,'$.content')=json_extract(NEW.body_json,'$.content')
   AND json_extract(prev.body_json,'$.layouts')=json_extract(NEW.body_json,'$.layouts')
   AND NOT EXISTS(SELECT 1 FROM json_each(prev.body_json,'$.reviewed') r WHERE r.value>json_extract(NEW.body_json,'$.reviewed.'||r.key))
   AND (SELECT sum(value) FROM json_each(NEW.body_json,'$.reviewed'))=(SELECT sum(value)+1 FROM json_each(prev.body_json,'$.reviewed'))))))
 THEN RAISE(ABORT,'revision_draft_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_republication_insert BEFORE INSERT ON quiz_republications BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_revision_sessions s JOIN quiz_sets q ON q.id=s.quiz_set_id
 JOIN quiz_revision_drafts d ON d.session_id=s.id AND d.revision=NEW.draft_revision
 WHERE s.id=NEW.session_id AND s.quiz_set_id=NEW.quiz_set_id AND s.review_revision=NEW.revision
 AND s.cycle=(SELECT max(cycle) FROM quiz_revision_sessions WHERE quiz_set_id=q.id)
 AND q.status='review_ready' AND q.submission_state='paused' AND NOT EXISTS(SELECT 1 FROM submissions sub JOIN quiz_variants v ON v.id=sub.quiz_variant_id WHERE v.quiz_set_id=q.id) AND NOT EXISTS(SELECT 1 FROM leaderboard_snapshots l JOIN quiz_variants v ON v.id=l.quiz_variant_id WHERE v.quiz_set_id=q.id)
 AND NOT EXISTS(SELECT 1 FROM quiz_revision_cleanup WHERE session_id=s.id)
 AND NEW.draft_revision=(SELECT max(revision) FROM quiz_revision_drafts WHERE session_id=s.id)
 AND NEW.body_sha256=d.body_sha256 AND json_extract(d.body_json,'$.reviewed.summary')=1
 AND json_extract(d.body_json,'$.reviewed.child')=1 AND json_extract(d.body_json,'$.reviewed.adult')=1
 AND NEW.title=json_extract(d.body_json,'$.content.metadata.title') AND NEW.sermon_date=json_extract(d.body_json,'$.content.metadata.sermonDate')
 AND NEW.summary=json_extract(d.body_json,'$.content.summary') AND NEW.church_name=json_extract(d.body_json,'$.content.churchName')
 AND NEW.bible_reference_label=json_extract(d.body_json,'$.content.bibleReferenceLabel')
 AND NEW.slug=json_extract(s.source_json,'$.slug') AND NEW.disclosure=json_extract(s.source_json,'$.disclosure')
 AND NEW.translation=json_extract(s.source_json,'$.translation') AND NEW.bible_reading_url=json_extract(s.source_json,'$.bibleReadingUrl')
 AND NEW.display_revision=s.display_revision AND NEW.display_revision=coalesce((SELECT max(revision) FROM published_display_corrections WHERE quiz_set_id=q.id),0)
 AND NEW.published_at>=d.created_at AND NEW.closes_at=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.published_at,'+7 days')
) THEN RAISE(ABORT,'republication_basis_conflict') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_revision_sessions s JOIN quiz_sets q ON q.id=s.quiz_set_id
 JOIN quiz_revision_drafts d ON d.session_id=s.id AND d.revision=NEW.draft_revision
 WHERE s.id=NEW.session_id AND (SELECT count(*) FROM quiz_variants WHERE quiz_set_id=q.id AND lifecycle_status='active' AND revision=NEW.revision AND results_status='valid')=2
 AND (SELECT count(*) FROM quiz_variants WHERE quiz_set_id=q.id AND lifecycle_status='active')=2
 AND NOT EXISTS(SELECT 1 FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status='active' AND (
   v.word_count<>json_array_length(d.body_json,'$.layouts.'||v.difficulty||'.grid.entries')
   OR v.active_cell_count<>json_array_length(d.body_json,'$.layouts.'||v.difficulty||'.grid.cells')
   OR v.grid_size<>json_extract(d.body_json,'$.layouts.'||v.difficulty||'.grid.gridSize')
   OR v.word_count<>(SELECT count(*) FROM quiz_entries_public WHERE quiz_variant_id=v.id)
   OR NOT EXISTS(SELECT 1 FROM quiz_solutions sol WHERE sol.quiz_variant_id=v.id
     AND sol.solution_cells_json=json_extract(d.body_json,'$.layouts.'||v.difficulty||'.solution.cells'))
))) THEN RAISE(ABORT,'republication_rows_conflict') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_revision_sessions s JOIN quiz_sets q ON q.id=s.quiz_set_id
 JOIN quiz_revision_drafts d ON d.session_id=s.id AND d.revision=NEW.draft_revision
 WHERE s.id=NEW.session_id AND NOT EXISTS(SELECT 1 FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status='active' AND (EXISTS(SELECT 1 FROM json_each(d.body_json,'$.layouts.'||v.difficulty||'.grid.entries') e WHERE NOT EXISTS(
     SELECT 1 FROM quiz_entries_public pe JOIN quiz_solutions sol ON sol.quiz_variant_id=pe.quiz_variant_id WHERE pe.quiz_variant_id=v.id
     AND pe.id=v.id||'-e'||e.key AND pe.clue=json_extract(e.value,'$.clue') AND pe.length=json_extract(e.value,'$.length')
     AND pe.number=json_extract(e.value,'$.number') AND pe.direction=json_extract(e.value,'$.direction')
     AND pe.start_row=json_extract(e.value,'$.start.row') AND pe.start_col=json_extract(e.value,'$.start.column')
     AND json_extract(sol.entry_answers_json,'$.'||pe.id)=json_extract(d.body_json,'$.layouts.'||v.difficulty||'.solution.entries.'||json_extract(e.value,'$.id')))))))
 THEN RAISE(ABORT,'republication_conflict') END;
END;
--> statement-breakpoint
DROP TRIGGER quiz_withdrawals_no_republish;
--> statement-breakpoint
CREATE TRIGGER quiz_withdrawals_no_republish BEFORE UPDATE OF status ON quiz_sets
 WHEN NEW.status='published' AND OLD.status<>'published' AND EXISTS(SELECT 1 FROM quiz_withdrawals WHERE quiz_set_id=NEW.id) BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_republications p JOIN quiz_revision_sessions s ON s.id=p.session_id
 WHERE p.quiz_set_id=NEW.id AND p.published_at=NEW.published_at AND p.closes_at=NEW.closes_at
 AND s.cycle=(SELECT max(cycle) FROM quiz_revision_sessions WHERE quiz_set_id=NEW.id)
 AND p.draft_revision=(SELECT max(revision) FROM quiz_revision_drafts WHERE session_id=s.id)) THEN RAISE(ABORT,'withdrawn_requires_new_review') END;
END;
--> statement-breakpoint
DROP TRIGGER published_quiz_set_transition;
--> statement-breakpoint
CREATE TRIGGER published_quiz_set_transition BEFORE UPDATE OF status ON quiz_sets WHEN NEW.status='published' AND OLD.status<>'published' BEGIN
 SELECT CASE WHEN NEW.opens_at<>NEW.published_at OR NEW.closes_at<=NEW.opens_at OR NOT (
 EXISTS(SELECT 1 FROM published_quiz_content p WHERE p.quiz_set_id=NEW.id AND p.published_at=NEW.published_at)
 OR EXISTS(SELECT 1 FROM quiz_republications p WHERE p.quiz_set_id=NEW.id AND p.published_at=NEW.published_at AND p.closes_at=NEW.closes_at))
 THEN RAISE(ABORT,'published_quiz_set_incomplete') END;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_republication_apply AFTER INSERT ON quiz_republications BEGIN
 UPDATE quiz_sets SET status='published',submission_state='open',submission_paused_at=NULL,submission_pause_reason=NULL,
 published_at=NEW.published_at,opens_at=NEW.published_at,closes_at=NEW.closes_at,published_from_revision_number=NEW.revision,updated_at=NEW.published_at WHERE id=NEW.quiz_set_id;
 INSERT INTO site_state(key,value,updated_at) VALUES('featured_quiz_set_id',NEW.quiz_set_id,NEW.published_at)
 ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_revision_sessions_update BEFORE UPDATE ON quiz_revision_sessions BEGIN SELECT RAISE(ABORT,'immutable revision record'); END;
--> statement-breakpoint
CREATE TRIGGER quiz_revision_sessions_delete BEFORE DELETE ON quiz_revision_sessions BEGIN SELECT RAISE(ABORT,'immutable revision record'); END;
--> statement-breakpoint
CREATE TRIGGER quiz_republications_update BEFORE UPDATE ON quiz_republications BEGIN SELECT RAISE(ABORT,'immutable revision record'); END;
--> statement-breakpoint
CREATE TRIGGER quiz_republications_delete BEFORE DELETE ON quiz_republications BEGIN SELECT RAISE(ABORT,'immutable revision record'); END;
--> statement-breakpoint
CREATE TRIGGER quiz_revision_cleanup_update BEFORE UPDATE ON quiz_revision_cleanup BEGIN SELECT RAISE(ABORT,'immutable revision record'); END;
--> statement-breakpoint
CREATE TRIGGER quiz_revision_cleanup_delete BEFORE DELETE ON quiz_revision_cleanup BEGIN SELECT RAISE(ABORT,'immutable revision record'); END;
--> statement-breakpoint
CREATE TRIGGER quiz_revision_drafts_delete BEFORE DELETE ON quiz_revision_drafts BEGIN SELECT RAISE(ABORT,'immutable revision draft'); END;
--> statement-breakpoint
CREATE TRIGGER quiz_revision_drafts_update BEFORE UPDATE ON quiz_revision_drafts WHEN NOT (
 NEW.body_json='null' AND NEW.session_id IS OLD.session_id AND NEW.revision IS OLD.revision AND NEW.request_key IS OLD.request_key AND NEW.request_sha256 IS OLD.request_sha256 AND NEW.actor_digest IS OLD.actor_digest AND NEW.kind IS OLD.kind AND NEW.body_sha256 IS OLD.body_sha256 AND NEW.created_at IS OLD.created_at
 AND EXISTS(SELECT 1 FROM quiz_revision_cleanup WHERE session_id=OLD.session_id AND head_revision>=OLD.revision))
 BEGIN SELECT RAISE(ABORT,'immutable revision draft'); END;
--> statement-breakpoint
CREATE TRIGGER withdrawal_edits_cycle_guard BEFORE INSERT ON withdrawal_edit_revisions
 WHEN EXISTS(SELECT 1 FROM quiz_revision_sessions WHERE quiz_set_id=NEW.quiz_set_id)
 BEGIN SELECT RAISE(ABORT,'use_current_revision_cycle'); END;
--> statement-breakpoint
DROP TRIGGER published_display_insert_guard;
--> statement-breakpoint
CREATE TRIGGER published_display_insert_guard BEFORE INSERT ON published_display_corrections BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM quiz_sets q JOIN sermons s ON s.id=q.sermon_id
    LEFT JOIN published_quiz_content p ON p.quiz_set_id=q.id
    WHERE q.id=NEW.quiz_set_id AND q.status IN ('published','archived')
      AND NEW.revision=coalesce((SELECT max(c.revision) FROM published_display_corrections c WHERE c.quiz_set_id=q.id),0)+1
      AND NEW.before_title=coalesce((SELECT c.title FROM published_display_corrections c WHERE c.quiz_set_id=q.id AND c.revision>coalesce((SELECT display_revision FROM quiz_republications WHERE quiz_set_id=q.id ORDER BY revision DESC LIMIT 1),-1) ORDER BY c.revision DESC LIMIT 1),(SELECT title FROM quiz_republications WHERE quiz_set_id=q.id ORDER BY revision DESC LIMIT 1),p.title,s.sermon_title)
      AND NEW.before_sermon_date=coalesce((SELECT c.sermon_date FROM published_display_corrections c WHERE c.quiz_set_id=q.id AND c.revision>coalesce((SELECT display_revision FROM quiz_republications WHERE quiz_set_id=q.id ORDER BY revision DESC LIMIT 1),-1) ORDER BY c.revision DESC LIMIT 1),(SELECT sermon_date FROM quiz_republications WHERE quiz_set_id=q.id ORDER BY revision DESC LIMIT 1),p.sermon_date,s.sermon_date)
      AND (NEW.title<>NEW.before_title OR NEW.sermon_date<>NEW.before_sermon_date)
  ) THEN RAISE(ABORT,'display correction conflict') END;
END;


--> statement-breakpoint
CREATE VIEW quiz_revision_activity AS SELECT s.quiz_set_id,q.sermon_id,s.created_at at FROM quiz_revision_sessions s JOIN quiz_sets q ON q.id=s.quiz_set_id
 UNION ALL SELECT s.quiz_set_id,q.sermon_id,d.created_at FROM quiz_revision_drafts d JOIN quiz_revision_sessions s ON s.id=d.session_id JOIN quiz_sets q ON q.id=s.quiz_set_id
 UNION ALL SELECT p.quiz_set_id,q.sermon_id,p.published_at FROM quiz_republications p JOIN quiz_sets q ON q.id=p.quiz_set_id
 UNION ALL SELECT q.id,a.sermon_id,a.updated_at FROM draft_activity a JOIN quiz_sets q ON q.sermon_id=a.sermon_id WHERE EXISTS(SELECT 1 FROM quiz_revision_sessions WHERE quiz_set_id=q.id);
--> statement-breakpoint
CREATE TRIGGER quiz_revision_cleanup_insert BEFORE INSERT ON quiz_revision_cleanup BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_revision_sessions s JOIN quiz_sets q ON q.id=s.quiz_set_id WHERE s.id=NEW.session_id
 AND NEW.head_revision=coalesce((SELECT max(revision) FROM quiz_revision_drafts WHERE session_id=s.id),0)
 AND NEW.due_at=(SELECT strftime('%Y-%m-%dT%H:%M:%fZ',max(at),'+7 days') FROM quiz_revision_activity WHERE sermon_id=q.sermon_id)
 AND (q.status IN ('published','archived') OR q.status='review_ready' AND q.submission_state='paused')
 AND NOT EXISTS(SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id
  WHERE j.sermon_id=q.sermon_id AND r.state IN ('claimed','effect_started') AND r.lease_expires_at>NEW.purged_at)
 AND (SELECT count(*) FROM json_each(NEW.hashes_json,'$.drafts'))=(SELECT count(*) FROM quiz_revision_drafts WHERE session_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM quiz_revision_drafts d WHERE d.session_id=s.id AND
   coalesce(json_extract(NEW.hashes_json,'$.drafts.'||d.revision),'')<>d.body_sha256)
 AND (SELECT count(*) FROM json_each(NEW.hashes_json,'$.legacy'))=CASE WHEN EXISTS(SELECT 1 FROM withdrawal_edit_cleanup WHERE quiz_set_id=q.id) THEN 0
   ELSE (SELECT count(*) FROM withdrawal_edit_revisions WHERE quiz_set_id=q.id) END
 ) THEN RAISE(ABORT,'revision_cleanup_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER quiz_revision_cleanup_apply AFTER INSERT ON quiz_revision_cleanup BEGIN
 UPDATE quiz_revision_drafts SET body_json='null' WHERE session_id=NEW.session_id;
 INSERT INTO withdrawal_edit_cleanup(quiz_set_id,head_revision,last_saved_at,due_at,purged_at,payload_hashes_json)
 SELECT s.quiz_set_id,max(e.revision),max(e.created_at),strftime('%Y-%m-%dT%H:%M:%fZ',max(e.created_at),'+7 days'),NEW.purged_at,json_extract(NEW.hashes_json,'$.legacy')
 FROM quiz_revision_sessions s JOIN withdrawal_edit_revisions e ON e.quiz_set_id=s.quiz_set_id
 WHERE s.id=NEW.session_id AND NOT EXISTS(SELECT 1 FROM withdrawal_edit_cleanup WHERE quiz_set_id=s.quiz_set_id)
 GROUP BY s.quiz_set_id;
END;
--> statement-breakpoint
DROP TRIGGER withdrawal_cleanup_insert;
--> statement-breakpoint
CREATE TRIGGER withdrawal_cleanup_insert BEFORE INSERT ON withdrawal_edit_cleanup BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM quiz_sets q JOIN quiz_withdrawals w ON w.quiz_set_id=q.id
    WHERE q.id=NEW.quiz_set_id AND (q.status='review_ready' AND q.submission_state='paused' OR EXISTS(SELECT 1 FROM quiz_revision_cleanup c JOIN quiz_revision_sessions s ON s.id=c.session_id WHERE s.quiz_set_id=q.id AND c.purged_at=NEW.purged_at AND json_extract(c.hashes_json,'$.legacy')=NEW.payload_hashes_json))
      AND NEW.head_revision=(SELECT max(revision) FROM withdrawal_edit_revisions WHERE quiz_set_id=q.id)
      AND NEW.last_saved_at=(SELECT max(created_at) FROM withdrawal_edit_revisions WHERE quiz_set_id=q.id)
      AND NEW.due_at=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.last_saved_at,'+7 days')
      AND (NOT EXISTS(SELECT 1 FROM quiz_variants v WHERE v.quiz_set_id=q.id AND v.lifecycle_status!='withdrawn') OR EXISTS(SELECT 1 FROM quiz_revision_cleanup c JOIN quiz_revision_sessions s ON s.id=c.session_id WHERE s.quiz_set_id=q.id AND c.purged_at=NEW.purged_at AND json_extract(c.hashes_json,'$.legacy')=NEW.payload_hashes_json))
      AND (NOT EXISTS(SELECT 1 FROM submissions s JOIN quiz_variants v ON v.id=s.quiz_variant_id WHERE v.quiz_set_id=q.id) OR EXISTS(SELECT 1 FROM quiz_revision_cleanup c JOIN quiz_revision_sessions s ON s.id=c.session_id WHERE s.quiz_set_id=q.id AND c.purged_at=NEW.purged_at AND json_extract(c.hashes_json,'$.legacy')=NEW.payload_hashes_json))
      AND NOT EXISTS(SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id
        WHERE j.sermon_id=q.sermon_id AND r.state IN ('claimed','effect_started') AND r.lease_expires_at>NEW.purged_at)
      AND (SELECT count(*) FROM json_each(NEW.payload_hashes_json))=(SELECT count(*) FROM withdrawal_edit_revisions WHERE quiz_set_id=q.id)
      AND NOT EXISTS(SELECT 1 FROM withdrawal_edit_revisions e WHERE e.quiz_set_id=q.id AND NOT EXISTS(
        SELECT 1 FROM json_each(NEW.payload_hashes_json) h WHERE h.key=cast(e.revision AS text)
          AND h.type='text' AND length(h.value)=64 AND h.value NOT GLOB '*[^0-9a-f]*'))
  ) THEN RAISE(ABORT,'withdrawal_cleanup_conflict') END;
END;

