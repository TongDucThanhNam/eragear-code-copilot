# UIMessage client (Web)

Tài liệu mô tả cách web app tiêu thụ `UIMessage` từ server. Client chỉ cần
upsert theo `message.id` và render theo `UIMessagePart`.

## Nguồn dữ liệu

- `onSessionEvents`:
  - `ui_message` (chính)
  - `ui_message_delta` (append incremental cho text/reasoning)
  - `chat_status` (trạng thái: `inactive` | `connecting` | `ready` | `submitted` | `streaming` | `awaiting_permission` | `cancelling` | `error`)
  - `chat_finish` (stopReason + finishReason cho `onFinish`)
  - `available_commands_update`
  - `current_mode_update`
  - `terminal_output`
- `getSessionMessagesPage`: trả về page **`UIMessage[]`**
- `getSessionMessageById`: fallback đọc 1 message theo `messageId` khi miss realtime event

## Điểm tích hợp chính

- `apps/web/src/components/chat-ui/chat-interface.tsx`
  - Upsert `UIMessage` theo id
  - Hiển thị diagnostic empty-state khi session active nhưng chưa có message
  - Tính trạng thái streaming từ `part.state`
  - Đồng bộ status từ `chat_status` (không gate cứng theo `turnId`)
- `apps/web/src/components/chat-ui/chat-messages.tsx`
  - Render các `UIMessagePart`
  - Parse tool output (diff/terminal/content)
  - Hiển thị xác nhận permission theo `data-permission-options`

## Snapshot + Delta contract

- `ui_message`: snapshot đầy đủ, luôn upsert theo `message.id`.
- `ui_message_delta`: append vào `parts[partIndex].text` cho `text/reasoning`.
- Nếu thiếu base message/part khi nhận delta: drop an toàn và chờ snapshot kế tiếp.

## Chat finish (AI SDK compatibility)

`chat_finish` được dùng để map sang `onFinish` của AI SDK:

- `stopReason`: ACP stopReason (`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`)
- `finishReason`: đã map theo AI SDK (`stop` | `length` | `content-filter` | `tool-calls` | `other`)
- `messageId`: id message assistant hoàn tất
- `message` (optional): UIMessage tương ứng nếu server có trong cache
- `isAbort`: true khi stopReason = `cancelled`

Client nên fallback lấy message theo `messageId` nếu `message` không có.

## Render UIMessagePart

- `text` / `reasoning` → Message/Reasoning UI
- `tool-*` → Tool UI
  - `tool-plan` + `output.entries` → Plan
- `source-url` / `source-document` / `file` → badge/link
- `data-*` → metadata (không render trực tiếp)
  - `data-tool-locations` → follow-along theo `toolCallId` + `locations` (optional)

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
