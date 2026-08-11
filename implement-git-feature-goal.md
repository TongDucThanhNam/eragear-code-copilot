# implement-git-feature-goal.md

> File này được tạo bởi create-goal skill.
> Agent thực thi: đọc TOÀN BỘ file này trước khi làm bất kỳ thứ gì.
> Nguồn tham chiếu: T3 Code (`github.com/pingdotgg/t3code`) — clone các tính năng Git, **không copy nguyên mã** mà thích ứng với kiến trúc Eragear (ACP bridge + ports + tRPC).

---

## Objective

Clone 5 tính năng Git cốt lõi của T3 Code vào Eragear Code Copilot, thích ứng với kiến trúc port/adapter và ACP bridge hiện có: (1) auto-checkpoint per turn với git refs, (2) per-turn diff summary, (3) turn-scoped revert + conversation rollback, (4) Git Actions Control (commit/push/PR với protected-branch guard), (5) Branch Toolbar (local vs worktree mode per session) — kết nối vào `packages/runtime/src/modules/git`, `packages/runtime/src/modules/session`, `packages/runtime/src/platform/git`, và UI renderer hiện tại.

---

## Context

- **Lý do**: Eragear hiện có checkpoint **thủ công + post-turn tự động**, nhưng lưu dạng patch binary trong `.eragear/checkpoints/`, không có pre-turn baseline, không có per-turn diff, không có revert kèm conversation rollback, và không có git action UI (commit/push/PR) hay worktree mode cho chat thường. T3 Code đã giải quyết cả 5 bằng git-ref-based checkpoint + orchestration reactor + UI phong phú.
- **Ưu tiên**: correctness > speed. Checkpoint/diff/revert phải an toàn (sandbox project root, permission gates, không mất code user).
- **Người thực hiện**: AI Agent (có human review ở từng phase).
- **Ngày tạo**: 2026-08-09.
- **Nguồn tham chiếu chính**: DeepWiki T3 Code page `5.4.2 Checkpoint System`, `3.3 Git Integration UI`, `5.4 Git Integration Backend`; source `apps/server/src/orchestration/Layers/CheckpointReactor.ts`, `CheckpointStore`, `apps/web/src/components/GitActionsControl.tsx`, `BranchToolbar.tsx`.

---

## Current State (Eragear — đã verify)

| Item | Giá trị |
|------|---------|
| Git module | `packages/runtime/src/modules/git/` (application + contracts + ports + init) |
| Platform adapter | `packages/runtime/src/platform/git/index.ts` — implements `GitCheckpointPort` + `GitRepositoryPort` qua `execFile("git", ...)` |
| Checkpoint storage | **Patch binary** trong `.eragear/checkpoints/` (KHÔNG dùng git refs) |
| Checkpoint kinds | `manual`, `auto`, `safety` (xem `GitCheckpointKindSchema`) |
| Auto checkpoint hiện tại | `git-events.init.ts` subscribe `prompt_turn_completed` → `createAutomaticCheckpoint` — **chỉ post-turn, KHÔNG có pre-turn baseline** |
| `GitCheckpointService` | `createCheckpoint` (manual), `listCheckpoints`, `restoreCheckpoint`, `createAutomaticCheckpoint(input)` |
| tRPC router | `git.ts` = `gitRepositoryRouter` (summary, changes) + `gitCheckpointsRouter` (checkpoints.list/create/restore) |
| `GitRepositorySummary` | branch, head, upstream, ahead, behind, changedFiles[], stagedCount, unstagedCount, untrackedCount, checkedAt |
| Session/ACP | `platform/acp/connection.ts` (ClientSideConnection stdio NDJSON), `session-acp.adapter.ts`, `session-agent-resolver.service.ts` |
| Turn events | `prompt_turn_completed` đã có; `session.types.ts` có `turnId` rải rác trên nhiều event shape |
| Worktree | Chỉ trong `supervisor-orchestration/infra/git-worker-workspace.adapter.ts` (per-attempt) — **chat thường chưa có** |
| Git commit/push/PR | **Không có** — `GitService` chỉ có `getRepositorySummary`, `getChanges` |
| UI | `changed-files-viewer.tsx` (right sidebar, manual checkpoint create/restore + toast), `code-viewer.tsx` (file viewer, không phải diff), `checkpoint.tsx` (ai-elements bookmark UI) |
| Tooling GitPort | `modules/tooling/.../git.port.ts`: getProjectContext, getDiff, readFileWithinRoot |

