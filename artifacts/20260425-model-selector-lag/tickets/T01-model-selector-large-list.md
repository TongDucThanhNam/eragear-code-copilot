---
artifact_type: ticket
session_id: 20260425-model-selector-lag
task_id: T01
producer: orchestrator
status: ACTIVE
created_at: 2026-04-25T12:05:00.000Z
source_commit: unknown
based_on:
  - artifacts/20260425-model-selector-lag/00-brief.md
  - artifacts/20260425-model-selector-lag/01-triage-report.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_model_selector_usage_or_requirements_change
---
# T01 - Prevent model selector freeze with large model lists

## Problem
When the backend/provider returns too many models, opening/searching the frontend model selector can freeze the UI. Triage indicates the current selector/list usage mounts all grouped model items and many logo images, while the base CommandList only scrolls and does not virtualize/window rendered rows.

## Scope
- Inspect the model selector usage around `apps/web/src/components/chat-ui/chat-input.tsx` and primitives around `apps/web/src/components/ai-elements/model-selector.tsx` / `apps/web/src/components/ui/command.tsx` as needed.
- Implement the smallest safe mitigation that prevents unbounded mounting/rendering of model rows.
- Preserve public component API where practical.
- Avoid full virtualization unless clearly necessary and safe with cmdk keyboard navigation.

## Preferred approach
- Add bounded rendering at the consumer/data mapping layer for model groups/items.
- Keep the currently selected model visible if possible.
- Show a small user-facing hint when results are limited, e.g. ask user to type/search to narrow results.
- Use memoized filtering/limiting and avoid rendering remote logo images for hundreds/thousands of offscreen/non-visible items.

## Acceptance criteria
- Opening the selector with a large returned model list does not mount every model item at once.
- Search still works for model names/providers in the visible/limited result set strategy chosen.
- Selecting a model still calls the existing selection flow and closes/updates as before.
- Existing imports/types remain valid.
- Type check or the most relevant available validation command passes, or failures are documented as unrelated/blocking.

## Notes
- Triage recommends `team-builder` and no vault/explorer/architect.
- Be conservative: result cap/search threshold is preferred over risky virtualized cmdk integration.
