---
artifact_type: user_report
session_id: 20260426-supervisor-ui-chatinput
task_id: USER-REPORT-02
producer: orchestrator
status: ACTIVE
created_at: 2026-04-26T12:00:00.000Z
source_commit: unknown
based_on:
  - user_report
  - artifacts/20260426-supervisor-ui-chatinput/validation/T01-revalidation-after-user-report.md
consumers:
  - team-explorer
  - team-validator
  - team-heavy
freshness_rule: valid until runtime/gating cause is diagnosed
---

# User report - env added but Supervisor UI still hidden

## Report
User says: "Thêm rui sao vẫn chưa có ta :?"

## Context
- User previously could not see Supervisor UI in `apps/web`.
- Revalidation found files present and UI gated by connection status + `supervisorCapable`.
- User has now added supervisor env/config but still cannot see the UI.

## Required follow-up
- Diagnose actual gating/runtime conditions that can keep the UI hidden even after env is added.
- Check whether connection status comparison is correct for existing `connStatus` values.
- Check whether session state hydration includes `supervisorCapable` after server restart/new session.
- Check whether env is read from expected `apps/server/.env` path and whether model/policy requirements can still make capability false.
- If implementation bug exists, reroute fix.

## Status
PENDING
