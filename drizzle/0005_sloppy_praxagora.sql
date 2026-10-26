ALTER TABLE `event` ADD `recurrence_parent_id` text REFERENCES event(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `event` ADD `recurrence_id` text;--> statement-breakpoint
CREATE INDEX `event_recurrence_parent_idx` ON `event` (`recurrence_parent_id`);