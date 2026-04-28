---
artifact-contract: shared-meta
purpose: routing-metrics
steward: team-orchestrator
audience: orchestrator, team-architect
updated: 2026-04-27
---

# Routing Metrics

Indicative data points from prior execution runs. Each entry includes session identifier, triage metrics, actual ticket metrics, pipeline used, and executor fit notes. These are evidence points, not strong heuristics — use for calibration only.

---

### 2026-04-26 data point — supervisor_ui_refactor
- session: 20260426-supervisor-ui-refactor
- triage_complexity: 50/100
- triage_risk: 40/100
- actual_ticket_complexities: T01=30, T02=35, T03=25
- actual_risks: T01=15, T02=20, T03=10
- validator_quality: 95/100
- pipeline: explorer -> architect -> builder -> validator -> curator
- executor_fit: team-builder good for UI component tickets
- note: moderate complexity, good alignment between triage and actuals.

### 2026-04-26 data point — model_selector_t02
- session: 20260426-model-selector-t02
- triage_complexity: 35/100
- triage_risk: 20/100
- actual_ticket_complexities: T02=35
- actual_risks: T02=20
- validator_quality: 98/100
- pipeline: builder -> validator -> curator
- executor_fit: direct team-builder assignment worked
- note: well-understood surface, no architect phase needed.

### 2026-04-27 data point — supervisor_semantic_layer
- session: 20260427-upgrade-supervisor-coding-orchestration
- triage_complexity: 72/100
- triage_risk: 62/100
- actual_ticket_complexities: T01=15, T02=45, T03=55, T04=30
- actual_risks: T01=10, T02=15, T03=30, T04=15
- validator_quality: 100/100
- pipeline: explorer -> architect -> builder(T01/T02 parallel, T03/T04 serialized) -> validator -> curator
- executor_fit: team-builder good after architect contract design
- note: single-session calibration; use as indicative evidence only.
