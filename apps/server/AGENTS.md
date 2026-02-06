# AGENTS.md (Server)

Mục tiêu của file này là ngắn gọn. Chỉ giữ quy tắc cốt lõi và dẫn đến tài liệu chi tiết.

## 1. Architecture Summary (Source of truth)

- Kiến trúc: `Clean Architecture` + `Ports/Adapters` + `vertical slices`.
- Layer chính: `transport -> application -> domain`.
- `infra` chỉ triển khai IO/policy qua ports, không chứa business rules.
- Tài liệu chính:
  - `src/ARCHITECTURE.md`
  - `docs/INDEX.md`

## 2. Non-negotiables

- Ship production-grade, scalable (>1000 users), avoid MVP shortcuts.
- Keep single canonical implementation in primary codepath; remove dead/duplicate paths.
- Keep single source of truth for rules/constants/config.
- Validate inputs up front, fail fast, clear invariants.
- Prefer latest stable libs/docs.

## 3. Security Guardrails

- No secrets in code/logs; use env/secret stores.
- Validate/sanitize untrusted input (injection, path traversal, SSRF, unsafe uploads).
- Enforce AuthN/AuthZ and tenant boundaries, least privilege.
- Local server exposed via tunnel is high-risk: never bypass Cloudflare Access for WS/tRPC.
- Non-browser clients must pass `CF-Access-Client-Id` + `CF-Access-Client-Secret` in handshake headers.

## 4. Coding Boundaries

- Domain must not import transport/infra.
- Application must not import transport.
- Transport must not import domain/infra.
- Infra must not import transport.
- Lint policy is enforced by `biome.json`.

## 5. Where to Read by Task

- System overview: `docs/SYSTEM_REPORT.md`
- Session lifecycle: `src/modules/session/SESSION-MODULE.md`
- UI message contract: `docs/ui-message-normalization.md`
- useChat client contract: `docs/ui-message-usechat-client.md`
- ACP protocol refs: `docs/acp/*`
- Runtime bootstrap: `src/index.ts`, `src/bootstrap/server.ts`, `src/bootstrap/container.ts`
- Config source: `src/config/environment.ts`

## 6. Build/Check

- `bun run dev`
- `bun run check-types`
- `bunx biome check`
- `bun run build`

## 7. Keep This File Small

- Không đưa flow dài, sơ đồ lớn, hoặc protocol details vào đây.
- Nếu cần chi tiết, cập nhật tài liệu chuyên đề trong `docs/` hoặc `src/*/*.md`, sau đó link vào đây.
