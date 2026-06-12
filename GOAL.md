# GOAL.md

> File này được tạo tự động bởi create-goal skill.
> Agent thực thi: đọc toàn bộ file này trước khi làm bất kỳ thứ gì.

---

## Objective

Đạt feature parity toàn diện giữa Eragear Code Copilot và ZCode v2.13.0 — đóng gap tất cả tính năng hiện diện trong ZCode mà Eragear chưa có, bao gồm cả tính năng ẩn (enhance prompt, git checkpoint, skills, subagents, hooks, memory, settings sync, feedback, output style, coding plan subscription, repo snapshot indexing, task auto-archive, web remote control, deep link, OAuth, context usage tracking, bots, plugins, slash commands, config options/modes, file watcher, credential management, usage stats).

---

## Context

- **Lý do**: Eragear Code Copilot hiện tại là một nền tảng agent coding (ACP-based) nhưng còn thiếu rất nhiều tính năng so với ZCode — một sản phẩm thương mại đã release v2.13.0. Để cạnh tranh, Eragear cần đạt parity.
- **Ưu tiên**: correctness > speed (phải đúng, hoàn chỉnh, không half-baked)
- **Người thực hiện**: AI Agent (không có human review từng bước)
- **Ngày tạo**: 2026-06-12

---

## Current State

| Item | Giá trị |
|------|---------|
| Framework / Runtime | Hono (server) + Vite/React (web) + Electron (desktop) + Expo (native) |
| Language | TypeScript |
| Package manager | bun |
| Dependencies chính | Hono, tRPC, React, TailwindCSS, Electron, Expo |
| Entry point (server) | `apps/server/src/index.ts` → `bootstrap/server.ts` |
| Entry point (web) | `apps/web/src/main.tsx` |
| Entry point (desktop) | `apps/desktop/src/main.ts` |
| Config files | `turbo.json`, `AGENTS.md`, `.eragear/` |
| Test setup | bun test |
| Architecture | Clean Architecture (Transport → Application → Domain → Infra) |
| ACP Protocol | Có (NDJSON, stdio) |
| Agent Support | Claude Code, Codex, Gemini CLI (partial) |

---

## Target State

| Item | Giá trị |
|------|---------|
| Framework / Runtime | Giữ nguyên |
| Architecture | Giữ nguyên (Clean Architecture) |
| Feature Parity | 100% so với ZCode v2.13.0 |
| Agent Support | Claude Code, Codex, Gemini CLI, GLM, OpenCode (all 5 providers) |
| Thứ KHÔNG thay đổi | Architecture layers, DI container pattern, ACP protocol, UI framework |

---

## Feature Gap Analysis: ZCode vs Eragear

> Dựa trên reverse engineering ZCode v2.13.0 (config files, logs, RPC channels, session data).

### Category A: Core Features (ERAGEAR CÓ, cần verify/enhance)

| # | Feature | ZCode | Eragear | Gap | Priority |
|---|---------|-------|---------|-----|----------|
| A1 | Chat / Message Streaming | ✅ NDJSON | ✅ Có | Cần verify streaming quality | HIGH |
| A2 | Multi-Session / Session Management | ✅ | ✅ Có | ZCode có task list + workspace task lists — Eragear chỉ có session list | HIGH |
| A3 | Model Selection | ✅ Multi-provider (10+) | ✅ Có nhưng ít models/providers | Eragear thiếu nhiều providers: Bigmodel, ZAI, OpenRouter, Moonshot, MiniMax, DeepSeek, Mimo, Qwen | HIGH |
| A4 | Agent Runtime (ACP) | ✅ 5 providers (glm, claude, codex, gemini, opencode) | ✅ 3 providers | Thiếu GLM native binary và OpenCode | MEDIUM |
| A5 | Project Management | ✅ Multi-workspace tabs | ✅ Có | ZCode có tab-based multi-workspace — Eragear chỉ có project switching | MEDIUM |
| A6 | Tool Calls (File/Terminal) | ✅ | ✅ Có | Cần verify sandbox, allowlist, path resolution | HIGH |
| A7 | Permission System | ✅ | ✅ Có | ZCode có UI approval flow riêng | HIGH |
| A8 | MCP Server Support | ✅ mcpServers in session/new | ✅ Có (MCP routes) | Cần verify actual MCP integration | HIGH |
| A9 | Settings Pages | ✅ Comprehensive | ✅ Có (settings routes) | ZCode có nhiều hơn: terminal profile, archive, proxy, sync | MEDIUM |

