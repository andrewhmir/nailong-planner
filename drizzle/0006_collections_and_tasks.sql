-- v0.2.0: the calendar tree becomes the collection tree. `calendar` is renamed
-- in place so every event, parent link and colour survives; `kind` separates
-- calendars from task lists and `visibility` generalises the old view-only flag.
-- Existing rows keep `kind='calendar'` and are backfilled to `shared`/`view_only`.
ALTER TABLE `calendar` RENAME TO `collection`;--> statement-breakpoint
ALTER TABLE `collection` ADD `kind` text DEFAULT 'calendar' NOT NULL;--> statement-breakpoint
ALTER TABLE `collection` ADD `visibility` text DEFAULT 'shared' NOT NULL;--> statement-breakpoint
UPDATE `collection` SET `visibility` = 'view_only' WHERE `is_view_only_for_partner` = 1;--> statement-breakpoint
ALTER TABLE `collection` DROP COLUMN `is_view_only_for_partner`;--> statement-breakpoint
ALTER TABLE `event` RENAME COLUMN `calendar_id` TO `collection_id`;--> statement-breakpoint
DROP INDEX `calendar_household_idx`;--> statement-breakpoint
CREATE INDEX `collection_household_idx` ON `collection` (`household_id`);--> statement-breakpoint
DROP INDEX `calendar_parent_idx`;--> statement-breakpoint
CREATE INDEX `collection_parent_idx` ON `collection` (`parent_id`);--> statement-breakpoint
DROP INDEX `event_calendar_idx`;--> statement-breakpoint
CREATE INDEX `event_collection_idx` ON `event` (`collection_id`);--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'open' NOT NULL,
	`scheduled_on` text,
	`due_on` text,
	`completed_at` integer,
	`dropped_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `task_household_status_idx` ON `task` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `task_collection_idx` ON `task` (`collection_id`);--> statement-breakpoint
CREATE INDEX `task_scheduled_idx` ON `task` (`scheduled_on`);--> statement-breakpoint
CREATE INDEX `task_due_idx` ON `task` (`due_on`);--> statement-breakpoint
CREATE TABLE `task_checklist_item` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `task_checklist_task_idx` ON `task_checklist_item` (`task_id`);
