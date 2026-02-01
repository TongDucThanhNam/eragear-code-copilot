# UIMessage client (Native)

Tài liệu mô tả cách native app tiêu thụ `UIMessage` đã chuẩn hóa từ server.
Mục tiêu là chỉ xử lý `ui_message` và các event cấp cao, không parse raw ACP.

## Nguồn dữ liệu

- tRPC `onSessionEvents`:
  - `ui_message` (chính)
  - `available_commands_update`
  - `current_mode_update`
  - `terminal_output`
- tRPC `getSessionMessages`: trả về **`UIMessage[]`** (dùng cho read-only)

## Lưu trữ & state

- `useChatStore.messages`: mảng `UIMessage`
- `upsertMessage(message)`: update theo `message.id`
- `pendingPermission` được suy ra từ:
  - `ToolUIPart.state === "approval-requested"`
  - `DataUIPart(type="data-permission-options")` để lấy options

## Render UIMessagePart

`PartRenderers` (đường dẫn: `apps/native/components/chat/chat-message/part-renderers.tsx`)

- `text` → MarkdownText
- `reasoning` → ReasoningPart
- `tool-*` → ToolCallPart + ToolResultPart
- `tool-plan` + `output.entries` → PlanPart
- `source-url` / `source-document` / `file` → badge/link
- `step-start` → separator
- `data-*` → **bỏ qua** (metadata)

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

## Khi thêm part mới

1. Update `part-renderers.tsx` + `utils.getPartKey`
2. Nếu cần xuất hiện trong activity, update `agentic-activity.tsx`
3. Nếu có metadata, dùng `data-*` để client có thể bỏ qua an toàn
