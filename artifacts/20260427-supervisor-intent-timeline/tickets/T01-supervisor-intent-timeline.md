---
artifact_type: ticket
session_id: 20260427-supervisor-intent-timeline
task_id: T01
producer: orchestrator
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: unknown
based_on:
  - artifacts/20260427-supervisor-intent-timeline/00-brief.md
  - artifacts/20260427-supervisor-intent-timeline/01-triage-report.md
  - artifacts/20260427-supervisor-intent-timeline/03-explorer-report.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_brief_triage_or_explorer_changes
---
# T01 — Supervisor Reads Conversation Intent Timeline

## Owner
- team-builder

## Objective
Update supervisor snapshot and prompt context so supervisor reads compact chronological user instructions plus latest ACP assistant text, allowing latest explicit user scope to control routing without reading full transcript.

## Expected files to inspect/edit
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts`
- `apps/server/src/modules/supervisor/application/ports/supervisor-decision.port.ts`
- `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts`
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts`
- `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.test.ts`

## Boundaries
- Do not include full assistant/tool transcript in supervisor prompt.
- Do not change unrelated server ACP/session flow.
- Do not weaken safety around commit/push/deploy/destructive approval gates.
- Preserve `taskGoal` compatibility unless low-blast-radius rename is clearly safe.
- Keep latest assistant context limited to latest ACP assistant text part and compact tool/error summaries already supported.

## Required production changes
1. Add to `SupervisorTurnSnapshot`:
   - `originalTaskGoal: string`
   - `latestUserInstruction: string`
   - `userInstructionTimeline: string[]`
   - Keep `taskGoal` as compatibility/current scope field, semantically equivalent to `currentTaskGoal`.
2. In `supervisor-loop.service.ts` snapshot construction:
   - Page all session messages using `getMessagesPage(... direction: "forward" ...)` with cursor loop.
   - Collect only `role: "user"` messages into `userInstructionTimeline` in chronological order.
   - Bound payload: truncate each long user message and cap total timeline chars/messages so prompt remains bounded.
   - Set `originalTaskGoal` to first user message.
   - Set `latestUserInstruction` to last user message.
   - Derive current scope/`taskGoal` from latest/timeline user instruction rather than only first message.
   - Still derive `latestAssistantTextPart` only from latest assistant message.
   - Prefer latest user instruction for optional memory/research query context if those calls currently use first task goal.
3. In `supervisor-prompt.builder.ts`:
   - Show `User instruction timeline` before memory/blueprint sections.
   - State precedence clearly: latest human instruction > user instruction timeline > latest assistant proposal/gate > plan/artifacts > memory/blueprint > original task.
   - Replace wording `Continue the original user task` with `Continue the current user-approved scope`.
   - Keep memory/blueprint as guardrails after user instructions.
4. Approval gate behavior:
   - Safe latest assistant gate such as `Approve shell-only AppLayout pilot? route APP-T01 to team-builder` should produce/allow `continue` for `APP-T01`.
   - Unsafe gates containing commit/push/deploy/destructive actions must not be auto-approved.

## Required tests
Add/update `supervisor-loop.service.test.ts`:
- Earlier user asks reports/KPIGroup, later user says AppLayout priority; snapshot/prompt/current scope is AppLayout.
- `userInstructionTimeline` includes all user messages in chronological order.
- Latest assistant approval gate `Approve shell-only AppLayout pilot? route APP-T01 to team-builder` produces `continue` for `APP-T01`.
- Unsafe approval gates containing commit/push/deploy/destructive actions are not auto-approved.

Add/update `supervisor-prompt.builder.test.ts`:
- Prompt includes user instruction timeline and latest assistant text part.
- Prompt no longer says `Continue the original user task`.
- Memory/blueprint appears as guardrail after user instructions.

## Validation commands
Run at minimum, adapting paths as repo expects:
- `bun test apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts apps/server/src/modules/supervisor/application/supervisor-prompt.builder.test.ts`
- `bun run check-types` or the repo/server typecheck command if available.
- `bunx biome check` on changed server files if practical.

If a command fails due unrelated pre-existing issues or tool configuration, document the exact reason and whether changed files are implicated.

## Acceptance criteria
- Latest explicit user instruction controls supervisor current scope.
- Timeline contains all user instructions in chronological order but remains bounded.
- Latest assistant text part remains from latest assistant only; no full transcript exposure.
- Prompt ordering and precedence match brief.
- Safe APP-T01/team-builder approval continues; unsafe commit/push/deploy/destructive does not auto-approve.
- Targeted tests pass or any failure is clearly unrelated.

## Calibration requested from builder
Output artifact must include:
- files changed
- exact behavior implemented
- validation command results
- whether any server/session flow outside supervisor module changed
- approval safety notes
- actual_complexity
- actual_risk_encountered
- complexity_delta
- recommended_future_executor
- blockers, if any
