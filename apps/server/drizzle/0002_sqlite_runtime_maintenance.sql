PRAGMA auto_vacuum = INCREMENTAL;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_session_messages_after_insert
AFTER INSERT ON session_messages
BEGIN
  UPDATE sessions
  SET message_count = message_count + 1
  WHERE id = NEW.session_id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_session_messages_after_delete
AFTER DELETE ON session_messages
BEGIN
  UPDATE sessions
  SET message_count = CASE
    WHEN message_count > 0 THEN message_count - 1
    ELSE 0
  END
  WHERE id = OLD.session_id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_session_messages_after_update_session_id
AFTER UPDATE OF session_id ON session_messages
WHEN OLD.session_id <> NEW.session_id
BEGIN
  UPDATE sessions
  SET message_count = CASE
    WHEN message_count > 0 THEN message_count - 1
    ELSE 0
  END
  WHERE id = OLD.session_id;
  UPDATE sessions
  SET message_count = message_count + 1
  WHERE id = NEW.session_id;
END;
--> statement-breakpoint
UPDATE sessions
SET message_count = (
  SELECT COUNT(*)
  FROM session_messages
  WHERE session_messages.session_id = sessions.id
);
--> statement-breakpoint
INSERT INTO app_meta (key, value)
VALUES ('sessions_count', (SELECT CAST(COUNT(*) AS TEXT) FROM sessions))
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_sessions_after_insert
AFTER INSERT ON sessions
BEGIN
  INSERT INTO app_meta (key, value)
  VALUES ('sessions_count', '0')
  ON CONFLICT(key) DO NOTHING;
  UPDATE app_meta
  SET value = CAST(COALESCE(CAST(value AS INTEGER), 0) + 1 AS TEXT)
  WHERE key = 'sessions_count';
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS trg_sessions_after_delete
AFTER DELETE ON sessions
BEGIN
  INSERT INTO app_meta (key, value)
  VALUES ('sessions_count', '0')
  ON CONFLICT(key) DO NOTHING;
  UPDATE app_meta
  SET value = CAST(
    CASE
      WHEN COALESCE(CAST(value AS INTEGER), 0) > 0
        THEN CAST(value AS INTEGER) - 1
      ELSE 0
    END
  AS TEXT)
  WHERE key = 'sessions_count';
END;
