---
artifact_type: brief
session_id: "20260427-supervisor-policy-hardening"
task_id: "00"
producer: "orchestrator"
status: "active"
created_at: "2026-04-27T00:00:00Z"
source_commit: "HEAD"
based_on: "architecture-review"
consumers:
  - team-orchestrator
  - team-triage
  - team-builder
  - team-validator
freshness_rule: "review before implementation; stale if no activity in 7 days"
---

# 00-brief: Supervisor Policy Hardening

## Summary

User provided a detailed architecture review concluding that Supervisor should remain a
**server-side/control-plane ACP autopilot reviewer**, not a separate ACP agent.

## Likely Delivery Objective

If user confirms/continues: harden Supervisor autopilot policy/evidence/verification
behavior.

## Priority Implementation List (from user)

### 1. Tighten DONE gate
Require plan state + objective tool/test/build evidence + no unresolved gate/error
before allowing a session to be marked DONE.

### 2. Fix permission taskGoal
Use latest explicit user instruction, falling back to current plan/original task when
constructing `taskGoal` for permission decisions.

### 3. Improve option parser/scoring
Handle A/B/C formats, Vietnamese input, markdown tables, and provide safe/default
scoring fallbacks.

### 4. Add deterministic hard-deny permission policy
Insert a deterministic hard-deny layer before the LLM permission decision to block
clearly disallowed operations without LLM cost.

### 5. Remove runtimeAction from LLM output schema
Map `semanticAction` → `runtimeAction` server-side instead of exposing runtime
concerns in the LLM output schema.

### 6. Add standard verification prompt
When an agent claims done without evidence, inject a standard verification prompt
requiring the agent to produce objective evidence.

### 7. Add loop detection
Detect repeated decisions, prompts, or failures without artifact delta (file diffs,
plan state changes) and escalate.

### 8. Separate audit log and durable memory fact handling
Distinguish `SAVE_MEMORY` for audit log vs. durable fact storage, using appropriate
adapters for each.

## Constraints

- Supervisor must **not** edit files or run shell directly.
- Supervisor must only: observe, decide, send follow-up prompts into the same ACP
  session, settle permission, mark done/needs_user/abort, and append audit/memory
  through appropriate adapters.
- User referenced external docs for ACP and AI SDK, but implementation should be
  based on current repo architecture and persisted artifacts.
