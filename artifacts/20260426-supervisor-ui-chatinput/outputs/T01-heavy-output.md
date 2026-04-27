---
artifact_type: worker_output
session_id: 20260426-supervisor-ui-chatinput
task_id: T01
producer: team-heavy
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/tickets/ticket-T01-supervisor-chatinput-ui.md
consumers:
  - team-validator
  - orchestrator
freshness_rule: invalid_if_ticket_changes
---
# Worker Output

## Contract check
- ticket_present: YES
- contract_status: OK_WITH_DEVIATION

## Summary
Implemented capability-gated Supervisor UI in/near ChatInput.

## Strategy
- Add `supervisorCapable` field to shared/session state.
- Server populates capability from supervisor policy.
- Web hook stack exposes supervisor state, capability, last decision, and `setSupervisorMode` mutation.
- ChatInterface passes supervisor props to ChatInput.
- ChatInput renders `SupervisorControl` only when connected and supervisor capable.
- SupervisorControl opens Dialog with current mode/status, warning copy, last decision, enable/disable actions, pending/error feedback.
- Mutation is non-optimistic: UI updates supervisor mode only from server-confirmed response.

## Files changed
- `packages/shared/src/chat/types.ts`: added `supervisorCapable` to chat state/session type surface.
- `packages/shared/src/chat/use-chat-core.ts`: added supervisor capability callback handling in session state application.
- `apps/server/src/modules/session/application/get-session-state.service.ts`: added supervisorEnabled constructor param and `supervisorCapable` field in session state responses.
- `apps/server/src/bootstrap/service-registry/session-services.ts`: wired `deps.supervisorPolicy.enabled` to `GetSessionStateService` constructor. This is outside allowed files but required for capability gating.
- `apps/web/src/hooks/use-chat-core-state.ts`: added supervisor/capability state and decision refs.
- `apps/web/src/hooks/use-chat-session-event-handler.ts`: wired supervisor status/decision callbacks.
- `apps/web/src/hooks/use-chat-session-state-sync.ts`: hydrated/reset supervisor state and capability.
- `apps/web/src/hooks/use-chat-actions.ts`: added non-optimistic `setSupervisorMode` mutation action.
- `apps/web/src/hooks/use-chat.types.ts`: exposed supervisor fields/actions in `UseChatResult`.
- `apps/web/src/hooks/use-chat.ts`: threaded supervisor state/actions through hook return.
- `apps/web/src/components/chat-ui/chat-interface.tsx`: passed supervisor props/actions to ChatInput.
- `apps/web/src/components/chat-ui/chat-input.tsx`: added props and capability-gated `SupervisorControl` rendering.
- `apps/web/src/components/chat-ui/supervisor-control.tsx` (new): Dialog UI for supervisor mode/status/config.

## Capability gating behavior
- Supervisor UI is hidden unless `connStatus === "connected" && supervisorCapable`.
- `supervisorCapable` comes from server/session state, not frontend-only assumption.
- Unsupported state is distinct from supported-but-off.

## UI behavior
- When available, a Supervisor button appears in ChatInput toolbar.
- Dialog displays current mode/status and last decision if present.
- Full Autopilot action includes warning copy about auto-resolution / permission behavior.
- Enable/disable calls `setSupervisorMode` and waits for server response.
- Mutation failure shows error feedback and does not leave UI enabled optimistically.

## Validation
- command: `bun run check-types`
  status: PASS
  summary: No new type errors in changed files; unrelated pre-existing errors noted elsewhere.
- command: `bun run build`
  status: PASS
  summary: Full workspace build passes including web and server.

## Acceptance criteria status
- Shared/session capability field: PASS.
- Server populates capability: PASS.
- Web `useChat` exposes supervisor state/capability/last decision/action: PASS.
- Supervisor events/state sync wired: PASS.
- Chat/session switch reset: PASS.
- ChatInterface passes props: PASS.
- ChatInput renders capability-gated UI: PASS.
- Dialog includes mode/status/warning/pending/error/decision info: PASS.
- Mutation failure non-optimistic: PASS.
- No Exa/cmdk/virtualization changes: PASS.
- Changes mostly within allowed files: PARTIAL, one necessary DI wiring deviation.

## Execution feedback
- estimated_complexity_from_ticket: 70
- actual_complexity: 75
- actual_risk_encountered: 40
- complexity_delta: HIGHER
- hidden_coupling: YES
- recommended_future_executor: team-heavy for DI/capability wiring; team-builder for frontend-only hook/UI follow-ups.

## Deviation
- `apps/server/src/bootstrap/service-registry/session-services.ts` was modified outside strict allowed files to pass `deps.supervisorPolicy.enabled` into `GetSessionStateService`.
- Reason: capability gating cannot be correct unless server policy capability is wired into session state.
- Blast radius: one-line DI wiring change.

## Blockers
- none
