# Eragear Server — Hướng Dẫn Kiến Trúc & Luồng Hoạt Động

> Tài liệu giải thích cấu trúc server và cách dữ liệu di chuyển.

---

## 1. Tổng Quan

### 1.1 Vai Trò Server

Server là **ACP Client** - cầu nối giữa UI và các Coding Agent (Claude code, Codex, Gemini CLI) bên ngoài:
- Quản lý vòng đời của Agent (spawn/stop)
- Bridge giao tiếp giữa UI và Agent
- Cung cấp capabilities (filesystem, terminal, git)
- Lưu trữ messages và state

### 1.2 Luồng Dữ Liệu

```
UI → tRPC/WSS → Server → ACP Connection → Agent
         ↓                         ↓
    Response ← UI ← Server ← ACP Connection
```

---

## 2. Cấu Trúc Thư Mục

```
src/
├── bootstrap/                 # Entry point & DI container
│   ├── container.ts           # Wiring ports ↔ adapters
│   └── server.ts              # Hono app setup & middleware stack
│
├── transport/                 # API boundary (HTTP/tRPC/WS)
│   ├── http/                  # HTTP layer
│   │   ├── constants.ts       # HTTP constants & CORS defaults
│   │   ├── cors.ts            # Origin resolver (Cloudflare support)
│   │   ├── cors-factory.ts    # CORS preset factory (api/auth/health/static)
│   │   ├── error-handler.ts   # Centralized error handling
│   │   ├── request-id.ts      # Request ID tracking middleware
│   │   ├── routes/            # HTTP routes (modular structure)
│   │   │   ├── index.ts       # Routes entry - registers all modules
│   │   │   ├── helpers.ts     # Shared utilities (form parsing, etc.)
│   │   │   ├── settings.ts    # /api/ui-settings, /form/settings
│   │   │   ├── dashboard.ts   # /api/dashboard/*, /api/logs/*
│   │   │   ├── sessions.ts    # /api/sessions/*, /form/sessions/*
│   │   │   ├── projects.ts    # /api/projects/*, /form/projects/*
│   │   │   ├── agents.ts      # /api/agents/*, /form/agents/*
│   │   │   └── admin.ts       # /api/admin/* (API keys, device sessions)
│   │   ├── ui/                # Dashboard UI assets
│   │   └── utils/             # HTTP utilities
│   ├── trpc/                  # tRPC router & procedures
│   │   ├── router.ts          # Main router
│   │   ├── context.ts         # Request context
│   │   ├── types.ts           # WebSocket types
│   │   └── routers/           # Procedures by feature
│   │       ├── session.ts
│   │       ├── ai.ts
│   │       ├── tool.ts
│   │       ├── project.ts
│   │       ├── agents.ts
│   │       ├── auth.ts
│   │       └── code.ts
│   └── ws/                    # WebSocket handlers
│
├── infra/                     # Global adapters (IO/policy)
│   ├── acp/                   # ACP bridge (agent communication)
│   │   ├── connection.ts      # NDJSON connection
│   │   ├── handlers.ts        # ACP event handlers
│   │   ├── update.ts          # Message buffering
│   │   ├── permission.ts      # Permission requests
│   │   ├── tool-calls.ts      # Tool call execution
│   │   └── session-acp.adapter.ts
│   ├── caching/               # Response caching layer
│   │   ├── response-cache.ts  # In-memory cache with TTL
│   │   ├── middleware.ts      # Cache middleware factory
│   │   ├── types.ts           # Cache type definitions
│   │   └── index.ts           # Cache exports
│   ├── logging/               # Structured logging
│   │   ├── structured-logger.ts # Tag-based logger
│   │   └── log-store.ts       # Log persistence
│   ├── process/               # Spawn agent processes
│   ├── filesystem/            # File operations
│   ├── git/                   # Git operations
│   ├── storage/               # JSON persistence
│   └── auth/                  # Authentication
│
├── modules/                   # Feature modules (vertical slices)
│   ├── session/
│   │   ├── application/       # Use-case orchestration
│   │   │   ├── ports/         # Port interfaces
│   │   │   ├── create-session.service.ts
│   │   │   ├── send-message.service.ts
│   │   │   └── ...
│   │   ├── domain/            # Entities & invariants
│   │   └── infra/             # Module-specific persistence
│   ├── agent/
│   ├── ai/
│   ├── project/
│   ├── settings/
│   └── tooling/
│
└── shared/                    # Cross-cutting concerns
    ├── ports/                 # Shared port interfaces
    ├── types/                 # Type definitions
    ├── utils/                 # Utilities
    └── errors/                # Error definitions
```

---

## 3. Hono Middleware Stack

Server sử dụng Hono framework với middleware stack được tối ưu hóa:

