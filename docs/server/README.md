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

## Authentication (Better-auth + Bun SQLite)

The server uses Better-auth with Bun's built-in SQLite for local-first auth.

### What it protects
- **HTTP dashboard** (`/`) and all **HTTP API** routes under `/api/*` (except `/api/auth/*`) require auth.
- **tRPC over WebSocket** requires auth. All tRPC procedures are `protectedProcedure`.

### Admin login (dashboard)
- Login UI: `GET /login`
- Sign-in endpoint: `POST /api/auth/sign-in/username`
- Username/password auth is enabled (Better-auth username plugin).

> Sign-up is **disabled by default**. First admin is bootstrapped automatically.

#### Where to find the initial admin password (Ubuntu/Linux)
If `AUTH_ADMIN_PASSWORD` is not set, the server generates credentials and stores them here:
```
~/.config/Eragear/admin.credentials.json
```

If `XDG_CONFIG_HOME` is set:
```
$XDG_CONFIG_HOME/Eragear/admin.credentials.json
```

Quick lookup:
```
find ~/.config -name admin.credentials.json -maxdepth 3
```

### API key auth (client connections)
- Default header: `x-api-key` (also accepts `Authorization: Bearer <key>`).
- For browser WS clients, pass `apiKey` in the WS query string:
  - `ws://localhost:3000?apiKey=<key>`

### Admin management (dashboard + HTTP API)
The dashboard now includes an **Auth** tab to manage API keys and device sessions.

Server-side admin endpoints (require dashboard login session):
```
GET    /api/admin/api-keys
POST   /api/admin/api-keys
DELETE /api/admin/api-keys
GET    /api/admin/device-sessions
POST   /api/admin/device-sessions/revoke
POST   /api/admin/device-sessions/activate
```

### Default storage location
Auth files are stored in the OS config directory:
- **Windows**: `%APPDATA%\\Eragear\\auth.sqlite`
- **macOS**: `~/Library/Application Support/Eragear/auth.sqlite`
- **Linux**: `$XDG_CONFIG_HOME/Eragear/auth.sqlite` or `~/.config/Eragear/auth.sqlite`

Alongside the DB you’ll also see:
- `auth.secret`
- `admin.credentials.json`
- `api-key.json` (when auto-generated)

### Overrides
You can override the auth DB path:
```
AUTH_DB_PATH=/path/to/auth.sqlite
```
When set, the auth files will be stored in the same directory.

### Bootstrap behavior
- If no users exist, the server creates a default admin user.
- If no API keys exist and `AUTH_BOOTSTRAP_API_KEY=true`, a default API key is created.

### Auth environment variables
```
# Required in production (recommended)
AUTH_SECRET=your-32+char-secret
AUTH_BASE_URL=http://localhost:3000
AUTH_TRUSTED_ORIGINS=http://localhost:3000,https://your-domain

# Admin bootstrap (optional)
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=change-me
AUTH_ADMIN_EMAIL=admin@localhost.local

# Behavior toggles
AUTH_ALLOW_SIGNUP=false
AUTH_BOOTSTRAP_API_KEY=true
AUTH_API_KEY_PREFIX=eg_
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
