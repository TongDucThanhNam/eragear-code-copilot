DELETE FROM session_messages
WHERE seq NOT IN (
  SELECT MIN(seq)
  FROM session_messages
  GROUP BY session_id, message_id
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_session_id_message_id
ON session_messages(session_id, message_id);
--> statement-breakpoint
UPDATE sessions
SET message_count = (
  SELECT COUNT(*)
  FROM session_messages
  WHERE session_messages.session_id = sessions.id
);