```
Request
   │
   ▼
┌─────────────────────────────────────────────┐
│ 1. Request Logger (structured-logger.ts)    │ ← Logging first
├─────────────────────────────────────────────┤
│ 2. Request ID (request-id.ts)               │ ← Tracking
├─────────────────────────────────────────────┤
│ 3. Response Timing (X-Response-Time header) │ ← Performance
├─────────────────────────────────────────────┤
│ 4. Compression (gzip/brotli)                │ ← Size reduction
├─────────────────────────────────────────────┤
│ 5. CORS (cors-factory.ts)                   │ ← Per-route CORS
├─────────────────────────────────────────────┤
│ 6. Auth Protection                          │ ← Authentication
├─────────────────────────────────────────────┤
│ 7. Error Handler (error-handler.ts)         │ ← Centralized errors
├─────────────────────────────────────────────┤
│ 8. Cache Headers                            │ ← 1-year static cache
└─────────────────────────────────────────────┘
   │
   ▼
Response
```

### 3.1 CORS Factory Presets

| Preset | Use Case | Credentials |
|--------|----------|-------------|
| `api` | API routes | Yes |
| `auth` | Auth routes | Yes |
| `health` | Health checks | No |
| `static` | Static files | No |

```typescript
import { createCorsMiddlewares } from "./transport/http/cors-factory";

const cors = createCorsMiddlewares(trustedOrigins);
app.use("/api/*", cors.api);
app.use("/health", cors.health);
```

### 3.2 Response Caching

Server có built-in caching layer cho expensive computations:

```typescript
import { getResponseCache } from "./infra/caching";

const cache = getResponseCache();
const data = await cache.getOrCompute("key", () => fetchData(), { ttl: 60000 });
```

---

## 4. Các Lớp Kiến Trúc

| Lớp | Vị trí | Vai trò |
|-----|--------|---------|
| **Transport** | `src/transport/**` | API boundary: validate input, gọi application |
| **Application** | `src/modules/*/application/**` | Use-case orchestration |
| **Domain** | `src/modules/*/domain/**` | Entity + rules |
| **Ports** | `src/modules/*/application/ports/**` | Interface (DI) |
| **Global Infra** | `src/infra/**` | Adapters dùng chung |
| **Module Infra** | `src/modules/*/infra/**` | Persistence đặc thù |

**Quy tắc:**
- Domain **không import** `transport`/`infra`
- Infra **chỉ** policy/IO, **không** domain rules
- Application **phụ thuộc ports**, Infra **implement ports**

---

## 4. Luồng Hoạt Động

### 4.1 Tạo Session Mới

```
User → UI → tRPC createSession → CreateSessionService
                                        │
                                        ▼
                              AgentRuntimeAdapter (spawn)
                                        │
                                        ▼
                              ACP Connection + Handlers
                                        │
                                        ▼
                              SessionRuntimeStore (RAM)
                                        │
                                        ▼
                              SessionRepository (JSON)
```

**Chi tiết:**
1. UI gọi tRPC `createSession`
2. Transport validate (zod) → gọi `CreateSessionService`
3. Service orchestration: repo, runtime, agent runtime
4. `AgentRuntimeAdapter` spawn process + ACP connection
5. ACP handlers gắn permission/update/tool-calls
6. `SessionRuntimeStore` lưu trong RAM + broadcast events
7. `SessionRepository` persist vào JSON

### 4.2 Gửi Tin Nhắn

```
User → UI → tRPC sendMessage → SendMessageService
                                    │
                                    ▼
                          SessionRuntimeStore (lookup)
                                    │
                                    ▼
                          SessionAcpPort (send to agent)
                                    │
                                    ▼
                          Agent Process (ACP)
                                    │
                                    ▼
                          ACP Update Handler
                                    │
                                    ▼
                          UI Subscription (WSS)
```

### 4.3 Agent Yêu Cầu Quyền

```
Agent → ACP Permission Request
            │
            ▼
createPermissionHandler (lưu pending request)
            │
            ▼
SessionRuntimeStore → broadcast → UI (show dialog)
            │
            ▼
User approve/deny → tRPC respondToPermissionRequest
            │
            ▼
RespondPermissionService → resolve request
            │
            ▼
ACP Connection → gửi result về Agent
```

### 4.4 Tool Call

```
Agent → Tool call request (ACP)
            │
            ▼
createToolCallHandler (tool-calls.ts)
  - Check sandbox (allowed roots)
  - Check allowlist
  - Resolve paths
  - Execute operation
            │
            ▼
Result → ACP → Agent
```

---

## 5. Thành Phần Quan Trọng

### 5.1 Container (`bootstrap/container.ts`)

```typescript
export class Container {
  // Repositories
  sessionRepo: SessionRepositoryPort;
  projectRepo: ProjectRepositoryPort;
  agentRepo: AgentRepositoryPort;
  settingsRepo: SettingsRepositoryPort;

  // Adapters
  agentRuntimeAdapter: AgentRuntimePort;
  sessionAcpAdapter: SessionAcpPort;
  gitAdapter: GitAdapter;
}
```

### 5.2 ACP Connection (`infra/acp/connection.ts`)

- Tạo `ClientSideConnection` từ child process
- NDJSON stream cho bidirectional communication

### 5.3 Session Runtime Store (`modules/session/infra/runtime-store.ts`)

- Lưu session đang chạy trong RAM (Map<chatId, SessionRuntime>)
- Broadcast events qua WebSocket
- Quản lý lifecycle của active sessions

### 5.4 JSON Store (`infra/storage/json-store.ts`)

