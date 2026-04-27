---
id: routing-patterns
artifact_type: meta
created: 2025-04-15
updated: 2026-04-27
status: active
---

# Routing Patterns

Cumulative routing heuristics from validated execution sessions.

## 2026-04-27 — Supervisor snapshot/prompt server-module-local tasks
- Signal: server supervisor module, application-layer only (snapshot/prompt/decision context), focused tests, no cross-boundary UI/transport changes, no new infra ports.
- Recommended pipeline: team-explorer first to map snapshot consumers/message paging/prompt-gate logic, then team-builder. No architect/heavy by default.
- Executor signal: team-builder fit was good; validation quality 92; actual complexity 42/100 vs triage 58/100; actual risk 35/100.
- Safety note: approval gate safety should be tested explicitly; unsafe commit/push/deploy/destructive remains blocked. Avoid changing gate regex unless brief requires it.
- Pattern note: compact user timelines should use forward cursor pagination, filter `role === "user"`, bound per-message and total payload, and keep latest assistant context to latest assistant text only.
- Overfit guard: this is a light routing note from one high-quality validated session, not a strong global heuristic.
- Based on: artifacts/20260427-supervisor-intent-timeline/learnings/T01-curator-learning.md
