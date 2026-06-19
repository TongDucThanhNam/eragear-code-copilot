# Desktop Integrated Runtime Reverse Design

Language: Vietnamese + technical English.

## Mục tiêu

Lưu lại phân tích reverse-design từ ZCode 2.13.0 và hướng áp dụng cho
Eragear-Code-Copilot để đạt trải nghiệm desktop-first: cài một file desktop app
là chạy. App có hai chế độ chính: `main-thread` tự chạy host/runtime local giống
ZCode, và `client-only` chỉ kết nối tới một máy khác đã chạy Eragear host.
Server-only code hiện tại được migrate khỏi runtime mục tiêu và giữ lại dạng
archive/reference để tham khảo, không còn là product mode cần duy trì.

## Kết luận ngắn

Hướng hiện tại của server vẫn đúng ở phần core: logic nằm trong
composition/use-cases, transport chỉ là boundary. Điều cần học từ ZCode là đưa
desktop runtime lên làm product runtime chính:

```text
Main-thread -> Electron main/host transport -> AppUseCases -> local Agent CLI
Client-only -> Electron renderer/main -> remote Eragear host -> remote Agent CLI
Archive/reference -> old Hono/tRPC/WS server code kept for migration lookup
```

Phase đầu có thể dùng local loopback server để ship nhanh. Phase sau nên tiến
tới host process + IPC/MessagePort giống ZCode. Mục tiêu cuối là migrate active
runtime sang desktop-first; Hono/tRPC server-only path không bị xoá ngay, nhưng
được đóng băng/archived để tham khảo trong quá trình chuyển đổi.

Auth stance:

- `main-thread` local mode không cần user login/app auth. Người dùng đã sở hữu
  máy đang chạy app; provider auth nằm trong Agent CLI user tự cài.
- `client-only` remote mode cần API key để kết nối tới máy khác đang chạy
  Eragear host.
- Token loopback nội bộ ở Phase 1 nếu có chỉ là transport guard kỹ thuật giữa
  renderer và local child process, không phải product login flow.

## Quan sát từ ZCode

Các quan sát dưới đây được lấy từ bản cài Windows:

- Binary: `C:\Program Files\ZCode\ZCode.exe`
- Installer/source sample: `C:\Users\terasumi\Downloads\ZCode-2.13.0-win-x64.exe`
- Version: `2.13.0.1163`
- Build meta trong `resources/app.asar`: app version `2.13.0`, commit
  `536fcc39`, build time `2026-05-29T10:31:31.865Z`

ZCode là Electron app, không phải Tauri native:

- Có `LICENSE.electron.txt`, Chromium/V8 DLLs, `resources.pak`, `app.asar`.
- `app.asar` chứa `out/main`, `out/host`, `out/preload`, `out/renderer`.
- `package.json` bên trong app có internal packages:
  `@zcode/client`, `@zcode/server`, `@zcode/rpc`, `@zcode/services`,
  `@zcode/shared`.

Runtime shape quan sát được:

```text
Electron main process
  - window/menu/update/native dialog/deep link/process lifecycle
  - fork host process bằng Electron utilityProcess
  - tạo MessageChannelMain và chuyển MessagePort cho renderer

Renderer process
  - chạy UI
  - nhận service port qua preload
  - gọi platform commands qua window.zcode.*

Host process
  - chạy service graph nặng: file/git/terminal/ACP/settings/model-provider
  - expose service bằng ChannelServer/MessagePortProtocol
  - spawn agent child processes

Agent child processes
  - Claude/Codex/Gemini/GLM/OpenCode qua ACP/stdio hoặc runtime tương ứng
```

Không thấy ZCode listen TCP port ở thời điểm kiểm tra. Nội bộ app dùng
Electron IPC/MessagePort, không dùng localhost HTTP cho renderer.

## ZCode Packaged Agent Runtimes

ZCode bundle nhiều agent/runtime ngay trong `resources`:

- `resources/acp`: Claude ACP adapter
  `@agentclientprotocol/claude-agent-acp@0.29.2`
- `resources/codex`: `@zed-industries/codex-acp@0.12.0`
- `resources/gemini`: Gemini CLI bundle `0.37.0`
- `resources/glm`: `zcode-acp.exe`, version `0.13.0`
- `resources/opencode`: `opencode.exe`
- `resources/tools/ripgrep/rg.exe`

Điểm này là khác biệt lớn với hướng sản phẩm của Eragear.

## Eragear Agent Runtime Decision

