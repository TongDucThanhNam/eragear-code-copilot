# ACP Permission Required Live Bug Handoff

Ngày ghi nhận: 2026-03-06

## Mục tiêu

Bug cần fix:

- Khi ACP agent đang stream và chuyển sang `awaiting_permission`, web app **không**
  mở dialog `Permission required` ngay.
- User phải `F5` thì dialog mới hiện.

Đây là bug của **live event path**, không phải chỉ là bug render của
`permission-dialog.tsx`.

## Triệu chứng đã xác nhận

### Live path trước khi `F5`

Log browser cho thấy:

- client đang `streaming`
- nhận `chat_status: awaiting_permission`
- nhận 2 `ui_message_part` cho cùng assistant message
  - 1 part có `partId: tool:f30acd38884b7625`
  - 1 part có `partId: permission:def520cc08871107`
- nhưng `nextPendingRequestId` vẫn là `null`
- `resolved pending permission sources` vẫn là `none`

Nói ngắn:

- **permission delta đã tới browser**
- nhưng client state **không dựng được** `pendingPermission`

### Sau khi `F5`

Log browser cho thấy:

- bootstrap/reconnect path nhận lại các `ui_message` snapshot
- cùng turn đó có nhiều assistant message:
  - `msg-9a626608-9fee-4b65-ab4e-ccde047d297d`
  - `msg-9ff40a4f-9b31-4b69-b8a6-ead721840102`
  - `msg-c1f55a09-d472-4580-9774-1938afca9145`
- `pendingPermission` chỉ materialize khi snapshot `ui_message` của
  `msg-c1f55a09-d472-4580-9774-1938afca9145` được upsert
- sau đó dialog mở đúng

Nói ngắn:

- **replay/snapshot path dựng được permission**
- **live part-update path không dựng được permission**

## Kết luận chắc chắn từ log

Những điều đã được chứng minh:

1. Server live stream có phát `chat_status: awaiting_permission`.
2. Server live stream có phát `ui_message_part` liên quan permission.
3. Browser có nhận các part event đó.
4. `PermissionDialog` không tự mở vì `pendingPermission` vẫn là `null`.
5. Sau refresh, `ui_message` snapshot đầy đủ của assistant message chứa permission
   thì `pendingPermission` mới được dựng.

Những điều **chưa** được chứng minh:

1. Chưa chứng minh chắc chắn server live payload sai shape.
2. Chưa chứng minh chắc chắn client `applyPartUpdate` là thủ phạm duy nhất.
3. Chưa chứng minh vì sao cùng turn lại có 3 assistant messages là expected hay bug.

## Điều đã bị loại khỏi nghi phạm chính

Các hướng đã bị loại ít nhất ở mức first-order:

- `apps/web/src/components/chat-ui/permission-dialog.tsx`
  - dialog mở bình thường khi `pendingPermission` có giá trị
- thuần history/DB rebuild
  - refresh path đang hoạt động
- thuần Zustand selector loop
  - lỗi infinite loop đã được xử trước đó, không còn là blocker chính

## Flow chuẩn cần xảy ra

### Server side

1. Agent đang stream assistant response.
2. Agent gọi permission request.
3. Server flush throttled parts.
4. Server emit:
   - `chat_status: awaiting_permission`
   - `ui_message_part` chứa `tool-*` với `state: approval-requested`
   - `ui_message_part` chứa `data-permission-options`
5. Client apply 2 part updates đó vào đúng `UIMessage`.
6. `findPendingPermission(...)` phải trả về request.
7. `ChatInterface` mở dialog.

### Refresh/bootstrap path

1. Client reconnect.
2. Subscription bootstrap replay `ui_message` snapshot từ runtime.
3. Client upsert full snapshot.
4. `findPendingPermission(...)` thấy permission request.
5. Dialog mở.

## Flow thực tế đang hỏng

### Live path hiện tại

1. `chat_status: awaiting_permission` tới.
2. `ui_message_part(tool approval-requested)` tới.
3. `ui_message_part(data-permission-options)` tới.
4. `findPendingPermission(...)` vẫn trả `null`.
5. Dialog không mở.

### Refresh path

1. bootstrap replay nhiều `ui_message` snapshot
2. snapshot message cuối cùng `msg-c1f55a09-d472-4580-9774-1938afca9145`
   dựng được permission
3. `pendingPermission` có giá trị
4. dialog mở

## Điểm bất thường quan trọng

### 1. Permission thuộc về assistant message `msg-c1f55...`

Trước refresh, live part events đều gắn vào:

- `messageId: msg-c1f55a09-d472-4580-9774-1938afca9145`

