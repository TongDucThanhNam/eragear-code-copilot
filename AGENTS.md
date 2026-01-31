# Eragear-Code-Copilot — Hướng Dẫn Kiến Trúc & Luồng Hoạt Động

> Tài liệu giải thích cấu trúc và cách dữ liệu di chuyển trong dự án.

---

## 1. Tổng Quan Kiến Trúc

### 1.1 Ba Tầng Chính

```
┌─────────────────────────────────────────────────────────────┐
│                        UI (Client)                          │
│   apps/web (Vite/Tauri)  │  apps/native (Expo)             │
│   - Render giao diện người dùng                            │
│   - Thu nhận input từ người dùng                           │
│   - Hiển thị stream phản hồi từ agent                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ tRPC / WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                     Server (ACP Client)                     │
│                      apps/server (Hono)                     │
│   - Quản lý vòng đời của Agent (spawn/stop)                │
│   - Bridge giao tiếp giữa UI và Agent                      │
│   - Cung cấp capabilities (filesystem, terminal)           │
│   - Lưu trữ messages và state                              │
└──────────────────────────┬──────────────────────────────────┘
                           │ stdio / NDJSON
┌──────────────────────────▼──────────────────────────────────┐
│                     Agents (ACP Agent)                      │
│   Claude Code  │  Codex  │  Gemini CLI  │  ...             │
│   - Nhận prompts từ người dùng                             │
│   - Thực thi tool calls                                    │
│   - Sinh ra responses                                      │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Luồng Dữ Liệu (Data Flow)

```
User Input → UI → tRPC/WSS → Server → ACP Connection → Agent
              ↓                              ↓
         Response ← UI ← tRPC/WSS ← Server ← ACP Connection
```

---

## 2. Cấu Trúc Thư Mục Server

```
apps/server/src/
├── bootstrap/           # Entry point & DI container
│   ├── container.ts     # Wiring ports ↔ adapters
│   └── server.ts        # Hono app, HTTP routes, WS handler
│
├── transport/           # API boundary (HTTP/tRPC/WS)
│   ├── http/            # HTTP server (static UI, config page)
│   │   └── ui/          # Dashboard UI assets
│   ├── trpc/            # tRPC router & procedures
│   │   ├── router.ts
│   │   ├── context.ts
│   │   └── routers/
│   │       ├── session.ts    # Session CRUD
│   │       ├── ai.ts         # Send message, set model/mode
│   │       ├── tool.ts       # Permission response
│   │       ├── project.ts    # Project management
│   │       ├── agents.ts     # Agent configs
│   │       ├── auth.ts       # Authentication
│   │       └── code.ts       # Code context
│   └── ws/              # WebSocket handlers
│
├── infra/               # Global adapters (IO/policy)
│   ├── acp/             # ACP bridge, handlers, permission
│   │   ├── connection.ts     # NDJSON connection
│   │   ├── handlers.ts       # ACP event handlers
│   │   ├── update.ts         # Message buffering
│   │   ├── permission.ts     # Permission requests
│   │   ├── tool-calls.ts     # Tool call execution
│   │   └── session-acp.adapter.ts
│   ├── process/         # Spawn agent processes
│   │   └── index.ts
│   ├── filesystem/      # File operations
│   ├── git/             # Git operations
│   │   └── index.ts
│   ├── storage/         # JSON persistence
│   │   └── json-store.ts
│   └── auth/            # Authentication
│
├── modules/             # Feature modules (vertical slices)
│   ├── session/
│   │   ├── application/ # Use-case orchestration
│   │   │   ├── ports/   # Port interfaces
│   │   │   │   ├── session-repository.port.ts
│   │   │   │   ├── session-runtime.port.ts
│   │   │   │   ├── agent-runtime.port.ts
│   │   │   │   └── session-acp.port.ts
│   │   │   ├── create-session.service.ts
│   │   │   ├── send-message.service.ts
│   │   │   ├── stop-session.service.ts
│   │   │   ├── list-sessions.service.ts
│   │   │   └── ...
│   │   ├── domain/      # Entities & invariants
│   │   │   └── session.entity.ts
│   │   └── infra/       # Module-specific persistence
│   │       ├── runtime-store.ts     # In-memory session store
│   │       └── session.repository.json.ts
│   │
│   ├── agent/           # Agent configurations
│   │   ├── application/
│   │   │   ├── ports/
│   │   │   └── agent.service.ts
│   │   ├── domain/
│   │   │   └── agent.entity.ts
│   │   └── infra/
│   │       └── agent.repository.json.ts
│   │
│   ├── ai/              # AI settings (model, mode)
│   │   ├── application/
│   │   │   ├── set-model.service.ts
│   │   │   ├── set-mode.service.ts
│   │   │   └── prompt.builder.ts
│   │   └── ...
│   │
│   ├── project/         # Project management
│   │   ├── application/
│   │   │   └── project.service.ts
│   │   ├── domain/
│   │   │   └── project.entity.ts
│   │   └── infra/
│   │       └── project.repository.json.ts
│   │
│   ├── settings/        # App settings
│   │   └── ...
│   │
│   └── tooling/         # Tool calls & permissions
│       ├── application/
│       │   ├── respond-permission.service.ts
│       │   └── code-context.service.ts
│       └── ...
│
└── shared/              # Cross-cutting concerns
    ├── ports/           # Shared port interfaces
    │   └── event-bus.port.ts
    ├── types/           # Type definitions
    │   ├── session.types.ts
    │   ├── agent.types.ts
    │   ├── project.types.ts
    │   └── settings.types.ts
    ├── utils/           # Utilities
    │   ├── event-bus.ts
    │   ├── path.util.ts
    │   └── id.util.ts
    └── errors/          # Error definitions
