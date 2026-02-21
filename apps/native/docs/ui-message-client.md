# UIMessage client (Native)

Tài liệu mô tả cách native app tiêu thụ `UIMessage` đã chuẩn hóa từ server.
Mục tiêu là chỉ xử lý `ui_message` và các event cấp cao, không parse raw ACP.

## Nguồn dữ liệu

- tRPC `onSessionEvents`:
  - `ui_message` (chính)
  - `ui_message_delta` (append incremental cho text/reasoning)
  - `chat_status` (trạng thái: `inactive` | `connecting` | `ready` | `submitted` | `streaming` | `awaiting_permission` | `cancelling` | `error`)
  - `chat_finish` (stopReason + finishReason cho `onFinish`)
  - `available_commands_update`
  - `current_mode_update`
  - `terminal_output`
- tRPC `getSessionMessages`: trả về **`UIMessage[]`** (dùng cho read-only)

## Lưu trữ & state

- `useChatStore.messageIds`: thứ tự message id
- `useChatStore.messagesById`: map `messageId -> UIMessage`
- `upsertMessage(message)`: update theo `message.id` (map + id list)
- `ui_message_delta`: append theo `messageId` + `partIndex` cho `text/reasoning`;
  nếu không apply được thì drop an toàn và chờ snapshot kế tiếp
- `pendingPermission` được suy ra từ:
  - `ToolUIPart.state === "approval-requested"`
  - `DataUIPart(type="data-permission-options")` để lấy options
- `useChatStore.status` nên lấy từ `chat_status`

## Chat finish (AI SDK compatibility)

`chat_finish` được dùng để map sang `onFinish` của AI SDK:

- `stopReason`: ACP stopReason (`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`)
- `finishReason`: đã map theo AI SDK (`stop` | `length` | `content-filter` | `tool-calls` | `other`)
- `messageId`: id message assistant hoàn tất
- `message` (optional): UIMessage tương ứng nếu server có trong cache
- `isAbort`: true khi stopReason = `cancelled`

Client nên fallback lấy message theo `messageId` nếu `message` không có.

## Render UIMessagePart

`PartRenderers` (đường dẫn: `apps/native/components/chat/chat-message/part-renderers.tsx`)

- `text` → MarkdownText
- `reasoning` → ReasoningPart
- `tool-*` → ToolCallPart + ToolResultPart
- `tool-plan` + `output.entries` → PlanPart
- `source-url` / `source-document` / `file` → badge/link
- `step-start` → separator
- `data-*` → **bỏ qua** (metadata)
  - `data-tool-locations` → follow-along theo `toolCallId` + `locations` (optional)

## Tool output

`ToolResultDisplay` xử lý `ToolCallContent[]`:

- `content` → render ContentBlock (text/resource/resource_link/image/audio)
- `diff` → DiffPart
- `terminal` → TerminalPart (data lấy từ `terminal_output`)

## Streaming & haptics

- Streaming xác định bằng `part.state`:
  - `text/reasoning`: `state === "streaming"`
  - `tool-*`: `input-streaming`, `input-available`, `approval-*`
- Haptics chỉ bắn khi message chuyển từ streaming → done.
- Có thể dùng `chat_status` để đồng bộ trạng thái UI tổng thể.

## Khi thêm part mới

1. Update `part-renderers.tsx` + `utils.getPartKey`
2. Nếu cần xuất hiện trong Chain of Thought, update `agentic-chain.tsx`
3. Nếu có metadata, dùng `data-*` để client có thể bỏ qua an toàn
