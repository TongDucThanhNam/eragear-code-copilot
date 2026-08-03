CREATE TABLE IF NOT EXISTS supervisor_runs (
  run_id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  project_id text,
  project_root text NOT NULL,
  status text NOT NULL CHECK(status IN ('draft', 'planning', 'queued', 'running', 'paused', 'needs_user', 'completing', 'completed', 'failed', 'cancelled')),
  revision integer NOT NULL CHECK(revision >= 0),
  schema_version integer NOT NULL,
  state_json text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_supervisor_runs_user_updated_at
ON supervisor_runs (user_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_supervisor_runs_user_project_updated_at
ON supervisor_runs (user_id, project_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_supervisor_runs_status_updated_at
ON supervisor_runs (status, updated_at DESC);
