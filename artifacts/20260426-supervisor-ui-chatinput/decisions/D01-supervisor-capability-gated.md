---
artifact_type: decision
session_id: 20260426-supervisor-ui-chatinput
task_id: D01
producer: orchestrator
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: unknown
based_on:
  - user_decision
  - artifacts/20260426-supervisor-ui-chatinput/01-triage-report.md
consumers:
  - team-explorer
  - team-builder
  - team-validator
freshness_rule: valid unless user changes supervisor UI safety policy
---

# Decision D01 - Supervisor UI capability gating

## Decision
- Use option 3: hide/disable Supervisor UI unless backend/session reports supervisor capability is available.

## Implications
- Do not expose a one-click Full Autopilot toggle unconditionally.
- UI may show disabled/unavailable state if capability is absent.
- If capability exists, configuration should still make the safety behavior clear.
- Prefer existing session/supervisor state or capability fields if available; avoid inventing unsupported frontend-only capability unless necessary.
