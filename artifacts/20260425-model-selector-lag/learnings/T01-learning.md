---
artifact_type: learning_log
session_id: 20260425-model-selector-lag
task_id: T01
producer: team-curator
status: PASS
created_at: 2026-04-26T00:00:00.000Z
source_commit: 7d4e82f
based_on:
  - artifacts/20260425-model-selector-lag/00-brief.md
  - artifacts/20260425-model-selector-lag/01-triage-report.md
  - artifacts/20260425-model-selector-lag/tickets/T01-model-selector-large-list.md
  - artifacts/20260425-model-selector-lag/outputs/T01-builder-output.md
  - artifacts/20260425-model-selector-lag/validation/T01-validation.md
consumers:
  - orchestrator
  - team-vault-reader
freshness_rule: invalid_if_triage_validation_or_worker_output_changes
---
# Curator Log

## Recommendation
PROMOTE

## Source artifacts
- 01-triage-report.md
- tickets/T01-model-selector-large-list.md
- outputs/T01-builder-output.md
- validation/T01-validation.md

## Durable product / engineering learnings
- target_path: Project/opencode/sessions/
  rationale: Reviewable session note for Obsidian queue; lesson reusable but needs human promotion before entering agent-memory
  content: Session note candidate created by curator
- none

## Session write policy
- allowed_write_path: Project/opencode/sessions/
- actual_session_note_path: Project/opencode/sessions/Session - 2026-04-25 - model-selector-lag.md
- note_schema: session_learning_candidate_v1

## Routing heuristic candidates
- pattern: frontend-command-list-performance
  observed_signal: Large model list rendered via cmdk CommandList; CommandList only scrolls, does not virtualize; all items and remote logos mount unconditionally
  suggested_adjustment: For cmdk-based list performance issues, prefer bounded rendering at consumer/data-mapping layer over modifying cmdk primitives. team-builder is appropriate for localized one-component changes.
  confidence: HIGH
- pattern: cmdk-hidden-coupling
  observed_signal: cmdk registers all mounted items internally for filtering/keyboard navigation regardless of visibility; bounding at consumer level prevents cmdk from even seeing items beyond cap, which is the performance safe-zone
  suggested_adjustment: When routing cmdk list performance issues, prefer consumer-level result-capping over virtualization of the CommandList itself; avoids breaking cmdk item registration, keyboard nav, and accessibility assumptions
  confidence: HIGH
- pattern: bounded-rendering-at-consumer-layer
  observed_signal: Bounded rendering in chat-input.tsx (consumer/data-mapping layer) preserved component API, avoided cmdk internals, and was sufficient to prevent freeze; only 50 items ever mount
  suggested_adjustment: Bounded rendering at the consumer layer is the minimal safe fix for list freeze when the underlying primitive (cmdk) does not natively support windowing. Prefer this over deep virtualization changes.
  confidence: HIGH
- pattern: search-scope-tradeoff
  observed_signal: Search filters only the bounded (50) result set; models beyond cap are not discoverable via search. This was documented as an acceptable UX tradeoff by the executor and confirmed by validator.
  suggested_adjustment: When implementing bounded-result strategies, explicitly document the search-scoping limitation in user-facing copy (e.g., hint text) and in session notes so future routing knows this is a known/acceptable tradeoff, not a bug.
  confidence: MEDIUM

## Calibration signals
- complexity_delta: +1
  actual_complexity: 5
  actual_risk_encountered: 6
  recommended_future_executor: team-builder
  should_update_routing_metrics: YES
  rationale: Triage complexity=4, risk=4 underestimated by 1. The cmdk item registration hidden coupling (all mounted items registered regardless of visibility) drove actual_risk=6. Routing to team-builder was correct. Recommend updating risk_score upward for cmdk-based list performance issues involving unbounded CommandList rendering.
- complexity_delta: MATCHED
  actual_complexity: 5
  actual_risk_encountered: 6
  recommended_future_executor: team-builder
  should_update_routing_metrics: NO
  rationale: Complexity was effectively matched (5 vs ticket estimated 4). Executor correctly identified and documented the hidden coupling. No further adjustment needed beyond the risk_score note above.

## Human promotion candidates
- proposed_target: Project/opencode/agent-memory/patterns/
  rationale: The bounded-rendering-at-consumer-layer pattern is reusable across any cmdk-based command list that needs performance protection without modifying the cmdk primitive itself. Well-scoped, retrieval-friendly, actionable.
- proposed_target: Project/opencode/agent-memory/routing-hints/
  rationale: The cmdk-hidden-coupling signal is reusable routing signal affecting risk score for similar issues.

## Vault writes
- path: Project/opencode/sessions/Session - 2026-04-25 - model-selector-lag.md
  status: WRITTEN
  note: Reviewable session note created per promotion recommendation. Human reviewer should evaluate for final promotion to agent-memory.

## Notes
- Validator verdict is PASS with quality score 87; promotion recommendation is YES
- This session's lesson is strong enough for a reviewable session note but not yet promoted to durable agent-memory
- complexity_delta was +1 (underestimated); this is a calibration signal for routing metrics update
- No durable delta written to agent-memory; only reviewable session note in sessions/
- The search-scope tradeoff is acceptable and documented; not a regression
- Missing test coverage for large-list model selector behavior is a known gap (pre-existing, not introduced by this change)
- recommended_future_executor: team-builder for similar localized cmdk list performance fixes
- should_update_routing_metrics: YES — risk_score for cmdk list performance issues should increase by 1-2 points due to hidden coupling
