# Message Split Bug — Complete Root Cause Analysis

## Bug Description
Both web and native clients show assistant responses split into TWO separate message bubbles.

## Critical Finding: Server broadcasts `ui_message_part` WITHOUT `createdAt`

### The Issue
In `apps/server/src/platform/acp/ui-message-part.ts`, `broadcastUiMessagePart` does NOT include
`createdAt` in the event. The server DOES set `createdAt = Date.now()` when creating assistant
messages in `apps/server/src/shared/utils/ui-message/state.ts:ensureMessage()`, but this value
is never transmitted to clients during streaming.

### What Clients Do
1. **Web client** (`apps/web/src/hooks/use-chat-message-state.ts:applyPartUpdate`):
   Creates message WITHOUT `createdAt` → `findUiMessageInsertIndex` puts it at end
   
2. **Native client** (`apps/native/hooks/use-chat.ts:applyMessagePartUpdate`):
   Creates message with tentative `createdAt = lastMessage.createdAt + 1`

3. **Both** receive `chat_finish` with the FULL message (with `createdAt`) at end of turn

### Why Messages Split
The `chat_finish` event includes `event.message` which has the server's `createdAt` timestamp.
When the client processes `chat_finish`:

**In `processSessionEvent` (shared `use-chat-core.ts`):**
```typescript
case "chat_finish":
  const finishMessage = event.message ?? ...;
  const finalizedFinishMessage = finalizeMessageAfterFinish(finishMessage);
  if (finalizedFinishMessage) {
    callbacks.onMessageUpsert(finalizedFinishMessage);
  }
```

**Web path:** `event.message` goes through `normalizeMessage()` → `parseUiMessageClientSafe()`.
If any part fails the strict `UI_MESSAGE_PART_SCHEMA` validation, it's silently dropped by
`sanitizeUiMessageParts`. The finalized message replaces the existing one in state.

**The key problem:** When `chat_finish` arrives with the full message, the client already has the
assistant message from `ui_message_part` events. The `mergeMessagesIntoState` (web) or `upsertMessage`
(native) finds the message by ID and updates it. This SHOULD work.

### Potential Race Condition: Tool-First Responses
If the agent sends a `tool_call` before any `agent_message_chunk`:

1. `handleToolCallCreate` → `upsertToolPart` → `getOrCreateAssistantMessage(state, undefined)` → creates "msg_A", sets `currentAssistantId = "msg_A"`
2. First `agent_message_chunk` → `appendAgentChunksToBuffer` → `buffer.appendContent()` → `buffer.appendBlock` → sets `buffer.messageId = "msg_B"` (NEW!)
3. `handleUiChunkUpdate` → `preferredMessageId = currentAssistantId = "msg_A"` → `buffer.ensureMessageId("msg_A")` → returns "msg_B" (already set!)
4. `getOrCreateAssistantMessage(state, "msg_B")` → creates SECOND message!
5. Now TWO assistant messages: "msg_A" (tool) and "msg_B" (text)

**This is a confirmed bug path**, but requires tool_call before any text.

### Most Common Scenario Analysis
For typical Claude Code flow (text → tool → text):
- First text sets both `buffer.messageId` and `currentAssistantId` to same value
- All subsequent chunks and tool calls use the same message ID
- This scenario works correctly

## Fix Plan

### Fix 1: Server — Include `createdAt` in `broadcastUiMessagePart`
**File:** `apps/server/src/platform/acp/ui-message-part.ts`

```typescript
await sessionRuntime.broadcast(chatId, {
  type: "ui_message_part",
  messageId: message.id,
  messageRole: message.role,
  partIndex,
  part,
  isNew,
  createdAt: message.createdAt, // ADD THIS
});
```

### Fix 2: Shared — Add `createdAt` to `ui_message_part` event type
**File:** `packages/shared/src/chat/types.ts`

Add `createdAt?: number` to the `ui_message_part` variant of `BroadcastEvent`.

### Fix 3: Shared — Add `createdAt` to event schema
**File:** `packages/shared/src/chat/event-schema.ts`

Add `createdAt: z.number().finite().optional()` to the `ui_message_part` schema.

### Fix 4: Shared — Pass `createdAt` through `processSessionEvent`
**File:** `packages/shared/src/chat/use-chat-core.ts`

In the `ui_message_part` handler, when creating a NEW message (no existing):
```typescript
const nextMessage: UIMessage = {
  id: event.messageId,
  role: event.messageRole,
  parts: [event.part],
  ...(typeof event.createdAt === 'number' ? { createdAt: event.createdAt } : {}),
};
```

Also pass `createdAt` in the `onMessagePartUpdate` callback payload.

### Fix 5: Web — Use `createdAt` from event in `applyPartUpdate`
**File:** `apps/web/src/hooks/use-chat-message-state.ts`

Add `createdAt?: number` to `MessagePartUpdateChunk` type.
In `applyPartUpdate`, when creating new message:
```typescript
const created: UIMessage = {
  id: update.messageId,
  role: update.messageRole,
  parts: [update.part],
  ...(typeof update.createdAt === 'number' ? { createdAt: update.createdAt } : {}),
};
```

### Fix 6: Native — Use `createdAt` from event
**File:** `apps/native/hooks/use-chat.ts`

In `applyMessagePartUpdate`, prefer server `createdAt` over tentative:
```typescript
const serverCreatedAt = typeof payload.createdAt === 'number' ? payload.createdAt : undefined;
const finalCreatedAt = serverCreatedAt ?? tentativeCreatedAt;
```

### Fix 7 (CRITICAL): Buffer messageId sync with currentAssistantId  
**File:** `apps/server/src/platform/acp/update-stream.ts`

In `appendAssistantChunk`, ensure buffer messageId matches currentAssistantId:
```typescript
// If currentAssistantId exists but buffer has a DIFFERENT messageId,
// override buffer's ID to match the existing assistant message
const messageId = buffer.ensureMessageId(preferredMessageId);
```

The issue is that `buffer.ensureMessageId` IGNORES the preferredId when
buffer already has a messageId (set by `appendBlock` in `appendAgentChunksToBuffer`).
We need to align the buffer's messageId with `currentAssistantId` when they differ.

**In `update-buffer.ts`, fix `ensureMessageId`:**
```typescript
ensureMessageId(preferredId?: string) {
  if (preferredId && this.messageId && this.messageId !== preferredId) {
    // currentAssistantId already exists from a prior tool call or
    // reconnect. Override the auto-generated buffer ID to keep
    // all parts on the same assistant message.
    this.messageId = preferredId;
  }
  if (!this.messageId) {
    this.messageId = preferredId ?? createId("msg");
  }
  return this.messageId;
}
```

## Files To Modify (Summary)

| # | File | Change |
|---|------|--------|
| 1 | `apps/server/src/platform/acp/ui-message-part.ts` | Add `createdAt` to broadcast |
| 2 | `packages/shared/src/chat/types.ts` | Add `createdAt?` to `ui_message_part` event |
| 3 | `packages/shared/src/chat/event-schema.ts` | Add `createdAt` to zod schema |
| 4 | `packages/shared/src/chat/use-chat-core.ts` | Pass `createdAt` through handlers |
| 5 | `apps/web/src/hooks/use-chat-message-state.ts` | Use `createdAt` from event |
| 6 | `apps/native/hooks/use-chat.ts` | Use server `createdAt` over tentative |
| 7 | `apps/server/src/platform/acp/update-buffer.ts` | Fix `ensureMessageId` to respect preferredId |
