---
artifact_type: brief
session_id: 20260425-model-selector-lag
task_id: model-selector-lag-v2
producer: orchestrator
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: unknown
based_on:
  - user_followup
  - artifacts/20260425-model-selector-lag/00-brief.md
  - artifacts/20260425-model-selector-lag/validation/T01-validation.md
consumers:
  - team-triage
freshness_rule: valid for follow-up request unless requirements change
---

# Brief v2

## User request
- Improve the previous model selector fix so the frontend can receive/keep all returned model data, but only render a bounded subset.
- User explicitly prefers: "receive all data then render a part".

## Motivation
- Previous validated fix prevented freezing by rendering a capped list, but validation noted a UX limitation: search was scoped to the capped result set, so models beyond the cap could not be discovered via search.

## Desired outcome
- Keep all model data available in memory/data structures.
- Filter/search across the full returned model list.
- Only render a capped/windowed subset of the filtered results.
- Keep currently selected model visible where practical.
- Preserve selection flow and avoid cmdk primitive virtualization risks.

## Acceptance criteria
- Opening selector still avoids mounting all model items.
- Searching can discover models beyond the initial render cap because filtering is applied to all data before render capping.
- Rendered `ModelSelectorItem` count remains bounded after filtering.
- Existing model selection behavior is preserved.
- Build/type validation passes or unrelated failures are documented.
