CREATE TABLE `goal_mode_states` (
	`goal_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`schema_version` integer NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL
);
