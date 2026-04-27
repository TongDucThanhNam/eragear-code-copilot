---
artifact_type: learning_log
session_id: 20260426-supervisor-ui-chatinput
task_id: T01
producer: team-curator
status: PASS
created_at: 2026-04-26T12:00:00.000Z
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/01-triage-report.md
  - artifacts/20260426-supervisor-ui-chatinput/decisions/D01-supervisor-capability-gated.md
  - artifacts/20260426-supervisor-ui-chatinput/03-explorer-report.md
  - artifacts/20260426-supervisor-ui-chatinput/04-execution-plan.md
  - artifacts/20260426-supervisor-ui-chatinput/tickets/ticket-T01-supervisor-chatinput-ui.md
  - artifacts/20260426-supervisor-ui-chatinput/outputs/T01-heavy-output.md
  - artifacts/20260426-supervisor-ui-chatinput/validation/T01-validation.md
consumers:
  - orchestrator
freshness_rule: invalid_if_triage_validation_or_worker_output_changes
---
# Curator Log

## Recommendation
PROMOTE

## Reusable lessons
- Backend/session-derived capability must gate safety-sensitive UI.
- Unsupported environment (`capability=false`) must be distinguishable from supported-but-off (`capability=true`, `mode=off`).
- Safety-sensitive mode mutations such as `full_autopilot` should be non-optimistic; UI reflects server-confirmed state only.
- Cross-cutting shared/server/web hook/UI changes usually need `team-heavy` when capability/DI wiring is involved.
- Minimal DI deviations for capability wiring can be acceptable if blast radius is small and explicitly validated.

## Routing heuristic candidates
- pattern: capability-gated safety-sensitive UI
  observed_signal: feature uses `full_autopilot` / auto-permission-resolution; safety risk if toggled without backend confirmation.
  suggested_adjustment: require backend/session capability field before UI enablement; route cross-cutting implementation to team-heavy.
  confidence: HIGH
- pattern: non-optimistic mutation for autopilot mode
  observed_signal: optimistic UI could falsely show safety-sensitive mode enabled if mutation fails.
  suggested_adjustment: use server-confirmed mode state and pending/error feedback only.
  confidence: HIGH

## Calibration signals
- complexity_delta: HIGHER
  actual_complexity: 75
  actual_risk_encountered: 40
  recommended_future_executor: team-heavy for DI/capability wiring + cross-cutting hook/UI work; team-builder for frontend-only follow-ups
  should_update_routing_metrics: NO
  rationale: strong signal but single feature/session; append routing-pattern note rather than changing routing metrics yet.

## Human promotion candidates
- proposed_target: Project/opencode/agent-memory/patterns/
  rationale: Capability-gated safety-sensitive UI is a durable pattern; validator confirmed PASS with quality score 92.
- proposed_target: Project/opencode/agent-memory/anti-patterns/
  rationale: Optimistic UI for autopilot mode mutation is a reusable anti-pattern.

## Suggested meta updates
- target_artifact: artifacts/meta/routing-patterns.md
  change: add lightweight note for safety-sensitive mode UI requiring backend capability + non-optimistic mutation.
- target_artifact: artifacts/meta/routing-metrics.md
  change: none yet; wait for repeated independent samples.

## Vault writes
- path: Project/opencode/sessions/Session - 2026-04-26 - T01-supervisor-chatinput-ui.md
  status: SKIPPED
  note: Curator reported session note path unavailable; this artifact serves as reviewable session log. No durable promotion performed.

## Notes
- Validator verdict: PASS, quality score 92, confidence HIGH.
- No durable memory promotion performed.
