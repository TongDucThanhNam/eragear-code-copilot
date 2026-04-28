---
artifact-contract: shared-meta
purpose: routing-patterns
steward: team-orchestrator
audience: orchestrator, team-architect, team-builder
updated: 2026-04-27
---

# Routing Patterns

Collected patterns from prior execution runs. Each entry includes:
- Date and run identifier
- Signal/trigger observed
- Pipeline recommendation
- Safety notes and calibration

---

### 2026-04-26 — Supervisor UI refactor
- Signal: supervisor UI in apps/server/src/transport/http/ui/ needed structural refactor for maintainability.
- Recommended pipeline: team-explorer to map the UI surface, then team-architect for component contract, then team-builder for implementation tickets.
- Ticket slicing that worked: separate tickets for layout shell, model-selector component, and supervisor status panel.
- Safety notes: UI changes must not break the tRPC/WS bridge to the agent runtime; test against both active and idle supervisor states.
- Calibration: triage complexity moderate; actual ticket complexities aligned with triage estimate.

### 2026-04-26 — Model selector component (T02)
- Signal: model-selector needed internal state management without leaking to session runtime.
- Recommended pipeline: team-builder direct since surface was well-understood after prior architect work.
- Safety notes: selector state must sync with server-side model config but must not overwrite it on transient UI state changes.

### 2026-04-27 — Supervisor mediator semantic upgrades
- Signal: server supervisor module, internal semantic decision vocabulary added while external runtime actions remain unchanged (`done|continue|needs_user|abort`).
- Recommended pipeline: `team-explorer` to map decision/schema/adapter/test surfaces, then `team-architect` to define internal semantic action contract and mapping boundary, then `team-builder` tickets. Use validator after all serialized tickets.
- Ticket slicing that worked: T01 types/schema and T02 prompt rewrite in parallel; T03 loop+adapter serialized after T01/T02; T04 tests serialized after T03.
- Safety notes: semantic actions must not leak into shared event schemas/UI/persistence; unsafe commit/push/deploy/destructive gates should explicit ESCALATE and not fall through to LLM; SAVE_MEMORY should be non-blocking.
- Calibration: triage complexity 72/100; actual ticket complexities 15/45/55/30; validation quality 100. Treat as light pattern from one high-quality run, not a global heuristic.
- Based on: artifacts/20260427-upgrade-supervisor-coding-orchestration/learnings/T01-T04-curator-learning.md
