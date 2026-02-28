# ACP Chat Protocol (Server) — Spec v2

Tài liệu này định nghĩa protocol cấp server cho chat dựa trên ACP. Mục tiêu là
client có thể build một `useChat` theo phong cách AI SDK chỉ bằng tRPC calls +
`onSessionEvents`, không cần parse raw ACP.

## 1) Scope

- **Server**: chịu trách nhiệm ACP session lifecycle, mapping ACP → UIMessage,
  và phát stream events.
- **Client**: chỉ consume tRPC endpoints + events trong tài liệu này.
- **Không** expose raw ACP xuống client.

## 2) Versioning

- Spec version: **v2** (tài liệu này).
- v2 mở rộng `ChatStatus` để phản ánh session lifecycle + prompt turn.
- Mọi thay đổi breaking phải bump v3 và giữ backward compatibility tối đa.

## 3) Core Concepts

### 3.1 Identifiers

- `chatId`: ID của session runtime (RAM) — primary key cho mọi call.
- `sessionId`: ACP session ID (agent side) — internal, không bắt buộc client dùng.

### 3.2 UIMessage

- Server luôn broadcast `UIMessage` đã chuẩn hóa.
- Client **phải upsert theo `message.id`** (single source of truth).
- `UIMessagePart` là các phần hiển thị. `data-*` parts là metadata (có thể bỏ qua).

### 3.3 BroadcastEvent

Server stream qua `onSessionEvents`:

- `connected`: xác nhận subscribe thành công
- `chat_status`: trạng thái toàn cục (`inactive` | `connecting` | `ready` | `submitted` | `streaming` | `awaiting_permission` | `cancelling` | `error`)
- `chat_finish`: kết thúc 1 turn (để map sang `onFinish` kiểu AI SDK)
- `ui_message`: message updates (streaming + tool updates)
- `ui_message_part`: part-level updates (`messageId` + `partIndex` + `part` + `isNew`)
- `ui_message_delta`: incremental text/reasoning append (`messageId` + `partIndex` + `delta`)
- `file_modified`
- `available_commands_update`
- `config_options_update`
- `session_info_update`
- `current_mode_update`
- `terminal_output`
- `heartbeat` (reserved/optional, currently not emitted by runtime pipeline)
- `error`

### 3.4 ChatStatus

- `inactive`: session không chạy (chỉ có history hoặc đã bị ngắt)
- `connecting`: client đang khởi tạo/resume ACP session
- `ready`: session đang chạy, idle và sẵn sàng nhận prompt
- `submitted`: client vừa gửi prompt, đang chờ stream
- `streaming`: server đang nhận updates (message/tool/plan)
- `awaiting_permission`: đang chờ user approve tool call
- `cancelling`: client đã gửi cancel, đang chờ prompt kết thúc
- `error`: session lỗi hoặc agent chết

### 3.5 ChatFinish

`chat_finish` được tạo khi server đã có `stopReason`. `messageId`/`message` có
thể không có trong một số case (ví dụ prompt bị cancel sớm hoặc không có
assistant output hợp lệ).
Payload:

- `stopReason`: ACP StopReason (`end_turn`, `max_tokens`, `max_turn_requests`,
  `refusal`, `cancelled`)
- `finishReason`: map theo AI SDK
  - `end_turn` → `stop`
  - `max_tokens` → `length`
  - `max_turn_requests` → `tool-calls`
  - `refusal` → `content-filter`
  - `cancelled` → `other`
- `messageId` (optional): assistant message id đã hoàn tất
- `message` (optional): UIMessage nếu server cache được
- `isAbort`: true khi stopReason = `cancelled`

Client có thể fallback bằng cách lookup `messageId` trong state nếu `message` thiếu.

## 4) tRPC Procedures (Contract)

### 4.1 Session Lifecycle

- `createSession({ projectId, agentId? })` →
  - `chatId`, `sessionId`
  - `modes`, `models`
  - `promptCapabilities`
  - `loadSessionSupported`
  - `agentInfo`

- `resumeSession({ chatId })` → resume ACP session theo metadata đã lưu
- `stopSession({ chatId })` → stop agent process + update status
- `deleteSession({ chatId })` → remove stored session
- `getSessionState({ chatId })` → current status, modes, models, commands,
  promptCapabilities, loadSessionSupported, supportsModelSwitching, agentInfo, plan