Eragear không bundle Agent CLI mặc định. Người dùng tự cài, tự update, tự đăng
nhập, và tự quản lý cấu hình của các CLI như Codex, Claude Code, Gemini CLI,
OpenCode hoặc provider tương đương.

Vai trò của Eragear:

- Là desktop-first client và orchestration layer cho các Agent CLI.
- Discover CLI từ `PATH`, explicit binary path, hoặc agent config trong app.
- Validate binary tồn tại, executable được, và version/capability đủ dùng.
- Bridge UI với agent qua ACP/stdio/runtime adapter.
- Lưu session state, permission decisions, project context, observability.

Vai trò của người dùng:

- Cài CLI bằng kênh chính thức của provider.
- Quản lý login/token/native config của từng CLI.
- Chọn version và update cadence phù hợp workflow của họ.

Lý do chọn hướng này:

- Tôn trọng ownership/security boundary: credential/provider config ở CLI của
  người dùng, không bị app desktop che giấu.
- Giảm rủi ro license/distribution khi bundle third-party CLI.
- Dễ hỗ trợ nhiều provider và custom CLI hơn.
- App trở thành "agent client" đúng nghĩa, không phải vendor runtime bundle.

Tradeoff:

- Onboarding không thể "zero dependency" như ZCode.
- Cần built-in setup diagnostics rất tốt: detect missing CLI, hướng dẫn cài,
  kiểm version, kiểm auth, test spawn.
- Installer `.exe` chỉ đảm bảo app chạy; agent capability phụ thuộc CLI user đã
  cài và cấu hình.

## Persistence Pattern

ZCode dùng hybrid persistence:

- User data: `C:\Users\terasumi\.zcode\v2`
- Task index: `tasks-index.sqlite`
- Session/task detail: JSON file riêng theo workspace/task
- Session JSON shape chính: `meta`, `messages`, `fileChanges`,
  `turnCheckpoints`

Điểm đáng học: index query nhanh nằm trong SQLite, còn transcript/detail lớn
được tách theo file để tránh một JSON nguyên khối.

Server mình đã đi đúng hướng khi primary persistence là SQLite. Nếu muốn học
thêm từ ZCode, nên cân nhắc tách "large session artifacts" khỏi index nếu
session transcript bắt đầu lớn.

## Target Architecture Cho Eragear

Desktop integrated runtime là hướng chính và là runtime mục tiêu. Hono server
hiện tại không còn là mode cần giữ sống lâu dài; nó nên được dùng như migration
source/reference trong khi core được chuyển sang Electron host:

```text
apps/server
  src/bootstrap/composition.ts
  src/bootstrap/service-registry/*
  src/modules/use-cases.ts
  -> migration source để trích AppUseCases/core sang desktop host

apps/desktop-electron
  main process
    -> window/update/menu/native integration
    -> mode main-thread: spawn host process hoặc server binary
    -> mode client-only: không spawn local host, connect remote Eragear host
    -> quản lý local/remote connection lifecycle

  renderer
    -> reuse apps/web build output

  host process
    -> Phase 1: spawn compiled apps/server binary, connect qua 127.0.0.1
    -> Phase 2: import/use AppUseCases trực tiếp và expose qua IPC
    -> main-thread service channel do Electron main/host sở hữu
```

## Target Runtime Modes

Sau migration, active runtime chỉ nên có hai mode desktop-owned:

1. `main-thread`

   Electron main/host là owner của lifecycle. App tự chạy host/runtime local,
   resolve Agent CLI trên máy hiện tại, lưu state local, và UI nói chuyện với
   host qua loopback ở Phase 1 hoặc IPC ở Phase 2. Đây là trải nghiệm giống
   ZCode và là product default.

   Auth: không cần user login/app auth cho local mode. Chỉ cần internal
   transport guard nếu Phase 1 còn dùng loopback HTTP giữa renderer và local
   child process.

2. `client-only`

   App không spawn local host/runtime. Nó chỉ hoạt động như client UI để kết nối
   tới một máy khác đã chạy Eragear host/main-thread. Renderer vẫn đi qua
   Electron main/preload để nhận remote connection config và API key; Agent CLI
   chạy ở máy remote.

   Auth: yêu cầu API key cho remote Eragear host. API key bảo vệ kết nối từ
   client-only machine tới host machine, không thay thế provider auth của Agent
   CLI.

Archived/reference:

