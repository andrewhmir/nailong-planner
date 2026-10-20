CREATE TABLE `calendar` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`hue_family` text,
	`shade_index` integer DEFAULT 0 NOT NULL,
	`owner_id` text,
	`is_view_only_for_partner` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `calendar`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_household_idx` ON `calendar` (`household_id`);--> statement-breakpoint
CREATE INDEX `calendar_parent_idx` ON `calendar` (`parent_id`);--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`all_day` integer DEFAULT 0 NOT NULL,
	`start_at` integer,
	`end_at` integer,
	`start_date` text,
	`end_date` text,
	`rrule` text,
	`exdates` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendar`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_household_start_idx` ON `event` (`household_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `event_household_start_date_idx` ON `event` (`household_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `event_calendar_idx` ON `event` (`calendar_id`);--> statement-breakpoint
CREATE TABLE `household` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Our Nest' NOT NULL,
	`timezone` text DEFAULT 'Asia/Taipei' NOT NULL,
	`week_starts_on` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `member` (
	`user_id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
