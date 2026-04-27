---
artifact_type: brief
session_id: 20260426-supervisor-ui-chatinput
task_id: supervisor-ui-chatinput
producer: orchestrator
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: unknown
based_on:
  - user_request
consumers:
  - team-triage
freshness_rule: valid for current user request unless requirements change
---

# Brief

## User request
- Create UI for newly implemented ACP supervisor wrapper.
- User thinks the UI should be placed at `ChatInput`.
- Config options should live in a Dialog.

## User-provided backend/feature context
Implemented the ACP supervisor wrapper end to end:
- Added `src/modules/supervisor/**` with loop, permission resolver, AI SDK decision adapter, optional Exa research adapter, strict Zod schemas, and state helpers.
- Wired post-turn review via `PromptTaskRunner` and headless supervisor follow-ups through `SendMessageService`.
- Wired ACP permission auto-resolution for `full_autopilot`, still using existing permission options and preferring `allow_once`.
- Added `setSupervisorMode` tRPC API, session state persistence, SQLite `supervisor_json`, and shared client event parsing for `supervisor_status` / `supervisor_decision`.
- Added AI dependency and supervisor env config including Exa validation.

## Desired outcome
- Add frontend UI in/near ChatInput to configure supervisor options via dialog.
- Integrate with existing tRPC/session state if available.
- Surface supervisor status/decision events if appropriate and safe.
- Keep UI minimal, consistent with existing design system.

## Unknowns to discover
- Exact supervisor modes/options exposed by API and shared types.
- Existing ChatInput props/state model.
- Existing dialog/settings UI primitives.
- Whether supervisor state is per-session and how current session id is available in ChatInput.
