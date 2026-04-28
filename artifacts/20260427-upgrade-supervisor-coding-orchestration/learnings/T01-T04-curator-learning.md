---
artifact_type: learning_log
session_id: 20260427-upgrade-supervisor-coding-orchestration
task_id: upgrade-supervisor-coding-orchestration
producer: team-curator
status: PASS
created_at: 2026-04-27T00:00:00Z
source_commit: UNKNOWN
based_on:
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/01-triage-report.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/03-explorer-report.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/04-execution-plan.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/outputs/T01-builder-output.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/outputs/T02-builder-output.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/outputs/T03-builder-output.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/outputs/T04-builder-output.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/validation/T01-T04-validator-report.md
consumers:
  - orchestrator
freshness_rule: invalid_if_triage_validation_or_worker_output_changes
---
# Curator Log

## Recommendation
PROMOTE — session learning candidates only. Do not promote to durable memory without human review.

## Reusable lessons
1. Internal Semantic Action Layer with External Runtime Preservation
   - Use richer internal semantic decisions while preserving external runtime actions unchanged.
   - Internal: CONTINUE/APPROVE_GATE/CORRECT/REPLAN/DONE/ESCALATE/ABORT/SAVE_MEMORY/WAIT.
   - External: done/continue/needs_user/abort.
   - Use `mapSemanticToRuntime()` at the boundary; ensure semantic actions never leak into shared event schemas, UI contracts, or persistence.
2. Priority-Ordered Deterministic Classifier Pipeline
   - Run known deterministic patterns before LLM fallback.
   - Priority: option/gate -> memory recovery -> correct(done-without-verification) -> done-with-verification -> LLM.
   - First non-null classifier short-circuits; unsafe gate escalation must not fall through to LLM.
3. Non-Blocking Memory Capture via appendLog Reuse
   - For SAVE_MEMORY hot-path behavior, reuse existing `appendLog({ action: "save_memory" })` in try/catch.
   - Do not add a new port method unless persistence requirements become transactional.
   - Memory persistence failure must never block coding flow.
4. Structured 6-Section System Prompt Rewrite
   - Use Identity/Goal, Observation Protocol, Thought Checklist (no hidden CoT output), Finite Action Space, Completion Gate, Few-Shot Examples.
   - Keep examples short and validate with grep/tests for semantic action names and forbidden phrases.

## Routing heuristic candidates
- pattern: supervisor mediator semantic upgrades
  observed_signal: explorer + architect + builder succeeded; architect split T01/T02 parallel then T03/T04 serialized; validator PASS quality 100.
  suggested_adjustment: Use explorer_light_mapping_then_architect_contract_then_builder for supervisor semantic action upgrades. Team-heavy is not needed when scope stays supervisor-module-local and external contracts remain unchanged.
  confidence: HIGH
- pattern: module-local supervisor semantic upgrades complexity
  observed_signal: triage complexity 72/100; actual ticket complexities 15/45/55/30; no external contract leakage.
  suggested_adjustment: Treat module-local supervisor semantic upgrades as medium-high but often 10-15 points lower than initial risk if explorer confirms no UI/transport changes.
  confidence: MEDIUM
- pattern: parallel eligibility
  observed_signal: T01 types/schema and T02 prompt were file-disjoint and safe in parallel; T03 depended on both; T04 depended on all.
  suggested_adjustment: Ask architect to identify file-disjoint parallel tickets explicitly.
  confidence: MEDIUM

## Calibration signals
- complexity_delta: LOWER
  actual_complexity: T01=15/100, T02=45/100, T03=55/100, T04=30/100
  actual_risk_encountered: T01=10/100, T02=15/100, T03=30/100, T04=15/100
  recommended_future_executor: team-builder
  should_update_routing_metrics: YES
  rationale: Triage complexity 72/100 was slightly pessimistic but route was correct. Record as indicative single-session data point.
- executor_fit: GOOD
  recommended_future_pipeline: team-explorer -> team-architect -> team-builder tickets -> team-validator
  should_update_routing_patterns: YES
  rationale: Architect contract artifact prevented semantic action leakage and clarified SAVE_MEMORY shape.

## Human promotion candidates
- proposed_target: Project/opencode/agent-memory/patterns/internal-semantic-action-layer.md
  rationale: High-confidence pattern for preserving external runtime contracts while adding internal action semantics.
- proposed_target: Project/opencode/agent-memory/patterns/deterministic-classifier-pipeline.md
  rationale: High-confidence pattern for known supervisor orchestration states and safety-critical unsafe-gate handling.
- proposed_target: Project/opencode/agent-memory/patterns/non-blocking-memory-append.md
  rationale: High-confidence low-risk pattern for optional SAVE_MEMORY flow.
- proposed_target: Project/opencode/agent-memory/patterns/prompt-rewrite-structured-sections.md
  rationale: High-confidence pattern for prompt rewrites introducing finite action spaces.

## Suggested meta updates
- target_artifact: artifacts/meta/routing-patterns.md
  change: Add light pattern for supervisor mediator semantic upgrades: explorer + architect + builder, with explicit internal/external contract boundary.
- target_artifact: artifacts/meta/routing-metrics.md
  change: Add indicative single-session metric for supervisor_semantic_layer: triage_complexity=72, actual_ticket_complexities=15/45/55/30, quality=100.

## Vault writes
- status: SKIPPED
- note: No durable memory promotion was run; user did not request memory maintenance and no human review was provided.

## Notes
- Validator PASS quality 100/100.
- External runtime contract fully preserved.
- Pre-existing supervisor-permission.service.test.ts env issue unrelated.
