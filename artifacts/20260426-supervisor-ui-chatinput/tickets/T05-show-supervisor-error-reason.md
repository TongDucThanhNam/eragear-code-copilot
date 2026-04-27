---
artifact_type: ticket
session_id: 20260426-supervisor-ui-chatinput
task_id: T05
producer: orchestrator
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: unknown
based_on:
  - user_request
  - artifacts/20260426-supervisor-ui-chatinput/validation/T03-validation-final.md
  - artifacts/20260426-supervisor-ui-chatinput/validation/T04-validation.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_supervisor_status_schema_or_ui_changes
---

# T05 - Show Supervisor error reason in UI/debug logs

## User report
User now sees the Supervisor UI gate render, but status is error:
`[SupervisorDebug] visibility inputs — connStatus=connected supervisorCapable=true supervisorMode=full_autopilot supervisorStatus=error willRender=true`
User asks: "Nó không show được why error à ?"

## Problem
Supervisor status can be `error`, but current UI/debug logs only show status, not the reason/message/cause. User needs to see why supervisor is in error.

## Scope
- Inspect existing supervisor status/decision/event/state shape for any error reason field.
- If an error/reason/message field exists, surface it in SupervisorControl UI and `[SupervisorDebug]` logs.
- If no field exists, add minimal propagation from server supervisor state/event to shared/web state only if localized and safe.
- Do not log secrets or API keys.
- Preserve existing capability-gated behavior.

## Acceptance criteria
- When supervisor status is `error`, the Dialog shows a human-readable reason if available, or a clear fallback if not available.
- Browser debug logs include an error reason/cause field when available.
- If backend has an error reason but it was not propagated, propagate it minimally.
- Typecheck/build or targeted validation passes, or unrelated failures are documented.
