---
session_id: 20260427-upgrade-supervisor-coding-orchestration
producer: team-architect
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: UNKNOWN
artifact_type: execution_plan
task_id: T00
consumers: orchestrator
based_on:
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/00-brief.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/01-triage-report.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/03-explorer-report.md
---

# Execution Plan — T00: Supervisor Coding Orchestration Upgrade

## Objective

Upgrade the Supervisor from a 4-action turn scanner into a generalized ACP coding orchestrator with a finite 9-action semantic decision space, deterministic classifiers, prompt rewrite, and non-blocking memory behavior — while preserving all external runtime actions and contracts.

## Architecture Decisions

### 1. Semantic Action Layer (Internal)

Introduce a 9-member internal semantic action union:

```
CONTINUE | APPROVE_GATE | CORRECT | REPLAN | DONE | ESCALATE | ABORT | SAVE_MEMORY | WAIT
```

This internal layer allows the supervisor to express granular intent without changing any external contract.

### 2. Runtime Action Layer (External — Unchanged)

The existing 4-action external runtime set is preserved unchanged:

```
done | continue | needs_user | abort
```

No changes to shared event schema, UI, or persistence contracts.

### 3. Semantic-to-Runtime Mapping Table

| Semantic Action  | Runtime Action |
|-----------------|----------------|
| CONTINUE        | continue       |
| APPROVE_GATE    | continue       |
| CORRECT         | continue       |
| REPLAN          | continue       |
| DONE            | done           |
| ESCALATE        | needs_user     |
| ABORT           | abort          |
| SAVE_MEMORY     | continue (with non-blocking appendLog side effect) |
| WAIT            | needs_user     |

### 4. Deterministic Classifier Pipeline (Priority Order)

```
1. Option/Gate classifier   → APPROVE_GATE or ESCALATE
2. Memory recovery          → CONTINUE
3. Correct (done-without-verification) → CORRECT
4. Done verification        → DONE
5. LLM fallback             → any semantic action
```

- Any deterministic classifier hit skips the LLM call entirely.
- `UNSAFE_OPTION_RE` and `selectAutopilotOption()` safety semantics are unchanged.
- All-unsafe options become explicit `ESCALATE` instead of LLM fallthrough.

### 5. SAVE_MEMORY Semantics

`SAVE_MEMORY` reuses the existing `SupervisorMemoryPort.appendLog({ action: "save_memory", ... })` in a try/catch block. No new port method is required. On failure, the error is logged and the dispatch proceeds (non-blocking).

### 6. Prompt Rewrite Structure

The supervisor turn system prompt is rewritten into sections:

1. **Identity / Goal** — defines what the supervisor is and its purpose
2. **Observation Protocol** — what the supervisor sees in each turn
3. **Thought Checklist** — explicit reasoning steps (no hidden chain-of-thought output)
4. **Finite Action Space** — all 9 semantic actions with trigger conditions
5. **Completion Gate** — conditions for declaring DONE
6. **Few-Shot Examples** — 2–3 concrete turn scenarios

### 7. Precedence / Guardrail Rules Preserved

- Precedence: latest human instruction > user instruction timeline > latest assistant proposal/gate > plan/artifacts > memory/blueprint > original task
- Unsafe option guidance: avoid commit/push/deploy/destructive/credential unless explicitly requested
- Memory/blueprint are guardrails (not goals) after user instructions

## Ticket Matrix

| Ticket | Title                      | Depends On | Execution Mode |
|--------|----------------------------|-----------|----------------|
| T01    | Semantic Types and Schema  | —         | PARALLEL       |
| T02    | Prompt Builder Rewrite     | —         | PARALLEL       |
| T03    | Loop Service + Adapter     | T01, T02  | SERIALIZE      |
| T04    | Supervisor Tests           | T01, T02, T03 | SERIALIZE  |

**Parallel eligibility:** T01 and T02 touch disjoint files and can run concurrently.
**Serialization:** T03 depends on types (T01) and prompt vocabulary (T02). T04 depends on all prior tickets.

## Risks

| Risk | Mitigation |
|------|-----------|
| Semantic action leakage into external contracts | `mapSemanticToRuntime()` is the only bridge; external surfaces use only 4 runtime actions |
| CORRECT false positives on ambiguous agent output | Classifier uses strict pattern matching; ambiguous cases fall through to LLM |
| Explicit ESCALATE behavior change from prior LLM fallthrough | All-unsafe option path now deterministic; monitored in T04 regression tests |
| Prompt rewrite regression on existing turn quality | T02 preserves all precedence/guardrail rules; T04 validates prompt contents |

## Blockers

None.

## Routing Decision

Architect created a 4-ticket plan. T01 and T02 are parallel-eligible. T03 and T04 are serialized. Initial executor: `team-builder`.

## Next Action

Run `team-builder` for T01 and T02 in parallel.
