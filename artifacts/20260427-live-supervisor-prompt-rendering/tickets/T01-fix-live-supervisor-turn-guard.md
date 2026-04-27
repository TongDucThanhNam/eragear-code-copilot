---
artifact_type: ticket
session_id: 20260427-live-supervisor-prompt-rendering
task_id: T01
producer: orchestrator
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: unknown
based_on:
  - artifacts/20260427-live-supervisor-prompt-rendering/00-brief.md
  - artifacts/20260427-live-supervisor-prompt-rendering/01-triage-report.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_triage_or_brief_changes
---
# T01 — Fix Live Supervisor Prompt Rendering Turn Guard

## Owner
- team-builder

## Objective
Fix the web client turn guard so a server-initiated supervisor follow-up prompt appears live without requiring reload, while preserving stale-tail protections.

## Files expected to inspect/edit
- `apps/web/src/hooks/use-chat-turn-guards.ts`
- `apps/web/src/hooks/use-chat-turn-guards.test.ts`
- `apps/web/src/hooks/use-chat-session-event-handler.test.ts`

Do not change server supervisor flow unless tests prove the brief assumption is false.

## Required behavior
1. In `resolveSessionEventTurnGuard`, when current client status is not busy (`ready`, `inactive`, `error`) and an incoming `chat_status` event is busy (`submitted`, `streaming`, `awaiting_permission`, `cancelling`) with a new/mismatched `turnId`, accept the event and adopt the new `turnId`.
2. If the first event of a new turn arrives as `ui_message` with role `user` and a new/mismatched `turnId` while current client status is not busy, accept/adopt it.
3. Continue to ignore mismatched assistant messages, part updates, and terminal events to prevent stale tail from other turns.
4. Keep `reconcileActiveTurnIdAfterEvent` behavior unchanged so late same-turn part updates after `ready/chat_finish` remain accepted.
5. Avoid polling/reload workarounds.

## Required tests
- Add/adjust focused guard tests:
  - `ready + activeTurnId=turn-1` receiving `chat_status submitted turn-2` is accepted and returns/adopts active turn `turn-2`.
  - `ready + activeTurnId=turn-1` receiving `ui_message user turn-2` is accepted/adopted.
  - `ready + activeTurnId=turn-1` receiving mismatched assistant/part/terminal events remains ignored.
- Add/adjust handler-level regression:
  - After `chat_finish turn-1`, process `chat_status submitted turn-2` then `ui_message user turn-2`; the supervisor/user message is upserted into store immediately without reload.

## Validation commands
Run at minimum:
- `bun test apps/web/src/hooks/use-chat-turn-guards.test.ts apps/web/src/hooks/use-chat-session-event-handler.test.ts`
- `bunx biome check apps/web/src/hooks/use-chat-turn-guards.ts apps/web/src/hooks/use-chat-turn-guards.test.ts apps/web/src/hooks/use-chat-session-event-handler.test.ts`

If practical and repository state permits, run type check. If type check fails due unrelated existing errors, report clearly.

## Acceptance criteria
- Targeted tests pass.
- Biome check passes for changed files, or any failure is documented and unrelated.
- No broad relaxation allows mismatched assistant/part/terminal stale events.
- Server code remains unchanged unless explicitly justified.

## Calibration requested from builder
In the output artifact, include:
- files changed
- exact behavior implemented
- test/biome/typecheck results
- actual_complexity
- actual_risk_encountered
- recommended_future_executor
- blockers, if any
