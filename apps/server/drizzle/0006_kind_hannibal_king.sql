ALTER TABLE `sessions` ADD `agent_id` text REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null;
