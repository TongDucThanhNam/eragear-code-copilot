# Server Codemap

Mục tiêu: giúp dev/AI biết nhanh cần sửa file nào khi thêm chức năng hoặc debug.

## 1. Entry Points

- Process entry: `src/index.ts`
- Bootstrap runtime: `src/bootstrap/server.ts`
- Composition root/DI: `src/bootstrap/container.ts`
- HTTP routes root: `src/transport/http/routes/index.ts`
- tRPC router root: `src/transport/trpc/router.ts`

## 2. Public Module APIs

- Session: `src/modules/session/index.ts`
- AI: `src/modules/ai/index.ts`
- Agent: `src/modules/agent/index.ts`
- Project: `src/modules/project/index.ts`
- Settings: `src/modules/settings/index.ts`
- Tooling: `src/modules/tooling/index.ts`
- Ops: `src/modules/ops/index.ts`

Rule: từ `transport`/`bootstrap` chỉ import từ `@/modules/<module>`.
Rule bổ sung:
- `transport` không import `@/modules/<module>/di`
- `bootstrap`/composition wiring được phép import `@/modules/<module>/di`
- `src/modules/<module>/index.ts` không import/re-export `infra/*`

## 3. Add Feature Checklist

### 3.1 New use-case trong module

1. Tạo service ở `src/modules/<module>/application/<use-case>.service.ts`
2. Nếu cần contract IO mới, thêm port ở `src/modules/<module>/application/ports/*.port.ts`
3. Implement adapter ở:
   - `src/modules/<module>/infra/*` nếu adapter riêng module
   - `src/platform/*` nếu adapter dùng chung
   - Rule ownership: port thuộc module nào thì adapter implement chính đặt ở
     `src/modules/<module>/infra/*`
4. Export use-case/port mới qua `src/modules/<module>/index.ts`
5. Nếu thêm concrete adapter để wiring, export qua `src/modules/<module>/di.ts`
6. Wire dependencies ở `src/bootstrap/container.ts`
7. Expose interface ở HTTP/tRPC router

### 3.2 New HTTP endpoint

1. Thêm route trong `src/transport/http/routes/*.ts`
2. Validate input tại route
3. Gọi use-case qua module public API
4. Không đặt business logic ở route

### 3.3 New tRPC procedure

1. Thêm procedure trong `src/transport/trpc/routers/*.ts`
2. Validate bằng Zod ở router
3. Gọi use-case qua module public API
4. Để `base.ts` xử lý error mapping tập trung

### 3.4 New background task

1. Tạo task ở `src/platform/background/tasks/*.task.ts`
2. Register tại `src/platform/background/index.ts`

### 3.5 New SQLite migration

1. Thêm SQL migration tại `drizzle/*.sql`
2. Cập nhật schema/runtime tại `src/platform/storage/*`
3. Cập nhật repository tương ứng ở `src/modules/*/infra/*.repository.sqlite.ts`

## 4. Platform Map

- ACP bridge: `src/platform/acp/*`
- Agent process runtime: `src/platform/process/index.ts`
- Storage/SQLite: `src/platform/storage/*`
- Auth runtime: `src/platform/auth/*`
- Logging/log store: `src/platform/logging/*`
  - App logger adapter: `src/platform/logging/logger-adapter.ts`
- Background runner: `src/platform/background/*`
- Cache: `src/platform/caching/*`

## 5. Error + Operation Contract

- Operation name format: `module.usecase.action`
- Error type chuẩn: `AppError` (`src/shared/errors/index.ts`)
- HTTP mapping: `src/transport/http/error-handler.ts`
- tRPC mapping: `src/transport/trpc/error-mapper.ts`, `src/transport/trpc/base.ts`

Khi thêm use-case mới:

- khai báo `const OP = "<module>.<usecase>.<action>"`
- throw lỗi typed kèm `module`, `op`, `details`
- nếu cần logging trong application, dùng `LoggerPort` từ
  `src/shared/ports/logger.port.ts` và inject từ container
