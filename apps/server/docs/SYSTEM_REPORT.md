# Eragear Server System Report (Current)

## 1. Executive Summary

`apps/server` là ACP client + backend orchestration:

- Nhận API từ web/native qua HTTP + tRPC/WebSocket.
- Spawn và quản lý agent process (stdio).
- Bridge Agent Client Protocol (ACP).
- Chuẩn hóa stream thành `UIMessage` để client render thống nhất.
- Persist session/project/agent/settings vào SQLite (`eragear.sqlite`) qua Drizzle.

Mục tiêu kiến trúc là ổn định production cho local-first workflows, nơi server
chạy trên máy người dùng và có quyền filesystem/terminal.

## 2. Architecture

Server theo Clean Architecture + Ports/Adapters:

- `transport`: HTTP/tRPC boundary, validate input và gọi services.
- `application`: orchestration use-cases.
- `domain`: entities/invariants.
- `infra`: IO/policy adapters (ACP, process, storage, auth, git, filesystem).

Vertical modules chính:

- `session`
- `ai`
- `project`
- `agent`
- `tooling`
- `settings`
- `dashboard`

Composition root:

- `src/bootstrap/container.ts`
- `src/bootstrap/server.ts`

## 3. Runtime Surfaces

### 3.1 HTTP

HTTP app được tạo trong `src/bootstrap/server.ts` với middleware stack:

1. request-id (kèm async observability context)
2. request logger
3. response-time header
4. compression (nếu runtime hỗ trợ)
5. CORS presets
6. auth protection cho `/api/*` (trừ `/api/auth`, `/api/health`)
7. error handler

Route groups được đăng ký tại `src/transport/http/routes/index.ts`:

- `/api/ui-settings`
- `/api/dashboard/*`, `/api/logs/*`
- `/api/sessions/*`
- `/api/projects/*`
- `/api/agents/*`
- `/api/admin/*`
- `/api/auth/*` (Better Auth handler)
- `/api/health`

Dashboard UI routes được mount qua `registerDashboardUiRoutes`.

Dashboard UI canonical path:

- `/_/dashboard` (protected UI entry)
- `/dashboard` và `/` chỉ là legacy redirect về `/_/dashboard`

### 3.2 tRPC over WebSocket

tRPC router: `src/transport/trpc/router.ts`

Routers:

- `session`
- `ai`
- `tool`
- `project`
- `code`
- `agents`
- `auth`

Auth cho tRPC:

- `protectedProcedure` yêu cầu `ctx.auth`.
- `ctx.auth` được resolve từ:
  - request headers/session (cookie hoặc API key header/query),
  - hoặc `connectionParams.apiKey` với WebSocket client.

### 3.3 Observability & Background Runtime

- Logs:
  - request logs + console logs được lưu qua `LogStore`.
  - `LogEntry` có correlation fields (`requestId`, `traceId`, `taskName`, ...).
- Observability snapshot:
  - `GET /api/dashboard/observability`
  - tổng hợp log/http/session/cache/background state runtime.
- Background runner:
  - chạy embedded trong API process.
  - đăng ký task định kỳ cho session idle cleanup và cache prune.
  - start/stop cùng vòng đời server.

## 4. Session and ACP Flows

### 4.1 Create Session

1. Client gọi `createSession`.
2. `CreateSessionService` resolve project + settings + agent command.
3. `AgentRuntimeAdapter` spawn process.
4. Server tạo ACP connection (`createAcpConnectionAdapter`).
5. Gắn ACP handlers (update, permission, tool calls).
6. Runtime session lưu ở `SessionRuntimeStore`.
7. Metadata persist vào bảng `sessions` trong SQLite.

### 4.2 Send Prompt and Streaming

1. Client gọi `ai.sendMessage`.
2. `SendMessageService` gửi prompt qua ACP.
3. Updates đi vào `infra/acp/update.ts`.
4. `SessionBuffering` gom stream chunks.
5. Server build `UIMessage` và broadcast realtime (`ui_message`).
6. `turn_end`/`prompt_end` flush + persist.

### 4.3 Tool Permission

1. Agent yêu cầu permission.
2. `infra/acp/permission.ts` tạo pending request trong runtime session.
3. Client gọi `tool.respondToPermissionRequest`.
4. `RespondPermissionService` map decision -> optionId và resolve promise.
5. Kết quả gửi ngược về agent.

