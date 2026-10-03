CREATE TABLE `ai_response_archive_chunks` (
	`call_id` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer NOT NULL,
	`body` blob NOT NULL,
	PRIMARY KEY(`call_id`, `kind`, `position`),
	FOREIGN KEY (`call_id`,`kind`) REFERENCES `ai_response_archives`(`call_id`,`kind`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_response_archive_chunks_position_check" CHECK(typeof(position)='integer' and position between 0 and 1023),
	CONSTRAINT "ai_response_archive_chunks_body_check" CHECK(typeof(body)='blob' and length(body) between 1 and 65536)
);
--> statement-breakpoint
CREATE TABLE `ai_response_archives` (
	`call_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`http_status` integer,
	`byte_length` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`call_id`, `kind`),
	FOREIGN KEY (`call_id`) REFERENCES `ai_provider_calls`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_response_archives_kind_check" CHECK(kind in ('request','response')),
	CONSTRAINT "ai_response_archives_state_check" CHECK(state in ('assembling','sealed')),
	CONSTRAINT "ai_response_archives_status_check" CHECK((kind='request' and http_status is null) or (kind='response' and http_status is not null and http_status between 100 and 599)),
	CONSTRAINT "ai_response_archives_size_check" CHECK(typeof(byte_length)='integer' and byte_length between 0 and 67108864 and typeof(chunk_count)='integer' and chunk_count=(byte_length+65535)/65536),
	CONSTRAINT "ai_response_archives_hash_check" CHECK(length(sha256)=64 and sha256 not glob '*[^0-9a-f]*')
);
