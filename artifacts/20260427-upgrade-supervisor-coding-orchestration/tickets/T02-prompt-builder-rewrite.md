---
session_id: 20260427-upgrade-supervisor-coding-orchestration
producer: team-architect
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: UNKNOWN
artifact_type: ticket
task_id: T02
consumers: team-builder/team-validator
based_on:
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/00-brief.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/01-triage-report.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/03-explorer-report.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/04-execution-plan.md
---

# T02: Prompt Builder Rewrite

## Title

Prompt Builder Rewrite

## Objective

Rewrite the supervisor turn system prompt into a finite semantic action format and harden follow-up/current-scope wording.

## Allowed Files

- `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts`

## Avoid

- All other files, especially:
  - Tests (T04)
  - Schemas/types (T01)
  - Loop/adapter (T03)
  - Permission prompt builder (unless unavoidable)

## Requirements

### R1 — Rewrite SUPERVISOR_TURN_SYSTEM_PROMPT

Restructure the prompt into these sections:

1. **Identity / Goal** — who the supervisor is, what its single purpose is
2. **Observation Protocol** — what data the supervisor receives each turn (snapshot, timeline, options, memory, plan)
3. **Thought Checklist** — explicit reasoning steps the supervisor must mentally perform (but NOT output as hidden chain-of-thought)
4. **Finite Action Space** — all 9 semantic actions with trigger conditions and examples
5. **Completion Gate** — specific conditions that must be met before the supervisor can declare DONE
6. **Few-Shot Examples** — 2–3 concrete turn scenarios showing supervisor decisions

### R2 — Mention All 9 Semantic Actions

The prompt must reference each of: `CONTINUE`, `APPROVE_GATE`, `CORRECT`, `REPLAN`, `DONE`, `ESCALATE`, `ABORT`, `SAVE_MEMORY`, `WAIT`, along with concise trigger conditions for each.

### R3 — Preserve Precedence Rule

The prompt must retain the existing precedence hierarchy:

```
latest human instruction > user instruction timeline > latest assistant proposal/gate
  > plan/artifacts > memory/blueprint > original task
```

### R4 — Preserve Unsafe Option Guidance

The prompt must instruct the supervisor to avoid commit, push, deploy, destructive, or credential actions unless explicitly requested by the user.

### R5 — Preserve Guardrail Guidance

Memory and blueprint entries are guardrails (constraints), not goals. They refine decisions after user instructions but never override explicit user intent.

### R6 — Update buildSupervisorTurnPrompt()

Update the `buildSupervisorTurnPrompt()` function labels and injected context to reference semantic action vocabulary (e.g., "choose the next semantic action" instead of "choose the next action").

### R7 — Harden buildSupervisorFollowUpPrompt()

The `buildSupervisorFollowUpPrompt()` function:

- MUST contain the phrase `current user-approved scope`
- MUST NOT contain the phrase `original user task`

### R8 — Permission Prompt Unchanged

Keep the permission prompt and its build function unchanged.

## Validation

```bash
# Check prompt contains all 9 action keywords
grep -c "CONTINUE\|APPROVE_GATE\|CORRECT\|REPLAN\|DONE\|ESCALATE\|ABORT\|SAVE_MEMORY\|WAIT" \
  apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts

# Check forbidden string absent
grep "original user task" apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts
# Expected: no output

# Check required string present
grep "current user-approved scope" apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts
# Expected: match

# Type-check
bun run check-types

# Run prompt builder tests (may fail until T04 — acceptable)
bun test apps/server/src/modules/supervisor/application/supervisor-prompt.builder.test.ts
```

## Execution Mode

**PARALLEL** — no dependencies on other tickets. Disjoint from T01 files.

## Blockers

None.