### Category B: Features ERAGEAR CHƯA CÓ (Gap lớn)

| # | Feature | ZCode Evidence | Eragear Status | Priority |
|---|---------|----------------|----------------|----------|
| B1 | **Git Integration** | RPC channel `git`, `git.getRepositorySummary`, `git.getChanges`, `git-checkpoint` channel | ❌ Chỉ có infra/git adapter cơ bản, không có UI | CRITICAL |
| B2 | **Git Checkpoint / Restore** | `git-checkpoint` RPC channel, `turnCheckpoints` trong persistence, `repo-snapshots` directory | ❌ Không có | CRITICAL |
| B3 | **Repo Snapshot Indexing** | `repoSnapshotIndexingEnabled` setting, `repo-snapshots` dir (7 snapshots) | ❌ Không có | HIGH |
| B4 | **Subagent System** | RPC channel `subagents`, `subagents.list`, subagent sessions trong artifacts | ❌ Không có | CRITICAL |
| B5 | **Skills System** | RPC channel `skills`, `skills.list`, `skills-state.json`, per-workspace skills | ❌ Không có | HIGH |
| B6 | **Hooks System** | RPC channel `hooks` | ❌ Không có | HIGH |
| B7 | **Memory System** | RPC channel `memory`, `capabilities-state.json` có memory key | ⚠️ Có stub trong capabilities-state nhưng `enabled: false` | HIGH |
| B8 | **Settings Sync** | RPC channel `settings-sync`, `settingsSyncFirstRunPromptHandled` | ❌ Không có | MEDIUM |
| B9 | **Feedback System** | RPC channel `feedback`, `feedback.list` poll mỗi ~45s | ❌ Không có | MEDIUM |
| B10 | **Output Style Customization** | RPC channel `output-style` | ❌ Không có | MEDIUM |
| B11 | **Coding Plan Subscription** | RPC channel `coding-plan-subscription` | ❌ Không có | MEDIUM |
| B12 | **Usage Statistics** | RPC channel `usage-stats`, `telemetry-state.json`, context usage tracking | ❌ Không có (chỉ có context usage trong capabilities) | MEDIUM |
| B13 | **Credential Management** | RPC channel `credential`, `credentials.json` | ❌ Không có (API keys lưu trực tiếp) | HIGH |
| B14 | **Bots System** | RPC channel `bots` | ❌ Không có | LOW |
| B15 | **Plugins System** | RPC channel `plugins` | ❌ Không có | MEDIUM |
| B16 | **File Watcher** | RPC channel `file-watcher` | ❌ Không có | HIGH |
| B17 | **Commands System** | RPC channel `commands`, slash commands (3 commands), `available_commands_update` | ⚠️ Có slash command stubs | MEDIUM |
| B18 | **Context Usage Tracking** | `context-usage` events, `used`/`size` tracking per task | ⚠️ Có partial (ChatInputToolbar) | HIGH |
| B19 | **Session Config Options / Modes** | `config_option_update`, `current_mode_update` (e.g., "build" mode) | ⚠️ Có mode selection nhưng chưa đầy đủ | MEDIUM |
| B20 | **OAuth Authentication** | `oauth.getProviders`, `oauth.getActiveProvider`, `oauth.restoreCachedSession`, per-provider auth | ❌ Không có OAuth | HIGH |
| B21 | **Task Auto-Archive** | `taskAutoArchiveEnabled`, `taskAutoArchiveOlderThanDays`, SQLite `tasks-index.sqlite` | ❌ Không có | MEDIUM |
| B22 | **Web Remote Control** | `webRemoteControlExternalRelayDevice`, device SID | ❌ Không có | LOW |
| B23 | **Deep Link Protocol** | `zcode://` protocol registration, `[deep-link]` log | ❌ Không có | LOW |
| B24 | **Auto-Update** | `[auto-update]` check, version compare | ⚠️ Electron có auto-update nhưng cần verify | MEDIUM |
| B25 | **Crash Reporting** | `crash-capture`, Sentry integration | ❌ Không có | MEDIUM |
| B26 | **Terminal Integration** | `terminal` RPC channel, `terminalInheritSystemProfile` | ⚠️ Có cơ bản | HIGH |
| B27 | **Prompt Enhancement** | Yêu cầu user đề cập — pre-processing prompt trước khi gửi agent | ❌ Không có | HIGH |
| B28 | **Session Fork/Resume** | `sessionCaps=[close=true list=true fork=false resume=true]` | ⚠️ Có resume, thiếu fork | MEDIUM |
| B29 | **Image Input** | `promptCaps=[image=true audio=false]` | ❌ Không có | MEDIUM |
| B30 | **Session Persistence (SQLite)** | `tasks-index.sqlite`, `task-index-repo` | ❌ JSON store only | MEDIUM |
| B31 | **ACP Traffic Proxy** | `acpTrafficProxyEnabled`, `acpProxyUseSystemCa` | ❌ Không có | LOW |
| B32 | **Model Provider Mgmt** | `model-providers.json` (10 providers), `providerMappings` (haiku/sonnet/opus/reasoning), `modelSupportedFormats` | ⚠️ Có nhưng rất basic | HIGH |
| B33 | **Workspace Session Restore** | `lastWorkspaceSession` array (9 workspaces), tab-based restore | ❌ Không có tab-based | MEDIUM |
| B34 | **Session Bindings** | `session-bindings` directory | ❌ Không có | MEDIUM |
| B35 | **ACP Auth Per Provider** | `acp-auth/codex/auth.json` | ❌ Không có | MEDIUM |

