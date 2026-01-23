# Server Documentation (`apps/server`)

Backend server implementing ACP Client that bridges the UI and AI agents.

## Tech Stack
- **Runtime**: Bun / Node.js
- **Framework**: Hono
- **Core Library**: `@agentclientprotocol/sdk`
- **Communication**: tRPC over WebSocket

---

## Source Layout (Current)

```
src/
├── index.ts                    # Entrypoint (bootstraps server)
├── bootstrap/
│   ├── server.ts               # HTTP + WS bootstrap
│   └── container.ts            # DI container wiring
├── config/
│   ├── constants.ts            # App constants (client info, defaults)
│   └── environment.ts          # ENV parsing and validation
├── transport/
│   ├── http/
│   │   └── routes.ts           # HTTP routes (dashboard/settings)
│   └── trpc/
│       ├── base.ts             # tRPC base configuration
│       ├── context.ts          # tRPC context (DI)
│       ├── router.ts           # tRPC router composition
│       └── procedures/         # tRPC procedures
├── modules/
│   ├── session/                # Session domain + services
│   ├── ai/                     # Prompt handling services
│   ├── project/                # Project CRUD services
│   ├── agent/                  # Agent CRUD services
│   └── tooling/                # Permissions + code context
├── infra/
│   ├── acp/                    # ACP handlers, buffering, tool-calls
│   ├── storage/                # JSON store adapters
│   ├── filesystem/             # Safe file IO
│   ├── git/                    # Git context/diff adapter
│   └── process/                # Agent process runtime
├── shared/
│   ├── types/                  # Shared types + ports
│   ├── errors/                 # Shared error types
│   └── utils/                  # Utilities + event bus
└── ui/
    └── config.tsx              # Dashboard UI
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
- **Storage adapter**: `src/infra/storage/session.adapter.ts`
- **Types**: `src/shared/types/session.types.ts` (`StoredMessage`, `StoredSession`)

### In-Memory State
- Runtime store: `src/modules/session/infra/runtime-store.ts`
- `ChatSession` type: `src/shared/types/session.types.ts`

### Session States
| State | Description |
|-------|-------------|
| Active (`isActive: true`) | ACP session alive and interactive |
| Inactive (`isActive: false`) | ACP session ended; resume depends on agent capability |

### Idle Timeout
- Config: `src/config/environment.ts`
- Default: `src/config/constants.ts`
- Timer: `src/transport/trpc/procedures/session.ts`

---

## WebSocket Server

- **Entry point**: `src/index.ts`
- **Bootstrap**: `src/bootstrap/server.ts`
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
- Agent spawn: `src/infra/process/index.ts`
- ACP connection: `src/infra/acp/connection.ts`
- Client metadata: `src/config/constants.ts`
- See: [docs/acp/acp-overview.md](../acp/acp-overview.md)

### 2) Session Setup
- New sessions: `CreateSessionService` in `src/modules/session/application/create-session.service.ts`
- Resume sessions: `ResumeSessionService`
- Persistence: `src/infra/storage/session.adapter.ts`
- See: [docs/trpc/trpc-websocket.md](../trpc/trpc-websocket.md)

### 3) Prompt Turn
- Entry: `src/transport/trpc/procedures/ai.ts`
- Prompt assembly: `src/services/ai-bridge.ts`
- Message storage: `src/infra/storage/session.adapter.ts`
- Broadcast: `src/modules/session/infra/runtime-store.ts`
- See: [docs/acp/acp-prompt-turn.md](../acp/acp-prompt-turn.md)

### 4) Streaming Updates
- Parsing/buffering: `src/infra/acp/update.ts`
- Broadcast: `src/modules/session/infra/runtime-store.ts`
- Subscription: `src/transport/trpc/procedures/session.ts`

### 5) Reconnection
- Event buffer: `src/modules/session/infra/runtime-store.ts`
- Replay: `src/transport/trpc/procedures/session.ts`

### 6) Tool Permissions
- Handler: `src/infra/acp/permission.ts`
- Response mapping: `src/transport/trpc/procedures/tool.ts`
- See: [docs/acp/acp-permission-response-fix.md](../acp/acp-permission-response-fix.md)

### 7) File System & Terminal
- Implementation: `src/infra/acp/tool-calls.ts`
- File URI handling: `src/shared/utils/path.util.ts`
- See: [docs/acp/acp-terminal.md](../acp/acp-terminal.md)

### 8) Cancellation
- Entry: `src/transport/trpc/procedures/ai.ts` (`cancelPrompt`)
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
- Use Hono's `logger()` middleware in `src/bootstrap/server.ts`
- ACP handler wiring via `src/infra/acp/*`
- Session state in `src/modules/session/infra/runtime-store.ts`, types in `src/shared/types/session.types.ts`
- Always handle `proc.on('exit')` and `proc.on('error')` in `CreateSessionService`

### ACP Rules
- All file paths must be absolute (file URIs allowed)
- Line numbers are 1-based
