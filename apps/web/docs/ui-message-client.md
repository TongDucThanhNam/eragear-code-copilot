# UIMessage client (Web)

Tài liệu mô tả cách web app tiêu thụ `UIMessage` từ server. Client chỉ cần
upsert theo `message.id` và render theo `UIMessagePart`.

## Nguồn dữ liệu

- `onSessionEvents`:
  - `ui_message` (chính)
  - `available_commands_update`
  - `current_mode_update`
  - `terminal_output`
- `getSessionMessages`: trả về **`UIMessage[]`**

## Điểm tích hợp chính

- `apps/web/src/components/chat-ui/chat-interface.tsx`
  - Upsert `UIMessage` theo id
  - Tính trạng thái streaming từ `part.state`
- `apps/web/src/components/chat-ui/chat-messages.tsx`
  - Render các `UIMessagePart`
  - Parse tool output (diff/terminal/content)
  - Hiển thị xác nhận permission theo `data-permission-options`

## Render UIMessagePart

- `text` / `reasoning` → Message/Reasoning UI
- `tool-*` → Tool UI
  - `tool-plan` + `output.entries` → Plan
- `source-url` / `source-document` / `file` → badge/link
- `data-*` → metadata (không render trực tiếp)

## Permission flow

`ToolUIPart.state === "approval-requested"` mang `approval.id`.
Options lấy từ `data-permission-options` (requestId + options).

## Tool output & terminal

- `ToolUIPart.output`: `ToolCallContent[]` (content/diff/terminal)
- `terminal_output` stream log theo `terminalId`

## Khi thêm part mới

1. Update `chat-messages.tsx` để render
2. Cập nhật parsing output nếu có format mới
3. Đảm bảo `data-*` được bỏ qua an toàn
