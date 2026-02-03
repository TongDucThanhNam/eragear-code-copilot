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
2. `infra/acp/update.ts` + `infra/acp/permission.ts` xử lý
3. `shared/utils/ui-message.util.ts` map sang UIMessagePart
4. `SessionRuntimeStore.broadcast` phát `ui_message`

## BroadcastEvent (từ server)

- `ui_message`: sự kiện chính, chứa UIMessage đã chuẩn hóa
- `chat_status`: trạng thái chat (`inactive` | `connecting` | `ready` | `submitted` | `streaming` | `awaiting_permission` | `cancelling` | `error`)
- `chat_finish`: stopReason + finishReason (map theo AI SDK UI)
- `available_commands_update`: danh sách slash commands
- `current_mode_update`: mode hiện tại
- `terminal_output`: stream output cho terminal
- `connected`, `heartbeat`, `error`

## Quy tắc upsert

- `UIMessage.id` là khóa chính, client **phải upsert theo id**
- Server giữ `UiMessageState`:
  - `currentAssistantId/currentUserId` cho streaming
  - `toolPartIndex` để update tool part theo `toolCallId`

## Mapping ACP → UIMessage

- `user_message_chunk` → `UIMessage(role=user)` + `TextUIPart(state=streaming)`
- `agent_message_chunk` → `UIMessage(role=assistant)` + `TextUIPart(state=streaming)`
- `agent_thought_chunk` → `ReasoningUIPart(state=streaming)`
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
- `apps/server/src/infra/acp/update.ts`
- `apps/server/src/infra/acp/permission.ts`
- `apps/server/src/modules/ai/application/send-message.service.ts`
- `apps/server/src/modules/session/application/create-session.service.ts`

## Lưu ý

- Không broadcast `session_update`/raw ACP xuống client.
- Nếu thêm UIMessagePart mới, update mapping + docs client tương ứng.
