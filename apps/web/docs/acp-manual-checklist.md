# ACP Manual Checklist (P0)

Use this checklist to manually verify ACP session lifecycle, loading states, and stream safety.

## Prerequisites

1. Start server and web app in dev mode.
2. Open browser DevTools (`Network` + `Console`).
3. Keep at least 2 chat sessions available for fast switching tests.

## Case 1: New Session Loading State

1. Click `New Session`.
2. Select an ACP agent (example: `claude code`).
3. Open the newly created chat.

Expected:
- UI shows `Creating session...` then `ACP agent initializing...`.
- Loading state disappears after connection becomes ready.
- No blank state without feedback.

Related code:
- `apps/web/src/components/chat-ui/chat-interface.tsx:69`
- `apps/web/src/components/chat-ui/chat-interface.tsx:424`
- `apps/web/src/components/chat-ui/chat-interface.tsx:772`

## Case 2: Reconnect / Resume Loading Overlay

1. Open an active chat.
2. Refresh page or trigger resume flow.

Expected:
- Overlay shows bootstrap phase (`ACP agent initializing...` or `Restoring history...`).
- Overlay exits when connected.

Related code:
- `apps/web/src/components/chat-ui/chat-interface.tsx:784`

## Case 3: Missing Message Fallback Cancel (Network Abort)

1. Open DevTools `Network`.
2. Set throttle to `Fast 3G`.
3. Send a message.
4. Switch to another chat immediately.
5. Watch `getSessionMessageById` request.

Expected:
- Request is canceled/aborted.
- No fallback result from old chat updates the new chat.

Related code:
- `apps/web/src/hooks/use-chat.ts:446`

## Case 4: Delta Merge Correctness (partIndex)

1. Run a prompt that streams many tokens and includes tool-call interleaving.
2. Observe message parts while streaming.

Expected:
- Text/reasoning deltas append only to correct `partIndex`.
- No text jumps to wrong block.

Related code:
- `packages/shared/src/chat/use-chat-core.ts:158`

## Case 5: Terminal Output Memory Guard

1. Trigger a tool producing large/continuous terminal output.
2. Observe memory and UI responsiveness.

Expected:
- Tab stays responsive.
- Terminal output is trimmed safely (bounded size).

Related code:
- `apps/web/src/store/chat-stream-store.ts:45`

## Case 6: Server Mutation Lock Safety (Smoke)

1. While streaming, quickly do `cancel`, `respond permission`, subscribe/unsubscribe events.
2. Repeat several times.

Expected:
- No session crash from mutation races.
- No queue overflow crash.
- Chat state remains consistent.

Related code:
- `apps/server/src/modules/session/application/session-runtime-lock.assert.ts:1`
- `apps/server/src/modules/session/infra/runtime-store.ts:187`

## Result Template

Use this quick log format:

```text
Date:
Tester:
Branch/Commit:

Case 1: PASS/FAIL - Notes
Case 2: PASS/FAIL - Notes
Case 3: PASS/FAIL - Notes
Case 4: PASS/FAIL - Notes
Case 5: PASS/FAIL - Notes
Case 6: PASS/FAIL - Notes
```

