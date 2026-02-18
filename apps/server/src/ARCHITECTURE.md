# Server Architecture (Current)

## Overview

Server đóng vai trò ACP client và backend cho web/native:

- Nhận request từ HTTP/tRPC.
- Quản lý lifecycle agent process.
- Bridge ACP (NDJSON over stdio).
- Chuẩn hóa stream thành `UIMessage` để broadcast realtime.
- Persist state/messages vào SQLite (`eragear.sqlite`).
- Runtime mục tiêu: **Bun-only** (sử dụng Bun runtime APIs như `bun:sqlite`, `hono/bun`).
- Production support target: Linux/Windows/macOS với Bun stable.

## Layers

```
Bootstrap (composition + startup)
    ↓
Transport (HTTP / tRPC / WS)
    ↓
Application (use-cases, orchestration)
    ↓
Domain (entities + invariants)
    ↓
Platform (IO/policy adapters)
```

Quy tắc phụ thuộc:

- `transport` gọi `application`, không gọi repo trực tiếp.
- `application` phụ thuộc vào ports (không import trực tiếp `platform`).
- `platform` implement ports.
- `domain` không import `transport` hoặc `platform`.
- Port thuộc module nào thì adapter implement chính nằm ở `modules/<feature>/infra`.

## Directory Map

```
src/
├── bootstrap/              # createApp/startServer + DI container
├── transport/              # HTTP routes + tRPC routers/types/context
├── platform/               # ACP/process/auth/storage/git/filesystem/logging/caching
├── modules/                # Feature vertical slices (session, ai, project, ...)
├── shared/                 # Shared types/ports/utils/errors
└── presentation/           # Dashboard server/client render
```

Module structure chuẩn:

```
modules/<feature>/
├── index.ts                # public API (services/ports/types)
├── di.ts                   # composition-only exports (infra implementations)
├── domain/
├── application/
│   ├── contracts/          # input contracts (zod schemas)
│   └── ports/
└── infra/                  # module-scoped adapters
```

Invariant quan trọng:
- `modules/<feature>/index.ts` chỉ export public application API (services/ports/types), không export `infra/*`.
- `modules/<feature>/di.ts` là entrypoint dành cho composition/wiring của concrete adapters.
- `transport` không `new Service(...)` trực tiếp; luôn dùng service factories
  đã được inject từ composition (`ctx.sessionServices`, `ctx.aiServices`, ...).

## Runtime Components

### Bootstrap

- `src/index.ts`: process entry.
- `src/bootstrap/server.ts`: dựng HTTP server + WebSocket upgrade + tRPC WS handler.
- `src/bootstrap/composition.ts`: composition root, wiring dependencies và
  service factories bằng constructor/function DI trực tiếp.

### Transport

- HTTP routes: `src/transport/http/routes/*`.
- tRPC router: `src/transport/trpc/router.ts`.
- tRPC context: `src/transport/trpc/context.ts`.
- WS transport: `applyWSSHandler` trong `src/bootstrap/server.ts` (upgrade path
  cố định: `/trpc`).

### Session Runtime

- Active session store (RAM): `src/modules/session/infra/runtime-store.ts`.
- Session ACP adapter (module-owned): `src/modules/session/infra/session-acp.adapter.ts`.
- Per-session ACP handlers: `src/platform/acp/handlers.ts`.
- Stream buffer + UIMessage mapping: `src/platform/acp/update.ts`, `src/shared/utils/ui-message.util.ts`.

### Persistence

- Storage path source-of-truth: `src/platform/storage/storage-path.ts`.
- SQLite bootstrap + migration: `src/platform/storage/sqlite-store.ts`.
- SQLite init process lock (multi-instance guard): `src/platform/storage/sqlite-process-lock.ts`.
- SQLite write backpressure queue: `src/platform/storage/sqlite-write-queue.ts`.
- Drizzle DB/schema: `src/platform/storage/sqlite-db.ts`, `src/platform/storage/sqlite-schema.ts`.
- Session/project/agent/settings repos trong `src/modules/*/infra/*.repository.sqlite.ts`.
- Storage dir policy:
  - `ERAGEAR_STORAGE_DIR` override (bắt buộc writable và không phải risky/network mount).
  - Nếu `ERAGEAR_STORAGE_DIR` risky hoặc không writable: fail-fast (không fallback tự động sang `/tmp`).
  - Nếu không có override, chọn giữa platform config dir `Eragear` và legacy
    `.eragear/` theo dữ liệu đã tồn tại; chỉ nhận candidate local-safe.

## Main Flows

### Create Session

