---
artifact_type: execution_plan
session_id: "20260427-supervisor-policy-hardening"
task_id: T00
producer: team-architect
status: ACTIVE
created_at: "2026-04-27T23:00:00Z"
source_commit: UNKNOWN
based_on:
  - 00-brief.md
  - 01-triage-report.md
  - 03-explorer-report.md
consumers:
  - orchestrator
  - team-builder
  - team-heavy
  - team-validator
freshness_rule: invalid_if_brief_triage_or_explorer_report_changes
---
# Execution Plan — Supervisor Policy Hardening

## Objective
Harden the supervisor autopilot across 7 code-change tickets covering DONE gates, permission taskGoal, option parsing, hard-deny, runtimeAction schema cleanup, loop detection, and audit/memory separation.

## Inputs Used
- `00-brief.md` — 8 hardening priorities from user
- `01-triage-report.md` — confirmed proceed-implement, routing explorer→architect→tickets→executor→validator
- `03-explorer-report.md` — note: explorer analyzed committed code; working tree has uncommitted refactoring (semantic/runtime split, new classifiers) that is the actual baseline
- `02-vault-context.md` — NOT PRESENT (not needed per triage)

## Working-Tree Baseline (source of truth)
The working tree contains uncommitted changes that represent a mid-refactoring state:
- `createOptionQuestionDecision` / `createMemoryRecoveryDecision` return `SupervisorSemanticDecision` (not `SupervisorDecisionSummary`), accept `SupervisorTurnSnapshot`
- `createCorrectDecision` and `createDoneVerificationDecision` functions exist with text-only DONE gates
- `ai-sdk-supervisor-decision.adapter.ts` computes `runtimeAction` server-side via `mapSemanticToRuntime`
- `SupervisorSemanticDecisionSchema` exists but still includes `runtimeAction` field (LLM outputs it unnecessarily)
- `SupervisorPermissionService.getTaskGoal` still only reads first user message
- No hard-deny layer, no loop detection, no audit/memory split

Tickets are written against this working-tree baseline.

## Plan Summary
7 tickets in 3 execution groups. Tickets in Group 1 run in parallel (different files or non-overlapping functions). Group 2 serializes after Group 1 finish (same file as T03). Group 3 serializes after Group 2 (same file as T05/T06).

## Ticket Matrix

| Ticket | Title | Owner | Mode | Depends On | Risk |
|--------|-------|-------|------|------------|------|
| T01 | Remove runtimeAction from LLM output schema | team-builder | PARALLEL | none | Low |
| T02 | Fix permission taskGoal derivation chain | team-builder | PARALLEL | none | Low |
| T03 | Improve option parser/scoring (A/B/C, Vietnamese, tables) | team-builder | PARALLEL | none | Medium |
| T04 | Add deterministic hard-deny permission layer | team-heavy | PARALLEL | none | Medium |
| T05 | Tighten DONE gate with plan state check + verification prompt | team-heavy | SERIALIZE | T03 | High |
| T06 | Add loop detection for repeated decisions | team-heavy | SERIALIZE | T05 | High |
| T07 | Separate audit log from durable memory fact storage | team-heavy | SERIALIZE | T05 | High |

## Serialization Rules
- **Group 1** (T01, T02, T03, T04): All PARALLEL — no file overlaps.
  - T01 touches only `supervisor.schemas.ts`
  - T02 touches only `supervisor-permission.service.ts`
  - T03 touches `supervisor-loop.service.ts` (only util functions: `extractAssistantChoiceOptions`, `selectAutopilotOption`, regex constants)
  - T04 touches `supervisor-permission.service.ts` + new `supervisor-hard-deny.ts`
- **Group 2** (T05): SERIALIZE after T03. Both touch `supervisor-loop.service.ts` but T03 only modifies leaf utility functions while T05 modifies classifier functions (`createCorrectDecision`, `createDoneVerificationDecision`). Serialize to avoid merge conflicts.
- **Group 3** (T06, T07): SERIALIZE after T05. Both touch `supervisor-loop.service.ts` (T06 modifies `runReview`, T07 modifies `applyDecision`/`appendSupervisorLog`). T06 and T07 can run in parallel AFTER T05 since they touch different functions and T07 additionally touches port files. But since both touch the same file, serialize T06 before T07 for safety.

## Risks / Unknowns
1. **Working-tree baseline drift**: Explorer report referenced committed code; actual baseline has uncommitted semantic/runtime refactoring. Tickets are written against working tree state. If working tree is committed before ticket execution, verify T01 context is still accurate (schema already partially transitioned).
2. **Permission service taskGoal change (T02)**: Changing `getTaskGoal` derivation chain may affect permission decision quality. Existing tests for `SupervisorPermissionService.handlePermissionRequest` should pass unchanged — only the `taskGoal` value in the snapshot may differ.
3. **DONE gate plan state (T05)**: The `createDoneVerificationDecision` function currently receives `SupervisorTurnSnapshot` which has `plan?: Plan`. The plan field is present but not checked. Adding plan state checks changes when sessions are allowed to mark DONE — could be perceived as more conservative/restrictive.
4. **Loop detection sensitivity (T06)**: Loop detection adds state tracking to `SupervisorSessionState`. This is a new persistence concern — the `lastDecisionFingerprint` and `decisionHistory` fields must survive session serialization/deserialization through JSON store.
5. **Audit/memory split (T07)**: Currently `SupervisorMemoryPort.appendLog` serves dual purpose. Splitting requires a new port interface (`SupervisorAuditPort`) and a new adapter. If no audit adapter is wired, audit logs could be lost silently.

## Blockers
- none
