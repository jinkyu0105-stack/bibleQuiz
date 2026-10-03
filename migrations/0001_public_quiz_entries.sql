-- Public clue geometry. transcript_evidence_json remains server-private.
CREATE TABLE `quiz_entries_public` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_variant_id` text NOT NULL,
	`number` integer NOT NULL,
	`direction` text NOT NULL,
	`start_row` integer NOT NULL,
	`start_col` integer NOT NULL,
	`length` integer NOT NULL,
	`clue` text NOT NULL,
	`transcript_evidence_json` text,
	`display_order` integer NOT NULL,
	FOREIGN KEY (`quiz_variant_id`) REFERENCES `quiz_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "quiz_entries_number_check" CHECK("quiz_entries_public"."number" >= 1),
	CONSTRAINT "quiz_entries_direction_check" CHECK("quiz_entries_public"."direction" in ('across', 'down')),
	CONSTRAINT "quiz_entries_coordinate_check" CHECK("quiz_entries_public"."start_row" between 0 and 9 and "quiz_entries_public"."start_col" between 0 and 9),
	CONSTRAINT "quiz_entries_length_check" CHECK("quiz_entries_public"."length" between 2 and 10),
	CONSTRAINT "quiz_entries_order_check" CHECK("quiz_entries_public"."display_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_entries_variant_number_direction_uidx` ON `quiz_entries_public` (`quiz_variant_id`,`number`,`direction`);
