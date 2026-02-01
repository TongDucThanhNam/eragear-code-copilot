# Eragear Server (ACP Client) — Operational Map

Tài liệu vận hành cho dev/AI khi làm việc trong `apps/server`: đọc xong biết
đi đâu, sửa ở đâu, không được làm gì, và test/debug như thế nào.

## 1) Definition Block (đọc 60 giây)

- **Module** = vertical slice nằm dưới `src/modules/<feature>/` gồm `application/`, `domain/`, `infra/`.
- **Transport** (`src/transport/**`) là API boundary (HTTP/tRPC/WS); chỉ validate/map input, gọi application.
- **Application** (`src/modules/*/application/**`) là use-case orchestration; gọi domain + ports.
- **Domain** (`src/modules/*/domain/**`) chứa entity + rule/invariant; không import `transport`/`infra`.
- **Ports/contracts** nằm ở `src/modules/*/application/ports/**` (cross-cutting ở `src/shared/ports`); application depend on ports, infra implements.
- **Global infra** (`src/infra/**`) = adapter dùng chung (ACP, process, filesystem, git, storage).
- **Module infra** (`src/modules/*/infra/**`) = persistence/runtime đặc thù module (JSON repo, runtime store).
- **Infra được phép có policy/IO logic** (allowlist, sandbox, retry, mapping), **không chứa domain rules**.
- **Dependency wiring** ở `src/bootstrap/container.ts` (ports → adapters).
- **Process entry** ở `src/index.ts`; HTTP/WS wiring ở `src/bootstrap/server.ts`.

## 2) Where to start (5 entry points)

- `src/index.ts`: process entry; gọi `startServer()`.
- `src/bootstrap/server.ts`: tạo Hono app, đăng ký HTTP routes, tRPC WS handler, serve UI.
- `src/bootstrap/container.ts`: DI wiring ports/adapters; nơi thêm adapter mới.
- `src/transport/trpc/router.ts` + `src/transport/trpc/routers/*.ts`: API boundary & procedure definitions.
- `src/infra/acp/*`: ACP bridge (connection, handlers, permission, tool-calls, update).

## 3) Flow Catalog (chuẩn repo, dùng để đặt logic đúng chỗ)

### Flow 1: Create session

1. UI gọi tRPC `createSession` (`src/transport/trpc/routers/session.ts`).
2. Transport validate input (zod) và gọi `CreateSessionService`.
3. `CreateSessionService` (`src/modules/session/application/create-session.service.ts`)
   orchestration: repo, runtime, agent runtime, settings.
4. `AgentRuntimeAdapter` (`src/infra/process/index.ts`) spawn process + ACP
   connection (`src/infra/acp/connection.ts`).
5. `createSessionHandlers` (`src/infra/acp/handlers.ts`) gắn
   permission/update/tool-calls.
6. `createSessionUpdateHandler` (`src/infra/acp/update.ts`) buffer + persist.
7. `SessionRuntimeStore` broadcast events (`src/modules/session/infra/runtime-store.ts`).

### Flow 2: Incoming ACP update

1. Agent gửi update → `createSessionHandlers.sessionUpdate`
   (`src/infra/acp/handlers.ts`).
2. `createSessionUpdateHandler` xử lý buffer/plan/mode/tool calls
   (`src/infra/acp/update.ts`).
3. Persist qua `SessionRepositoryPort` (JSON repo trong
   `src/modules/session/infra/session.repository.json.ts`).
4. Broadcast qua `SessionRuntimePort` → `onSessionEvents` subscription
   (`src/transport/trpc/routers/session.ts`).

### Flow 3: Tool-call permission

1. Agent request permission → `createPermissionHandler`
   (`src/infra/acp/permission.ts`).
2. Request được broadcast qua runtime → UI.
3. UI phản hồi qua tRPC `respondToPermissionRequest`
   (`src/transport/trpc/routers/tool.ts`).
4. `RespondPermissionService` resolve pending request
   (`src/modules/tooling/application/respond-permission.service.ts`).

### Flow 4: Persistence (JSON store)

1. Application gọi `SessionRepositoryPort` (port ở `src/modules/session/application/ports`).
2. Implementation là JSON repo (`src/modules/session/infra/session.repository.json.ts`).
3. JSON store dùng `src/infra/storage/json-store.ts` → `.eragear/*.json`.

## 4) Decision Table: đặt code ở đâu?

