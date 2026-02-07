# Eragear Server Docs Index

Tài liệu điều hướng nhanh cho `apps/server`.

## 1. Read First

- `src/ARCHITECTURE.md`
  - Kiến trúc hiện tại theo layers + module boundaries.
- `docs/SYSTEM_REPORT.md`
  - Báo cáo vận hành hệ thống theo code hiện tại.
- `AGENTS.md`
  - Quy chuẩn làm việc, security guardrails, triển khai tunnel an toàn.

## 2. Runtime Entry Points

- `src/index.ts`
- `src/bootstrap/server.ts`
- `src/bootstrap/container.ts`
- `src/transport/trpc/router.ts`
- `src/transport/http/routes/index.ts`

## 3. Core Flow Docs

- Session lifecycle:
  - `src/modules/session/SESSION-MODULE.md`
- Observability:
  - `docs/observability.md`
- Background processing:
  - `docs/background-processing.md`
- UI message normalization:
  - `docs/ui-message-normalization.md`
- Client-side useChat contract:
  - `docs/ui-message-usechat-client.md`
- Auth/dashboard release gate:
  - `docs/auth-dashboard-validation.md`
- ACP protocol references:
  - `docs/acp/*`

## 4. Source of Truth (Implementation)

Các file sau là nguồn chuẩn khi docs và thực tế có khác biệt:

- Config env: `src/config/environment.ts`
- HTTP/WS bootstrap: `src/bootstrap/server.ts`
- tRPC auth context: `src/transport/trpc/context.ts`
- Session events and buffering: `src/infra/acp/update.ts`
- Permission pipeline: `src/infra/acp/permission.ts`, `src/modules/tooling/application/respond-permission.service.ts`
- Storage path policy: `src/infra/storage/storage-path.ts`
- SQLite boot/migration: `src/infra/storage/sqlite-store.ts`
- Drizzle schema/db: `src/infra/storage/sqlite-schema.ts`, `src/infra/storage/sqlite-db.ts`
- Observability snapshot: `src/modules/ops/application/get-observability-snapshot.service.ts`, `src/transport/http/routes/dashboard-api.ts`
- Background runner: `src/infra/background/runner.ts`, `src/infra/background/tasks/*`

## 5. Security Notes

- Server chạy local nhưng có quyền filesystem/terminal, nên remote exposure là
  high-risk surface.
- Khi dùng Cloudflare Tunnel:
  - không bypass Access cho WS/tRPC.
  - non-browser client gửi `CF-Access-Client-Id` và `CF-Access-Client-Secret`
    ở WebSocket handshake headers.
  - `connectionParams` chỉ là app-level auth (`apiKey`), không thay Access.
- API key không được truyền qua query string; chỉ dùng header hoặc WS `connectionParams`.

## 6. Development Commands

- `bun run dev`
- `bun run check-types`
- `bun run test:auth-dashboard`
- `bun run smoke:auth-dashboard`
- `bun run build`
- `bun run ui:build`
- `bun run compile`

## 7. Scope Notes for ACP Docs

`docs/acp/*` chủ yếu là protocol reference (ACP schema/flows). Các tài liệu này
không phải toàn bộ đều mapping 1:1 với file path nội bộ hiện tại.