---

## Target State

| Item | Giá trị |
|------|---------|
| Turn checkpoints | Pre-turn baseline + post-turn checkpoint qua **git refs** `refs/eragear/session-{sessionId}-turn-{n}` (turn 0 = baseline) |
| Per-turn diff | `{ path, kind, additions, deletions }[]` sinh ra sau mỗi turn, broadcast qua event mới `prompt_turn_diff_ready` |
| Revert | Restore về checkpoint turn N + **rollback conversation** tới turn N + xóa stale refs + safety checkpoint |
| VCS status live | Renderer nhận push update khi working tree/status đổi (qua subscription hiện có hoặc event bus) |
| Git Actions | Commit / Push / Commit+Push / Create PR — qua runtime port, UI trong chat header, kèm progress + protected-branch confirm |
| Branch Toolbar | Per-session chọn `local` vs `worktree` (branch `eragear/worktree/*`); đổi mode → stop session hiện tại + spawn lại ở root mới |
| DiffPanel | Scope: Working tree / Branch / Turn; render `FileDiff[]` (path, prevName, type, additions/deletions) |
| Thứ KHÔNG thay đổi | ACP bridge transport, permission gates, project-root sandbox, supervisor-orchestration DAG, tRPC contract shapes hiện có (chỉ mở rộng, không break) |

---

## Constraints

> Agent PHẢI tuân theo tuyệt đối. Vi phạm = rollback.

- [ ] **KHÔNG thay đổi**: kiến trúc port/adapter, `platform/acp/*` (transport ACP), permission gates (`platform/acp/permission.ts`), project-root sandbox check trong `platform/git/index.ts` (`isPathOutsideRoot`).
- [ ] **KHÔNG phá contract**: tRPC shapes hiện tại trong `git.contract.ts` chỉ được **mở rộng** (field optional mới), không xóa/đổi tên field cũ. Patch-based checkpoint hiện tại phải tiếp tục hoạt động (backward-compat) hoặc có migration rõ ràng.
- [ ] **KHÔNG đưa runtime/business rules vào Electron main/preload** — Git ops runtime nằm trong `packages/runtime`, UI gọi qua tRPC preload IPC.
- [ ] **KHÔNG spawn git process từ orchestration application/domain code** — đi qua port (`GitCheckpointPort` / port mới `GitWorkflowPort`). Giữ rule "Domain code must not import transport or infrastructure".
- [ ] **KHÔNG tự động commit/push** nếu không có user action hoặc cài đặt tường minh. Protected branch (default branch: main/master) **luôn** yêu cầu confirmation dialog.
- [ ] **Giữ permission boundary**: tool-call execution & git write ops phải preserve project-root sandbox + permission gates. Worktree mode phải scope đúng root mới.
- [ ] **KHÔNG xóa file cũ** cho đến khi phần tương ứng verify pass. Patch-based checkpoint path giữ lại làm fallback cho tới Phase 5.
- [ ] **Tuân thủ AGENTS.md**: extract first, delete last; update `GOAL_PROGRESS.md` sau mỗi phase.
- [ ] Nếu gặp blocker (ACP không hỗ trợ rollbackConversation, git ref không tạo được do repo rỗng...): **DỪNG và mô tả**, KHÔNG tự workaround bypass permission.
- [ ] Mọi git write op (commit/push/reset/clean/worktree add) phải có structured log + error mapping theo pattern hiện tại (`createLogger`, `toError`).

---

## Feature Specs (T3 reference → Eragear adaptation)

### Feature A — Auto-checkpoint per turn (pre-turn baseline + post-turn)

