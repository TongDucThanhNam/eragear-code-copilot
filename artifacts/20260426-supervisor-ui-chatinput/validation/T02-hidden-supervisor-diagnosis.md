---
artifact_type: validation
session_id: 20260426-supervisor-ui-chatinput
task_id: T02-DIAGNOSIS
producer: team-explorer
status: NEEDS_FIX
created_at: 2026-04-26T00:00:00.000Z
source_commit: unknown
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/validation/user-report-env-added-still-hidden.md
  - artifacts/20260426-supervisor-ui-chatinput/validation/T01-revalidation-after-user-report.md
consumers: [orchestrator, team-builder, team-validator]
freshness_rule: valid until applySessionState/session resume hydration changes
---

# Diagnosis - Supervisor UI hidden after env enabled

## Findings
- `connStatus === "connected"` gate is valid; `ConnStatus` includes `"idle" | "connecting" | "connected" | "error"`.
- `supervisorCapable` is captured from server policy at startup, so server restart is required after env changes.
- `.env` path is `apps/server/.env` for the server dev script.
- Capability currently reflects `SUPERVISOR_ENABLED=true`; `SUPERVISOR_MODEL` is needed for actual supervisor decisions but not for the boolean capability flag.
- Critical bug: `packages/shared/src/chat/use-chat-core.ts` early returns for stopped sessions before applying `onSupervisorCapableChange`, so `supervisorCapable` stays false in React state for stopped/resumed sessions.
- Additional timing risk: resume flow can set connection status to connected before session-state hydration backfills `supervisorCapable`; backfill logic may skip capability.

## Likely root cause
- User added env but existing/stopped/resumed session never hydrates `supervisorCapable` into web state due early return/race.

## Recommended fix
- In `applySessionState`, apply `onSupervisorCapableChange(data.supervisorCapable ?? false)` before any early return for stopped state.
- Also patch resume/post-session-state sync if needed so `supervisorCapable` is not timing-dependent.
