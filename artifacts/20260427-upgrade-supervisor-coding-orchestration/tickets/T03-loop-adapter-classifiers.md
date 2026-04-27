---
session_id: 20260427-upgrade-supervisor-coding-orchestration
producer: team-architect
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: UNKNOWN
artifact_type: ticket
task_id: T03
consumers: team-builder/team-validator
based_on:
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/00-brief.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/01-triage-report.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/03-explorer-report.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/04-execution-plan.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/tickets/T01-semantic-types-schema.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/tickets/T02-prompt-builder-rewrite.md
---

# T03: Loop Service + Adapter Integration

## Title

Loop Service + Adapter Integration

## Objective

Integrate semantic decisions into the supervisor loop service and AI-SDK adapter. Add deterministic classifiers, mapping dispatch, and the `SAVE_MEMORY` non-blocking side effect.

## Depends On

- T01 (Semantic Types and Schema)
- T02 (Prompt Builder Rewrite)

## Allowed Files

- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts`
- `apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.ts`

## Avoid

- `packages/shared/**`
- `apps/web/**`
- Prompt builder
- Schemas/types
- Permission service
- Tests
- Session persistence

## Requirements

### R1 — Adapter decideTurn() Overhaul

The `decideTurn()` method in the AI-SDK adapter must:

- Parse LLM output using `SupervisorSemanticDecisionSchema`
- Compute `runtimeAction` via `mapSemanticToRuntime()`
- Return `SupervisorSemanticDecision`
- `decidePermission()` remains unchanged

### R2 — Deterministic Classifier: Option/Gate

Implement `createOptionQuestionDecision(snapshot)`:

- If a **safe** option is selected via `selectAutopilotOption()`, return `APPROVE_GATE` with `runtimeAction: "continue"` and the option's auto-accept payload as `followUpPrompt`
- If options exist but **all are unsafe** (per `UNSAFE_OPTION_RE`), return `ESCALATE` with `runtimeAction: "needs_user"`
- If no options present, return `null` (pass through to next classifier)

### R3 — Deterministic Classifier: Memory Recovery

Implement `createMemoryRecoveryDecision(snapshot, memoryPort)`:

- Return semantic `CONTINUE` with `runtimeAction: "continue"` and a recovery prompt
- Use existing memory port lookup; do not introduce new port methods

### R4 — Deterministic Classifier: Correct

Implement `createCorrectDecision(snapshot)`:

- Detect when the agent self-reports "done" but without verification artifacts
- Return semantic `CORRECT` with `runtimeAction: "continue"` and a corrective `followUpPrompt`

### R5 — Deterministic Classifier: Done Verification

Implement `createDoneVerificationDecision(snapshot)`:

- Detect when the agent self-reports "done" **with** verification artifacts
- Return semantic `DONE` with `runtimeAction: "done"`

### R6 — Classifier Pipeline Order

Apply classifiers in strict priority order:

```
option/gate → memory recovery → correct → done verification → LLM fallback
```

- First classifier that returns a non-null decision short-circuits the pipeline
- LLM is only invoked if all classifiers return null
- The LLM fallback returns a `SupervisorSemanticDecision`

### R7 — applyDecision() Dispatch

`applyDecision(decision: SupervisorSemanticDecision)` dispatches based on `decision.runtimeAction`:

- `"continue"` → broadcast continue and send follow-up prompt
- `"done"` → mark session complete
- `"needs_user"` → escalate to user
- `"abort"` → abort the session

The broadcast payload must use `SupervisorDecisionSummary` with only the 4 runtime actions (no semantic action leakage).

### R8 — SAVE_MEMORY Side Effect

When `decision.semanticAction === "SAVE_MEMORY"`:

- **Before** dispatch, call `memoryPort.appendLog({ action: "save_memory", ... })` inside try/catch
- On failure, log the error only — never block the dispatch
- After the memory write (success or failure), proceed with normal `continue` dispatch

### R9 — appendSupervisorLog() Audit

The `appendSupervisorLog()` function should record the semantic action in its `action` field where appropriate for auditability.

### R10 — Preserved Functions (Do Not Change)

Do **not** modify:
- `UNSAFE_OPTION_RE` regex
- `selectAutopilotOption()`
- `buildSnapshot()`
- `prepareReview()`

## Validation

```bash
bun run check-types

# Verify runtimeAction only uses the 4 external values
grep "runtimeAction" apps/server/src/modules/supervisor/application/supervisor-loop.service.ts
grep "runtimeAction" apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.ts

# Verify SupervisorSemanticDecisionSchema is used
grep "SupervisorSemanticDecisionSchema" apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.ts

# Verify UNSAFE_OPTION_RE unchanged
grep "UNSAFE_OPTION_RE" apps/server/src/modules/supervisor/application/supervisor-loop.service.ts

# Run loop/adapter tests (may fail until T04 — acceptable)
bun test apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts
bun test apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.test.ts
```

## Execution Mode

**SERIALIZE** — must run after T01 and T02 are complete.

## Blockers

None.
