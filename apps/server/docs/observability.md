# Observability (Server)

Tài liệu này mô tả lớp quan sát runtime hiện tại của `apps/server`.

## 1. Thành phần chính

- Correlation context:
  - `src/shared/utils/observability-context.util.ts`
  - Dùng `AsyncLocalStorage` để gắn `requestId`, `traceId`, `source`, `taskName`, `taskRunId`.
- Logging pipeline:
  - `src/platform/logging/logger.ts`
  - `src/platform/logging/log-store.ts`
  - `src/platform/logging/request-logger.ts`
- Snapshot API:
  - `GET /api/dashboard/observability`
  - `src/transport/http/routes/dashboard-api.ts`
  - `src/modules/ops/application/get-observability-snapshot.service.ts`

## 2. Correlation fields

`LogEntry` đã hỗ trợ thêm:

- `requestId`
- `traceId`
- `chatId`
- `taskName`
- `taskRunId`

Nguồn type: `src/shared/types/log.types.ts`.

## 3. HTTP flow

Middleware thứ tự hiện tại:

1. `requestIdMiddleware` (tạo/nhận `x-request-id`, `x-trace-id`, set async context)
2. `createRequestLogger` (ghi request log với `duration/status/path`)
3. các middleware/routing còn lại

Nguồn: `src/bootstrap/server.ts`.

## 4. Snapshot observability

`/api/dashboard/observability` trả về:

- log totals (`errorCount`, `warnCount`)
- HTTP stats (`requestsPerMinute`, `status2xx/4xx/5xx`, `p50/p95 duration`)
- session stats (`active`, `idle`, `pendingPermissions`)
- cache stats (`size`, `hits`, `misses`, `hitRatio`, `memoryUsage`)
- background runner state (task states, success/failure counters)

## 5. Scope hiện tại

Hiện tại là `logs-first` hardening:

- có correlation logging + runtime snapshot.
- chưa export metrics/traces qua Prometheus/OTLP collector.
- chưa có distributed tracing end-to-end qua external backend.
