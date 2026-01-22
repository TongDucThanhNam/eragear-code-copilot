# tRPC WebSocket API (ACP Client Bridge)

This document describes how clients should connect to the tRPC WebSocket server
and interact with the ACP client bridge. It is a snapshot of the current server
behavior in `apps/server/src/trpc/router.ts` and `apps/server/src/session/manager.ts`.

## Overview

- Transport: tRPC over WebSocket (no HTTP link).
- Server role: ACP client that spawns agents and exposes session controls.
- Client role: UI or app that connects to tRPC WS and streams session events.

## Connection

- WebSocket server: `ws://<host>:3000`
- There is no path segment; clients connect to the host and port only.

Examples:

```ts
import { createWSClient, wsLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";

const trpc = createTRPCReact<AppRouter>();

const client = trpc.createClient({
  links: [
    wsLink({
      client: createWSClient({ url: "ws://localhost:3000" }),
    }),
  ],
});
```

Native app helper:
- `EXPO_PUBLIC_WS_URL` controls the WS base URL.
- Android emulator uses `ws://10.0.2.2:3000` by default.

## IDs and Session States

- `chatId`: client-facing session ID stored by the server (persistent).
- `sessionId`: ACP session ID from the agent (stdio side).
- `isActive`: `true` if the ACP session is alive in memory.
- `status`: `running` or `stopped` (persisted in store).

## Recommended Client Flow

1) `createSession` (or `resumeSession`) to get a `chatId` and initial metadata.
2) Set local state to "connecting" and call `getSessionState`.
3) If `status` is `stopped`, switch to read-only. Otherwise hydrate:
   - `modes`, `models`, `commands`, `promptCapabilities`
4) Set local state to "connected".
5) Subscribe to `onSessionEvents` for streaming updates.
6) Use `sendMessage` to send prompts; render messages from subscription only.

Notes:
- The subscription replays buffered events but does NOT include a full snapshot
  of modes/models. Always call `getSessionState` on reconnect.
- The server keeps an idle session alive for `SESSION_IDLE_TIMEOUT_MS`
  (default 10 minutes). After that, `Chat not found` errors are expected.

## Procedures

### createSession (mutation)
Creates a new ACP session.

Input:
```json
{
  "projectRoot": ".",
  "command": "opencode",
  "args": ["acp"],
  "env": { "KEY": "value" },
  "cwd": "/abs/path"
}
```

Output:
```json
{
  "chatId": "chat-...",
  "sessionId": "sess_...",
  "modes": { "currentModeId": "...", "availableModes": [] },
  "models": { "currentModelId": "...", "availableModels": [] },
  "promptCapabilities": { "image": true, "embeddedContext": true },
  "loadSessionSupported": true
}
```

### resumeSession (mutation)
Resumes a stored session if the agent supports `loadSession`.

Input:
```json
{ "chatId": "chat-..." }
```

Output (already running):
```json
{
  "ok": true,
  "alreadyRunning": true,
  "modes": { "currentModeId": "...", "availableModes": [] },
  "models": { "currentModelId": "...", "availableModels": [] },
  "promptCapabilities": { "image": true },
  "loadSessionSupported": true
}
```

Output (new process):
```json
{
  "ok": true,
  "chatId": "chat-...",
  "modes": { "currentModeId": "...", "availableModes": [] },
  "models": { "currentModelId": "...", "availableModels": [] },
  "promptCapabilities": { "image": true },
  "loadSessionSupported": true
}
```

### getSessionState (query)
Fetches current state for reconnect hydration.

Input:
```json
{ "chatId": "chat-..." }
```

Output (running):
```json
{
  "status": "running",
  "modes": { "currentModeId": "...", "availableModes": [] },
  "models": { "currentModelId": "...", "availableModels": [] },
  "commands": [ { "name": "...", "description": "..." } ],
  "promptCapabilities": { "image": true },
  "loadSessionSupported": true
}
```