- `getSessionMessagesPage({ chatId, cursor?, limit?, includeCompacted? })` →
  `{ messages: UIMessage[], nextCursor?, hasMore }` (**primary history API**)
- `getSessionMessageById({ chatId, messageId })` → `{ message?: UIMessage }`
  (fallback read path for missed realtime `ui_message` event)
- `onSessionEvents({ chatId })` → stream `BroadcastEvent`

### 4.2 Prompt / Mode / Model

- `sendMessage({ chatId, text, images?, audio?, resources?, resourceLinks? })` →
  - `stopReason`
  - `finishReason`
  - `assistantMessageId`
  - `userMessageId`

- `cancelPrompt({ chatId })` → ACP `session/cancel`
- `setMode({ chatId, modeId })`
- `setModel({ chatId, modelId })`

### 4.3 Tool Permission

- `respondToPermissionRequest({ chatId, requestId, decision })`
  - resolve pending permission request

## 5) Event Stream Semantics

### 5.1 Order guarantees

- `connected` luôn là event đầu tiên.
- Snapshot `chat_status` được emit ngay sau `connected` (kèm `turnId` nếu có
  active turn).
- Server replay `messageBuffer` sau snapshot nhưng **không replay historical
  `chat_status`/`chat_finish`** để tránh stale transition sau reconnect.
- `chat_status` được emit khi status đổi.
- Trước khi emit snapshot, server có thể reconcile trạng thái busy bị stale:
  nếu không còn active turn và không còn pending permission thì chuyển về
  `ready`.

### 5.2 ui_message + ui_message_part + ui_message_delta updates

Server đảm nhiệm:

- merge message chunks theo `message.id`
- tool parts update theo `toolCallId`
- finalize streaming parts khi `turn_end`/`prompt_end`
- emit `ui_message_part` làm primitive stream chính cho text/reasoning/tool/metadata
  updates (part-level surgical updates)
- emit `ui_message_delta` cho append text/reasoning để giảm payload, và fallback
  `ui_message_part`/`ui_message` snapshot khi không thể đảm bảo delta target hợp lệ

Client contract:

- `ui_message`: upsert full snapshot theo `message.id`
- `ui_message_part`: apply theo `messageId` + `partIndex` + `isNew`; nếu không apply
  được thì bỏ qua an toàn và chờ snapshot kế tiếp
- `ui_message_delta`: chỉ apply khi đã có message + part target tương ứng
- Nếu delta không apply được (missing base message/part), bỏ qua delta và chờ
  snapshot kế tiếp (idempotent)

### 5.3 Permission events

- `request_permission` từ ACP → server broadcast:
  - `ToolUIPart` state `approval-requested`
  - `DataUIPart` `data-permission-options` chứa options
- Client trả lời qua `respondToPermissionRequest`.

### 5.4 Tool calls

- `tool_call` / `tool_call_update` → `ToolUIPart` state:
  - `input-streaming`, `input-available`, `output-available`, `output-error`,
    `approval-requested`, `approval-responded`, `output-denied`
- `data-tool-locations` được gửi nếu có `locations`.

### 5.5 Terminal output

- `terminal_output` event: `{ terminalId, data }`
- Tool output chỉ chứa metadata; stream log luôn đi qua event này.

## 6) State Machine (ChatStatus)

```
INACTIVE → (resume/create) → CONNECTING → READY
READY → (sendMessage) → SUBMITTED → STREAMING → READY
STREAMING → (request_permission) → AWAITING_PERMISSION → STREAMING
SUBMITTED/STREAMING/AWAITING_PERMISSION → (cancelPrompt) → CANCELLING → READY
READY → (stopSession) → INACTIVE
ANY → (error) → ERROR
```

Notes:
- `STREAMING` có thể đến từ tool/plan updates ngay cả khi chưa có text chunks.
- Khi prompt kết thúc, server phải thoát khỏi mọi busy status hợp lệ
  (`submitted` | `streaming` | `awaiting_permission` | `cancelling`) để về
  `ready` trừ khi session đã vào `error`/`inactive`.
- `ERROR` nghĩa là session mất khả năng xử lý tiếp; client nên disable input.

## 7) Resume / Replay

- `resumeSession` dùng stored `chatId` để load ACP session.
- Server sẽ replay stored history nếu agent không replay.
- Client nên gọi `getSessionMessagesPage` cho read-only view hoặc seed UI.

