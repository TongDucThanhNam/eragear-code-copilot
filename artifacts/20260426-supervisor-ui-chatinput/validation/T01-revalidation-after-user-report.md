---
artifact_type: validation
session_id: 20260426-supervisor-ui-chatinput
task_id: T01
producer: team-validator
status: PASS
created_at: 2026-04-26T12:30:00.000Z
source_commit: unknown
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/tickets/ticket-T01-supervisor-chatinput-ui.md
  - artifacts/20260426-supervisor-ui-chatinput/outputs/T01-heavy-output.md
  - artifacts/20260426-supervisor-ui-chatinput/validation/T01-validation.md
  - artifacts/20260426-supervisor-ui-chatinput/validation/user-report-missing-apps-web.md
consumers:
  - orchestrator
freshness_rule: invalid_if_ticket_or_output_changes
---
# Validation — Urgent Revalidation After User Report

## Verdict
PASS

## Exact presence/absence findings
- `apps/web/src/components/chat-ui/supervisor-control.tsx`: PRESENT.
- `apps/web/src/components/chat-ui/chat-input.tsx`: PRESENT supervisor props and `SupervisorControl` rendering gated by `connStatus === "connected" && supervisorCapable`.
- `apps/web/src/components/chat-ui/chat-interface.tsx`: PRESENT supervisor state/action destructuring and props passed to ChatInput.
- `apps/web/src/hooks/use-chat-core-state.ts`: PRESENT supervisor/capability state and refs.
- `apps/web/src/hooks/use-chat-actions.ts`: PRESENT `setSupervisorMode` mutation and non-optimistic update.
- `apps/web/src/hooks/use-chat.types.ts`: PRESENT supervisor fields/actions in `UseChatResult`.
- `apps/web/src/hooks/use-chat.ts`: PRESENT supervisor state/action threading.
- `packages/shared/src/chat/types.ts`: PRESENT supervisor types and `supervisorCapable` state field.
- `packages/shared/src/chat/use-chat-core.ts`: PRESENT session-state capability callback handling.
- `apps/server/src/modules/session/application/get-session-state.service.ts`: PRESENT `supervisorCapable` from server policy.
- `apps/server/src/bootstrap/service-registry/session-services.ts`: PRESENT DI wiring for `deps.supervisorPolicy.enabled`.

## Prior worker/validation claims assessment
No false positives found. All claimed changes exist in the working tree per validator inspection.

## User report analysis
Likely confusion source: per D01 capability gating, Supervisor UI is hidden unless both:
1. chat connection status is `connected`, and
2. backend/session reports `supervisorCapable: true`.

If server supervisor policy/env is disabled, the UI will not appear in ChatInput even though the code exists. This is intended option 3 behavior selected by the user.

## Recommended next action
- No re-implementation needed.
- If the user wants to always see a disabled control, implement a follow-up UX adjustment to render disabled SupervisorControl when not capable.
- Otherwise verify server env/config enabling supervisor capability.

## Blockers
none
