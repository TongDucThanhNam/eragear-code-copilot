CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  description TEXT,
  tags_json TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_opened_at INTEGER
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  command TEXT NOT NULL,
  args_json TEXT,
  env_json TEXT,
  project_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agents_project_id ON agents(project_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  session_id TEXT,
  project_id TEXT,
  project_root TEXT NOT NULL,
  command TEXT,
  args_json TEXT,
  env_json TEXT,
  cwd TEXT,
  load_session_supported INTEGER,
  use_unstable_resume INTEGER,
  supports_model_switching INTEGER,
  agent_info_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('running', 'stopped')),
  pinned INTEGER,
  archived INTEGER,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  mode_id TEXT,
  model_id TEXT,
  plan_json TEXT,
  commands_json TEXT,
  agent_capabilities_json TEXT,
  auth_methods_json TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_last_active_at ON sessions(last_active_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS session_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  content_blocks_json TEXT,
  timestamp INTEGER NOT NULL,
  tool_calls_json TEXT,
  reasoning TEXT,
  reasoning_blocks_json TEXT,
  parts_json TEXT,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_session_id_seq ON session_messages(session_id, seq);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_session_id_timestamp ON session_messages(session_id, timestamp);
