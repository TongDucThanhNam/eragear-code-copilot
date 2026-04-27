---
artifact_type: brief
session_id: 20260426-opencode-init-model-list-lag
task_id: 00-brief
producer: team-artifact-writer
status: ACTIVE
created_at: 2026-04-26
source_commit: UNKNOWN
based_on: user-request
consumers:
  - team-triage
freshness_rule: one-shot
---

# Brief

## User request
- Vietnamese original: "Tối ưu cho Opencode: Khi mà nó init thì nó sẽ trả về model list CỰC KỲ NHIỀU. Nó NGAY LẬP TỨC khiến app của chúng ta cực kỳ lag."

## Interpreted objective
- Delivery lane: optimize app behavior for OpenCode agent initialization when the agent returns an extremely large model list.
- Prevent the UI/app from becoming immediately laggy during init/model-list ingestion.
- Likely areas: ACP init/update handling, model list state/storage, UI selector rendering, streaming/broadcast payload size, persistence of session/settings/agent capabilities.

## Acceptance criteria
- Identify where OpenCode init/model list is handled and rendered.
- Reduce main-thread/UI lag caused by huge model lists.
- Avoid unnecessary persistence/broadcast/render of the full list where possible.
- Preserve ability to choose/use models, but with bounded/virtualized/lazy/search-based UI or server-side throttling/truncation as appropriate.
- Add/adjust validation or tests when feasible.

## Constraints
- Follow project architecture from AGENTS.md: transport validates/maps input, application orchestrates ports, infra handles IO/policy, no domain imports infra/transport.
- Avoid hardcoded provider-specific hacks unless isolated behind agent/provider capability policy.
- Prefer minimal safe change.
