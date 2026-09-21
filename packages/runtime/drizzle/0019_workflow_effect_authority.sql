ALTER TABLE workflow_effect_intents
ADD COLUMN authority_id text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE workflow_effect_intents
SET authority_id = run_id
WHERE authority_id = '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workflow_effect_intents_run_authority_status
ON workflow_effect_intents (run_id, authority_id, status, created_at_ms);
