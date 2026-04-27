---
artifact_type: worker_output
session_id: 20260426-opencode-init-model-list-lag
task_id: T06
producer: team-heavy
status: ACTIVE
created_at: 2026-04-27
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-opencode-init-model-list-lag/tickets/T06-dev-diagnostics.md
  - artifacts/20260426-opencode-init-model-list-lag/03-explorer-report-T06.md
  - artifacts/20260426-opencode-init-model-list-lag/01-triage-report-T06.md
consumers:
  - team-validator
  - orchestrator
freshness_rule: invalid_if_ticket_changes
---

# Worker Output — T06 Dev-only Lag Diagnostics

## Summary
- Implemented dev-only diagnostics across server ACP/update/broadcast/session-state/subscription paths and client subscription/event-handler/store/hydration paths.
- Disabled by default; no schema/protocol/behavior changes; no full raw payload logging.
- 11 files changed:
  - `apps/server/src/shared/utils/diagnostics.util.ts` NEW
  - `apps/web/src/hooks/use-chat-diagnostics.ts` NEW
  - `apps/server/src/platform/acp/handlers.ts`
  - `apps/server/src/platform/acp/update.ts`
  - `apps/server/src/modules/session/infra/runtime-store.ts`
  - `apps/server/src/modules/session/application/get-session-state.service.ts`
  - `apps/server/src/transport/trpc/routers/session.ts`
  - `apps/web/src/hooks/use-chat-subscription.ts`
  - `apps/web/src/hooks/use-chat-session-event-handler.ts`
  - `apps/web/src/store/chat-stream-store.ts`
  - `apps/web/src/hooks/use-chat-session-state-sync.ts`

## Gating
- Server: `ERAGEAR_DIAGNOSTICS=1` or `ERAGEAR_DIAG=1`.
- Client: `localStorage.ERAGEAR_DIAGNOSTICS = "1"` or URL `?diag=1`.
- Client report: `window.__eragearDiagReport?.()`.

## Server logs/events
- `[DIAG:acp-update-received]`: chatId, updateType, payloadBytes.
- `[DIAG:acp-update-handler-done]`: chatId, updateType, payloadBytes, durationMs.
- `[DIAG:update-under-lock]`: chatId, updateType, isReplayingHistory, durationMs.
- `[DIAG:config-options-cap]`: chatId, configOptionsCount, modelOptionOriginalCount.
- `[DIAG:broadcast]`: chatId, eventType, eventBytes, durable, bufferSizeAfter, durationMs.
- `[DIAG:get-session-state-cap]`: chatId, preCapModelCount, postCapModelCount, preCapConfigCount, postCapConfigCount.
- `[DIAG:subscription-replay]`: chatId, bufferedEventCount, estimatedBufferedBytes, subscriptionSource.

## Client logs/events
- `[DIAG:subscription-raw-event]`: chatId, eventType, estimatedBytes.
- `[DIAG:subscription-parse]`: chatId, parseDurationMs.
- `[DIAG:subscription-onData-done]`: chatId, eventType, estimatedBytes, totalDurationMs.
- `[DIAG:processSessionEvent]`: chatId, eventType, durationMs, slow (>16ms).
- `[DIAG:store-updateMessageState]`: chatId, durationMs, messageCount, partCount, prevMessageCount, prevPartCount, slow (>16ms).
- `[DIAG:session-state-hydrate]`: chatId, chatStatus, status, estimatedBytes, modelCount, configOptionCount, modeCount, currentModelId.

## Usage
1. Start server: `ERAGEAR_DIAG=1 cd apps/server && bun run dev 2>&1 | tee /tmp/diag.log`.
2. In browser console: `localStorage.setItem('ERAGEAR_DIAGNOSTICS', '1'); location.reload()` or open with `?diag=1`.
3. Reproduce lag with OpenCode/Claude init or suspected action.
4. Collect server logs: `grep '\[DIAG' /tmp/diag.log`; collect browser console logs and run `window.__eragearDiagReport?.()`.
5. Disable: restart server without env; browser `localStorage.removeItem('ERAGEAR_DIAGNOSTICS'); location.reload()`.

## Interpretation quick guide
- Large `payloadBytes`, `eventBytes`, or `estimatedBytes` => payload-size bottleneck / uncapped data leak.
- Many repeated `[DIAG:acp-update-received]`, `[DIAG:broadcast]`, or `[DIAG:subscription-raw-event]` per second => event flood.
- High server `durationMs` on handler/update/broadcast => server processing/storage/broadcast bottleneck.
- High `estimatedBufferedBytes` or `bufferedEventCount` at subscription replay => reconnect/session replay flood.
- High client parse/onData/processSessionEvent durations => client event processing bottleneck.
- High `store-updateMessageState` duration or slow=true => Zustand/message render fanout bottleneck.
- High `session-state-hydrate` bytes/counts => tRPC hydration/session-state payload bottleneck.

## Validation reported by worker
- Server biome check on touched files: PASS.
- Server check-types filtered to touched files: PASS; 60 pre-existing unrelated errors.
- Web check-types filtered to touched files: PASS; 33 pre-existing unrelated errors.

## Behavioral impact
- NONE. Diagnostics disabled by default.

## Calibration
- estimated_complexity_from_ticket: 78
- actual_complexity: 72
- actual_risk_encountered: 25
- complexity_delta: MATCHED
- recommended_future_executor: team-heavy for cross-boundary diagnostics

## Residual risks
- No automated tests for diagnostics; verification requires running with env/localStorage flags.
- User may forget to disable client localStorage diagnostics.
- Diagnostic timing can perturb extremely tight loops slightly when enabled.

## Blockers
none
