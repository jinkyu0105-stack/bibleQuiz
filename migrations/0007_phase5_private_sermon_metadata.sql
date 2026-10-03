CREATE TABLE `sermon_metadata_drafts` (
	`sermon_id` text PRIMARY KEY NOT NULL,
	`contract_version` integer NOT NULL,
	`metadata_revision` integer NOT NULL,
	`title` text NOT NULL,
	`sermon_date` text NOT NULL,
	`bible_reference_json` text NOT NULL,
	FOREIGN KEY (`sermon_id`) REFERENCES `sermons`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sermon_metadata_drafts_contract_check" CHECK("sermon_metadata_drafts"."contract_version" = 1),
	CONSTRAINT "sermon_metadata_drafts_revision_check" CHECK(typeof("sermon_metadata_drafts"."metadata_revision") = 'integer' and "sermon_metadata_drafts"."metadata_revision" between 1 and 9007199254740991),
	CONSTRAINT "sermon_metadata_drafts_title_check" CHECK(length("sermon_metadata_drafts"."title") between 1 and 300),
	CONSTRAINT "sermon_metadata_drafts_reference_json_check" CHECK(json_valid("sermon_metadata_drafts"."bible_reference_json") and json_type("sermon_metadata_drafts"."bible_reference_json") = 'object')
);
