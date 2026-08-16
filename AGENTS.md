# Eragear Code Copilot - Agent Guide

This repository is migrating to an Electron-first architecture. Treat
`GOAL.md` as the source of truth during the active migration.

## Current Target Architecture

```text
apps/desktop
  Electron main/preload/renderer
  native lifecycle, IPC bridge, diagnostics, Remote Connect

apps/native
  Expo mobile client
  imports API contracts from packages only

packages/runtime
  ACP bridge, session lifecycle, tool calls, permissions, settings,
  persistence, background tasks, and runtime service entrypoints

packages/api-contract
  client-visible API types and router contracts

packages/shared, packages/config
  shared domain contracts and config
```

Electron main owns lifecycle and native integration only. Do not move runtime or
business rules into main or preload. Renderer access to privileged operations
must stay behind preload/contextBridge IPC with `contextIsolation: true` and
without renderer Node integration.

## Layer Rules

- Transport validates and maps input, then calls application services.
- Application services orchestrate domain behavior through ports.
- Domain code must not import transport or infrastructure.
- Infrastructure implements IO and policy adapters.
- Package consumers should import contracts from packages, never from another
  app's internals.
- Tool-call execution must preserve project-root sandbox checks and permission
  boundaries.

## Common Commands

```powershell
# Install deps
bun install

# Product development targets
bun run dev
bun run dev:desktop
bun run dev:native

# Desktop dev starts from port 3001 by default, auto-selects the next free
# loopback port when busy, and can be nudged with ERAGEAR_DESKTOP_RENDERER_PORT.

# Desktop smoke run
$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop

# Desktop runtime smoke with prompt wait
$env:ERAGEAR_DESKTOP_SMOKE_PROMPT_WAIT_MS='12000'; bun run --cwd apps/desktop ./scripts/smoke-desktop-runtime.ts

# Type checks and builds
bun run --cwd apps/desktop check-types
bun run --cwd apps/desktop build:main
bun run --cwd apps/desktop build:renderer
bun run --cwd apps/native ui-map
bun run --cwd packages/runtime check-types
bun run --cwd packages/api-contract check-types
bun run build
bunx biome check packages apps/desktop apps/native --error-on-warnings

# Focused formatting / patch hygiene
bunx biome check <paths> --write --error-on-warnings
git diff --check <paths>

# Focused blocker checks
bun run audit:blockers
bun run --cwd packages/runtime test:blockers
bun run --cwd apps/desktop test:blockers

# Supervisos / Goal Mode focused checks
bun test packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.test.ts
bun test packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/transport/trpc/routers/ai-router.test.ts apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.test.ts
bun test packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.test.ts packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-chat.adapter.test.ts packages/runtime/src/modules/supervisor/infra/scope-supervisor-project-intelligence.adapter.test.ts packages/runtime/src/modules/supervisor/infra/filesystem-supervisor-project-context.adapter.test.ts
bun test packages/runtime/src/modules/ai/application/send-message.service.test.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts
bun test packages/runtime/src/config/environment.test.ts packages/runtime/src/modules/settings/app-config.service.test.ts packages/runtime/src/modules/settings/application/update-settings.service.test.ts
bun test packages/runtime/src/modules/supervisor/infra/exa-supervisor-research.adapter.test.ts packages/runtime/src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.test.ts packages/runtime/src/modules/supervisor/init/supervisor-events.init.test.ts
bun test packages/runtime/src/modules/scope-resolution/application/scope-resolver.service.test.ts packages/runtime/src/modules/repo-snapshot-indexing/application/repo-snapshot-indexing.service.test.ts
bun test packages/runtime/src/modules/scope-resolution/application/scope-resolver-v1.test.ts packages/runtime/src/modules/scope-resolution/init/scope-resolution-events.init.test.ts packages/runtime/src/modules/file-watcher/init/file-watcher-events.init.test.ts
bun test packages/runtime/src/modules/goal-mode/application/goal-mode-controller.service.test.ts packages/runtime/src/modules/goal-mode/application/goal-mode-worktree-change.collector.test.ts packages/runtime/src/modules/goal-mode/application/goal-mode-gate.test.ts packages/runtime/src/modules/goal-mode/application/goal-mode-prompt.builder.test.ts packages/runtime/src/modules/goal-mode/application/goal-mode.schemas.test.ts packages/runtime/src/modules/goal-mode/application/goal-mode-metrics.test.ts
bun test apps/desktop/src/renderer/components/chat-ui/mcp-command.test.ts apps/desktop/src/renderer/components/chat-ui/project-index-command.test.ts apps/desktop/src/renderer/components/chat-ui/project-memory-command.test.ts

# Supervisos completion audit searches
# Expect exit 1: no active DeepSeek supervisor wiring.
rg -n "createDeepSeek|@ai-sdk/deepseek|supervisorDeepSeek|DEEPSEEK_API_KEY|deepSeekApiKey|DeepSeek" packages/runtime/src packages/runtime/package.json packages/runtime/settings.schema.json
rg -n "MiniMax-M3|MINIMAX_API_KEY|minimax" packages/runtime/src packages/runtime/settings.schema.json apps/desktop/src
rg -n "v1-import-graph|importGraph|reachability|routeMap|computeGoalMetrics|resolvedViaLLMRate|gateRejectReasons|avgAttemptsPerPhase" packages/runtime/src

# Focused runtime tests that execute commands on PowerShell
$bun=(Get-Command bun).Source; $policy=ConvertTo-Json -InputObject @(@{command=$bun;allowAnyArgs=$true}) -Compress; $env:ALLOWED_AGENT_COMMAND_POLICIES=$policy; $env:ALLOWED_TERMINAL_COMMAND_POLICIES=$policy; $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test <test-paths>

# Migration cleanup checks
Test-Path apps/web; Test-Path apps/server; Test-Path apps/native
# Expect exit 1 when clean: no active legacy app/script/doc references.
rg -n 'dev:web|dev:server|desktop:dev|desktop:build|apps/web|apps/server' package.json turbo.json README.md AGENTS.md apps packages -g '!**/docs/archive/**'
```

