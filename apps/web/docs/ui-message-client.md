# UIMessage client (Web)

Tài liệu mô tả cách web app tiêu thụ `UIMessage` từ server. Client chỉ cần
upsert theo `message.id` và render theo `UIMessagePart`.

## Nguồn dữ liệu

- `onSessionEvents`:
  - `ui_message` (chính)
  - `ui_message_part` (primary stream cho part-level updates)
  - `chat_status` (trạng thái: `inactive` | `connecting` | `ready` | `submitted` | `streaming` | `awaiting_permission` | `cancelling` | `error`)
  - `chat_finish` (stopReason + finishReason cho `onFinish`)
  - `available_commands_update`
  - `current_mode_update`
  - `terminal_output`
- `getSessionMessagesPage`: trả về page **`UIMessage[]`**

## Điểm tích hợp chính

- `apps/web/src/components/chat-ui/chat-interface.tsx`
  - Upsert `UIMessage` theo id
  - Hiển thị diagnostic empty-state khi session active nhưng chưa có message
  - Tính trạng thái streaming từ `part.state`
  - Đồng bộ status từ `chat_status` (không gate cứng theo `turnId`)
  - `error` chỉ dùng cho toast/diagnostic; không tự ép status nếu server chưa phát `chat_status`
- `apps/web/src/components/chat-ui/chat-messages.tsx`
  - Render các `UIMessagePart`
  - Parse tool output (diff/terminal/content)
  - Hiển thị xác nhận permission theo `data-permission-options`

## Snapshot + Part contract

- `ui_message`: snapshot đầy đủ, luôn upsert theo `message.id`.
- `ui_message_part`: apply theo `messageId` + `partIndex` + `isNew`.
  Nếu không apply được thì drop an toàn và chờ snapshot kế tiếp.
- `ui_message_delta`: legacy compatibility event, client mới có thể bỏ qua.

## Resume Sync

- Khi resume, ưu tiên runtime replay và luôn reload DB snapshot sau đó để tránh
  lệch state nếu miss event trong lúc reconnect.
- Flow chuẩn ở web hook:
  - đặt `streamLifecycle=bootstrapping` trước submit/resume
  - clear history window cũ
  - `loadHistory(force=true)` sau resume để đồng bộ canonical snapshot.

## Chat finish (AI SDK compatibility)

`chat_finish` được dùng để map sang `onFinish` của AI SDK:

- `stopReason`: ACP stopReason (`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`)
- `finishReason`: đã map theo AI SDK (`stop` | `length` | `content-filter` | `tool-calls` | `other`)
- `messageId`: id message assistant hoàn tất
- `message` (optional): UIMessage tương ứng nếu server có trong cache
- `isAbort`: true khi stopReason = `cancelled`

Client nên fallback lấy message theo `messageId` nếu `message` không có.
`chat_finish` không được coi là tín hiệu session đã về `ready`; state đó phải
đến từ `chat_status`.

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
Khi turn bị `cancelPrompt`, server sẽ scrub `data-permission-options` và mark
tool part thành `output-cancelled`.

## Tool output & terminal

- `ToolUIPart.output`: `ToolCallContent[]` (content/diff/terminal)
- `terminal_output` stream log theo `terminalId`
- Render thêm terminal state `output-cancelled` như aborted/cancelled, không
  map sang completed hay error.

## Khi thêm part mới

1. Update `chat-messages.tsx` để render
2. Cập nhật parsing output nếu có format mới
3. Đảm bảo `data-*` được bỏ qua an toàn