```

---

## 3. Các Lớp Kiến Trúc (Architecture Layers)

| Lớp | Vị trí | Vai trò | Ví dụ |
|-----|--------|---------|-------|
| **Transport** | `src/transport/**` | API boundary: validate/map input, gọi application | `transport/trpc/routers/session.ts` (zod validation) |
| **Application** | `src/modules/*/application/**` | Use-case orchestration: gọi domain + ports | `modules/session/application/create-session.service.ts` |
| **Domain** | `src/modules/*/domain/**` | Entity + rule/invariant | `modules/project/domain/project.entity.ts` |
| **Ports/Contracts** | `src/modules/*/application/ports/**` | Interface (application depends on ports) | `SessionRepositoryPort`, `AgentRuntimePort` |
| **Global Infra** | `src/infra/**` | Adapter dùng chung (ACP, process, filesystem) | `infra/acp/connection.ts`, `infra/git/index.ts` |
| **Module Infra** | `src/modules/*/infra/**` | Persistence/runtime đặc thù module | `modules/session/infra/session.repository.json.ts` |

**Quy tắc quan trọng:**
- **Domain** `không import` `transport`/`infra`
- **Infra** `chỉ` chứa policy/IO logic, `không` chứa domain rules
- **Application** `phụ thuộc vào ports`, **Infra** `implement ports`

---

## 4. Các Luồng Hoạt Động Chính

### 4.1 Flow 1: Tạo Session Mới

```
┌──────┐     ┌─────────┐     ┌──────────┐     ┌─────────────────┐     ┌───────┐
│ User │────►│   UI    │────►│ tRPC     │────►│ CreateSession   │────►│ Agent │
│      │     │         │     │          │     │ Service         │     │ Proc  │
└──────┘     └─────────┘     └──────────┘     └─────────────────┘     └───────┘
                                               │                              │
                                               ▼                              │
                                    ┌─────────────────┐                        │
                                    │ AgentRuntime    │◄───────────────────────┘
                                    │ Adapter         │  ACP Connection
                                    │ (spawn process) │
                                    └─────────────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │ ACP Handlers       │
                                    │ - Permission       │
                                    │ - Update           │
                                    │ - Tool Calls       │
                                    └──────────┬──────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │ SessionRuntimeStore │ (RAM)
                                    └──────────┬──────────┘
                                               │
                                    ┌──────────▼──────────┐
                                    │ SessionRepository   │ (JSON)
                                    │ (.eragear/*.json)   │
                                    └─────────────────────┘
```

**Chi tiết từng bước:**

1. **UI** gọi tRPC `createSession` (`src/transport/trpc/routers/session.ts`)
2. **Transport** validate input (zod) và gọi `CreateSessionService`
3. **CreateSessionService** (`src/modules/session/application/create-session.service.ts`):
   - Orchestration: repo, runtime, agent runtime, settings
   - Tạo session ID, khởi tạo messages
4. **AgentRuntimeAdapter** (`src/infra/process/index.ts`):
   - Spawn agent process (command từ agent config)
   - Tạo ACP connection (`src/infra/acp/connection.ts`)
5. **ACP Handlers** (`src/infra/acp/handlers.ts`):
   - `createSessionHandlers` gắn handlers cho permission/update/tool-calls
6. **Update Handler** (`src/infra/acp/update.ts`):
   - Buffer messages
   - Persist về JSON store
7. **SessionRuntimeStore** (`src/modules/session/infra/runtime-store.ts`):
   - Lưu session đang chạy trong RAM
   - Broadcast events đến UI qua WebSocket

### 4.2 Flow 2: Gửi Tin Nhắn Đến Agent

```
┌──────┐     ┌─────────┐     ┌──────────┐     ┌─────────────────┐
│ User │────►│   UI    │────►│ tRPC     │────►│ SendMessage     │
│      │     │         │     │          │     │ Service         │
└──────┘     └─────────┘     └──────────┘     └────────┬────────┘
                                                       │
                                    ┌──────────────────▼─────────────────┐
                                    │ SessionRuntimeStore                 │
                                    │ (lookup active session by chatId)  │
                                    └──────────────────┬─────────────────┘
                                                       │
                                    ┌──────────────────▼─────────────────┐
                                    │ SessionAcpPort                    │
                                    │ (send via ACP connection)         │
                                    └──────────────────┬─────────────────┘
                                                       │
                                    ┌──────────────────▼─────────────────┐
                                    │ Agent Process (stdio/ndjson)      │
                                    │ (Claude Code, Codex, etc.)        │
                                    └──────────────────┬─────────────────┘
                                                       │
                                    ┌──────────────────▼─────────────────┐
                                    │ ACP Update Handler                │
                                    │ (parse response, buffer messages) │
                                    └──────────────────┬─────────────────┘
                                                       │
                                    ┌──────────────────▼─────────────────┐
                                    │ UI Subscription (WSS)             │
                                    │ (real-time streaming response)    │
                                    └───────────────────────────────────┘
```

### 4.3 Flow 3: Agent Yêu Cầu Quyền (Tool Call Permission)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Agent Request Permission                                                     │
│ (Tool call cần user approval)                                               │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ ACP Permission Request
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ createPermissionHandler (infra/acp/permission.ts)                           │
│ - Tạo permission request với requestId                                      │
│ - Lưu vào pending requests map                                              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ Broadcast via SessionRuntimePort
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ UI (shows permission dialog)                                                │
│ - Hiển thị tool call details                                                │
│ - Chờ user approve/deny                                                     │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ User approval/denial
                                   ▼ tRPC `respondToPermissionRequest`
┌─────────────────────────────────────────────────────────────────────────────┐
│ RespondPermissionService (modules/tooling/application/)                     │
│ - Resolve pending request                                                   │
│ - Gửi result về cho agent                                                   │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ ACP Connection → Send response to Agent                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Flow 4: Tool Call (File System / Terminal)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Agent sends tool call request (via ACP)                                      │
│ Ví dụ: read_file, write_file, bash, glob...                                 │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ createToolCallHandler (infra/acp/tool-calls.ts)                             │
│ 1. Check sandbox (allowed roots)                                            │
│ 2. Check allowlist (command whitelist)                                      │
│ 3. Resolve paths (absolute paths)                                           │
│ 4. Execute operation                                                        │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Result → ACP Connection → Agent                                             │
│ - Success: return output                                                    │
│ - Error: return error message                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.5 Flow 5: Persistence (JSON Store)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Application Layer                                                            │
│ (CreateSessionService, SendMessageService, etc.)                            │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ Gọi RepositoryPort
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ SessionRepositoryPort (interface)                                           │
│ - create(), update(), delete(), getById(), list()                           │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ SessionJsonRepository (infra implementation)                                │
│ - Dùng JsonStore                                                            │
│ - Lưu vào .eragear/sessions.json                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Files được lưu:**
- `.eragear/sessions.json` - Session metadata + messages
- `.eragear/projects.json` - Project configurations
- `.eragear/agents.json` - Agent configurations
- `.eragear/settings.json` - App settings

---

## 5. Các Thành Phần Quan Trọng

### 5.1 Container (`src/bootstrap/container.ts`)

```typescript
// Singleton container - wiring tất cả ports và adapters
export class Container {
  // Repositories
  sessionRepo: SessionRepositoryPort;      // Session persistence
  projectRepo: ProjectRepositoryPort;      // Project configs
  agentRepo: AgentRepositoryPort;          // Agent configs
  settingsRepo: SettingsRepositoryPort;    // App settings

  // Adapters
  agentRuntimeAdapter: AgentRuntimePort;   // Spawn agents
  sessionAcpAdapter: SessionAcpPort;       // ACP handlers
  gitAdapter: GitAdapter;                  // Git operations
}
```

### 5.2 ACP Connection (`src/infra/acp/connection.ts`)

- Tạo `ClientSideConnection` từ child process
- Sử dụng NDJSON stream cho bidirectional communication
- Handler cho messages, errors, close events

### 5.3 Session Runtime Store (`src/modules/session/infra/runtime-store.ts`)

- Lưu trữ session đang chạy trong RAM (Map<chatId, SessionRuntime>)
- Broadcast events qua WebSocket subscription
- Quản lý lifecycle của active sessions

### 5.4 JSON Store (`src/infra/storage/json-store.ts`)

- Persistence layer cho tất cả data
- Lưu trong `.eragear/*.json`
- Thread-safe với file locking

### 5.5 Event Bus (`src/shared/utils/event-bus.ts`)

- Pub/sub cho cross-session events
- Dùng cho global notifications, settings changes

---

## 6. Entry Points Quan Trọng

| File | Vai trò |
|------|---------|
| `src/index.ts` | Process entry, gọi `startServer()` |
| `src/bootstrap/server.ts` | Tạo Hono app, đăng ký routes, serve UI |
| `src/bootstrap/container.ts` | DI wiring ports ↔ adapters |
| `src/transport/trpc/router.ts` | tRPC initialization, context |
| `src/transport/trpc/routers/*.ts` | API procedures |

---

## 7. Thuật Ngữ (Glossary)

| Thuật ngữ | Ý nghĩa |
|-----------|---------|
| **ChatId** | ID của session runtime (sống trong RAM) |
| **Session (stored)** | Session metadata + messages lưu ở `.eragear/sessions.json` |
| **Session runtime** | Đối tượng đang chạy trong RAM (`SessionRuntimeStore`) |
| **ACP connection** | Kết nối NDJSON với agent (`infra/acp/connection.ts`) |
| **ACP handlers** | Bộ callback nhận update/permission/tool calls (`infra/acp/handlers.ts`) |
| **Tool call** | Agent yêu cầu chạy tool (fs/terminal) |
| **Permission request** | Yêu cầu người dùng chấp thuận tool call |
| **Buffer** | Gom message chunk trước khi persist (`SessionBuffering`) |
| **Replay** | Lịch sử được agent replay khi resume (`isReplayingHistory`) |
| **Event bus** | Kênh pub/sub trong server (`shared/utils/event-bus.ts`) |

---

## 8. Hướng Dẫn Thao Tác

### 8.1 Thêm API mới

1. Thêm procedure ở `src/transport/trpc/routers/*.ts` (validate input bằng zod)
2. Tạo service ở `src/modules/<feature>/application/`
3. Nếu cần IO: thêm port ở `src/modules/<feature>/application/ports/`
4. Implement adapter ở `src/infra/**` hoặc `src/modules/*/infra/**`
5. Wire port/adapter ở `src/bootstrap/container.ts`

### 8.2 Thêm tool-call mới cho ACP

1. Thêm handler ở `src/infra/acp/tool-calls.ts`
2. Gọi service ở `src/modules/*/application/**` qua container
3. Nếu cần permission: dùng `requestPermission` → `respondToPermissionRequest`

---

## 9. Debug & Troubleshooting

| Vấn đề | File cần xem |
|--------|-------------|
| Agent command not allowed | `src/infra/process/index.ts` (ALLOWED_COMMANDS) |
| Access denied (outside project root) | `src/infra/acp/tool-calls.ts` |
| Session not found | `modules/ai/application/send-message.service.ts` |
| ACP messages | `src/infra/acp/handlers.ts`, `update.ts` |
| Runtime & broadcast | `src/modules/session/infra/runtime-store.ts` |
| Config/allowlist | `src/config/environment.ts` (ALLOWED_* , *_TIMEOUT_MS) |

### Log Tags
- `[Server]` - Server lifecycle
- `[DEBUG]` - Debug messages
- `[Storage]` - Persistence operations

---

## 10. Chạy Dự Án

```bash
# Run dev server
cd apps/server && bun run dev

# Type check
bun run check-types

# Build (includes UI)
bun run build
```

---

## 11. Anti-patterns (Đừng Làm)

- Gọi repo trực tiếp trong transport (`src/transport/**`)
- Đặt orchestration trong transport thay vì application
- Đặt ports ở domain (ports ở `src/modules/*/application/ports/**`)
- Đặt business rules trong infra (infra chỉ policy/IO)
- Tool-call handler tự tạo session state (phải qua runtime/service)
- Domain import `infra`/`transport`
- Bypass `SessionRuntimePort` khi broadcast event (dùng runtime store)
- Viết trực tiếp file JSON ngoài `json-store.ts`
- Hardcode path ngoài `projectRoot` trong tool calls

---

## 12. Tài Liệu Liên Quan

- [ACP Protocol Overview](../docs/acp/acp-overview.md)
- [ACP Session](../docs/acp/acp-session.md)
- [ACP Tool Calls](../docs/acp/acp-tool-call.md)
- [Server Docs](apps/server/docs/)
- [Web App Docs](apps/web/docs/)
- [Mobile App Docs](apps/native/docs/)