## Migration Discipline

- Extract first, delete last.
- Keep `apps/native` preserved.
- Keep runtime/application code in packages.
- Keep API contracts in a package.
- Remove obsolete product folders only after useful code has been extracted or
  moved and verification passes.
- Update `GOAL_PROGRESS.md` after each major phase with changed files,
  verification commands, and remaining work.

## Supervisos And Goal Mode

- Supervisos decision/chat paths use MiniMax-M3 through the runtime package;
  configure a stored MiniMax key or `MINIMAX_API_KEY` before live verification.
- Extra Supervisos instructions and tool steering are runtime settings:
  `SUPERVISOR_CUSTOM_SYSTEM_PROMPT`, `SUPERVISOR_TOOL_POLICY`, and
  `SUPERVISOR_TOOL_ALLOWLIST`. Keep built-in guardrails authoritative; custom
  prompts and allowlists should narrow behavior, not bypass permission gates.
- Optional Supervisos research and memory are settings/env-backed:
  `SUPERVISOR_WEB_SEARCH_PROVIDER=exa` with `SUPERVISOR_WEB_SEARCH_API_KEY` or
  `EXA_API_KEY`, and `SUPERVISOR_MEMORY_PROVIDER=obsidian` with the
  `SUPERVISOR_OBSIDIAN_*` settings.
- Supervisos side chat uses the dedicated `supervisorChat` tRPC mutation, not
  the main ACP `sendMessage` path. Keep side-chat context bounded; do not inject
  raw main transcripts or raw diffs.
- Keep Goal Mode state separate from `SupervisorSessionState`; derive metrics
  from phase/attempt records instead of storing mutable root metrics.
- Goal Mode gates use explicit loop file evidence when available, otherwise
  collect project-root git worktree changes through runtime ports and fail
  closed if neither evidence path is available.
- Scope Resolution owns Project Index and AST import-graph intelligence in
  `packages/runtime`. Keep invalidation and resolver wiring in runtime services,
  not Electron main/preload.
- The Supervisos `AST` quick action depends on repo snapshot indexing, Scope
  Resolution, and the TypeScript AST import graph; refresh Project Index in
  Settings > Memory before live manual checks.
- Supervisos implementation requests return a `stage_main_prompt` action that
  injects the enhanced prompt into the real main `ChatInput`; Autopilot may
  auto-submit only when the active chat is connected and ready, while
  non-Autopilot sessions leave the staged prompt visible for review/edit/send.
- If a Supervisos implementation handoff hits the runtime `PROMPT_BUSY` guard,
  keep the handoff in the renderer as a staged main `ChatInput` prompt rather
  than bypassing the normal chat submit path or changing supervisor mode first.
- After renderer/runtime changes that affect Supervisos side chat or Project
  Index intelligence, restart `bun run dev:desktop` before manual verification.

### Multi-session Supervisos runs

- `SupervisorOrchestratorService` in `packages/runtime` owns the durable
  `SupervisorRunState` DAG. Keep run/task/attempt/gate state out of Electron
  main, preload, renderer stores, and per-session `SupervisorSessionState`.
- Workers must be created through the existing session create/send/stop/resume
  services with prompt source `orchestrator`. Do not spawn an agent process from
  orchestration application/domain code.
- Write attempts run directly in the registered project root so ACP loads the
  exact project `AGENTS.md` and other cwd-relative setup. Only one direct write
  worker may own a Git repository at a time, including across Supervisor runs.
- Immediately before a write worker starts, checkpoint the complete Git
  repository with an allow-empty `supervisos: checkpoint before worker ...`
  commit. When the worker terminates, collect the hash-addressed binary diff and
  checkpoint the complete repository again with a
  `supervisos: checkpoint after worker ...` commit before assessing its result.
  Keep these commits even when the result or gate fails so the attempt is
  reviewable and recoverable.
- Integration validates the captured direct-branch diff and checkpoint refs;
  it must never re-apply that diff to the same project. Baseline/ref drift,
  conflicts, unsupported non-Git writes, missing structured evidence, and
  failed aggregate verification all fail closed.
