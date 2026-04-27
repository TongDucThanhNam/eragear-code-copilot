---
artifact_type: explorer_report
session_id: 20260426-supervisor-ui-chatinput
task_id: T00
producer: team-explorer
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/00-brief.md
  - artifacts/20260426-supervisor-ui-chatinput/01-triage-report.md
  - artifacts/20260426-supervisor-ui-chatinput/decisions/D01-supervisor-capability-gated.md
consumers:
  - orchestrator
  - team-architect
  - team-builder
freshness_rule: invalid_if_brief_triage_decision_or_repo_shape_changes
---
# Explorer Report

## Objective interpreted
Add a capability-gated Supervisor configuration UI in/near ChatInput. The UI must detect whether the server supports supervisor, show a status indicator when available, open a Dialog with mode selection (`off` / `full_autopilot`), call `setSupervisorMode`, and surface live `supervisor_status` / `supervisor_decision` events opportunistically.

## Key finding
The web hook layer currently does not expose supervisor state or `setSupervisorMode` action. Shared core already has supervisor callbacks, but web bindings do not wire them. Also, session state currently normalizes supervisor to `{ mode: "off", status: "idle" }` even when supervisor is not configured, so frontend cannot distinguish unsupported from supported-but-off. Decision D01 requires capability gating, so a capability field/query is needed.

## Entry paths
- `apps/web/src/hooks/use-chat-core-state.ts`: add `supervisor` state/ref and expose it.
- `apps/web/src/hooks/use-chat-session-event-handler.ts`: pass `onSupervisorChange` / `onSupervisorDecision` to shared `processSessionEvent`.
- `apps/web/src/hooks/use-chat-session-state-sync.ts`: pass `onSupervisorChange` to `applySessionState`, reset supervisor/capability on chatId change.
- `apps/web/src/hooks/use-chat-actions.ts`: add `setSupervisorMode` action using `trpc.setSupervisorMode.useMutation()`.
- `apps/web/src/hooks/use-chat.types.ts`: add supervisor state/capability/action to `UseChatResult`.
- `apps/web/src/hooks/use-chat.ts`: thread supervisor state/action into return value.
- `apps/web/src/components/chat-ui/chat-interface.tsx`: pass supervisor props to `ChatInput`.
- `apps/web/src/components/chat-ui/chat-input.tsx`: render capability-gated trigger/dialog.
- `apps/server/src/modules/session/application/get-session-state.service.ts`: expose supervisor capability in session state.
- `packages/shared/src/chat/types.ts`: add shared capability field to session state type.

## Existing API/types
- tRPC mutation exists: `setSupervisorMode` accepts `{ chatId, mode }`, where mode is `"off" | "full_autopilot"`, and returns `{ supervisor: SupervisorSessionState }`.
- Shared types include `SupervisorSessionState`, `SupervisorMode`, `SupervisorStatus`, `SupervisorDecisionSummary`.
- Shared core parses/forwards `supervisor_status` and `supervisor_decision` events.

## UI primitives
- Use existing `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription` from `@/components/ui/dialog`.
- Use existing `Button`, `Badge`, `Switch` or `Select`.
- Reference `permission-dialog.tsx` for app dialog conventions.

## Proposed implementation touchpoints
1. Add shared `supervisorCapable?: boolean` to session state data.
2. Server `getSessionState` populates `supervisorCapable` from supervisor policy/capability.
3. Web hook stack stores and updates `supervisor`, `supervisorCapable`, and exposes `setSupervisorMode`.
4. ChatInterface passes supervisor props to ChatInput.
5. ChatInput renders a small `SupervisorControl`/dialog only if capability true; otherwise hide or disabled state per D01.
6. Dialog shows status, mode selection, warning copy for full_autopilot, and last decision if available.

## Risks/blockers
- Missing `supervisorCapable` field blocks strict capability gating.
- Hook plumbing spans several files, increasing complexity beyond a simple ChatInput component addition.
- Mutation failure must not leave UI pretending full_autopilot is enabled.
- Avoid optimistic UI unless server response confirms new supervisor state.
- Exa research controls are out of scope unless API already exposes them.

## Calibration
- complexity_assessment: HIGHER_THAN_TRIAGE
- risk_assessment: MATCHED
- suggested_executor: team-builder if planned as one clear ticket, team-heavy if DI/backend capability wiring is more invasive than expected.
