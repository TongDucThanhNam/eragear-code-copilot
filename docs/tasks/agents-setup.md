# AGENTS setup simplification

## Mục tiêu
- [x] Cập nhật hướng dẫn tạo Agents để bỏ cấu hình `cwd` thủ công. Chỉ cần cung cấp `name`, `type`, `command`, `arguments`, `environment` khi tạo agent trong ACP.
- [x] Đảm bảo `cwd` tự động trỏ vào `path` của project (`projectID`) khi khởi tạo session/agent.

## 1) Lý do
- [x] Tránh sai lệch đường dẫn nếu user hoạt động trên workspace tương đối.
- [x] Tăng tính nhất quán: agent luôn khởi tạo trong folder gốc của project được yêu cầu.

## 2) Hướng dẫn tạo agent mới
- [x] Khi gọi API hoặc CLI tạo agent, chỉ cần cung cấp:
  - `name`: tên biểu thị chức năng.
  - `type`: loạt agent (e.g. `cli`, `web`).
  - `command`: câu lệnh chính.
  - `arguments`: các tham số nếu cần.
  - `environment`: biến môi trường (tuỳ chọn).
- [x] Không đặt `cwd` trong cấu hình agent nữa.
- [x] Phần khởi tạo ACP session/agent sẽ lấy `projectID` và dùng `path` tương ứng làm `cwd` (ví dụ project `.../eragear-code-copilot` → `cwd` đó).
- [x] Nếu agent hoạt động trong module con, vẫn dùng root project path vì ACP session luôn mở trong context đó.

## 3) Kiểm thử & xác minh
- [x] Tạo agent mẫu không thiết lập `cwd` thủ công và chắc chắn lệnh chạy trong thư mục đúng bằng `projectID` context.
- [x] Chạy đợt kiểm thử nhiều project khác nhau để đảm bảo `cwd` không bị nhầm lẫn.
- [x] Cập nhật tài liệu nếu có api/schema liên quan (chẳng hạn `docs/acp/..`).

## 4) Ghi chú
- [x] Nếu có nhu cầu đặc biệt phải thay `cwd` (ví dụ chạy script ở submodule), cần xử lý trong logic backend thay vì config agent.
