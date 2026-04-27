---
artifact_type: ticket
session_id: 20260426-opencode-init-model-list-lag
task_id: T05
producer: orchestrator
status: ACTIVE
created_at: 2026-04-27
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-opencode-init-model-list-lag/00-brief-followup-continue.md
  - artifacts/20260426-opencode-init-model-list-lag/01-triage-report-T05.md
  - artifacts/20260426-opencode-init-model-list-lag/validation/T04-final-validation.md
  - artifacts/20260426-opencode-init-model-list-lag/learnings/T04-learning.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_followup_brief_or_triage_changes
---

# Ticket T05 — Add Capping Regression Coverage

## Objective
Continue optimization after T04 PASS by hardening regression coverage for Strategy B: client-facing session-state/broadcast payloads are capped, while internal server state remains uncapped for validation/default model behavior.

## Assigned agent
team-builder

## Scope
Implement targeted tests and only make a minimal code fix if a direct remaining client-facing full model-list leak is discovered.

## Allowed files
- `apps/server/src/modules/session/application/get-session-state.service.test.ts` or nearby existing session-state service test file (create if missing)
- `apps/server/src/modules/ai/application/set-model.service.test.ts`
- `apps/server/src/modules/ai/application/set-config-option.service.test.ts`
- `apps/server/src/platform/acp/update.test.ts` only if needed for shared helpers/assertions
- Minimal production file only if a test proves a remaining client-facing uncapped leak

## Avoid
- Protocol/schema files in `packages/shared/src/**`
- Web UI files
- Broad refactor of `capModelList` or session bootstrap
- Changing Strategy B semantics

## Requirements
1. Add explicit test coverage that `getSessionState` returns capped `models.availableModels` and capped model `configOptions.options` (<= `DEFAULT_MAX_VISIBLE_MODEL_COUNT`) for a running session with >100 models.
2. Test must verify the backing runtime/session object remains uncapped after `getSessionState` response is built.
3. Add or verify coverage that `set-model` can operate/validate correctly when the selected/target model is outside the capped client-visible list but present in internal uncapped state.
4. Add or verify coverage that `set-config-option` can operate/validate correctly under the same internal-uncapped assumption.
5. Inspect known client-facing session-state/broadcast paths for any remaining unbounded model `configOptions.options`; if a direct leak is found, fix minimally and test it.
6. Do not alter API shape or cap size.

## Acceptance criteria
- New/updated test for `getSessionState` capped response passes and asserts no internal mutation.
- New/updated set-model/set-config-option tests pass or existing tests are documented with exact coverage evidence.
- Targeted server tests pass for touched files.
- No new type errors in touched files.
- If no production fix is needed, worker output must explicitly state that T05 is test-hardening only.

## Validation commands
```bash
cd apps/server && bun test src/modules/session/application/get-session-state.service.test.ts
cd apps/server && bun test src/modules/ai/application/set-model.service.test.ts
cd apps/server && bun test src/modules/ai/application/set-config-option.service.test.ts
cd apps/server && bun run check-types
```

## Routing rationale
T04 final validation PASS left only low-priority explicit coverage gaps. Triage T05 scored complexity 42/risk 35 and recommended team-builder with escalation only if a new cross-boundary leak is found.

## Blockers
none
