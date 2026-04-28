---
artifact_type: ticket
session_id: "20260427-supervisor-policy-hardening"
task_id: T02
producer: team-architect
status: ACTIVE
created_at: "2026-04-27T23:00:00Z"
source_commit: UNKNOWN
based_on:
  - 00-brief.md
  - 01-triage-report.md
  - 03-explorer-report.md
  - 04-execution-plan.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_plan_brief_or_repo_context_changes
---
# Ticket T02 — Fix Permission taskGoal Derivation Chain

## Objective
Fix `SupervisorPermissionService.getTaskGoal()` to derive `taskGoal` from the latest explicit user instruction first, falling back through the current plan and original task, instead of reading only the very first user message. Priority #2 from brief.

## Assigned agent
team-builder

## Estimated complexity: 25
## Estimated risk: 20

## Routing rationale
The change is localized to `supervisor-permission.service.ts` — one private method `getTaskGoal()`. The fix involves changing the message page query and adding a fallback chain. No new dependencies or ports needed. Builder-suitable.

## Context
Currently `getTaskGoal` (lines 150–168 in `supervisor-permission.service.ts`) fetches the first page of messages (`direction: "forward", limit: 1`) and returns the first user message found. This ignores:
- Multiple user messages over the session lifetime
- The latest user instruction (which may refine/override the original task)
- The current plan title
- The original task as final fallback

The desired derivation chain is:
1. **Latest explicit user instruction** — fetch the most recent user message
2. **Current plan title** — if available on the session
3. **Original task** — the first user message (existing behavior as fallback)

The `SupervisorTurnSnapshot.taskGoal` in the turn loop already uses `latestUserInstruction || originalTaskGoal` (line 473 of `supervisor-loop.service.ts`). This ticket aligns the permission service with that behavior.

## Relevant repo context
- `apps/server/src/modules/supervisor/application/supervisor-permission.service.ts` — contains `getTaskGoal()` method to fix (lines ~150–168)
- `apps/server/src/modules/session/application/ports/session-repository.port.ts` — `getMessagesPage` signature (used by `getTaskGoal`)
- `apps/server/src/modules/supervisor/application/supervisor-permission.service.test.ts` — existing tests for `handlePermissionRequest`
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts` — line 473 shows `taskGoal = latestUserInstruction || originalTaskGoal` pattern to replicate

## Allowed files
- `apps/server/src/modules/supervisor/application/supervisor-permission.service.ts` (MODIFY)
- `apps/server/src/modules/supervisor/application/supervisor-permission.service.test.ts` (MODIFY — add test coverage for new derivation chain)

## Files to avoid
- All files outside `supervisor-permission.service.ts` and its test — do not change loop service, schemas, ports, or adapters

## Constraints / invariants
1. `getTaskGoal()` must remain a private method of `SupervisorPermissionService`
2. Must not throw — errors during message fetching should log a warning and return empty string (preserve existing error handling)
3. The method signature stays `(chatId: string, userId: string) => Promise<string>`
4. The `taskGoal` value is used only in `buildSupervisorPermissionPrompt()` and `lookupPermissionMemory()` — both must still receive a string
5. Must not add new constructor dependencies — all needed deps (`sessionRepo`, `sessionRuntime`, `logger`) are already injected

## Acceptance criteria
1. `getTaskGoal()` fetches the **latest** user message (not the first) by using `direction: "backward"` with limit 1
2. Fallback chain: latest user message → session plan title (if available on `sessionRuntime`) → first user message (forward page 1) → empty string
3. Existing `SupervisorPermissionService` tests still pass unchanged (the `taskGoal` value in snapshots may differ but the service logic remains correct)
4. New test: verifies that when a second user message exists, `taskGoal` reflects the latest instruction
5. New test: verifies fallback to plan title when no user messages exist
6. `bun test src/modules/supervisor/application/supervisor-permission.service.test.ts` passes
7. Full supervisor test suite passes

## Validation commands
```bash
cd apps/server
bun test src/modules/supervisor/application/supervisor-permission.service.test.ts
bun test src/modules/supervisor/
bunx biome check src/modules/supervisor/application/supervisor-permission.service.ts
```

## Expected output
- `supervisor-permission.service.ts`: `getTaskGoal()` updated with backward message fetch + fallback chain
- `supervisor-permission.service.test.ts`: new test cases for derivation chain scenarios
- All tests pass

## Dependency: none
## Execution mode: PARALLEL
## Stop conditions
- Need to modify `session-repository.port.ts` (out of scope)
- Need to add constructor dependencies (out of scope)
- Tests reveal the `sessionRuntime` does not expose plan title — if so, fallback to just latest-user/first-user chain and note limitation
## Blockers: none
