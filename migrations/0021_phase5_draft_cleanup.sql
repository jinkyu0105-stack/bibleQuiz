CREATE TABLE `draft_activity` (
	`sermon_id` text PRIMARY KEY NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `draft_cleanup_records` (
	`sermon_id` text PRIMARY KEY NOT NULL,
	`purged_at` text NOT NULL,
	`due_at` text NOT NULL,
	`input_version` integer NOT NULL,
	`content_count` integer NOT NULL,
	`history_version` integer NOT NULL,
	`metadata_revision` integer NOT NULL,
	`basis_fingerprint` text NOT NULL,
	`source_metadata_json` text NOT NULL,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "draft_cleanup_time_check" CHECK("draft_cleanup_records"."purged_at" >= "draft_cleanup_records"."due_at"),
	CONSTRAINT "draft_cleanup_versions_check" CHECK("draft_cleanup_records"."input_version" >= 0 and "draft_cleanup_records"."content_count" >= 0 and "draft_cleanup_records"."history_version" >= 0 and "draft_cleanup_records"."metadata_revision" >= 0),
	CONSTRAINT "draft_cleanup_hash_check" CHECK(length("draft_cleanup_records"."basis_fingerprint") = 64 and "draft_cleanup_records"."basis_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "draft_cleanup_sources_check" CHECK(json_valid("draft_cleanup_records"."source_metadata_json"))
);

--> statement-breakpoint
CREATE TRIGGER draft_cleanup_insert_guard BEFORE INSERT ON draft_cleanup_records BEGIN
 SELECT CASE WHEN NEW.input_version <> coalesce((SELECT version FROM sermon_input_heads WHERE sermon_id=NEW.sermon_id),0)
 OR NEW.content_count <> coalesce((SELECT event_count FROM sermon_content_heads WHERE sermon_id=NEW.sermon_id),0)
 OR NEW.history_version <> coalesce((SELECT version FROM sermon_history_heads WHERE sermon_id=NEW.sermon_id),0)
 OR NEW.metadata_revision <> coalesce((SELECT metadata_revision FROM sermon_metadata_drafts WHERE sermon_id=NEW.sermon_id),0)
 OR EXISTS (SELECT 1 FROM generation_step_receipts r JOIN generation_jobs j ON j.id=r.generation_job_id
   WHERE j.sermon_id=NEW.sermon_id AND r.state IN ('claimed','effect_started') AND r.lease_expires_at>NEW.purged_at)
 THEN RAISE(ABORT,'draft cleanup basis changed') END;
END;
--> statement-breakpoint
CREATE TRIGGER draft_cleanup_no_update BEFORE UPDATE ON draft_cleanup_records BEGIN SELECT RAISE(ABORT,'immutable cleanup record'); END;
--> statement-breakpoint
CREATE TRIGGER draft_cleanup_no_delete BEFORE DELETE ON draft_cleanup_records BEGIN SELECT RAISE(ABORT,'immutable cleanup record'); END;
--> statement-breakpoint
DROP TRIGGER input_chunk_delete;
--> statement-breakpoint
CREATE TRIGGER input_chunk_delete BEFORE DELETE ON sermon_input_chunks WHEN NOT EXISTS (SELECT 1 FROM draft_cleanup_records p WHERE p.sermon_id=OLD.sermon_id AND EXISTS (SELECT 1 FROM json_each(p.source_metadata_json,'$.purgeInputIds') WHERE value=OLD.event_id)) BEGIN SELECT RAISE(ABORT,'immutable draft payload'); END;
--> statement-breakpoint
DROP TRIGGER history_chunks_no_delete;
--> statement-breakpoint
CREATE TRIGGER history_chunks_no_delete BEFORE DELETE ON sermon_history_chunks WHEN NOT EXISTS (SELECT 1 FROM draft_cleanup_records p WHERE p.sermon_id=OLD.sermon_id AND EXISTS (SELECT 1 FROM json_each(p.source_metadata_json,'$.purgeHistoryIds') WHERE value=OLD.record_id)) BEGIN SELECT RAISE(ABORT,'immutable draft payload'); END;
--> statement-breakpoint
DROP TRIGGER sermon_content_chunk_delete_guard;
--> statement-breakpoint
CREATE TRIGGER sermon_content_chunk_delete_guard BEFORE DELETE ON sermon_content_chunks WHEN NOT EXISTS (SELECT 1 FROM draft_cleanup_records p WHERE p.sermon_id=OLD.sermon_id) BEGIN SELECT RAISE(ABORT,'immutable draft payload'); END;
--> statement-breakpoint
DROP TRIGGER generation_context_chunks_no_delete;
--> statement-breakpoint
CREATE TRIGGER generation_context_chunks_no_delete BEFORE DELETE ON generation_context_chunks WHEN NOT EXISTS (SELECT 1 FROM draft_cleanup_records p WHERE p.sermon_id=(SELECT sermon_id FROM generation_contexts WHERE id=OLD.context_id)) BEGIN SELECT RAISE(ABORT,'immutable draft payload'); END;
--> statement-breakpoint
DROP TRIGGER final_check_ticket_chunk_delete_guard;
--> statement-breakpoint
CREATE TRIGGER final_check_ticket_chunk_delete_guard BEFORE DELETE ON final_check_ticket_chunks WHEN NOT EXISTS (SELECT 1 FROM draft_cleanup_records p WHERE p.sermon_id=(SELECT sermon_id FROM final_check_tickets WHERE id=OLD.ticket_id)) BEGIN SELECT RAISE(ABORT,'immutable draft payload'); END;
--> statement-breakpoint
DROP TRIGGER ai_final_audit_chunk_delete_guard;
--> statement-breakpoint
CREATE TRIGGER ai_final_audit_chunk_delete_guard BEFORE DELETE ON ai_final_audit_chunks WHEN NOT EXISTS (SELECT 1 FROM draft_cleanup_records p WHERE p.sermon_id=(SELECT j.sermon_id FROM generation_jobs j JOIN ai_final_audit_results a ON a.generation_job_id=j.id WHERE a.id=OLD.audit_result_id)) BEGIN SELECT RAISE(ABORT,'immutable draft payload'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_sermon_input_events BEFORE INSERT ON sermon_input_events WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_sermon_content_events BEFORE INSERT ON sermon_content_events WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_sermon_history_commits BEFORE INSERT ON sermon_history_commits WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_generation_jobs BEFORE INSERT ON generation_jobs WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_generation_contexts BEFORE INSERT ON generation_contexts WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_final_check_tickets BEFORE INSERT ON final_check_tickets WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_sermon_input_chunks BEFORE INSERT ON sermon_input_chunks WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_sermon_content_chunks BEFORE INSERT ON sermon_content_chunks WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_sermon_history_chunks BEFORE INSERT ON sermon_history_chunks WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_generation_context_chunks BEFORE INSERT ON generation_context_chunks WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=(SELECT sermon_id FROM generation_contexts WHERE id=NEW.context_id)) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_final_check_ticket_chunks BEFORE INSERT ON final_check_ticket_chunks WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=(SELECT sermon_id FROM final_check_tickets WHERE id=NEW.ticket_id)) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_ai_final_audit_chunks BEFORE INSERT ON ai_final_audit_chunks WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=(SELECT j.sermon_id FROM generation_jobs j JOIN ai_final_audit_results a ON a.generation_job_id=j.id WHERE a.id=NEW.audit_result_id)) BEGIN SELECT RAISE(ABORT,'draft expired'); END;
--> statement-breakpoint
CREATE TRIGGER cleanup_stop_ai_provider_calls BEFORE INSERT ON ai_provider_calls WHEN EXISTS (SELECT 1 FROM draft_cleanup_records WHERE sermon_id=NEW.sermon_id) BEGIN SELECT RAISE(ABORT,'draft expired'); END;

--> statement-breakpoint
CREATE TRIGGER cleanup_activity_sermon_metadata_drafts_insert AFTER INSERT ON sermon_metadata_drafts BEGIN
 INSERT INTO draft_activity(sermon_id,updated_at) VALUES(NEW.sermon_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(sermon_id) DO UPDATE SET updated_at=excluded.updated_at;
END;

--> statement-breakpoint
CREATE TRIGGER cleanup_activity_sermon_metadata_drafts_update AFTER UPDATE ON sermon_metadata_drafts BEGIN
 INSERT INTO draft_activity(sermon_id,updated_at) VALUES(NEW.sermon_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(sermon_id) DO UPDATE SET updated_at=excluded.updated_at;
END;

