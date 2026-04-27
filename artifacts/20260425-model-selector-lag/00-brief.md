---
artifact_type: brief
session_id: 20260425-model-selector-lag
task_id: model-selector-lag
producer: orchestrator
status: ACTIVE
created_at: 2026-04-25T12:00:00.000Z
source_commit: unknown
based_on:
  - user_request
consumers:
  - team-triage
freshness_rule: valid for current user request unless requirements change
---

# Brief

## User request
- Investigate/advise fix for frontend freezing when the model selector receives too many models.
- Referenced file: `apps/web/src/components/ai-elements/model-selector.tsx`.

## Provided code context
- `ModelSelectorList` is currently a direct `CommandList` wrapper.
- Items/groups are rendered by consumers via `ModelSelectorItem`/`ModelSelectorGroup`.
- No list virtualization, pagination/windowing, debounce, or result limiting is visible in the provided component.

## Desired outcome
- Identify safe mitigation options and, if implementation is routed, produce a minimal fix that prevents UI freeze with large model lists.

## Constraints
- Preserve existing public API where practical.
- Avoid risky UX regressions in model search/selection.
