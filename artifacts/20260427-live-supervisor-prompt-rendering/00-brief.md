---
artifact_type: brief
session_id: 20260427-live-supervisor-prompt-rendering
task_id: fix-live-supervisor-prompt-rendering
producer: orchestrator
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: unknown
based_on:
  - user_request:fix-live-supervisor-prompt-rendering
consumers:
  - team-triage
freshness_rule: valid for current user request only
---

# Brief: Fix Live Supervisor Prompt Rendering

## Objective
Implement the provided plan to fix live supervisor follow-up prompt rendering in the web client turn guard.

## Requested change
- Update `apps/web/src/hooks/use-chat-turn-guards.ts` so a new server-initiated turn is accepted when the client is not busy (`ready`, `inactive`, `error`) and receives a busy `chat_status` (`submitted`, `streaming`, `awaiting_permission`, `cancelling`) with a new `turnId`.
- Also accept/adopt when the first event of the new turn is a `ui_message` with role `user` and a new `turnId`.
- Continue ignoring mismatched assistant/part/terminal events to protect against stale tail events from another turn.
- Keep `reconcileActiveTurnIdAfterEvent` unchanged to preserve late same-turn part updates after `ready/chat_finish`.
- Do not change server supervisor flow.

## Tests requested
- Add/adjust tests for `resolveSessionEventTurnGuard`:
  - `ready + activeTurnId=turn-1` receives `chat_status submitted turn-2` => accept and set/adopt new active turn.
  - `ready + activeTurnId=turn-1` receives `ui_message user turn-2` => accept/adopt.
  - `ready + activeTurnId=turn-1` receives assistant/part/terminal mismatched turn => ignore.
- Add/adjust handler-level test:
  - After `chat_finish turn-1`, process `chat_status submitted turn-2` then `ui_message user turn-2`; supervisor/user message is upserted immediately without reload.
- Run targeted tests:
  - `bun test apps/web/src/hooks/use-chat-turn-guards.test.ts apps/web/src/hooks/use-chat-session-event-handler.test.ts`
  - `bunx biome check` for changed files.
  - Type check if repo is clean enough; report unrelated failures if any.

## Assumptions
- Supervisor prompt live should appear as a user message in the timeline immediately when supervisor sends a follow-up.
- No polling/reload workaround should be added.
- Reload already shows the prompt, so server persistence/outbox is assumed functional.