`apps/server`/Hono/tRPC server-only path được giữ trong repo như archive hoặc
reference module để tra cứu code, migration, test fixtures, và quyết định thiết
kế cũ. Không xem nó là runtime mode cần product support.

## Phase 1: One EXE Nhanh

Mục tiêu: giảm setup friction ngay.

Thiết kế:

- Electron bundle `apps/web` build output.
- Electron main spawn compiled `apps/server` binary.
- Server bind `127.0.0.1:<random-port>`.
- Renderer connect bằng tRPC/WS hiện tại.
- Electron main inject base URL + optional random loopback token vào renderer.
- Không yêu cầu user login/app auth cho local main-thread mode.
- Nếu còn dùng loopback HTTP ở Phase 1, token chỉ dùng để chặn process khác gọi
  vào local server.
- Data dir chuyển về app user-data, ví dụ `%APPDATA%/Eragear/...`.
- Agent CLI được resolve từ user config hoặc `PATH`, không bundle mặc định.

Ưu điểm:

- Tận dụng gần như toàn bộ code hiện tại.
- Nhanh có installer `.exe`.
- Rủi ro thấp hơn IPC rewrite.

Nhược điểm:

- Vẫn có local HTTP surface.
- Cần quản lý port/token/lifecycle kỹ.
- Desktop UX chưa sạch bằng ZCode host IPC.

Quality bar cho Phase 1:

- Local server chỉ bind `127.0.0.1`, không bind `0.0.0.0`.
- Local main-thread mode không hiện login/connection dialog.
- Nếu dùng loopback token, mỗi launch sinh token mới hoặc token scoped theo
  desktop session.
- WS/tRPC phải kiểm loopback token trước khi upgrade/execute trong Phase 1.
- Khi Electron quit, server child process phải shutdown sạch.
- Logs và data dir không ghi vào `Program Files`.
- Agent CLI discovery/auth/version diagnostics hoạt động trong packaged app.

## Phase 2: Host Process + IPC

Mục tiêu: runtime shape giống ZCode hơn.

Thiết kế:

- Tách transport-independent runtime khỏi HTTP bootstrap.
- Host process tạo `AppComposition`/`AppUseCases` trực tiếp.
- Renderer gọi host qua IPC/MessagePort.
- Electron main/host sở hữu main-thread lifecycle.
- Client-only remote connection dùng API key và service/event contract riêng
  cho remote Eragear host.
- Hono/tRPC server path được archived/frozen sau khi behavior đã migrate.
- Một core, một product transport chính: Electron host IPC.

Ưu điểm:

- Không còn local HTTP attack surface cho desktop.
- Startup và lifecycle có thể mượt hơn.
- Dễ tạo desktop-native APIs, remote workspace, process monitor.

Nhược điểm:

- Cần viết IPC contract/type-safe client.
- Cần mapping stream/session events từ current WS model sang IPC event model.
- Cần test lifecycle kỹ hơn.

## Quyết Định Cần Grill

Các câu hỏi này nên được hỏi lần lượt trước khi bắt tay implement lớn. Mỗi câu
có recommended answer để làm mặc định nếu chưa có phản biện.

1. Desktop app có cần chạy được offline/local hoàn toàn không?

   Recommended answer: Có cho local workspace/session/runtime, nhưng auth/model
   provider vẫn có thể cần network. Offline ở đây nghĩa là không cần start
   server thủ công và không cần external deployment.

2. Desktop distribution đầu tiên nên dùng loopback server hay IPC ngay?

   Recommended answer: Loopback server cho Phase 1. IPC là Phase 2 sau khi app
   đã có installer và user flow ổn định.

3. Có giữ server-only mode không?

   Recommended answer: Không giữ như active runtime. Migrate behavior cần thiết
   sang Electron main/host, sau đó archive/freeze server-only code để tham khảo.
   Remote/client-only đi qua Electron main/preload tới Eragear host bằng API
   key, không yêu cầu server-only product mode.

4. Server core có được import bởi Electron host không?

   Recommended answer: Có, nhưng chỉ sau khi `AppUseCases`/composition không
   phụ thuộc Hono request lifecycle. Hiện codebase đã có nền tốt ở
   `src/bootstrap/composition.ts` và `src/modules/use-cases.ts`.

5. Desktop renderer có reuse nguyên `apps/web` không?

   Recommended answer: Có ở Phase 1. Sau đó tách platform adapter nếu web UI
   bắt đầu bị điều kiện hóa quá nhiều bởi desktop APIs.

