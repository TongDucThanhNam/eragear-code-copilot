# Server Documentation (`apps/server`)

Backend server that implements the ACP Client, provides the admin dashboard,
and exposes tRPC over WebSocket for the web client.

## Quick start

1) Start the server
```
cd apps/server
bun run dev
```

2) Open the dashboard
- `http://<host>:<port>/` (redirects to `/login`)
- Credentials: see `docs/server/auth-usage.md`

3) Connect a client
- WebSocket URL: `ws://<host>:<port>`
- Client sends `connectionParams: { apiKey: "<api_key>" }`

## Tech stack
- Runtime: Bun / Node.js
- HTTP framework: Hono
- Real-time API: tRPC over WebSocket
- Auth: Better Auth + SQLite
- ACP: `@agentclientprotocol/sdk`

## Source layout

```
src/
├── index.ts                    # Entrypoint
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
│       ├── context.ts          # tRPC context (DI + auth)
│       ├── router.ts           # Router composition
│       └── procedures/         # Procedures grouped by domain
├── modules/
│   ├── session/                # Session domain + services
│   ├── ai/                     # Prompt handling services
│   ├── project/                # Project CRUD services
│   ├── agent/                  # Agent CRUD services
│   └── tooling/                # Permissions + code context
├── infra/
│   ├── acp/                    # ACP handlers, buffering, tool-calls
│   ├── storage/                # JSON store adapters
│   ├── git/                    # Git context/diff adapter
│   └── process/                # Agent process runtime
├── shared/
│   ├── ports/                  # Cross-cutting ports (event bus)
│   ├── types/                  # Shared types
│   ├── errors/                 # Shared error types
│   └── utils/                  # Utilities + event bus
└── transport/http/ui/           # Dashboard UI markup
```

## Key endpoints

### Health
```
GET /api/health
```

### Auth (Better Auth)
```
GET  /login
POST /api/auth/sign-in/username
POST /api/auth/api-key/verify
```

### Admin (requires dashboard session)
```
GET    /api/admin/api-keys
POST   /api/admin/api-keys
DELETE /api/admin/api-keys
GET    /api/admin/device-sessions
POST   /api/admin/device-sessions/revoke
POST   /api/admin/device-sessions/activate
```

### tRPC: Auth
```
auth.getMe
```

## Authentication overview

### Dashboard login (username/password)
- `/login` is protected by Better Auth.
- Admin user is bootstrapped on first run.
- Credentials file:
  - Linux: `~/.config/Eragear/admin.credentials.json`
  - macOS: `~/Library/Application Support/Eragear/admin.credentials.json`
  - Windows: `%APPDATA%\\Eragear\\admin.credentials.json`

### Client access (API key)
- For WebSocket in browsers, pass the key via `connectionParams`:
  - `connectionParams: { apiKey: "<api_key>" }`
- For non-browser HTTP, pass via headers:
  - `x-api-key: <key>`
  - `Authorization: Bearer <key>`

For full details and troubleshooting, see `docs/server/auth-usage.md`.

## tRPC API (high level)

### Sessions
- `createSession`, `resumeSession`, `stopSession`, `deleteSession`
- `getSessionState`, `getSessions`, `getSessionMessages`
- `onSessionEvents` (subscription)

### AI
- `sendMessage`, `setModel`, `setMode`, `cancelPrompt`

### Code & project
- `getProjectContext`, `getGitDiff`, `getFileContent`
- `listProjects`, `createProject`, `updateProject`, `deleteProject`

### Tools
- `respondToPermissionRequest`

## Session lifecycle (summary)

1) **Create session**: `CreateSessionService` starts the agent process.
2) **Run prompt**: `sendMessage` builds context and queues the request.
3) **Stream updates**: ACP updates are parsed and broadcast to subscribers.
4) **Persist**: session history is stored in the JSON adapter.
5) **Resume/replay**: inactive sessions can be resumed when supported.

## Environment variables

```bash
# WebSocket + HTTP
WS_HOST=0.0.0.0
WS_PORT=3000
SESSION_IDLE_TIMEOUT_MS=600000

# Auth
AUTH_SECRET=your-32+char-secret
AUTH_BASE_URL=http://localhost:3000
AUTH_TRUSTED_ORIGINS=http://localhost:3000,https://your-domain
AUTH_ALLOW_SIGNUP=false
AUTH_BOOTSTRAP_API_KEY=true
AUTH_API_KEY_PREFIX=eg_

# Admin bootstrap (optional)
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=change-me
AUTH_ADMIN_EMAIL=admin@localhost.local
```

## Storage locations

Auth files are stored in the OS config directory:
- Windows: `%APPDATA%\\Eragear\\auth.sqlite`
- macOS: `~/Library/Application Support/Eragear/auth.sqlite`
- Linux: `$XDG_CONFIG_HOME/Eragear/auth.sqlite` or `~/.config/Eragear/auth.sqlite`

Other files in the same folder:
- `auth.secret`
- `admin.credentials.json`
- `api-key.json` (when auto-generated)

You can override the auth DB path:
```
AUTH_DB_PATH=/path/to/auth.sqlite
```

## Related docs
- `docs/server/auth-usage.md`
- `apps/server/docs/acp/acp-overview.md`
- `docs/trpc/trpc-websocket.md`
