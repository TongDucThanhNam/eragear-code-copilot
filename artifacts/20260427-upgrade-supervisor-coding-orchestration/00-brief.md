---
artifact_type: brief
session_id: 20260427-upgrade-supervisor-coding-orchestration
task_id: upgrade-supervisor-coding-orchestration
producer: orchestrator
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: unknown
based_on:
  - user_request:upgrade-supervisor-coding-orchestration
  - artifacts/20260427-supervisor-intent-timeline/validation/T01-validator-report.md
  - artifacts/20260427-supervisor-intent-timeline/learnings/T01-curator-learning.md
consumers:
  - team-triage
freshness_rule: valid for current user request only
---

# Brief: Upgrade Supervisor Coding Orchestration

## Objective
Upgrade Supervisor into a generalized mediator/controller for ACP coding sessions. It must read multi-turn user intent, classify worker/session state with a finite semantic action space, and inject precise follow-up prompts for worker continuation. `AppLayout` is only a regression example, not product scope.

## Requested changes
### Observation Protocol
- Build `userInstructionTimeline` from all user messages in chronological order.
- Extract `currentIntent`, `latestUserInstruction`, `explicitConstraints`, and `scopeOverrides`.
- Read only latest ACP assistant text-part as worker state.
- Keep compact recent tool/error summary; do not read full assistant transcript.

### Intent Precedence
- Latest explicit user instruction wins over older user scope.
- Memory/Obsidian/project blueprint are guardrails, not active scope owners.
- Remove hardcoded wording like `Continue the original user task`.

### Finite Action Space
- Add semantic decision layer with actions:
  - `CONTINUE`
  - `APPROVE_GATE`
  - `CORRECT`
  - `REPLAN`
  - `DONE`
  - `ESCALATE`
  - `ABORT`
  - `SAVE_MEMORY`
  - `WAIT`
- Keep external runtime compatibility by mapping semantic actions to existing control actions where needed: `continue`, `done`, `needs_user`, `abort`.

### Prompt Builder
- Rewrite Supervisor system prompt into:
  - identity/goal
  - observation protocol
  - thought checklist without hidden CoT output
  - finite action space
  - completion gate
  - few-shot examples
- Follow-up prompt must say `current user-approved scope`, not `original task`.

### Deterministic Routing
- Add deterministic classifiers for common coding orchestration states:
  - worker asks for safe approval gate -> `APPROVE_GATE`
  - worker self-reports done but lacks tests/verification -> `CORRECT`
  - worker asks user to choose from safe options -> select option and continue
  - worker blocked by missing context but memory has context -> continue with recovered context

### Artifacts/Memory
- Filter memory lookup errors so they do not become `Relevant local memory`.
- Add optional `SAVE_MEMORY` path for useful learnings, but do not block coding flow if memory persistence fails.

## Required tests
- Multi-turn intent:
  - User first asks scope A, later switches to scope B; Supervisor follows scope B.
- Gate handling:
  - Worker asks for safe approval; Supervisor emits approval prompt instead of asking human.
  - Unsafe gate involving commit/push/deploy/destructive action is escalated.
- Partial completion:
  - Worker says done but no validation; Supervisor emits corrective prompt.
- Prompt safety:
  - System/follow-up prompt contains user timeline and latest ACP text-part.
  - Prompt does not contain `original user task`.
- Regression:
  - Previous `AppLayout` example routes to latest user-approved scope as a generic test case.

## Assumptions
- Supervisor should be a generalized ACP coding orchestrator.
- Context optimization: all user messages, latest ACP text part, and compact tool/error summaries only.
- UI-specific examples are regression fixtures, not product scope.

## Non-goals / safety boundaries
- Do not read or inject full assistant/tool transcript into supervisor prompt.
- Do not weaken unsafe gate handling for commit/push/deploy/destructive actions.
- Do not bypass external runtime compatibility for existing `continue/done/needs_user/abort` control actions.
- Do not make memory persistence failure block the coding flow.