1. tRPC `createSession` (`src/transport/trpc/routers/session.ts`).
2. `CreateSessionService` orchestration (`src/modules/session/application/create-session.service.ts`).
3. Spawn agent qua `AgentRuntimeAdapter` (`src/platform/process/index.ts`).
4. Tạo ACP connection (`src/platform/acp/connection.ts`).
5. Gắn ACP handlers (`src/platform/acp/handlers.ts`).
6. Lưu runtime vào `SessionRuntimeStore`, persist metadata vào repo SQLite.

### Send Prompt

1. tRPC `sendMessage` (`src/transport/trpc/routers/ai.ts`).
2. `SendMessageService` (`src/modules/ai/application/send-message.service.ts`).
3. Gửi prompt qua ACP connection.
4. ACP updates đi qua `src/platform/acp/update.ts`, update buffer + broadcast `ui_message`.
5. `turn_end`/`prompt_end` flush và persist.

### Permission

1. Agent gọi `requestPermission` trong ACP.
2. `src/platform/acp/permission.ts` tạo pending request.
3. Client phản hồi qua tRPC `respondToPermissionRequest`.
4. `RespondPermissionService` resolve request + gửi kết quả về agent.

## Auth Model

- HTTP `/api/*` yêu cầu auth context, ngoại trừ các route public đã được
  allowlist explicit (ví dụ health + một số auth endpoints).
- tRPC procedures dùng `protectedProcedure` yêu cầu `ctx.auth`.
- `ctx.auth` có thể đến từ:
  - Session/auth headers trong request.
  - `connectionParams.apiKey` cho WebSocket tRPC.

Lưu ý:

- `connectionParams` là payload app-level của tRPC, không thay cho header auth ở layer reverse-proxy.

## Configuration

Config đọc từ `src/config/environment.ts`:

- Network: `WS_HOST`, `WS_PORT`, `WS_HEARTBEAT_INTERVAL_MS`.
- Request limits: `WS_MAX_PAYLOAD_BYTES`, `HTTP_MAX_BODY_BYTES`.
- Security/auth: `AUTH_*`, `AUTH_REQUIRE_CLOUDFLARE_ACCESS`.
  - Khi bật `AUTH_REQUIRE_CLOUDFLARE_ACCESS=true`, phải cấu hình ít nhất một
    trong hai verifier:
    - Service token: `AUTH_CLOUDFLARE_ACCESS_CLIENT_ID`,
      `AUTH_CLOUDFLARE_ACCESS_CLIENT_SECRET`
    - JWT verifier: `AUTH_CLOUDFLARE_ACCESS_JWT_PUBLIC_KEY_PEM`,
      `AUTH_CLOUDFLARE_ACCESS_JWT_AUDIENCE`,
      `AUTH_CLOUDFLARE_ACCESS_JWT_ISSUER`
- Process/tool policy:
  `ALLOWED_AGENT_COMMAND_POLICIES`, `ALLOWED_TERMINAL_COMMAND_POLICIES`,
  `ALLOWED_ENV_KEYS`,
  `TERMINAL_OUTPUT_HARD_CAP_BYTES`.
- Pagination policy:
  `SESSION_LIST_PAGE_MAX_LIMIT`, `SESSION_MESSAGES_PAGE_MAX_LIMIT`.
- Timeout: `SESSION_IDLE_TIMEOUT_MS`, `AGENT_TIMEOUT_MS`, `TERMINAL_TIMEOUT_MS`.
- Storage queue/backpressure: `SQLITE_WRITE_QUEUE_MAX_PENDING`.

Policy invariants:

- `ALLOWED_AGENT_COMMAND_POLICIES`,
  `ALLOWED_TERMINAL_COMMAND_POLICIES`, `ALLOWED_ENV_KEYS` là required và
  fail-fast nếu thiếu/rỗng.
- `ALLOWED_*="*"` không hợp lệ, phải khai báo explicit.
- Runtime chỉ hỗ trợ Bun; fail-fast khi chạy bằng Node runtime.
- Chế độ fallback allowlist chỉ cho development khi bật explicit
  `ALLOW_INSECURE_DEV_DEFAULTS=true`.

## Operational Commands

Trong `apps/server/package.json`:

- `bun run dev`
- `bun run lint`
- `bun run lint:full`
- `bun run check-types`
- `bun run check`
- `bun run build`
- `bun run ui:build`

Biome (`biome.json`) là guard chính để enforce clean architecture boundaries
qua `noRestrictedImports` theo từng layer (`bun run lint`). `bun run lint:full`
dùng cho đợt cleanup full lint/format.

## Non-negotiable Boundaries

- Không bypass runtime store khi broadcast session events.
- Không ghi trực tiếp vào SQLite ngoài repository/storage layers.
- Không cho tool call truy cập path ngoài allowed project roots.
- Không đặt business rules ở transport/platform khi rule thuộc domain/application.
