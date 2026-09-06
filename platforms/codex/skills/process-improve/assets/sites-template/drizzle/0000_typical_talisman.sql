CREATE TABLE `worksheets` (
	`id` text PRIMARY KEY NOT NULL,
	`rows_json` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