---

## Constraints

> Đây là phần quan trọng nhất. Agent PHẢI tuân theo.

- [ ] KHÔNG thay đổi: Clean Architecture layers (Transport → Application → Domain → Infra)
- [ ] KHÔNG thay đổi: DI container pattern (`bootstrap/container.ts`)
- [ ] KHÔNG thay đổi: ACP protocol (NDJSON stdio)
- [ ] KHÔNG upgrade dependencies không liên quan đến task
- [ ] KHÔNG refactor business logic hiện tại nếu không liên quan đến feature mới
- [ ] Giữ nguyên: tRPC router pattern, zod validation
- [ ] Giữ nguyên: JSON store persistence layer (`infra/storage/json-store.ts`)
- [ ] Mỗi feature mới phải theo đúng architecture: Port → Application → Infra → Transport
- [ ] Nếu gặp blocker: DỪNG và mô tả blocker, KHÔNG tự workaround
- [ ] KHÔNG xóa file cũ cho đến khi phần tương ứng được verify
- [ ] Ports ở `src/modules/*/application/ports/**`, KHÔNG ở domain
- [ ] Domain KHÔNG import infra/transport
- [ ] Tool-call handler KHÔNG tự tạo session state
- [ ] KHÔNG bypass `SessionRuntimePort` khi broadcast event

---

## Success Criteria

> Mỗi tiêu chí PHẢI có authoritative evidence rõ ràng.

### Required Evidence per Criterion

