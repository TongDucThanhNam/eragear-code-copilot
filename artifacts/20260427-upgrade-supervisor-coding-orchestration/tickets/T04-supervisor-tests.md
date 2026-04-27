---
session_id: 20260427-upgrade-supervisor-coding-orchestration
producer: team-architect
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: UNKNOWN
artifact_type: ticket
task_id: T04
consumers: team-builder/team-validator
based_on:
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/00-brief.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/01-triage-report.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/03-explorer-report.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/04-execution-plan.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/tickets/T01-semantic-types-schema.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/tickets/T02-prompt-builder-rewrite.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/tickets/T03-loop-adapter-classifiers.md
---

# T04: Supervisor Tests

## Title

Supervisor Tests

## Objective

Adapt and add tests for the semantic action layer, deterministic classifiers, prompt safety, `SAVE_MEMORY` behavior, and the AppLayout-as-generic regression fixture.

## Depends On

- T01 (Semantic Types and Schema)
- T02 (Prompt Builder Rewrite)
- T03 (Loop Service + Adapter Integration)

## Allowed Files

- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts`
- `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.test.ts`
- `apps/server/src/modules/supervisor/application/supervisor.schemas.test.ts`
- `apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.test.ts`
- `apps/server/src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.test.ts`

## Avoid

- Production files
- `packages/shared/` event-schema test modifications
- `apps/web/`

## Test Requirements

### TR1 — Existing Tests Adapted and Passing

All existing supervisor test files must be adapted to the new semantic types and must pass.

### TR2 — Option Classifier Tests

- `createOptionQuestionDecision` returns `APPROVE_GATE` with a safe option selected
- `createOptionQuestionDecision` returns `ESCALATE` when all options are unsafe (per `UNSAFE_OPTION_RE`)
- `createOptionQuestionDecision` returns `null` when no options are present

### TR3 — Correct/Done Classifier Tests

- `createCorrectDecision` returns `CORRECT` (semantic) for agent self-reported "done" **without** verification
- `createDoneVerificationDecision` returns `DONE` (semantic) for agent self-reported "done" **with** verification artifacts

### TR4 — Semantic-to-Runtime Mapping

- `mapSemanticToRuntime()` covers all 9 semantic actions
- `SAVE_MEMORY` maps to `"continue"` runtime action
- Unknown/invalid semantic action throws or returns a safe default

### TR5 — Multi-Turn Scope Regression

Simulate a multi-turn session:
1. First user message requests scope A (e.g., reports)
2. Supervisor processes turn 1
3. Later user message switches to scope B (e.g., AppLayout)
4. Snapshot and `currentScope` must reflect the latest user instruction (scope B), not the original task (scope A)

### TR6 — Prompt Tests

- `SUPERVISOR_TURN_SYSTEM_PROMPT` contains all 9 semantic action keywords (`CONTINUE`, `APPROVE_GATE`, `CORRECT`, `REPLAN`, `DONE`, `ESCALATE`, `ABORT`, `SAVE_MEMORY`, `WAIT`)
- Few-shot examples are present in the prompt
- The timeline / latest ACP text part is present in the prompt
- The prompt does **not** contain the phrase `original user task`
- `buildSupervisorFollowUpPrompt()` output contains `current user-approved scope`

### TR7 — Schema Tests

- `SupervisorSemanticDecisionSchema` validates correctly:
  - `followUpPrompt` is required for `CONTINUE`, `APPROVE_GATE`, `CORRECT`, `REPLAN`, `SAVE_MEMORY`
  - `followUpPrompt` is optional for `DONE`, `ESCALATE`, `ABORT`, `WAIT`
  - Unknown semantic action values are rejected

### TR8 — Memory Adapter Tests

- Lookup errors do **not** become relevant memory (they are filtered out or handled gracefully)
- `appendLog` accepts `{ action: "save_memory" }` if needed by the test adapter contract

### TR9 — External Contracts Unchanged

- `packages/shared/src/chat/event-schema.test.ts` passes unchanged
- `apps/server/src/modules/supervisor/application/supervisor-permission.service.test.ts` passes unchanged

## Validation Commands

```bash
bun test apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts
bun test apps/server/src/modules/supervisor/application/supervisor-prompt.builder.test.ts
bun test apps/server/src/modules/supervisor/application/supervisor.schemas.test.ts
bun test apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.test.ts
bun test apps/server/src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.test.ts
bun test packages/shared/src/chat/event-schema.test.ts
bun test apps/server/src/modules/supervisor/application/supervisor-permission.service.test.ts
bun run check-types
```

All tests must pass.

## Execution Mode

**SERIALIZE** — must run after T01, T02, and T03 are complete.

## Blockers

None.
