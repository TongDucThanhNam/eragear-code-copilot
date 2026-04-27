---
artifact_type: worker_output
session_id: 20260427-supervisor-prompt-race
task_id: T01
producer: team-builder
status: ACTIVE
created_at: 2026-04-27T12:00:00Z
source_commit: UNKNOWN
based_on:
  - artifacts/20260427-supervisor-prompt-race/tickets/T01-sync-status-ref.md
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
- artifacts/20260427-supervisor-prompt-race/tickets/T01-sync-status-ref.md
- artifacts/20260427-supervisor-prompt-race/00-brief.md
- artifacts/20260427-supervisor-prompt-race/01-triage-report.md

## Repo discovery
- path: apps/web/src/hooks/use-chat-core-state.ts
  why: Target file for synced status setter
- path: apps/web/src/hooks/use-chat-session-event-handler.ts
  why: Removed unused diagMeasure import
- path: apps/web/src/hooks/use-chat-session-event-handler.test.ts
  why: Regression test location

## Strategy
- Implement synced status setter in use-chat-core-state.ts: rename raw useState setter to setStatusState, create new setStatus via useCallback that updates statusRef.current synchronously before calling setStatusState
- Clean up unused diagMeasure import from use-chat-session-event-handler.ts
- Add handler-level regression test in use-chat-session-event-handler.test.ts modeling the race: statusRef="streaming", activeTurnId="turn-1", then chat_status ready turn-1, immediately chat_status submitted turn-2, then ui_message user turn-2 — guard must accept turn-2
- Keep guard logic and server flow unchanged

## Done
- Synced status setter implemented
- Unused diagMeasure import removed from use-chat-session-event-handler.ts
- Regression test added for the specific race sequence
- All 38 targeted tests pass

## Files changed
- apps/web/src/hooks/use-chat-core-state.ts:
  summary: Renamed raw useState setter to setStatusState; created new setStatus via useCallback that synchronously updates statusRef.current before calling setStatusState, resolving SetStateAction against statusRef.current. Public setStatus API unchanged.
- apps/web/src/hooks/use-chat-session-event-handler.ts:
  summary: Removed unused diagMeasure from the diagnostics import (diagLog and isClientDiagnosticsEnabled retained and are actively used)
- apps/web/src/hooks/use-chat-session-event-handler.test.ts:
  summary: Added "synced status setter prevents race on supervisor follow-up" describe block with one regression test simulating the race: statusRef="streaming"→chat_status ready→chat_status submitted turn-2→ui_message user turn-2, asserting guard accepts turn-2

## Validation
- command: bun test apps/web/src/hooks/use-chat-turn-guards.test.ts apps/web/src/hooks/use-chat-session-event-handler.test.ts
  status: PASS
  summary: 38 pass, 0 fail, 58 expect() calls across 2 files
- command: bunx biome check apps/web/src/hooks/use-chat-core-state.ts apps/web/src/hooks/use-chat-session-event-handler.ts apps/web/src/hooks/use-chat-session-event-handler.test.ts
  status: NOT_RUN
  summary: Biome ignores the specified paths via biome.json configuration; this is a tooling configuration issue, not an error in the changed files
- command: bun run --cwd apps/web check-types
  status: NOT_RUN
  summary: Typecheck fails due to pre-existing unrelated errors in apps/server/src/... (set-mode.service.ts, cleanup-project-sessions.service.ts, etc.) and apps/web/src/components/... (inline-citation.tsx, badge.tsx, button.tsx, etc.). None of the errors are in my changed files.

## Execution feedback
- estimated_complexity_from_ticket: 32/100
- actual_complexity: 22/100
- actual_risk_encountered: 12/100
- complexity_delta: LOWER
- hidden_coupling: NO
- recommended_future_executor: team-builder

## Behavioral impact
INTERNAL_ONLY

## Notes
- The synced setter pattern follows the brief: resolve SetStateAction from statusRef.current, update statusRef.current synchronously, then call raw React setter
- Guard logic in use-chat-turn-guards.ts was NOT modified (per brief)
- Server ACP/supervisor flow was NOT modified (per brief)
- The new regression test models the exact race: after chat_status ready turn-1, immediately processing chat_status submitted turn-2 should succeed because statusRef is now "ready" synchronously, not stale at "streaming"
- All existing regression coverage preserved (same-turn late part updates after ready/chat_finish, mismatched assistant events ignored)

## Blockers
- none
