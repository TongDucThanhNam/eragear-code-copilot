---
artifact_type: triage_report
session_id: 20260427-live-supervisor-prompt-rendering
task_id: T00
producer: team-triage
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: unknown
based_on:
  - artifacts/20260427-live-supervisor-prompt-rendering/00-brief.md
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
- Bounded web-client bug fix with targeted unit/handler tests.
- Scope centers on `apps/web/src/hooks/use-chat-turn-guards.ts` and related hook tests.
- No server supervisor-flow change requested.

## Scores
- complexity_score: 45
- risk_score: 42
- novelty_score: 35
- confidence_score: 82
- complexity_score_1_10: 5
- risk_score_1_10: 4
- novelty_score_1_10: 4
- confidence_score_1_10: 8

## Historical priors used
- artifact: artifacts/meta/routing-metrics.md
  signal: Bounded UI/render fixes previously routed well to team-builder when not cross-boundary.
  impact_on_route: Supports team-builder.
- artifact: artifacts/meta/routing-patterns.md
  signal: Cross-boundary ACP+tRPC+React diagnostics require team-heavy, but this task explicitly avoids server changes and targets client guard behavior.
  impact_on_route: Avoid over-escalation; no architect/heavy needed unless tests expose server/client contract mismatch.

## Light repo signals
- path_or_pattern: apps/web/src/hooks/use-chat-turn-guards.ts
  why_it_matters: Contains `resolveSessionEventTurnGuard`, the primary requested behavior change.
- path_or_pattern: apps/web/src/hooks/use-chat-turn-guards.test.ts
  why_it_matters: Existing focused tests cover turn adoption, blocked turns, mismatched turns, and late same-turn parts.
- path_or_pattern: apps/web/src/hooks/use-chat-session-event-handler.test.ts
  why_it_matters: Existing handler-level tests already model `reconcileActiveTurnIdAfterEvent` and message-state behavior; requested regression can be added here.
- path_or_pattern: apps/web/src/hooks/use-chat-session-event-handler.ts
  why_it_matters: Handler applies the guard result and message upsert path, but brief asks not to alter server flow.

## Routing recommendation
- needs_vault_context: NO
- needs_explorer: NO
- needs_architect: NO
- initial_executor: team-builder
- requires_human_decision: NO
- machine_readable_signals:
  - bounded_files: YES
  - production_code_change_expected: YES
  - tests_required: YES
  - server_change_requested: NO
  - cross_boundary_diagnostics: NO
  - stale_event_regression_risk: MEDIUM

## Rationale
- The requested fix is precise: accept/adopt a new server-initiated turn when the client is no longer busy, while preserving rejection of mismatched assistant/part/terminal stale-tail events.
- Blast radius appears limited to one guard helper plus two nearby test files.
- Risk is moderate because turn-guard logic protects against stale events; a too-broad accept condition could regress stale assistant/terminal rendering.
- Confidence is high because the brief identifies exact files, expected cases, and validation commands.

## Recommended next step
- Route to `team-builder` to implement the guard predicate and add the requested targeted tests.
- Run:
  - `bun test apps/web/src/hooks/use-chat-turn-guards.test.ts apps/web/src/hooks/use-chat-session-event-handler.test.ts`
  - `bunx biome check` on changed files

## Alternative routes
- route: team-heavy
  tradeoff: Safer if targeted tests reveal broader client/server event-order ambiguity, but likely overkill for current bounded brief.
- route: team-builder without explorer/architect
  tradeoff: Fastest path; acceptable because file targets and expected behavior are explicit.

## Human decision gate
- none

## Failure risk signals
- Accepting any new `turnId` too broadly could allow stale assistant/part/terminal events from another turn.
- Keeping `activeTurnId` after `ready/chat_finish` is intentional and must not be changed.
- Handler-level regression must verify live user/supervisor prompt upsert without reload.

## Blockers
- none