6. Agent runtimes nên bundle hay yêu cầu user tự cài?

   Recommended answer: Không bundle Agent CLI mặc định. User tự cài và tự quản
   lý provider CLI/config. Eragear phải cung cấp setup diagnostics tốt: detect
   CLI, chỉ ra command/binary path đang dùng, kiểm version/capability, kiểm auth
   cơ bản, và hướng dẫn sửa khi thiếu.

7. Persistence desktop dùng chung schema với server không?

   Recommended answer: Có. Desktop mode vẫn là cùng app runtime. Chỉ khác
   storage root và boot config.

8. Local desktop auth xử lý thế nào?

   Recommended answer: Local `main-thread` không cần user login/app auth. Nếu
   Phase 1 dùng loopback HTTP, random token chỉ là internal transport guard.
   Provider auth vẫn thuộc Agent CLI user tự cài/cấu hình.

9. Client-only remote auth xử lý thế nào?

   Recommended answer: Dùng API key cho kết nối tới remote Eragear host. API key
   được nhập/lưu ở client-only app, có thể revoke/rotate ở host machine. Không
   reuse Cloudflare Access cho desktop-first remote mặc định.

10. Có nên bỏ Bun vì Electron là Node không?

   Recommended answer: Không ở Phase 1. Compile server bằng Bun thành binary
   riêng rồi Electron spawn. Phase 2 mới đánh giá lại Node/Electron host import
   nếu runtime APIs tương thích.

11. Success metric đầu tiên là gì?

    Recommended answer: User tải installer, cài, mở app ở `main-thread`, không
    thấy login local, chọn/open workspace, tạo session, gửi prompt, nhận stream,
    approve permission/tool call, quit app không còn process mồ côi. Client-only
    có thể nhập remote URL/API key và connect tới host đã chạy.

## Fit Với Codebase Hiện Tại

Các anchor hiện tại thuận lợi cho desktop integrated runtime:

- Composition root: `src/bootstrap/composition.ts`
- Module init: `src/bootstrap/init/*.init.ts`
- Service registries: `src/bootstrap/service-registry/*.ts`
- Transport-facing use-case surface: `src/modules/use-cases.ts`
- Existing HTTP/tRPC transport: `src/transport/**`
- Compile path: `bun run compile`

Ranh giới nên giữ:

- Transport không instantiate service trực tiếp.
- Application/use-cases không import Electron/Hono.
- Platform adapters có thể có biến thể server/desktop nếu cần.
- Boot config nên hội tụ về `main-thread` và `client-only`; boot config cũ của
  server-only chỉ dùng cho archive/migration lookup.

## Non-Goals

- Không reverse/copy proprietary implementation của ZCode.
- Không duy trì `server-only` như active runtime sau migration.
- Không xoá ngay server code cũ khi nó còn giá trị tham khảo/migration.
- Không chuyển toàn bộ app sang Electron trong một lần.
- Không để desktop renderer có Node integration hoặc filesystem quyền rộng.
- Không bundle Agent CLI mặc định như một runtime dependency ẩn.

## Next Steps

1. Tạo ADR cho quyết định "Desktop integrated runtime via Electron".
2. Tạo spike `apps/desktop` tối thiểu:
   - load built web UI
   - mode `main-thread`: spawn compiled server binary
   - inject loopback URL/token nội bộ cho Phase 1
   - bỏ local login/connection dialog trong main-thread mode
   - shutdown child process sạch
3. Thêm boot mode `main-thread` và `client-only`.
4. Thêm local token guard cho tRPC/WS khi chạy desktop loopback.
5. Thêm setup diagnostics cho user-managed Agent CLI:
   - detect binary từ `PATH` và explicit config
   - kiểm executable/version/capability
   - test spawn/ACP handshake
   - hiển thị lỗi cài đặt/auth rõ ràng trong UI
6. Thiết kế `client-only` remote connect:
   - không spawn local host/runtime
   - nhập remote host URL + API key
   - API key được quản lý/revoke/rotate trên host machine
   - renderer nhận service/event contract từ remote host qua Electron main/preload
7. Lập migration/archive plan cho server-only path:
   - liệt kê behavior cần migrate sang desktop host
   - đóng băng Hono/tRPC route cũ sau khi có parity
   - giữ code/docs ở archive/reference area thay vì xoá ngay
8. Đóng gói installer `.exe` bằng `electron-builder`.
9. Sau khi Phase 1 chạy ổn, thiết kế IPC service transport cho Phase 2.
