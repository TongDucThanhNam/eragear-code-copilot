CREATE TABLE IF NOT EXISTS workflow_events (
  event_id text PRIMARY KEY NOT NULL,
  run_id text NOT NULL,
  revision integer NOT NULL CHECK(revision >= 0),
  event_type text NOT NULL,
  payload_version integer NOT NULL CHECK(payload_version >= 1),
  payload_json text NOT NULL,
  occurred_at_ms integer NOT NULL CHECK(occurred_at_ms >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_events_run_revision
ON workflow_events (run_id, revision);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workflow_events_run_occurred_at
ON workflow_events (run_id, occurred_at_ms);
--> statement-breakpoint
INSERT INTO workflow_events (
  event_id,
  run_id,
  revision,
  event_type,
  payload_version,
  payload_json,
  occurred_at_ms
)
SELECT
  'legacy_snapshot_imported:' || run_id,
  run_id,
  revision,
  'legacy_snapshot_imported',
  1,
  state_json,
  MAX(
    0,
    COALESCE(
      CAST(strftime('%s', updated_at) AS integer) * 1000
        + CAST(substr(strftime('%f', updated_at), 4, 3) AS integer),
      0
    )
  )
FROM supervisor_runs
WHERE true
ON CONFLICT(event_id) DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workflow_effect_intents (
  effect_id text PRIMARY KEY NOT NULL,
  run_id text NOT NULL,
  source_event_id text NOT NULL,
  effect_type text NOT NULL,
  payload_version integer NOT NULL CHECK(payload_version >= 1),
  payload_json text NOT NULL,
  payload_hash text NOT NULL,
  prompt_hash text,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'started', 'succeeded', 'failed', 'uncertain', 'cancelled')),
  not_before_ms integer NOT NULL CHECK(not_before_ms >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  claim_token text,
  claimed_at_ms integer,
  lease_expires_at_ms integer,
  attempt_id text,
  session_id text,
  workspace_id text,
  created_at_ms integer NOT NULL CHECK(created_at_ms >= 0),
  updated_at_ms integer NOT NULL CHECK(updated_at_ms >= 0),
  started_at_ms integer,
  finished_at_ms integer,
  last_error_json text,
  result_event_id text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_effect_intents_run_idempotency
ON workflow_effect_intents (run_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workflow_effect_intents_due
ON workflow_effect_intents (status, not_before_ms, lease_expires_at_ms, created_at_ms);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workflow_effect_intents_run_status
ON workflow_effect_intents (run_id, status, created_at_ms);