**T3 reference** (`CheckpointReactor.ts`, `CheckpointStore`):
- Git ref: `refs/t3code/thread-{threadId}-turn-{turnCount}` (turn 0 = pre-conversation baseline).
- `turn.started` → `ensurePreTurnBaselineFromTurnStart`: resolve thread + cwd → build `baselineCheckpointRef` → nếu chưa có thì `captureCheckpoint` → publish `checkpoint.baseline.captured`.
- `turn.completed` → `captureCheckpointFromTurnCompletion` → `captureAndDispatchCheckpoint`: `captureCheckpoint` + `diffCheckpoints(from, to)` + `parseTurnDiffFilesFromUnifiedDiff` → dispatch `thread.turn.diff.complete` + receipts `checkpoint.diff.finalized`, `turn.processing.quiesced`.
- `CheckpointStore.captureCheckpoint`: isolated temp git index, write hidden ref.

**Eragear adaptation**:
- Ref scheme: `refs/eragear/session-{sessionId}-turn-{n}` (turn 0 = baseline trước turn đầu).
- Mở rộng `GitCheckpointPort` với method ref-based: `captureTurnCheckpoint({ projectRoot, sessionId, turnCount, kind: "baseline"|"turn" }) → { ref, commitSha }`. Implement trong `platform/git/index.ts` dùng `git stash`-free isolated index (`GIT_INDEX_FILE` env temp) + `git update-ref` / `git hash-object` + `git mktree` + `git commit-tree` (tạo commit không đụng HEAD/working tree) → `git update-ref <ref> <sha>`.
- Thêm event `prompt_turn_started` (xác nhận event bus có phát chưa; nếu chưa, móc vào session lifecycle — **[cần xác nhận]** chỗ phát turn-start trong `platform/acp/handlers.ts` / `use-chat-session-event-handler.ts`).
- Mở rộng `git-events.init.ts`: subscribe cả `prompt_turn_started` (→ baseline) và `prompt_turn_completed` (→ turn checkpoint + diff, như hiện tại nhưng đổi sang ref-based).
- Receipts: thêm lightweight receipt/ack vào event bus cho `turn.checkpoint.captured`, `turn.diff.finalized` (dùng cho test deterministic — Learning từ T3 `RuntimeReceiptBus`).

### Feature B — Per-turn diff summary

**T3 reference** (`parseTurnDiffFilesFromUnifiedDiff`, `diffCheckpoints`):
- `diffCheckpoints({ cwd, fromRef, toRef, fallbackFromToHead, ignoreWhitespace })` → unified patch.
- Parse → `{ path, kind: "modified", additions, deletions }[]`.

**Eragear adaptation**:
- Mở rộng `GitCheckpointPort`: `diffTurnCheckpoints({ projectRoot, fromRef, toRef, ignoreWhitespace? }) → TurnDiffFile[]`.
- Thêm schema `TurnDiffFileSchema` trong `git.contract.ts`: `{ path: string, oldPath?: string, kind: enum(added/modified/deleted/renamed/copied), additions: number, deletions: number }` (reuse `GitFileStatus` cho kind khi có thể).
- Parser `parseTurnDiffFiles(unifiedDiff: string): TurnDiffFile[]` — pure function trong `application/` + unit test.
- Broadcast diff summary qua event mới `prompt_turn_diff_ready { sessionId, turnCount, files: TurnDiffFile[] }`; renderer subscribe để render inline trong timeline + badge "+X −Y" trên turn.

### Feature C — Turn-scoped revert + conversation rollback

**T3 reference** (`handleRevertRequested`, `restoreCheckpoint`):
1. Validate `turnCount` vs current.
2. Resolve `targetCheckpointRef`.
3. `restoreCheckpoint` (git `reset --hard` + `clean -fd`, optional `fallbackToHead`).
4. Refresh workspace entry index.
5. **Conversation rollback**: `currentTurnCount - targetTurnCount` → `providerService.rollbackConversation(n)`.
6. Delete stale checkpoint refs (`deleteCheckpointRefs`).
7. Dispatch `thread.revert.complete`.

**Eragear adaptation**:
- Mở rộng `GitCheckpointPort`: `restoreTurnCheckpoint({ projectRoot, targetRef, fallbackToHead? }) → { restoredRef, safetyRef? }` — tạo **safety checkpoint** (kind `safety`) trước khi reset (Eragear đã có concept `safetyCheckpoint`).
- `reset --hard` + `clean -fd` **chỉ trong worktree/session root**, giữ sandbox check.
- **Conversation rollback** [cần xác nhận]: kiểm tra ACP SDK có `session.cancel`/history truncate không. Nếu ACP không hỗ trợ rollback n turn, phương án: stop session hiện tại + resume từ checkpoint bằng cách replay history đến turn N (dùng `session-history-replay.service.ts`). **Đây là blocker kỹ thuật cần giải quyết đầu tiên.**
- Delete stale refs `refs/eragear/session-{id}-turn-{>N}`.
- tRPC mutation `git.turnCheckpoints.revert({ sessionId, turnCount })` trong router mở rộng.

