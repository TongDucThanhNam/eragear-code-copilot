---
artifact_type: brief
session_id: 20260426-opencode-init-model-list-lag
task_id: T06
producer: orchestrator
status: ACTIVE
created_at: 2026-04-27
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-opencode-init-model-list-lag/validation/T04-final-validation.md
  - artifacts/20260426-opencode-init-model-list-lag/validation/T05-validation.md
  - artifacts/20260426-opencode-init-model-list-lag/learnings/T04-learning.md
  - artifacts/20260426-opencode-init-model-list-lag/learnings/T05-learning.md
consumers:
  - team-triage
freshness_rule: invalid_if_user_followup_changes
---

# Brief T06 — Persistent lag diagnosis after model-list cap

## User report
- Vietnamese original: "Vẫn lag lắm bro :/ Có cách nào để check chuẩn nguyên nhân ko nhỉ :?"
- User reports web still lags after T04/T05 cap and test-hardening.
- User asks for a precise way to identify the real cause rather than guessing.

## Context from prior work
- T04 fixed known OpenCode huge model-list payload path by capping client-facing `models.availableModels` and model `configOptions.options` to 100 while keeping internal state uncapped.
- T05 added tests confirming `getSessionState` capped response and uncapped internal set-model/set-config-option behavior.
- Persistent lag suggests either:
  - another ACP/client-facing payload path remains unbounded,
  - event/message/tool-output flood,
  - client React render/memo/filter loop outside model-list cap,
  - local persistence/storage churn,
  - websocket/tRPC state sync replay payload,
  - unrelated UI thread bottleneck.

## Objective
- Diagnose the actual lag source with measurements/instrumentation before applying another fix.
- Prefer a minimal dev-only diagnostic path: payload-size logging, event timing, React/render timing, and/or reproducible synthetic large-payload test.
- Avoid speculative production behavior changes until evidence identifies bottleneck.

## Acceptance criteria
- Identify a concrete measurement plan and likely code paths to instrument.
- If safe, add dev-only diagnostics or test harness that can show whether lag is caused by server payload size, WS/tRPC transport, client state sync, React render, storage/persistence, or agent output flood.
- Produce clear instructions for the user to collect evidence if local reproduction is needed.
- Preserve current Strategy B semantics and do not broaden behavior changes without evidence.
