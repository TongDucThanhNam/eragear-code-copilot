# Message Split Bug Analysis

## Bug Description
Assistant responses are split into TWO separate messages instead of one.
Both web AND native clients exhibit this bug.

## Key Files Analyzed

### Server
- `apps/server/src/platform/acp/update-stream.ts` — Main streaming logic
- `apps/server/src/platform/acp/update-buffer.ts` — SessionBuffering class
- `apps/server/src/platform/acp/update.ts` — Update orchestration + finalizeStreamingForCurrentAssistant
- `apps/server/src/platform/acp/update-tool.ts` — Tool call handling
- `apps/server/src/platform/acp/ui-message-part.ts` — broadcastUiMessagePart
- `apps/server/src/shared/utils/ui-message/state.ts` — getOrCreateAssistantMessage, ensureMessage
- `apps/server/src/shared/utils/ui-message/content.ts` — appendTextPart, appendContentBlock
- `apps/server/src/shared/utils/chat-events.util.ts` — maybeBroadcastChatFinish
- `apps/server/src/modules/ai/application/send-message/prompt-task-runner.ts` — Turn finalization
- `apps/server/src/modules/session/application/subscribe-session-events.service.ts` — Subscription buffered events

### Shared
- `packages/shared/src/chat/use-chat-core.ts` — processSessionEvent, applyMessagePartUpdate
- `packages/shared/src/chat/message-order.ts` — compareUiMessagesChronologically, findUiMessageInsertIndex
- `packages/shared/src/chat/event-schema.ts` — parseBroadcastEventClientSafe, parseUiMessageClientSafe

### Web Client
- `apps/web/src/hooks/use-chat.ts` — Web chat hook
- `apps/web/src/hooks/use-chat-message-state.ts` — MessageState, applyPartUpdate, mergeMessagesIntoState
- `apps/web/src/hooks/use-chat-normalize.ts` — normalizeMessage

### Native Client
- `apps/native/hooks/use-chat.ts` — Native chat hook with batching
- `apps/native/store/chat-store.ts` — Zustand store, upsertMessage

## Server Analysis (Confirmed Correct)

### One Message Per Turn
The server creates exactly ONE message per assistant turn:
1. `buffer.messageId` is set on first `appendBlock` and never changes until `reset()`
2. `buffer.reset()` ONLY happens on `user_message_chunk` (new user message = new turn)
3. `buffer.flush()` ONLY happens at turn end in `prompt-task-runner.ts`
4. `currentAssistantId` is set on first assistant chunk and stays until `user_message_chunk` clears it
5. All tool calls use `currentAssistantId` to attach to the same message

### Event Broadcasting
- **User messages**: Broadcast as `ui_message` (includes full message with `createdAt`)
- **Assistant message chunks**: Broadcast as `ui_message_part` snapshots (`isNew=true` on create, `isNew=false` on append/finalize)
- **CRITICAL: `broadcastUiMessagePart` does NOT include `createdAt`** — only sends messageId, messageRole, partIndex, part, isNew
- **Tool calls**: Broadcast as `ui_message_part` via `broadcastUiMessagePart`
- **`chat_finish`**: Includes full message WITH `createdAt` via `maybeBroadcastChatFinish`

### Part Lifecycle Within One Message
When agent sends: text → tool → text:
1. First text → `ui_message_part(partIndex=0, text(streaming), isNew=true)` then throttled `ui_message_part(partIndex=0, text(streaming), isNew=false)`
2. Tool call → `finalizeStreaming` (text→done) → `ui_message_part(partIndex=0, text(done), isNew=false)` → then `ui_message_part(partIndex=1, tool, isNew=true)`
3. More text → `ui_message_part(partIndex=2, text(streaming), isNew=true)` then throttled `ui_message_part(partIndex=2, text(streaming), isNew=false)`

Result in ONE message: `[text(done), tool, text(streaming)]`

### Chunk Type Transitions
In `updateAssistantChunkType`: when transitioning between message↔reasoning:
- Calls `finalizeStreamingForCurrentAssistant` (changes streaming→done, flushes pending reasoning)
- Does NOT reset buffer, does NOT clear currentAssistantId
- All parts go to the SAME message

## Client Analysis

### Web Client - `applyPartUpdate`
When `ui_message_part` arrives for unknown message:
```typescript
const created: UIMessage = {
  id: update.messageId,
  role: update.messageRole,
  parts: [update.part],
};
return mergeMessagesIntoState(state, [created]);
```
Creates message WITHOUT `createdAt` → `findUiMessageInsertIndex` places it AFTER all messages with `createdAt` (correct ordering).

For existing messages: updates in place, NO position change.

### Native Client - `applyMessagePartUpdate`
When `ui_message_part` arrives for unknown message:
- Creates message with tentative `createdAt` (last message timestamp + 1)
- `upsertMessage` in chat-store inserts at correct sorted position

For existing messages: checks `createdAtChanged`, re-positions if needed.

### Message Ordering (`compareUiMessagesChronologically`)
- Both `createdAt`: sort by timestamp, then role, then ID
- Only left has `createdAt`: left before right
- Only right has `createdAt`: left after right
- Neither has `createdAt`: equal (maintain current order)

## Critical Gap: `createdAt` Missing From `ui_message_part`

The `broadcastUiMessagePart` function sends:
```typescript
{
  type: "ui_message_part",
  messageId: message.id,
  messageRole: message.role,
  partIndex,
  part,
  isNew,
}
```
It does NOT include `createdAt` even though the server-side message has it.

This means:
- Web client creates assistant messages WITHOUT `createdAt` (until `chat_finish` provides it)
- Native client creates with TENTATIVE `createdAt`

## Possible Root Causes (Still Investigating)

### Hypothesis 1: History Load Race
If history loads during streaming, it could introduce messages that conflict with streaming state.
- Web: `loadHistory` called on connect, reconnect, and after `chat_finish`
- Native: `getSessionMessages` query on connect

### Hypothesis 2: Subscription Catch-up Events
`buildBufferedEvents` creates full `ui_message` snapshots + live `ui_message_part/delta` events.
On reconnect, client receives snapshot (with `createdAt`) + pending events. Could cause duplication if message already exists from streaming.

### Hypothesis 3: Visual Split (Not Data Split)
`splitMessageParts` separates message parts into `chainItems` and `finalText`.
Parts like `[text(done), tool, text(streaming)]` → chainItems=[text(done), tool], finalText=text(streaming).
This creates TWO visual sections within ONE message that could look like "two messages".

### Hypothesis 4: `createdAt` undefined → chat_finish update → position change
MOST LIKELY FOR WEB:
1. Assistant message created from `ui_message_part` → NO `createdAt`
2. Message sits at end of list (correct)
3. `chat_finish` arrives with full message including `createdAt`
4. Web: `mergeMessagesIntoState` updates IN PLACE (no position change) — should be fine
5. BUT: if another message arrives BETWEEN creation and chat_finish, ordering could get confused

## Next Steps
1. Add console.log debugging to trace actual events and message state
2. Check if the issue is visual (splitMessageParts) or data (actual 2 messages)
3. Test with a simple scenario (no tool calls) to see if the split still occurs
4. Consider adding `createdAt` to `broadcastUiMessagePart` event to fix ordering issues
