-- v0.2.1: one deadline per task. `due_time` is an optional household-local
-- `HH:MM` wall-clock time on the due day; `scheduled_on` is retired. Existing
-- scheduled dates become due dates only where no due date was set, so no row
-- loses its date (a row with both keeps its due date).
ALTER TABLE `task` ADD `due_time` text;--> statement-breakpoint
UPDATE `task` SET `due_on` = `scheduled_on` WHERE `due_on` IS NULL AND `scheduled_on` IS NOT NULL;--> statement-breakpoint
DROP INDEX `task_scheduled_idx`;--> statement-breakpoint
ALTER TABLE `task` DROP COLUMN `scheduled_on`;
