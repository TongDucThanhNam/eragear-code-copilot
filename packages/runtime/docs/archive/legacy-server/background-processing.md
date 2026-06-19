# Background Processing (Server)

Tài liệu mô tả cơ chế chạy tác vụ bất đồng bộ định kỳ trong `apps/server`.

## 1. Kiến trúc runtime

- Runner trung tâm:
  - `src/platform/background/runner.ts`
- Task contracts:
  - `src/shared/types/background.types.ts`
- Task hiện có:
  - `session-idle-cleanup`:
    `src/platform/background/tasks/session-idle-cleanup.task.ts`
  - `cache-prune`:
    `src/platform/background/tasks/cache-prune.task.ts`

Runner được start/stop cùng vòng đời server tại `src/bootstrap/server.ts`.

## 2. Session idle cleanup policy

- Session không còn subscriber sẽ được đánh dấu `idleSinceAt`.
- Task `session-idle-cleanup` quét định kỳ:
  - nếu `subscriberCount > 0` => clear idle marker.
  - nếu idle quá `SESSION_IDLE_TIMEOUT_MS` => cleanup terminals, kill process,
    xóa runtime session, update persisted status = `stopped`.
- Session subscription không còn dùng `setTimeout` per-session nữa.

Nguồn:

- `src/transport/trpc/routers/session.ts`
- `src/shared/types/session.types.ts`

## 3. Cấu hình môi trường

Trong `src/config/environment.ts`:

- `BACKGROUND_ENABLED`
- `BACKGROUND_TICK_MS`
- `BACKGROUND_TASK_TIMEOUT_MS`
- `BACKGROUND_SESSION_CLEANUP_INTERVAL_MS`
- `BACKGROUND_CACHE_PRUNE_INTERVAL_MS`

## 4. Trạng thái runtime

Composition runtime expose state snapshot để dashboard API đọc:

- `getBackgroundRunnerState()`
- `getCacheStats()`

Nguồn: `src/bootstrap/composition.ts`.

## 5. Scope hiện tại

- Mô hình hiện tại là `embedded in API process`.
- Chưa có durable queue ngoài process (Redis/Postgres queue).
- Phù hợp hardening hiện tại, là nền để nâng cấp queue backend ở phase sau.