- Configure trusted final checks with
  `SUPERVISOR_ORCHESTRATION_VERIFICATION_COMMANDS` as a JSON array. Optional
  `SUPERVISOR_ORCHESTRATION_MAX_*` settings can only narrow the schema caps.
- Runtime startup reconciles non-terminal runs after session status recovery;
  paused runs stay paused, resumable sessions resume, and stale attempts retry
  only within their persisted budget.
- Focused checks:

```powershell
bun test packages/runtime/src/modules/supervisor-orchestration/domain packages/runtime/src/modules/supervisor-orchestration/application packages/runtime/src/modules/supervisor-orchestration/infra
bun run --cwd packages/runtime test:e2e:supervisor-orchestration
bun run --cwd packages/runtime test:e2e:supervisor-orchestration-cancel
bun test packages/runtime/src/transport/trpc/routers/supervisor-runs.test.ts apps/desktop/src/renderer/components/chat-ui/supervisos-runs.test.tsx apps/desktop/src/renderer/hooks/use-supervisor-runs.test.ts
```

## Remote Connect And Project MCP

- Remote Connect is Electron-main owned. Keep the network bridge in
  `apps/desktop`; the runtime path remains renderer -> preload -> Electron main
  -> desktop-service -> runtime services.
- Remote Connect is disabled by default. Host development uses
  `ERAGEAR_REMOTE_CONNECT_ENABLED=1`, a 32+ character
  `ERAGEAR_REMOTE_CONNECT_TOKEN`, and usually
  `ERAGEAR_REMOTE_CONNECT_TUNNEL_MODE=quick`; client-only development uses
  `ERAGEAR_DESKTOP_MODE=client-only`, `ERAGEAR_REMOTE_SERVER_URL`, and the same
  Remote Connect token.
- Do not send Electron's local trusted auth token to remote callers. The bridge
  validates Remote Connect auth first, then maps successful requests to local
  trusted IPC auth inside Electron main.
- Project-local MCP server config is `.eragear/mcp-servers.json`. Trusted
  project entries are brokered into ACP sessions through Eragear broker
  commands; untrusted or changed fingerprints must stay out of session setup.
- For remote MCP headers, store env-key references such as `headerEnv` instead
  of secret values. Broker diagnostics and audit output must remain redacted.
- Chat `/mcp` commands may invoke only trusted, initialized MCP servers with
  discovered tools. Use `/mcp <tool> {json}` for an unambiguous tool, or
  `/mcp <server>/<tool> {json} -- follow-up request` / `/mcp --server "<name>"
  <tool> {json}` when multiple servers expose the same tool.

## Local ADE Memory And Index

- Refresh Project Index in Settings > Memory before relying on `/index` or the
  Supervisos `AST` quick action; stale or missing index data should fail with a
  visible no-match/not-ready path instead of fabricating context.
- `/index <query>` searches Project Index and sends matched symbols/tasks to the
  agent. `/memory` queries Project Memory; supported flags include `--semantic`,
  `--full`, `--chunks <n>`, `--source <path>`, and `--preset <id>`.

## Local ADE Git And Worktrees

- Turn checkpoints use hidden `refs/eragear/session-*-turn-*` refs captured
  with an isolated Git index. Keep the existing patch checkpoints in
  `.eragear/checkpoints/` available for manual create/list/restore; they are
  the backward-compatible fallback and must not be deleted by ref cleanup.
- Prompt turn start captures the baseline before ACP work begins. Prompt turn
  completion captures the next ref, computes the turn diff, and broadcasts
  `prompt_turn_diff_ready`; keep these lifecycle notifications awaited and in
  order.
- Turn revert restores files and conversation together: create a safety ref,
  restore only inside the owned session root, stop the old runtime, truncate
  persisted history, clear the stale ACP session id, start a fresh runtime
  under the same local chat id, then delete later turn refs.
- Git actions are explicit authenticated user mutations. For Supervisor runs,
  approving the displayed plan explicitly authorizes its direct-branch
  before/after worker checkpoints and final commit, including on the displayed
  default branch. Other default-branch Git workflows still require
  `confirmDefaultBranch: true`; PR creation is GitHub-only via non-interactive
  `gh pr create` for this implementation.
- Normal chat worktrees are persistent and stored under Eragear storage on
  `eragear/worktree/*` branches. Environment switching must create/verify the
  target root before stopping the session, then restart the same chat through
  the existing session create service. Do not auto-remove worktrees when
  switching back to local mode.
- Session-root-aware Git operations resolve the persisted, user-owned chat
  before using a worktree path. Never expose the internal trusted worktree root
  override through tRPC, and never accept an arbitrary renderer filesystem
  path for checkpoint, workflow, or branch-diff operations.

## External Project Launchers

- Opening a project in external desktop apps is Electron-main owned. Keep OS
  launcher code in `apps/desktop/src/external-project-apps.ts`, exposed through
  preload IPC only; do not route these local shell launches through runtime.
- Supported launcher targets are `zed`, `vscode`, `antigravity`, `warp`,
  `github-desktop`, `file-explorer`, `terminal`, and `git-bash`. Validate target
  names before invoking Electron main, and require `projectPath` to resolve to an
  existing directory.
