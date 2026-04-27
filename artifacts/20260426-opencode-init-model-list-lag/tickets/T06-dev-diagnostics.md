---
artifact_type: ticket
session_id: 20260426-opencode-init-model-list-lag
task_id: T06
producer: orchestrator
status: ACTIVE
created_at: 2026-04-27
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-opencode-init-model-list-lag/00-brief-T06-persistent-lag-diagnosis.md
  - artifacts/20260426-opencode-init-model-list-lag/01-triage-report-T06.md
  - artifacts/20260426-opencode-init-model-list-lag/03-explorer-report-T06.md
  - artifacts/20260426-opencode-init-model-list-lag/RUN-INDEX.md
consumers:
  - team-heavy
  - team-validator
freshness_rule: invalid_if_T06_brief_triage_or_explorer_changes
---

# Ticket T06 — Dev-only Lag Diagnostics

## Objective
Add dev-only diagnostics to identify the real cause of persistent web lag after the OpenCode model-list cap. Diagnostics must distinguish payload size, event frequency, server processing, tRPC/WS subscription, client event handling, store updates, and session-state hydration. Do not change production behavior.

## Assigned agent
team-heavy

## User decision
User approved dev-only diagnostics.

## Scope
Implement a minimal but end-to-end diagnostic spine, not every optional probe from explorer. Prefer a small set that can answer: "Is lag due to big payload, too many events, server processing/storage, websocket/subscription replay, client event processing, or Zustand/React fanout?"

## Required server diagnostics
Allowed production files (dev-only instrumentation only):
- `apps/server/src/shared/utils/diagnostics.util.ts` (new): `isDiagnosticsEnabled()`, `diagnosticsLog()`, `estimateJsonBytes()`, maybe simple count helper. Enable only when `process.env.ERAGEAR_DIAGNOSTICS === "1"` or `process.env.ERAGEAR_DIAG === "1"`. Never log full raw payloads by default; log sizes/counts/types/durations.
- `apps/server/src/platform/acp/handlers.ts`: measure ACP session update payload size, update type, and handler duration around `handleSessionUpdate`.
- `apps/server/src/platform/acp/update.ts`: measure `processSessionUpdateUnderLock` duration; log configOptions original/capped model option counts around `capModelList` in `handleConfigOptionsUpdate`.
- `apps/server/src/modules/session/infra/runtime-store.ts`: measure broadcast event type, estimated serialized bytes, duration, whether durable/outbox path used, and buffer size/trim if available.
- `apps/server/src/modules/session/application/get-session-state.service.ts`: log pre/post cap model/config option counts for response.
- `apps/server/src/transport/trpc/routers/session.ts`: log subscription start/buffered event count and estimated buffered bytes before replay.

Optional server probes if easy and low risk:
- stream chunk size in `apps/server/src/platform/acp/update-stream.ts`
- tool output/update size in `apps/server/src/platform/acp/update-tool.ts`

## Required client diagnostics
Allowed production files (dev-only instrumentation only):
- `apps/web/src/hooks/use-chat-diagnostics.ts` (new): client diagnostic helpers enabled by `localStorage.ERAGEAR_DIAGNOSTICS === "1"` or URL `?diag=1`; `diagLog`, `estimateJsonBytes`, `measure`, simple in-memory counters/report function such as `window.__eragearDiagReport?.()` if type-safe.
- `apps/web/src/hooks/use-chat-subscription.ts`: measure incoming event type, estimated bytes, parse/normalization duration, and onData handler duration.
- `apps/web/src/hooks/use-chat-session-event-handler.ts`: measure `processSessionEvent` duration by event type; log slow events above threshold (e.g. >16ms).
- `apps/web/src/store/chat-stream-store.ts`: measure `updateMessageState` duration and message/part count if available.
- `apps/web/src/hooks/use-chat-session-state-sync.ts`: log getSessionState response estimated bytes and model/config option counts after hydration.

## Constraints
1. Disabled by default. Production behavior and API shapes unchanged.
2. No schema/protocol changes.
3. No raw sensitive payload logging by default; only sizes/counts/event types/durations/chatId/sessionId if already present.
4. Diagnostics must be resilient: exceptions in diagnostics must never break app flow.
5. Avoid broad React component instrumentation in this first pass. Hook/store probes are enough.
6. Keep output grep-able with `[DIAG]` prefix.
7. Include clear usage instructions in worker output.

## Acceptance criteria
- Server diagnostics are gated by env and compile when disabled.
- Client diagnostics are gated by localStorage/query param and compile when disabled.
- When enabled, logs can show at least:
  - ACP update event type + payload bytes + duration
  - configOptions original vs capped model option counts
  - runtime broadcast event type + bytes + duration
  - subscription buffered event count/bytes
  - getSessionState pre/post cap counts
  - client received event type + bytes + processing duration
  - client `processSessionEvent` duration by event type
  - store update duration for message updates
  - getSessionState response bytes/counts on client
- No full raw payload content logged by default.
- No production code behavior change beyond gated logging/measurement.
- Provide usage steps for user to enable diagnostics and collect evidence.
- Run targeted typecheck/tests if possible; at minimum ensure touched files typecheck or document pre-existing unrelated errors.

## Validation commands
```bash
cd apps/server && bun run check-types
cd apps/web && bun run check-types
cd apps/server && bunx biome check src/shared/utils/diagnostics.util.ts src/platform/acp/handlers.ts src/platform/acp/update.ts src/modules/session/infra/runtime-store.ts src/modules/session/application/get-session-state.service.ts src/transport/trpc/routers/session.ts
cd apps/web && bunx biome check src/hooks/use-chat-diagnostics.ts src/hooks/use-chat-subscription.ts src/hooks/use-chat-session-event-handler.ts src/store/chat-stream-store.ts src/hooks/use-chat-session-state-sync.ts
```

## Manual usage expected in output
Server:
```bash
ERAGEAR_DIAGNOSTICS=1 cd apps/server && bun run dev
# or
ERAGEAR_DIAG=1 cd apps/server && bun run dev
```
Client browser console:
```js
localStorage.setItem('ERAGEAR_DIAGNOSTICS', '1')
location.reload()
// reproduce lag, then optionally:
window.__eragearDiagReport?.()
```
Alternative: open app with `?diag=1` if supported.
Filter logs by `[DIAG]`.

## Routing rationale
T06 triage/explorer show persistent lag is cross-boundary and previously underestimated. Use team-heavy to implement end-to-end diagnostics without semantic changes.

## Blockers
none
