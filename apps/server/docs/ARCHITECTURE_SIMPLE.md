# Architecture Simple (Pointer)

Tài liệu kiến trúc canonical của server nằm ở:

- `src/ARCHITECTURE.md`

File này chỉ giữ tóm tắt onboarding ngắn:

- Layer chính: `bootstrap -> transport -> application -> domain`.
- IO/policy adapters dùng chung nằm ở `src/platform/*`.
- Adapters theo module nằm ở `src/modules/*/infra/*`.
- `transport` và `bootstrap` chỉ import module public API từ `src/modules/*/index.ts`.

Khi cần thay đổi kiến trúc, cập nhật trực tiếp `src/ARCHITECTURE.md` trước, sau đó
chỉnh file này nếu cần cập nhật wording onboarding.
