---
artifact_type: ticket
session_id: 20260427-supervisor-prompt-race
task_id: T01
producer: orchestrator
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: unknown
based_on:
  - artifacts/20260427-supervisor-prompt-race/00-brief.md
  - artifacts/20260427-supervisor-prompt-race/01-triage-report.md
  - artifacts/20260427-live-supervisor-prompt-rendering/validation/T01-validator-report.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_triage_or_brief_changes
---
# T01 — Sync Status Ref to Fix Supervisor Prompt Race

## Owner
- team-builder

## Objective
Fix the remaining race where a new supervisor turn can be dropped because `statusRef.current` is still stale immediately after processing `chat_status: ready`.

## Files expected to inspect/edit
- `apps/web/src/hooks/use-chat-core-state.ts`
- `apps/web/src/hooks/use-chat-session-event-handler.test.ts`
- Possibly `apps/web/src/hooks/use-chat-turn-guards.test.ts` only if existing regression expectations need updates.
- Do not change server supervisor/ACP flow.
- Do not change `use-chat-turn-guards.ts` unless tests prove current prior fix is insufficient; brief expects guard logic to remain unchanged.

## Required production change
In `apps/web/src/hooks/use-chat-core-state.ts`:
1. Rename the raw React state setter returned by `useState<ChatStatus>` to `setStatusState`.
2. Create a synced `setStatus: Dispatch<SetStateAction<ChatStatus>>` using `useCallback`.
3. In that setter:
   - Resolve functional or direct `SetStateAction` against `statusRef.current`.
   - Assign `statusRef.current = nextStatus` synchronously in the same call stack.
   - Call `setStatusState(nextStatus)`.
4. Preserve public `UseChatResult.setStatus(status)` behavior/signature externally.
5. Leave `reconcileActiveTurnIdAfterEvent` and current guard behavior unchanged.
6. Cleanup unused `diagMeasure` imports in changed web hooks only if genuinely unused.
7. Do not add polling/reload workarounds or extra diagnostics unless required for testability.

## Required regression test
In `apps/web/src/hooks/use-chat-session-event-handler.test.ts`, add/update a handler-level test that models the real race:
1. Start with `statusRef.current = "streaming"` and `activeTurnId = "turn-1"`.
2. Process `chat_status ready turn-1` through a setter implementation matching the new synced setter behavior.
3. Immediately process `chat_status submitted turn-2` without manually setting any local `status` variable to `ready`.
4. Process `ui_message user turn-2`.
5. Assert the guard adopts/accepts `turn-2` and the supervisor/user message is upserted immediately.

Preserve existing regression coverage:
- Same-turn late part updates after `ready/chat_finish` are still accepted.
- Mismatched assistant/part/terminal events remain ignored.

## Validation commands
Run at minimum:
- `bun test apps/web/src/hooks/use-chat-turn-guards.test.ts apps/web/src/hooks/use-chat-session-event-handler.test.ts`
- `bunx biome check` on changed web hook/test files, likely:
  - `apps/web/src/hooks/use-chat-core-state.ts`
  - `apps/web/src/hooks/use-chat-session-event-handler.test.ts`
  - plus any other changed files.
- `bun run --cwd apps/web check-types`; if it fails due unrelated existing errors, report exact unrelated nature.

## Acceptance criteria
- Synced setter updates `statusRef.current` before React render is required.
- Targeted race test uses immediate ready→submitted→user-message sequence without manual ready assignment.
- Targeted tests pass.
- Biome/typecheck results are pass or clearly documented as unrelated/tooling limitations.
- No server changes and no broad guard relaxation.

## Calibration requested from builder
Output artifact must include:
- files changed
- exact behavior implemented
- validation command results
- whether guard/server code changed
- actual_complexity
- actual_risk_encountered
- complexity_delta
- recommended_future_executor
- blockers, if any