| Nếu cần... | Đặt ở | Ví dụ thực tế |
| --- | --- | --- |
| Validate/map input | `src/transport/**` | `transport/trpc/routers/session.ts` (zod) |
| Orchestrate nhiều dependency | `src/modules/*/application/**` | `modules/session/application/create-session.service.ts` |
| State + invariant domain | `src/modules/*/domain/**` | `modules/project/domain/project.entity.ts` |
| IO/policy (allowlist/sandbox/retry) | `src/infra/**` | `infra/acp/tool-calls.ts`, `infra/process/index.ts` |
| Persistence/runtime module | `src/modules/*/infra/**` | `modules/session/infra/session.repository.json.ts` |
| Contract/port | `src/modules/*/application/ports/**` (+ `src/shared/ports`) | `SessionRepositoryPort`, `AgentRuntimePort` |

## 5) Golden Paths (cách thêm tính năng không phá kiến trúc)

### A. Thêm API mới

1. Thêm procedure ở `src/transport/trpc/routers/*.ts` (validate input).
2. Tạo service ở `src/modules/<feature>/application`.
3. Nếu cần IO mới: thêm port ở `src/modules/<feature>/application/ports/` (hoặc `src/shared/ports` nếu cross-cutting).
4. Implement adapter ở `src/infra/**` hoặc `src/modules/*/infra/**`.
5. Wire port/adapter ở `src/bootstrap/container.ts`.

### B. Thêm tool-call mới cho ACP

1. Thêm handler ở `src/infra/acp/tool-calls.ts`.
2. Nếu cần state/domain: gọi service ở `src/modules/*/application/**`
   qua container/runtime (không thao tác repo trực tiếp trong handler trừ IO/policy).
3. Nếu cần permission: dùng flow `requestPermission` → `respondToPermissionRequest`.

## 6) Anti-patterns (đừng làm)

- Gọi repo trực tiếp trong transport (`src/transport/**`).
- Đặt orchestration trong transport thay vì application.
- Đặt ports ở domain (ports ở `src/modules/*/application/ports/**`).
- Đặt business rules trong infra (infra chỉ policy/IO).
- Tool-call handler tự tạo session state (phải qua runtime/service).
- Domain import `infra`/`transport`.
- Tạo `modules/*/transport` mới (chưa dùng module-level transport).
- Bypass `SessionRuntimePort` khi broadcast event (dùng runtime store).
- Viết trực tiếp file JSON ngoài `json-store.ts` (dùng storage primitive).
- Hardcode path ngoài `projectRoot` trong tool calls (phải resolve/sandbox).

## 7) Glossary (chuẩn hóa thuật ngữ)

- **ChatId**: ID của session runtime (sống trong RAM).
- **Session (stored)**: session metadata + messages lưu ở `.eragear/sessions.json`.
- **Session runtime**: đối tượng đang chạy trong RAM (`SessionRuntimeStore`).
- **ACP connection**: kết nối NDJSON với agent (`infra/acp/connection.ts`).
- **ACP handlers**: bộ callback nhận update/permission/tool calls (`infra/acp/handlers.ts`).
- **Tool call**: agent yêu cầu chạy tool (fs/terminal).
- **Permission request**: yêu cầu người dùng chấp thuận tool call.
- **Buffer**: gom message chunk trước khi persist (`SessionBuffering`).
- **Replay**: lịch sử được agent replay khi resume (`isReplayingHistory`).
- **Event bus**: kênh pub/sub trong server (`shared/utils/event-bus.ts`).

## 8) Test & Debug Map (nhanh, thực dụng)

- **Run dev**: `bun run dev` (entry: `src/index.ts`).
- **Type check**: `bun run check-types`.
- **Build**: `bun run build` (gồm UI build).
- **Log tags chính**: `[Server]`, `[DEBUG]`, `[Storage]` (xem trong `src/**`).
- **ACP handlers**: `src/infra/acp/handlers.ts`, update logic ở `src/infra/acp/update.ts`.
- **Runtime & broadcast**: `src/modules/session/infra/runtime-store.ts`.
- **Config/allowlist**: `src/config/environment.ts` (ALLOWED_* , *_TIMEOUT_MS).
- **Lỗi thường gặp**:
  - `Agent command not allowed` → `src/infra/process/index.ts`.
  - `Access denied (outside project root)` → `src/infra/acp/tool-calls.ts`.
  - `Chat not found` / `Session is not running` → `modules/ai/application/send-message.service.ts`.

## 9) Chuẩn hóa UIMessage (client dùng chung)

- `docs/ui-message-normalization.md`: mapping ACP → UIMessage, tool/permission parts.
