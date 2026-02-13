# Eragear Code Copilot Server (`apps/server`)

Server này là backend local cho Eragear Code Copilot. Nó nhận request từ web/native app, quản lý agent process (Codex/Claude/Gemini...), bridge ACP stream và lưu state vào SQLite.

Nếu bạn mới vào project, đọc theo thứ tự:

1. `README.md` (file này)
2. `docs/INDEX.md`
3. `src/ARCHITECTURE.md`

## Runtime Support

- Runtime: **Bun-only**
- Production target: **Linux/macOS**
- Windows: có thể thấy path conventions trong docs, nhưng **không phải production runtime target hiện tại**

## Server này làm gì

- HTTP + tRPC/WebSocket API cho client
- Spawn/stop agent process qua stdio
- Xử lý ACP events: message stream, tool calls, permission requests
- Persist dữ liệu vào SQLite (`eragear.sqlite`)
- Cung cấp dashboard/observability endpoints cho vận hành local

## Quick Start (5 phút)

### 1. Prerequisites

- Bun (latest stable)
- Chạy từ repo root đã cài dependencies

### 2. Chuẩn bị config local

```bash
cd apps/server
cp env.example .env
```

Cập nhật tối thiểu:

- `AUTH_SECRET` (>= 32 chars)
- `ALLOWED_AGENT_COMMAND_POLICIES`
- `ALLOWED_TERMINAL_COMMAND_POLICIES`
- `ALLOWED_ENV_KEYS`

### 3. Run dev server

```bash
bun run dev
```

Mặc định server chạy `http://localhost:3000`.

### 4. Health check nhanh

```bash
curl http://localhost:3000/api/health
```

Kỳ vọng:

```json
{"ok":true,"ts":1700000000000}
```

## Cấu hình quan trọng nhất

Nguồn sự thật: `src/config/environment.ts`

### Required allowlists (production-safe)

Các key này là bắt buộc ở strict mode (production/compiled):

- `ALLOWED_AGENT_COMMAND_POLICIES`
- `ALLOWED_TERMINAL_COMMAND_POLICIES`
- `ALLOWED_ENV_KEYS`

Ví dụ policy:

```json
[{"command":"/usr/local/bin/codex","allowAnyArgs":true}]
```

Ghi chú:

- `*` không hợp lệ
- `command` phải là executable path tuyệt đối (absolute path)
- Legacy keys `ALLOWED_*_COMMANDS` chỉ dùng fallback ở non-strict mode

### Auth bootstrap cache (hardening)

- `AUTH_BOOTSTRAP_ENSURE_DEFAULTS_TTL_MS`
- `AUTH_BOOTSTRAP_CACHE_MAX_USERS` (default: `10000`)
- `AUTH_BOOTSTRAP_INFLIGHT_MAX_USERS` (default: `2000`)
- `AUTH_TRUSTED_PROXY_IPS` (chỉ tin `x-forwarded-for`/`cf-connecting-ip` khi remote nằm trong danh sách này)

Mục tiêu: tránh tăng RAM không giới hạn khi có nhiều `userId`/request đồng thời.

### Networking

- `WS_HOST`
- `WS_PORT`
- `WS_HEARTBEAT_INTERVAL_MS`
- `WS_MAX_PAYLOAD_BYTES`

### Storage

- `ERAGEAR_STORAGE_DIR` (optional override)
- `AUTH_DB_PATH` (optional override cho auth DB)

## Auth model (rất ngắn gọn)

- `/api/auth/*` và `/api/health` là public routes
- Các route `/api/*` còn lại yêu cầu auth context
- tRPC protected procedures yêu cầu `ctx.auth`
- WebSocket có thể xác thực qua `connectionParams.apiKey` (app-level), nhưng nếu đi qua tunnel thì vẫn phải có Access control ở edge

## Command hữu ích

```bash
bun run dev
bun run lint
bun run check-types
bun run check
bun run lint:full
bun run build
bun run ui:build
bun run compile
```

`bun run lint` dùng Biome để enforce layer boundaries (clean architecture import rules) theo `biome.json` và là gate mặc định trong `bun run check`.
`bun run lint:full` chạy Biome full check cho các đợt dọn format/lint debt toàn repo.

## Khi build executable (compiled mode)

- Dùng `settings.json` với `boot.mode = "compiled"`
- Ở mode này, env var overrides bị vô hiệu
- Server fail-fast nếu thiếu boot keys bắt buộc

## Docs map

- Entry docs: `docs/INDEX.md`
- Kiến trúc: `src/ARCHITECTURE.md`
- Báo cáo hệ thống: `docs/SYSTEM_REPORT.md`
- Session module: `src/modules/session/SESSION-MODULE.md`
- ACP references: `docs/acp/*`

## Troubleshooting nhanh

- Không boot được vì allowlist: kiểm tra `ALLOWED_*` trong `.env`/`settings.json`
- Bị Unauthorized: kiểm tra auth headers/api key và route có thuộc public path không
- Không spawn được agent: kiểm tra command policy + binary có trong PATH
- Lỗi storage path: kiểm tra quyền ghi thư mục của `ERAGEAR_STORAGE_DIR` hoặc config dir mặc định
