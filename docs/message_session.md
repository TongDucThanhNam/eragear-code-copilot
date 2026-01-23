## Session & Message Management

### Message Persistence
Messages are persisted on the server side for session restoration:

- **User Messages**: Saved immediately when `sendMessage` is called (`apps/server/src/transport/trpc/procedures/ai.ts`)
- **Assistant Messages**: Saved after `session.conn.prompt()` returns by flushing the `SessionBuffering` buffer

**Why?** According to ACP spec, prompt turn ends when `session/prompt` request RETURNS with `stopReason` (e.g., `end_turn`, `max_tokens`, `cancelled`). Some agents don't send `turn_end`/`prompt_end` via `session/update` events.

### Session Buffering (`apps/server/src/infra/acp/update.ts`)
- `SessionBuffering` class accumulates `agent_message_chunk` and `agent_thought_chunk` content
- Buffer is flushed and saved when:
  1. `turn_end` or `prompt_end` event is received (legacy agents)
  2. `prompt()` call returns (modern agents - handled in `ai.ts`)

### Session Restoration Flow

**When switching sessions (via sidebar):**
1. Frontend clears current messages
2. Fetches `sessionState` and `chatHistory` from server
3. Restores messages from `chatHistory` (stored user + assistant messages)
4. If session is running → connects to subscription for live updates
5. If session is stopped → shows history only with "Resume" button

**When resuming a stopped session:**
1. Frontend sets `isResumingRef = true` to skip `chatHistory` restore
2. Clears messages to avoid duplicates
3. Calls `resumeSession` mutation
4. Server replays history via `session/update` events (agent replays from its own history)
5. Messages are rebuilt from replay events (not from stored `chatHistory`)

### Key Files
- `apps/server/src/infra/storage/session.adapter.ts` - Message storage (appendMessage, getSessionMessages)
- `apps/server/src/infra/acp/update.ts` - SessionBuffering, handleSessionUpdate
- `apps/server/src/transport/trpc/procedures/ai.ts` - sendMessage with buffer flush
- `apps/web/src/components/chat-ui/chat-interface.tsx` - Frontend session management