---
artifact_type: ticket
session_id: 20260426-supervisor-ui-chatinput
task_id: T03
producer: orchestrator
status: ACTIVE
created_at: 2026-04-26T12:30:00.000Z
source_commit: unknown
based_on:
  - user_request
  - artifacts/20260426-supervisor-ui-chatinput/validation/T02-validation-final.md
  - artifacts/20260426-supervisor-ui-chatinput/validation/user-report-env-added-still-hidden.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_supervisor_ui_gating_or_hydration_code_changes
---

# T03 - Add targeted console debug for hidden Supervisor UI

## Problem
User reports Supervisor UI still does not appear after env config and hydration fixes. User asks: "Vẫn chưa hiện, cần thêm console nữa nha".

## Scope
Add targeted browser/server console diagnostics for Supervisor UI gating and capability hydration. Keep logs concise and easy to search. Avoid noisy repeated logs on every render if possible.

## Required debug signals
- In web ChatInput or adjacent UI gate: log the values controlling visibility: `connStatus`, `supervisorCapable`, `supervisor?.mode`, `supervisor?.status`, and whether SupervisorControl will render.
- In web session state sync/hydration: log when `supervisorCapable` is received/applied from session state, including stopped/resume guard paths.
- In server session state response or capability source: log `supervisorCapable`/`supervisorEnabled` when session state is requested, if safe and not too noisy.

## Constraints
- Debug logs should be temporary/development-friendly and prefixed consistently, e.g. `[SupervisorDebug]`.
- Do not log secrets or model API keys.
- Do not change UI behavior except adding diagnostics.
- Keep D01 capability-gated behavior unchanged.

## Acceptance criteria
- Browser console can show why Supervisor button is hidden or visible.
- Server logs can confirm whether backend returns `supervisorCapable=true`.
- Logs include enough context to distinguish: server capability false, session not connected, hydration not applied, or UI gate false.
- Typecheck/build or targeted validation passes if feasible.
