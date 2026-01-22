# Server Documentation (`apps/server`)

Backend server implementing ACP Client that bridges the UI and AI agents.

## Tech Stack
- **Runtime**: Bun / Node.js
- **Framework**: Hono
- **Core Library**: `@agentclientprotocol/sdk`
- **Communication**: tRPC over WebSocket

---

## Source Layout

```
src/
├── index.ts                    # Server entry and WebSocket bootstrapping
├── config/
│   ├── constants.ts            # App constants (client info, defaults)
│   └── environment.ts          # ENV parsing and validation
├── acp/
│   ├── client.ts               # ACP ClientSideConnection wrapper
│   ├── types.ts                # ACP-specific types
│   └── protocol/
│       ├── handler.ts          # ACP client handler wiring
│       ├── update.ts           # Session update parsing and buffering
│       ├── permission.ts       # Permission request handling
│       └── tool-calls.ts       # File system and terminal tool calls
├── session/
│   ├── manager.ts              # ACP session creation and lifecycle
│   ├── storage.ts              # Persistent storage for sessions/messages
│   ├── types.ts                # Session domain types
│   └── events.ts               # In-memory session map and event broadcast
├── trpc/
│   ├── base.ts                 # tRPC base configuration
│   ├── context.ts              # tRPC context
│   ├── router.ts               # tRPC router composition
│   └── procedures/
│       ├── session.ts          # Session endpoints
│       ├── code.ts             # Code context endpoints
│       ├── ai.ts               # AI prompt endpoints
│       └── tool.ts             # Tool and permission endpoints
├── services/
│   ├── code-processor.ts       # Project context and git diff scanning
│   └── ai-bridge.ts            # Prompt content construction
├── websocket/
│   ├── adapter.ts              # tRPC WS adapter creation
│   └── handler.ts              # WS upgrade and connection handling
└── utils/
    ├── id.ts                   # ID generation utilities
    └── path.ts                 # File URI handling
```

---

## tRPC API Reference

### Session Procedures (`procedures/session.ts`)
| Procedure | Description |
|-----------|-------------|
| `createSession` | Create a new ACP session |
| `resumeSession` | Resume an inactive session |
| `stopSession` | Stop an active session |
| `deleteSession` | Delete session and its data |
| `getSessionState` | Get current session state |
| `getSessions` | List all sessions |
| `getSessionMessages` | Get session chat history |
| `onSessionEvents` | Subscribe to session events |

### Code Procedures (`procedures/code.ts`)
| Procedure | Description |
|-----------|-------------|
| `getProjectContext` | Get project file structure |
| `getGitDiff` | Get git diff for changes |
| `getFileContent` | Read file content |

### AI Procedures (`procedures/ai.ts`)
| Procedure | Description |
|-----------|-------------|
| `sendMessage` | Send prompt to agent |
| `setModel` | Change AI model |
| `setMode` | Change session mode |
| `cancelPrompt` | Cancel ongoing prompt |

### Tool Procedures (`procedures/tool.ts`)
| Procedure | Description |
|-----------|-------------|
| `respondToPermissionRequest` | Respond to tool permission request |

---

## Session Lifecycle

### Session Storage
- **Storage file**: `apps/server/.eragear/sessions.json`
- **Storage module**: `src/session/storage.ts`
- **Types**: `src/session/types.ts` (`StoredMessage`, `StoredSession`)

### In-Memory State
- Session map and event buffer: `src/session/events.ts`
- `ChatSession` type: `src/session/types.ts`

### Session States
| State | Description |
|-------|-------------|
| Active (`isActive: true`) | ACP session alive and interactive |
| Inactive (`isActive: false`) | ACP session ended; resume depends on agent capability |

### Idle Timeout
- Config: `src/config/environment.ts`
- Default: `src/config/constants.ts`
- Timer: `src/trpc/procedures/session.ts`

---

## WebSocket Server

- **Entry point**: `src/index.ts`
- **tRPC adapter**: `src/websocket/adapter.ts`
- **WS handlers**: `src/websocket/handler.ts`
- **Config**: `src/config/environment.ts`

### Environment Variables
```bash
WS_HOST=0.0.0.0
WS_PORT=3000
SESSION_IDLE_TIMEOUT_MS=600000
```

---

## ACP Flow

### 1) Initialization
- Agent spawn: `src/session/manager.ts`
- ACP connection: `src/acp/client.ts`
- Client metadata: `src/config/constants.ts`
- See: [docs/acp/acp-overview.md](../acp/acp-overview.md)

### 2) Session Setup
- New sessions: `conn.newSession` in `src/session/manager.ts`
- Resume sessions: `conn.loadSession` when supported
- Persistence: `src/session/storage.ts`
- See: [docs/trpc/trpc-websocket.md](../trpc/trpc-websocket.md)

### 3) Prompt Turn
- Entry: `src/trpc/procedures/ai.ts`
- Prompt assembly: `src/services/ai-bridge.ts`
- Message storage: `src/session/storage.ts`
- Broadcast: `src/session/events.ts`
- See: [docs/acp/acp-prompt-turn.md](../acp/acp-prompt-turn.md)

### 4) Streaming Updates
- Parsing/buffering: `src/acp/protocol/update.ts`
- Broadcast: `src/session/events.ts`
- Subscription: `src/trpc/procedures/session.ts`

### 5) Reconnection
- Event buffer: `src/session/events.ts`
- Replay: `src/trpc/procedures/session.ts`

### 6) Tool Permissions
- Handler: `src/acp/protocol/permission.ts`
- Response mapping: `src/trpc/procedures/tool.ts`
- See: [docs/acp/acp-permission-response-fix.md](../acp/acp-permission-response-fix.md)

### 7) File System & Terminal
- Implementation: `src/acp/protocol/tool-calls.ts`
- File URI handling: `src/utils/path.ts`
- See: [docs/acp/acp-terminal.md](../acp/acp-terminal.md)

### 8) Cancellation
- Entry: `src/trpc/procedures/ai.ts` (`cancelPrompt`)
- See: [docs/acp/acp-prompt-turn.md](../acp/acp-prompt-turn.md)

---

## Development

### Run Server
```bash
cd apps/server
bun run dev
```

### Build
```bash
bun run build -F server
```

### Backend Implementation Guidelines
- Use Hono's `logger()` middleware in `src/index.ts`
- ACP handler wiring via `src/acp/client.ts` and `src/acp/protocol/*`
- Session state in `src/session/events.ts`, types in `src/session/types.ts`
- Always handle `proc.on('exit')` and `proc.on('error')` in `src/session/manager.ts`

### ACP Rules
- All file paths must be absolute (file URIs allowed)
- Line numbers are 1-based
