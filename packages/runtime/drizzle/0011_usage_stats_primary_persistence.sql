CREATE TABLE IF NOT EXISTS usage_stats_records (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('prompt_sent', 'turn_completed', 'quota_refreshed')),
  project_id text,
  project_root text,
  chat_id text,
  agent_session_id text,
  turn_id text,
  provider_id text,
  provider_display_name text,
  status text,
  input_tokens integer,
  output_tokens integer,
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_usage_stats_user_created_at
ON usage_stats_records (user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_usage_stats_user_project_created_at
ON usage_stats_records (user_id, project_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS usage_telemetry_settings (
  user_id text PRIMARY KEY NOT NULL,
  enabled integer NOT NULL,
  updated_at integer NOT NULL
);
