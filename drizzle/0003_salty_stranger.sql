CREATE TABLE `import_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`created_by` text NOT NULL,
	`source_name` text NOT NULL,
	`status` text DEFAULT 'committed' NOT NULL,
	`mapping` text,
	`report` text,
	`created_at` integer NOT NULL,
	`rolled_back_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_batch_household_idx` ON `import_batch` (`household_id`);--> statement-breakpoint
CREATE TABLE `import_change` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`event_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batch`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_change_batch_idx` ON `import_change` (`batch_id`);--> statement-breakpoint
ALTER TABLE `event` ADD `tzid` text;--> statement-breakpoint
ALTER TABLE `event` ADD `external_source` text;--> statement-breakpoint
ALTER TABLE `event` ADD `external_uid` text;--> statement-breakpoint
ALTER TABLE `event` ADD `external_recurrence_id` text;--> statement-breakpoint
ALTER TABLE `event` ADD `external_key` text;--> statement-breakpoint
ALTER TABLE `event` ADD `external_content_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `event_household_external_key_idx` ON `event` (`household_id`,`external_key`);