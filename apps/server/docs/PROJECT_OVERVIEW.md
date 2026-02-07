# Eragear Code Copilot - Technical Overview

## 1. Bản Chất Sản Phẩm (The Core Concept)

**Eragear Code Copilot** là nền tảng **Local Agent Orchestrator & Gateway**, cho phép người dùng tương tác với các Coding Agents mạnh mẽ (Claude Code, Cortex...) thông qua giao diện Web/Mobile hiện đại, thay vì chỉ terminal.

---

## 2. Tech Stack Ecosystem

Hệ thống được thiết kế theo mô hình **Local-First**, tối ưu cho độ trễ thấp và bảo mật dữ liệu.

### Backend (Server)
-   **Core:** Node.js / Bun.
-   **Web Framework:** `Hono` (High performance Standard-compliant Web Standard).
-   **API:** `tRPC` (End-to-end typesafe) + `WebSocket` (Real-time events).
-   **Database:** `SQLite` (File-based, embedded) + `Drizzle ORM`.
-   **Agent Protocol:** `ACP` (Agent Client Protocol) over `Stdio`.

### Security & Deployment (Quan Trọng)
-   **User Environment:** Server được thiết kế để **CHẠY TRÊN MÁY USER** (Localhost).
    -   *Tại sao?* Vì Agent cần quyền truy cập file source code trực tiếp để đọc/sửa.
-   **Remote Access:** 
    -   Để truy cập Server này từ thiết bị khác (Mobile/Laptop khác) khi đang ở ngoài, chúng ta KHÔNG mở port trực tiếp (rất nguy hiểm).
    -   **Giải pháp:** Sử dụng **Cloudflare Tunnel** (Zero Trust).
-   **Authentication:**
    -   Hệ thống tích hợp sẵn Auth Guard (Better Auth).
    -   Khi public qua Tunnel, bắt buộc phải có lớp bảo vệ `Cloudflare Access` hoặc Auth Token mạnh.

---

## 3. Kiến Trúc Luồng Dữ Liệu (Flow)

1.  **Remote Client (Web/Mobile):** Gửi Request qua Tunnel -> Đến Local Server.
2.  **Server Gateway:** 
    -   Verify Auth.
    -   Route request đến đúng Session/Project.
3.  **Local Agent Execution:**
    -   Server spawn tiến trình Agent (VD: `claude`).
    -   Server gửi lệnh qua `Stdin`.
4.  **Feedback Loop:**
    -   Agent xử lý -> Gửi output (Text/JSON/Diff) qua `Stdout`.
    -   Server **Normalize** dữ liệu này thành `UIMessage`.
    -   Server stream ngược lại Client qua WebSocket Tunnel.

---

## 4. Tại Sao Cần Server Này?
(Tại sao không để Client kết nối thẳng tới Agent?)

1.  **Normalization:** Mỗi Agent (Claude, Codex, Custom) có format log khác nhau. Server chuẩn hóa tất cả về một định dạng `UIMessage` duy nhất để UI dễ hiển thị.
2.  **State Management:** Client có thể disconnect (tắt app), nhưng Agent Process vẫn phải chạy nền. Server giữ session này sống.
3.  **Security Gatekeeper:** Server chặn các lệnh nguy hiểm (VD: `rm -rf /` root) mà Agent có thể vô tình hoặc cố ý thực thi, yêu cầu User confirm trước.
4.  **Multi-Agent:** Một giao diện UI, chuyển đổi qua lại giữa nhiều loại Agent khác nhau.

---

## 5. Deployment Future
Tương lai, người dùng chỉ cần chạy 1 lệnh:
`npx eragear start`
-> Server bật lên tại port 3000.
-> Tự động setup Tunnel (nếu user muốn remote).
-> UI mở trên browser.
