# Message Split Fix Plan

## Bug: Assistant responses split into TWO separate messages on both web and native.

## ROOT CAUSE IDENTIFIED

The `broadcastUiMessagePart` function in `apps/server/src/platform/acp/ui-message-part.ts`
does NOT include `createdAt` in the event. When clients receive the first `ui_message_part`
for an assistant message, they create a new message WITHOUT `createdAt` (web) or with
a tentative value (native).

The server-side message has `createdAt` (set in `ensureMessage` in
`apps/server/src/shared/utils/ui-message/state.ts`), but this timestamp is never
transmitted to clients during streaming.

## FIX 1: Include `createdAt` in `broadcastUiMessagePart` (SERVER FIX)

**File**: `apps/server/src/platform/acp/ui-message-part.ts`

Change `broadcastUiMessagePart` to include `createdAt`:
```typescript
export async function broadcastUiMessagePart(params: {
  chatId: string;
  sessionRuntime: SessionRuntimePort;
  message: UIMessage;
  partIndex: number;
  isNew: boolean;
}): Promise<void> {
  const { chatId, sessionRuntime, message, partIndex, isNew } = params;
  const part = message.parts[partIndex];
  if (!part) {
    return;
  }
  await sessionRuntime.broadcast(chatId, {
    type: "ui_message_part",
    messageId: message.id,
    messageRole: message.role,
    partIndex,
    part,
    isNew,
    // Include createdAt so clients can properly order messages
    ...(typeof message.createdAt === 'number' ? { createdAt: message.createdAt } : {}),
  });
}
```

## FIX 2: Shared event schema needs `createdAt` field on `ui_message_part`

**File**: `packages/shared/src/chat/event-schema.ts`

Add `createdAt` to the `ui_message_part` event schema (broadcast event schema).

## FIX 3: Web client uses `createdAt` from event

**File**: `apps/web/src/hooks/use-chat-message-state.ts`

In `applyPartUpdate`, when creating a new message, use `createdAt` if available:
```typescript
// The update type needs createdAt from server
const created: UIMessage = {
  id: update.messageId,
  role: update.messageRole,
  parts: [update.part],
  ...(typeof update.createdAt === 'number' ? { createdAt: update.createdAt } : {}),
};
```

## FIX 4: Shared `processSessionEvent` passes `createdAt` to callbacks

**File**: `packages/shared/src/chat/use-chat-core.ts`

In the `ui_message_part` handler, when creating a new message from event:
```typescript
const nextMessage: UIMessage = {
  id: event.messageId,
  role: event.messageRole,
  parts: [event.part],
  ...(typeof event.createdAt === 'number' ? { createdAt: event.createdAt } : {}),
};
```

Also update `onMessagePartUpdate` payload to include `createdAt`:
```typescript
callbacks.onMessagePartUpdate({
  messageId: event.messageId,
  messageRole: event.messageRole,
  partIndex: event.partIndex,
  part: event.part,
  isNew: event.isNew,
  createdAt: event.createdAt, // NEW FIELD
});
```

## FIX 5: Native client uses `createdAt` from event

**File**: `apps/native/hooks/use-chat.ts`

In `applyMessagePartUpdate`, when creating a new message, use `createdAt` from payload
instead of tentative value:
```typescript
const serverCreatedAt = typeof payload.createdAt === 'number' ? payload.createdAt : undefined;
const finalCreatedAt = serverCreatedAt ?? tentativeCreatedAt;
```

## KEY FILES TO MODIFY

1. `apps/server/src/platform/acp/ui-message-part.ts` — Add createdAt to broadcast
2. `packages/shared/src/chat/event-schema.ts` — Add createdAt to ui_message_part schema
3. `packages/shared/src/chat/use-chat-core.ts` — Pass createdAt to callbacks
4. `packages/shared/src/chat/types.ts` — Update BroadcastEvent type for ui_message_part
5. `apps/web/src/hooks/use-chat-message-state.ts` — Use createdAt from event
6. `apps/native/hooks/use-chat.ts` — Use createdAt from event

## IMPORTANT CONTEXT

### Server Message Creation
- `ensureMessage` in `state.ts` creates messages with `createdAt = Date.now()`
- All server-side assistant messages have `createdAt`
- `getOrCreateAssistantMessage` calls `ensureMessage` which sets `createdAt`

### Buffer Lifecycle
- `buffer.messageId` set on first chunk, never changes during turn
- `buffer.reset()` only on `user_message_chunk`
- `buffer.flush()` only at turn end in `prompt-task-runner.ts`
- `currentAssistantId` stable throughout turn

### Broadcast Types
- User messages → `ui_message` (full message with createdAt)
- Assistant text → `ui_message_part` (first chunk, isNew=true) then `ui_message_delta`
- Tool calls → `ui_message_part` 
- Turn end → `chat_finish` (full message with createdAt)

### Why Both Clients Affected
Both clients create messages from `ui_message_part` events. Neither has `createdAt` available.
Web creates WITHOUT createdAt (undefined). Native creates with tentative value.
Both have suboptimal ordering without the real server timestamp.
