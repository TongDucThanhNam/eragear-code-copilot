---
artifact_type: execution_plan
session_id: 20260426-supervisor-ui-chatinput
task_id: T00
producer: team-architect
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/00-brief.md
  - artifacts/20260426-supervisor-ui-chatinput/01-triage-report.md
  - artifacts/20260426-supervisor-ui-chatinput/decisions/D01-supervisor-capability-gated.md
  - artifacts/20260426-supervisor-ui-chatinput/03-explorer-report.md
consumers:
  - orchestrator
  - team-heavy
freshness_rule: invalid_if_brief_triage_decision_or_explorer_report_changes
---
# Execution Plan

## Objective
- Implement a minimal Supervisor configuration UI in/near `ChatInput`.
- Gate the UI by backend/session-reported supervisor capability per D01.
- Use existing `setSupervisorMode` tRPC API and existing shared supervisor status/decision types.
- Keep scope minimal: no Exa controls, no cmdk/virtualization concerns, no one-click unconditional Full Autopilot toggle.

## Plan summary
- Use one tightly scoped implementation ticket.
- Assign to `team-heavy` because the work crosses shared types, server session state, web hook plumbing, and safety-sensitive UI gating for `full_autopilot`.
- Do not split into backend and frontend tickets because the capability field and UI gate are strongly dependent and should be validated together.

## Ticket matrix
- T01 | owner: team-heavy | mode: SERIALIZE | depends_on: none

## Risks / unknowns
- `supervisorCapable` does not currently exist and must be added minimally to shared/session state.
- Web hook layer currently does not expose supervisor state or `setSupervisorMode`.
- Mutation failure must not leave UI implying Full Autopilot is enabled.
- Capability gating must distinguish unsupported from supported-but-off.
- Avoid expanding scope into Exa settings or unrelated command palette/virtualization work.

## Blockers
- none
