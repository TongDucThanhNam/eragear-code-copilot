---
artifact_type: ticket
session_id: "20260427-supervisor-policy-hardening"
task_id: T04
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
  - team-heavy
  - team-validator
freshness_rule: invalid_if_plan_brief_or_repo_context_changes
---
# Ticket T04 — Add Deterministic Hard-Deny Permission Layer

## Objective
Insert a deterministic hard-deny filter **before** the LLM permission decision in `SupervisorPermissionService.handlePermissionRequest()` to block clearly disallowed operations (commits, pushes, deploys, destructive ops, credential/secrets access) without incurring LLM cost. Priority #4 from brief.

## Assigned agent
team-heavy

## Estimated complexity: 50
## Estimated risk: 40

## Routing rationale
This requires designing a deny rule set, integrating it into the permission handling pipeline, and ensuring it does not false-positive on legitimate operations. Involves security-sensitive logic and must be carefully tested. Needs `team-heavy` for the policy design and safe integration.

## Context
Currently `handlePermissionRequest()` (lines 59–103) flows:
1. `createSnapshot` → validates supervisor mode/policy/memory
2. `decisionPort.decidePermission(snapshot)` → calls LLM
3. `applyPermissionDecision` → settles the request

There is **no** pre-LLM filter. Every permission request goes through the LLM. The brief calls for inserting a hard-deny layer that rejects certain operations without calling the LLM.

The deny layer should run after `createSnapshot` succeeds (so we have `toolName`, `input`, `title`, `options`) and before `decisionPort.decidePermission()`.

**Deny criteria** (deterministic, no LLM):
- **Destructive operations**: Tool name contains or input mentions `commit`, `push`, `deploy`, `release`, `publish`, `delete`, `remove`, `drop`, `rm`, `force push`
- **Credential/secrets access**: Tool name contains or input mentions `credential`, `secret`, `token`, `api key`, `password`, `env`, `.env`
- **Out-of-project-root access**: Input requests paths outside the project root (path traversal: `../`, `/etc/`, `/root/`)
- **Exception**: If the user instruction timeline explicitly requests the operation, allow it through (let the LLM decide). Check `snapshot.taskGoal` for user intent.

## Relevant repo context
- `apps/server/src/modules/supervisor/application/supervisor-permission.service.ts` — `handlePermissionRequest()` method to insert deny filter
- `apps/server/src/modules/supervisor/application/supervisor-permission.service.test.ts` — existing tests; add hard-deny test cases
- `apps/server/src/modules/supervisor/application/ports/supervisor-decision.port.ts` — `SupervisorPermissionSnapshot` type (contains `toolName`, `title`, `input`, `options`, `taskGoal`)
- `apps/server/src/modules/supervisor/application/supervisor-policy.ts` — `SupervisorPolicy` interface (may add `hardDenyEnabled` flag)
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts` — reference: `UNSAFE_OPTION_RE` regex constant for deny patterns

## Allowed files
- `apps/server/src/modules/supervisor/application/supervisor-hard-deny.ts` (CREATE — new file with deny logic)
- `apps/server/src/modules/supervisor/application/supervisor-permission.service.ts` (MODIFY — insert deny call in `handlePermissionRequest`)
- `apps/server/src/modules/supervisor/application/supervisor-permission.service.test.ts` (MODIFY — add deny test cases)
- `apps/server/src/modules/supervisor/application/supervisor-policy.ts` (MODIFY — optional: add `hardDenyEnabled` boolean)

## Files to avoid
- `supervisor-loop.service.ts` — do not change
- `supervisor.schemas.ts` — do not change
- Any infra/port files other than policy

## Constraints / invariants
1. Hard-deny must run **before** `decisionPort.decidePermission()` — if deny matches, skip LLM call entirely
2. Hard-deny must **never** block an operation the user explicitly requested (check `taskGoal` against deny patterns)
3. If hard-deny rejects, the decision must be `{ action: "reject", reason: "Hard-deny: <specific reason>" }` — same shape as LLM rejection
4. Hard-deny should be configurable — add `hardDenyEnabled: boolean` to `SupervisorPolicy` (default `true`)
5. The deny check must be a pure function: `(snapshot: SupervisorPermissionSnapshot, policy: SupervisorPolicy) => SupervisorPermissionDecision | null` — returns decision if denied, null if pass-through
6. Must log when hard-deny fires (use injected logger, or accept logger as parameter to the pure function, or log in the service method)

## Acceptance criteria
1. New file `supervisor-hard-deny.ts` exports a function `evaluateHardDeny(snapshot, policy): SupervisorPermissionDecision | null`
2. Tool calls with `toolName` containing `bash` and `input` mentioning `git push` are hard-denied
3. Tool calls with `toolName` containing `write_file` and `input` mentioning `.env` are hard-denied
4. Tool calls accessing paths outside project root (e.g., `/etc/passwd`) are hard-denied
5. Tool calls with safe operations (e.g., `read_file` on `src/index.ts`) pass through (return `null`)
6. When `taskGoal` contains "commit and push the changes" (user explicitly requested), no hard-deny on commit operations
7. When `hardDenyEnabled` is `false`, all operations pass through
8. Hard-deny rejections are logged with reason
9. `bun test src/modules/supervisor/application/supervisor-permission.service.test.ts` passes (including new deny tests)
10. Full supervisor test suite passes

## Validation commands
```bash
cd apps/server
bun test src/modules/supervisor/application/supervisor-permission.service.test.ts
bun test src/modules/supervisor/
bunx biome check src/modules/supervisor/application/supervisor-hard-deny.ts src/modules/supervisor/application/supervisor-permission.service.ts
```

## Expected output
- New file: `supervisor-hard-deny.ts` with `evaluateHardDeny()` function and deny pattern constants
- `supervisor-permission.service.ts`: `handlePermissionRequest()` calls `evaluateHardDeny()` after `createSnapshot()` and before `decisionPort.decidePermission()`
- `supervisor-policy.ts`: optional `hardDenyEnabled: boolean` field added to interface
- Tests: 6+ new test cases for hard-deny scenarios (deny commit, deny secrets, deny path traversal, pass safe op, pass user-requested, pass with hardDenyEnabled=false)

## Dependency: none
## Execution mode: PARALLEL
## Stop conditions
- `SupervisorPermissionSnapshot` does not contain fields needed for deny evaluation (report what is missing)
- User intent detection via `taskGoal` is unreliable for explicit request detection (contact architect)
- Need to modify port interfaces (out of scope — implement deny as service-level concern only)
## Blockers: none