| # | Tiêu chí | Verification Command | Expected Output / Signal |
|---|----------|---------------------|--------------------------|
| 1 | Git Integration: show repo summary + changes in UI | `bun run --cwd apps/server dev` + open UI | Git panel visible với branch, status, changed files |
| 2 | Git Checkpoint: auto-checkpoint each agent turn | Run agent task, check `.eragear/checkpoints/` | Checkpoint files created after each turn |
| 3 | Git Restore: restore to previous checkpoint | Click restore in UI | Files restored, git diff shows changes reverted |
| 4 | Subagent System: spawn subagent from main agent | Subagent tasks visible in UI | Subagent tool calls visible, results returned to parent |
| 5 | Skills System: list/enable/disable skills | Skills panel in Settings | Skills listed, can toggle enable/disable |
| 6 | Hooks System: pre/post hooks on events | Hook configuration in Settings | Hooks fire on configured events |
| 7 | Memory System: project memory auto-context | Enable memory, send message | Memory injected into context automatically |
| 8 | Feedback System: thumbs up/down on responses | Send message, see feedback buttons | Feedback buttons appear, can submit |
| 9 | File Watcher: real-time file change detection | Edit file externally | File tree updates, context panel refreshes |
| 10 | Context Usage: show used/total context | Send long message | Context usage bar updates in UI |
| 11 | OAuth: login via OAuth provider | Click OAuth login | Redirect to provider, token stored |
| 12 | Credential Management: secure credential store | Add API key in Settings | Key encrypted at rest |
| 13 | Model Provider Management: full provider CRUD | Settings → Model Providers | Can add/edit/delete providers, set mappings |
| 14 | Settings Sync: sync settings across devices | Login on 2 devices | Settings sync bidirectionally |
| 15 | Output Style: customize response formatting | Settings → Output Style | Style preferences applied to responses |
| 16 | Task Auto-Archive: auto-archive old tasks | Set archive threshold, wait | Old tasks archived automatically |
| 17 | Prompt Enhancement: pre-process user prompt | Send raw prompt | Enhanced prompt sent to agent |
| 18 | Image Input: attach image to prompt | Click image button, attach | Image sent via ACP, agent processes |
| 19 | Repo Snapshot Indexing: index codebase | Enable setting, open project | Snapshots created, searchable |
| 20 | Deep Link: `eragear://` protocol | Click eragear:// link | App opens to correct context |
| 21 | Crash Reporting: Sentry integration | Trigger crash | Crash reported to Sentry |
| 22 | Terminal Integration: full terminal in UI | Open terminal panel | Terminal with system profile, interactive |
| 23 | Session Fork: duplicate session | Click fork button | New session created with same history |
| 24 | Config Options/Modes: switch agent modes | Mode dropdown in chat | Mode changes applied to agent |
| 25 | Slash Commands: custom slash commands | Type `/` in chat | Commands listed, executable |

### Completion Condition
Agent kết thúc khi và chỉ khi:
- [ ] Tất cả 25 verification tests pass
- [ ] Mọi item trong Category B (B1-B35) có implementation hoặc documented reason why not applicable
- [ ] `bun run check-types` pass
- [ ] `bun run audit:blockers` pass
- [ ] Không có regression so với Current State

---

## Execution Plan

> Thực hiện theo thứ tự. Báo cáo sau mỗi bước trước khi tiếp tiếp.
> Mỗi bước là một checkpoint — không skip bước nào.

### Phase 1: Critical Infrastructure (CRITICAL priority)

**Bước 1.1: Git Integration (B1)**
- Tạo GitPort interface trong `modules/git/application/ports/`
- Tạo GitService trong `modules/git/application/`
- Implement GitAdapter trong `infra/git/` (expand existing)
- Thêm tRPC router cho Git
- Thêm UI: Git panel trong right sidebar

**Bước 1.2: Git Checkpoint / Restore (B2)**
- Tạo GitCheckpointPort interface
- Tạo GitCheckpointService
- Implement checkpoint creation after each agent turn
- Thêm UI: checkpoint list, restore button
- Lưu checkpoints trong `.eragear/checkpoints/`

