# Session Module

Quản lý lifecycle session runtime: tạo, resume, stop, delete, state, metadata,
history và realtime subscription.

## Scope

Session module chịu trách nhiệm:

- Tạo session và runtime state.
- Resume session đã persist.
- Stop/delete session.
- Trả session state/messages/list.
- Broadcast events qua runtime store.

Session module không xử lý prompt send/cancel/model/mode trực tiếp:

- Prompt/model/mode/cancel nằm trong `src/modules/ai/application/*`.

## Structure

### Domain

- `src/modules/session/domain/session.entity.ts`

### Application Services

- `src/modules/session/application/create-session.service.ts`
- `src/modules/session/application/resume-session.service.ts`
- `src/modules/session/application/stop-session.service.ts`
- `src/modules/session/application/delete-session.service.ts`
- `src/modules/session/application/get-session-state.service.ts`
- `src/modules/session/application/get-session-messages.service.ts`
- `src/modules/session/application/list-sessions.service.ts`
- `src/modules/session/application/update-session-meta.service.ts`
- `src/modules/session/application/reconcile-session-status.service.ts`

### Ports

- `SessionRepositoryPort`
- `SessionRuntimePort`
- `AgentRuntimePort`
- `SessionAcpPort`

### Infra

- `src/modules/session/infra/runtime-store.ts` (active sessions in RAM)
- `src/modules/session/infra/session.repository.sqlite.ts` (SQLite persistence)

## Key Data

- Runtime session: `SessionRuntime` trong RAM.
- Persisted session: metadata + messages trong SQLite (`sessions`, `session_messages`).
- Runtime event stream: `BroadcastEvent` qua emitter/subscription.

## Core Flow: Create Session

1. Resolve project + settings + requested command.
2. Spawn process qua `AgentRuntimePort`.
3. Tạo ACP connection và handlers qua `SessionAcpPort`.
4. Initialize protocol handshake.
5. Khởi tạo `SessionRuntime` trong runtime store.
6. Persist metadata vào session repository.
7. Broadcast initial session/chat status.

## Core Flow: Resume Session

1. Đọc persisted session từ repository.
2. Spawn lại process và ACP connection.
3. Re-attach handlers + runtime state.
4. Đồng bộ chat status/message buffer cho subscriber mới.

## Core Flow: Stop/Delete Session

- `StopSessionService`:
  - terminate terminals,
  - kill process,
  - update runtime + persisted status.
- `DeleteSessionService`:
  - stop runtime (nếu còn sống),
  - xóa record khỏi repository.

## Realtime Subscription

- tRPC endpoint: `onSessionEvents` (`src/transport/trpc/routers/session.ts`).
- Khi subscribe:
  - emit `connected`,
  - emit chat status hiện tại,
  - replay `messageBuffer`.
- Khi unsubscribe:
  - giảm `subscriberCount`,
  - set `idleSinceAt` nếu không còn subscriber.
- Cleanup thực tế được thực thi bởi background task
  `session-idle-cleanup` theo `SESSION_IDLE_TIMEOUT_MS`.

## Invariants

- `chatId` là key runtime duy nhất.
- Không tạo runtime trùng cho cùng chat.
- Mọi broadcast đi qua `SessionRuntimePort`.
- Mọi persist đi qua `SessionRepositoryPort`.
- Session cleanup phải đóng terminals trước khi kill process.