- Persistence layer cho tất cả data
- Lưu trong `.eragear/*.json`

---

## 6. Entry Points

| File | Vai trò |
|------|---------|
| `src/index.ts` | Process entry |
| `src/bootstrap/server.ts` | Hono app, routes, WS handler |
| `src/bootstrap/container.ts` | DI wiring |
| `src/transport/trpc/router.ts` | tRPC initialization |
| `src/transport/trpc/routers/*.ts` | API procedures |

---

## 7. Thuật Ngữ

| Thuật ngữ | Ý nghĩa |
|-----------|---------|
| **ChatId** | ID của session runtime (RAM) |
| **Session (stored)** | Session metadata + messages (JSON) |
| **Session runtime** | Session đang chạy trong RAM |
| **ACP connection** | Kết nối NDJSON với agent |
| **ACP handlers** | Callbacks cho update/permission/tool-calls |
| **Tool call** | Agent yêu cầu chạy tool |
| **Permission request** | Yêu cầu user chấp thuận tool call |
| **Buffer** | Gom message chunk trước persist |

---

## 8. Thêm Tính Năng

### Thêm API mới

1. Thêm procedure ở `src/transport/trpc/routers/*.ts` (zod validate)
2. Tạo service ở `src/modules/<feature>/application/`
3. Nếu cần IO: thêm port ở `src/modules/<feature>/application/ports/`
4. Implement adapter ở `src/infra/**`
5. Wire ở `src/bootstrap/container.ts`

### Thêm tool-call

1. Thêm handler ở `src/infra/acp/tool-calls.ts`
2. Gọi service qua container nếu cần state
3. Nếu cần permission: dùng `requestPermission`

---

## 9. Debug

| Vấn đề | File |
|--------|------|
| Agent command not allowed | `infra/process/index.ts` |
| Access denied (outside root) | `infra/acp/tool-calls.ts` |
| Session not found | `modules/ai/application/send-message.service.ts` |
| ACP messages | `infra/acp/handlers.ts`, `update.ts` |
| Runtime & broadcast | `modules/session/infra/runtime-store.ts` |

**Log tags:** `[Server]`, `[DEBUG]`, `[Storage]`

---

## 10. Deployment & Distribution

### 10.1 Build thành Executable

Server được build thành **standalone executable** bằng TSDown/Bun:

```bash
bun run build  # Output: dist/eragear-server (hoặc .exe trên Windows)
```

Executable này:
- Bundles tất cả code + UI vào một file
- Không cần cài đặt Node.js/Bun trên máy user
- User chỉ cần chạy file, server sẽ khởi động ngay lập tức

### 10.2 Cài Đặt & Chạy

```bash
# Download executable
./eragear-server

# Với config tùy chỉnh
./eragear-server --port 3000 --project-roots /path/to/projects

# Chạy như service (Linux)
sudo ./eragear-server install
sudo systemctl start eragear-server
```

### 10.3 Truy Cập Server

**Local Access:**
```
http://localhost:<port>
```

**Remote Access (Cloudflare Tunnel):**

Server hỗ trợ tích hợp Cloudflare Tunnel để truy cập từ xa:

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Machine                           │
│  ┌─────────────────────┐      ┌─────────────────────────────┐  │
│  │ eragear-server      │      │ cloudflared tunnel          │  │
│  │ - HTTP Server       │◄────►│ -Tunnel to cloudflare       │  │
│  │ - tRPC/WSS          │      │ -Public URL: xxx.trycloudflare.com│
│  └─────────────────────┘      └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Internet
                              ▼
                    ┌─────────────────────┐
                    │ User's Browser      │
                    │ (Remote Access)     │
                    └─────────────────────┘
```

**Kết nối từ xa:**
1. Server tạo Cloudflare tunnel khi được bật
2. URL public được hiển thị (ví dụ: `https://xxx.trycloudflare.com`)
3. User có thể truy cập từ bất kỳ đâu qua URL này

### 10.4 Cấu Hình Server

| Option | Mô tả | Mặc định |
|--------|-------|----------|
| `--port` | Port chạy HTTP server | 3113 |
| `--project-roots` | Thư mục project được phép | Current directory |
| `--cloudflare` | Bật Cloudflare tunnel | false |
| `--auth-required` | Yêu cầu đăng nhập | false |

**Environment variables:**
- `ERAGEAR_PORT`
- `ERAGEAR_PROJECT_ROOTS`
- `ERAGEAR_CLOUDFLARE`
- `ERAGEAR_AUTH_REQUIRED`

### 10.5 Data Storage

```
~/.eragear/
├── sessions.json      # Session history
├── projects.json      # Project configs
├── agents.json        # Agent configs
└── settings.json      # App settings
```

---

## 11. Anti-patterns (Đừng Làm)

- Gọi repo trực tiếp trong transport
- Đặt orchestration trong transport
- Đặt ports ở domain
- Đặt business rules trong infra
- Domain import `infra`/`transport`
- Bypass SessionRuntimePort khi broadcast
- Viết trực tiếp file JSON ngoài json-store.ts
- Hardcode path ngoài `projectRoot`
