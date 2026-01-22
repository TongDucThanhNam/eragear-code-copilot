# Native drawer project navigation

## Mục tiêu
- [ ] Trong app native Expo (`apps/native`), chuyển phần Project/Session hiển thị sang drawer để thao tác dễ dàng trên thiết bị.
- [ ] Các Project hiển thị như list item trong drawer, chọn project sẽ cập nhật nội dung session tương ứng ở màn hình chính.

## 1) Hiểu sơ đồ hiện tại
- [ ] Xem cấu trúc drawer/tabs (`apps/native/app/(drawer)` và component đang dùng list session) để xác định nơi đặt danh sách project.
- [ ] Xác định store/query cung cấp session/project (có thể share với web hoặc khác) để đảm bảo dữ liệu đồng bộ.

## 2) Thiết kế giao diện
- [ ] Trong drawer, hiển thị `FlatList`/`ScrollView` các project như list item (có icon, tên, trạng thái nếu có).
- [ ] Khi người dùng chọn một project, drawer đóng (nếu cần) và màn hình chính update session list cho project đó.
- [ ] Session list hiển thị ngay trong screen chính (có thể bên dưới header) và phản hồi thay đổi project.

## 3) Triển khai logic dữ liệu
- [ ] Đảm bảo project selection cập nhật store (ví dụ Zustand) để các component khác (chat list, session view) có thể dùng.
- [ ] Session data phải filter theo project được chọn, pagination giữ nguyên.
- [ ] Khi có session mới/resume, danh sách session cập nhật theo project hiện chọn.

## 4) Tối ưu UX mobile
- [ ] Đảm bảo drawer dễ thao tác (touch targets đủ lớn, scroll mượt).
- [ ] Drawer phản hồi status hiện tại: highlight project đang mở.
- [ ] Cân nhắc độ rộng drawer để không che nội dung quá nhiều.

## 5) Kiểm thử
- [ ] Test trên Android và iOS simulator: mở drawer, chọn project, xem session list thay đổi.
- [ ] Test behavior khi không có project/session (empty states).
- [ ] Đảm bảo trạng thái active project/session được lưu khi đóng/mở drawer.
