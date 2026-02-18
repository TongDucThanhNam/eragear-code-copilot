# Debugging Guide

## 1. Correlation IDs

- HTTP middleware `src/transport/http/request-id.ts` luôn gắn:
  - `x-request-id`
  - `x-trace-id`
- Các giá trị này được đưa vào observability context để log correlation.

Khi có lỗi từ client, lấy `requestId` trong response JSON hoặc header rồi tra log.

## 2. Error Contract

- Error chuẩn của application: `AppError` tại `src/shared/errors/index.ts`
- Thuộc tính quan trọng:
  - `code`
  - `statusCode`
  - `module`
  - `op`
  - `details`

HTTP và tRPC đều map dựa trên error typed:

- HTTP: `src/transport/http/error-handler.ts`
- tRPC: `src/transport/trpc/error-mapper.ts` + `src/transport/trpc/base.ts`
- Application logging dùng `LoggerPort`:
  - contract: `src/shared/ports/logger.port.ts`
  - adapter: `src/platform/logging/logger-adapter.ts`

## 3. Operation Naming

- Format: `module.usecase.action`
- Ví dụ:
  - `session.lifecycle.create`
  - `session.state.get`
  - `ai.prompt.send`
  - `tooling.permission.respond`

Khi debug lỗi, luôn ghi nhận bộ 3:

- `requestId`
- `module`
- `op`

## 4. Where To Look First

### 4.1 Session lifecycle issues

- `src/modules/session/index.ts`
- `src/modules/session/application/*.service.ts`
- `src/modules/session/infra/session-acp.adapter.ts`
- `src/platform/acp/*`
- `src/modules/session/infra/runtime-store.ts`

### 4.2 Prompt/send-message issues

- `src/modules/ai/application/send-message.service.ts`
- `src/modules/ai/application/prompt.builder.ts`
- `src/platform/acp/update.ts`

### 4.3 Permission flow issues

- `src/platform/acp/permission.ts`
- `src/modules/tooling/application/respond-permission.service.ts`
- `src/transport/trpc/routers/tool.ts`

### 4.4 Auth failures

- `src/platform/auth/*`
- `src/transport/auth/auth-context.bootstrap.ts`
- `src/transport/trpc/context.ts`

## 5. Debug Playbook

1. Tái hiện lỗi và lấy `requestId`
2. Tra log theo `requestId`
3. Xác định `module/op`
4. Mở đúng use-case file từ module public API (`src/modules/<module>/index.ts`)
5. Nếu lỗi liên quan IO/protocol, chuyển sang `src/platform/*`
6. Xác nhận mapping status/code ở transport layer
