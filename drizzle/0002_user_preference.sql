CREATE TABLE `user_preference` (
	`user_id` text PRIMARY KEY NOT NULL,
	`default_view` text DEFAULT 'auto' NOT NULL,
	`time_format` text DEFAULT '24h' NOT NULL,
	`show_week_numbers` integer DEFAULT 0 NOT NULL,
	`shortcuts_enabled` integer DEFAULT 1 NOT NULL,
	`last_event_calendar_id` text,
	`updated_at` integer NOT NULL
);
