---
artifact_type: triage_report
session_id: 20260426-supervisor-ui-chatinput
task_id: T00
producer: team-triage
status: ACTIVE
created_at: 2026-04-26T00:00:00.000Z
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/00-brief.md
  - artifacts/meta/routing-metrics.md
  - artifacts/meta/routing-patterns.md
consumers:
  - orchestrator
  - team-explorer
freshness_rule: invalid_if_brief_or_relevant_history_changes
---
# Triage Report

## Request class
- Frontend feature integration in existing chat UI.
- Scope: add UI in/near `ChatInput` for ACP supervisor configuration via Dialog, calling existing `setSupervisorMode` tRPC API and optionally showing supervisor status/decision state.
- Cross-cutting concern: touches chat hook state plumbing, session state, live events, and permission/autopilot safety messaging.

## Scores
- complexity_score: 6
- risk_score: 7
- novelty_score: 5
- confidence_score: 7

## Historical priors used
- Meta routing artifacts available but no directly relevant calibrated prior beyond avoiding unbounded ChatInput dialog lists.

## Light repo signals
- `apps/web/src/components/chat-ui/chat-input.tsx`: primary likely UI insertion point.
- `apps/web/src/components/chat-ui/chat-interface.tsx`: owns `chatId`, calls `useChat`, passes mode/model/config props into `ChatInput`; likely parent for supervisor state/action wiring.
- `apps/web/src/hooks/use-chat.ts` and `apps/web/src/hooks/use-chat.types.ts`: web hook result likely needs supervisor state/action extension.
- `apps/web/src/hooks/use-chat-actions.ts`: existing pattern for tRPC mutations such as `setConfigOption`; supervisor mutation can follow this style.
- `apps/server/src/transport/trpc/routers/ai.ts`: `setSupervisorMode` mutation exists with input `{ chatId, mode }`.
- `packages/shared/src/chat/types.ts`: supervisor mode/status types exist: `mode: "off" | "full_autopilot"`, statuses include `idle`, `queued`, `reviewing`, `continuing`, `done`, `needs_user`, `aborted`, `error`, `disabled`.
- `packages/shared/src/chat/use-chat-core.ts` and event schema tests: shared core parses/forwards `supervisor_status` and `supervisor_decision`.

## Routing recommendation
- needs_vault_context: NO
- needs_explorer: YES
- needs_architect: NO
- initial_executor: team-builder
- requires_human_decision: YES

## Rationale
- This is not a deep architecture task because backend supervisor loop/API already exists and UI can follow existing ChatInput/config mutation patterns.
- Explorer is recommended before implementation because missing link appears to be frontend state plumbing: web `useChat` may not expose supervisor state/action despite shared types/events existing.
- Risk is elevated because `full_autopilot` auto-resolves permissions. UI must avoid accidental enablement and clearly disclose behavior before switching from `off`.

## Minimal safe implementation after decision
- Add ChatInput-adjacent Supervisor button/badge.
- Open Dialog with mode selection (`off`, `full_autopilot`).
- Call `setSupervisorMode` through tRPC hook/action.
- Require existing `chatId`/connected session before enabling changes.
- Show supervisor status/reason/last decision if already available through session state.
- Keep Exa research controls out of scope unless already exposed by API/client state.

## Human decision gate
- reason: `full_autopilot` implies permission auto-resolution, so product/security should confirm exposure and warning/confirmation UX.
- options:
  1. Minimal safe default: mode is Off by default; Dialog can enable Full autopilot with warning copy; no one-click toolbar toggle.
  2. Stricter route: require a confirmation checkbox before enabling Full autopilot.
  3. Defer visibility: hide/disable UI unless backend/session explicitly reports supervisor capability.

## Failure risk signals
- Web hook may not yet expose `supervisor` state despite shared types/events existing.
- `setSupervisorMode` may not be typed in web tRPC client until verified.
- ChatInput prop complexity can grow; extracting a small child component may be safer.
- Status/decision events may arrive while session switches; guard by active `chatId`.
- Avoid optimistic UI that implies full_autopilot enabled if mutation fails.
- Exa research appears backend/env-driven; adding frontend Exa controls without API support would expand scope.

## Blockers
- Human/product decision required on exposing `full_autopilot` and warning/confirmation UX.
