---
artifact_type: ticket
session_id: "20260427-supervisor-policy-hardening"
task_id: T01
producer: team-architect
status: ACTIVE
created_at: "2026-04-27T23:00:00Z"
source_commit: UNKNOWN
based_on:
  - 00-brief.md
  - 01-triage-report.md
  - 03-explorer-report.md
  - 04-execution-plan.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_plan_brief_or_repo_context_changes
---
# Ticket T01 — Remove runtimeAction from LLM Output Schema

## Objective
Remove the `runtimeAction` field from `SupervisorSemanticDecisionSchema` so the LLM no longer wastes tokens generating a runtime concern that is already computed server-side via `mapSemanticToRuntime`. Priority #5 from brief.

## Assigned agent
team-builder

## Estimated complexity: 15
## Estimated risk: 10

## Routing rationale
Narrow schema-only change. The adapter already computes `runtimeAction` server-side and ignores the LLM-supplied value. Removing it from the Zod schema saves LLM output tokens with zero behavioral change. Low risk, builder-suitable.

## Context
The working tree has a semantic/runtime split in progress:
- `SupervisorSemanticDecisionSchema` in `supervisor.schemas.ts` currently includes `runtimeAction: z.enum(["continue","done","needs_user","abort"])`
- `AiSdkSupervisorDecisionAdapter.decideTurn()` receives LLM output → extracts `raw.semanticAction` → computes `runtimeAction = mapSemanticToRuntime(raw.semanticAction)` (line 57) → the LLM-provided `runtimeAction` is **never consumed**
- `mapSemanticToRuntime` in `supervisor.types.ts` maps all 9 semantic actions correctly
- The `SupervisorSemanticDecision` TypeScript interface in `supervisor.types.ts` keeps `runtimeAction` — that is internal, filled by the adapter

Change: remove only the Zod field. The TS interface and adapter stay unchanged.

## Relevant repo context
- `apps/server/src/modules/supervisor/application/supervisor.schemas.ts` — the Zod schema to modify (remove `runtimeAction` line ~62)
- `apps/server/src/modules/supervisor/application/supervisor.schemas.test.ts` — test fixtures include `runtimeAction`; update or leave (Zod ignores extras by default)
- `apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.ts` — verify adapter still compiles and computes runtimeAction correctly (no change needed)
- `apps/server/src/shared/types/supervisor.types.ts` — `mapSemanticToRuntime()` and `SupervisorSemanticDecision` type (do NOT touch)

## Allowed files
- `apps/server/src/modules/supervisor/application/supervisor.schemas.ts` (MODIFY)
- `apps/server/src/modules/supervisor/application/supervisor.schemas.test.ts` (MODIFY)

## Files to avoid
- All other files — do not touch adapter, loop service, types, ports, or any other module

## Constraints / invariants
1. Schema must still validate all 9 `semanticAction` values
2. `superRefine` rule for `followUpPrompt` must remain unchanged
3. No behavioral change — all existing decisions produce identical results
4. `bunx biome check` must pass

## Acceptance criteria
1. `SupervisorSemanticDecisionSchema` no longer has `runtimeAction` field in Zod definition
2. `safeParse({ semanticAction:"DONE", reason:"done" })` succeeds
3. `safeParse({ semanticAction:"CONTINUE", reason:"go", followUpPrompt:"next" })` succeeds
4. All `supervisor.schemas.test.ts` tests pass
5. Full supervisor test suite passes: `bun test src/modules/supervisor/`
6. `bunx biome check` passes for modified files

## Validation commands
```bash
cd apps/server
bun test src/modules/supervisor/application/supervisor.schemas.test.ts
bun test src/modules/supervisor/
bunx biome check src/modules/supervisor/application/supervisor.schemas.ts src/modules/supervisor/application/supervisor.schemas.test.ts
```

## Expected output
- `supervisor.schemas.ts`: `runtimeAction` field removed from `SupervisorSemanticDecisionSchema` Zod `.object({...})` (line ~62)
- `supervisor.schemas.test.ts`: test fixtures updated to remove `runtimeAction` from parse inputs
- All tests pass, no compilation errors

## Dependency: none
## Execution mode: PARALLEL
## Stop conditions
- TypeScript compilation error in adapter after schema change
- Test failures not fixable within allowed files
## Blockers: none
