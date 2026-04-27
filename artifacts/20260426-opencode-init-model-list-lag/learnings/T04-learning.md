---
artifact_type: learning_log
session_id: 20260426-opencode-init-model-list-lag
task_id: T04
producer: team-curator
status: PASS
created_at: 2026-04-26
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-opencode-init-model-list-lag/00-brief.md
  - artifacts/20260426-opencode-init-model-list-lag/01-triage-report.md
  - artifacts/20260426-opencode-init-model-list-lag/03-explorer-report.md
  - artifacts/20260426-opencode-init-model-list-lag/04-execution-plan.md
  - artifacts/20260426-opencode-init-model-list-lag/outputs/T01-output.md
  - artifacts/20260426-opencode-init-model-list-lag/outputs/T02-output.md
  - artifacts/20260426-opencode-init-model-list-lag/outputs/T04-output.md
  - artifacts/20260426-opencode-init-model-list-lag/validation/T04-final-validation.md
consumers:
  - orchestrator
freshness_rule: invalid_if_triage_validation_or_worker_output_changes
---

# Curator Log — Session 20260426-opencode-init-model-list-lag
- Recommendation: PROMOTE CANDIDATES after human review only; do not auto-promote.
- Vault/session-note write status: BLOCKED/NOT_DONE because Obsidian CLI unavailable; artifact-only learning.

## Reusable patterns
1. Cap-at-server-exit-boundary with internal uncapped state:
   - Keep `session.configOptions` and `session.models.availableModels` uncapped internally for validation/default model logic.
   - Apply cap only to copies sent through tRPC `getSessionState` and ACP `config_options_update` broadcasts.
   - Preserve `currentModelId`/`currentValue` in capped outputs.
2. Cross-boundary ACP+tRPC+React performance bugs need architect/team-heavy:
   - If issue spans ACP bootstrap/update, server runtime/session-state, client state sync, and React render, route complexity upward and avoid builder-only fixes except isolated utility/UI subtasks.
3. PARTIAL worker output is a repair trigger:
   - T02 reported that configOptions were normalized but not truncated. This was a strong signal to create T04 instead of accepting a false PASS.

## Anti-patterns
- Treating render cap as sufficient when init lag is caused by server payload/state duplication.
- Capping only `models.availableModels` while leaving model `configOptions.options` unbounded in client-facing payloads.
- Mutating internal server state to cap client payloads; this risks breaking validation/default model logic.

## Calibration signals
- complexity_delta: HIGHER
- actual_complexity: 80-85
- actual_risk_encountered: HIGH (partial implementation left configOptions broadcast unbounded until T04)
- recommended_future_executor: team-heavy for cross-boundary capping/integration; team-builder only for isolated utility or UI subtasks
- should_update_routing_metrics: YES

## Promotion candidates (human review required)
- patterns/cap-at-server-exit-boundary-with-internal-uncapped-state.md
- anti-patterns/unbounded-configoptions-client-payload.md
- routing-hints/cross-boundary-acp-trpc-react-performance-team-heavy.md

## Suggested meta updates
- routing-metrics: cross-boundary ACP+tRPC+React performance base complexity 80+, executor team-heavy; add SDK union/null coupling complexity buffer; treat PARTIAL on capping tickets as repair trigger.
- routing-patterns: record cap-at-exit/internal-uncapped pattern and anti-pattern of only capping model array while leaving configOptions unbounded.
