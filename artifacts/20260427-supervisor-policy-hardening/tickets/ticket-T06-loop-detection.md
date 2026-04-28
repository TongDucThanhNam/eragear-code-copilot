---
artifact_type: ticket
session_id: "20260427-supervisor-policy-hardening"
task_id: T06
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
# Ticket T06 — Add Loop Detection for Repeated Decisions

## Objective
Detect repeated identical decisions, prompts, or failure patterns across consecutive supervisor turns that produce no artifact delta (no file diffs, no plan state changes), and escalate/abort instead of continuing. Priority #7 from brief.

## Assigned agent
team-heavy

## Estimated complexity: 60
## Estimated risk: 55

## Routing rationale
Loop detection requires adding state tracking to `SupervisorSessionState`, modifying the `runReview` pipeline to compute fingerprints and compare across turns, and deciding when to escalate. Touches both domain types and orchestration logic. Needs `team-heavy` for safe state design.

## Context
The supervisor already has a `maxRepeatedPrompts` gate (line 689 in `supervisor-loop.service.ts`) that aborts when `continuationCount > maxRepeatedPrompts`. However, this is a simple counter — it does not detect:
- The same decision being made repeatedly (same `semanticAction` + identical `followUpPrompt`)
- The same failure pattern without progress (same `lastErrorSummary` across turns)
- No changes to plan state across multiple turns (agent stuck in a loop without declaring done)

The brief asks for detection of "repeated decisions, prompts, or failures without artifact delta (file diffs, plan state changes)."

**Design:**

Add to `SupervisorSessionState`:
```typescript
lastDecisionFingerprint?: string;  // hash of semanticAction + followUpPrompt + reason
decisionHistory?: string[];         // last N fingerprints (max 5)
lastPlanSnapshot?: string;          // JSON snapshot of plan entries for delta detection
consecutiveIdenticalDecisions?: number;
```

In `runReview()`, after the decision is made and before applying it:
1. Compute `fingerprint = hash(semanticAction + followUpPrompt + reason)`
2. Compare to `lastDecisionFingerprint`
3. If identical: increment `consecutiveIdenticalDecisions`
4. If `consecutiveIdenticalDecisions >= 2` (same decision 3 times in a row): escalate with `Loop detected: same decision repeated without artifact delta`
5. Also check: has the plan state changed since `lastPlanSnapshot`? If not, and decisions are identical, escalate sooner

The fingerprint should be a simple deterministic hash (e.g., first 8 chars of SHA-like hash, or just use string concatenation with a length cap).

**Escalation signal**: When loop is detected, override the decision to `ESCALATE` with reason explaining the loop.

## Relevant repo context
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts` — `runReview()` method (lines ~168–283) where decision pipeline runs; also `applyDecision()` (lines ~578–738) for state update
- `apps/server/src/shared/types/supervisor.types.ts` — `SupervisorSessionState` interface to add tracking fields
- `apps/server/src/modules/supervisor/application/supervisor-state.util.ts` — `normalizeSupervisorState()` may need to handle new fields
- `apps/server/src/modules/supervisor/application/ports/supervisor-decision.port.ts` — `SupervisorTurnSnapshot` type (plan field for delta detection)
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts` — existing tests for `SupervisorLoopService`

## Allowed files
- `apps/server/src/shared/types/supervisor.types.ts` (MODIFY — add `lastDecisionFingerprint`, `decisionHistory`, `lastPlanSnapshot`, `consecutiveIdenticalDecisions` to `SupervisorSessionState`)
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts` (MODIFY — add loop detection logic in `runReview` and fingerprint tracking in `applyDecision`)
- `apps/server/src/modules/supervisor/application/supervisor-state.util.ts` (MODIFY — ensure new fields survive normalization)
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts` (MODIFY — add loop detection test cases)

## Files to avoid
- All other files — do not touch permission service, schemas, ports, or adapters (except types/state)

## Constraints / invariants
1. New `SupervisorSessionState` fields must be optional (`?:`) to maintain backward compatibility with existing serialized state
2. `normalizeSupervisorState` must preserve new fields (pass through without validation)
3. Fingerprint computation must be deterministic and fast — no crypto, just string-based
4. Loop detection must run BEFORE the decision is applied (in `runReview`, around line 260-266)
5. When loop is detected, the decision is overridden to `ESCALATE` and logged prominently
6. `consecutiveIdenticalDecisions` resets when a different decision is made (fingerprint changes)
7. The `maxRepeatedPrompts` counter (continuationCount) is separate from loop detection — both can abort, but loop detection is smarter

## Acceptance criteria
1. `SupervisorSessionState` has new optional fields: `lastDecisionFingerprint`, `decisionHistory`, `lastPlanSnapshot`, `consecutiveIdenticalDecisions`
2. Helper function `computeDecisionFingerprint(decision)` exists and returns a stable string for identical decisions
3. `runReview` detects when the same decision fingerprint appears 3 consecutive times and overrides to `ESCALATE` with loop reason
4. Plan state delta check: if `lastPlanSnapshot` equals current plan JSON and fingerprints match, escalate at 2 consecutive matches instead of 3
5. Loop detection does NOT trigger on the first occurrence of a decision
6. When a different decision is made, `consecutiveIdenticalDecisions` resets to 0
7. `applyDecision` updates `lastDecisionFingerprint`, `decisionHistory`, `lastPlanSnapshot` after each decision
8. Tests: loop detected on 3 identical decisions, loop detected on 2 identical with same plan, loop not detected on 1 repeat, loop resets on different decision
9. `bun test src/modules/supervisor/application/supervisor-loop.service.test.ts` passes
10. Full supervisor test suite passes

## Validation commands
```bash
cd apps/server
bun test src/modules/supervisor/application/supervisor-loop.service.test.ts
bun test src/modules/supervisor/
bunx biome check src/modules/supervisor/application/supervisor-loop.service.ts src/shared/types/supervisor.types.ts src/modules/supervisor/application/supervisor-state.util.ts
```

## Expected output
- `supervisor.types.ts`: 4 new optional fields on `SupervisorSessionState`
- `supervisor-loop.service.ts`: fingerprint computation function, loop detection in `runReview`, fingerprint update in `applyDecision`
- `supervisor-state.util.ts`: `normalizeSupervisorState` preserves new fields
- Test file: new test cases for loop detection scenarios

## Dependency: T05 (serialize — both modify supervisor-loop.service.ts)
## Execution mode: SERIALIZE
## Stop conditions
- New state fields break JSON serialization/deserialization (check if session persistence handles unknown fields gracefully)
- `runReview` test infrastructure is too complex to mock for loop detection (report — may need to test fingerprint function in isolation)
- Plan delta comparison is unreliable due to object reference vs value issues (use JSON.stringify for comparison)
## Blockers: none