### Feature D — Git Actions Control (commit/push/PR)

**T3 reference** (`GitActionsControl.tsx`, `GitActionsControl.logic.ts`, `GitManager`):
- `resolveQuickAction(VcsStatusResult, busy, isDefaultBranch, hasPrimaryRemote) → GitQuickAction { label, disabled, kind, action }`.
- VcsStatusResult: `refName, hasWorkingTreeChanges, pr, aheadCount, behindCount, hasUpstream, isDefaultRef`.
- Multi-step (commit→push→PR): `runGitActionWithToast`, `buildGitActionProgressStages`, `GitActionProgressEvent`, `applyProgressEvent`, toastManager.
- Protected branch: `requiresDefaultBranchConfirmation`, `resolveDefaultBranchActionDialogCopy`.

**Eragear adaptation**:
- **Port mới** `GitWorkflowPort` trong `modules/git/application/ports/git-workflow.port.ts`: `getStatus`, `commit`, `push`, `commitAndPush`, `createPullRequest`, `runStackedAction(action, onProgress)`. Implement trong `platform/git/` (mở rộng `index.ts` hoặc file mới `workflow.ts`).
- Mở rộng `GitRepositorySummary` (hoặc type mới `VcsStatus`) thêm: `hasUpstream`, `isDefaultRef`, `pr?` (state), `aheadCount`, `behindCount` (một số field đã có: ahead/behind).
- `GitWorkflowService` (application) orchestrate stacked actions, emit progress events qua event bus.
- tRPC router `git.actions.*` (commit/push/pr/commitPushPr) — mutation + subscription progress.
- **PR creation**: cần chọn provider (GitHub/GitLab/Bitbucket) — **[cần quyết định]**: MVP = GitHub only qua `gh` CLI hoặc REST; flag provider khác out-of-scope Phase 1.
- UI: component `git-actions-control.tsx` trong `chat-ui/` (hoặc `chat-header.tsx`), quick-action button + menu + toast progress + confirmation dialog (dùng pattern `permission-dialog` hiện có cho confirm). Protected branch check dùng `isDefaultRef`.

### Feature E — Branch Toolbar (local vs worktree mode per session)

**T3 reference** (`BranchToolbar.tsx`, `BranchToolbar.logic.ts`):
- `resolveEffectiveEnvMode`: `local` vs `worktree`.
- `resolveBranchToolbarValue`: envMode, activeWorktreePath, activeThreadBranch, currentGitBranch.
- Worktree branch naming: `t3code/worktree/*`.
- `persistThreadBranchSync`: sync thread metadata với branch.
- Orchestration stop/update session khi branch/worktree đổi.

**Eragear adaptation**:
- Branch naming: `eragear/worktree/*`.
- Port method: `GitWorkflowPort.createWorktree({ projectRoot, branchName? }) → { worktreePath, branchName }`; `removeWorktree`, `listWorktrees`. Eragear đã có `git-worker-workspace.adapter.ts` trong supervisor-orchestration — **reuse logic tạo worktree** nếu có thể extract ra port chung.
- Per-session env mode metadata: thêm `envMode: "local" | "worktree"` + `worktreePath?` vào session metadata (kiểm `session/application/` xem metadata shape — **[cần xác nhận]**).
- Khi đổi mode: stop session hiện tại (`session-lifecycle` service) → spawn lại ở root mới (local = project root, worktree = worktreePath) qua `bootstrap-session-connection.service.ts`.
- `resolveEffectiveEnvMode` / `resolveBranchToolbarValue` = pure functions trong `chat-ui/` + unit test.
- UI: `branch-toolbar.tsx` trong `chat-header.tsx` hoặc context rail.

---

## Success Criteria

> Mỗi tiêu chí PHẢI có evidence. `/goal` chỉ complete khi evidence PROVES.

