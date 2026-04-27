---
artifact_type: learning_log
session_id: 20260425-model-selector-lag
task_id: T02
producer: team-curator
status: PASS
created_at: 2026-04-26T00:05:00.000Z
source_commit: 5b0136289f57b8861c612dab9b515743cf32db7a
based_on:
  - artifacts/20260425-model-selector-lag/00-brief-v2.md
  - artifacts/20260425-model-selector-lag/01-triage-report-v2.md
  - artifacts/20260425-model-selector-lag/tickets/T02-full-data-filter-bounded-render.md
  - artifacts/20260425-model-selector-lag/outputs/T02-builder-output.md
  - artifacts/20260425-model-selector-lag/validation/T02-validation.md
consumers:
  - orchestrator
  - team-builder
  - team-validator
freshness_rule: invalid_if_triage_validation_or_worker_output_changes
---
# Curator Log

## Recommendation
PROMOTE

## Reusable lesson
For large cmdk-backed dropdown/selector lists: keep the full dataset in memory, perform external/full-data filtering first using controlled search logic, then render only a capped/windowed subset of the filtered results. Do not rely on cmdk to search unmounted items because cmdk filtering only operates on mounted `CommandItem` nodes.

## Implementation rules
1. Keep full dataset intact in data-only structures.
2. Derive `fullFilteredGroups` from all data before any rendering cap.
3. Derive `renderedModelGroups` by applying cap/window to the filtered result.
4. Render only `renderedModelGroups`.
5. Keep selection flow unchanged.
6. Keep cmdk primitives untouched unless a larger design is explicitly required.

## Routing heuristic candidates
- pattern: cmdk full-data filter before render cap
  observed_signal: T01 capped before filtering, causing search to miss unmounted items; T02 fixed by separating full-data filtering from bounded rendering.
  suggested_adjustment: For cmdk large-list fixes with render caps, flag search-scope as a first-class acceptance criterion. team-builder is still appropriate for localized consumer data-mapping changes.
  confidence: HIGH

## Calibration signals
- complexity_delta: HIGHER (+1)
  actual_complexity: 5
  actual_risk_encountered: 6
  recommended_future_executor: team-builder
  should_update_routing_metrics: NO
  rationale: Strong reusable pattern, but still one feature/session. Append routing-pattern note; avoid changing durable routing metrics until repeated across independent tasks.

## Human promotion candidates
- proposed_target: Project/opencode/agent-memory/patterns/cmdk-full-data-filter-pattern
  rationale: Durable pattern for cmdk-backed large lists; validator confirmed PASS with quality 93 and HIGH confidence. Requires human review before durable memory promotion.

## Vault writes
- path: Project/opencode/sessions/Session - 2026-04-25 - T02.md
  status: WRITTEN
  note: Reviewable session note written by curator. Human promotion to durable memory pending.

## Notes
- Validator verdict: PASS, quality=93, confidence=HIGH.
- No durable promotion performed.
- Suggested meta update: append to routing-patterns.md; do not update routing-metrics.md yet.
