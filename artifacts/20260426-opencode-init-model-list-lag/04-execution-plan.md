---
artifact_type: execution_plan
session_id: 20260426-opencode-init-model-list-lag
task_id: T00
producer: team-architect
status: ACTIVE
created_at: 2026-04-26
source_commit: UNKNOWN
based_on:
  - 00-brief.md
  - 01-triage-report.md
  - 03-explorer-report.md
consumers:
  - orchestrator
freshness_rule: invalid_if_brief_triage_vault_context_or_explorer_report_changes
---

# Execution Plan

## Objective

Implement **Strategy B**: cap OpenCode model lists at the server/session-state boundary (tRPC response + ACP broadcast), preserving the current/default selected model, adding explicit UI about the capped list, and keeping server-side `configOptions` uncapped for `set-model`/`set-config-option` validation integrity.

## Plan Summary

Three tickets:

| Ticket | Title | Team | Depends On |
|--------|-------|------|------------|
| T01 | Cap Model List Utility | team-builder | — |
| T02 | Apply Cap at Server Exit Points | team-heavy | T01 |
| T03 | UI Indicator for Capped List | team-builder | — |

## Cap Strategy

- **Internal state (server side)**: `session.configOptions` and `session.models.availableModels` remain **uncapped** — used for `set-model`, `set-config-option` validation.
- **Exit points (tRPC responses, ACP broadcasts)**: copies sent to clients are **capped**.
- **Preserve**: `currentModelId` / `currentValue` are always retained in the capped output.
- **Constant**: `DEFAULT_MAX_VISIBLE_MODEL_COUNT = 100`.
- **`config_option_update` ACP broadcast**: must be capped before transmitting to clients.

## Risks

- **Validation breakage**: mitigated by keeping internal state uncapped.
- **Search/browse semantics**: accepted tradeoff — users with >100 models must search.
- **`config_option_update` broadcast**: must not bypass the cap.

## Blockers

None.

## Execution Order

1. **T01** (team-builder): create cap utility + constant + tests.
2. **T02** (team-heavy, depends on T01): apply cap at `get-session-state.service.ts` and `apps/server/src/platform/acp/update.ts`.
3. **T03** (team-builder): UI indicator; can run in parallel but orchestrator may serialize to reduce merge risk.

## Next Action

Execute T01, then T02. T03 can run after or in parallel.
