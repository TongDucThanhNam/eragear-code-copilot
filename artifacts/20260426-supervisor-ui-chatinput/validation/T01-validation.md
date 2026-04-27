---
artifact_type: validation
session_id: 20260426-supervisor-ui-chatinput
task_id: T01
producer: team-validator
status: PASS
created_at: 2026-04-26T12:00:00.000Z
source_commit: unknown
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/tickets/ticket-T01-supervisor-chatinput-ui.md
  - artifacts/20260426-supervisor-ui-chatinput/outputs/T01-heavy-output.md
consumers:
  - orchestrator
  - team-curator
freshness_rule: invalid_if_ticket_or_output_changes
---
# Validation

## Verdict
PASS

## Quality score
- overall_quality_score: 92
- correctness_score: 95
- regression_safety_score: 88
- validation_coverage_score: 82
- scope_discipline_score: 90
- complexity_delta: MATCHED

## Failure drivers
none — no high severity findings.

## Findings
- severity: medium
  file: apps/web/src/components/chat-ui/chat-input.tsx
  issue: `SupervisorControl` receives `onSetMode={onSetSupervisorMode}` but internally names the prop `onSetMode`; cosmetic naming inconsistency.
  suggested_fix: Optional follow-up rename internal prop to `onSetSupervisorMode`.
- severity: low
  file: apps/web/src/hooks/*.test.ts
  issue: No hook-level tests for supervisor capability hydration/reset/event wiring.
  suggested_fix: Optional follow-up tests.
- severity: low
  file: packages/shared/src/chat/use-chat-core.ts
  issue: `supervisorCapable` is session-state-derived only and not live-event updated; acceptable design.
  suggested_fix: Document if needed.

## Evidence
- Capability gating is backend/session-derived via `GetSessionStateService` and `deps.supervisorPolicy.enabled`.
- UI renders only when `connStatus === "connected" && supervisorCapable`.
- Unsupported and supported-but-off are distinguishable via `supervisorCapable` vs `supervisor.mode`.
- Supervisor status/decision event callbacks are wired through web hook stack.
- `setSupervisorMode` is non-optimistic and updates state only from server response.
- Warning copy appears inside Dialog; no one-click toolbar Full Autopilot toggle exists.
- One-line allowed-file deviation in `session-services.ts` is necessary and low blast-radius.

## Commands
- command: `bun run check-types`
  status: NOT_RUN by validator due environment limitations; worker reported PASS.
- command: code review / grep chain
  status: PASS

## Missing tests
- `use-chat-session-state-sync.test.ts` for capability hydration/reset.
- `use-chat-actions.test.ts` for mutation error/non-optimistic behavior.
- `supervisor-control.test.tsx` for dialog warning and enable/disable flow.

## Routing feedback
- triage_calibration: WELL_CALIBRATED
- executor_fit: GOOD
- recommended_pipeline_adjustment: NONE
- reason: team-heavy was correct for cross-cutting shared/server/web hook/UI work.

## Recommended next action
- NONE for delivery. Optional tests and naming cleanup later.

## Should promote to learning
YES

## Confidence
HIGH

## Blockers
none
