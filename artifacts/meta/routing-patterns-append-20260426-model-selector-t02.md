---
target: artifacts/meta/routing-patterns.md
operation: append
created: 2026-04-26
reason: read-restricted-target — delta artifact for manual merge
signal_strength: validated_followup_same_session
source: artifacts/20260425-model-selector-lag/learnings/T02-learning.md
---

## 20260426-model-selector-lag-T02 — cmdk full-data filter before render cap
- source: `artifacts/20260425-model-selector-lag/learnings/T02-learning.md`
- signal_strength: validated_followup_same_session
- pattern: for cmdk-backed large lists, keep all returned data in memory, run controlled/external filtering across the full data set first, then render only a capped/windowed subset of the filtered result.
- route_note: `team-builder` remains a good fit when localized to consumer data-mapping; avoid cmdk primitive virtualization unless explicitly required.
- risk_note: relying on cmdk built-in filtering after render capping only searches mounted items; make search-scope an acceptance criterion.
- metrics_note: do not update routing-metrics yet; wait for independent repeated incidents.
