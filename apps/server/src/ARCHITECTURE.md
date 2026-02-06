# Server Architecture (Current)

## Overview

Server đóng vai trò ACP client và backend cho web/native:

- Nhận request từ HTTP/tRPC.
- Quản lý lifecycle agent process.
- Bridge ACP (NDJSON over stdio).
- Chuẩn hóa stream thành `UIMessage` để broadcast realtime.
- Persist state/messages vào `.eragear/*.json`.

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
Infra (IO/policy adapters)
```

Quy tắc phụ thuộc:

- `transport` gọi `application`, không gọi repo trực tiếp.
- `application` phụ thuộc vào ports.
- `infra` implement ports.
- `domain` không import `transport` hoặc `infra`.

## Directory Map

```
src/
├── bootstrap/              # createApp/startServer + DI container
├── transport/              # HTTP routes + tRPC routers/types/context
├── infra/                  # ACP/process/auth/storage/git/filesystem/logging/caching
├── modules/                # Feature vertical slices (session, ai, project, ...)
├── shared/                 # Shared types/ports/utils/errors
└── presentation/           # Dashboard server/client render
```

Module structure chuẩn:

```
modules/<feature>/
├── domain/
├── application/
│   └── ports/
└── infra/
```

## Runtime Components

### Bootstrap

- `src/index.ts`: process entry.
- `src/bootstrap/server.ts`: dựng HTTP server + WebSocket upgrade + tRPC WS handler.
- `src/bootstrap/container.ts`: wiring singleton container (ports/adapters/repositories).

### Transport

- HTTP routes: `src/transport/http/routes/*`.
- tRPC router: `src/transport/trpc/router.ts`.
- tRPC context: `src/transport/trpc/context.ts`.
- WS transport: `applyWSSHandler` trong `src/bootstrap/server.ts`.

### Session Runtime

- Active session store (RAM): `src/modules/session/infra/runtime-store.ts`.
- Per-session ACP handlers: `src/infra/acp/handlers.ts`.
- Stream buffer + UIMessage mapping: `src/infra/acp/update.ts`, `src/shared/utils/ui-message.util.ts`.

### Persistence

- JSON store primitive: `src/infra/storage/json-store.ts`.
- Session/project/agent/settings repos trong `src/modules/*/infra/*.json.ts`.
- Storage dir: `.eragear/` dưới working directory.

## Main Flows

### Create Session

1. tRPC `createSession` (`src/transport/trpc/routers/session.ts`).
2. `CreateSessionService` orchestration (`src/modules/session/application/create-session.service.ts`).
3. Spawn agent qua `AgentRuntimeAdapter` (`src/infra/process/index.ts`).
4. Tạo ACP connection (`src/infra/acp/connection.ts`).
5. Gắn ACP handlers (`src/infra/acp/handlers.ts`).
6. Lưu runtime vào `SessionRuntimeStore`, persist metadata vào repo JSON.

### Send Prompt

1. tRPC `sendMessage` (`src/transport/trpc/routers/ai.ts`).
2. `SendMessageService` (`src/modules/ai/application/send-message.service.ts`).
3. Gửi prompt qua ACP connection.
4. ACP updates đi qua `src/infra/acp/update.ts`, update buffer + broadcast `ui_message`.
5. `turn_end`/`prompt_end` flush và persist.

### Permission

1. Agent gọi `requestPermission` trong ACP.
2. `src/infra/acp/permission.ts` tạo pending request.
3. Client phản hồi qua tRPC `respondToPermissionRequest`.
4. `RespondPermissionService` resolve request + gửi kết quả về agent.

## Auth Model

- HTTP `/api/*` (trừ `/api/auth` và `/api/health`) yêu cầu auth context.
- tRPC procedures dùng `protectedProcedure` yêu cầu `ctx.auth`.
- `ctx.auth` có thể đến từ:
  - Session/auth headers trong request.
  - `connectionParams.apiKey` cho WebSocket tRPC.

Lưu ý:

- `connectionParams` là payload app-level của tRPC, không thay cho header auth ở layer reverse-proxy.

## Configuration

Config đọc từ `src/config/environment.ts`:

- Network: `WS_HOST`, `WS_PORT`, `WS_HEARTBEAT_INTERVAL_MS`.
- Security/auth: `AUTH_*`.
- Process/tool policy: `ALLOWED_AGENT_COMMANDS`, `ALLOWED_TERMINAL_COMMANDS`, `ALLOWED_ENV_KEYS`.
- Timeout: `SESSION_IDLE_TIMEOUT_MS`, `AGENT_TIMEOUT_MS`, `TERMINAL_TIMEOUT_MS`.

## Operational Commands

Trong `apps/server/package.json`:

- `bun run dev`
- `bun run check-types`
- `bun run build`
- `bun run ui:build`

## Non-negotiable Boundaries

- Không bypass runtime store khi broadcast session events.
- Không ghi file JSON trực tiếp ngoài `json-store`.
- Không cho tool call truy cập path ngoài allowed project roots.
- Không đặt business rules ở transport/infra khi rule thuộc domain/application.
