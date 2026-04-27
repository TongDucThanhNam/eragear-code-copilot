---
artifact_type: ticket
session_id: 20260425-model-selector-lag
task_id: T02
producer: orchestrator
status: ACTIVE
created_at: 2026-04-26T00:05:00.000Z
source_commit: unknown
based_on:
  - artifacts/20260425-model-selector-lag/00-brief-v2.md
  - artifacts/20260425-model-selector-lag/01-triage-report-v2.md
  - artifacts/20260425-model-selector-lag/validation/T01-validation.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_model_selector_usage_or_requirements_change
---
# T02 - Full-data search with bounded model selector rendering

## Problem
The previous fix prevents freezing by rendering a capped subset of models, but search is scoped to the rendered subset. The user wants a more complete approach: receive/keep all model data, search/filter all data, then render only a bounded part of the filtered result.

## Scope
- Update the model selector consumer implementation, likely `apps/web/src/components/chat-ui/chat-input.tsx`.
- Preserve `apps/web/src/components/ai-elements/model-selector.tsx` public API unless a small backwards-compatible extension is clearly needed.
- Do not implement full cmdk virtualization or modify base command primitives unless unavoidable.

## Required approach
- Keep all returned model data available in memory/data structures.
- Use controlled `ModelSelectorInput` search text to filter across the full model list before render capping.
- Regroup filtered results by provider/group as needed.
- Apply a render cap/window after filtering.
- Render only the capped/windowed result subset.
- Keep currently selected model visible where practical, but avoid unbounded item mounting.
- Adjust hint/copy to distinguish rendered count from full filtered/total count.

## Acceptance criteria
- Opening selector with a large model list does not mount all models.
- Searching can discover/select a model beyond the initial cap because filtering runs on the full data set before capping.
- Rendered `ModelSelectorItem` count remains bounded after search/filtering.
- Existing selection flow still works and closes/updates as before.
- No risky changes to cmdk primitives/keyboard behavior.
- Typecheck/build or relevant validation passes; unrelated failures documented.

## Validation expectations
- Show evidence or reasoning for a model beyond the initial cap becoming visible when searched.
- Confirm full list is not rendered on open.
- Confirm build/type validation.
