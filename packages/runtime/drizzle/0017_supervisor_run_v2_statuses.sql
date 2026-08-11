CREATE TABLE supervisor_runs_v2 (
  run_id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  project_id text,
  project_root text NOT NULL,
  status text NOT NULL CHECK(status IN ('draft', 'planning', 'awaiting_approval', 'queued', 'running', 'waiting_capacity', 'paused', 'needs_user', 'completing', 'completed', 'failed', 'cancelled')),
  revision integer NOT NULL,
  schema_version integer NOT NULL,
  state_json text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
--> statement-breakpoint
INSERT INTO supervisor_runs_v2 (
  run_id,
  user_id,
  project_id,
  project_root,
  status,
  revision,
  schema_version,
  state_json,
  created_at,
  updated_at
)
SELECT
  run_id,
  user_id,
  project_id,
  project_root,
  status,
  revision,
  schema_version,
  state_json,
  created_at,
  updated_at
FROM supervisor_runs;
--> statement-breakpoint
DROP TABLE supervisor_runs;
--> statement-breakpoint
ALTER TABLE supervisor_runs_v2 RENAME TO supervisor_runs;
--> statement-breakpoint
CREATE INDEX idx_supervisor_runs_user_updated_at
ON supervisor_runs (user_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX idx_supervisor_runs_user_project_updated_at
ON supervisor_runs (user_id, project_id, updated_at DESC);
--> statement-breakpoint
CREATE INDEX idx_supervisor_runs_status_updated_at
ON supervisor_runs (status, updated_at DESC);