## 8) Invariants (Must hold)

- Client **không parse raw ACP**.
- Client **upsert theo `message.id`**.
- `data-*` parts là metadata (safe to ignore).
- Protocol không phụ thuộc UI framework.

## 9) Extensibility

- `_meta` / `annotations` được map vào `providerMetadata` và
  `callProviderMetadata`.
- Client phải ignore unknown `UIMessagePart` types.
- Nếu thêm event mới → giữ backward compatibility.

### 9.1 Client compatibility rules (normative)

- Unknown event type: client **phải ignore an toàn** và tiếp tục stream.
- Known event type nhưng payload sai schema: client **phải drop event đó**,
  log warning, và tiếp tục stream (không được crash subscription).
- `ui_message` / `chat_finish.message`: nếu có unknown `UIMessagePart`, client
  **phải drop unknown part** và giữ lại phần hợp lệ để maintain continuity.

## 10) Client Checklist (useChat)

Checklist này giúp client tự kiểm tra đã implement đủ chức năng để tương thích
với `apps/server`.

### 10.1 Core Data Flow

- [ ] Subscribe `onSessionEvents({ chatId })` và xử lý `connected` + replay buffer.
- [ ] Upsert `UIMessage` theo `message.id` (không append thẳng).
- [ ] Hỗ trợ `ui_message_part` để update từng part theo `messageId` + `partIndex`
      + `isNew`.
- [ ] Hỗ trợ `ui_message_delta` bằng cách append vào đúng `messageId` +
      `partIndex`; nếu thiếu base message/part thì drop delta an toàn.
- [ ] `getSessionMessagesPage({ chatId, cursor? })` loop tới khi `hasMore=false`
      để seed read-only.
- [ ] Bỏ qua `data-*` parts an toàn (metadata).

### 10.2 Chat Status & Finish

- [ ] Map `chat_status` → UI state (`inactive` | `connecting` | `ready` | `submitted` | `streaming` | `awaiting_permission` | `cancelling` | `error`).
- [ ] Không drop `chat_status` chỉ vì `turnId` mismatch; status là session-level snapshot.
- [ ] Lắng nghe `chat_finish` để kết thúc turn (onFinish kiểu AI SDK).
- [ ] Có thể gate `chat_finish` theo `turnId` để bỏ qua stale turn completion.
- [ ] `isAbort === true` khi `stopReason === cancelled`.

### 10.3 Send Message

- [ ] `sendMessage({ chatId, text, ... })` nhận response
  `{ stopReason, finishReason, assistantMessageId, userMessageId }`.
  Nếu prompt còn chạy, `stopReason` sẽ là `"submitted"` và client nên
  dựa vào event `chat_finish` để biết kết thúc turn.
- [ ] Nếu agent không hỗ trợ, không gửi `images`/`audio`/`resources`.

### 10.4 Resume / Replay

- [ ] `resumeSession({ chatId })` trước khi subscribe nếu session đã có.
- [ ] Không double-render history: rely vào replay từ server + upsert by id.

### 10.5 Tool Calls & Permissions

- [ ] Render `tool-*` parts theo state:
  - `input-streaming`, `input-available`
  - `approval-requested`, `approval-responded`, `output-denied`
  - `output-available`, `output-error`
- [ ] Lấy options từ `data-permission-options` và gọi
  `respondToPermissionRequest({ chatId, requestId, decision })`.
- [ ] Nếu có `data-tool-locations`, dùng `toolCallId` + `locations` cho follow-along (optional).

### 10.6 Terminal Output

- [ ] `terminal_output` stream log theo `terminalId`.
- [ ] Kết hợp `ToolUIPart.output` (diff/content/terminal) với `terminal_output`.

### 10.7 Mode / Model / Cancel

- [ ] `setMode({ chatId, modeId })` khi agent hỗ trợ modes.
- [ ] `setModel({ chatId, modelId })` khi agent hỗ trợ runtime model switching.
- [ ] `cancelPrompt({ chatId })` để abort turn đang chạy.

### 10.8 Error Handling

- [ ] Handle `error` events và set UI state về error.
- [ ] Disable input khi `chat_status !== ready` hoặc `chat_status === error`.

## 10) References

- `docs/ui-message-normalization.md`
- `docs/acp/*` (ACP overview, prompt turn, tool calls)
