---
artifact_type: ticket
session_id: 20260426-opencode-init-model-list-lag
task_id: T04
producer: orchestrator
status: ACTIVE
created_at: 2026-04-26
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-opencode-init-model-list-lag/tickets/T01-cap-model-list-utility.md
  - artifacts/20260426-opencode-init-model-list-lag/tickets/T02-apply-server-exit-cap.md
  - artifacts/20260426-opencode-init-model-list-lag/outputs/T01-output.md
  - artifacts/20260426-opencode-init-model-list-lag/outputs/T02-output.md
  - artifacts/20260426-opencode-init-model-list-lag/03-explorer-report.md
consumers:
  - team-heavy
  - team-validator
freshness_rule: invalid_if_T01_or_T02_output_changes
---

# Ticket T04 — Fix ConfigOptions Truncation

## Objective
Fix the partial T01/T02 implementation so `capModelList()` actually truncates the model `SessionConfigOption.options` payload sent to clients, not merely normalizes/reorders it. This is required to reduce OpenCode huge model-list broadcast/session-state payload size under Strategy B.

## Assigned agent
team-heavy

## Problem
T02 output reported: `capModelList` normalizes config options (currentValue first) but does NOT truncate config option option arrays. Therefore ACP `config_options_update` broadcast may still carry the full OpenCode model list, missing T02 acceptance criteria and leaving the main lag root cause unresolved.

## Scope
Allowed files:
- `apps/server/src/shared/utils/session-config-options.util.ts`
- `apps/server/src/shared/utils/session-config-options.util.test.ts`
- `apps/server/src/modules/session/application/get-session-state.service.ts` only if integration adjustment needed
- `apps/server/src/platform/acp/update.ts` only if integration adjustment needed
- `apps/server/src/platform/acp/update.test.ts`

Avoid:
- protocol/schema files in `packages/shared/src/**`
- set-model/set-config-option services unless tests prove validation broken
- web files

## Requirements
1. `capModelList()` must return capped `configOptions` copies where the model config option's visible values are bounded by `maxVisible` (default 100).
2. It must preserve the option matching `currentValue` even if outside first maxVisible.
3. It must preserve `models.availableModels` currentModelId similarly.
4. It must not mutate input models/configOptions or server session state.
5. It should handle nested grouped model options by flattening the returned capped model option to a bounded flat options array if needed.
6. It must report `truncated: true` if either models or configOptions were truncated.
7. `get-session-state.service.ts` response and `config_options_update` broadcast must both have bounded model option values.
8. Internal server state remains uncapped for validation.

## Acceptance criteria
- Unit test: 200 nested/grouped model config options -> capped returned configOptions has <=100 option values and includes currentValue at end/front as deterministic.
- Unit test: no currentValue -> first 100 values only.
- Unit test: currentValue already in first 100 -> still <=100 and no duplicate.
- Unit test: `maxVisible=0` behavior is explicit and deterministic (prefer empty unless preservation semantics intentionally require 1; document/test whichever is implemented consistently).
- Integration/update test: config_options_update broadcast model option values <=100 while session.configOptions source remains 200.
- Integration/state test or existing test evidence: getSessionState returned configOptions model values <=100 and availableModels <=100.
- Server targeted tests pass: utility test and update test at minimum; server typecheck no new errors in touched files.

## Validation commands
```bash
cd apps/server && bun test src/shared/utils/session-config-options.util.test.ts
cd apps/server && bun test src/platform/acp/update.test.ts
cd apps/server && bun run check-types
cd apps/server && bunx biome check src/shared/utils/session-config-options.util.ts src/shared/utils/session-config-options.util.test.ts src/platform/acp/update.ts src/platform/acp/update.test.ts
```

## Routing rationale
Prior builder implementation underestimated SDK/config-option union complexity; T02 became PARTIAL. Use team-heavy to repair cross-file semantics and tests.

## Blockers
none
