# ACP Session Replay & External Import Policy

Tài liệu này định nghĩa policy chuẩn cho luồng "Load Existing Agent Session":

- ACP replay là **nguồn sự thật chính** cho lịch sử session.
- Local DB chỉ là snapshot để hiển thị nhanh, phân trang, và recover.
- External import fallback chỉ dùng để cứu dữ liệu khi replay bị thiếu, và phải
  bị kiểm soát chặt.

## 1) Invariant bắt buộc

1. Khi load session có `sessionIdToLoad`, server **luôn** ưu tiên replay từ ACP
   bằng `loadSession` nếu agent hỗ trợ capability này.
2. `unstable_resumeSession` chỉ dùng khi agent **không** hỗ trợ `loadSession`.
3. Không được thay replay runtime bằng nguồn ngoài một cách mặc định.
4. External fallback chỉ là nhánh phụ trợ, có điều kiện, và phải có test
   regression.

Code path chính:

- `apps/server/src/modules/session/application/session-acp-bootstrap.service.ts`
  - `loadExistingSession(...)`
- `apps/server/src/modules/session/application/session-history-replay.service.ts`
  - `broadcastPromptEnd(...)`
- `apps/server/src/modules/session/application/persist-session-bootstrap.service.ts`
  - `persistImportedExternalHistory(...)`

## 2) Canonical flow hiện tại

1. User chọn session ngoài trong UI.
2. `loadAgentSession` tạo runtime session mới với `sessionIdToLoad`.
3. Server bootstrap ACP connection và gọi:
   - `loadSession(...)` khi capability `loadSession` có sẵn (primary)
   - `unstable_resumeSession(...)` chỉ khi agent không có `loadSession`
4. ACP updates được map sang `UIMessage[]` trong runtime state.
5. Nếu agent không replay event nào (`replayEventCount === 0`), server có thể
   replay từ DB để tránh màn hình rỗng.
6. Import phase persist `UIMessage` vào DB cho local history.

## 3) External import fallback policy

### 3.1 Scope support

Hiện tại fallback external chỉ support **Codex family** (guard theo command
basename có chứa `codex`).

- Guard function:
  - `isExternalHistoryImportSupportedAgentCommand(...)`
  - file: `external-history-resolver.ts`

### 3.2 Điều kiện được phép thử fallback

Fallback chỉ được thử khi:

1. `importExternalHistoryOnLoad === true`
2. Agent thuộc family được support fallback
3. Runtime replay đang assistant-sparse:
   - `assistantCount === 0`, hoặc
   - `assistantCount * 2 <= userCount`

### 3.3 Điều kiện được phép thay runtime snapshot bằng external

External chỉ được chọn nếu "richer" hơn runtime:

- Có assistant messages hợp lệ
- Và cải thiện rõ so với runtime theo heuristic role-summary

Nếu không đạt điều kiện, giữ nguyên ACP runtime replay.

## 4) Vì sao không bật fallback cho mọi agent

Mỗi agent có format history/transcript khác nhau. Nếu parse sai:

- mất message
- sai thứ tự timeline
- duplicate/overwrite sai role
- gây inconsistency giữa UI runtime và DB snapshot

Nên mặc định không có parser chuẩn thì không bật fallback.

## 5) Cách mở rộng fallback cho agent mới (quy trình bắt buộc)

1. Tạo parser riêng cho agent đó (không dùng heuristic chung bừa).
2. Thêm guard command-family rõ ràng.
3. Thêm tests tối thiểu:
   - parse đúng user/assistant timeline
   - non-target agent không vào nhánh parser
   - replay healthy không dùng fallback
   - replay sparse mới cho phép fallback
4. Chạy:
   - `bun run --cwd apps/server check-types`
   - test suite session import/replay liên quan
5. Cập nhật tài liệu này và `acp-chat-protocol.md`.

## 6) Test references hiện tại

- `apps/server/src/modules/session/application/persist-session-bootstrap.service.test.ts`
- `apps/server/src/modules/session/application/external-history-resolver.test.ts`
- `apps/server/src/modules/session/application/session-history-replay.service.test.ts`
- `apps/server/src/modules/session/application/session-acp-bootstrap.service.test.ts`

## 7) Client contract (Web/Native)

- Primary realtime source: `onSessionEvents`
- DB history (`getSessionMessagesPage`) chỉ là seed/fallback read path
- Client phải upsert theo `message.id`, không assume thứ tự append tuyến tính

Xem thêm:

- `apps/server/docs/acp/acp-chat-protocol.md`
- `apps/server/docs/ui-message-usechat-client.md`