Sau refresh, permission cũng chỉ materialize khi snapshot của chính message này tới.

Điều đó cho thấy:

- bug không phải request id mismatch ngẫu nhiên
- bug xoay quanh **cách live client dựng message `msg-c1f55...`**

### 2. Cùng một turn có nhiều assistant messages

Sau refresh, cùng `turn-a6c32388-f147-49e6-9bbe-60d6920a974b` có ít nhất 3
assistant messages:

- `msg-9a626608-...`
- `msg-9ff40a4f-...`
- `msg-c1f55a09-...`

Agent khác cần xác minh:

- đây là behavior expected của runtime
- hay là bug server khiến permission bị gắn sang assistant message mới mà live
  client chưa bootstrap đầy đủ

### 3. Có dấu hiệu bug thứ hai sau khi dialog đã mở

Trong refresh path:

- `pendingPermission` đã có giá trị
- dialog đã mở
- sau đó `resolved pending permission sources` lại quay về `none`
- dialog đóng
- rồi mới có thêm `ui_message_part` permission tới sau

Tức là có khả năng tồn tại **bug thứ hai**:

- permission state bị clear sau khi đã detect thành công
- có thể do snapshot merge, late event, hoặc state overwrite

## Giả thuyết ưu tiên cho agent tiếp theo

### Hypothesis A: live `ui_message_part` đang được apply sai vào local message

Triệu chứng phù hợp:

- event tới đúng `messageId`
- nhưng `nextPendingRequestId` vẫn `null`

Khả năng cụ thể:

- local message `msg-c1f55...` tồn tại nhưng parts không được cập nhật đúng
- `partIndex` hoặc part ordering drift
- `tool approval-requested` part không thực sự nằm trong `message.parts`
  sau `applyPartUpdate`
- hoặc `data-permission-options` part bị append vào sai message / sai index

### Hypothesis B: message `msg-c1f55...` chưa có mặt đầy đủ trên live path

Triệu chứng phù hợp:

- refresh path thấy full snapshot của `msg-c1f55...`
- live path chỉ thấy part events của nó

Cần kiểm tra:

- message này có được tạo live trước khi permission part tới không
- nếu không, tại sao `applyPartUpdate` không tạo/recover message đủ để
  `findPendingPermission(...)` thấy request

### Hypothesis C: server live path đang attach permission vào assistant message mới

Refresh log cho thấy permission request nằm trên assistant snapshot 4 parts của
`msg-c1f55...`, trong khi live UI trước đó vẫn đang có 6 messages rồi mà không detect.

Cần kiểm tra:

- `currentAssistantId`
- `buffer.messageId`
- thời điểm `permission.ts` gọi `upsertToolPart(...)`
- có đang gắn permission vào assistant message mới khác message stream hiện tại không

### Hypothesis D: permission bị detect rồi lại bị clear bởi late overwrite

Refresh path có log cho thấy dialog mở rồi lại đóng.

Cần kiểm tra:

- event nào ngay sau đó làm `pendingPermission` về `null`
- `ui_message`
- `ui_message_part`
- `loadHistory`
- state replace trong store

## File map theo tầng

### Web: subscription, normalize, state assembly

- `apps/web/src/hooks/use-chat-subscription.ts`
  - nhận event từ tRPC subscription
- `apps/web/src/hooks/use-chat-normalize.ts`
  - parse/sanitize broadcast event
- `apps/web/src/hooks/use-chat-session-event-handler.ts`
  - orchestration cho từng session event
  - có log `processed permission-related session event`
- `apps/web/src/hooks/use-chat-message-state.ts`
  - `mergeMessagesIntoState`
  - `applyPartUpdate`
  - hotspot lớn nhất phía client
- `apps/web/src/hooks/use-chat-history.ts`
  - merge history snapshot vào client state
- `apps/web/src/hooks/use-chat.ts`
  - resolve `pendingPermissionFromMessages ?? transientPendingPermission`
- `apps/web/src/store/chat-stream-store.ts`
  - canonical message state per chat

### Web: UI

- `apps/web/src/components/chat-ui/chat-interface.tsx`
  - dialog open/close logic
  - gate `activePendingPermission`
- `apps/web/src/components/chat-ui/permission-dialog.tsx`
  - dialog render
- `apps/web/src/components/chat-ui/chat-messages.tsx`
  - render tool/data parts

### Shared: permission detection and schemas

- `packages/shared/src/chat/use-chat-core.ts`
  - `findPendingPermission`
  - `getPermissionOptions`
  - `processSessionEvent`
