# Hướng Dẫn Kết Nối tRPC Server

Tài liệu này hướng dẫn cách kết nối và tương tác với Eragear Code Copilot Server thông qua giao thức tRPC.

## 1. Thông Tin Kết Nối

Server sử dụng **WebSocket** để giao tiếp tRPC.

- **URL mặc định**: `ws://localhost:3001` (Kiểm tra `ENV.wsPort` trong `apps/server/src/config/environment.ts` hoặc biến môi trường `WS_PORT`).
- **Protocol**: WebSocket (`ws://` hoặc `wss://`).

> **Lưu ý**: Server hiện tại **không** expose tRPC qua HTTP endpoint (như `/trpc`), chỉ qua WebSocket.

## 2. Cài Đặt Client

Để kết nối từ một ứng dụng client (React, Node.js, etc.), bạn cần các package của tRPC.

```bash
npm install @trpc/client @trpc/server
```

Ví dụ cấu hình client cơ bản:

```typescript
import { createTRPCClient, wsLink } from '@trpc/client';
// Import type AppRouter từ server để có type safety và autocompletion
// Đường dẫn import sẽ thay đổi tùy thuộc vào vị trí file client của bạn
import type { AppRouter } from '../../apps/server/src/transport/trpc/router';

// Tạo WebSocket Link
const wsClient = wsLink({
  url: 'ws://localhost:3001',
  // Nếu cần xác thực qua API Key
  connectionParams: {
    apiKey: 'YOUR_API_KEY', 
  },
});

// Khởi tạo tRPC Client
export const client = createTRPCClient<AppRouter>({
  links: [wsClient],
});
```

## 3. Khám Phá API (Finding Available Functions)

Cách tốt nhất để tìm các chức năng (procedures) có sẵn là dựa vào **TypeScript IntelliSense** (Autocompletion) của `AppRouter`.

### Cấu Trúc Router

`AppRouter` được định nghĩa tại `apps/server/src/transport/trpc/router.ts`. Nó bao gồm các router con được gộp (merge) lại.

Cấu trúc hiện tại:

1.  **Root Level** (Các router được merge trực tiếp):
    *   **Project**: `listProjects`, `createProject`, `updateProject`, `deleteProject`, ...
    *   **Session**: Các chức năng liên quan đến phiên làm việc chat.
    *   **Code**: Các chức năng liên quan đến code intelligence.
    *   **AI**: Các chức năng AI gen.
    *   **Tool**: Các công cụ tiện ích.

2.  **Namespaced** (Các router nằm trong object con):
    *   **auth**: `client.auth.*\ (Ví dụ: `client.auth.getSession`)
    *   **agents**: `client.agents.*\ (Quản lý agent configs)

### Ví dụ Tra Cứu

Để biết `projectRouter` có những hàm nào, bạn có thể:

1.  **Dùng IDE**: Gõ `client.` và xem danh sách gợi ý.
2.  **Xem Code**:
    *   Mở `apps/server/src/transport/trpc/routers/project.ts`.
    *   Tìm object `projectRouter`. Các key trong đó (như `listProjects`, `createProject`) chính là tên hàm bạn gọi từ client.

```typescript
// Server: apps/server/src/transport/trpc/routers/project.ts
export const projectRouter = router({
  listProjects: protectedProcedure.query(...),
  // ...
});

// Client usage:
const projects = await client.listProjects.query();
```

## 4. Ví Dụ Sử Dụng

### Lấy danh sách Project

```typescript
try {
  const projects = await client.listProjects.query();
  console.log('Projects:', projects);
} catch (error) {
  console.error('Lỗi lấy danh sách project:', error);
}
```

### Gọi API có tham số (Mutation)

Ví dụ tạo mới một Project:

```typescript
try {
  const newProject = await client.createProject.mutate({
    name: 'My New Project',
    path: '/path/to/project',
    description: 'A test project',
  });
  console.log('Đã tạo project:', newProject);
} catch (error) {
  console.error('Lỗi tạo project:', error);
}
```

### Sử dụng Namespace (Auth)

```typescript
// Gọi procedure trong namespace 'auth'
const session = await client.auth.getSession.query();
```

## 5. Xác Thực (Authentication)

Server hỗ trợ xác thực qua **API Key** hoặc **Session Cookie**.

### Qua WebSocket Connection Params (Khuyên dùng cho script/tool)

Truyền `apiKey` vào `connectionParams` khi khởi tạo `wsLink`. Server sẽ kiểm tra và tạo context xác thực cho kết nối socket đó.

```typescript
wsLink({
  url: 'ws://localhost:3001',
  connectionParams: {
    apiKey: 'sk_...', // API Key của bạn
  },
})
```

### Qua Headers (Dùng cho HTTP/Browsers)

Nếu bạn chia sẻ cookie session (ví dụ client chạy trên cùng domain), tRPC context sẽ tự động đọc session từ request headers.

## 6. Xử Lý Lỗi

tRPC sẽ ném ra lỗi nếu request thất bại. Bạn nên dùng `try/catch`.

```typescript
try {
  await client.someProcedure.query();
} catch (err) {
  // err.message chứa thông báo lỗi từ server
  // err.data.code chứa mã lỗi (ví dụ: 'UNAUTHORIZED', 'NOT_FOUND')
  if (err.data?.code === 'UNAUTHORIZED') {
    console.log('Vui lòng đăng nhập lại.');
  }
}
```
