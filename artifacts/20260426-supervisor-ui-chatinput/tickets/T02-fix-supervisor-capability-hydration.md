---
artifact_type: ticket
session_id: 20260426-supervisor-ui-chatinput
task_id: T02
producer: orchestrator
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: unknown
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/validation/T02-hidden-supervisor-diagnosis.md
  - artifacts/20260426-supervisor-ui-chatinput/validation/user-report-env-added-still-hidden.md
consumers: [team-builder, team-validator]
freshness_rule: invalid_if_supervisor_capability_hydration_code_changes
---

# T02 - Fix supervisor capability hydration so ChatInput UI appears after env enablement

## Problem
Supervisor UI is capability-gated on `connStatus === "connected" && supervisorCapable`. After enabling env, `supervisorCapable` can remain false in web state because shared `applySessionState` returns early for stopped sessions before applying the capability flag, and resume timing can skip backfill.

## Scope
- Minimal fix to hydrate `supervisorCapable` reliably from session state.
- Prefer shared/core fix first; add web resume/state-sync fix only if needed.
- Keep existing D01 behavior: UI hidden unless connected and capable.
- Do not change supervisor UI design or env names.

## Acceptance criteria
- `supervisorCapable` from session state is applied even when session state status is `stopped`.
- Existing/resumed sessions can update UI after server env is enabled and server restarted.
- No regression to connection/status hydration.
- Typecheck/build or relevant validation passes.
- Output includes exact user troubleshooting note: restart server after `.env` changes and open/resume a connected session.