**Bước 1.3: Subagent System (B4)**
- Extend ACP protocol để support subagent spawning
- Tạo SubagentService trong `modules/session/application/`
- Implement subagent lifecycle management
- Thêm UI: subagent status trong tool call display

### Phase 2: High Priority Features

**Bước 2.1: Skills System (B5)**
- Tạo SkillsPort interface
- Tạo SkillsService
- Implement skill discovery, enable/disable
- Thêm UI: Skills management trong Settings

**Bước 2.2: Hooks System (B6)**
- Tạo HooksPort interface
- Tạo HooksService
- Implement hook lifecycle (pre/post events)
- Thêm UI: Hook configuration

**Bước 2.3: Memory System Enhancement (B7)**
- Enable memory trong capabilities
- Implement memory injection vào prompt context
- Thêm UI: memory toggle per project

**Bước 2.4: File Watcher (B16)**
- Implement file watcher service (chokidar/fs.watch)
- Integrate với file tree UI
- Broadcast changes qua event bus

**Bước 2.5: Context Usage Enhancement (B18)**
- Implement token counting
- Thêm usage bar trong chat input
- Track per-task usage

**Bước 2.6: Credential Management (B13)**
- Create encrypted credential store
- Implement CredentialPort + CredentialService
- Thêm UI: secure API key management

**Bước 2.7: Model Provider Management Enhancement (B32)**
- Full CRUD cho providers
- Provider mappings (haiku/sonnet/opus/reasoning)
- Model format support (anthropic/openai/gemini)
- Thêm UI: provider management page

**Bước 2.8: Prompt Enhancement (B27)**
- Create PromptEnhancementService
- Pre-process user prompts (context injection, instruction enrichment)
- Optional: toggle trong settings

**Bước 2.9: Terminal Integration Enhancement (B26)**
- Full terminal panel trong UI
- System profile inheritance
- xterm.js integration

### Phase 3: Medium Priority Features

**Bước 3.1: OAuth Authentication (B20)**
- OAuth provider support
- Session restore
- Per-provider auth flow

**Bước 3.2: Settings Sync (B8)**
- Cloud sync service
- Conflict resolution
- First-run prompt

**Bước 3.3: Feedback System (B9)**
- FeedbackPort + FeedbackService
- Thumbs up/down UI
- Feedback persistence

**Bước 3.4: Output Style (B10)**
- Style preferences service
- Custom response formatting options
- UI controls

**Bước 3.5: Coding Plan Subscription (B11)**
- Subscription management service
- Plan-based feature gating
- Billing integration hooks

**Bước 3.6: Usage Statistics (B12)**
- Usage tracking service
- Telemetry (opt-in)
- Usage dashboard

**Bước 3.7: Plugins System (B15)**
- Plugin API/SDK
- Plugin lifecycle management
- Plugin marketplace hooks

**Bước 3.8: Repo Snapshot Indexing (B3, B19)**
- Codebase indexing service
- Snapshot creation + storage
- Search/retrieval API

**Bước 3.9: Task Auto-Archive (B21)**
- Archive service with configurable threshold
- SQLite migration for task index (optional, hoặc giữ JSON)
- Background polling

**Bước 3.10: Session Fork/Resume Enhancement (B28)**
- Session fork (duplicate)
- Enhanced resume with history replay
- Session bindings

**Bước 3.11: Config Options / Modes Enhancement (B19)**
- Mode switching UI
- Config option persistence
- Per-session mode support

**Bước 3.12: Slash Commands Enhancement (B17)**
- Command registry
- Custom command creation
- Command autocomplete

**Bước 3.13: Session Persistence Enhancement (B30)**
- Consider SQLite for task index
- Better session file management
- Session bindings

**Bước 3.14: ACP Auth Per Provider (B35)**
- Per-provider auth configuration
- Auth state management
- Auth sync on startup

**Bước 3.15: Image Input (B29)**
- Image upload trong chat
- Base64 encoding
- ACP prompt image support

