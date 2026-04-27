---
artifact_type: brief
session_id: 20260426-opencode-init-model-list-lag
task_id: T05
producer: orchestrator
status: ACTIVE
created_at: 2026-04-27
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-opencode-init-model-list-lag/validation/T04-final-validation.md
  - artifacts/20260426-opencode-init-model-list-lag/learnings/T04-learning.md
consumers:
  - team-triage
freshness_rule: invalid_if_user_followup_changes
---

# Follow-up Brief — Continue OpenCode model-list optimization

## User request
- Vietnamese original: "Continue tối ưu: Có một vòng repair T04 vì T02 ban đầu chỉ normalize configOptions nhưng chưa truncate thật sự. Đã fix xong để broadcast không còn gửi full model list cực lớn nữa."

## Interpreted objective
- Continue optimizing the OpenCode huge model-list flow after the T04 repair.
- Focus on remaining safe improvements from validation/learnings, especially preventing regressions around capped session-state/broadcast payloads and ensuring validation/write paths still work with internal uncapped state.
- Avoid changing the already-approved Strategy B semantics unless triage finds a clear safe extension.

## Candidate follow-up scope
- Add missing explicit test coverage for `getSessionState` capped response.
- Add/verify integration coverage that `set-model` / `set-config-option` still validate against uncapped internal state when a target model is outside the capped client payload.
- Optionally inspect whether any remaining client-facing broadcast/session-state path can still leak full OpenCode model `configOptions.options` arrays.

## Acceptance criteria
- Preserve current Strategy B: internal state uncapped; client-facing copies capped; current/default model preserved.
- Improve confidence through targeted tests and/or a minimal bug fix only if a remaining leak is found.
- Do not introduce protocol/schema changes.
- Run targeted validation where possible.
