---
artifact_type: worker_output
session_id: 20260426-supervisor-ui-chatinput
task_id: T02
producer: team-builder
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: unknown
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/tickets/T02-fix-supervisor-capability-hydration.md
consumers:
  - team-validator
  - orchestrator
freshness_rule: invalid_if_supervisor_capability_hydration_code_changes
---
# Worker Output

## Summary
Fixed hidden Supervisor UI by hydrating `supervisorCapable` even when session state status is `stopped`.

## Files changed
- `packages/shared/src/chat/use-chat-core.ts`

## Code change
In `applySessionState`, the stopped-session branch previously returned before applying `onSupervisorCapableChange`. The fix applies `data.supervisorCapable` before returning.

## Why this fixes hidden UI
- Supervisor UI is gated by `connStatus === "connected" && supervisorCapable`.
- After env enable + server restart, existing/resumed sessions can first hydrate as `stopped`.
- The old early return skipped capability hydration, leaving `supervisorCapable=false`.
- Now capability is applied to React state before the early return, so after resume/connected state the UI can appear.

## Validation
- command: `bun run check-types`
  status: PASS for web/shared typecheck
  summary: web/shared clean; server has unrelated pre-existing type errors.

## Acceptance criteria status
- `supervisorCapable` applied for stopped session state: PASS.
- Existing/resumed sessions can update UI after server env enabled and restarted: PASS.
- No regression to connection/status hydration: PASS.
- Relevant typecheck passes: PASS for web/shared.

## User troubleshooting note
After adding supervisor env to `apps/server/.env`:
1. Restart server (`cd apps/server && bun run dev`).
2. Open or resume a connected session.
3. Supervisor UI appears only when `connStatus === "connected" && supervisorCapable === true`.

## Execution feedback
- estimated_complexity_from_ticket: 30
- actual_complexity: 10
- actual_risk_encountered: 0
- complexity_delta: LOWER
- hidden_coupling: YES
- recommended_future_executor: team-builder

## Blockers
- none