**Bước 3.16: Workspace Session Restore (B33)**
- Tab-based multi-workspace
- Session restore on startup
- Last active tab memory

### Phase 4: Low Priority Features

**Bước 4.1: Deep Link Protocol (B23)**
- Register `eragear://` protocol
- URL routing handler
- Context passing via URL

**Bước 4.2: Web Remote Control (B22)**
- External relay device support
- Remote session management

**Bước 4.3: Bots System (B14)**
- Bot definition + lifecycle
- Bot orchestration

**Bước 4.4: ACP Traffic Proxy (B31)**
- Proxy configuration
- System CA support

**Bước 4.5: Crash Reporting (B25)**
- Sentry integration
- Crash capture + archive
- Error boundary

**Bước 4.6: Auto-Update Enhancement (B24)**
- Verify existing Electron auto-update
- Version check + notification

### Phase 5: Verification

**Bước 5.1: Full Integration Test**
- Run tất cả Success Criteria verification tests
- Fix any failures
- Type check toàn bộ project

**Bước 5.2: Final Audit**
- Run `bun run audit:blockers`
- Manual UI walkthrough
- Verify no regressions

---

## Out of Scope

Những thứ KHÔNG thuộc task này:

- Không thay đổi architecture nền tảng
- Không migrate sang framework khác
- Không thay đổi ACP protocol specification
- Không optimize performance ngoài scope feature parity
- Không viết documentation/user guide (chỉ code)
- Không setup CI/CD mới
- Không touch apps/native (Expo mobile) trừ khi feature yêu cầu

---

## References

- ZCode config: `C:\Users\terasumi\.zcode\v2\setting.json`
- ZCode model providers: `C:\Users\terasumi\.zcode\v2\model-providers.json`
- ZCode CLI config: `C:\Users\terasumi\.zcode\cli\config.json`
- ZCode skills state: `C:\Users\terasumi\.zcode\v2\skills-state.json`
- ZCode logs: `C:\Users\terasumi\.zcode\v2\logs\2026-06-12.log`
- ZCode ACP config: `C:\Users\terasumi\.zcode\v2\acp-config\`
- Eragear architecture: `AGENTS.md`
- Eragear capabilities: `.eragear/capabilities-state.json`
- ACP docs: `apps/server/docs/acp/`

---

## Agent Instructions

### Execution
1. Đọc toàn bộ file này trước khi làm bất kỳ thứ gì
2. Tuân theo Constraints tuyệt đối — không có ngoại lệ
3. Thực hiện Execution Plan theo thứ tự, từng bước một
4. Sau mỗi bước: báo cáo ngắn gọn kết quả trước khi tiếp tục
5. Nếu phát hiện conflict giữa Constraints và Execution Plan: ưu tiên Constraints
6. Nếu gặp thứ gì không có trong GOAL.md: DỪNG và hỏi, không tự assume
7. Khi xong: verify toàn bộ Success Criteria và báo cáo từng item
8. Mỗi feature mới phải tạo đầy đủ: Port → Service → Adapter → Transport → UI

### Anti-bias Instructions (quan trọng khi dùng với `/goal`)

**Chống Scope Shrink:**
- KHÔNG redefine "done" thành subset dễ hơn của objective
- KHÔNG dừng chỉ vì phần còn lại là "polish" hay "không phải execution path"
- Temporary rough edges acceptable — nhưng objective gốc phải đạt đủ

**Chống Uncertainty Stop:**
- KHÔNG dừng vì không chắc một requirement có được fulfill chưa
- Treat uncertain evidence = not achieved → tiếp tục làm, không report và dừng
- Chỉ dừng khi evidence PROVES completion, không phải khi không tìm thấy lý do để tiếp

**Chống Memory Trust:**
- KHÔNG assume đã làm X chỉ vì nhớ đã làm trong turn trước
- Inspect current worktree/file/output thật sự trước khi claim done
- Previous conversation context chỉ là hint — current state là authoritative
