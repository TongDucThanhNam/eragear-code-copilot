ALTER TABLE `projects` ADD `obsidian_project_path` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD `tech_stack_tags_json` text NOT NULL DEFAULT '[]';