### Required Evidence per Criterion

| # | Tiêu chí | Verification Command | Expected Output / Signal |
|---|----------|---------------------|--------------------------|
| A1 | Pre-turn baseline checkpoint tạo ref khi turn start | `bun test packages/runtime/src/modules/git/init/git-events.init.test.ts` | Test mới pass: mock `prompt_turn_started` → assert `captureTurnCheckpoint(kind:"baseline")` called + ref `refs/eragear/session-{id}-turn-{n}` created |
| A2 | Post-turn checkpoint ref-based + diff | `bun test packages/runtime/src/platform/git/index.test.ts` | Test pass: sau `prompt_turn_completed`, ref `...-turn-{n+1}` tồn tại, `diffTurnCheckpoints(turn-n, turn-(n+1))` trả non-empty diff |
| B1 | Per-turn diff parser đúng | `bun test packages/runtime/src/modules/git/application/turn-diff-parser.test.ts` (file mới) | Parser map unified diff → `TurnDiffFile[]` đúng additions/deletions/kind cho các case: add/modify/delete/rename |
| B2 | Diff summary broadcast tới renderer | `bun test apps/desktop/src/renderer/hooks/use-chat-session-event-handler.test.ts` | Test pass: event `prompt_turn_diff_ready` → state update với files[] |
| C1 | Revert restore working tree | `bun test packages/runtime/src/platform/git/index.test.ts` | Test pass: `restoreTurnCheckpoint(ref)` → `git status` clean tại ref, safety checkpoint created |
| C2 | Revert + conversation rollback không crash | `bun test packages/runtime/src/modules/session/application/` (test revert flow) | Test pass: session history truncated/replayed đến turn N, không throw |
| D1 | Git workflow port methods chạy | `bun test packages/runtime/src/platform/git/workflow.test.ts` (file mới) | commit/push/commitPush tạo commit/push đúng (dùng temp git repo fixture) |
| D2 | resolveQuickAction heuristic đúng | `bun test apps/desktop/src/renderer/components/chat-ui/git-actions-control.logic.test.ts` (file mới) | Pure fn trả đúng action cho matrix VcsStatus (dirty+PR, clean+ahead, default branch...) |
| D3 | Protected branch confirm | `bun test apps/desktop/src/renderer/components/chat-ui/git-actions-control.test.tsx` | Test pass: action lên default branch → confirmation dialog render |
| E1 | resolveEffectiveEnvMode/BranchToolbarValue đúng | `bun test apps/desktop/src/renderer/components/chat-ui/branch-toolbar.logic.test.ts` (file mới) | Pure fn đúng cho local/worktree/no-worktree/branch-changed cases |
| E2 | Worktree mode spawn session ở root mới | `bun test packages/runtime/src/modules/session/` (test mode switch) | Test pass: đổi envMode → session stop + bootstrap ở worktreePath |
| V1 | Type check toàn repo | `bun run --cwd packages/runtime check-types && bun run --cwd apps/desktop check-types` | Exit 0 |
| V2 | Biome không warning | `bunx biome check packages/runtime/src/modules/git packages/runtime/src/platform/git apps/desktop/src/renderer/components/chat-ui --error-on-warnings` | Exit 0 |
| V3 | Không regression blocker tests | `bun run audit:blockers` | Exit 0 |
| V4 | Smoke desktop chạy | `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop` | App boot, không crash, git panel render |

### Completion Condition

Agent kết thúc khi và chỉ khi:
- [ ] Tất cả verification commands (A1–E2, V1–V4) pass với expected output.
- [ ] 5 feature (A–E) đều có test pass.
- [ ] Không regression: `audit:blockers`, check-types, biome pass.
- [ ] Patch-based checkpoint cũ vẫn hoạt động (backward-compat) HOẶC có migration + ghi rõ trong `GOAL_PROGRESS.md`.
- [ ] `GOAL_PROGRESS.md` cập nhật: changed files, verification commands đã chạy, remaining work.

---

## Execution Plan

> Thực hiện theo thứ tự phase. Báo cáo sau mỗi phase trước khi tiếp. Mỗi phase phải verify trước khi sang phase sau.

