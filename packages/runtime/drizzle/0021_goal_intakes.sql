CREATE TABLE `goal_intakes` (
	`intake_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`project_root` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`state_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_goal_intakes_user_updated_at` ON `goal_intakes` (`user_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_goal_intakes_user_project_updated_at` ON `goal_intakes` (`user_id`,`project_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_goal_intakes_user_status_updated_at` ON `goal_intakes` (`user_id`,`status`,`updated_at`);
