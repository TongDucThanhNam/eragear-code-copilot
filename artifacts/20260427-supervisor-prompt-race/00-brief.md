---
artifact_type: brief
session_id: 20260427-supervisor-prompt-race
task_id: fix-supervisor-prompt-live-rendering-race
producer: orchestrator
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: unknown
based_on:
  - user_request:fix-supervisor-prompt-live-rendering-race
  - artifacts/20260427-live-supervisor-prompt-rendering/validation/T01-validator-report.md
consumers:
  - team-triage
freshness_rule: valid for current user request only
---

# Brief: Fix Supervisor Prompt Live Rendering Race

## Objective
Fix the remaining race where the web UI can still drop a new supervisor turn when `statusRef.current` has not synced immediately after `chat_status: ready`.

## Requested change
- Update `apps/web/src/hooks/use-chat-core-state.ts` so the status setter synchronizes React state and `statusRef.current` in the same call stack.
- Rename the internal raw React setter from `useState` to `setStatusState`.
- Create `setStatus: Dispatch<SetStateAction<ChatStatus>>` with `useCallback`.
- Resolve `SetStateAction` using `statusRef.current`, set `statusRef.current = nextStatus`, then call `setStatusState(nextStatus)`.
- Keep public `UseChatResult.setStatus(status)` signature unchanged.
- Keep current guard logic in `use-chat-turn-guards.ts`; rely on synced `statusRef` instead of waiting for render.
- Cleanup unused `diagMeasure` imports in web hooks if still unused.
- Do not add diagnostics unless needed for tests.
- Do not change server ACP/supervisor flow.

## Required tests
- Update/add test in `apps/web/src/hooks/use-chat-session-event-handler.test.ts`:
  - Simulate `statusRef.current = "streaming"` and `activeTurnId = "turn-1"`.
  - Process `chat_status ready turn-1` using the same synced status setter behavior.
  - Immediately process `chat_status submitted turn-2` without manually setting status to `ready`.
  - Process `ui_message user turn-2`.
  - Assert guard accepts turn-2 and the supervisor/user message is upserted immediately.
- Preserve regression coverage:
  - Same-turn late part updates after `ready/chat_finish` still accepted.
  - Mismatched assistant/part/terminal events still ignored.

## Validation commands
- `bun test apps/web/src/hooks/use-chat-turn-guards.test.ts apps/web/src/hooks/use-chat-session-event-handler.test.ts`
- `bunx biome check` on changed web hook/test files.
- `bun run --cwd apps/web check-types`; if failing due unrelated existing errors, document clearly.

## Assumptions
- Root cause is stale `statusRef`, not server broadcast or persistence.
- Supervisor follow-up renders as a user message in chat timeline.
- Server supervisor flow remains unchanged.
