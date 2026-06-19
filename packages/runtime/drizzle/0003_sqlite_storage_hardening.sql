ALTER TABLE session_messages ADD COLUMN storage_tier text NOT NULL DEFAULT 'hot';
--> statement-breakpoint
ALTER TABLE session_messages ADD COLUMN retained_payload integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE session_messages ADD COLUMN compacted_at integer;
--> statement-breakpoint
UPDATE session_messages
SET storage_tier = 'hot'
WHERE storage_tier IS NULL OR storage_tier = '';
--> statement-breakpoint
UPDATE session_messages
SET retained_payload = 1
WHERE retained_payload IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_last_active_at_id
ON sessions (last_active_at DESC, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_project_id_last_active_at
ON sessions (project_id, last_active_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_archived_pinned_last_active_at
ON sessions (archived, pinned, last_active_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_session_id_retained_payload_seq
ON session_messages (session_id, retained_payload, seq);
