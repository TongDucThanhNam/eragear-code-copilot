# MOBILE TODO (Expo Client)

## Mục tiêu
- [x] Implement mobile client (React Native Expo) tương thích ACP server hiện tại.
- [x] Ưu tiên các flow: session list, create/resume/stop, chat streaming, permission, tool/terminal output.

## 1) Chốt phạm vi MVP
- [x] Quyết định feature bắt buộc: chat realtime, session management, permissions.
- [x] Feature defer: diff/file viewer, attachments (image/file), context panel nâng cao.
- [x] Xác định UI tối thiểu: Sessions list, Chat screen, Settings screen.

## 2) Dependencies + Env config
- [x] Thêm deps cho mobile:
  - [x] @trpc/client, @trpc/react-query, @tanstack/react-query
  - [x] @react-native-async-storage/async-storage
  - [ ] @react-native-community/netinfo (tùy chọn, để reconnect)
- [x] Thiết lập env:
  - [ ] EXPO_PUBLIC_SERVER_URL (REST)
  - [ ] EXPO_PUBLIC_WS_URL (WS tRPC)
- [x] Viết helper `getWsUrl()` xử lý:
  - [x] Android emulator: `ws://10.0.2.2:3003`
  - [x] iOS simulator: `ws://localhost:3003`
  - [x] Device thật: `ws://<LAN_IP>:3003`
- [x] Kiểm tra import type `AppRouter`:
  - [x] Nếu RN không import được từ `apps/server`, move types sang `packages/shared`.

## 3) Setup tRPC + React Query Providers
- [x] Tạo `apps/native/lib/trpc.ts`:
  - [x] `createTRPCReact<AppRouter>()`
- [x] Tạo provider wrapper:
  - [x] `QueryClientProvider`
  - [x] `trpc.Provider` với `createWSClient` + `wsLink`
- [x] Theo dõi AppState/NetInfo:
  - [x] Reconnect khi app foreground hoặc network back online.
  - [x] Update `connStatus`: idle/connecting/connected/error.
- [x] Gắn provider vào `apps/native/app/_layout.tsx`.

## 4) State management (Zustand + AsyncStorage)
- [x] Port `settings-store` từ web sang `apps/native/store/settings-store.ts`.
  - [x] Persist configs bằng AsyncStorage.
- [x] Tạo `apps/native/store/chat-store.ts`:
  - [x] sessions list, active chatId
  - [x] messages, reasoning, tool parts
  - [x] terminal output buffer
  - [x] conn status + error.

## 5) Navigation + Screens
- [x] Sử dụng Expo Router:
  - [x] Drawer/Tabs: Sessions list, Settings
  - [x] Chat screen: `app/chats/[chatId].tsx`
- [x] Tạo `ChatHeader` native:
  - [x] Hiển thị agent name + status
  - [x] Actions: new chat, resume, stop, settings.

## 6) Implement Chat Streaming Pipeline
- [x] Subscription `onSessionEvents`:
  - [x] map `session_update`:
    - [x] agent_message_chunk
    - [x] agent_thought_chunk
    - [x] tool_call / tool_call_update
    - [x] available_commands_update
    - [x] plan
  - [x] map `current_mode_update`, `request_permission`, `terminal_output`, `error`
- [x] Mutations:
  - [x] createSession, stopSession, resumeSession, sendMessage
  - [x] setMode, setModel, cancelPrompt, respondToPermissionRequest
- [x] Port logic từ `apps/web/src/components/chat-ui/chat-interface.tsx`.

## 7) UI components (Native)
- [x] Message list:
  - [x] Text, Plan, Tool cards
  - [x] Reasoning expandable
- [x] Permission modal:
  - [x] Approve/Reject (map theo options)
- [x] Terminal output:
  - [x] Scrollable text view
  - [x] Link to tool call nếu có `terminalId`
- [x] Status display: connected/connecting/error/idle.

## 8) (Optional) Context & Attachments
- [ ] Context tools:
  - [ ] getProjectContext (list files)
  - [ ] getFileContent (code viewer)
  - [ ] getGitDiff (diff viewer)
- [ ] Attachments:
  - [ ] image/file picker (expo-image-picker / document-picker)
  - [ ] map to ACP prompt content blocks.

## 9) QA + Hardening
- [ ] Test iOS simulator + Android emulator + device thật (LAN).
- [ ] Test reconnect:
  - [ ] App background/foreground
  - [ ] Network loss/recover
- [ ] Kiểm tra:
  - [ ] stop/resume
  - [ ] permission flow
  - [ ] tool output streaming
  - [ ] large message performance.

## 10) (Optional) Polishing
- [ ] Haptic feedback cho send/approve.
- [ ] Persist last session + draft input.
- [ ] Cache chat history offline (AsyncStorage).
