CREATE TABLE IF NOT EXISTS session_event_outbox (
  id text PRIMARY KEY NOT NULL,
  chat_id text NOT NULL,
  user_id text NOT NULL,
  event_json text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at integer NOT NULL,
  created_at integer NOT NULL,
  published_at integer,
  last_error text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbox_status_next_attempt
ON session_event_outbox (status, next_attempt_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbox_created_at
ON session_event_outbox (created_at);
