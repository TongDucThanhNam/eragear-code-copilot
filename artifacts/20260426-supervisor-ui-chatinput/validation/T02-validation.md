---
artifact_type: validation
session_id: 20260426-supervisor-ui-chatinput
task_id: T02
producer: team-validator
status: NEEDS_FIX
created_at: 2026-04-26T00:00:00.000Z
source_commit: unknown
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/tickets/T02-fix-supervisor-capability-hydration.md
  - artifacts/20260426-supervisor-ui-chatinput/outputs/T02-builder-output.md
  - artifacts/20260426-supervisor-ui-chatinput/validation/T02-hidden-supervisor-diagnosis.md
consumers:
  - orchestrator
  - team-builder
freshness_rule: invalid_if_supervisor_capability_hydration_code_changes
---
# Validation

## Verdict
NEEDS_FIX

## Quality score
- overall_quality_score: 78
- correctness_score: 80
- regression_safety_score: 85
- validation_coverage_score: 65
- scope_discipline_score: 90

## Failure drivers
- Web resume race: `apps/web/src/hooks/use-chat-session-state-sync.ts` can skip stopped session-state hydration while `isResumingRef.current`, returning before `applySessionState`, so `supervisorCapable` may remain false.
- Native gap: `apps/native/hooks/use-chat-history-sync.ts` does not wire `onSupervisorCapableChange`; noted as cross-client gap from shared change, though user-visible issue is web.

## Findings
- Primary fix in `packages/shared/src/chat/use-chat-core.ts` is correct: stopped branch now applies `onSupervisorCapableChange` before returning.
- Additional web fix needed: ensure `supervisorCapable` is applied even when the resume guard skips other stopped-session hydration, or include capability in connected-session backfill logic.
- Optional/native fix: wire `onSupervisorCapableChange` in native apply state path if store supports it.

## Recommended next action
- Rerun builder for additional web race fix.
- Native fix only if minimal and supported; do not expand into broad native store refactor.

## Blockers
none
