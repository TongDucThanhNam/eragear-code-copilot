---
artifact_type: triage_report
session_id: 20260427-upgrade-supervisor-coding-orchestration
task_id: T00
producer: team-triage
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: unknown
based_on:
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/00-brief.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/RUN-INDEX.md
  - artifacts/20260427-supervisor-intent-timeline/validation/T01-validator-report.md
  - artifacts/20260427-supervisor-intent-timeline/learnings/T01-curator-learning.md
  - artifacts/meta/routing-metrics.md
  - artifacts/meta/routing-patterns.md
consumers:
  - orchestrator
  - team-vault-reader
  - team-explorer
  - team-architect
freshness_rule: invalid_if_brief_or_relevant_history_changes
---
# Triage Report

## Request class
- Server-side supervisor orchestration upgrade.
- Scope is broader than prior intent-timeline fix: adds finite semantic action space, deterministic classifiers, prompt rewrite, runtime compatibility mapping, and optional non-blocking memory save behavior.
- Expected primary blast radius remains in `apps/server/src/modules/supervisor/**`, especially decision schema/adapter, loop service, prompt builder, memory adapter/port, and focused tests.

## Summary
- This is a medium-high complexity, medium risk server-module task with safety-sensitive behavior around approval gates and completion decisions.
- It should use explorer + architect before implementation because the semantic action layer must remain compatible with existing external control actions.
- Recommended executor remains `team-builder` after design because current signals do not indicate UI/transport/cross-boundary heavy implementation.

## Scores
- complexity_score: 72/100
- risk_score: 62/100
- novelty_score: 58/100
- confidence_score: 78/100
- complexity_1_10: 7
- risk_1_10: 6
- novelty_1_10: 6
- confidence_1_10: 8

## Historical priors used
- artifact: artifacts/meta/routing-patterns.md
  signal: Prior supervisor snapshot/prompt tasks were server-module-local and succeeded with explorer + team-builder; actual complexity came in lower than estimated.
  impact_on_route: Keeps `initial_executor=team-builder`, but does not remove architect need because this request is broader than snapshot/prompt only.
- artifact: artifacts/20260427-supervisor-intent-timeline/validation/T01-validator-report.md
  signal: Prior related session passed with quality 92; approval gate safety and latest-user-instruction behavior were validated.
  impact_on_route: Reuse as regression baseline; AppLayout is only a fixture, not product scope.
- artifact: artifacts/20260427-supervisor-intent-timeline/learnings/T01-curator-learning.md
  signal: Forward pagination timeline and prompt precedence pattern are proven; unsafe approval regex should not be weakened.
  impact_on_route: Reduces uncertainty for observation protocol, but finite action-space design still requires explicit architecture.
- artifact: artifacts/meta/routing-metrics.md
  signal: Cross-boundary semantic changes carry higher risk than dev-only diagnostics; server-supervisor local changes generally fit builder when mapped.
  impact_on_route: Avoid team-heavy unless explorer finds transport/runtime boundary changes.

## Light repo signals
- path_or_pattern: `apps/server/src/modules/supervisor/application/supervisor.schemas.ts`
  why_it_matters: Current turn decision schema exposes only runtime control actions: `done`, `continue`, `needs_user`, `abort`; requested semantic actions require a compatibility mapping layer.
- path_or_pattern: `apps/server/src/modules/supervisor/application/ports/supervisor-decision.port.ts`
  why_it_matters: Snapshot already contains user timeline/latest assistant/compact summaries; likely additive design can build on existing port contracts.
- path_or_pattern: `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts`
  why_it_matters: Prompt already contains current user-approved scope and precedence language, but must be rewritten into finite action-space format with examples.
- path_or_pattern: `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts`
  why_it_matters: Deterministic classifiers and semantic-to-control mapping likely belong here or adjacent application service; safety behavior is centralized.
- path_or_pattern: `apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.ts`
  why_it_matters: LLM structured output adapter may need schema changes while preserving external runtime action compatibility.
- path_or_pattern: `apps/server/src/modules/supervisor/**/*test.ts`
  why_it_matters: Existing focused tests provide good regression surface; new tests should expand deterministic classifier, prompt safety, and AppLayout regression fixture.

## Routing recommendation
- needs_vault_context: NO
- needs_explorer: YES
- needs_architect: YES
- initial_executor: team-builder
- requires_human_decision: NO

## Machine-readable routing signals
- request_class: supervisor_orchestration_semantic_upgrade
- primary_area: apps/server/src/modules/supervisor
- expected_cross_boundary_change: NO
- expected_schema_change: YES
- safety_sensitive_gate_logic: YES
- needs_regression_tests: YES
- app_layout_is_fixture_only: YES
- preserve_runtime_control_actions: YES
- memory_persistence_must_be_non_blocking: YES
- recommended_next_step: team-explorer_light_mapping_then_team-architect_contract_design

## Rationale
- Explorer is needed to confirm all consumers of `SupervisorDecisionSummary`, current deterministic shortcuts, permission flow, memory lookup behavior, and test fixtures without deep repo mapping.
- Architect is recommended because the brief introduces a new semantic action vocabulary while preserving existing runtime control actions; this needs a small contract/design artifact to avoid mixing internal semantic state with external control actions.
- Team-builder should implement after the contract is clear because the likely code surface is still localized to the supervisor module and tests.
- Team-heavy is not recommended initially: no evidence yet of UI, transport, ACP protocol, or persistence-layer rewiring beyond supervisor memory behavior.
- Vault context is not required for triage or design; prior artifacts and code are enough. SAVE_MEMORY should be implemented as optional/non-blocking behavior without requiring direct vault reads.

## Alternative routes
- route: explorer -> team-builder, no architect
  tradeoff: Faster and historically successful for prompt/snapshot tasks, but riskier here because semantic actions, deterministic classifiers, and compatibility mapping can create contract drift.
- route: explorer -> architect -> team-heavy
  tradeoff: Safer if explorer finds cross-boundary runtime or persistence changes, but likely overkill unless supervisor decisions leak into transport/UI contracts.
- route: none/direct builder
  tradeoff: Not recommended; likely to under-spec semantic action mapping and safety gates.

## Human decision gate
- none

## Failure risk signals
- Semantic action names may leak into external runtime paths that currently accept only `continue`, `done`, `needs_user`, `abort`.
- Prompt rewrite may regress already-validated latest-user-instruction precedence.
- Deterministic safe-gate classifier could accidentally approve unsafe commit/push/deploy/destructive actions.
- DONE/CORRECT classifier may be brittle if based only on self-reported completion without test/verification evidence.
- SAVE_MEMORY could block coding flow or surface memory lookup errors as useful context if not explicitly filtered.
- Tests may accidentally overfit AppLayout even though it is only a regression fixture.

## Recommended next step
- Run `team-explorer` for a light supervisor-module map focused on decision schema consumers, deterministic classifier insertion points, memory adapter behavior, and existing tests.
- Then run `team-architect` to define semantic action contract and semantic-to-runtime-control mapping before implementation.

## Blockers
- none
