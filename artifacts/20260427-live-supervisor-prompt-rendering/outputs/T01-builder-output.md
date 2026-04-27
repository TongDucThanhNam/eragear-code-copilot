---
artifact_type: worker_output
session_id: 20260427-live-supervisor-prompt-rendering
task_id: T01
producer: team-builder
status: ACTIVE
created_at: 2026-04-27T14:30:00Z
source_commit: 700fc117
based_on:
  - artifacts/20260427-live-supervisor-prompt-rendering/tickets/T01-fix-live-supervisor-turn-guard.md
consumers:
  - team-validator
  - orchestrator
freshness_rule: invalid_if_ticket_changes
---
# Worker Output

## Contract check
- ticket_present: YES
- contract_status: OK

## Artifacts consumed
- artifacts/20260427-live-supervisor-prompt-rendering/tickets/T01-fix-live-supervisor-turn-guard.md
- artifacts/20260427-live-supervisor-prompt-rendering/01-triage-report.md (optional)
- artifacts/20260427-live-supervisor-prompt-rendering/00-brief.md (optional)

## Repo discovery
- path: apps/web/src/hooks/use-chat-turn-guards.ts
  why: Contains `resolveSessionEventTurnGuard` — primary behavior change target
- path: apps/web/src/hooks/use-chat-turn-guards.test.ts
  why: Existing tests for turn adoption, blocked turns, mismatched turns, late same-turn parts
- path: apps/web/src/hooks/use-chat-session-event-handler.test.ts
  why: Handler-level regression test needed for live supervisor upsert
- path: packages/shared/src/chat/use-chat-core.ts
  why: `isChatBusyStatus` determines busy statuses (submitted, streaming, awaiting_permission, cancelling)
- path: packages/shared/src/chat/types.ts
  why: `ChatStatus` union type definition

## Strategy
1. Modified `resolveSessionEventTurnGuard` in `use-chat-turn-guards.ts` to accept a new server-initiated turn when:
   - `activeTurnId !== eventTurnId` (new turn)
   - `!isChatBusyStatus(status)` (client not busy: ready/inactive/error)
   - Event is a busy `chat_status` OR a `ui_message` with role `user`
2. Preserved existing behavior for same-turn events and mismatched assistant/part/terminal events.
3. Added 8 new tests to `use-chat-turn-guards.test.ts` covering all required acceptance cases.
4. Added handler-level regression suite to `use-chat-session-event-handler.test.ts` with 4 tests covering the full supervisor turn adoption flow.
5. No server code changed.

## Done
- Modified `apps/web/src/hooks/use-chat-turn-guards.ts` — added 17 lines in `resolveSessionEventTurnGuard` to accept new-turn events when client is not busy
- Modified `apps/web/src/hooks/use-chat-turn-guards.test.ts` — added 8 new tests, preserved 14 existing
- Modified `apps/web/src/hooks/use-chat-session-event-handler.test.ts` — added 1 suite with 4 tests, added `BroadcastEvent` import

## Files changed
- path: apps/web/src/hooks/use-chat-turn-guards.ts
  summary: Added turn-guard exception allowing busy-status and user-role new-turn events through when client is not busy (ready/inactive/error)
- path: apps/web/src/hooks/use-chat-turn-guards.test.ts
  summary: Added 8 tests covering new-turn adoption cases and stale-event rejection cases
- path: apps/web/src/hooks/use-chat-session-event-handler.test.ts
  summary: Added `BroadcastEvent` type import; added "live supervisor turn adoption via turn guard" suite with 4 tests covering full handler flow after chat_finish

## Validation

### Tests
- command: bun test apps/web/src/hooks/use-chat-turn-guards.test.ts apps/web/src/hooks/use-chat-session-event-handler.test.ts
  status: PASS
  summary: 37 pass, 0 fail, 53 expect() calls across 2 files

### Biome check
- command: bunx biome check apps/web/src/hooks/use-chat-turn-guards.ts apps/web/src/hooks/use-chat-turn-guards.test.ts apps/web/src/hooks/use-chat-session-event-handler.test.ts
  status: NOT_RUN
  summary: Biome at root-level biomes.jsonc does not include web/src hooks (files config has no explicit includes for this path). Running from apps/web/ yields same result — files appear to be excluded by some broader pattern in the biome config chain. This is a pre-existing repo configuration issue, not caused by these changes.

### Type check
- command: bunx tsc --noEmit
  status: NOT_RUN
  summary: Type check fails with pre-existing errors in server package (set-mode.service.ts, discover-agent-sessions.service.ts, etc.) and one error in web components (inline-citation.tsx ref type mismatch). None of these errors are in or related to the files changed for this ticket.

## Execution feedback
- estimated_complexity_from_ticket: 45 (triage score)
- actual_complexity: 35
- actual_risk_encountered: 30
- complexity_delta: LOWER
- hidden_coupling: NO
- recommended_future_executor: team-builder

## Behavioral impact
INTERNAL_ONLY — Turn guard logic only; no API or user-visible surface change.

## Notes
- The new guard logic only fires when `activeTurnId` is set (client has an active turn) AND `!isChatBusyStatus(status)` (client is ready/inactive/error) AND a new turn is arriving with a different `turnId`. This is a narrow, well-defined escape hatch — not a blanket relaxation.
- Mismatched assistant messages, part updates, terminal_output, and chat_finish for a new turn are still ignored when client is ready, protecting against stale tail.
- `reconcileActiveTurnIdAfterEvent` behavior unchanged — it still keeps the turn active after `chat_finish` and `ready`, which is correct and expected for late same-turn part updates.

## Blockers
- none
