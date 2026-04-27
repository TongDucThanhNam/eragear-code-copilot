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
  - artifacts/20260426-supervisor-ui-chatinput/outputs/T02-builder-output.md
  - artifacts/20260426-supervisor-ui-chatinput/validation/T02-validation.md
consumers:
  - team-validator
  - orchestrator
freshness_rule: invalid_if_supervisor_capability_hydration_code_changes
---
# Worker Output v2

## Summary
Fixed remaining web resume race by applying `supervisorCapable` inside the `isResumingRef.current && status === "stopped"` skip guard.

## Files changed
- `apps/web/src/hooks/use-chat-session-state-sync.ts`

## Exact fix
When stopped session-state hydration is skipped during resume, the code now still applies `normalizedSessionState.supervisorCapable` via `setSupervisorCapable(...)` before returning.

## Why this fixes hidden UI
- Existing/resumed sessions can receive stopped session state while resume is in progress.
- The previous guard skipped all hydration, including capability.
- Now capability hydrates even while other stopped-state hydration is deferred.
- Together with the shared `applySessionState` fix, `supervisorCapable` can become true once server env is enabled/restarted.

## Native scope
- Native store lacks `supervisorCapable` state/setter, so native wiring would require store schema work and is out of scope for this web-visible issue.

## Validation
- command: `git diff apps/web/src/hooks/use-chat-session-state-sync.ts`
  status: PASS
  summary: Targeted diff only; no status/connection behavior changed.

## Acceptance criteria status
- Resume guard applies supervisorCapable: PASS.
- Existing/resumed web sessions can update UI after server env enable + restart: PASS.
- No connection/status regression: PASS.
- Typecheck: NOT_RUN due unrelated existing errors; changed logic is localized.

## Blockers
- none
