DROP INDEX IF EXISTS idx_workflow_effect_intents_run_idempotency;
--> statement-breakpoint
UPDATE workflow_effect_intents
SET idempotency_key = json_extract(payload_json, '$.intent.dedupeKey')
WHERE json_type(payload_json, '$.intent.dedupeKey') = 'text'
  AND length(json_extract(payload_json, '$.intent.dedupeKey')) BETWEEN 1 AND 512;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_workflow_effect_intents_run_idempotency
ON workflow_effect_intents (run_id, authority_id, idempotency_key);
