---
artifact_type: ticket
session_id: "20260427-supervisor-policy-hardening"
task_id: T05
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
# Ticket T05 — Tighten DONE Gate with Plan State Check + Verification Prompt

## Objective
Tighten the DONE gate in `createDoneVerificationDecision` to require plan state completion (no pending/in_progress entries) and no unresolved tool errors. Also enhance `createCorrectDecision` verification prompt to demand explicit objective evidence from the agent. Priorities #1 and #6 from brief, combined.

## Assigned agent
team-heavy

## Estimated complexity: 55
## Estimated risk: 50

## Routing rationale
This modifies the core DONE/continue decision logic in the classifier pipeline. Changes affect when sessions are allowed to complete — too conservative and sessions never finish, too permissive and the hardening is pointless. Requires understanding plan state structure, tool error tracking, and prompt design. Needs `team-heavy`.

## Context
The working tree already has two classifier functions in `supervisor-loop.service.ts`:

**`createDoneVerificationDecision`** (lines ~1150–1167):
- Currently checks: text has done marker AND text has verification keywords
- Returns `{ semanticAction:"DONE", runtimeAction:"done" }` when matched
- **Missing checks**: plan state (any entries with status `in_progress` or `pending`?), unresolved gates/errors, tool failure history

**`createCorrectDecision`** (lines ~1124–1144):
- Currently checks: text has done marker AND text does NOT have verification keywords
- Returns `{ semanticAction:"CORRECT", runtimeAction:"continue", followUpPrompt:"You indicated completion, but..." }`
- **Missing**: The prompt is generic — does not ask for specific evidence (file list, test results, build output)

The `SupervisorTurnSnapshot` provides:
- `plan?: Plan` with `entries: { status: string; content: string }[]` — check for pending/in_progress
- `recentToolCallSummary?: { consecutiveFailures: number }` — check for unresolved errors
- `lastErrorSummary?: string` — check for errors
- `supervisor.continuationCount` — if high, agent may be looping/stuck

**Changes needed:**

A. `createDoneVerificationDecision`:
1. After text-based checks pass, additionally verify:
   - `snapshot.plan?.entries` has no entries with status `"in_progress"` or `"pending"`
   - `snapshot.recentToolCallSummary?.consecutiveFailures` is `0` or undefined
   - `snapshot.lastErrorSummary` is undefined or empty
2. If any check fails, return `null` (let the pipeline fall through to correct/LLM)
3. Log the specific gate that prevented DONE

B. `createCorrectDecision`:
1. Enhance the `followUpPrompt` to request explicit evidence: "Please confirm: (1) which files were modified/created, (2) what tests were run and their results, (3) any build/compilation output"
2. Do NOT change the detection logic (done marker without verification)
3. Keep the prompt scoped to the original task

C. LLM system prompt consistency (in `supervisor-prompt.builder.ts`):
1. Verify "Completion Gate" section (lines ~108–118) already describes plan state checking — if not, add: "No plan entries remain with status in_progress or pending"

## Relevant repo context
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts` — `createDoneVerificationDecision()` (lines ~1150–1167), `createCorrectDecision()` (lines ~1124–1144)
- `apps/server/src/modules/supervisor/application/ports/supervisor-decision.port.ts` — `SupervisorTurnSnapshot` type (plan, recentToolCallSummary, lastErrorSummary fields)
- `apps/server/src/modules/session/domain/stored-session.types.ts` — `Plan` type with `entries: { status: string; content: string }[]`
- `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts` — `SUPERVISOR_TURN_SYSTEM_PROMPT` (Completion Gate section, lines ~108–118)
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts` — existing tests for `createCorrectDecision` and `createDoneVerificationDecision`

## Allowed files
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts` (MODIFY — only `createCorrectDecision` and `createDoneVerificationDecision` functions)
- `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts` (MODIFY — Completion Gate section in system prompt, if needed)
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts` (MODIFY — add test cases for plan-aware DONE gate)
- `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.test.ts` (MODIFY — if system prompt changes)

## Files to avoid
- All other functions in `supervisor-loop.service.ts` — do NOT touch `runReview`, `applyDecision`, `buildSnapshot`, `createOptionQuestionDecision`, `createMemoryRecoveryDecision`
- All other files

## Constraints / invariants
1. Function signatures must NOT change
2. Existing tests must still pass (the new checks add reject conditions but do not change existing accept paths)
3. Plan state check: use case-insensitive status comparison (`status.toLowerCase()` matches `"in_progress"` or `"pending"`)
4. Tool error check: `consecutiveFailures === 0` means clean; undefined means no tool data available (treat as clean)
5. DONE gate changes must be consistent between the deterministic classifier and the LLM system prompt

## Acceptance criteria
1. `createDoneVerificationDecision` returns `null` when plan has an `in_progress` entry (even if text says "done" with verification)
2. `createDoneVerificationDecision` returns `null` when `consecutiveFailures > 0`
3. `createDoneVerificationDecision` returns `DONE` when text+dependencies are clean (plan all done/completed, no failures, no errors)
4. `createCorrectDecision` followUpPrompt now includes request for: file list, test results, build output evidence
5. LLM system prompt "Completion Gate" references plan status check (if not already present — verify current prompt)
6. Tests: new cases for plan-blocked DONE, error-blocked DONE, clean DONE
7. `bun test src/modules/supervisor/application/supervisor-loop.service.test.ts` passes
8. Full supervisor test suite passes

## Validation commands
```bash
cd apps/server
bun test src/modules/supervisor/application/supervisor-loop.service.test.ts
bun test src/modules/supervisor/application/supervisor-prompt.builder.test.ts
bun test src/modules/supervisor/
bunx biome check src/modules/supervisor/application/supervisor-loop.service.ts
```

## Expected output
- Updated `createDoneVerificationDecision` with plan state + tool error checks
- Updated `createCorrectDecision` with evidence-requesting verification prompt
- Updated LLM system prompt Completion Gate (if needed for consistency)
- Test file with new cases: plan-blocked DONE, error-blocked DONE, clean DONE, verification prompt content check
- All existing tests pass, all new tests pass

## Dependency: T03 (same file — serialize to avoid merge conflicts)
## Execution mode: SERIALIZE
## Stop conditions
- `snapshot.plan` is not populated in the snapshot (plan data unavailable — note limitation, proceed with text-only checks)
- Adding plan state checks creates a situation where DONE is never reached in practice (report to architect)
- Need to change `buildSnapshot` to populate plan (out of scope — verify plan is already populated in snapshot)
## Blockers: none
