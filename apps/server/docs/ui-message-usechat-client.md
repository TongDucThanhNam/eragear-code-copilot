# UIMessage UseChat Guide (Client)

Mục tiêu là giúp client React build `useChat` dựa trên API hiện có của server,
stream UIMessage mượt và ổn định ở production. Tài liệu này mô tả contract, thứ
tự xử lý event, và cách render hiệu quả.

## API Surface (tRPC)

Các API chính để build `useChat`:

- `getSessionMessages({ chatId })` → trả `UIMessage[]` (history).
- `onSessionEvents({ chatId })` → stream `BroadcastEvent` realtime.

Event types quan trọng:

- `ui_message` → UIMessage đã chuẩn hóa (snapshot).
- `chat_status` → `submitted` | `streaming` | `ready` | `error` (và các trạng thái khác).
- `chat_finish` → stopReason/finishReason/isAbort (kết thúc turn).
- `terminal_output` → output realtime theo `terminalId`.
- `current_mode_update`, `available_commands_update`, `connected`, `heartbeat`, `error`.

## Streaming Contract

- `ui_message` là **snapshot đầy đủ** cho `message.id`, client phải **upsert theo id**.
- Không tự parse raw ACP ở client.
- Message có thể được gửi lặp lại nhiều lần trong streaming. Upsert là idempotent.
- Thứ tự hiển thị:
  - History lấy từ `getSessionMessages` theo thứ tự trả về.
  - Event realtime nếu `message.id` chưa tồn tại thì append vào `messageOrder`.
  - Nếu đã tồn tại thì update nội dung nhưng giữ vị trí.

## State Model Gợi Ý

Tối ưu re-render bằng cách tách dữ liệu:

- `messages: Map<string, UIMessage>`
- `messageOrder: string[]`
- `chatStatus: ChatStatus`
- `pendingPermission` suy từ `ToolUIPart.state === "approval-requested"`

Chỉ render list bằng `messageOrder`, lookup `messages.get(id)`.

## Zustand (Per Chat Store)

Với nhiều component (messages, input, toolbar, permission, terminal), Zustand
giúp tách subscribe theo slice và giảm re-render. Khuyến nghị tạo store theo
`chatId` để isolate state.

Ví dụ store (pseudocode):

```ts
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

type ChatStore = {
  messages: Map<string, UIMessage>;
  messageOrder: string[];
  chatStatus: ChatStatus;
  init: (history: UIMessage[]) => void;
  upsert: (message: UIMessage) => void;
  setStatus: (status: ChatStatus) => void;
  onEvent: (event: BroadcastEvent) => void;
};

export function createChatStore() {
  return createStore<ChatStore>((set, get) => ({
    messages: new Map(),
    messageOrder: [],
    chatStatus: "ready",
    init: (history) =>
      set(() => ({
        messages: new Map(history.map((m) => [m.id, m])),
        messageOrder: history.map((m) => m.id),
      })),
    upsert: (message) =>
      set((state) => {
        const next = new Map(state.messages);
        next.set(message.id, message);
        const order = state.messageOrder.includes(message.id)
          ? state.messageOrder
          : [...state.messageOrder, message.id];
        return { messages: next, messageOrder: order };
      }),
    setStatus: (status) => set({ chatStatus: status }),
    onEvent: (event) => {
      if (event.type === "ui_message") {
        get().upsert(event.message);
      }
      if (event.type === "chat_status") {
        get().setStatus(event.status);
      }
    },
  }));
}
```

Component subscribe theo slice:

```ts
const messages = useStore(chatStore, (s) => s.messageOrder);
const chatStatus = useStore(chatStore, (s) => s.chatStatus);
```

## useChat Flow (React)

1. Mount chat:
   - `getSessionMessages(chatId)` → init store + messageOrder.
   - `onSessionEvents(chatId)` → subscribe stream.
2. On `ui_message`:
   - Nếu `message.id` chưa có → append vào `messageOrder`.
   - Upsert `messages.set(id, message)` (replace toàn bộ message).
3. On `chat_status`:
   - Update state UI tổng (loading/streaming).
4. On `chat_finish`:
   - Tắt trạng thái streaming.
   - Có thể trigger haptics/analytics ở client.

## Render Mượt (100 điểm)

- Chỉ update phần state tối thiểu:
  - Upsert từng message theo id, tránh setState toàn list.
- Batch update trong `requestAnimationFrame` khi stream dồn dập.
- `React.memo` cho Message/Part renderer với props ổn định.
- Không re-parse Markdown toàn message nếu chỉ đang streaming text.
- Virtualize list khi history dài (`react-virtual` hoặc `react-window`).
- `terminal_output` render vào đúng `terminalId`, không re-render toàn message list.

## Pseudocode Hook

```ts
type UseChatState = {
  messages: Map<string, UIMessage>;
  messageOrder: string[];
  chatStatus: ChatStatus;
};

function useChat(chatId: string) {
  const store = useChatStore();

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const history = await trpc.session.getSessionMessages.query({ chatId });
      store.init(history);
      unsub = trpc.session.onSessionEvents.subscribe(
        { chatId },
        {
          onData: (event) => store.onEvent(event),
          onError: () => store.setStatus("error"),
        }
      );
    })();
    return () => unsub?.();
  }, [chatId]);
}
```

## UIMessage Parts (Render Rules)

- `text` → render Markdown/Text.
- `reasoning` → optional, có thể collapse.
- `tool-*` → render tool call + tool result.
- `source-url`, `source-document`, `file` → render badge/link.
- `data-*` → metadata, bỏ qua UI trực tiếp.

## Error & Reconnect

- Nếu stream lỗi, client có thể:
  - set `chat_status = error`
  - retry subscribe bằng `onSessionEvents` để nhận buffer mới nhất.
- `onSessionEvents` tự replay `messageBuffer` ở runtime, nên reconnect vẫn đủ data.

## Tóm tắt Contract

- Server là nguồn chân lý cho UIMessage.
- Client chỉ upsert theo id, không tự build delta.
- Mọi rule stream/tool/permission phải bám theo event types ở server.