### Phase 0 — Investigation & blockers (BẮT BUỘC trước khi code)
1. Xác nhận event `prompt_turn_started` (hoặc tương đương) có được phát trên event bus không. Nếu chưa → xác định điểm phát trong `platform/acp/handlers.ts`.
2. **Blocker check Feature C**: kiểm ACP SDK (`@agentclientprotocol/sdk`) có API rollback/truncate conversation history không. Nếu KHÔNG → thiết kế fallback (stop + replay history đến turn N) và ghi decision vào `GOAL_PROGRESS.md`.
3. Kiểm session metadata shape (`session/application/`) để thêm `envMode`/`worktreePath`.
4. Quyết định PR provider (Feature D): MVP = GitHub qua `gh` CLI hay REST? Ghi decision.
5. Quyết định: ref-based checkpoint **thay thế** hay **song song** patch-based hiện tại? Khuyến nghị: song song Phase 1–4, migration Phase 5.

### Phase 1 — Ref-based checkpoint core (Feature A + B backend)
1. Mở rộng `git.contract.ts`: thêm `TurnDiffFileSchema`, `captureTurnCheckpoint` input/output schemas.
2. Mở rộng `GitCheckpointPort` (port): `captureTurnCheckpoint`, `diffTurnCheckpoints`, `restoreTurnCheckpoint`, `deleteTurnCheckpointsAfter`.
3. Implement trong `platform/git/index.ts`: isolated git index (`GIT_INDEX_FILE`), `git hash-object | mktree | commit-tree | update-ref`. Pure parser `parseTurnDiffFiles` trong `application/`.
4. Unit test: capture/diff/restore/parse với temp git repo fixture.
5. Verify: V1 (check-types runtime) + A1, A2, B1.

### Phase 2 — Event wiring + revert (Feature A/B/C backend)
1. Mở rộng `git-events.init.ts`: subscribe turn-start (baseline) + turn-completed (turn checkpoint + diff). Emit `prompt_turn_diff_ready`.
2. Implement revert flow: `restoreTurnCheckpoint` + safety checkpoint + conversation rollback (theo decision Phase 0.2) + delete stale refs + emit `session.reverted`.
3. tRPC router mở rộng: `git.turnCheckpoints.list/create/revert/diff` (giữ router cũ backward-compat).
4. Verify: A1, A2, B2, C1, C2.

### Phase 3 — Git Actions Control (Feature D)
1. Port mới `GitWorkflowPort` + service `GitWorkflowService` + implement trong `platform/git/workflow.ts` (getStatus/commit/push/commitPush/createPullRequest/runStackedAction + progress events).
2. tRPC `git.actions.*` mutation + progress subscription.
3. UI `git-actions-control.tsx` + `git-actions-control.logic.ts` (resolveQuickAction, requiresDefaultBranchConfirmation, resolveDefaultBranchActionDialogCopy) + toast progress + confirm dialog.
4. Verify: D1, D2, D3, V2.

### Phase 4 — Branch Toolbar + DiffPanel UI (Feature E + B UI)
1. Worktree ops: `GitWorkflowPort.createWorktree/removeWorktree/listWorktrees` (reuse logic từ `git-worker-workspace.adapter.ts` nếu extract được).
2. Session metadata: thêm `envMode`/`worktreePath`; mode switch → stop + bootstrap lại.
3. UI `branch-toolbar.tsx` + `.logic.ts` (resolveEffectiveEnvMode, resolveBranchToolbarValue, persistThreadSync).
4. UI `DiffPanel` (scope: working tree / branch / turn) + `FileDiff` render (mở rộng `code-viewer.tsx` hoặc component mới).
5. Wire diff summary từ Feature B vào timeline (badge per turn).
6. Verify: E1, E2, B2, V2.

### Phase 5 — Migration, cleanup, full verification
1. Migration patch-based → ref-based (nếu Phase 0.5 chọn replace): migrate `.eragear/checkpoints/*` → git refs, hoặc giữ fallback.
2. Update `AGENTS.md` (section Local ADE / Git) + `GOAL_PROGRESS.md`.
3. Full verification: V1, V2, V3, V4 + toàn A1–E2.
4. Documentation note: feature flag nếu cần.

---

## Out of Scope

