CREATE TABLE `sermon_input_chunks` (
	`sermon_id` text NOT NULL,
	`event_id` text NOT NULL,
	`position` integer NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`sermon_id`, `event_id`, `position`),
	FOREIGN KEY (`sermon_id`,`event_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "input_chunks_position_check" CHECK(typeof(position) = 'integer' and position between 0 and 4095),
	CONSTRAINT "input_chunks_body_check" CHECK(typeof(body) = 'text' and length(cast(body as blob)) between 1 and 65536)
);
--> statement-breakpoint
CREATE TABLE `sermon_input_events` (
	`sermon_id` text NOT NULL,
	`version` integer NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`document_id` text NOT NULL,
	`confirmation_id` text,
	`parent_document_id` text,
	`related_id` text,
	`document_sha256` text NOT NULL,
	`payload_sha256` text NOT NULL,
	`chunk_count` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`state` text NOT NULL,
	`required_state` text DEFAULT 'sealed' NOT NULL,
	PRIMARY KEY(`sermon_id`, `version`),
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`version`,`required_state`) REFERENCES `sermon_input_events`(`sermon_id`,`version`,`state`) ON UPDATE no action ON DELETE no action DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`source_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sermon_id`,`document_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sermon_id`,`confirmation_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sermon_id`,`parent_document_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sermon_id`,`related_id`) REFERENCES `sermon_input_events`(`sermon_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "input_events_version_check" CHECK(typeof(version) = 'integer' and version between 1 and 9007199254740991),
	CONSTRAINT "input_events_kind_check" CHECK(kind in ('source','edit','restore','confirm','proposal','decision','merge')),
	CONSTRAINT "input_events_source_type_check" CHECK(source_type in ('caption_plain','caption_timed','sermon_manuscript','sermon_summary')),
	CONSTRAINT "input_events_state_check" CHECK(state in ('pending','sealed') and required_state = 'sealed'),
	CONSTRAINT "input_events_size_check" CHECK(typeof(chunk_count) = 'integer' and chunk_count between 1 and 4096 and typeof(byte_length) = 'integer' and byte_length between 1 and 67108864),
	CONSTRAINT "input_events_hash_check" CHECK(length(document_sha256) = 64 and document_sha256 not glob '*[^0-9a-f]*' and length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `input_events_id_uidx` ON `sermon_input_events` (`sermon_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `input_events_seal_uidx` ON `sermon_input_events` (`sermon_id`,`version`,`state`);--> statement-breakpoint
CREATE INDEX `input_events_related_idx` ON `sermon_input_events` (`sermon_id`,`related_id`,`kind`,`version`);--> statement-breakpoint
CREATE TABLE `sermon_input_heads` (
	`sermon_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	FOREIGN KEY (`sermon_id`,`version`) REFERENCES `sermon_input_events`(`sermon_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Reviewed additions: a missing final seal must roll back the entire D1 batch.
CREATE TRIGGER input_event_claim BEFORE INSERT ON sermon_input_events BEGIN
  SELECT CASE WHEN NEW.state <> 'pending'
    OR NEW.version <> coalesce((SELECT version FROM sermon_input_heads WHERE sermon_id = NEW.sermon_id), 0) + 1
    OR EXISTS (SELECT 1 FROM sermon_history_heads WHERE sermon_id = NEW.sermon_id)
    OR (NEW.version = 1 AND NEW.kind <> 'source')
    THEN RAISE(ABORT, 'input claim rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER input_legacy_exclusive BEFORE INSERT ON sermon_history_heads BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM sermon_input_heads WHERE sermon_id = NEW.sermon_id)
    THEN RAISE(ABORT, 'input path already selected') END;
END;
--> statement-breakpoint
CREATE TRIGGER input_head_insert BEFORE INSERT ON sermon_input_heads BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sermon_input_events e
    WHERE e.sermon_id = NEW.sermon_id AND e.version = NEW.version AND e.state = 'pending')
    THEN RAISE(ABORT, 'input head rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER input_head_update BEFORE UPDATE ON sermon_input_heads BEGIN
  SELECT CASE WHEN NEW.sermon_id <> OLD.sermon_id OR NEW.version <> OLD.version + 1
    OR NOT EXISTS (SELECT 1 FROM sermon_input_events e WHERE e.sermon_id = NEW.sermon_id
      AND e.version = NEW.version AND e.state = 'pending')
    THEN RAISE(ABORT, 'input head rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER input_event_seal BEFORE UPDATE ON sermon_input_events BEGIN
  SELECT CASE WHEN OLD.state <> 'pending' OR NEW.state <> 'sealed'
    OR NEW.sermon_id IS NOT OLD.sermon_id OR NEW.version IS NOT OLD.version OR NEW.id IS NOT OLD.id
    OR NEW.kind IS NOT OLD.kind OR NEW.source_id IS NOT OLD.source_id OR NEW.document_id IS NOT OLD.document_id
    OR NEW.source_type IS NOT OLD.source_type
    OR NEW.confirmation_id IS NOT OLD.confirmation_id OR NEW.parent_document_id IS NOT OLD.parent_document_id
    OR NEW.related_id IS NOT OLD.related_id OR NEW.document_sha256 IS NOT OLD.document_sha256
    OR NEW.payload_sha256 IS NOT OLD.payload_sha256 OR NEW.chunk_count IS NOT OLD.chunk_count
    OR NEW.byte_length IS NOT OLD.byte_length OR NEW.actor_id IS NOT OLD.actor_id
    OR NEW.created_at IS NOT OLD.created_at OR NEW.required_state IS NOT OLD.required_state
    OR NOT EXISTS (SELECT 1 FROM sermon_input_heads h WHERE h.sermon_id = NEW.sermon_id AND h.version = NEW.version)
    OR (SELECT count(*) FROM sermon_input_chunks c WHERE c.sermon_id = NEW.sermon_id AND c.event_id = NEW.id) <> NEW.chunk_count
    OR (SELECT coalesce(sum(length(cast(body AS blob))),0) FROM sermon_input_chunks c WHERE c.sermon_id = NEW.sermon_id AND c.event_id = NEW.id) <> NEW.byte_length
    OR NOT EXISTS (SELECT 1 FROM sermon_input_events s WHERE s.sermon_id = NEW.sermon_id AND s.id = NEW.source_id AND s.kind = 'source' AND s.source_type = NEW.source_type)
    OR (NEW.kind NOT IN ('source','confirm') AND NEW.source_type IN ('sermon_manuscript','sermon_summary'))
    OR NOT EXISTS (SELECT 1 FROM sermon_input_events d WHERE d.sermon_id = NEW.sermon_id AND d.id = NEW.document_id
      AND d.source_id = NEW.source_id AND d.kind IN ('source','edit','restore','merge') AND d.document_sha256 = NEW.document_sha256)
    OR (NEW.confirmation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_input_events c WHERE c.sermon_id = NEW.sermon_id
      AND c.id = NEW.confirmation_id AND c.kind = 'confirm' AND c.document_id = NEW.document_id AND c.source_id = NEW.source_id))
    OR (NEW.kind = 'source' AND (NEW.source_id <> NEW.id OR NEW.document_id <> NEW.id OR NEW.confirmation_id IS NOT NULL OR NEW.parent_document_id IS NOT NULL OR NEW.related_id IS NOT NULL))
    OR (NEW.kind <> 'source' AND NOT EXISTS (SELECT 1 FROM sermon_input_events p WHERE p.sermon_id = NEW.sermon_id
      AND p.version = NEW.version - 1 AND p.state = 'sealed' AND p.source_id = NEW.source_id
      AND p.document_id = NEW.parent_document_id))
    OR (NEW.kind IN ('edit','restore','merge') AND (NEW.document_id <> NEW.id OR NEW.confirmation_id IS NOT NULL))
    OR (NEW.kind IN ('confirm','proposal','decision') AND NEW.document_id <> NEW.parent_document_id)
    OR (NEW.kind = 'confirm' AND NEW.confirmation_id IS NOT NEW.id)
    OR (NEW.kind IN ('proposal','decision') AND NEW.confirmation_id IS NOT (SELECT p.confirmation_id FROM sermon_input_events p WHERE p.sermon_id = NEW.sermon_id AND p.version = NEW.version - 1))
    OR (NEW.kind = 'restore' AND NOT EXISTS (SELECT 1 FROM sermon_input_events r WHERE r.sermon_id = NEW.sermon_id
      AND r.id = NEW.related_id AND r.source_id = NEW.source_id AND r.kind IN ('source','edit','restore','merge') AND r.document_sha256 = NEW.document_sha256))
    OR (NEW.kind IN ('decision','merge') AND NOT EXISTS (SELECT 1 FROM sermon_input_events p WHERE p.sermon_id = NEW.sermon_id
      AND p.id = NEW.related_id AND p.kind = 'proposal' AND p.source_id = NEW.source_id AND p.document_id = NEW.parent_document_id))
    THEN RAISE(ABORT, 'input seal rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER input_chunk_insert BEFORE INSERT ON sermon_input_chunks BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sermon_input_events e WHERE e.sermon_id = NEW.sermon_id
    AND e.id = NEW.event_id AND e.state = 'pending' AND NEW.position < e.chunk_count)
    THEN RAISE(ABORT, 'input chunk rejected') END;
END;
--> statement-breakpoint
CREATE TRIGGER input_chunk_update BEFORE UPDATE ON sermon_input_chunks BEGIN SELECT RAISE(ABORT, 'immutable input'); END;
--> statement-breakpoint
CREATE TRIGGER input_chunk_delete BEFORE DELETE ON sermon_input_chunks BEGIN SELECT RAISE(ABORT, 'immutable input'); END;
--> statement-breakpoint
CREATE TRIGGER input_event_delete BEFORE DELETE ON sermon_input_events BEGIN SELECT RAISE(ABORT, 'immutable input'); END;
--> statement-breakpoint
CREATE TRIGGER input_head_delete BEFORE DELETE ON sermon_input_heads BEGIN SELECT RAISE(ABORT, 'immutable input'); END;
