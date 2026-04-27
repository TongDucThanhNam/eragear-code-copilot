---
artifact_type: ticket
session_id: 20260426-supervisor-ui-chatinput
task_id: T01
producer: team-architect
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/00-brief.md
  - artifacts/20260426-supervisor-ui-chatinput/01-triage-report.md
  - artifacts/20260426-supervisor-ui-chatinput/decisions/D01-supervisor-capability-gated.md
  - artifacts/20260426-supervisor-ui-chatinput/03-explorer-report.md
  - artifacts/20260426-supervisor-ui-chatinput/04-execution-plan.md
consumers:
  - team-heavy
  - team-validator
freshness_rule: invalid_if_plan_brief_triage_decision_or_repo_context_changes
---
# Ticket T01 - Capability-gated Supervisor ChatInput UI

## Objective
- Implement a minimal capability-gated Supervisor UI in/near `ChatInput`.
- Add the minimal shared/server capability field needed for strict D01 gating.
- Expose supervisor state and `setSupervisorMode` through the web chat hook stack.
- Render a Dialog-based configuration UI for `off` and `full_autopilot`, with clear safety copy.

## Assigned agent
team-heavy

## Context
- D01 requires option 3: hide/disable Supervisor UI unless backend/session reports supervisor capability is available.
- Do not expose a one-click Full Autopilot toggle unconditionally.
- Keep scope minimal: no Exa controls, no cmdk work, no virtualization work.

## Allowed files
- `packages/shared/src/chat/types.ts`
- `apps/server/src/modules/session/application/get-session-state.service.ts`
- `apps/web/src/hooks/use-chat-core-state.ts`
- `apps/web/src/hooks/use-chat-session-event-handler.ts`
- `apps/web/src/hooks/use-chat-session-state-sync.ts`
- `apps/web/src/hooks/use-chat-actions.ts`
- `apps/web/src/hooks/use-chat.types.ts`
- `apps/web/src/hooks/use-chat.ts`
- `apps/web/src/components/chat-ui/chat-interface.tsx`
- `apps/web/src/components/chat-ui/chat-input.tsx`
- New small component file under `apps/web/src/components/chat-ui/` only if it keeps `chat-input.tsx` simpler, e.g. `supervisor-control.tsx`

## Acceptance criteria
- Shared/session state exposes a minimal supervisor capability field.
- Server session state populates supervisor capability so frontend can distinguish unsupported from supported-but-off.
- Web `useChat` result exposes supervisor state, supervisor capability, last supervisor decision if available, and `setSupervisorMode(mode)` using existing tRPC mutation.
- Web event/state sync wires existing shared supervisor event handling.
- Chat/session switches reset stale supervisor capability/state appropriately.
- `ChatInterface` passes required supervisor props/actions to `ChatInput`.
- `ChatInput` or adjacent component renders Supervisor UI only when capability is present, or renders a clearly disabled/unavailable state without enabling mode changes.
- Dialog includes current mode/status, mode action for off/full_autopilot, clear warning copy, mutation pending/error feedback if feasible, and last decision/status information when available.
- Mutation failure does not leave UI in an enabled `full_autopilot` state.
- No Exa controls; no cmdk/virtualization changes.
- Changes stay within allowed files unless stop condition triggers.

## Validation commands
- `bun run check-types`
- `bun run build`
- If workspace scripts require app-local execution, use nearest existing equivalent.

## Stop conditions
- need file outside allowed files
- existing API does not expose `setSupervisorMode`
- backend cannot determine supervisor capability without non-minimal supervisor module changes
- implementing capability requires persistence migration or broad schema work