Output (stopped):
```json
{
  "status": "stopped",
  "modes": null,
  "models": null,
  "commands": null,
  "promptCapabilities": null,
  "loadSessionSupported": false
}
```

### getSessions (query)
Returns persisted sessions with `isActive` status and `agentInfo` (if provided by the agent).

Example item:
```json
{
  "id": "chat-...",
  "sessionId": "sess_...",
  "projectRoot": "/abs/path",
  "status": "running",
  "isActive": true,
  "agentInfo": { "name": "opencode", "title": "OpenCode", "version": "1.2.3" },
  "agentName": "OpenCode"
}
```

### getSessionMessages (query)
Returns persisted message history for read-only display.

### sendMessage (mutation)
Sends a prompt. Responses stream via `onSessionEvents`.

Input:
```json
{
  "chatId": "chat-...",
  "text": "Hello",
  "images": [ { "base64": "...", "mimeType": "image/png" } ],
  "resources": [
    { "uri": "file:///abs/path", "text": "...", "mimeType": "text/plain" }
  ]
}
```

Output:
```json
{ "stopReason": "end_turn" }
```

### setMode (mutation)
Sets the current mode.

Input:
```json
{ "chatId": "chat-...", "modeId": "..." }
```

### setModel (mutation)
Sets the current model (agent must support it).

Input:
```json
{ "chatId": "chat-...", "modelId": "..." }
```

### cancelPrompt (mutation)
Cancels an in-flight prompt and resolves pending permissions as cancelled.

### respondToPermissionRequest (mutation)
Responds to a permission request from the agent.

Input:
```json
{ "chatId": "chat-...", "requestId": "req-...", "decision": "allow" }
```

Notes:
- `decision` is mapped to the agent's option IDs. Common values: `allow`, `reject`.

### stopSession (mutation)
Kills the agent process and marks the chat as stopped.

### deleteSession (mutation)
Deletes the stored session and kills any running process.

### getProjectContext (query)
Returns `projectRules`, `activeTabs` (currently empty), and `files`.

### getGitDiff (query)
Returns a combined diff string for tracked and untracked files.

### getFileContent (query)
Reads a file relative to the session project root (path traversal is blocked).

## Subscription: onSessionEvents

Input:
```json
{ "chatId": "chat-..." }
```

Behavior:
- First event is always `{ "type": "connected" }`.
- Then the server replays buffered events (messages, updates, outputs).
- After that, all live events are streamed.

Event types:

```json
{ "type": "connected" }
```

```json
{ "type": "user_message", "id": "msg-...", "text": "...", "timestamp": 0 }
```

```json
{ "type": "current_mode_update", "modeId": "..." }
```

```json
{ "type": "session_update", "update": { "sessionUpdate": "agent_message_chunk", "content": { "text": "..." } } }
```

```json
{ "type": "request_permission", "requestId": "req-...", "toolCall": {}, "options": [] }
```

```json
{ "type": "terminal_output", "terminalId": "term-...", "data": "..." }
```

```json
{ "type": "error", "error": "..." }
```

Common `session_update` values (ACP):
- `user_message_chunk`
- `agent_message_chunk`
- `agent_thought_chunk`
- `tool_call`
- `tool_call_update`
- `plan`
- `available_commands_update`

Notes:
- `current_mode_update` is emitted as its own top-level event (not inside
  `session_update`).
- Do not render user messages locally on `sendMessage`; rely on `user_message`
  or `user_message_chunk` events to avoid duplicates.

## Reconnect and Idle Cleanup

- When the last subscriber disconnects, the server starts a cleanup timer.
- After `SESSION_IDLE_TIMEOUT_MS`, the agent process is killed and the chat
  is removed from memory.
- Any operation on a cleaned chat returns `Chat not found`.
- If `loadSessionSupported` is true, call `resumeSession` to restart it.

## File Reference

- Server implementation: `apps/server/src/trpc/router.ts`
- Session handling: `apps/server/src/session/manager.ts`
- In-memory state: `apps/server/src/session/events.ts`
