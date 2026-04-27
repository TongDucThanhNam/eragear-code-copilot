---
artifact_type: brief
session_id: 20260427-supervisor-intent-timeline
task_id: supervisor-reads-conversation-intent-timeline
producer: orchestrator
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: unknown
based_on:
  - user_request:supervisor-reads-conversation-intent-timeline
consumers:
  - team-triage
freshness_rule: valid for current user request only
---

# Brief: Supervisor Reads Conversation Intent Timeline

## Objective
Change supervisor snapshot/prompt behavior from "first user task + latest assistant text" to "all compact user instructions + latest ACP assistant text", so supervisor decisions respect the latest explicit user scope without reading the full heavy transcript.

## Requested changes
- In `supervisor-loop.service.ts`, add conversation intent extraction:
  - Page all session messages with `direction: "forward"`.
  - Collect only `role: "user"` messages into `userInstructionTimeline` in chronological order.
  - Keep `originalTaskGoal` as the first user message.
  - Keep `latestUserInstruction` as the last user message.
  - Derive `currentTaskGoal` from the timeline, not only the first message.
  - Still derive `latestAssistantTextPart` from latest assistant message only.
- Update `SupervisorTurnSnapshot`:
  - Add `originalTaskGoal`, `latestUserInstruction`, `userInstructionTimeline`.
  - Keep existing `taskGoal` temporarily as `currentTaskGoal` for compatibility, or rename internally if low blast radius.
- Update supervisor prompt:
  - Show "User instruction timeline" before memory/blueprint.
  - State precedence: latest human instruction > user instruction timeline > latest assistant proposal/gate > plan/artifacts > memory/blueprint > original task.
  - Remove/replace wording "Continue the original user task" with "Continue the current user-approved scope".
- Keep payload bounded:
  - Include all user messages, but truncate long messages and cap total prompt chars.
  - Never include full assistant/tool transcript; only latest ACP assistant text part plus compact tool/error summaries.
- Approval gate behavior:
  - If latest assistant asks approval to route a safe ticket like `APP-T01` to `team-builder`, supervisor should approve and continue.
  - Do not redirect to older KPIGroup/reports scope when latest user instruction says AppLayout first.

## Required tests
- `supervisor-loop.service.test.ts`:
  - Earlier user asks reports/KPIGroup, later user says AppLayout priority; snapshot/prompt current scope is AppLayout.
  - User instruction timeline includes all user messages in chronological order.
  - Latest assistant approval gate `Approve shell-only AppLayout pilot? route APP-T01 to team-builder` produces `continue` for `APP-T01`.
  - Unsafe approval gates containing commit/push/deploy/destructive actions are not auto-approved.
- `supervisor-prompt.builder.test.ts`:
  - Prompt includes user instruction timeline and latest assistant text part.
  - Prompt no longer says "Continue the original user task".
  - Memory/blueprint appears as guardrail after user instructions.

## Assumptions
- "All conversation" means all user messages plus latest ACP assistant text part, not full assistant/tool transcript.
- User messages are usually small; truncation exists only as a safety cap.
- Latest explicit user scope controls supervisor routing.

## Non-goals
- Do not add full assistant/tool transcript to supervisor payload.
- Do not change unrelated server ACP/session flow.
- Do not bypass approval safety for commit/push/deploy/destructive actions.