## 5. Persistence

SQLite storage bootstrap + migration: `src/infra/storage/sqlite-store.ts`
Storage path source-of-truth: `src/infra/storage/storage-path.ts`
Drizzle schema/db: `src/infra/storage/sqlite-schema.ts`, `src/infra/storage/sqlite-db.ts`

Application data mặc định lưu theo storage policy:

- `ERAGEAR_STORAGE_DIR` (nếu set, path phải writable).
- Nếu không set: chọn giữa platform config dir `Eragear` và legacy `.eragear/`
  dựa trên nơi đã có dữ liệu; nếu cả hai chưa có dữ liệu, chọn candidate
  writable đầu tiên.

File chính:

- `eragear.sqlite`

Auth data (SQLite + bootstrap credentials/API key) lưu theo platform config dir
hoặc `AUTH_DB_PATH`:

- Linux: `${XDG_CONFIG_HOME:-~/.config}/Eragear/`
- macOS: `~/Library/Application Support/Eragear/`
- Windows: `%APPDATA%/Eragear/`

Auth startup invariants:

- Auth DB path phải writable; nếu không writable server fail-fast khi bootstrap
  auth runtime.
- Better Auth Drizzle adapter phải nhận schema rõ ràng
  (`user/session/account/verification/apikey`).

## 6. Security Posture

### 6.1 Local Execution Risk Model

Server có khả năng tool execution (filesystem, terminal). Vì vậy remote exposure
phải xem như high-risk surface (RCE potential nếu auth yếu).

### 6.2 Controls in Code

- project-root boundary checks cho filesystem/tool-calls.
- command/env allowlists (`ALLOWED_*`).
- session auth/API key verification.
- strict CORS allowlist (fail-closed ở production).
- API key query-string bị từ chối (chỉ chấp nhận header hoặc WS `connectionParams`).
- API key rate limiting mặc định bật.
- permission flow cho tool calls cần approve.

### 6.3 Cloudflare Tunnel Guidance

Khi public local server qua tunnel:

- bắt buộc đặt Cloudflare Access trước toàn bộ app, gồm WS/tRPC.
- không bypass Access cho WebSocket path.
- non-browser client phải gửi `CF-Access-Client-Id` +
  `CF-Access-Client-Secret` ở handshake headers.
- `connectionParams` của tRPC là app-level auth, không thay thế Access headers.

## 7. Configuration (Environment)

Nguồn sự thật: `src/config/environment.ts`

Nhóm biến chính:

- Networking: `WS_HOST`, `WS_PORT`, `WS_HEARTBEAT_INTERVAL_MS`
- Timeouts: `SESSION_IDLE_TIMEOUT_MS`, `AGENT_TIMEOUT_MS`, `TERMINAL_TIMEOUT_MS`
- Policy: `ALLOWED_AGENT_COMMANDS`, `ALLOWED_TERMINAL_COMMANDS`, `ALLOWED_ENV_KEYS`, `CORS_STRICT_ORIGIN`
- Auth: `AUTH_SECRET`, `AUTH_BASE_URL`, `AUTH_TRUSTED_ORIGINS`, `AUTH_ALLOW_SIGNUP`, `AUTH_BOOTSTRAP_API_KEY`, `AUTH_API_KEY_PREFIX`, `AUTH_API_KEY_RATE_LIMIT_*`
- Logging: `LOG_*`
- Background: `BACKGROUND_*`

Khuyến nghị remote tunnel:

- đặt `WS_HOST=127.0.0.1`.
- buộc Cloudflare Access policy cho hostname public.

## 8. Ops Commands

Trong `apps/server/package.json`:

- `bun run dev`
- `bun run check-types`
- `bun run test:auth-dashboard`
- `bun run smoke:auth-dashboard`
- `bun run build`
- `bun run ui:build`
- `bun run compile`

## 9. Current Gaps / Notes

- Unit/integration test coverage chưa được mô tả chính thức trong docs này.
- Một số tài liệu ACP trong `docs/acp/` là protocol reference, không phải
  implementation contract của riêng codebase này.
- Monitoring hiện tại là logs-first hardening; chưa export metrics/tracing qua
  external observability backend (OTLP/Prometheus).

Auth/dashboard release gate chi tiết:

- `docs/auth-dashboard-validation.md`
