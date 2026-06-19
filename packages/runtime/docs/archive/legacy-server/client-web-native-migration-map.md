# Client Migration Map (Web + Native)

Mục tiêu: cập nhật client theo backend mới bằng cách đọc đúng file nguồn, không
phải lần toàn bộ codebase.

## 1. Đọc theo thứ tự này

1. Contract server (API + event):
   - `src/transport/trpc/routers/session.ts`
   - `src/transport/trpc/routers/ai.ts`
   - `src/transport/trpc/routers/tool.ts`
   - `src/shared/types/session.types.ts`
2. UI message normalization:
   - `src/platform/acp/update.ts`
   - `src/platform/acp/update-stream.ts`
   - `src/platform/acp/update-tool.ts`
   - `src/platform/acp/permission.ts`
3. Shared client core (web + native dùng chung):
   - `packages/shared/src/chat/types.ts`
   - `packages/shared/src/chat/use-chat-core.ts`
4. App adapters:
   - Web: `apps/web/src/hooks/use-chat.ts`
   - Native: `apps/native/hooks/use-chat.ts`, `apps/native/store/chat-store.ts`

## 2. Breaking Changes Cần Update Trước

1. History API đã dùng phân trang:
   - Dùng `getSessionMessagesPage`, không dùng `getSessionMessages`.
   - Contract: `src/transport/trpc/routers/session.ts`, `src/modules/session/application/get-session-messages.service.ts`.
2. `sendMessage` trả thêm `turnId` để correlate theo turn:
   - Contract: `src/modules/ai/application/send-message/send-message.types.ts`.
3. Permission options đi qua `data-permission-options` trong `ui_message`:
   - Logic server: `src/platform/acp/permission.ts`.
   - Logic parse client: `packages/shared/src/chat/use-chat-core.ts`.
4. Event payload có thể mang field mở rộng (vd `turnId`) ở `chat_status`/`chat_finish`:
   - Nguồn chuẩn: `src/shared/types/session.types.ts`.

## 3. Chức Năng -> Đọc/Sửa File Nào

| Bạn muốn làm gì | Server source of truth | Web | Native |
| --- | --- | --- | --- |
| Subscribe event realtime | `src/transport/trpc/routers/session.ts` (`onSessionEvents`) | `apps/web/src/hooks/use-chat.ts` | `apps/native/hooks/use-chat.ts` |
| Load lịch sử chat | `src/transport/trpc/routers/session.ts` (`getSessionMessagesPage`), `src/modules/session/application/get-session-messages.service.ts` | `apps/web/src/hooks/use-chat.ts` | `apps/native/hooks/use-chat.ts`, `apps/native/app/chats/[chatId].tsx` |
| Gửi message + xử lý turn | `src/transport/trpc/routers/ai.ts`, `src/modules/ai/application/send-message.service.ts` | `apps/web/src/hooks/use-chat.ts` | `apps/native/hooks/use-chat.ts` |
| Đồng bộ status (`submitted/streaming/...`) | `src/shared/utils/chat-events.util.ts` | `apps/web/src/hooks/use-chat.ts` | `apps/native/hooks/use-chat.ts`, `apps/native/store/chat-store.ts` |
| Permission flow | `src/platform/acp/permission.ts`, `src/modules/tooling/application/respond-permission.service.ts` | `apps/web/src/hooks/use-chat.ts`, `apps/web/src/components/chat-ui/permission-dialog.tsx` | `apps/native/hooks/use-chat.ts`, `apps/native/components/chat/permission-modal.tsx` |
| Render tool output + terminal | `src/platform/acp/update-tool.ts`, `src/platform/acp/tool-calls.ts` | `apps/web/src/components/chat-ui/agentic-message-utils.ts`, `apps/web/src/components/chat-ui/agentic-message.tsx` | `apps/native/components/chat/chat-message/part-renderers.tsx`, `apps/native/components/chat/chat-message/terminal-part.tsx` |
| Render plan (`tool-plan`) | `src/platform/acp/update-plan.ts` | `apps/web/src/components/chat-ui/chat-plan-dock.tsx` | `apps/native/components/chat/chat-message/part-renderers.tsx` |
| Parse event và upsert message theo `message.id` | `src/shared/types/session.types.ts` | `packages/shared/src/chat/use-chat-core.ts`, `apps/web/src/hooks/use-chat.ts` | `packages/shared/src/chat/use-chat-core.ts`, `apps/native/store/chat-store.ts`, `apps/native/hooks/use-chat.ts` |
| Session list / resume / stop | `src/transport/trpc/routers/session.ts`, `src/modules/session/application/resume-session.service.ts` | `apps/web/src/components/chat-ui/chat-interface.tsx`, `apps/web/src/hooks/use-chat.ts` | `apps/native/app/(drawer)/index.tsx`, `apps/native/hooks/use-chat.ts` |

## 4. Checklist Cập Nhật Web

1. Đổi toàn bộ `trpc.getSessionMessages` sang `trpc.getSessionMessagesPage`.
2. Trong `apps/web/src/hooks/use-chat.ts`: load history theo loop cursor (`messages`, `nextCursor`, `hasMore`) rồi merge/upsert.
3. Trong `apps/web/src/components/chat-ui/chat-interface.tsx`: cập nhật invalidate/fetch key từ `getSessionMessages` sang `getSessionMessagesPage`.
4. Giữ invariant: mọi update message đều upsert theo `message.id`, không append mù.

## 5. Checklist Cập Nhật Native

1. Đổi toàn bộ `trpc.getSessionMessages` sang `trpc.getSessionMessagesPage`.
2. Cập nhật các điểm gọi:
   - `apps/native/hooks/use-chat.ts`
   - `apps/native/app/chats/[chatId].tsx`
   - các chỗ `utils.getSessionMessages.invalidate/fetch`
3. Preserve flow store:
   - thứ tự `messageIds`
   - map `messagesById`
   - `pendingPermission` suy từ `UIMessage.parts` (không giữ state rời).

## 6. Lệnh Rà Soát Nhanh

```bash
rg -n "getSessionMessages\\b" apps/web apps/native
rg -n "onSessionEvents|chat_finish|data-permission-options|tool-plan" apps/web apps/native
```

## 7. Tài Liệu Liên Quan

- `docs/ui-message-normalization.md`
- `docs/ui-message-usechat-client.md`
- `apps/web/docs/ui-message-client.md`
- `apps/native/docs/ui-message-client.md`