- `packages/shared/src/ui-message.ts`
  - `UIMessage`, `ToolUIPart`, `DataUIPart`
- `packages/shared/src/chat/event-schema.ts`
  - client-safe event parsing schema

### Server: permission emission

- `apps/server/src/platform/acp/permission.ts`
  - create permission UI state
  - emit `awaiting_permission`
  - emit tool approval part + permission options part
- `apps/server/src/platform/acp/ui-message-part.ts`
  - canonical part broadcast helper
- `apps/server/src/shared/utils/ui-message-part-event.util.ts`
  - build `ui_message_part`
  - assign `partId`

### Server: assistant message construction

- `apps/server/src/platform/acp/update-stream.ts`
  - stream assistant text/reasoning chunks
  - chooses assistant `messageId`
- `apps/server/src/platform/acp/update-buffer.ts`
  - `buffer.ensureMessageId(...)`
- `apps/server/src/shared/utils/ui-message/state.ts`
  - `getOrCreateAssistantMessage`
  - `upsertToolPart`
- `apps/server/src/platform/acp/update.ts`
  - finalize/flush path around assistant streaming

### Server: subscription bootstrap/replay

- `apps/server/src/modules/session/application/subscribe-session-events.service.ts`
  - builds buffered `ui_message` snapshots for reconnect / late subscriber

### Tests có giá trị tham chiếu

- `apps/server/src/platform/acp/permission.e2e.test.ts`
  - app-flow e2e cho permission live + late subscriber
- `apps/server/src/platform/acp/permission.test.ts`
  - server emits permission via `ui_message_part`
- `apps/web/src/hooks/use-chat-message-state.test.ts`
  - message/part merge behavior
- `apps/web/src/hooks/use-chat-session-event-handler.test.ts`
  - status/event reconciliation
- `packages/shared/src/chat/use-chat-core.test.ts`
  - `findPendingPermission`

## Log instrumentation đã có sẵn

Enable:

```js
localStorage.setItem("ERAGEAR_DEBUG_CHAT", "1");
location.reload();
```

Disable:

```js
localStorage.removeItem("ERAGEAR_DEBUG_CHAT");
location.reload();
```

Các log chính:

- `[ChatDebug:permission] processed permission-related session event`
- `[ChatDebug:permission] resolved pending permission sources`
- `[ChatDebug:permission] chat interface opening permission dialog`
- `[ChatDebug:permission] chat interface closing permission dialog`
- `[ChatDebug:permission] history snapshot merged into client state`

## Thứ tự debug đề xuất cho agent tiếp theo

1. Kiểm tra live browser state ngay sau 2 `ui_message_part` permission tới.
   Mục tiêu:
   xác nhận `messageState.byId.get("msg-c1f55...")?.parts` thực tế có chứa
   `tool-* approval-requested` và `data-permission-options` hay không.

2. Nếu parts không có:
   debug `applyPartUpdate(...)` ở web.
   Điểm cần in:
   - `messageId`
   - `partIndex`
   - `partId`
   - `isNew`
   - `existing.parts`
   - `nextParts`

3. Nếu parts có nhưng `pendingPermission` vẫn `null`:
   debug `findPendingPermission(...)` và `getPermissionOptions(...)`.
   Đặc biệt check:
   - tool part có đúng `state: approval-requested`
   - tool part có `approval.id`
   - options part có nằm cùng `UIMessage` không

4. Nếu live path không có message `msg-c1f55...` đúng lúc:
   debug server side:
   - `currentAssistantId`
   - `buffer.messageId`
   - `upsertToolPart(...)`
   - `subscribe-session-events.service.ts` replay order

5. Sau khi fix live detection, chạy tiếp case secondary:
   permission đã detect rồi nhưng bị clear lại về `none`.

## Tóm tắt ngắn cho agent khác

Bug hiện tại không nằm ở dialog component.

Điểm hỏng là:

- live path nhận `chat_status awaiting_permission`
- live path nhận permission-related `ui_message_part`
- nhưng client không dựng được `pendingPermission`
- refresh path nhận full `ui_message` snapshot thì dựng được

Hotspot số 1:

- `apps/web/src/hooks/use-chat-message-state.ts`

Hotspot số 2:

- `apps/server/src/platform/acp/permission.ts`
- `apps/server/src/platform/acp/update-stream.ts`
- `apps/server/src/modules/session/application/subscribe-session-events.service.ts`

Nếu cần bắt đầu nhanh nhất, hãy instrument trực tiếp state của
`msg-c1f55a09-d472-4580-9774-1938afca9145` ngay sau 2 `ui_message_part` live
events tới browser.
