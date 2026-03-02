# Chuẩn hóa UIMessage (Server)

Tài liệu mô tả cách server chuyển ACP updates sang UIMessage (AI SDK UI) trước
khi broadcast cho client. Mục tiêu là để web/native dùng chung một chuẩn dữ
liệu, không phải tự parse raw ACP.

## Mục tiêu

- Một nguồn dữ liệu thống nhất: `UIMessage` + `UIMessagePart`
- Client chỉ cần **upsert theo `message.id`**, không xử lý raw ACP
- Quy tắc stream/tool/permission nằm ở server (single source of truth)

## Luồng dữ liệu

1. ACP gửi update/permission
2. `platform/acp/update.ts` + `platform/acp/permission.ts` xử lý
3. `shared/utils/ui-message.util.ts` map sang UIMessagePart
4. `SessionRuntimeStore.broadcast` phát `ui_message`

## BroadcastEvent (từ server)

- `ui_message`: sự kiện chính, chứa UIMessage đã chuẩn hóa
- `ui_message_part`: part-level update đã hoàn chỉnh (`messageId` + `partIndex` + `isNew`)
- `chat_status`: trạng thái chat (`inactive` | `connecting` | `ready` | `submitted` | `streaming` | `awaiting_permission` | `cancelling` | `error`)
- `chat_finish`: stopReason + finishReason (map theo AI SDK UI)
- `available_commands_update`: danh sách slash commands
- `current_mode_update`: mode hiện tại
- `terminal_output`: stream output cho terminal
- `connected`, `heartbeat`, `error`

Ghi chú tương thích:

- `ui_message_delta` vẫn còn trong schema để tương thích client cũ, nhưng
  không còn là stream primitive của server path canonical.

## Quy tắc upsert

- `UIMessage.id` là khóa chính, client **phải upsert theo id**
- `UIMessage.createdAt` (unix ms) là khóa sắp xếp chuẩn; client không dựa vào thứ tự SSE arrival
- Server giữ `UiMessageState`:
  - `currentAssistantId/currentUserId` cho streaming
  - `toolPartIndex` để update tool part theo `toolCallId`

## Resume Source Of Truth

- Khi resume thành công và có replay/runtime history, server coi runtime là
  nguồn tạm thời để stream realtime.
- Sau bootstrap, server persist snapshot chuẩn bằng `replaceMessages(...)` để
  DB phản ánh đúng state mới nhất của ACP session.
- Client chỉ cần upsert theo `message.id`; không tự reconcile raw chunks.

## Mapping ACP → UIMessage

- `user_message_chunk` → `UIMessage(role=user)` + text part
- `agent_message_chunk` → buffer theo chunk, chỉ emit khi text part hoàn chỉnh
- `agent_thought_chunk` → buffer theo chunk, chỉ emit khi reasoning part hoàn chỉnh
- `tool_call` → `ToolUIPart(type=tool-${name})` + `state=input-streaming|input-available`
- `tool_call_update` → `ToolUIPart(state=output-available|output-error)`
- `plan` → `ToolUIPart(type=tool-plan, output={ entries[] })`
- `request_permission` → `ToolUIPart(state=approval-requested)` + `data-permission-options`
- `_meta`/`annotations` → `providerMetadata` (Text/Reasoning/Source/File) và `callProviderMetadata` (Tool)
- `tool_call`/`tool_call_update` có `locations` → `data-tool-locations`

## Mapping ContentBlock → UIMessagePart

- `text` → `TextUIPart`
- `resource_link` → `SourceUrlUIPart`
- `resource` → `SourceDocumentUIPart` + `DataUIPart(type=data-resource)`
- `image/audio` → `FileUIPart` (URL hoặc data URL)

## Reasoning: Coalescing + Interleaved Thinking

Mục tiêu là gộp các reasoning chunk liền nhau thành một part ổn định, tránh tạo
nhiều part nhỏ do `state` bị đổi trong quá trình stream.

- Coalescing rule: nếu `part` cuối cùng là `reasoning` thì **luôn gộp** chunk mới
  vào part đó, không phụ thuộc `state` trước đó.
- Khi gộp, `part.state` được cập nhật theo `state` mới nhất của chunk (thường là
  `streaming` rồi về `done` ở `turn_end`).
- Interleaved thinking là behavior đúng: nếu có `tool-*` hoặc `text` xen vào giữa,
  reasoning tiếp theo sẽ tạo part mới vì part cuối đã không còn là reasoning.
- Nếu thấy reasoning bị tách thành nhiều part nhỏ liên tiếp (mỗi part 1 chunk),
  kiểm tra ngay `appendReasoningPart` trong `apps/server/src/shared/utils/ui-message.util.ts`.

## Reasoning: Broadcast Streaming

- `agent_thought_chunk` được append vào UIMessage và broadcast realtime khi
  `isReplayingHistory === false`.
- Khi replay history, reasoning sẽ được gộp vào message và chỉ broadcast khi
  `turn_end` flush.

## Tool output

`ToolUIPart.output` nhận `ToolCallContent[]` (content/diff/terminal) đã được
normalize JSON. Live terminal output vẫn stream qua event `terminal_output`.

## Data parts (metadata)

- `data-permission-options`:
  - `{ requestId, toolCallId, options }`
- `data-resource`:
  - `{ uri, mimeType, text?, blob?, _meta?, annotations?, resourceMeta? }`
- `data-tool-locations`:
  - `{ toolCallId, locations }`

## Điểm chỉnh sửa chính

- `apps/server/src/shared/utils/ui-message.util.ts`
- `apps/server/src/platform/acp/update.ts`
- `apps/server/src/platform/acp/permission.ts`
- `apps/server/src/modules/ai/application/send-message.service.ts`
- `apps/server/src/modules/session/application/create-session.service.ts`

## Lỗi thường gặp & hướng xử lý

- Reasoning bị chia nhỏ thành nhiều part liên tiếp: kiểm tra điều kiện merge
  trong `appendReasoningPart` và đảm bảo không phụ thuộc `state`.
- Reasoning không realtime khi stream: đảm bảo `agent_thought_chunk` được
  broadcast trong `handleBufferedMessage`.
- Reasoning mất dữ liệu khi reload: kiểm tra `turn_end` có đến hay không, vì
  persistence chỉ xảy ra khi buffer flush ở `turn_end`/`prompt_end`.
- Tool part không cập nhật đúng: kiểm tra `toolPartIndex` trong `UiMessageState`
  và logic `upsertToolPart`.

## Checklist xác minh

- UI chỉ tạo nhiều reasoning part khi có phần xen kẽ `tool-*`/`text`, không tạo
  nhiều reasoning part liên tiếp từ cùng một stream.
- SQLite (`sessions` + `session_messages`) lưu reasoning gộp đúng theo `reasoningBlocks`.
- `ui_message` luôn chứa `parts` theo đúng thứ tự stream, không có raw ACP.

## Lưu ý

- Không broadcast `session_update`/raw ACP xuống client.
- Nếu thêm UIMessagePart mới, update mapping + docs client tương ứng.
