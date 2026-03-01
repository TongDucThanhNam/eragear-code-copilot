# Message Splitting Investigation

## Bug: Assistant response split into two messages (affects both web & native)

## Summary of Full Server-Side Trace

### Key Finding: Server does NOT create duplicate messages

After tracing the ENTIRE server pipeline, I confirmed:

1. **`finalizeStreamingForCurrentAssistant` in `update.ts` does NOT clear `currentAssistantId`**
   - It only finalizes streaming parts (text/reasoning → "done") and flushes pending reasoning
   - This is the function called during chunk type transitions (message↔reasoning) and before tool calls

2. **`currentAssistantId` is only cleared in two places:**
   - `update-stream.ts:68` — during `user_message_chunk` handling (new user turn)
   - `prompt-task-runner.ts:638` — `aggregate.clearCurrentStreamingAssistantId()` at END of turn

3. **During a single turn, the server ALWAYS uses the SAME message ID**
   - Buffer's `messageId` is set on first `appendBlock` and never changes until `reset()`
   - `getOrCreateAssistantMessage` always reuses the existing message via `currentAssistantId`

4. **Tool calls and chunk type transitions do NOT create new messages**
   - They add parts (tool parts, reasoning parts, new text parts) to the SAME message
   - Multiple text parts within one message is EXPECTED after reasoning/tool transitions

### What causes multiple text parts within one message

When transitioning reasoning→message:
1. `finalizeStreamingForCurrentAssistant` marks text(streaming) → text(done)
2. New text chunk → `appendTextPart` → last part is reasoning(done) → creates NEW text part(streaming)
3. Result: [text(done), reasoning(done), text(streaming)] — ONE message, THREE parts

This is CORRECT behavior. But if the UI renders each text part separately, it may LOOK like "split messages".

## Client-Side Analysis

### Web Client (`apps/web/src/hooks/use-chat.ts`)
- Uses `messageStateRef` (mutable ref) for `getMessageById` — synchronously updated
- `onMessagePartUpdate` → `applyPartUpdate` (from `use-chat-message-state.ts`)
- When `ui_message_part` arrives for unknown message: creates message WITHOUT `createdAt`
- Delta events batched via `requestAnimationFrame`, flushed before `processSessionEvent`

### Native Client (`apps/native/hooks/use-chat.ts`)
- Uses `pendingMessagesRef` + zustand store for `getMessageById`
- 50ms batch timer for streaming updates
- Similar logic to web but with batching differences

### Shared Code (`packages/shared/src/chat/use-chat-core.ts`)
- `processSessionEvent` — dispatches events to callbacks
- `upsertMessage` — find by ID, replace in place or append
- `applyMessagePartUpdate` — insert/replace parts by index

## Files Traced

### Server
- `apps/server/src/platform/acp/update-stream.ts` — streaming chunk handling
- `apps/server/src/platform/acp/update.ts` — orchestrator, `finalizeStreamingForCurrentAssistant` 
- `apps/server/src/platform/acp/update-buffer.ts` — buffer management
- `apps/server/src/platform/acp/update-tool.ts` — tool call handling
- `apps/server/src/platform/acp/ui-message-part.ts` — broadcast helper
- `apps/server/src/shared/utils/ui-message/state.ts` — `getOrCreateAssistantMessage`
- `apps/server/src/shared/utils/ui-message/content.ts` — `appendTextPart`, `appendReasoningPart`
- `apps/server/src/shared/utils/chat-events.util.ts` — `maybeBroadcastChatFinish`
- `apps/server/src/modules/ai/application/send-message/prompt-task-runner.ts` — turn finalization

### Client
- `apps/web/src/hooks/use-chat.ts` — web event handling
- `apps/web/src/hooks/use-chat-message-state.ts` — MessageState with `applyPartUpdate`, `mergeMessagesIntoState`
- `apps/web/src/hooks/use-chat-history.ts` — history loading
- `apps/web/src/hooks/use-chat-normalize.ts` — message normalization
- `packages/shared/src/chat/use-chat-core.ts` — shared event processing
- `packages/shared/src/chat/message-order.ts` — message ordering
- `packages/shared/src/chat/event-schema.ts` — event schema validation

### Key Observations
- `setChatFinishMessage` is defined but NEVER called — `chatFinish.messageId` is always undefined
- `maybeBroadcastChatFinish` falls back to `lastAssistantId` for the message
- `chat_finish` includes the FULL message from server (with all parts and `createdAt`)

## Remaining Hypotheses

### Most Likely: RENDERING issue, not data issue
Multiple text parts within one message (after reasoning/tool transitions) may be rendered as visually separate blocks, looking like "split messages" to the user.

### Need to check:
1. Web message rendering component — does it render each text part as a separate block?
2. Native message rendering component — same question
3. Add server-side debug logging to capture exact broadcast events
4. Compare server state vs client state after streaming completes

## Next Steps
1. Check web/native message rendering for how multiple text parts are displayed
2. Add debug logging to server to log every broadcast event with message IDs
3. Reproduce the bug and compare server logs with client-rendered output
