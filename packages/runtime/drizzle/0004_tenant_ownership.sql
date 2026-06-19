ALTER TABLE projects ADD COLUMN user_id TEXT;
--> statement-breakpoint
ALTER TABLE agents ADD COLUMN user_id TEXT;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN user_id TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agents_user_project_id ON agents(user_id, project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_user_project_id ON sessions(user_id, project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_user_last_active_at ON sessions(user_id, last_active_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY(user_id, key)
);
