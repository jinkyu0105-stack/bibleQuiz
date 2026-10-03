CREATE TABLE `sermon_history_chunks` (
	`sermon_id` text NOT NULL,
	`record_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`chunk_sha256` text NOT NULL,
	`body` blob NOT NULL,
	`verified` integer NOT NULL,
	PRIMARY KEY(`sermon_id`, `record_id`, `chunk_index`),
	FOREIGN KEY (`sermon_id`,`record_id`) REFERENCES `sermon_history_payloads`(`sermon_id`,`record_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "history_chunks_sermon_id_check" CHECK(length(sermon_id) between 1 and 128),
	CONSTRAINT "history_chunks_record_id_check" CHECK(length(record_id) between 1 and 128),
	CONSTRAINT "history_chunks_chunk_index_check" CHECK((typeof(chunk_index) = 'integer' and chunk_index between 0 and 9007199254740991)),
	CONSTRAINT "history_chunks_byte_length_check" CHECK((typeof(byte_length) = 'integer' and byte_length between 1 and 9007199254740991)),
	CONSTRAINT "history_chunks_chunk_sha256_check" CHECK(length(chunk_sha256) between 1 and 128),
	CONSTRAINT "history_chunks_verified_check" CHECK((typeof(verified) = 'integer' and verified between 0 and 1)),
	CONSTRAINT "history_chunks_sha256_check" CHECK(length(chunk_sha256) = 64 and chunk_sha256 not glob '*[^0-9a-f]*'),
	CONSTRAINT "history_chunks_body_check" CHECK(typeof(body) = 'blob' and byte_length = length(body) and byte_length between 1 and 65536)
);
--> statement-breakpoint
CREATE TABLE `sermon_history_commits` (
	`sermon_id` text NOT NULL,
	`version` integer NOT NULL,
	`commit_id` text NOT NULL,
	`current_source_id` text NOT NULL,
	`current_revision_id` text NOT NULL,
	`current_confirmation_id` text,
	`attempt_id` text NOT NULL,
	`previous_version` integer,
	`previous_commit_id` text,
	`state` text NOT NULL,
	`required_seal_state` text DEFAULT 'sealed' NOT NULL,
	`command` text NOT NULL,
	`sources_count` integer NOT NULL,
	`revisions_count` integer NOT NULL,
	`confirmations_count` integer NOT NULL,
	`correctionProposals_count` integer NOT NULL,
	`correctionDecisions_count` integer NOT NULL,
	`intentEvents_count` integer NOT NULL,
	`summaryEvents_count` integer NOT NULL,
	`candidateEvents_count` integer NOT NULL,
	`record_count` integer NOT NULL,
	`reference_count` integer NOT NULL,
	`manifest_count` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`byte_length` integer NOT NULL,
	PRIMARY KEY(`sermon_id`, `version`),
	FOREIGN KEY (`sermon_id`,`version`,`required_seal_state`) REFERENCES `sermon_history_commits`(`sermon_id`,`version`,`state`) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`current_source_id`) REFERENCES `sermon_history_records`(`sermon_id`,`record_id`) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`current_revision_id`) REFERENCES `sermon_history_records`(`sermon_id`,`record_id`) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`current_confirmation_id`) REFERENCES `sermon_history_records`(`sermon_id`,`record_id`) ON UPDATE no action ON DELETE restrict DEFERRABLE INITIALLY DEFERRED,
	FOREIGN KEY (`sermon_id`,`previous_version`,`previous_commit_id`) REFERENCES `sermon_history_commits`(`sermon_id`,`version`,`commit_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "history_commits_required_seal_check" CHECK(required_seal_state = 'sealed'),
	CONSTRAINT "history_commits_sermon_id_check" CHECK(length(sermon_id) between 1 and 128),
	CONSTRAINT "history_commits_version_check" CHECK((typeof(version) = 'integer' and version between 1 and 9007199254740991)),
	CONSTRAINT "history_commits_commit_id_check" CHECK(length(commit_id) between 1 and 128),
	CONSTRAINT "history_commits_current_source_id_check" CHECK(length(current_source_id) between 1 and 128),
	CONSTRAINT "history_commits_current_revision_id_check" CHECK(length(current_revision_id) between 1 and 128),
	CONSTRAINT "history_commits_current_confirmation_id_check" CHECK(current_confirmation_id is null or length(current_confirmation_id) between 1 and 128),
	CONSTRAINT "history_commits_attempt_id_check" CHECK(length(attempt_id) between 1 and 128),
	CONSTRAINT "history_commits_previous_version_check" CHECK(previous_version is null or (typeof(previous_version) = 'integer' and previous_version between 1 and 9007199254740991)),
	CONSTRAINT "history_commits_previous_commit_id_check" CHECK(previous_commit_id is null or length(previous_commit_id) between 1 and 128),
	CONSTRAINT "history_commits_state_check" CHECK(length(state) between 1 and 128),
	CONSTRAINT "history_commits_command_check" CHECK(length(command) between 1 and 128),
	CONSTRAINT "history_commits_sources_count_check" CHECK((typeof(sources_count) = 'integer' and sources_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_revisions_count_check" CHECK((typeof(revisions_count) = 'integer' and revisions_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_confirmations_count_check" CHECK((typeof(confirmations_count) = 'integer' and confirmations_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_correctionProposals_count_check" CHECK((typeof(correctionProposals_count) = 'integer' and correctionProposals_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_correctionDecisions_count_check" CHECK((typeof(correctionDecisions_count) = 'integer' and correctionDecisions_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_intentEvents_count_check" CHECK((typeof(intentEvents_count) = 'integer' and intentEvents_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_summaryEvents_count_check" CHECK((typeof(summaryEvents_count) = 'integer' and summaryEvents_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_candidateEvents_count_check" CHECK((typeof(candidateEvents_count) = 'integer' and candidateEvents_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_record_count_check" CHECK((typeof(record_count) = 'integer' and record_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_reference_count_check" CHECK((typeof(reference_count) = 'integer' and reference_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_manifest_count_check" CHECK((typeof(manifest_count) = 'integer' and manifest_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_chunk_count_check" CHECK((typeof(chunk_count) = 'integer' and chunk_count between 0 and 9007199254740991)),
	CONSTRAINT "history_commits_byte_length_check" CHECK((typeof(byte_length) = 'integer' and byte_length between 1 and 9007199254740991)),
	CONSTRAINT "history_commits_state_enum_check" CHECK(state in ('assembling', 'sealed')),
	CONSTRAINT "history_commits_previous_check" CHECK((version = 1 and previous_version is null and previous_commit_id is null and command = 'import') or (version > 1 and previous_version is not null and previous_version = version - 1 and previous_commit_id is not null)),
	CONSTRAINT "history_commits_command_enum_check" CHECK(command in ('import', 'revisions', 'confirmations', 'correctionProposals', 'correctionDecisions', 'intentEvents', 'summaryEvents', 'candidateEvents'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_commits_sealed_state_uidx` ON `sermon_history_commits` (`sermon_id`,`version`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `history_commits_id_uidx` ON `sermon_history_commits` (`sermon_id`,`commit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `history_commits_version_id_uidx` ON `sermon_history_commits` (`sermon_id`,`version`,`commit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `history_commits_attempt_uidx` ON `sermon_history_commits` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `sermon_history_heads` (
	`sermon_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`commit_id` text NOT NULL,
	`current_source_id` text NOT NULL,
	`current_revision_id` text NOT NULL,
	`current_confirmation_id` text,
	`storage_format_version` integer NOT NULL,
	`contract_version` integer NOT NULL,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`current_source_id`) REFERENCES `sermon_history_records`(`sermon_id`,`record_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`current_revision_id`) REFERENCES `sermon_history_records`(`sermon_id`,`record_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`current_confirmation_id`) REFERENCES `sermon_history_records`(`sermon_id`,`record_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`version`,`commit_id`) REFERENCES `sermon_history_commits`(`sermon_id`,`version`,`commit_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "history_heads_sermon_id_check" CHECK(length(sermon_id) between 1 and 128),
	CONSTRAINT "history_heads_version_check" CHECK((typeof(version) = 'integer' and version between 1 and 9007199254740991)),
	CONSTRAINT "history_heads_commit_id_check" CHECK(length(commit_id) between 1 and 128),
	CONSTRAINT "history_heads_current_source_id_check" CHECK(length(current_source_id) between 1 and 128),
	CONSTRAINT "history_heads_current_revision_id_check" CHECK(length(current_revision_id) between 1 and 128),
	CONSTRAINT "history_heads_current_confirmation_id_check" CHECK(current_confirmation_id is null or length(current_confirmation_id) between 1 and 128),
	CONSTRAINT "history_heads_storage_format_version_check" CHECK((typeof(storage_format_version) = 'integer' and storage_format_version between 1 and 9007199254740991)),
	CONSTRAINT "history_heads_contract_version_check" CHECK((typeof(contract_version) = 'integer' and contract_version between 1 and 9007199254740991)),
	CONSTRAINT "history_heads_format_check" CHECK(storage_format_version = 1 and contract_version = 1)
);
--> statement-breakpoint
CREATE TABLE `sermon_history_payloads` (
	`sermon_id` text NOT NULL,
	`record_id` text NOT NULL,
	`codec` text NOT NULL,
	`chunk_bytes` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`payload_sha256` text NOT NULL,
	`verified` integer NOT NULL,
	PRIMARY KEY(`sermon_id`, `record_id`),
	FOREIGN KEY (`sermon_id`,`record_id`) REFERENCES `sermon_history_records`(`sermon_id`,`record_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "history_payloads_sermon_id_check" CHECK(length(sermon_id) between 1 and 128),
	CONSTRAINT "history_payloads_record_id_check" CHECK(length(record_id) between 1 and 128),
	CONSTRAINT "history_payloads_codec_check" CHECK(length(codec) between 1 and 128),
	CONSTRAINT "history_payloads_chunk_bytes_check" CHECK((typeof(chunk_bytes) = 'integer' and chunk_bytes between 1 and 9007199254740991)),
	CONSTRAINT "history_payloads_chunk_count_check" CHECK((typeof(chunk_count) = 'integer' and chunk_count between 0 and 9007199254740991)),
	CONSTRAINT "history_payloads_byte_length_check" CHECK((typeof(byte_length) = 'integer' and byte_length between 1 and 9007199254740991)),
	CONSTRAINT "history_payloads_payload_sha256_check" CHECK(length(payload_sha256) between 1 and 128),
	CONSTRAINT "history_payloads_verified_check" CHECK((typeof(verified) = 'integer' and verified between 0 and 1)),
	CONSTRAINT "history_payloads_codec_enum_check" CHECK(codec = 'record-json-utf8-v1' and chunk_bytes = 65536 and chunk_count = (byte_length - 1) / 65536 + 1),
	CONSTRAINT "history_payloads_sha256_check" CHECK(length(payload_sha256) = 64 and payload_sha256 not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `sermon_history_records` (
	`sermon_id` text NOT NULL,
	`record_id` text NOT NULL,
	`stream` text NOT NULL,
	`stream_position` integer NOT NULL,
	`commit_version` integer NOT NULL,
	`commit_slot` integer NOT NULL,
	`source_revision` integer,
	`difficulty` text,
	`verified` integer NOT NULL,
	PRIMARY KEY(`sermon_id`, `record_id`),
	FOREIGN KEY (`sermon_id`,`commit_version`) REFERENCES `sermon_history_commits`(`sermon_id`,`version`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "history_records_sermon_id_check" CHECK(length(sermon_id) between 1 and 128),
	CONSTRAINT "history_records_record_id_check" CHECK(length(record_id) between 1 and 128),
	CONSTRAINT "history_records_stream_check" CHECK(length(stream) between 1 and 128),
	CONSTRAINT "history_records_stream_position_check" CHECK((typeof(stream_position) = 'integer' and stream_position between 1 and 9007199254740991)),
	CONSTRAINT "history_records_commit_version_check" CHECK((typeof(commit_version) = 'integer' and commit_version between 1 and 9007199254740991)),
	CONSTRAINT "history_records_commit_slot_check" CHECK((typeof(commit_slot) = 'integer' and commit_slot between 0 and 9007199254740991)),
	CONSTRAINT "history_records_source_revision_check" CHECK(source_revision is null or (typeof(source_revision) = 'integer' and source_revision between 1 and 9007199254740991)),
	CONSTRAINT "history_records_difficulty_check" CHECK(difficulty is null or length(difficulty) between 1 and 128),
	CONSTRAINT "history_records_verified_check" CHECK((typeof(verified) = 'integer' and verified between 0 and 1)),
	CONSTRAINT "history_records_stream_enum_check" CHECK(stream in ('sources', 'revisions', 'confirmations', 'correctionProposals', 'correctionDecisions', 'intentEvents', 'summaryEvents', 'candidateEvents')),
	CONSTRAINT "history_records_projection_check" CHECK((stream = 'sources' and source_revision is not null and source_revision = stream_position) or (stream <> 'sources' and source_revision is null)),
	CONSTRAINT "history_records_difficulty_enum_check" CHECK((stream = 'candidateEvents' and difficulty is not null and difficulty in ('child','adult')) or (stream <> 'candidateEvents' and difficulty is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `history_records_stream_position_uidx` ON `sermon_history_records` (`sermon_id`,`stream`,`stream_position`);--> statement-breakpoint
CREATE UNIQUE INDEX `history_records_commit_slot_uidx` ON `sermon_history_records` (`sermon_id`,`commit_version`,`commit_slot`);--> statement-breakpoint
CREATE UNIQUE INDEX `history_records_source_revision_uidx` ON `sermon_history_records` (`sermon_id`,`source_revision`);--> statement-breakpoint
CREATE TABLE `sermon_history_references` (
	`sermon_id` text NOT NULL,
	`owner_record_id` text NOT NULL,
	`reference_position` integer NOT NULL,
	`relation` text NOT NULL,
	`target_record_id` text NOT NULL,
	`target_stream` text NOT NULL,
	`target_member_id` text,
	`payload_path` text NOT NULL,
	`verified` integer NOT NULL,
	PRIMARY KEY(`sermon_id`, `owner_record_id`, `reference_position`),
	FOREIGN KEY (`sermon_id`,`owner_record_id`) REFERENCES `sermon_history_records`(`sermon_id`,`record_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sermon_id`,`target_record_id`) REFERENCES `sermon_history_records`(`sermon_id`,`record_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "history_references_sermon_id_check" CHECK(length(sermon_id) between 1 and 128),
	CONSTRAINT "history_references_owner_record_id_check" CHECK(length(owner_record_id) between 1 and 128),
	CONSTRAINT "history_references_reference_position_check" CHECK((typeof(reference_position) = 'integer' and reference_position between 1 and 9007199254740991)),
	CONSTRAINT "history_references_relation_check" CHECK(length(relation) between 1 and 128),
	CONSTRAINT "history_references_target_record_id_check" CHECK(length(target_record_id) between 1 and 128),
	CONSTRAINT "history_references_target_stream_check" CHECK(length(target_stream) between 1 and 128),
	CONSTRAINT "history_references_target_member_id_check" CHECK(target_member_id is null or length(target_member_id) between 1 and 128),
	CONSTRAINT "history_references_payload_path_check" CHECK(length(payload_path) between 1 and 512),
	CONSTRAINT "history_references_verified_check" CHECK((typeof(verified) = 'integer' and verified between 0 and 1)),
	CONSTRAINT "history_references_target_stream_enum_check" CHECK(target_stream in ('sources', 'revisions', 'confirmations', 'correctionProposals', 'correctionDecisions', 'intentEvents', 'summaryEvents', 'candidateEvents'))
);
--> statement-breakpoint
CREATE INDEX `history_references_target_idx` ON `sermon_history_references` (`sermon_id`,`target_record_id`);
--> statement-breakpoint
-- Hand-reviewed cross-row guards; Drizzle snapshots do not represent triggers.
CREATE TRIGGER history_heads_no_delete BEFORE DELETE ON sermon_history_heads BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE 1;
END;
--> statement-breakpoint
CREATE TRIGGER history_commits_no_delete BEFORE DELETE ON sermon_history_commits BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE 1;
END;
--> statement-breakpoint
CREATE TRIGGER history_records_no_delete BEFORE DELETE ON sermon_history_records BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE 1;
END;
--> statement-breakpoint
CREATE TRIGGER history_records_insert BEFORE INSERT ON sermon_history_records BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND (r.record_id=NEW.record_id OR (r.stream=NEW.stream AND r.stream_position=NEW.stream_position) OR (r.commit_version=NEW.commit_version AND r.commit_slot=NEW.commit_slot) OR r.source_revision=NEW.source_revision));
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.verified <> 0 OR NOT EXISTS (SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id = NEW.sermon_id AND c.version = NEW.commit_version AND c.state = 'assembling');
END;
--> statement-breakpoint
CREATE TRIGGER history_records_immutable BEFORE UPDATE ON sermon_history_records BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NOT (OLD.verified=0 AND NEW.verified=1 AND NEW.sermon_id IS OLD.sermon_id AND NEW.record_id IS OLD.record_id AND NEW.stream IS OLD.stream AND NEW.stream_position IS OLD.stream_position AND NEW.commit_version IS OLD.commit_version AND NEW.commit_slot IS OLD.commit_slot AND NEW.source_revision IS OLD.source_revision AND NEW.difficulty IS OLD.difficulty) OR NOT EXISTS (SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id = OLD.sermon_id AND c.version = OLD.commit_version AND c.state = 'assembling');
END;
--> statement-breakpoint
CREATE TRIGGER history_references_no_delete BEFORE DELETE ON sermon_history_references BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE 1;
END;
--> statement-breakpoint
CREATE TRIGGER history_references_insert BEFORE INSERT ON sermon_history_references BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_references r WHERE r.sermon_id=NEW.sermon_id AND r.owner_record_id=NEW.owner_record_id AND r.reference_position=NEW.reference_position);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.verified <> 0 OR NOT EXISTS (SELECT 1 FROM sermon_history_records r JOIN sermon_history_commits c ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE r.sermon_id=NEW.sermon_id AND r.record_id=NEW.owner_record_id AND c.state='assembling');
END;
--> statement-breakpoint
CREATE TRIGGER history_references_immutable BEFORE UPDATE ON sermon_history_references BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NOT (OLD.verified=0 AND NEW.verified=1 AND NEW.sermon_id IS OLD.sermon_id AND NEW.owner_record_id IS OLD.owner_record_id AND NEW.reference_position IS OLD.reference_position AND NEW.relation IS OLD.relation AND NEW.target_record_id IS OLD.target_record_id AND NEW.target_stream IS OLD.target_stream AND NEW.target_member_id IS OLD.target_member_id AND NEW.payload_path IS OLD.payload_path) OR NOT EXISTS (SELECT 1 FROM sermon_history_records r JOIN sermon_history_commits c ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE r.sermon_id=OLD.sermon_id AND r.record_id=OLD.owner_record_id AND c.state='assembling');
END;
--> statement-breakpoint
CREATE TRIGGER history_payloads_no_delete BEFORE DELETE ON sermon_history_payloads BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE 1;
END;
--> statement-breakpoint
CREATE TRIGGER history_payloads_insert BEFORE INSERT ON sermon_history_payloads BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_payloads r WHERE r.sermon_id=NEW.sermon_id AND r.record_id=NEW.record_id);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.verified <> 0 OR NOT EXISTS (SELECT 1 FROM sermon_history_records r JOIN sermon_history_commits c ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE r.sermon_id=NEW.sermon_id AND r.record_id=NEW.record_id AND c.state='assembling');
END;
--> statement-breakpoint
CREATE TRIGGER history_payloads_immutable BEFORE UPDATE ON sermon_history_payloads BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NOT (OLD.verified=0 AND NEW.verified=1 AND NEW.sermon_id IS OLD.sermon_id AND NEW.record_id IS OLD.record_id AND NEW.codec IS OLD.codec AND NEW.chunk_bytes IS OLD.chunk_bytes AND NEW.chunk_count IS OLD.chunk_count AND NEW.byte_length IS OLD.byte_length AND NEW.payload_sha256 IS OLD.payload_sha256) OR NOT EXISTS (SELECT 1 FROM sermon_history_records r JOIN sermon_history_commits c ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE r.sermon_id=OLD.sermon_id AND r.record_id=OLD.record_id AND c.state='assembling');
END;
--> statement-breakpoint
CREATE TRIGGER history_chunks_no_delete BEFORE DELETE ON sermon_history_chunks BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE 1;
END;
--> statement-breakpoint
CREATE TRIGGER history_chunks_insert BEFORE INSERT ON sermon_history_chunks BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_chunks r WHERE r.sermon_id=NEW.sermon_id AND r.record_id=NEW.record_id AND r.chunk_index=NEW.chunk_index);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.verified <> 0 OR NOT EXISTS (SELECT 1 FROM sermon_history_records r JOIN sermon_history_commits c ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE r.sermon_id=NEW.sermon_id AND r.record_id=NEW.record_id AND c.state='assembling');
END;
--> statement-breakpoint
CREATE TRIGGER history_chunks_immutable BEFORE UPDATE ON sermon_history_chunks BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NOT (OLD.verified=0 AND NEW.verified=1 AND NEW.sermon_id IS OLD.sermon_id AND NEW.record_id IS OLD.record_id AND NEW.chunk_index IS OLD.chunk_index AND NEW.byte_length IS OLD.byte_length AND NEW.chunk_sha256 IS OLD.chunk_sha256 AND NEW.body IS OLD.body) OR NOT EXISTS (SELECT 1 FROM sermon_history_records r JOIN sermon_history_commits c ON c.sermon_id=r.sermon_id AND c.version=r.commit_version WHERE r.sermon_id=OLD.sermon_id AND r.record_id=OLD.record_id AND c.state='assembling');
END;
--> statement-breakpoint
CREATE TRIGGER history_commit_claim BEFORE INSERT ON sermon_history_commits BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.state <> 'assembling' OR EXISTS (SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.state='assembling') OR (NEW.version=1 AND (EXISTS (SELECT 1 FROM sermon_history_heads h WHERE h.sermon_id=NEW.sermon_id) OR EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id))) OR (NEW.version>1 AND NOT EXISTS (SELECT 1 FROM sermon_history_heads h JOIN sermon_history_commits c ON c.sermon_id=h.sermon_id AND c.version=h.version AND c.commit_id=h.commit_id WHERE h.sermon_id=NEW.sermon_id AND h.version=NEW.previous_version AND h.commit_id=NEW.previous_commit_id AND c.state='sealed'));
END;
--> statement-breakpoint
CREATE TRIGGER history_commit_immutable BEFORE UPDATE ON sermon_history_commits BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NOT (OLD.state='assembling' AND NEW.state='sealed' AND NEW.required_seal_state IS OLD.required_seal_state AND NEW.sermon_id IS OLD.sermon_id AND NEW.version IS OLD.version AND NEW.commit_id IS OLD.commit_id AND NEW.current_source_id IS OLD.current_source_id AND NEW.current_revision_id IS OLD.current_revision_id AND NEW.current_confirmation_id IS OLD.current_confirmation_id AND NEW.attempt_id IS OLD.attempt_id AND NEW.previous_version IS OLD.previous_version AND NEW.previous_commit_id IS OLD.previous_commit_id AND NEW.command IS OLD.command AND NEW.sources_count IS OLD.sources_count AND NEW.revisions_count IS OLD.revisions_count AND NEW.confirmations_count IS OLD.confirmations_count AND NEW.correctionProposals_count IS OLD.correctionProposals_count AND NEW.correctionDecisions_count IS OLD.correctionDecisions_count AND NEW.intentEvents_count IS OLD.intentEvents_count AND NEW.summaryEvents_count IS OLD.summaryEvents_count AND NEW.candidateEvents_count IS OLD.candidateEvents_count AND NEW.record_count IS OLD.record_count AND NEW.reference_count IS OLD.reference_count AND NEW.manifest_count IS OLD.manifest_count AND NEW.chunk_count IS OLD.chunk_count AND NEW.byte_length IS OLD.byte_length);
END;
--> statement-breakpoint
CREATE TRIGGER history_head_insert BEFORE INSERT ON sermon_history_heads BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.version<>1 OR NOT EXISTS (SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.version AND c.commit_id=NEW.commit_id AND c.state='assembling' AND c.current_source_id=NEW.current_source_id AND c.current_revision_id=NEW.current_revision_id AND c.current_confirmation_id IS NEW.current_confirmation_id);
END;
--> statement-breakpoint
CREATE TRIGGER history_head_update BEFORE UPDATE ON sermon_history_heads BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.sermon_id IS NOT OLD.sermon_id OR NEW.storage_format_version IS NOT OLD.storage_format_version OR NEW.contract_version IS NOT OLD.contract_version OR NEW.version<>OLD.version+1 OR NOT EXISTS (SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.version AND c.commit_id=NEW.commit_id AND c.state='assembling' AND c.current_source_id=NEW.current_source_id AND c.current_revision_id=NEW.current_revision_id AND c.current_confirmation_id IS NEW.current_confirmation_id AND c.previous_version=OLD.version AND c.previous_commit_id=OLD.commit_id);
END;
--> statement-breakpoint
CREATE TRIGGER history_reference_order BEFORE INSERT ON sermon_history_references BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NOT EXISTS (SELECT 1 FROM sermon_history_records o JOIN sermon_history_records t ON t.sermon_id=o.sermon_id JOIN sermon_history_commits c ON c.sermon_id=t.sermon_id AND c.version=t.commit_version WHERE o.sermon_id=NEW.sermon_id AND o.record_id=NEW.owner_record_id AND t.record_id=NEW.target_record_id AND t.stream=NEW.target_stream AND ((t.commit_version<o.commit_version AND c.state='sealed') OR (t.commit_version=o.commit_version AND c.command='import' AND t.commit_slot=0 AND o.commit_slot=1)));
END;
--> statement-breakpoint
CREATE TRIGGER history_seal_guard BEFORE UPDATE ON sermon_history_commits WHEN OLD.state='assembling' AND NEW.state='sealed' BEGIN
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NOT EXISTS (SELECT 1 FROM sermon_history_heads h WHERE h.sermon_id=NEW.sermon_id AND h.version=NEW.version AND h.commit_id=NEW.commit_id AND h.current_source_id=NEW.current_source_id AND h.current_revision_id=NEW.current_revision_id AND h.current_confirmation_id IS NEW.current_confirmation_id);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version<NEW.version AND c.state='sealed') <> NEW.version-1;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.sources_count <> coalesce((SELECT c.sources_count FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.previous_version),0) + (CASE WHEN NEW.command='import' THEN 1 ELSE 0 END);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='sources') <> NEW.sources_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='sources' AND r.stream_position > NEW.sources_count);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.revisions_count <> coalesce((SELECT c.revisions_count FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.previous_version),0) + (CASE WHEN NEW.command='import' OR NEW.command='revisions' THEN 1 ELSE 0 END);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='revisions') <> NEW.revisions_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='revisions' AND r.stream_position > NEW.revisions_count);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.confirmations_count <> coalesce((SELECT c.confirmations_count FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.previous_version),0) + (CASE WHEN NEW.command='confirmations' THEN 1 ELSE 0 END);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='confirmations') <> NEW.confirmations_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='confirmations' AND r.stream_position > NEW.confirmations_count);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.correctionProposals_count <> coalesce((SELECT c.correctionProposals_count FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.previous_version),0) + (CASE WHEN NEW.command='correctionProposals' THEN 1 ELSE 0 END);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='correctionProposals') <> NEW.correctionProposals_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='correctionProposals' AND r.stream_position > NEW.correctionProposals_count);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.correctionDecisions_count <> coalesce((SELECT c.correctionDecisions_count FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.previous_version),0) + (CASE WHEN NEW.command='correctionDecisions' THEN 1 ELSE 0 END);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='correctionDecisions') <> NEW.correctionDecisions_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='correctionDecisions' AND r.stream_position > NEW.correctionDecisions_count);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.intentEvents_count <> coalesce((SELECT c.intentEvents_count FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.previous_version),0) + (CASE WHEN NEW.command='intentEvents' THEN 1 ELSE 0 END);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='intentEvents') <> NEW.intentEvents_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='intentEvents' AND r.stream_position > NEW.intentEvents_count);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.summaryEvents_count <> coalesce((SELECT c.summaryEvents_count FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.previous_version),0) + (CASE WHEN NEW.command='summaryEvents' THEN 1 ELSE 0 END);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='summaryEvents') <> NEW.summaryEvents_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='summaryEvents' AND r.stream_position > NEW.summaryEvents_count);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.candidateEvents_count <> coalesce((SELECT c.candidateEvents_count FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.previous_version),0) + (CASE WHEN NEW.command='candidateEvents' THEN 1 ELSE 0 END);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='candidateEvents') <> NEW.candidateEvents_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.stream='candidateEvents' AND r.stream_position > NEW.candidateEvents_count);
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.version <> NEW.revisions_count + NEW.confirmations_count + NEW.correctionProposals_count + NEW.correctionDecisions_count + NEW.intentEvents_count + NEW.summaryEvents_count + NEW.candidateEvents_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.record_count <> CASE WHEN NEW.command='import' THEN 2 ELSE 1 END;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.manifest_count <> NEW.record_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version) <> NEW.record_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version AND (r.verified<>1 OR NOT ((NEW.command='import' AND ((r.stream='sources' AND r.commit_slot=0) OR (r.stream='revisions' AND r.commit_slot=1))) OR (NEW.command<>'import' AND r.stream=NEW.command AND r.commit_slot=0))));
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_records r JOIN sermon_history_payloads p ON p.sermon_id=r.sermon_id AND p.record_id=r.record_id WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version) <> NEW.manifest_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT coalesce(sum(p.byte_length),0) FROM sermon_history_records r JOIN sermon_history_payloads p ON p.sermon_id=r.sermon_id AND p.record_id=r.record_id WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version) <> NEW.byte_length;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT coalesce(sum(p.chunk_count),0) FROM sermon_history_records r JOIN sermon_history_payloads p ON p.sermon_id=r.sermon_id AND p.record_id=r.record_id WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version) <> NEW.chunk_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_records r JOIN sermon_history_payloads p ON p.sermon_id=r.sermon_id AND p.record_id=r.record_id WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version AND (p.verified<>1 OR (SELECT count(*) FROM sermon_history_chunks b WHERE b.sermon_id=p.sermon_id AND b.record_id=p.record_id)<>p.chunk_count OR (SELECT coalesce(sum(b.byte_length),0) FROM sermon_history_chunks b WHERE b.sermon_id=p.sermon_id AND b.record_id=p.record_id)<>p.byte_length OR EXISTS (SELECT 1 FROM sermon_history_chunks b WHERE b.sermon_id=p.sermon_id AND b.record_id=p.record_id AND (b.verified<>1 OR b.chunk_index>=p.chunk_count OR b.byte_length<>CASE WHEN b.chunk_index=p.chunk_count-1 THEN p.byte_length-(p.chunk_count-1)*65536 ELSE 65536 END))));
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE (SELECT count(*) FROM sermon_history_references f JOIN sermon_history_records r ON r.sermon_id=f.sermon_id AND r.record_id=f.owner_record_id WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version) <> NEW.reference_count;
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE EXISTS (SELECT 1 FROM sermon_history_references f JOIN sermon_history_records r ON r.sermon_id=f.sermon_id AND r.record_id=f.owner_record_id WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version AND (f.verified<>1 OR f.reference_position>(SELECT count(*) FROM sermon_history_references x WHERE x.sermon_id=f.sermon_id AND x.owner_record_id=f.owner_record_id)));
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NOT EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.record_id=NEW.current_source_id AND r.stream='sources');
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NOT EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.record_id=NEW.current_revision_id AND r.stream='revisions');
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.current_confirmation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.record_id=NEW.current_confirmation_id AND r.stream='confirmations');
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NOT EXISTS (SELECT 1 FROM sermon_history_references f WHERE f.sermon_id=NEW.sermon_id AND f.owner_record_id=NEW.current_revision_id AND f.target_record_id=NEW.current_source_id AND f.relation='source');
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.current_confirmation_id IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM sermon_history_references f WHERE f.sermon_id=NEW.sermon_id AND f.owner_record_id=NEW.current_confirmation_id AND f.target_record_id=NEW.current_source_id AND f.relation='source') OR NOT EXISTS (SELECT 1 FROM sermon_history_references f WHERE f.sermon_id=NEW.sermon_id AND f.owner_record_id=NEW.current_confirmation_id AND f.target_record_id=NEW.current_revision_id AND f.relation='revision'));
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.command='import' AND (NEW.current_confirmation_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version AND r.record_id=NEW.current_source_id AND r.stream='sources') OR NOT EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version AND r.record_id=NEW.current_revision_id AND r.stream='revisions'));
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.command='revisions' AND (NEW.current_confirmation_id IS NOT NULL OR NEW.current_source_id IS NOT (SELECT c.current_source_id FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.previous_version) OR NOT EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version AND r.record_id=NEW.current_revision_id));
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.command NOT IN ('import','revisions') AND NOT EXISTS (SELECT 1 FROM sermon_history_commits c WHERE c.sermon_id=NEW.sermon_id AND c.version=NEW.previous_version AND c.current_source_id=NEW.current_source_id AND c.current_revision_id=NEW.current_revision_id AND (NEW.command='confirmations' OR c.current_confirmation_id IS NEW.current_confirmation_id));
  SELECT RAISE(ABORT, 'HISTORY_CONSTRAINT') WHERE NEW.command='confirmations' AND NOT EXISTS (SELECT 1 FROM sermon_history_records r WHERE r.sermon_id=NEW.sermon_id AND r.commit_version=NEW.version AND r.record_id=NEW.current_confirmation_id AND r.stream='confirmations');
END;