- **KHÔNG** thay đổi ACP transport (`platform/acp/connection.ts`).
- **KHÔNG** sửa supervisor-orchestration DAG (chỉ reuse worktree logic nếu extract được).
- **KHÔNG** thêm provider PR ngoài GitHub ở Phase 1 (GitLab/Bitbucket = sau).
- **KHÔNG** viết lại Remote Connect.
- **KHÔNG** optimize performance ngoài scope Git features.
- **KHÔNG** thêm MCP/Project Index thay đổi.
- **KHÔNG** thêm test framework mới (dùng `bun test` hiện tại).

---

## References

- **T3 Code (DeepWiki)**:
  - https://deepwiki.com/pingdotgg/t3code#5.4.2 — Checkpoint System
  - https://deepwiki.com/pingdotgg/t3code#3.3 — Git Integration UI
  - https://deepwiki.com/pingdotgg/t3code#5.4 — Git Integration Backend
- **T3 Code source paths** (tham khảo logic, không copy nguyên):
  - `apps/server/src/orchestration/Layers/CheckpointReactor.ts`, `CheckpointStore`
  - `apps/web/src/components/GitActionsControl.tsx`, `GitActionsControl.logic.ts`
  - `apps/web/src/components/BranchToolbar.tsx`, `BranchToolbar.logic.ts`
  - `apps/server/src/git/GitManager.ts`, `GitVcsDriverCore`
- **Eragear files cần đọc trước khi code**:
  - `packages/runtime/src/modules/git/application/git-checkpoint.service.ts` (logic checkpoint hiện tại)
  - `packages/runtime/src/modules/git/init/git-events.init.ts` (event hook hiện tại)
  - `packages/runtime/src/platform/git/index.ts` (adapter — nơi implement ref-based)
  - `packages/runtime/src/modules/git/application/contracts/git.contract.ts` (schemas)
  - `packages/runtime/src/modules/session/infra/session-acp.adapter.ts` + `session/application/session-history-replay.service.ts` (rollback context)
  - `packages/runtime/src/modules/supervisor-orchestration/infra/git-worker-worktree.adapter.ts` (worktree logic reusable)
  - `apps/desktop/src/renderer/components/right-sidebar/changed-files-viewer.tsx` (UI checkpoint hiện tại)
  - `AGENTS.md` (Layer Rules, Tool-call/permission boundaries)

---

## Agent Instructions

### Execution
1. Đọc TOÀN BỘ file này + `AGENTS.md` trước khi làm gì.
2. **Phase 0 trước**: giải quyết blocker Feature C (ACP rollback) và các decision trước khi viết code feature.
3. Tuân theo Constraints tuyệt đối — không ngoại lệ. Ưu tiên Constraints > Execution Plan khi conflict.
4. Thực hiện theo Phase (0→5), từng phase verify xong mới sang phase sau.
5. Sau mỗi phase: báo cáo ngắn gọn + cập nhật `GOAL_PROGRESS.md` (changed files, commands đã chạy, remaining work).
6. Gặp thứ không có trong GOAL này → **DỪNG và hỏi**, không tự assume.
7. Khi xong: verify toàn bộ Success Criteria (A1–E2, V1–V4) + báo cáo từng item.

### Anti-bias Instructions (quan trọng với `/goal`)

**Chống Scope Shrink:**
- KHÔNG redefine "done" thành subset dễ hơn (VD: bỏ conversation rollback, chỉ restore file).
- KHÔNG dừng vì phần còn lại là "polish UI". Objective gốc = 5 feature đầy đủ.
- Temporary rough edges (VD: PR provider chỉ GitHub) OK miễn ghi rõ trong Out of Scope/decision.

**Chống Uncertainty Stop:**
- KHÔNG dừng vì "không chắc ACP có rollback không" → đó là task Phase 0 phải điều tra, KHÔNG phải lý do dừng.
- Treat uncertain evidence = not achieved → tiếp tục điều tra/implement.

**Chống Memory Trust:**
- KHÔNG claim "đã làm X" chỉ vì nhớ. Inspect worktree/test output thật.
- Trước mỗi claim done: chạy verification command thật sự, paste output.

**Chống Workaround Bypass:**
- KHÔNG bypass permission gates / project-root sandbox để cho feature chạy.
- Nếu feature cần bypass boundary → đó là design bug, DỪNG và báo.
