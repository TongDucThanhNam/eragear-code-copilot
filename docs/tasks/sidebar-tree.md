# Sidebar tree / Project hierarchy

## Mục tiêu
- [x] Chuyển sidebar của `apps/web` từ list cứng sang dạng tree/collapsible để hiện rõ Projects và Session của từng Project.
- [x] Giữ lại trạng thái hiện tại (active project/session) và hỗ trợ tương tác keyboard/mouse như trước.

## 1) Hiểu cấu trúc hiện tại
- [x] Kiểm tra component sidebar (ví dụ `apps/web/src/components/nav-projects.tsx` hoặc liên quan) để xác định props data, state, action hiện tại.
- [x] Xác định nguồn data project/session (trong store nào, query nào) để đảm bảo tree được cập nhật realtime.

## 2) Thiết kế tree/collapsible
- [x] Định nghĩa dạng data node: mỗi project là parent, mỗi session là child, kèm id/active/timestamp.
- [x] Chọn thư viện UI (nếu cần) hoặc tự làm accordion sử dụng `Disclosure`/custom hooks (đảm bảo tuân theme Shadcn/Tailwind).
- [x] Xác định trạng thái collapsed/expanded và cách persist (ví dụ local store hoặc Zustand) để giữ trạng thái khi chuyển màn hình.

## 3) Triển khai UI
- [x] Cập nhật component sidebar để render node tree: project row + expand button → session list.
- [x] Giữ nguyên hành vi click: chọn project, select session, highlight active; ensure keyboard nav + aria.
- [/] Tối ưu responsive: tree phải hoạt động trong collapse (drawer) trên mobile.
- [x] Đảm bảo animation mở rộng collapse nhẹ nhàng (Tailwind transitions nếu cần) và không làm tràn layout.

## 4) Tích hợp logic để load session
- [x] Đảm bảo expanding project không gây fetch thêm nếu đã có data.
- [x] Nếu session được cập nhật (session mới/resume), tree cập nhật.
- [x] Xem xét caching/optimistic update khi tạo session mới trong project.

## 5) Kiểm thử
- [ ] Chạy storybook/test component (nếu có) cho sidebar tree.
- [ ] Kiểm tra manual trên web: expand/collapse, navigation, responsive.
- [ ] Đảm bảo không có regresssion bản đồ focus/tab.

## 6) (Optional) Nâng cao
- [ ] Thêm filter/search project trong tree.
- [ ] Hiển thị status (running/idle) bên cạnh session tên.
