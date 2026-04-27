---
session_id: 20260427-upgrade-supervisor-coding-orchestration
producer: team-architect
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: UNKNOWN
artifact_type: ticket
task_id: T01
consumers: team-builder/team-validator
based_on:
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/00-brief.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/01-triage-report.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/03-explorer-report.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/04-execution-plan.md
---

# T01: Semantic Types and Schema

## Title

Semantic Types and Schema

## Objective

Add internal semantic types, schema, and mapping to the supervisor decision port. No behavior changes — purely type-level additions.

## Allowed Files

- `apps/server/src/shared/types/supervisor.types.ts`
- `apps/server/src/modules/supervisor/application/supervisor.schemas.ts`
- `apps/server/src/modules/supervisor/application/ports/supervisor-decision.port.ts`
- `apps/server/src/modules/supervisor/index.ts` (optional re-export)

## Avoid

- `packages/shared/**`
- `apps/web/**`
- `supervisor-loop.service.ts`
- AI-SDK adapter
- Prompt builder
- Tests

## Requirements

### R1 — SupervisorSemanticAction Union

Add a `SupervisorSemanticAction` string union type with exactly these 9 values:

```typescript
type SupervisorSemanticAction =
  | "CONTINUE"
  | "APPROVE_GATE"
  | "CORRECT"
  | "REPLAN"
  | "DONE"
  | "ESCALATE"
  | "ABORT"
  | "SAVE_MEMORY"
  | "WAIT";
```

### R2 — SupervisorSemanticDecision

Add a `SupervisorSemanticDecision` interface:

```typescript
interface SupervisorSemanticDecision {
  semanticAction: SupervisorSemanticAction;
  runtimeAction: SupervisorDecisionAction;  // one of: "continue" | "done" | "needs_user" | "abort"
  reason: string;
  followUpPrompt?: string;
}
```

### R3 — Existing Types Unchanged

Keep `SupervisorDecisionAction` and `SupervisorDecisionSummary` exactly as-is. Do not modify their shapes or export types.

### R4 — SupervisorSemanticDecisionSchema

Add a Zod schema `SupervisorSemanticDecisionSchema`:

- `followUpPrompt` is **required** for: `CONTINUE`, `APPROVE_GATE`, `CORRECT`, `REPLAN`, `SAVE_MEMORY`
- `followUpPrompt` is **optional** for: `DONE`, `ESCALATE`, `ABORT`, `WAIT`
- Unknown semantic action values must be rejected

### R5 — mapSemanticToRuntime()

Export a pure function `mapSemanticToRuntime(action: SupervisorSemanticAction): SupervisorDecisionAction` with this mapping:

| Input           | Output       |
|-----------------|--------------|
| CONTINUE        | "continue"   |
| APPROVE_GATE    | "continue"   |
| CORRECT         | "continue"   |
| REPLAN          | "continue"   |
| DONE            | "done"       |
| ESCALATE        | "needs_user" |
| ABORT           | "abort"      |
| SAVE_MEMORY     | "continue"   |
| WAIT            | "needs_user" |

### R6 — Port Return Type

Change `SupervisorDecisionPort.decideTurn()` return type to `Promise<SupervisorSemanticDecision>`.

Keep `decidePermission()` unchanged.

## Validation

```bash
bun run check-types
grep -r "SupervisorSemanticAction" apps/server/src/
grep -r "mapSemanticToRuntime" apps/server/src/
```

## Execution Mode

**PARALLEL** — no dependencies on other tickets.

## Blockers

None.
