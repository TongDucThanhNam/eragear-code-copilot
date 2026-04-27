---
artifact_type: triage_report
session_id: 20260425-model-selector-lag
task_id: T00
producer: team-triage
status: ACTIVE
created_at: 2026-04-25T12:00:00.000Z
source_commit: unknown
based_on:
  - artifacts/20260425-model-selector-lag/00-brief.md
  - artifacts/meta/routing-metrics.md
  - artifacts/meta/routing-patterns.md
consumers:
  - orchestrator
  - team-vault-reader
  - team-explorer
  - team-architect
freshness_rule: invalid_if_brief_or_relevant_history_changes
---
# Triage Report

## Request class
- Frontend performance/UX bug in model selector.
- Likely localized React rendering issue around a cmdk `CommandList` with large model collections.
- Desired outcome is mitigation/fix, not architectural redesign.

## Scores
- complexity_score: 4
- risk_score: 4
- novelty_score: 3
- confidence_score: 7

## Historical priors used
- artifact: artifacts/meta/routing-metrics.md
  signal: No calibrated routing metrics recorded yet.
  impact_on_route: No strong prior; route based on brief and light repo scan.
- artifact: artifacts/meta/routing-patterns.md
  signal: No routing patterns recorded yet.
  impact_on_route: No known repeated failure pattern to adjust risk/complexity.

## Light repo signals
- path_or_pattern: `apps/web/src/components/ai-elements/model-selector.tsx`
  why_it_matters: `ModelSelectorList` is only a direct `CommandList` wrapper; no built-in virtualization, result cap, debounce, or lazy rendering.
- path_or_pattern: `apps/web/src/components/chat-ui/chat-input.tsx:623-659`
  why_it_matters: Consumer maps all `modelGroups` and all nested `models` into `ModelSelectorGroup`/`ModelSelectorItem`; large lists can create many DOM nodes and logo images when selector opens/searches.
- path_or_pattern: `apps/web/src/components/ui/command.tsx:84-97`
  why_it_matters: Base `CommandList` only constrains scroll height; it does not window the rendered item count.
- path_or_pattern: `ModelSelectorLogo` remote SVG usage
  why_it_matters: Many rendered model rows can trigger many image elements/requests, amplifying freeze even if the main bottleneck is DOM/cmdk filtering.

## Routing recommendation
- needs_vault_context: NO
- needs_explorer: NO
- needs_architect: NO
- initial_executor: team-builder
- requires_human_decision: NO

## Rationale
- Blast radius appears small: one referenced component plus one known consumer.
- The safe route is a minimal frontend mitigation preserving existing public API where practical.
- Likely fixes include adding bounded rendering/result limiting at the model selector usage point, or adding optional list props for limiting/windowing while keeping current exports compatible.
- Full virtualization may be higher risk because cmdk keyboard navigation, grouping, and filtering can be sensitive to custom list rendering.
- Since history artifacts have no calibrated data, confidence is moderate rather than high.

## Alternative routes
- route: team-builder implements minimal result cap/search threshold in `chat-input.tsx` or optional props in `ModelSelectorList`
  tradeoff: Lowest risk and fastest; may not fully solve extreme cases if consumers elsewhere pass huge custom children.
- route: team-builder implements lightweight virtualization/windowing
  tradeoff: Better scalability; higher risk to cmdk selection, group headings, scroll behavior, and accessibility.
- route: team-explorer before implementation
  tradeoff: More certainty about model data shape/count and adjacent usage; likely unnecessary because current usage is localized.

## Human decision gate
- none

## Failure risk signals
- cmdk may still filter/rank all registered items if all children remain mounted.
- Limiting visible results may change UX if users expect browsing every model without search.
- Grouped result limiting can accidentally hide selected/current model or make empty states confusing.
- Remote provider logos can add rendering/network pressure when many models are mounted.
- Virtualization can break keyboard navigation or accessibility if not aligned with cmdk internals.

## Minimal safe route
- Use team-builder.
- Prefer a minimal, reversible mitigation:
  - avoid mounting/rendering unbounded model items,
  - preserve selector component API where practical,
  - keep current selection behavior,
  - show clear UX when results are limited and user should search to narrow results.
- Validate with typecheck and targeted manual/automated smoke around opening selector, searching, selecting, and current model display.

## Blockers
- none
