# Auth + Dashboard Validation Guide

Tài liệu này là release gate cho auth/dashboard flow của server.

## 1. Expected Browser Flow

1. Xóa cookie site.
2. Mở `/` -> redirect sang `/_/dashboard` -> redirect `/login`.
3. Đăng nhập thành công tại `/api/auth/sign-in/username`.
4. Redirect lại `/` và truy cập dashboard thành công (`200`).
5. Sign-out tại `/api/auth/sign-out` và truy cập `/_/dashboard` phải quay lại
   `/login`.

### 1.1 Dashboard Route Canonical

- Canonical dashboard path: `/_/dashboard`.
- Legacy aliases:
  - `/dashboard` -> redirect về `/_/dashboard`
  - `/` -> redirect về `/_/dashboard`

Lý do: tách namespace UI nội bộ (`/_/*`) khỏi root/public routes và giữ tương
thích ngược cho đường dẫn cũ.

## 2. Session Cookies

Better Auth đang dùng cookie chính:

- `better-auth.session_token`
- `better-auth.session_token_multi-*`

Bridge header `Fetch -> Node` phải giữ nguyên multi `Set-Cookie` (array), không
collapse thành một giá trị sai format.

## 3. Validation Commands

- Integration tests:
  - `bun run test:auth-dashboard`
- Smoke test:
  - `bun run smoke:auth-dashboard`

Pass condition:

- Tất cả tests pass.
- Smoke test báo `[Smoke] Auth + dashboard flow passed.`

## 4. Troubleshooting

### 4.1 `SQLiteError: attempt to write a readonly database`

- Kiểm tra quyền ghi thư mục chứa `AUTH_DB_PATH`.
- Đặt `AUTH_DB_PATH` sang path writable.
- Đảm bảo process không chạy bằng user không có quyền với file auth SQLite.

### 4.2 `The model "session" was not found in the schema object`

- Better Auth Drizzle adapter phải được cấu hình với schema đầy đủ.
- Kiểm tra `src/infra/auth/auth.ts` có dùng `drizzleAdapter(..., { schema })`.
- Kiểm tra `src/infra/auth/drizzle-schema.ts` có đủ models:
  `user/session/account/verification/apikey`.

### 4.3 Login thành công nhưng vẫn quay lại `/login`

- Kiểm tra response `POST /api/auth/sign-in/username` có `Set-Cookie` hay không.
- Nếu có nhiều cookie, xác nhận bridge không làm mất cookie thứ hai.
- Kiểm tra browser policy (same-site/domain/path) và dev proxy có strip header.

### 4.4 `POST /api/auth/sign-out` trả `403`

- Gửi kèm `Origin` hợp lệ theo `AUTH_TRUSTED_ORIGINS`.
- Gửi request đúng method/body (`POST` với JSON body).
