---
artifact_type: worker_output
session_id: 20260426-supervisor-ui-chatinput
task_id: T05
producer: team-builder
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: unknown
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/tickets/T05-show-supervisor-error-reason.md
consumers:
  - team-validator
  - orchestrator
freshness_rule: invalid_if_supervisor_status_schema_or_ui_changes
---
# Worker Output

## Summary
Surfaced existing `SupervisorSessionState.reason` in Supervisor UI and debug logs.

## Discovered error field shape
- `SupervisorSessionState.reason?: string` already exists in `packages/shared/src/chat/types.ts` and is set by server supervisor services.

## Files changed
- `apps/web/src/components/chat-ui/supervisor-control.tsx`: added `reason` prop and red Error Reason panel shown when `status === "error" && reason`.
- `apps/web/src/components/chat-ui/chat-input.tsx`: passes `supervisor?.reason` to SupervisorControl and includes `supervisorReason` in `[SupervisorDebug]` visibility log.

## UI/log behavior
- Dialog now shows human-readable error reason when available.
- Browser console `[SupervisorDebug]` now includes `supervisorReason=...`.
- No secrets are logged; only supervisor state reason already returned by backend.

## Validation
- Web check-types: PASS per builder.
- Server has unrelated pre-existing failures.

## User instructions
- Reload web.
- Filter browser console by `[SupervisorDebug]`.
- Open Supervisor Dialog when status is `error`; it should show an Error Reason panel if backend provided `reason`.

## Blockers
none
