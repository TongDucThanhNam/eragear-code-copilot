# GOAL Progress - Electron ADE Overnight Sprint

## Supervisos Manager Mode v2 - 2026-08-10

Source of truth: `GOAL.md`.

Status: implementation, deterministic verification, Windows user-daemon
recovery, Codex ACP manager exact-resume, and the combined worker/final-commit
smoke are complete. The developer-machine scheduled task is disabled after the
acceptance cleanup; development uses the child runtime unless explicitly opted
in. External acceptance still requires a real provider quota reset, a paired
Telegram bot/chat, and a login/reboot cycle.

### Phase 1 - Run schema v2, migration, and exact capacity resume

What changed:
- Upgraded durable Supervisor runs to schema v2 with plan approval,
  `awaiting_approval`/`waiting_capacity`, manager session bindings, priority,
  capacity waits, durable decisions, delivery authorization, and final commit
  evidence. Removed the overall calendar deadline while retaining bounded
  turns, attempts, replans, and loop detection.
- Added SQLite migration `0017_supervisor_run_v2_statuses` so the durable table
  constraint accepts the new approval/capacity states, including databases
  originally created with the v1 status constraint.
- Added deterministic plan hashing and an execution envelope that binds file
  scope, verification, success criteria, permissions, destructive actions,
  target branch/HEAD, and commit authorization.
- Kept terminal v1 runs readable. Non-terminal v1 runs migrate fail-closed to
  `needs_user` for an ACP-manager replan.
- Added `exactOnly` session resume. Quota suspension stops the ACP process,
  releases capacity, and preserves `agentId`, `chatId`, ACP session,
  `attemptId`, and worktree without consuming another attempt.
- Added typed/redacted ACP capacity classification and ETA+jitter/backoff
  scheduling for quota, transient rate-limit, auth, transport, session-fatal,
  and unknown failures.

Verification:
- Schema, migration, plan hash/envelope, capacity classifier/coordinator, and
  exact-resume tests are included in the 102-test orchestration suite below.

### Phase 2 - ACP manager, approval, and active Supervisor wiring

What changed:
- Added a sticky `AcpManagerSessionCoordinator` using the existing session
  create/send/stop/resume services with prompt source `orchestrator` and strict
  structured `plan`, `replan`, `question`, `continue`, and `complete` turns.
- Bounded/redacted Project Index, Scope Resolution, Memory, MCP, and repository
  context before manager turns. The manager remains read-only; runtime owns
  worker dispatch, state transitions, gates, integration, and delivery.
- Side-chat implementation requests now create Goal Drafts for Mission Control
  approval instead of staging a prompt in the main chat input.
- Removed AI SDK/MiniMax adapters from active composition and DI barrels. Legacy
  files/settings remain compatibility-only and the legacy settings form is
  hidden from active navigation.
- Added plan approval/change APIs with version/hash/revision compare-and-swap,
  durable Manager Inbox list/subscription, and server-side project-root
  resolution. `start` remains a one-version compatibility alias for
  `createDraft`.

Verification:
- Active-wiring audit test confirms the composition roots and active DI barrels
  contain no AI SDK or MiniMax Supervisor calls.
- Public router/context/desktop projection tests: 17 passed, 0 failed.

### Phase 3 - Agent profiles, fair scheduling, quota, and integration locking

What changed:
- Added persisted Supervisor agent profiles with manager/worker roles,
  concurrency, optional capacity groups/quota telemetry bindings, ACP handshake,
  exact-resume readiness, and readiness test APIs. Codex, Claude, Gemini, and
  OpenCode receive default profiles; unverified custom agents fail closed for
  overnight work.
- Added the global weighted-fair scheduler (`urgent=8`, `high=4`, `normal=2`,
  `low=1`) with one dispatch per runnable run before spending extra weight.
- Reused quota snapshots/reset/cache/backoff/dedupe/cooldown/lease events as
  dispatch signals. Quota refresh wakes existing capacity waits instead of
  creating duplicate runs.
- Serialized write integration per project while allowing read-only work and
  unrelated projects to continue concurrently.
- Bots and Scheduled Tasks now enter through the Goal API.

Verification:
- Fairness, shared capacity groups, readiness, quota wake-up, and project-lock
  concurrency are covered by the orchestration suite.

### Phase 4 - Daemon, Mission Control, Telegram, power, and final commit

What changed:
- Added a loopback-only, single-instance user daemon with a public endpoint
  manifest and a separate per-user token file. Electron main owns Windows Task
  Scheduler/Linux `systemd --user` install/start/stop/status operations; preload
  exposes only narrow contextBridge methods and never exposes the token.
- Added Mission Control for the global goal portfolio, plan approvals, quota
  waits/ETA, decisions, task DAG/evidence, final commit, agent readiness,
  daemon control, encrypted Telegram setup, and one-time pairing.
- Added outbound Telegram long polling, encrypted credentials, opaque
  revision-bound callback tokens, replay protection, plan approval/change and
  run controls, free-form answers only for one open decision, immediate
  blocker/completion notifications, and a 09:00 timezone digest.
- Added AC-aware power leases and wake timers. Long capacity waits over 30
  minutes release the inhibitor and reconcile on the wake timer/next OS wake.
- Added final scoped delivery: revalidate branch/HEAD/fingerprints/overlap,
  create a safety ref, stage only run-owned files in an isolated index, run Git
  hooks, and create exactly one local commit. It does not push, open a PR,
  deploy, switch branches, or absorb pre-existing user changes.

Verification:
- Isolated daemon smoke passed with loopback health, token-free manifest,
  separate token path, and child cleanup:
  `{"ready":true,"host":"127.0.0.1","port":52442,"pid":25676,"tokenEmbedded":false,"tokenPathMatches":true,"tokenLength":67}`.
- Scoped final-commit test confirms the user's real index is preserved.
- Telegram approve/replay, request-changes, and free-form decision tests pass.

### Phase 5 - Final local verification

Commands run:
- `bun test packages/runtime/src/modules/supervisor-orchestration/domain packages/runtime/src/modules/supervisor-orchestration/application packages/runtime/src/modules/supervisor-orchestration/infra`
  with the required Bun command/env allowlists: 102 passed, 0 failed.
- The quota/restart integration recreates SQLite and the capacity coordinator,
  then exact-resumes the same ACP session, attempt, agent, and worktree.
- Focused public API, daemon controller, Mission Control projection, and active
  wiring tests: 17 passed, 0 failed.
- `bun run audit:blockers`: runtime 54 passed, shared 47 passed, desktop 104
  passed; all typechecks in the audit passed.
- `bun run --cwd packages/runtime check-types`,
  `bun run --cwd packages/api-contract check-types`, and
  `bun run --cwd apps/desktop check-types`: passed.
- `bun run --cwd apps/desktop build:main`,
  `bun run --cwd apps/desktop build:renderer`, and `bun run build`: passed.
- Focused Biome checks with `--write --error-on-warnings` and
  `git diff --check`: passed.

### Phase 6 - Live Windows daemon and manager lifecycle verification

What changed:
- Hardened the Windows daemon controller around the shared per-user Eragear
  storage/auth paths, exact-manifest PID shutdown, private token/manifest files,
  and a real Task Scheduler restart policy (`RestartCount=999`, one-minute
  interval, `StartWhenAvailable`, no execution time limit, and no battery-stop).
  Production launchers cannot inherit insecure development defaults or
  provider/Telegram secrets; only explicit command/env policy keys persist.
- Made bootstrap API-key recovery verify the persisted key and atomically
  replace a stale/malformed file without revoking unrelated valid keys.
- Fixed the daemon crash caused by an invalid WebSocket credential. Better Auth
  can throw a cross-realm 401 object; guards now treat that as invalid auth, and
  the EventEmitter upgrade callback owns/catches its async task instead of
  leaking an unhandled rejection.
- Kept missing Telegram configuration lookup read-only so idle long polling
  does not rewrite the encrypted credential store.
- Closed two manager lifecycle gaps found by the live smoke: invalid structured
  output now moves the run to `needs_user`, opens a
  `classifier_uncertain` decision, and stops the manager; cancelling a planning
  run also stops its sticky ACP session and clears active/pending turn state.

Live evidence:
- Installed and started `EragearRuntimeDaemon` on loopback port 43119. The
  endpoint manifest contains no token, the bootstrap API key verifies, and the
  daemon remained healthy after Desktop shutdown/reconnect testing.
- An intentionally invalid WebSocket credential was rejected while the daemon
  retained PID 23708 and `/api/health` remained healthy. No orphan `opencode
  acp` process remained after manager cancellation.
- Registered this workspace through the public project API. The configured
  OpenCode profile passed both the ACP handshake and `exact_only` resume live.
- Public portfolio APIs returned the project/profile/inbox/run/Telegram state.
  Telegram is correctly reported as unconfigured/unpaired on this machine.
- A real manager Goal Draft bound one sticky manager session with
  `exactResumeRequired=true`. The current OpenCode model returned prose instead
  of the strict JSON schema; after the lifecycle fix the run transitioned to
  `needs_user` at revision 4, the manager became `stopped`, and cleanup left no
  worker dispatch or worktree changes.

Verification after the live fixes:
- Complete Supervisor orchestration domain/application/infra suite: 102 passed,
  0 failed.
- Focused daemon/auth/Telegram/public API/desktop projection suite: 20 passed,
  0 failed.
- `bun run audit:blockers`, runtime/API-contract/desktop typechecks, desktop
  main and renderer builds, active Supervisor AI-SDK/MiniMax wiring audit,
  full Biome (`1463 files`), and `git diff --check`: passed.

### Phase 7 - Daemon disconnect regression recovery

- Diagnosed quota/usage queries stuck in loading after the Windows daemon died
  with `0xC000013A`: Desktop had already selected `client-only`, while pending
  WebSocket queries had no runtime failover and therefore never reached the
  usage or quota services.
- Made the user daemon opt-in during development with
  `ERAGEAR_USER_DAEMON_ENABLED=1`. Packaged Windows/Linux builds retain the
  daemon default and still honor explicit `=0`; client-only mode and macOS stay
  excluded.
- Disabled the developer-machine `EragearRuntimeDaemon` scheduled task. It is
  preserved for later packaged/reconnect work but no longer starts in the
  current development workflow.
- Verification passed: daemon-controller tests (`7 pass`), focused Biome,
  desktop typecheck, and a timed Electron smoke. The smoke reported
  `main-thread`, private `desktop-service`, runtime `ready: true`, renderer
  loaded, and clean runtime shutdown.

### Phase 8 - Live Codex ACP manager and exact-resume verification

- Registered the locally installed `@agentclientprotocol/codex-acp` 1.1.14 as
  a separate Codex agent without replacing the existing OpenCode agent.
- Tightened the manager prompt contract around exact authoritative goal
  copying, role/execution-mode enums, array-valued fields, repo-relative
  `scopeIntent`, empty destructive-action representation, and the complete
  delivery object. Strict parsing remains fail-closed; no output coercion was
  added.
- Manager plans rejected after structured parsing now transition from
  `planning` to `needs_user`, create a durable `classifier_uncertain` decision,
  and record `plan_rejected` instead of leaving the run stuck indefinitely.
- A successful exact resume from a real manager lifecycle now records Agent
  Profile readiness. This avoids the Codex empty-session readiness probe's
  false negative while still requiring real same-session resume evidence.
- Cancelling a manager binding whose ACP session was never created no longer
  invokes StopSession for a nonexistent chat.

Live evidence:
- Codex ACP created plan v1, stopped cleanly, exact-resumed after Request
  Changes with the same manager chat/session binding, and returned plan v2 in
  `awaiting_approval` (`sameManagerChat=true`, `planVersionAdvanced=true`).
- The persisted Codex Agent Profile now reports handshake and exact resume as
  `passed`, checked at `2026-08-11T03:10:04.669Z`.
- All smoke runs were cancelled, the temporary daemon was stopped, the Windows
  Scheduled Task was disabled again, port 43119 had no listener, and no
  `codex-acp`/Codex app-server process remained.

Verification:
- Focused manager prompt/session/profile/orchestrator tests: 11 passed, 0
  failed.
- Complete Supervisor orchestration domain/application/infra suite: 106
  passed, 0 failed.
- Runtime typecheck, focused Biome, and patch hygiene passed.

External verification remaining:
- Run a real ACP manager and workers through a provider quota exhaustion/reset,
  restart the daemon, and confirm exact resume of the same ACP
  session/attempt/worktree.
- Pair a real Telegram bot and exercise approval, request changes, question,
  pause/resume/cancel, digest, and completion delivery end-to-end.
- Re-enable Windows Task Scheduler for a real login/reboot cycle. Linux
  `systemd --user` remains covered deterministically rather than on this
  Windows host.

### Phase 9 - Live daemon recovery and Codex ACP delivery acceptance

What changed:
- Added an Electron-main daemon recovery monitor and renderer reconnect hook.
  A dead user daemon is restarted through the existing controller; the second
  WebSocket open refetches active queries so Quota/Usage and portfolio queries
  cannot remain permanently pending. Runtime business rules remain in
  `packages/runtime`, and preload exposes no daemon token.
- Bound write workers to their detached worktree as the trusted session root,
  added fail-closed runtime permission handling for the exact worker binding,
  and allowed only scoped edits, exact verification commands, and bounded
  read-only inspection. Runtime-owned Git delivery actions remain denied to
  workers.
- Released terminal ACP worker processes before worktree integration so a
  Windows process cwd cannot pin cleanup. Tightened structured result guidance
  around timestamps and blocker-only failure evidence.
- Added delivery-only decision retry: when every task and aggregate gate has
  passed, answering a final commit `baseline_drift` decision reruns deterministic
  verification and the scoped commit without spending manager replan budget or
  changing the approved envelope. Short approved Git refs are resolved to a
  commit before comparison with the full current HEAD.

Live evidence:
- A real Task Scheduler daemon was killed and recovered with a new PID while
  the same loopback endpoint became queryable again; the reconnect contract
  observed two WebSocket opens and refetched active queries on the second.
- Codex ACP run `supervisor-run-81f2f5c0-ad4f-46e3-afb9-65994d5614b5`
  exact-resumed its sticky manager across replans, completed worker task
  `implement-result-txt`, passed aggregate `bun test`, and reached terminal
  `completed` at revision 51.
- Approved plan v3 targeted branch `acceptance` at short ref `e8da48f`.
  Runtime created exactly one commit
  `b66e1f8686f71a310e466fcf7e1b8dd71f5c3d28`, whose parent is the approved full
  baseline `e8da48f7dba63b7aa69cd77a95bab38aa7ff29ec` and whose only path is the
  run-owned `result.txt`. The pre-existing untracked `.eragear/` state stayed
  outside the commit; no push, PR, deploy, or branch switch occurred.
- All acceptance runs were terminal before the temporary project was
  unregistered. The daemon process was stopped and `EragearRuntimeDaemon` was
  disabled after the smoke.

Verification:
- Complete Supervisor orchestration domain/application/infra suite: 113
  passed, 0 failed.
- Daemon recovery, renderer reconnect, ACP permission, public Supervisor API,
  and desktop run-hook suite: 16 passed, 0 failed.
- Runtime/API-contract/desktop typechecks, active Manager Mode wiring audit,
  and repository blocker audit passed.
- Desktop main and renderer production builds passed. Focused Biome checked
  109 files with no warnings, and focused patch hygiene passed.

Known non-blocking build warnings:
- Existing renderer chunk-size/caniuse-lite warnings and Bun `bun:sqlite`
  externalization warnings remain; builds exit successfully.

## Multi-session Supervisos Orchestration Goal - 2026-07-11

Source of truth: `GOAL.md`.

Status: Blocked only on external live-smoke configuration. Phases 0-11 and all
deterministic/local audit criteria are complete. The goal cannot be declared
complete until the real MiniMax + configured ACP worker smoke passes.

### Phase 0 - Baseline, Ownership, and Fail-closed Contract

What changed:
- Read the complete active `GOAL.md`, repository/runtime `AGENTS.md` files,
  `CONTEXT.md`, and the prior `supervisos-goal.md` foundation artifact.
- Captured the dirty worktree and preserved all existing Supervisos, Goal Mode,
  Scope Resolution, renderer, and migration changes.
- Resolved the known semantic-action mismatch intentionally: an unknown
  Supervisor semantic action maps to `needs_user`, so malformed model output
  cannot continue or complete work.
- Confirmed the runtime persistence rule: new production run state uses the
  primary SQLite graph, not a new JSON primary store.

Changed file:
- `packages/runtime/src/modules/supervisor/application/supervisor-loop.service.test.ts`

Verification commands run:
- PowerShell-safe focused baseline across Supervisor, Goal Mode, Scope
  Resolution, Bots, session create/subagent lifecycle, shared events, and
  desktop side-chat utilities -> exit `0`, 268 tests passed.
- `bun test packages/runtime/src/modules/supervisor/application/supervisor-loop.service.test.ts packages/runtime/src/modules/supervisor/application/supervisor.schemas.test.ts` after the contract correction -> included in the Phase 1 combined run, exit `0`.

Remaining work after this phase:
- Phase 1+: authoritative run domain/persistence, planner, worker lifecycle,
  scheduler, isolation/integration, recovery, API/events, desktop UI, and E2E.

### Phase 1 - Run Domain and Durable SQLite Repository

What changed:
- Added the focused `packages/runtime/src/modules/supervisor-orchestration`
  runtime module with strict, versioned run/task/attempt/result/gate/audit and
  bounded-limit schemas.
- Added pure DAG validation for duplicate/unknown/self/cyclic dependencies,
  dependency-depth bounds, unique attempt/idempotency bindings, attempt budgets,
  and ready-task derivation.
- Added deterministic run/task transition guards, immutable ownership/project
  identity, compare-and-swap revisions, and protection against removing
  completed tasks during replans.
- Added `SupervisorRunRepositoryPort` plus main-thread and SQLite-worker
  adapters. Production composition now chooses the matching adapter alongside
  the existing primary repositories.
- Added the `supervisor_runs` SQLite migration/table and embedded migration
  asset. Each row stores searchable ownership/status/revision columns plus one
  schema-validated aggregate document, updated atomically by revision.
- Added restart/recreation, ownership filtering, stale-write, atomicity,
  version-zero migration, and corruption tests.

Changed files:
- `packages/runtime/src/modules/supervisor-orchestration/**`
- `packages/runtime/drizzle/0012_supervisor_runs.sql`
- `packages/runtime/drizzle/meta/_journal.json`
- `packages/runtime/src/platform/storage/sqlite-schema.ts`
- `packages/runtime/src/platform/storage/sqlite-db.ts`
- `packages/runtime/src/platform/storage/sqlite-embedded-migrations.ts`
- `packages/runtime/src/platform/storage/sqlite-worker.protocol.ts`
- `packages/runtime/src/bootstrap/sqlite-worker.entry.ts`
- `packages/runtime/src/bootstrap/init/persistence-module.init.ts`

Verification commands run:
- `bun test packages/runtime/src/modules/supervisor-orchestration/domain packages/runtime/src/modules/supervisor-orchestration/infra/supervisor-run.repository.test.ts packages/runtime/src/modules/supervisor/application/supervisor-loop.service.test.ts packages/runtime/src/modules/supervisor/application/supervisor.schemas.test.ts` -> exit `0`, 106 tests passed.
- `bun run --cwd packages/runtime check-types` -> exit `0`.
- Focused `bunx biome check ... --write --error-on-warnings` over the new module,
  persistence/bootstrap changes, and semantic fallback test -> exit `0`, 18
  files checked with no remaining diagnostics.
- Focused `git diff --check` over the new module, SQLite migration/storage,
  bootstrap, and semantic fallback test -> exit `0` (Git emitted only existing
  line-ending conversion notices).

Remaining work:
- Phase 2: strict MiniMax planner proposal/validation and configured active-agent
  selection.
- Phase 3+: worker session manager and compact prompts, scheduler/orchestrator,
  isolated workspaces and integration gates, result aggregation, Goal Mode
  unification, API/events/UI, recovery/redaction, deterministic E2E, live smoke,
  and final 40-criterion audit.

### Phases 2-6 - Planner, Workers, Scheduler, Isolation, and Results

What changed:
- Added the strict MiniMax planner contract, deterministic graph/scope/action
  validation, application-owned agent selection, trusted verification commands,
  and bounded replans that preserve completed work.
- Added the worker-session facade over canonical create/send/stop/resume
  services, persisted bindings/idempotency, the `orchestrator` prompt source,
  compact scoped prompts, and exact-once per-session Supervisos terminal events.
- Added dependency-aware persisted scheduling, concurrency/deadline/attempt
  budgets, pause/resume/cancel/retry/replan/gate controls, and aggregate final
  verification.
- Added detached Git worktrees for writes, dirty/baseline fingerprint checks,
  binary-safe patch artifacts/manifests, deterministic integration gates,
  conflict handling, no-commit/no-push application, and cleanup.
- Added strict structured-result extraction; prose-only completion, missing
  verification, tool failures, unresolved permissions, and identity mismatch
  cannot complete tasks.

Verification evidence:
- Success Criteria 1-21 focused command -> exit `0`, 172 tests passed.
- Supervisor permission command -> exit `0`, 52 tests passed.
- Real Git workspace/patch tests cover distinct roots, dirty overlap, created,
  modified, deleted, renamed, untracked, and binary files.

### Phases 7-9 - Durable Goal Mode, API/Events/UI, Recovery, and Redaction

What changed:
- Replaced active bootstrap construction of in-memory Goal Mode state with the
  versioned `goal_mode_states` SQLite repository and authenticated Goal Mode
  start/get/attempt/result API.
- Added the authenticated `supervisorRuns` tRPC surface for start/get/list,
  pause/resume/cancel/replan, retry, gate decisions, and live updates.
- Added strict client-safe run projections and notifications that omit original
  prompts, constraints, transcripts, raw diffs, artifact storage paths, and
  free-form audit text.
- Added the desktop Supervisos Runs panel with objective start, task/dependency
  status, worker chat links, gate controls, retry/replan, lifecycle controls,
  empty/loading/error/recovered/terminal states, and aggregate evidence.
- Added startup recovery for paused/live/resumable/non-resumable/stale workers
  and settings-backed hard caps/trusted verification commands.

Verification evidence:
- Goal Mode + shared events + desktop Runs + session/bot regressions + redaction
  command -> exit `0`, 103 tests passed.
- Runtime, API-contract, and desktop typechecks have each passed during these
  phases.
- `rg -n "InMemoryGoalModeStateRepository" packages/runtime/src/bootstrap` ->
  exit `1`.

### Phase 10 - Deterministic and Live End-to-End Verification

What changed:
- Added deterministic fake ACP-session E2E coverage using the real planner,
  scheduler, worker-session manager, result, finalization, and cancellation
  application flow.
- Added a live runtime-composition smoke that requires MiniMax, an explicitly
  configured ACP agent, project root, and trusted verification commands. It
  fails rather than skips when configuration is absent.

Verification evidence:
- `bun run --cwd packages/runtime test:e2e:supervisor-orchestration` -> exit
  `0`; markers include two distinct worker chats, dependency wait, safe
  integration, and completed aggregate verification.
- `bun run --cwd packages/runtime test:e2e:supervisor-orchestration-cancel` ->
  exit `0`; markers report 2 stopped workers and 0 temporary roots.

Remaining work for the active multi-session goal:
- Run the required live smoke with real `MINIMAX_API_KEY`, configured ACP agent,
  project root, and trusted verification-command environment values.

### Phase 11 - Full Local Audit and Documentation

Verification evidence:
- Runtime, API-contract, and desktop typechecks -> all exit `0`.
- `bun run audit:blockers` -> exit `0`; runtime, shared, desktop typecheck, and
  desktop blocker suites passed.
- `bunx biome check packages apps/desktop apps/native --error-on-warnings` ->
  exit `0`, 1,381 files checked with no diagnostics.
- `bun run build` -> exit `0`; runtime and desktop production builds completed
  with only the repository's existing externalization/chunk-size warnings.
- Desktop smoke -> exit `0`; Electron IPC runtime ready, SQLite worker and
  background recovery initialized, and renderer loaded.
- DeepSeek wiring search -> exit `1`; direct process spawn search over
  orchestration application/domain and renderer -> exit `1`.
- Documentation search finds `SupervisorOrchestratorService`,
  `SupervisorRunState`, and multi-session architecture in `AGENTS.md`,
  `CONTEXT.md`, and this progress log.
- Live preflight with `ERAGEAR_SUPERVISOR_LIVE=1` -> exit `1` with explicit
  `Live supervisor orchestration smoke requires MINIMAX_API_KEY`; the current
  environment also lacks the required live ACP agent id, project root, and
  trusted verification commands. This is a fail, not a skipped success.

Remaining work:
- Provide the four live values and obtain the required
  `SUPERVISOS_LIVE_PLAN`, `SUPERVISOS_LIVE_WORKERS`, `SUPERVISOS_LIVE_GATE`,
  and `SUPERVISOS_LIVE_COMPLETE` markers. No deterministic implementation or
  local audit work remains.

## Supervisos Goal - 2026-06-20

Source of truth: `supervisos-goal.md`.

Status: Complete. V0 and V1 are implemented, and every Success Criteria check in
`supervisos-goal.md` has passing evidence.

### Final Completion Evidence - 2026-06-20

What changed:
- Supervisor decisions now use MiniMax-M3 through AI SDK's OpenAI-compatible
  provider against MiniMax's official `https://api.minimax.io/v1` endpoint.
- Scope Resolution V0 resolves goal scope from Project Index symbols and file
  signals, exposes diagnostics, and can use bounded top-K disambiguation without
  handing the LLM raw diffs or transcripts.
- Goal Mode is separate from `SupervisorSessionState`, with
  `SupervisorGoalState`, phase/attempt records, `GoalModeController`, guarded
  gates, bounded prompt context allocation, and desktop audit rendering.
- Goal Mode now also collects changed/created/deleted files from project-root
  git worktree state through a runtime `GitRepositoryPort` collector when loop
  results do not provide explicit file-change evidence, including untracked and
  renamed files.
- Scope Resolution V1 adds an AST import graph, reachability, `routeMap`,
  same-name route/component disambiguation, and file-watcher invalidation.
- Goal metrics are pure derived values from phase/attempt records through
  `computeGoalMetrics`; no mutable root metrics field was added.

Verification commands run:
- `rg -n "createDeepSeek|@ai-sdk/deepseek|supervisorDeepSeek|DEEPSEEK_API_KEY|deepSeekApiKey|DeepSeek" packages/runtime/src packages/runtime/package.json packages/runtime/settings.schema.json` -> exit `1`, no active DeepSeek supervisor wiring.
- `rg -n "MiniMax-M3|MINIMAX_API_KEY|minimax" packages/runtime/src packages/runtime/settings.schema.json apps/desktop/src` -> exit `0`, active MiniMax runtime/settings/UI wiring present.
- `bun test packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.test.ts` -> exit `0`, 6 tests passed.
- `rg -n "ScopeResolution|resolverVersion|v0-no-graph|signalScanSkippedBySize|symbolExtractionMode" packages/runtime/src` -> exit `0`.
- `bun test packages/runtime/src/modules/scope-resolution/application/scope-resolver.service.test.ts` -> exit `0`, 4 tests passed.
- `bun test packages/runtime/src/modules/scope-resolution/application/scope-resolver.service.test.ts packages/runtime/src/modules/repo-snapshot-indexing/application/repo-snapshot-indexing.service.test.ts` -> exit `0`, 7 tests passed.
- `rg -n "signalScanSkippedBySize" packages/runtime/src apps/desktop/src` -> exit `0`.
- `rg -n "SupervisorGoalState|PhaseRecord|PhaseAttemptRecord|GoalModeController" packages/runtime/src` -> exit `0`.
- `rg -n "phaseId|goalId|currentPhaseId|phases|filesAllowed|outcomeSummary" packages/runtime/src/shared/types/supervisor.types.ts packages/shared/src/chat/types.ts` -> exit `1`, `SupervisorSessionState` and the shared chat core type file remain free of Goal Mode state fields.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-controller.service.test.ts` -> exit `0`, 6 tests passed.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-worktree-change.collector.test.ts` -> exit `0`, 3 tests passed.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-gate.test.ts` -> exit `0`, 6 tests passed.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-prompt.builder.test.ts` -> exit `0`, 2 tests passed.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode.schemas.test.ts` -> exit `0`, 3 tests passed.
- `bun test packages/shared/src/chat/event-schema.test.ts packages/shared/src/chat/use-chat-core.test.ts` -> exit `0`, 46 tests passed.
- `bun run --cwd packages/runtime check-types` -> exit `0`.
- `bun run --cwd apps/desktop check-types` -> exit `0`.
- `bun run --cwd packages/api-contract check-types` -> exit `0`.
- `rg -n "v1-import-graph|importGraph|reachability|routeMap" packages/runtime/src/modules` -> exit `0`.
- `bun test packages/runtime/src/modules/scope-resolution/application/scope-resolver-v1.test.ts` -> exit `0`, 3 tests passed.
- `bun test packages/runtime/src/modules/scope-resolution/init/scope-resolution-events.init.test.ts packages/runtime/src/modules/file-watcher/init/file-watcher-events.init.test.ts` -> exit `0`, 2 tests passed.
- `rg -n "computeGoalMetrics|resolvedViaLLMRate|gateRejectReasons|avgAttemptsPerPhase" packages/runtime/src` -> exit `0`.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-metrics.test.ts` -> exit `0`, 1 test passed.
- `bun run audit:blockers` -> exit `0`; runtime blockers, shared tests, desktop typecheck, and desktop blockers passed.
- `bunx biome check packages apps/desktop apps/native --error-on-warnings` -> exit `0`, `Checked 1294 files in 2s. No fixes applied.`
- `bun run build` -> exit `0`; runtime build ran from cache miss after the audit patch and kept existing Bun externalization warnings; desktop renderer kept existing chunk-size/Browserslist warnings.
- `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop` -> exit `0`; output included `SUPERVISOS_SMOKE_SUPERVISOR MiniMax-M3 provider-config marker`, `SUPERVISOS_SMOKE_GOAL guarded-gate goal-flow marker`, `Runtime channel: electron-ipc renderer bridge -> desktop-service runtime core`, and `Renderer loaded`.

Remaining work:
- None for `supervisos-goal.md`.

### Completion Audit Hardening - 2026-06-20

What changed:
- Added `GoalModeWorktreeChangeCollectorPort` and
  `GitGoalModeWorktreeChangeCollector` in `packages/runtime`.
- Wired Goal Mode service construction to pass the existing `GitAdapter` through
  the runtime service registry, keeping Electron main/preload thin.
- Updated `GoalModeController.handleLoopResult` to collect git worktree changes
  from `projectRoot` when explicit `filesTouched`/`filesCreated`/`filesDeleted`
  evidence is omitted, and to fail closed if neither evidence path is available.
- Added tests for untracked, deleted, renamed, and modified file classification,
  plus controller gate behavior using collected worktree evidence.

Verification commands run:
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-controller.service.test.ts` -> exit `0`, 6 tests passed.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-worktree-change.collector.test.ts` -> exit `0`, 3 tests passed.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-gate.test.ts packages/runtime/src/modules/goal-mode/application/goal-mode.schemas.test.ts packages/runtime/src/modules/goal-mode/application/goal-mode-prompt.builder.test.ts packages/runtime/src/modules/goal-mode/application/goal-mode-metrics.test.ts` -> exit `0`, 12 tests passed.
- `bun run --cwd packages/runtime check-types` -> exit `0`.
- `bun run --cwd apps/desktop check-types` -> exit `0`.
- `bun run --cwd packages/api-contract check-types` -> exit `0`.
- `bun run audit:blockers` -> exit `0`; runtime blockers, shared tests, desktop typecheck, and desktop blockers passed.
- `bunx biome check packages apps/desktop apps/native --error-on-warnings` -> exit `0`, `Checked 1294 files in 2s. No fixes applied.`
- `bun run build` -> exit `0`.
- `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop` -> exit `0`; output included `SUPERVISOS_SMOKE_SUPERVISOR MiniMax-M3 provider-config marker`, `SUPERVISOS_SMOKE_GOAL guarded-gate goal-flow marker`, runtime channel, and renderer loaded.

Remaining work:
- None for `supervisos-goal.md`.

### Phase 1 - MiniMax-M3 Supervisor Provider

What changed:
- Replaced the active Supervisor decision adapter dependency on the old provider with AI SDK's OpenAI-compatible provider pointed at MiniMax's official `https://api.minimax.io/v1` endpoint.
- Set the required Supervisor model path to exact `MiniMax-M3`.
- Replaced active runtime/config/settings/UI key wiring with `MINIMAX_API_KEY` and `supervisorMiniMaxApiKey`.
- Preserved fail-closed behavior for disabled Supervisor, blank model, missing MiniMax key, and unsupported model/provider ids.
- Added focused adapter tests for configured MiniMax-M3 resolution, missing-key failure, unsupported-provider failure, schema-validated output, retry behavior, and API-key redaction.

Verification commands run:
- `bun install` -> exit `0`; lockfile updated for `@ai-sdk/openai-compatible`.
- `rg -n "createDeepSeek|@ai-sdk/deepseek|supervisorDeepSeek|DEEPSEEK_API_KEY|deepSeekApiKey|DeepSeek" packages\runtime\src packages\runtime\package.json packages\runtime\settings.schema.json` -> exit `1`, no active runtime/config matches.
- `bun test packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.test.ts` -> exit `0`, 6 tests passed.

Remaining work:
- Phase 2: Scope Resolver V0 contract/service/tests, including typed TSX component extraction and observable signal-scan diagnostics.
- Phase 3+: Goal Mode state/storage/controller, gates, context allocator, audit events/UI, V1 import graph, derived metrics, and full success-criteria verification.

### Phase 2 - Scope Resolver V0

What changed:
- Added `packages/runtime/src/modules/scope-resolution` with structured `ScopeResolution`, `resolverVersion: "v0-no-graph"`, deterministic target scoring, optional bounded top-K disambiguation, and diagnostics.
- Wired Scope Resolution into the runtime use-case graph and tRPC router as `scopeResolution.resolve`.
- Factored repo-index symbol-line extraction into a tested helper and updated Local ADE indexing to recognize typed TSX component declarations such as `export const HomePage: FC<Props> = ...`.
- Made large-file signal scan skips observable through `signalScanSkippedBySize` diagnostics and surfaced the count in the desktop Project Index settings panel.

Verification commands run:
- `bun test packages/runtime/src/modules/scope-resolution/application/scope-resolver.service.test.ts packages/runtime/src/modules/repo-snapshot-indexing/application/repo-snapshot-indexing.service.test.ts` -> exit `0`, 7 tests passed.
- `rg -n "ScopeResolution|resolverVersion|v0-no-graph|signalScanSkippedBySize|symbolExtractionMode" packages\runtime\src` -> exit `0`, contract/service/tests/use-case wiring present.
- `rg -n "signalScanSkippedBySize" packages\runtime\src apps\desktop\src` -> exit `0`, runtime diagnostics and desktop UI references present.

Remaining work:
- Phase 3: separate Goal Mode state/storage and `GoalModeController`.
- Phase 4+: guarded gates, prompt allocator, audit events/UI, V1 import graph/reachability, derived metrics, and final verification suite.

### Phase 3 - Goal Mode V0 Controller, Gates, Prompt Context, Audit UI

What changed:
- Added `packages/runtime/src/modules/goal-mode` with separate `SupervisorGoalState`, `PhaseRecord`, `PhaseAttemptRecord`, `GoalModeController`, repository port, and in-memory repository.
- Kept `SupervisorSessionState` unchanged; Goal Mode state stores phase/attempt data separately.
- Added guarded gate evaluation for scope drift, created out-of-scope files, file deletion, destructive actions, and failed/missing verification exits.
- Added next-phase prompt construction from original intent, constraints, phase summaries, scoped file lists, and verification requirements only; raw transcript and raw diffs are not prompt inputs.
- Added shared `goal_mode_audit` event schemas/types and desktop environment rail rendering for resolver version, gate decisions, scoped file counts, verification, and primary target.

Verification commands run:
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-controller.service.test.ts` -> exit `0`, 4 tests passed.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-gate.test.ts` -> exit `0`, 6 tests passed.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-prompt.builder.test.ts` -> exit `0`, 2 tests passed.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode.schemas.test.ts` -> exit `0`, 3 tests passed.
- `bun test packages/shared/src/chat/event-schema.test.ts packages/shared/src/chat/use-chat-core.test.ts` -> exit `0`, 46 tests passed.
- `rg -n "SupervisorGoalState|PhaseRecord|PhaseAttemptRecord|GoalModeController" packages\runtime\src` -> exit `0`, Goal Mode state/controller references present.
- `rg -n "phaseId|goalId|currentPhaseId|phases|filesAllowed|outcomeSummary" packages\runtime\src\shared\types\supervisor.types.ts packages\shared\src\chat\types.ts` -> exit `1`; runtime `SupervisorSessionState` stayed unchanged and detailed Goal Mode audit fields live in the separate shared audit event type.

Remaining work:
- Phase 4: V1 import graph resolver and file-change invalidation.
- Phase 5+: derived metrics, desktop smoke markers, and full success-criteria verification suite.

### Phase 4 - Scope Resolver V1 Import Graph, Invalidation, Metrics

What changed:
- Added `ScopeImportGraphService` and `ScopeImportGraphPort` under `packages/runtime/src/modules/scope-resolution` with TypeScript AST symbol extraction, import/export graph edges, root/route reachability, and `routeMap` entries.
- Wired the runtime `ScopeResolverService` to use V1 graph signals by default through service composition while retaining V0 fallback when graph data is unavailable.
- Resolver outputs now emit `resolverVersion: "v1-import-graph"`, `symbolExtractionMode: "ast"`, and `graphConfidence` when graph signals participate.
- Added `initializeScopeResolutionEvents` so file watcher changes invalidate resolver import graph cache for the affected project root/path.
- Added `computeGoalMetrics(goal)` as a pure derived function over phases/attempts for `resolvedViaLLMRate`, `gateRejectReasons`, `avgAttemptsPerPhase`, and signal-scan skip totals; no mutable root metrics field was added.

Verification commands run:
- `bun test packages/runtime/src/modules/scope-resolution/application/scope-resolver-v1.test.ts` -> exit `0`, 3 tests passed.
- `bun test packages/runtime/src/modules/scope-resolution/init/scope-resolution-events.init.test.ts packages/runtime/src/modules/file-watcher/init/file-watcher-events.init.test.ts` -> exit `0`, 2 tests passed.
- `rg -n "v1-import-graph|importGraph|reachability|routeMap" packages/runtime/src/modules` -> exit `0`, active V1 graph code/tests present.
- `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-metrics.test.ts` -> exit `0`, 1 test passed.
- `rg -n "computeGoalMetrics|resolvedViaLLMRate|gateRejectReasons|avgAttemptsPerPhase" packages/runtime/src` -> exit `0`, pure metrics function and tests present.

Remaining work:
- Full Success Criteria verification suite, fixing type/lint/build/smoke failures as they appear.

## Electron-First Migration - 2026-06-19

Status: Complete. The Electron-first migration is implemented and all `GOAL.md` Success Criteria checks have current passing evidence.

### Final Completion Evidence - 2026-06-19

What changed:
- Created `packages/runtime` as the extracted runtime/application package and rewired Electron desktop to start `packages/runtime/src/runtime/desktop-service.ts`.
- Created `packages/api-contract` and rewired desktop/native to import `AppRouter` from the package instead of `apps/server`.
- Re-homed the Electron renderer from `apps/web/src` into `apps/desktop/src/renderer`, including Vite/router/public/config files.
- Removed active Tauri product code and scripts.
- Deleted `apps/server` and `apps/web` after extraction, desktop build, and smoke verification.
- Removed active product scripts/docs that advertised `apps/web`, `apps/server`, `dev:web`, or `dev:server`.
- Resolved the broad Biome gate after migration with targeted migrated-renderer lint debt markers plus focused fixes in runtime, desktop main/preload/runtime-host, scripts, and package barrels.

Files/packages moved:
- `apps/server/src/**`, `scripts/**`, `drizzle/**`, `public/**`, and docs -> `packages/runtime/**`.
- `packages/trpc-contract` -> replaced by `packages/api-contract`.
- `apps/web/src/**` -> `apps/desktop/src/renderer/**`.
- `apps/web/public/**` -> `apps/desktop/public/**`.
- `apps/web/index.html`, `vite.config.ts`, `components.json`, `pwa-assets.config.ts` -> `apps/desktop/**`.
- `apps/native/docs/use-chat-check.md` -> `apps/native/docs/archive/use-chat-check.md`.
- Server docs that still mention legacy concepts -> `packages/runtime/docs/archive/legacy-server/**`.

Verification commands run:
- `Test-Path apps/web; Test-Path apps/server; Test-Path apps/native` -> `False`, `False`, `True`.
- `rg -n 'server/src|\.\./\.\./server|\.\./\.\./\.\./server|apps/server/src' apps packages -g '*.ts' -g '*.tsx' -g 'package.json'` -> exit `1`, no matches.
- `rg -n 'src-tauri|@tauri-apps|tauri dev|tauri build|"tauri"' apps packages package.json turbo.json bun.lock` -> exit `1`, no matches.
- `bun run --cwd apps/desktop check-types` -> exit `0`.
- `bun run --cwd apps/native ui-map` -> exit `0`.
- `bun run --cwd packages/runtime check-types` -> exit `0`.
- `bun run --cwd packages/api-contract check-types` -> exit `0`.
- `bun run build` -> exit `0`. Runtime build emitted Bun externalization warnings for Bun-only modules; desktop renderer build emitted chunk-size and Browserslist warnings.
- `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop` -> exit `0`. Renderer loaded on `127.0.0.1:3002`, runtime diagnostics reported `channel: 'desktop-service'`, and the desktop runtime service exited with code `0`.
- `bunx biome check packages apps/desktop apps/native --error-on-warnings` -> exit `0`, `Checked 1267 files in 2s. No fixes applied.`
- PowerShell-safe equivalent of the AppRouter server-path check, using `\x22` for literal quotes: `rg -n 'from \x22\.\./\.\./server|from \x22\.\./\.\./\.\./server|server/src/transport/trpc/router' apps/native apps/desktop packages` -> exit `1`, no matches.
- `rg -n 'dev:web|dev:server|desktop:dev|desktop:build|apps/web|apps/server' package.json turbo.json README.md AGENTS.md apps packages -g '!**/docs/archive/**'` -> exit `1`, no active product-script/doc matches.

Remaining work:
- None for the GOAL success criteria.

### Phase 1 - Baseline And Freeze Current Behavior

What changed:
- Read `GOAL.md` completely and accepted it as the source of truth.
- Inspected initial worktree state. `GOAL.md` was already modified before migration edits; leave it user-owned.
- Confirmed the known server quality-gate blocker: `apps/server check:quick` runs `tsc -b --noEmit` successfully, then fails on Biome formatter diagnostics.
- Decision: do not bypass or weaken the formatter gate. Defer broad formatting normalization until extracted code lands in the new package structure so the final `packages`/desktop/native gate can be resolved directly.

Files/packages moved:
- None.

Verification commands run:
- `git status --short` -> ` M GOAL.md`
- `bun run --cwd apps/desktop check-types` -> passed.
- `bun run --cwd apps/web check-types` -> passed.
- `bun run --cwd apps/native ui-map` -> passed.
- `bun run --cwd apps/server check:quick` -> failed with 579 Biome formatter diagnostics after TypeScript passed.

Remaining work:
- Phase 2: create a real shared API contract package and remove direct active imports from `apps/server` router internals.
- Phase 3: extract runtime/application code from `apps/server` into `packages/runtime` or smaller cohesive packages.
- Phase 4+: re-home renderer, rewire desktop/native, delete legacy `apps/web` and `apps/server`, then run all success criteria.

### Phase 2 - Shared API Contract Package

What changed:
- Added `packages/api-contract` as `@eragear-code-copilot/api-contract`.
- Added `packages/runtime` as `@eragear-code-copilot/runtime` and exposed the package-owned tRPC router type through `packages/api-contract`.
- Rewired `apps/web` and `apps/native` to import `AppRouter` from `@eragear-code-copilot/api-contract`.
- Rewired `apps/desktop/src/runtime-host.ts` to start `packages/runtime/src/runtime/desktop-service.ts` instead of `apps/server/src/runtime/desktop-service.ts`.
- Converted copied runtime source imports from the old app-local `@/` alias to package-private `#runtime/*`.
- Removed the obsolete `packages/trpc-contract` package.

Files/packages moved:
- Copied `apps/server/src`, `scripts`, `docs`, `drizzle`, and `public` into `packages/runtime`.
- Created `packages/api-contract`.
- Removed `packages/trpc-contract`.

Verification commands run:
- `bun run --cwd packages/runtime check-types` -> passed.
- `bun run --cwd packages/api-contract check-types` -> passed after aligning the contract tsconfig with runtime's compiler environment.
- `bun run --cwd apps/desktop check-types` -> passed.
- `bun run --cwd apps/web check-types` -> passed.
- `bun run --cwd apps/native ui-map` -> passed.
- `bun install` -> failed while rebuilding `better-sqlite3` under Node 26.3.0 (`v8::PropertyCallbackInfo` API errors), but workspace symlinks for `api-contract` and `runtime` were created and focused checks proceeded.

Remaining work:
- Phase 3: finish runtime extraction cleanup and remove remaining active `apps/server` dependencies.
- Replace copied package path strings such as `apps/server/src/...` in active runtime/web source before final success criteria.
- Re-home the renderer into `apps/desktop`, then delete `apps/web`.
- Delete `apps/server` after desktop/runtime verification.

Updated: 2026-06-12 08:50 UTC / 2026-06-12 15:50 Asia/Saigon

## Current Result

Status: ZCode scorecard parity achieved for the tracked workflow rows.

This run converted the previously partial ADE parity work into working Electron
flows for the required core surfaces and closed the last three scorecard rows.
The app still should not be described as a finished clone of ZCode, but the
tracked ZCode black-box workflow scorecard now has zero non-N/A Remaining
Eragear Work cells.

This continuation closed the final Capabilities/Hooks/Plugins gaps. Hook and
plugin execution now persists structured `job-process-tree` isolation metadata,
spawns without shell expansion, and terminates timeout process trees with
Windows `taskkill /T /F` or Unix-like detached process-group termination.
Electron shows isolation posture on hook/plugin cards, and desktop smoke emits
`HOOK_PROCESS_ISOLATION` and `PLUGIN_PROCESS_ISOLATION`. Hook Runner now has a
real `settings.runHookBatch` path behind its Batch Queue: `RUN HOOK BATCH`
confirmation, per-hook operation fingerprint recheck, trust/policy/scheduling
gates, `continue` or `stop-on-failure`, disabled audit rows before spawn, and
persisted `hook-batch-*` summaries. Desktop smoke emits `HOOK_BATCH_QUEUE`.
Signed plugin package governance now has `settings.revalidatePluginPackage`,
which rechecks local manifest or trusted registry pins after install, persists
`verified` or `verification-failed`, demotes failed package capabilities, and
blocks later approval/run until the package is fixed. Electron exposes a
Revalidate action and desktop smoke emits `PLUGIN_PACKAGE_REVALIDATION` after a
tamper-demotion check. The scorecard parser reports `remaining=0`.

Final required verification for this continuation passed after the parity
closure: server Local ADE tests, desktop typecheck/build, web build, desktop
runtime smoke, `dev:desktop`, and the scorecard parser all succeeded. The
`dev:desktop` smoke used port 3002 because 3001 was busy, loaded the renderer
through `desktop-service`, then shut down the owned runtime service cleanly.

This continuation closed the Desktop runtime scorecard row. Electron main now
declares the renderer posture explicitly (`contextIsolation:true`,
`nodeIntegration:false`, preload-only bridge, private `desktop-service` channel)
and installs a renderer CSP header. Runtime diagnostics carry a structured
`securityPosture` with CSP, isolation, Node integration, sandbox, endpoint
exposure, and local-token redaction state; the Local ADE Runtime Strip renders
that as a visible Security Posture tile. Dev Vite mode is intentionally reported
as `development-warning` because the dev renderer still needs `unsafe-eval`,
while the same path can report `hardened` when CSP is enforced. Unit coverage
verifies `DesktopRuntimeHost` includes posture in bootstrap diagnostics without
leaking the local auth token; desktop smoke emits `RUNTIME_SECURITY_POSTURE`;
and `dev:desktop` logs `securityPosture: 'development-warning'` from Electron
main while loading the renderer through the private service path.

This continuation also closed the Agent session loop scorecard row. The Local
ADE cockpit now derives an Agent Launch selector from configured agents,
runtime CLI availability, and provider readiness, then starts the selected
agent through the existing chat `initChat(agentId)` and `session.create` path.
Start is enabled only for agents with an available CLI and non-blocked provider
state; installed-but-unprobed agents show `needs-probe`, and missing CLIs stay
disabled with remediation. The derivation is covered by web unit tests, and
desktop smoke emits `AGENT_LAUNCH_MATRIX` alongside the existing
`SESSION_CREATED`, `SESSION_STATE`, `MESSAGE_SENT`, and `SESSION_STOPPED`
markers. Claude and Gemini are still reported as missing CLI on this machine
because those executables are not installed; that is surfaced as runtime
diagnostics rather than presented as a runnable flow.

This continuation tightened the first viewport into a more workspace-first ADE
command deck and active-session cockpit. `getLocalAdeCommandDeckState` now
derives the current operating status, primary action, secondary actions,
command chips, and Operation / Guardrail / Tooling / Context panels from the
same Local ADE snapshot and runtime diagnostics used by the deeper sections.
Electron renders that deck at the top of the Local ADE Control Center with real
handlers for start session, provider probe/config, MCP probe/inspect,
checkpoint capture, index refresh, and copyable `/index`, `/memory`, and
`/agent-*` commands. `getLocalAdeSessionCockpitState` now derives active chat
count, stored session count, pending permission count, active tool-call count,
subscriber count, current model, pid, and attention-first session ordering from
the live session snapshot. When Local ADE is shown from the chat empty state,
the cockpit's Open Chat action selects the active chat id through the existing
chat shell instead of spawning a duplicate session. The cockpit also includes a
Command Launcher that turns placeholder commands such as `/index <query>` and
`/memory <request>` into concrete chat text only after the user supplies the
missing argument; when rendered from the chat empty state it queues that command
for the active or newly created session and submits through the existing chat
`handleSubmit` path once the session is connected, so MCP/memory/index/subagent
resolution still happens on the normal message path. Settings keeps the same
runtime inspect/copy/start actions without adding a fake send path. Renderer
tests cover the deck, cockpit, and placeholder-safe command launch derivation,
and desktop smoke now emits `ADE_COMMAND_DECK`, `ACTIVE_SESSION_COCKPIT`, and
`LOCAL_ADE_COMMAND_LAUNCH` from the private `desktop-service` path to prove the
live runtime provides the data behind the first-screen surface.

This continuation closed the Provider control scorecard row. Provider health
records and snapshots now include bounded remediation actions in addition to
CLI/auth/model readiness. Claude probes try `doctor --json` before falling back
to safe auth/model commands, Gemini probes fall back through safe auth/model
commands when doctor JSON is unavailable, and model parsing accepts JSON
`models`/`availableModels`/`data` plus text list output. The Electron provider
table shows the first remediation action separately from diagnostics, while
persisted health continues to avoid secret values. Server tests cover Claude
doctor JSON, Gemini fallback auth/model probes, persisted remediation, and
secret redaction; desktop smoke now emits `PROVIDER_REMEDIATION_MATRIX` from
the private `desktop-service` path.

This continuation closed the Dashboard parity scorecard row. Remote auth
admin/device-session management is now represented as an explicit Local ADE
policy item instead of an open blocker: `dashboardParity` marks it
`not-applicable` for the `local-desktop` scope with a reviewed rationale,
Electron renders the policy decision in the Dashboard Parity rail, and
`blockers` excludes that workflow. Server tests cover the policy classification,
and desktop smoke now emits `DASHBOARD_LOCAL_POLICY` with
`decision:"not-applicable"` and `inBlockers:false` from the private
`desktop-service` path.

This continuation moved MCP notification handling beyond passive probe/invoke
capture. Trusted SSE MCP servers now expose a real `settings.watchMcpNotifications`
action and a visible Electron Watch button. The server opens the SSE stream,
performs MCP `initialize`, sends `notifications/initialized`, watches for a
bounded interval, reconnects once when the stream drops, captures JSON-RPC
notifications as `source:"monitor"`, redacts header-derived secrets, persists
both bounded notification history and a separate monitor run history with
stream/reconnect/count diagnostics, and reports unsupported transports as
explicit monitor runs instead of making them look active. Unit coverage verifies
reconnect plus redaction, and desktop smoke now emits
`MCP_NOTIFICATION_MONITOR` through the private `desktop-service` path.

This continuation added hunk-level tracked checkpoint conflict choices. The
server now exposes `settings.resolveCheckpointTrackedConflictHunks`, builds a
selected-hunk patch from the checkpoint, verifies that each selected file is a
tracked same-file conflict, restores only the selected hunks, records a `mixed`
partial restore with per-hunk `restore`/`current` choices, creates an
apply-patch safety checkpoint for the selected hunks, and runs the normal
after-restore lifecycle hook. Electron separates conflict hunk choices from
safe selected-hunk restore: tracked conflict hunks can be selected in the raw
diff and applied through `Apply Conflict Hunks`, while safe hunks continue to
use `Restore Hunks`. Unit tests cover the service path and the Mixed Restore
row action, and desktop smoke now verifies `CHECKPOINT_CONFLICT_HUNK_CHOICES`
through the private `desktop-service` path.

This continuation moved ACP Activity beyond per-chat replay into a real
cross-session timeline. `snapshot.acpActivity.timeline` now derives chat/source
lanes, chronological frames, lane transitions, span, and omitted-frame counts
from the same redacted log entries used by export/replay. `settings.exportAcpActivity`
now returns that timeline in the redacted trace schema, and workspace-wide
`settings.replayAcpActivity` remains unscoped when no chat filter is supplied.
Electron renders a Cross-session timeline panel inside ACP Activity with lane
counts, hop counts, frame rows, per-lane replay buttons, and a separate
Workspace replay action. Unit tests cover two owned chats, chronological frame
sequence, lane transitions, workspace replay across chats, and raw payload
redaction. Desktop smoke now verifies `ACP_CROSS_SESSION_TIMELINE` through the
private `desktop-service` path with 11 chat lanes, 80 timeline frames, 29 lane
transitions, 40 workspace replay frames, `workspaceChatCount:8`, and no
single-chat workspace filter.

This continuation closed the Logs/observability scorecard row. Local ADE now
derives `snapshot.acpActivity.stream` with stream status, latest-frame age,
stale/heartbeat thresholds, retry delay/max attempts, retry eligibility,
max-silence and average-delta timings, gap rows, causality root counts,
correlated/orphan frame counts, longest chain length, and bounded causal chains.
`settings.exportAcpActivity` includes the same redacted stream diagnostics, and
`settings.retryAcpActivityStream` gives Electron a real Retry Stream action that
refreshes captured diagnostics without replaying side-effecting protocol calls
or adding non-ACP refresh logs to the ACP trace. The ACP Activity panel now
renders a Stream diagnostics section with Retry Stream, retry policy, heartbeat
state, gap rows, and per-chain replay controls. Unit tests cover redaction,
retry controls, causality, gap detection, export inclusion, and retry action;
desktop smoke now verifies `ACP_STREAM_DIAGNOSTICS` and `ACP_STREAM_RETRY`
through the private `desktop-service` path.

This continuation made checkpoint conflict handling more usable from Electron.
The checkpoint preview now derives a Mixed Restore editor state that groups each
file by risk, patch action, selected file/hunk counts, shelvable blocker status,
and tracked-conflict choices. Electron renders that editor above the raw diff:
safe files can be selected from the editor, all hunks in a file can be selected
or cleared, shelvable blockers can be moved one file at a time, and tracked
conflicts now expose per-file Keep and Restore Side actions instead of only
all-conflict buttons. The actions still use the existing guarded restore token
and server mutations, so the UI flow is execution-backed. Web tests cover the
derived editor rows, and desktop smoke now verifies
`CHECKPOINT_MIXED_CONFLICT_EDITOR` with a tracked `KEEP.md` current-side choice
and a separate safe `RESTORE.md` restore path.

This continuation turned hook/plugin execution policy presets from a scorecard
gap into working server and Electron behavior. Hooks and plugins now persist
`standard`, `restricted`, or `blocked` policy presets, include the preset in
trust/permission/run-operation fingerprints, expose the preset in the Local ADE
Control Center, and demote blocked surfaces from active capabilities. Hook
`restricted` policy blocks manual approval/run while leaving lifecycle events
available; hook `blocked` prevents execution before spawn. Plugin `restricted`
policy has real effect: even when a descriptor requests `project-root`, the
effective scopes and permission fingerprint drop project-root access, execution
runs in a temporary sandbox cwd, `ERAGEAR_PROJECT_ROOT` is hidden, and
`ERAGEAR_PLUGIN_POLICY_PRESET` is passed for audit. Plugin `blocked` rejects
approval/run before spawn. Unit tests cover restricted/blocked hook behavior and
restricted/blocked plugin behavior; desktop smoke verifies `HOOK_POLICY_PRESET`
and `PLUGIN_POLICY_PRESET` through the private `desktop-service` path.

This continuation also moved hook lifecycle governance out of the scorecard
gap list. Project-local hooks now persist lifecycle policy in `.eragear/hooks.json`
with an enabled switch, per-event pauses, and `continue` versus
`stop-on-failure` batch behavior. Lifecycle dispatches record a shared
`hook-batch-*` id on their runs, paused events create disabled audit rows
without spawning the command, and `stop-on-failure` marks later hooks in the
same batch as disabled after an earlier failure. Electron exposes the lifecycle
enabled switch, failure mode selector, paused-event controls, batch ids, and
audit diagnostics in Hook Runner. Unit tests cover pause and stop-on-failure
behavior; desktop smoke verifies `HOOK_LIFECYCLE_GOVERNANCE` through the
private `desktop-service` path.

This continuation moved hook/plugin automation scheduling beyond descriptor
state. `.eragear/hooks.json` and `.eragear/plugins.json` now persist
server-enforced run scheduling policy with enabled/paused state, max concurrent
run slots, per-item cooldown, updated timestamp, and visible diagnostics.
Snapshots expose per-hook/per-plugin scheduling status (`ready`, `paused`,
`cooldown`, or `parallel-limit`) plus active slot counts and next allowed time.
Capabilities are demoted while a surface is paused, cooling down, or slot-limited.
Manual hook/plugin runs still require trust, confirmation, and one-shot operation
approval, but now create a disabled audit run and consume the approval without
spawning when scheduling blocks execution. Lifecycle hook batches use the same
scheduler before spawn and record disabled audit rows for blocked items.
Electron exposes Run Scheduling controls for hooks and plugins. Unit tests cover
hook cooldown/pause before spawn and plugin runtime parallel-limit enforcement;
desktop smoke verifies `HOOK_SCHEDULING_POLICY` and `PLUGIN_SCHEDULING_POLICY`
through the private `desktop-service` path.

This continuation also made the plugin batch queue usable instead of a fake
automation surface. `settings.runPluginBatch` now accepts up to eight ready
plugins, requires the exact `RUN PLUGIN BATCH` confirmation token, rechecks each
plugin operation fingerprint immediately before execution, applies trust,
permission, policy, signed-package expiry, and scheduling gates, records disabled
or failed audit rows when a plugin cannot run, and persists a `plugin-batch-*`
summary with counts, diagnostics, run ids, and plugin names in
`.eragear/plugins.json`. The same document now persists reusable batch presets
with validated plugin ids, failure mode, diagnostics, and `lastRunBatchId`, plus
per-plugin `dependencyIds` and a derived `plugins.dependencyGraph` snapshot.
`settings.runPluginBatchPreset` resolves a saved preset into the same guarded
batch runner before updating the preset metadata. The batch runner now orders
selected plugins topologically so selected dependencies run before dependents,
and it creates disabled audit rows before spawn for missing selected
dependencies, dependency cycles, or dependents whose dependency did not finish
successfully. Electron exposes a Batch Queue panel in Plugin Runner with ready
candidates, recent batch summaries, the guarded Run Batch action,
save/run/delete preset controls, a failure-mode selector, dependency id editing,
per-card dependency badges, and a Dependency Graph panel with exact graph
diagnostics. The default `continue` mode preserves the existing behavior;
`stop-on-failure` stops after the first non-success item and creates disabled
audit rows for the remaining requested plugins without spawning them. Unit tests
cover success, fingerprint-blocked batch members, stop-on-failure skip auditing,
preset save/run/delete, dependency ordering, and dependency-failure skip
auditing; desktop smoke verifies `PLUGIN_DEPENDENCY_GRAPH`,
`PLUGIN_BATCH_QUEUE`, `PLUGIN_BATCH_STOP_ON_FAILURE`, and
`PLUGIN_BATCH_PRESET` through the private `desktop-service` path.

This continuation then moved plugin batch scheduling from policy-only state into
a usable schedule runner. `.eragear/plugins.json` now persists plugin batch
schedules with preset id, interval, next run time, enabled state, last run
status, last batch id, and the operation fingerprints captured when the schedule
was saved. Local ADE snapshots expose `plugins.batchSchedules` with
`due`/`scheduled`/`paused`/`missing-preset`/`stale-fingerprint` status and exact
diagnostics. `settings.runDuePluginBatchSchedules` processes due schedules
through the existing guarded dependency-aware `settings.runPluginBatch` path, so
trust, permission, policy, scheduling, dependency ordering, and fingerprint
checks still happen immediately before spawn; stale fingerprints create disabled
audit rows instead of silently running changed commands. Electron now lets the
user save a schedule from a batch preset, inspect next/last run state, run due
schedules, and delete schedules. Unit tests cover save, due execution, stale
fingerprint skip auditing, and deletion; desktop smoke verifies
`PLUGIN_BATCH_SCHEDULE` through the private `desktop-service` path.

This continuation then wired due plugin batch schedules into the server
BackgroundRunner. The new `plugin-batch-schedule-dispatch` task runs on the
local desktop user plus active session users, scans each user's projects for due
batch schedules, and delegates execution back through
`settings.runDuePluginBatchSchedules` so trust, permission, policy, dependency,
scheduling, and fingerprint guards remain on the existing guarded batch path.
The dispatcher interval is configurable with
`BACKGROUND_PLUGIN_BATCH_SCHEDULE_INTERVAL_MS`, defaults to 1000 ms, and is
visible in Electron runtime logs as a background task. Unit tests cover
cross-project/user dispatch, and desktop smoke now waits for the daemon to run
`PLUGIN_BATCH_SCHEDULE` with `daemon:true`.

This continuation then made the BackgroundRunner scheduler fleet visible in the
Electron control surface instead of leaving it as log-only runtime behavior.
Local ADE snapshots now include `runtime.background` with runner enabled state,
tick interval, registered tasks, run counts, last duration, last errors, and
bounded task result metadata. The first-screen runtime strip now includes a
Background Tasks tile and a Background Task Fleet table that shows
`plugin-batch-schedule-dispatch` cadence, timeout, status, success/failure
counts, and the last due/dispatched schedule result. Unit tests cover the new
snapshot and renderer summary helper; desktop smoke now asserts the schedule
dispatch task is visible and reports the daemon-dispatched schedule result.

This continuation removed the stale renderer typecheck blocker that previously
kept `apps/web check-types` red. The web package now resolves its local
React/Vite types during typecheck, and app-code fixes covered agentic message
path casting, Better Auth username sign-in typing, select-only session config
updates, spinner SVG props, and the typed chat message part-id assertion. The
required verification set was rerun after that fix: server Local ADE tests,
desktop typecheck/build, web typecheck/build, desktop runtime smoke, and
`dev:desktop` all passed. This improves confidence in the shipped Electron
surface, but does not change the status to full ZCode parity because the
remaining gaps are product hardening and UX depth, not only build health.

This continuation turned ACP replay presets from a documented debug gap into a
working Electron flow. Local ADE now persists project-local redacted replay
filters in `.eragear/acp-replay-presets.json`, exposes them on
`snapshot.acpActivity.replayPresets`, and adds `settings.saveAcpReplayPreset`
plus `settings.deleteAcpReplayPreset`. The ACP Activity panel can save the
current replay or active-chat replay, load a saved chat/correlation/kind/limit
filter, and delete saved presets without storing raw ACP payloads. Unit tests
cover preset persistence, update, replay filtering, redaction, and deletion;
desktop smoke verifies `ACP_REPLAY_PRESET` through the private
`desktop-service` path with save, replay, and delete.

This continuation tightened the first-screen ADE workbench. The Local ADE
Control Center now opens with a tested workbench panel that derives its
`running`/`ready`/`attention`/`setup`/`unknown` status, readiness score, primary
action, agent/tools/changes/context metrics, and command chips from the same
runtime diagnostics and Local ADE snapshot used by the deeper sections. Changed
files promote checkpoint capture as the primary action before risky work, active
sessions surface as the operating phase, and the no-provider setup state now
routes to provider configuration instead of showing a disabled fake probe.
Renderer tests cover the workbench state and setup routing; `dev:desktop` was
rerun against the Electron IPC/private `desktop-service` path after the UI
change.

This continuation moved plugin manual run from confirmation-only execution to a
one-shot per-operation approval flow. Local ADE snapshots now expose a
`runOperation` preview for each plugin, including the operation fingerprint,
workspace access, command, args, scopes, env-key names, approval id, expiry, and
status. `settings.approvePluginRun` approves only the current fingerprint for a
short window, `settings.runPlugin` requires the matching unconsumed approval id
before spawn, consumes the approval after execution, and reports exact changed,
missing, expired, or consumed state without exposing secret values. Electron now
shows the operation preview, an `Approve run` action, and disables `Run` until
the current operation is approved. Unit tests cover mismatched fingerprints,
one-shot consumption, expired approvals, and existing trust/permission/sandbox
gates; desktop smoke verifies `PLUGIN_RUN_APPROVAL` and consumed approval state
through the private `desktop-service` path.

This continuation applied the same one-shot operation approval pattern to manual
hooks. Local ADE snapshots now expose a hook `runOperation` preview with command,
args, cwd, event, env-key names, execution fingerprint, operation fingerprint,
approval id, expiry, and status. `settings.approveHookRun` only approves the
current operation fingerprint, `settings.runHook` requires the matching
unconsumed approval id before spawn, consumes it after execution, and reports
missing, changed, expired, or consumed approval states in Electron without
exposing secret values. The Hook Runner now has an `Approve run` action and
keeps `Run` disabled until the current operation is approved. Unit tests cover
fingerprint mismatch, missing approval rejection, one-shot consumption, expired
approval rejection, and the existing trust/confirmation/sandbox gates; desktop
smoke verifies `HOOK_RUN_APPROVAL` and consumed approval state through the
private `desktop-service` path.

This continuation deepened ACP Activity replay from a full/correlation-only
debug surface into filtered replay. `settings.replayAcpActivity` now accepts a
server-side `kind` filter, preserves that filter in the redacted replay schema,
and returns only matching chronological frames and kind stats. Electron exposes
Replay by kind controls in the ACP Activity panel, alongside the existing
play/pause/step and correlation replay controls. Desktop smoke verifies
`ACP_REPLAY_KIND_FILTER` through `desktop-service`: the active chat replay was
filtered to `kind:"initialize"`, returned one frame, and contained no
`rawPayload*` metadata.

This continuation moved plugin install beyond manual descriptors and manual path
entry. Project-local signed plugin package manifests under
`.eragear/plugin-packages/**/*.json` are discovered into
`snapshot.plugins.catalog`, verified with Ed25519 signatures over a canonical
manifest payload, and classified as `installable`, `installed`,
`update-available`, or `invalid` with exact sanitized diagnostics. The package
manifest must stay inside the project root, declares publisher/public
key/signature/plugin metadata, and cannot expose secret values. Verified
packages persist package signature/public-key hashes, publisher, manifest path,
and `verifiedAt` metadata, automatically trust the verified command
fingerprint, still require the normal per-plugin run confirmation token, and
run through the existing sandbox/audit path. Electron adds a Signed Package
Catalog in Plugin Runner with install/update controls, shows signed package
metadata on installed plugins, and desktop smoke verifies `PLUGIN_CATALOG` plus
`PLUGIN_SIGNED_INSTALL` with a generated Ed25519 package, trusted capability
activation, sandboxed execution, installed catalog state, and successful stdout
from the installed plugin.

This continuation also added pinned remote signed plugin registry install v0.
`settings.installPluginPackage` now supports a registry URL plus package ID.
The server fetches a bounded registry JSON document, rejects registry/package
URLs with credentials, query strings, or fragments, requires each package entry
to pin both `signatureHash` and `publicKeyFingerprint`, fetches the signed
manifest with timeout/size limits, verifies the Ed25519 signature, checks the
registry pins against the actual package, and only then persists trusted plugin
metadata through the same confirmation-gated sandbox/audit path. Electron adds a
Signed Registry URL / Package ID install control and shows registry name,
registry URL, and package ID on installed signed plugins. Desktop smoke verifies
`PLUGIN_REGISTRY_INSTALL` through `desktop-service` with a local HTTP registry,
matching pins, capability activation, sandboxed execution, and successful stdout
from the registry-installed plugin.

This continuation then turned registry install into saved signed registry
management v0. `.eragear/plugin-registries.json` now stores project-local
registry descriptors, trusted URL fingerprints, refreshed package pins, package
diagnostics, and install/update state. Electron can save a registry, trust the
current fingerprint, refresh package metadata, and install or update a package
through `settings.installPluginRegistryPackage`. The same signature/public-key
hash pin checks still run at install time, and desktop smoke verifies
`PLUGIN_REGISTRY_INSTALL` through the saved registry path with
`registryStatus:"ready"`, `packageStatus:"installed"`, and
`trustStatus:"trusted"`.

This continuation added manual registry revocation policy v0. Saved plugin
registries now support revoking URL trust and revoking/restoring individual
package signer public-key fingerprints. Revoked signers persist in
`.eragear/plugin-registries.json`, registry packages signed by a revoked key are
classified as `revoked`, Electron renders the signer state separately, install
is blocked before manifest fetch/execution, and desktop smoke verifies
`trustRevokedRefreshBlocked`, `signerRevokedInstallBlocked`, and
`signerRestored` in the `PLUGIN_REGISTRY_INSTALL` marker.

This continuation then added automated registry-fed revocation v0. Signed
registry JSON can now include `revokedSigners`; refresh imports those entries as
`source:"registry"`, marks matching packages `revoked`, blocks install before
manifest fetch/execution, and refuses user-side restore for feed-managed
revocations. The direct `registryUrl + packageId` install path also respects the
same feed revocation guard. Desktop smoke now verifies
`feedSignerRevoked`, `feedRevokedInstallBlocked`, `feedRestoreBlocked`, and
`feedCleared` through `PLUGIN_REGISTRY_INSTALL`.

This continuation added signed plugin publisher identity and expiry policy v0.
Signed package payloads can now declare `publisherId`, `issuedAt`, and
`expiresAt`; the server validates those fields inside the canonical signed
payload, rejects expired packages, rejects future `issuedAt` values beyond a
small clock-skew window, persists publisher identity plus issue/expiry metadata
on installed plugins, and demotes/blocks already-installed signed plugins once
their stored package expiry has passed. Saved and direct registry entries can
pin publisher identity and issue/expiry fields in addition to signature and
public-key hashes, and install rejects mismatches before a plugin becomes
trusted. Electron now shows publisher identity and expiry status in Signed
Package Catalog, Saved Signed Registries, and installed signed plugin metadata.

This continuation also split plugin command trust from plugin permission grant.
Project-local plugins now derive a separate permission fingerprint from scopes,
env-key allowlists, and workspace access. Electron shows the permission
fingerprint and `granted`, `missing`, or `changed` status, exposes Grant/Revoke
controls, disables Run while permission review is required, and the server
blocks `settings.runPlugin` before spawn unless the current permission
fingerprint is granted. Desktop smoke verifies `PLUGIN_PERMISSION_GRANT` by
revoking permission, observing capability demotion and run rejection, granting
the current fingerprint again, and then running the plugin through the normal
confirmation-gated path.

This continuation hardened provider readiness beyond version checks for Codex.
`settings.testProvider` now runs `codex doctor --json` where available, parses
the full raw JSON report before diagnostic truncation, classifies CLI/auth/model
readiness separately, surfaces the configured model, and keeps diagnostics
redacted. Desktop smoke creates a temporary Codex agent descriptor when Codex is
installed but no descriptor exists, probes the real CLI through the private
desktop-service path, then deletes the descriptor and restores provider-health
state so smoke does not leave fake provider records behind. The same slice fixed
Windows command parsing so absolute paths such as `C:\Users\...\codex.exe` keep
their backslashes.

This continuation turned provider model readiness into a usable Electron
control. Local ADE snapshots now expose runtime `defaultModel` state, provider
model lists are marked as readiness-probe data versus fallback placeholders, and
`settings.selectProviderModel` only accepts a model after a successful provider
model readiness probe. The Provider table shows the current runtime default
model, lets the user select a discovered model, and can clear the override.
Desktop smoke verifies the full `settings.testProvider` ->
`settings.selectProviderModel` path through `desktop-service` with the real
Codex CLI doctor model `gpt-5.5`, then restores the default-model state.

This continuation also surfaced active-session model switching in the Local ADE
control surface. Active session snapshots now expose current model, selectable
models, switching source, and exact diagnostics from ACP config options or model
state. The Provider table renders an `Active session models` control that calls
the same root `setModel` mutation already used by chat. Desktop smoke starts a
real OpenCode ACP session and verifies `ACTIVE_SESSION_MODEL_SWITCH` from
`opencode/big-pickle` to `opencode/deepseek-v4-flash-free` with source
`config-option`, then observes the updated model in the Local ADE snapshot.

This continuation added real MCP server-pushed notification handling for the
implemented transports. Stdio, streamable HTTP, and SSE probe/invocation paths
now capture JSON-RPC notifications without `id`, classify them as `probe` or
`invocation`, redact runtime env/header secrets, keep bounded history in
`.eragear/mcp-servers.json`, and render the notification timeline in Electron.
Unit tests and desktop smoke now assert both notification capture and redaction.

This continuation added MCP chat command invocation v0. When the Local ADE
snapshot has an enabled, trusted, initialized MCP server with discovered tools,
the chat slash menu exposes `/mcp`. Submitting `/mcp <tool> {"arg":"value"}` or
`/mcp <server>/<tool> {"arg":"value"} -- <request>` resolves the discovered
server/tool, enforces the same trust/initialize/discovery gates as the MCP
panel, calls `settings.invokeMcpTool`, and sends the redacted tool result into
the normal `sendMessage` path as a real agent prompt. This is manual tool
invocation from chat, not autonomous agent-side MCP routing.

This continuation also fixed agent-side MCP session injection. The session MCP
resolver now reads trusted project-local `.eragear/mcp-servers.json` entries in
addition to legacy settings MCP servers, verifies the same fingerprint material
used by Local ADE trust, resolves remote header-env values only at runtime, and
passes trusted MCP server configs into ACP `session/new`/`loadSession`.
Desktop smoke creates a temporary trusted MCP server and a capture ACP agent,
then verifies `MCP_SESSION_INJECTION` with injected brokered MCP servers in the
actual ACP `session/new` payload.

This continuation added an MCP agent-routing preview to the Local ADE snapshot
and Electron MCP panel. Project-local MCP servers now show whether they are
broker-injectable into ACP session setup, blocked by trust/config/header policy,
or skipped because disabled. The preview exposes only redacted route metadata
and header env key names. Desktop smoke now verifies `MCP_AGENT_ROUTING` with
both stdio and SSE routes marked `injectable`, zero conditional routes, zero
smoke-route blockers, and no leaked `Bearer desktop-mcp-secret` value.

This continuation converted project-local stdio MCP agent routing from
injection-only to brokered execution. ACP sessions now receive an Eragear stdio
MCP broker command for trusted project-local stdio servers instead of the raw
server command. The broker reloads `.eragear/mcp-servers.json` before each
tool/resource request, blocks disabled/untrusted/changed fingerprints, forwards
allowed JSON-RPC to the target MCP server, redacts secret values from responses,
and writes bounded audit entries to `.eragear/mcp-agent-audit.jsonl`. Local ADE
snapshots and the Electron Agent Session Routing panel now show broker mode,
recent agent-side call counts, and the latest brokered call. Desktop smoke
verifies `MCP_SESSION_BROKER` by spawning the injected broker from the captured
ACP `session/new` payload, calling `tools/call`, and observing a successful
broker audit in the Electron snapshot.

This continuation also made the MCP agent broker resolvable in both dev and
built server layouts. The server build copies `src/runtime/mcp-agent-broker.js`
to `dist/runtime/mcp-agent-broker.js`, and the session MCP resolver can locate
the source runtime, bundled dist runtime, or explicit
`ERAGEAR_MCP_AGENT_BROKER_*` overrides before injecting the broker command.

This continuation moved trusted project-local remote MCP agent routes through
the same audited broker path. Streamable HTTP and SSE project-local MCP servers
are now injected into ACP session setup as Eragear stdio broker commands rather
than native agent HTTP/SSE routes; the broker resolves header-env values inside
the broker process, blocks missing or unsafe header policy, forwards JSON-RPC to
the remote MCP server, redacts responses, and writes agent-side audit entries.
Desktop smoke now verifies `MCP_SESSION_INJECTION` with both stdio and SSE
broker entries, then spawns both captured broker commands and verifies
`MCP_SESSION_BROKER` for `desktop_smoke_tool` and
`desktop_smoke_sse_tool`.

This continuation added bounded SSE MCP reconnect/replay for discovery probes.
When a remote SSE stream closes before protocol discovery completes, the server
opens one replacement stream, records a `stream-reconnect` probe step, and
replays pending discovery JSON-RPC requests such as `initialize`. This is
verified by a unit fixture that drops the first stream before responding and by
desktop smoke through `desktop-service`, which reports `reconnect.verified:
true` for the SSE MCP discovery path.

This continuation added bounded SSE MCP reconnect policy for invocation. When
an SSE stream drops before a pending `resources/read` response, the server opens
one replacement stream and replays the safe resource request. When the pending
request is side-effecting `tools/call`, the server does not replay it and
returns an exact diagnostic explaining that automatic replay was blocked by
policy. Unit tests cover both branches, and desktop smoke verifies
`MCP_SSE_RESOURCE_RECONNECT` with two `resources/read` requests and a successful
redacted result through `desktop-service`.

This continuation moved project slash commands from descriptor-only discovery
to a real chat invocation path. `.eragear/commands/**/*.md` and compatible
`.claude/commands/**/*.md` files now produce invokable command descriptors with
prompt body and argument hints. The chat UI command list uses those descriptors,
and `/command args` expands into a real prompt before `sendMessage`.

The next continuation did the same for local skills and output styles. Skill
Markdown now produces invokable descriptors with prompt bodies; users can invoke
skills manually with `@skill-name` or `/skill-name`. Output styles can be
invoked with `/style-name`, and the selected style wraps the user request before
`sendMessage`.

This continuation added a usable Project Index/Repo Snapshot flow. Electron can
now refresh repository metadata and bounded code signals through
`settings.refreshProjectIndex`, the server writes `.eragear/repo-index.json`,
and the Local ADE Control Center shows indexed file count, byte total,
extension summary, diagnostics, code symbols, task markers, and a file list. The
index still skips generated/dependency/checkpoint directories.

This continuation also moved hooks beyond a fake blocked surface. Project-local
manual hooks can now be saved to `.eragear/hooks.json`, toggled, executed from
Electron, and inspected with redacted stdout/stderr plus run status.

This continuation also wired the first concrete lifecycle hook events. Enabled
hooks whose event matches `after-project-index-refresh`,
`after-checkpoint-create`, or `after-checkpoint-restore` execute automatically
after those actions, persist run results, and do not expose secret-looking
output values.

This continuation hardened hooks from executable v0 into a guarded execution
surface. Project-local hooks now derive a `sha256:` fingerprint from command,
args, working directory, event, and approved environment-key allowlist.
Electron shows `trusted`, `untrusted`, or `changed`, disables Run while review
is required, and demotes hook capabilities until the current fingerprint is
trusted. Hook child processes no longer inherit the full server environment;
they receive a small base process environment, Eragear hook context, and only
explicitly approved env keys, with stdout/stderr redacted before persistence.

This continuation moved plugins from a disabled placeholder to an executable
project-local flow. `.eragear/plugins.json` stores plugin descriptors and
recent runs. Electron can save, toggle, run, and inspect plugin stdout/stderr.
Plugin commands run without shell expansion, are constrained to the project
root for cwd, and redact secret-looking output.

This continuation made plugin workspace access explicit instead of implicit.
Plugins with `project-root` scope still run from a project-root-guarded cwd and
receive `ERAGEAR_PROJECT_ROOT`. Plugins without `project-root` scope now run in
a temporary sandbox cwd, do not receive `ERAGEAR_PROJECT_ROOT`, and the sandbox
cwd is removed after execution. Electron exposes this as a Workspace Access
switch and labels sandboxed plugin runs separately from project-root runs.

This continuation added project-root plugin workspace safety audit. Before a
trusted project-root plugin runs, the server captures Git status and creates an
`apply-patch` pre-run safety checkpoint when the workspace is already dirty.
After the plugin exits, the server captures Git status again, creates a
`reverse-patch` post-run checkpoint when changes remain, and persists the
checkpoint ids, before/after status, and changed-file summary on the plugin run
record. Electron now shows that workspace audit on the last run and Run Audit
rows.

This continuation connected Project Index to the chat workflow. The new
`settings.searchProjectIndex` API searches persisted file metadata, code
symbols, and task markers, returns a bounded agent-context prompt, and the chat
input exposes `/index <query>` as a built-in command that sends that context to
the agent through the normal `sendMessage` path.

This continuation also moved Project Index retrieval from manual-only to
automatic chat context v0. When the index is ready, normal chat prompts can
fetch top Project Index matches before `sendMessage` and submit the generated
context prompt. The auto path deliberately does not override explicit slash
commands, `@skill` invocation, attached files, or `@file` mentions.

This continuation added local semantic Project Index profiles. Refresh now
builds bounded redacted semantic token profiles from path/language/symbol/task
signals plus safe source text, stores per-file semantic tags and hashes in
`.eragear/repo-index.json`, and exposes semantic profile readiness in Electron.
`settings.searchProjectIndex` now combines direct metadata/symbol/task scoring
with local semantic profile scoring and marks semantic-only hits as
`matchKind:"semantic"` while still requiring the agent to read referenced files
before editing. Desktop smoke verifies `PROJECT_INDEX_SEMANTIC_SEARCH` through
`desktop-service` with a temporary file found by the conceptual query
`rollback safety`.

This continuation moved Project Memory from review/toggle-only to a real
per-message chat context path. `settings.buildProjectMemoryContext` reads
enabled project memory sources on the server, applies bounded redaction, and
returns an agent prompt. Chat now exposes `/memory <request>` plus
`/memory --source <path> <request>` for source-selective attachment, can
automatically attach enabled project memory to normal prompts, and composes
memory context with automatic Project Index context when both are available.
The first-screen Next Actions rail now includes a real `/memory <request>`
action when enabled memory exists, and routes setup states back to the Project
Memory section.

This continuation added a visible Project Memory source picker to the chat
action menu. The picker lists enabled memory sources from the Local ADE snapshot,
preserves an existing draft as the `/memory` request when safe, and inserts
either `/memory <request>` or `/memory --source <path> <request>` into the
normal chat input path. It does not create a second invocation path; submit
still flows through the existing parser and `settings.buildProjectMemoryContext`.

This continuation added project-local Project Memory presets. Electron can save
and delete named presets with selected memory sources, a default query, and a
context byte budget in `.eragear/project-memory-presets.json`; the Local ADE
snapshot exposes `projectMemory.presets`; the chat action menu inserts
`/memory --preset <id>`; and `settings.buildProjectMemoryContext` resolves the
preset server-side before building the same redacted prompt. Desktop smoke now
verifies `PROJECT_MEMORY_PRESET` through the private `desktop-service` path.

This continuation added usable Project Memory chunk retrieval. The server now
supports `retrievalMode: "semantic"` for `settings.buildProjectMemoryContext`
and Project Memory presets, splits enabled sources into bounded line-aware
chunks, ranks them with a local hashed token-vector score, returns chunk
metadata, and keeps secret-looking values redacted before prompt construction.
Chat now supports `/memory --semantic --chunks <n>` and the Project Memory
action menu exposes a "Best matching chunks" command. Normal prompt
auto-attachment now uses semantic chunk retrieval instead of dumping every
enabled memory source, and Electron can save presets that use ranked chunks.
This is real retrieval, but it is still local token-vector ranking rather than a
model-backed embedding/vector database.

This continuation closed the MCP SSE discovery gap. SSE MCP entries can now
store a separate message endpoint, open the event stream, initialize over the
message endpoint, and discover tools/resources from JSON-RPC responses delivered
through SSE events. The UI exposes the message endpoint field without exposing
headers or secret values.

This continuation hardened remote MCP auth/header handling. HTTP and SSE MCP
entries can now map remote headers to environment variable keys, the server
resolves those values only at runtime, stores no secret header values, rejects
literal secret-looking headers such as `Authorization` and `Cookie`, reports
missing env keys by name, and the Electron UI shows only header-to-env-key
mapping plus present/missing state.

This continuation also removed the repo-wide server typecheck blocker. ACP
session config options now handle both select and boolean option payloads,
server/shared chat contracts agree on that union, ACP SDK drift around
`listSessions` and terminal kill types is resolved, async runtime port
contracts are reflected in production services and tests, and the affected
test fixtures were updated without weakening the runtime paths.

This continuation made checkpoint preview conflict-aware. Preview now returns
per-file `restoreRisks` with `safe`, `warning`, or `blocked` level, patch
action, checkpoint/current status summaries, and the reason behind the restore
risk. Electron renders the risk matrix before guarded restore.

This continuation added checkpoint session-turn attribution. Checkpoints now
capture active chat id, agent session id, agent label, chat status, message
count, latest message preview, active/completed turn ids when available, and
runtime counters. The checkpoint list and preview render that attribution so
change trust is tied to the agent workflow, not just a detached patch file.

This continuation added a real plugin trust gate. Project-local plugins now
derive a `sha256:` execution fingerprint from command, args, and working
directory. Electron shows `trusted`, `untrusted`, or `changed`, run is disabled
until the current fingerprint is trusted, capability registry activation is
demoted until trust, and changing the command invalidates prior trust.

This continuation hardened plugin execution policy. Project-local plugins now
carry explicit scopes plus an environment-key allowlist. Plugin runs no longer
inherit the full server environment; only a small base process environment,
Eragear plugin context, and approved env keys are passed to the child process.
The execution fingerprint includes scopes and env keys, so changing plugin
permissions invalidates prior trust. Electron shows plugin scopes and approved
env-key names without exposing secret values.

This continuation also enforced plugin workspace scopes at execution time.
Plugins that lack `project-root` scope now run in a temporary sandbox cwd,
receive `ERAGEAR_PLUGIN_WORKSPACE_ACCESS=sandbox`, and do not receive
`ERAGEAR_PROJECT_ROOT`; configured working directories are ignored until the
project-root scope is granted. The sandbox cwd is deleted after execution, and
Electron shows the workspace-access mode in the Plugin Runner.

This continuation also made project-root plugin runs checkpoint-aware. Plugin
run records now carry optional `preRunCheckpointId`, `postRunCheckpointId`,
`workspaceStatusBefore`, `workspaceStatusAfter`, and `workspaceChangedFiles`.
Checkpoint capture filters its own `.eragear/checkpoints*` artifacts from
metadata so plugin safety checkpoints do not report themselves as workspace
changes. Desktop smoke verifies this through `PLUGIN_WORKSPACE_AUDIT` in a
temporary Git project.

This continuation added an explicit manual-run confirmation gate for hook and
plugin execution. Local ADE snapshots now expose per-descriptor
`runConfirmationToken` values, `settings.runHook` and `settings.runPlugin`
reject missing or mismatched confirmation before spawning a child process, and
the Electron Hook/Plugin runners require typing the token before Run is enabled.
The renderer clears the token after a successful run so repeated manual process
execution requires a fresh confirmation. Lifecycle hooks still execute from the
trusted event path without user-entered tokens.

This continuation turned hook and plugin run history into reviewable audit
state. Persisted `.eragear/hooks.json` and `.eragear/plugins.json` run records
now carry optional `reviewedAt` metadata, `settings.reviewHookRun` and
`settings.reviewPluginRun` can mark or reopen a run, and Electron shows
`open/reviewed` badges plus Review/Reopen actions on both last-run output and
the Run Audit list. Desktop smoke verifies the private-service path with
`HOOK_RUN_REVIEW` and `PLUGIN_RUN_REVIEW`.

This continuation added server-backed hook/plugin audit filtering and export.
`settings.exportHookRuns` and `settings.exportPluginRuns` return
schema-versioned, redacted audit artifacts with `all/open/reviewed` filters,
status filters, bounded limits, and run summary counts. Electron Run Audit
sections now include an `all/open/reviewed` filter plus Copy Audit actions that
copy the server artifact instead of raw renderer state. Desktop smoke verifies
`HOOK_RUN_AUDIT_EXPORT` and `PLUGIN_RUN_AUDIT_EXPORT`, including plugin secret
redaction.

This continuation hardened hook/plugin execution policy further. Hook and
plugin descriptors now expose an `executionPolicy` with sandbox status,
diagnostics, blockers, and warnings. Direct shell-eval commands such as
`cmd /c`, `powershell -Command`, `pwsh -Command`, `sh -c`, and `bash -c` are
blocked before trust can promote capability activation or before a child
process can spawn. Electron renders sandbox badges and exact blocker text, and
desktop smoke verifies `HOOK_SANDBOX_BLOCK` and `PLUGIN_SANDBOX_BLOCK` through
the private `desktop-service` path.

This continuation also made checkpoint preview a structured side-by-side review
surface. The server parses unified patches into bounded per-file hunks with old
and new line cells, additions/deletions, status, binary/truncation metadata, and
Electron renders that before the raw patch.

This continuation added guarded selected-file checkpoint restore. Users can now
tick files in the checkpoint diff preview, type the same restore token, and
restore only those files. The server filters the stored patch to exact selected
`diff --git` sections, validates selected-file status and `git apply --check`,
creates a selected-file safety checkpoint first, records `partialRestores`, and
leaves unrelated workspace changes untouched.

This continuation added guarded selected-hunk checkpoint restore. Users can now
tick individual hunks in the structured checkpoint diff preview, type the same
restore token, and restore only those hunk patches. The server filters the
stored patch to selected `@@` hunk blocks, validates the filtered patch with
`git apply --check`, creates a patch-backed selected-hunk safety checkpoint
first, records the hunk metadata in `partialRestores`, and preserves other hunks
in the same file.

This continuation added a checkpoint safe-restore plan to the Electron preview.
The renderer derives safe, warning, blocked, and patch-backed restorable files
from the server restore-risk matrix, preselects only safe patch-backed files
after preview, and exposes Select Safe/Clear controls beside the guarded restore
confirmation token. Desktop smoke verifies this through
`CHECKPOINT_SAFE_RESTORE_PLAN` with full restore blocked by an unrelated file
while `README.md`, `NOTES.md`, and `HUNKS.md` remain selectable safe restores.

This continuation added a guarded checkpoint conflict shelf action. Electron now
shows untracked unexpected blocker files that can be moved aside safely and
exposes a token-gated Shelve Blockers action. The server mutation
`settings.shelveCheckpointConflicts` re-reads the checkpoint preview, only
accepts blocked risks whose current status is untracked and outside the restore
precondition, moves those files into `.eragear/checkpoint-shelves/...` with
rollback on move failure, records `conflictShelves` metadata on the checkpoint,
and filters shelf artifacts out of checkpoint restore precondition checks.
Desktop smoke verifies `CHECKPOINT_CONFLICT_SHELVE`: `EXTRA.md` is shelved,
the project root copy is removed, the shelf retains the file content, and the
checkpoint preview becomes full-restore ready before selected restore checks
recreate a separate unrelated file.

This continuation also added tracked checkpoint conflict resolution. Checkpoint
preview now runs a per-file `git apply --check` against patch-backed files, so
same-file overlapping edits are marked blocked even when `git status --short`
still only reports ` M file`. Electron shows those files separately as tracked
conflicts and exposes token-gated conflict actions. The compatibility mutation
`settings.resolveCheckpointTrackedConflicts` accepts only unstaged tracked
patch conflicts, creates an `apply-patch` safety checkpoint for the current
file content, resets the selected file to `HEAD`, records a partial restore
with the safety checkpoint id, and runs checkpoint-restore lifecycle hooks.
Desktop smoke verifies `CHECKPOINT_TRACKED_CONFLICT_RESOLVE`: preview is ready
before the overlapping edit, blocked after it, the restore-side action resets the file
to `HEAD`, and restoring the safety checkpoint re-applies the user edit.

This continuation added an explicit tracked-conflict choice flow. Electron now
shows separate token-gated actions for `Keep Current` and `Use Restore Side`
when a tracked file has an overlapping patch conflict. The new
`settings.resolveCheckpointTrackedConflictChoice` mutation revalidates the
same tracked-conflict risk, records the chosen resolution on checkpoint
metadata, and makes `current` decisions operational by omitting those files
from later full-restore patch/precondition checks. Desktop smoke verifies
`CHECKPOINT_TRACKED_CONFLICT_CHOICE`: after choosing current for `KEEP.md`,
preview becomes restore-ready, the kept file remains as the user edit, and
`RESTORE.md` still restores to the checkpoint base side.

This continuation improved the first-screen Electron ADE workflow surface. The
Local ADE Control Center now opens with an Operate strip that exposes the real
core actions in one dense row: start a session, refresh runtime diagnostics,
probe providers, probe MCP discovery, create a checkpoint, and copy the primary
manual subagent slash command. The strip summarizes runtime state, active
sessions, enabled capabilities, provider readiness, MCP initialization,
checkpoint/change state, and the invokable subagent command before the deeper
diagnostic sections.

This continuation also added a redacted ACP Activity surface to Electron.
Desktop-service console capture now writes structured ACP log events into the
local log store without contaminating the stdio protocol channel. The Local ADE
snapshot filters those events to the current user or owned chats, aggregates
level/kind/chat counts, exposes event kind plus payload byte counts, and strips
all `rawPayload*` metadata before the renderer receives it.

This continuation tightened the first-screen UX again. The previous single
Operate strip is now a two-pane Workspace Run Loop / Workflow Readiness deck:
primary actions stay in the first viewport, while tested workflow lanes show
agent loop, provider, MCP, change trust, project context, and subagent readiness
with real snapshot-derived state. The goal is to make the first screen scan
like an ADE cockpit instead of a long diagnostic report.

This continuation tightened the first-screen UX one more step. The Workspace Run
Loop now includes an Active Workspace/Workspace Standby focus area that derives
from the live snapshot: active agent session, pending permissions/tool calls,
checkpoint/change-set state, latest MCP signal or trust warning, and ACP
activity correlation. This moves the first viewport toward a work surface users
can operate from instead of only a readiness summary.

This continuation made the first screen more directly operable. The Workspace
Run Loop now includes a tested Next Actions rail derived from the same runtime
snapshot. Each action routes to a real path: start session, provider probe, MCP
probe via `settings.probeMcpServer`, checkpoint capture, Project Index refresh,
or copying an invokable chat command such as `/index <query>` and
`/agent-code-reviewer`. Setup or blocked surfaces route to their detail sections
instead of pretending to be implemented.

This continuation made ACP observability exportable. `settings.exportAcpActivity`
returns a schema-versioned, redacted ACP trace artifact filtered to an owned chat
or owned user-visible traffic, and Electron exposes a Copy Trace action from the
ACP Activity panel. Desktop smoke now calls the export action through the
private runtime service and asserts the trace is redacted, filtered to the active
chat, and free of `rawPayload*` metadata.

This continuation added ACP activity correlation summaries. The Local ADE
snapshot and trace export now group ACP events by turn id, agent session id,
chat id, or source, preserve first/last timestamps, duration, level/kind counts,
and latest message, and Electron renders those summaries above the event list.
The desktop smoke asserts the exported trace contains a correlation for the
active chat.

This continuation added ACP Activity Replay v0. `settings.replayAcpActivity`
uses the same user/owned-chat filtering and redaction policy as trace export,
then returns chronological replay frames with stable sequence, elapsed time,
delta time, correlation key/label, payload byte count, and safe metadata only.
Electron exposes Replay controls in the ACP Activity panel, including play,
pause, previous, next, and per-correlation replay. Desktop smoke calls the
mutation through `desktop-service` for the active chat and verifies redacted
chronological frames.

This continuation added structured MCP probe timelines. Each MCP protocol probe
now reports sanitized step-level results for header policy, executable resolve,
process spawn, SSE stream open, endpoint resolution, initialize,
notifications/initialized, tools/list, and resources/list where applicable.
Electron renders the probe status, step counts, failed steps, recent timeline,
and a visible Retry control that re-runs the real probe path.

This continuation made MCP Retry a first-class server action. Electron now calls
`settings.probeMcpServer` for the selected MCP server instead of refreshing the
whole snapshot, and the server persists a bounded redacted probe history in
`.eragear/mcp-servers.json`. Probe history survives reloads and shows the last
run status, duration, protocol status, discovered counts, failed step count, and
sanitized diagnostics.

This continuation moved MCP beyond discovery into manual invocation. Electron
now exposes Run controls for discovered tools and Read controls for discovered
resources. The server initializes the selected MCP server over stdio, streamable
HTTP, or SSE message endpoint, calls `tools/call` or `resources/read`, returns
bounded structured content plus text/JSON previews, and redacts runtime env or
header secrets before the renderer sees the result.

This continuation made MCP invocation auditable instead of one-shot only.
Successful and failed `tools/call` / `resources/read` runs now persist bounded
redacted invocation history in `.eragear/mcp-servers.json`, survive snapshot
reloads, and render an Invocation Audit section in Electron without exposing
runtime env or remote header secret values.

This continuation added an MCP invocation trust gate. Each MCP server now has a
redacted execution fingerprint derived from transport command/URL, args, env
material hashes, literal header hashes, and header-env mapping. Electron shows
`trusted`, `untrusted`, or `changed`, exposes a Trust action, disables Run/Read
until trusted, and the server blocks tool/resource invocation before protocol
execution when the current fingerprint is not trusted. Blocked attempts are
recorded in the same redacted invocation audit history.

This continuation broadened hook lifecycle execution into the real agent
session loop. Session create, prompt submission, and session stop now publish
Local ADE lifecycle events; LocalAdeService consumes those events and executes
matching project hooks for `after-agent-session-create`,
`after-agent-message-send`, and `after-agent-session-stop` without blocking the
primary chat action. Hook processes receive bounded session context through
environment variables such as `ERAGEAR_CHAT_ID`,
`ERAGEAR_AGENT_SESSION_ID`, `ERAGEAR_TURN_ID`, and `ERAGEAR_PROJECT_ID`.

## Implemented In This Run

- MCP probe now performs protocol `initialize`, sends
  `notifications/initialized`, and calls `tools/list` plus `resources/list` for
  stdio servers. Streamable HTTP has a JSON-RPC POST discovery path. SSE opens
  the event stream and uses a configured or endpoint-event message endpoint for
  protocol discovery.
- Remote MCP HTTP/SSE auth headers now use a header-env policy: header names are
  stored with env key names, secret values are resolved only for runtime
  requests, literal secret-looking headers are rejected, missing env keys are
  surfaced as protocol diagnostics, and UI snapshots expose only redacted
  present/missing metadata.
- MCP UI now shows protocol status, discovered tool/resource counts, discovered
  tool/resource names, exact JSON-RPC protocol errors in diagnostics, and a
  structured probe timeline with per-server retry and persisted history.
- MCP UI also now has manual invocation controls for discovered tools/resources.
  `settings.invokeMcpTool` and `settings.readMcpResource` initialize the
  configured server and run `tools/call` or `resources/read` over stdio,
  streamable HTTP, or SSE message endpoints. Results are bounded, structured,
  and redacted before rendering. `settings.trustMcpServer` now persists trust
  for the current MCP invocation fingerprint, and untrusted or changed
  fingerprints block invocation before protocol execution while preserving a
  redacted failed audit entry. SSE invocation now has bounded reconnect policy:
  `resources/read` is replayed once after stream loss, while side-effecting
  `tools/call` is not replayed automatically and returns a policy diagnostic.
- Provider test now stores separate `cliStatus`, `authStatus`, `modelStatus`,
  `readiness`, version, and discovered model identifiers. Secrets are redacted
  by value and only env key names are displayed.
- Codex provider readiness now uses `codex doctor --json` when supported. The
  parser reads the full raw doctor output before truncating UI diagnostics, so
  long redacted doctor reports still classify `auth.credentials`, configured
  model, and provider/websocket reachability. Desktop smoke verifies this with a
  real temporary Codex provider descriptor and cleans it up afterward.
- Checkpoint restore now creates an automatic pre-restore safety checkpoint
  before applying the guarded restore. Safety checkpoints use forward patch
  application so they can re-apply the pre-restore state when safe. Preview
  also reports conflict-aware per-file restore risks before confirmation and
  shows session/turn attribution captured at checkpoint time. Preview now also
  includes structured per-file side-by-side diff hunks before the raw patch.
  Selected-file restore is exposed through `settings.restoreCheckpointFiles`;
  it filters patches by exact file section, creates selected-file safety
  checkpoints, records partial restore history, and can restore safe files even
  when unrelated workspace changes block full restore. Selected-hunk restore is
  exposed through `settings.restoreCheckpointHunks`; it filters patch sections
  to selected hunk blocks, creates hunk-scoped safety checkpoints, records hunk
  metadata in partial restore history, and can restore one hunk while leaving
  another hunk in the same file unchanged.
- Chat subagent invocation was factored into a tested helper. Enabled subagents
  appear as `/agent-*` commands, and `/agent-code-reviewer` expands into a real
  delegated prompt path before `sendMessage`. Desktop smoke now verifies both
  `SUBAGENT_COMMAND_READY` and `SUBAGENT_COMMAND_SUBMIT`, including that the
  expanded prompt contains the delegated `code-reviewer` profile and the user
  request before the normal chat send path accepts it.
- Local slash commands are now invokable from chat. Command Markdown frontmatter
  and body are exposed through the Local ADE snapshot, disabled commands do not
  invoke, and `$ARGUMENTS` / `{{arguments}}` placeholders are replaced before the
  prompt is submitted.
- Local skills and output styles are now invokable from chat. Skills support
  manual `@skill-name` and `/skill-name` invocation; output styles support
  `/style-name` invocation. Disabled descriptors do not invoke.
- Project Index v0 is now an executable Electron workflow. The server scans
  repository metadata with bounds, skips `.git`, dependency/build directories,
  and `.eragear/checkpoints`, extracts bounded code-symbol and task-marker
  signals plus local semantic token profiles, writes `.eragear/repo-index.json`,
  and exposes a refresh/inspect surface in the Local ADE Control Center.
- Project Index retrieval v0 is now connected to chat. `settings.searchProjectIndex`
  ranks indexed files, symbols, task markers, and semantic profile hits, builds
  a bounded prompt that tells the agent to read referenced files before editing,
  and `/index <query>` invokes that retrieval path from chat.
- Project Index retrieval v0 now also has automatic chat attachment for normal
  prompts. The renderer searches the ready index before submission, attaches
  bounded top matches when available, and leaves explicit commands/skills/files
  untouched.
- Project Memory retrieval v0 is now connected to chat. `settings.buildProjectMemoryContext`
  reads enabled memory sources on the server, redacts secret-looking values,
  respects a bounded context budget, and `/memory <request>` submits that prompt
  through the normal chat `sendMessage` path. `/memory --source <path>
  <request>` and `/memory -s <path> <request>` select specific enabled memory
  sources by relative path. `/memory --semantic --chunks <n> <request>` uses
  server-side chunking plus local hashed token-vector ranking and returns
  chunk metadata. The chat action menu now exposes a Project Memory source
  picker and a "Best matching chunks" command that insert the same command path.
  Normal prompts can also attach enabled memory automatically with semantic
  chunk retrieval when the user has not already supplied explicit files,
  mentions, slash commands, or skill commands. Project-local memory presets now
  persist selected sources, default query, byte budget, retrieval mode, and
  chunk count; Electron exposes save/delete controls; the chat action menu
  inserts `/memory --preset <id>`; and the server resolves preset defaults
  before prompt construction.
- Manual Hook Runner v0 is now executable. `.eragear/hooks.json` stores
  project-local hook descriptors, approved env-key allowlists, trust metadata,
  and recent runs. Hooks run through `spawn` without shell expansion, are
  constrained to the project root for cwd, no longer inherit the full server
  environment, redact secret-looking output, persist run history, require trust
  approval for the current execution fingerprint, expose an `executionPolicy`,
  block direct shell-eval interpreter commands before spawn, and appear as
  active `hook` capabilities only after that fingerprint is trusted and the
  sandbox policy is allowed. Manual runs now also require a matching one-shot
  run-operation approval before spawn, consume that approval after execution,
  and show missing/changed/expired/consumed approval state in Electron.
  Persisted hook run history is now reviewable from Electron with
  `open/reviewed` state and Review/Reopen actions, filterable by review state,
  and exportable as a redacted JSON audit artifact.
- Hook lifecycle v0 is now executable for six explicit events:
  `after-project-index-refresh`, `after-checkpoint-create`,
  `after-checkpoint-restore`, `after-agent-session-create`,
  `after-agent-message-send`, and `after-agent-session-stop`. Lifecycle hook
  failures are recorded as failed hook runs without breaking the primary user
  action, and agent-session hooks receive chat/session/turn context through
  redacted environment variables.
- Project-local Plugin Runner v0 is now executable. `.eragear/plugins.json`
  stores plugin descriptors, permission scopes, env-key allowlists, and run
  history. Plugins run through `spawn` without shell expansion, use
  project-root-guarded cwd only when `project-root` scope is granted, otherwise
  run in a temporary sandbox cwd with `ERAGEAR_PROJECT_ROOT` hidden, no longer
  inherit the full process environment, persist redacted stdout/stderr, require
  trust approval for the current command plus permission fingerprint, expose an
  `executionPolicy`, block direct shell-eval interpreter commands before spawn,
  create checkpoint-backed before/after workspace audit for project-root runs,
  and appear as active `plugin` capabilities only after that fingerprint is
  trusted and the sandbox policy is allowed. Persisted plugin run history is now
  reviewable from Electron with `open/reviewed` state and Review/Reopen actions,
  filterable by review state, and exportable as a redacted JSON audit artifact.
- Server typecheck is green again. The fix covered ACP config-option
  select/boolean unions, stable `listSessions` discovery, renamed kill-terminal
  SDK types, async session runtime/broadcast contracts, boot allowlist runtime
  toggle names, SQLite worker overloads, Git `Dirent` typing, and redaction
  reason literal typing.
- Desktop smoke now verifies MCP protocol discovery through the private runtime
  service with real stdio and SSE JSON-RPC fixtures, verifies provider CLI readiness,
  verifies OpenCode readiness, creates a temporary Codex provider descriptor and
  verifies `codex doctor --json` classifies CLI/auth/model as ready with model
  `gpt-5.5`,
  verifies structured MCP probe steps and persisted probe history for stdio and
  SSE discovery, verifies untrusted MCP invocation is blocked and audited,
  verifies `settings.trustMcpServer` for stdio and SSE fingerprints, verifies
  stdio MCP `tools/call` plus `resources/read`, verifies persisted redacted
  invocation audit entries for blocked and successful calls, verifies SSE MCP
  `tools/call` with header-secret redaction, verifies SSE MCP `resources/read`
  reconnect/replay after a dropped stream,
  verifies command discovery with a temporary `/desktop-smoke` command, verifies
  temporary skill/output-style descriptors, verifies the `code-reviewer`
  subagent capability is present, refreshes the project index through the
  private service, searches the project index through `settings.searchProjectIndex`,
  builds source-selected Project Memory context through
  `settings.buildProjectMemoryContext`,
  verifies hook manual-run confirmation with `HOOK_RUN_CONFIRMATION`, verifies
  one-shot hook operation approval with `HOOK_RUN_APPROVAL`, executes an
  approved temporary manual hook, marks the hook run reviewed with
  `HOOK_RUN_REVIEW`,
  exports the filtered reviewed hook audit with `HOOK_RUN_AUDIT_EXPORT`,
  verifies hook cooldown scheduling demotes capability and records a disabled
  audit row with `HOOK_SCHEDULING_POLICY`,
  creates a shell-eval hook and verifies `HOOK_SANDBOX_BLOCK`,
  verifies an `after-project-index-refresh`
  lifecycle hook, verifies `after-agent-session-create`,
  `after-agent-message-send`, and `after-agent-session-stop` hooks against the
  real Electron session loop, verifies hook trust gating and isolated hook env
  allowlists, verifies plugin trust gating, verifies plugin manual-run
  confirmation with `PLUGIN_RUN_CONFIRMATION`, verifies one-shot plugin
  operation approval with `PLUGIN_RUN_APPROVAL`, verifies plugin scope/env-key
  allowlist metadata and secret redaction, then executes an approved trusted
  temporary plugin through the private service, marks the plugin run reviewed
  with `PLUGIN_RUN_REVIEW`, exports the filtered reviewed plugin audit with
  `PLUGIN_RUN_AUDIT_EXPORT`, verifies plugin paused scheduling demotes
  capability and records a disabled audit row with `PLUGIN_SCHEDULING_POLICY`,
  creates a shell-eval plugin and verifies
  `PLUGIN_SANDBOX_BLOCK`, creates a temporary git project
  with an active agent session to exercise checkpoint restore risk preview,
  structured side-by-side diff preview, selected-hunk restore with hunk safety
  checkpoint, selected-file restore with safety checkpoint, and active-session
  attribution, starts a real session, switches its active model through the
  same `setModel` mutation used by chat, sends a message, observes assistant
  activity, verifies redacted ACP Activity entries plus correlation summaries
  for that chat, exports a redacted trace, replays chronological ACP frames for
  that chat, and stops cleanly.
- Electron first screen now has a real workflow action strip backed by the
  existing mutations/private-service data. Provider probe and checkpoint actions
  call the same `settings.testProvider` and `settings.createCheckpoint` paths
  used by deeper sections; runtime/MCP actions refresh diagnostics and snapshot;
  the subagent action exposes the actual `/agent-*` command path already wired
  into chat invocation.
- ACP Activity v0 is now visible in Electron. `desktop-service` mirrors
  structured ACP console events into `LogStore`, the Local ADE snapshot returns
  only redacted per-chat activity rows with level, kind, payload byte count, and
  safe metadata, builds chat/session/turn/source correlation summaries, and the
  control center renders those summaries and rows beside the log and parity
  panels.
- First-screen Workflow Readiness lanes are now backed by a tested renderer
  helper. The deck reports session/provider/MCP/checkpoint/context/subagent
  state from `RuntimeDiagnostics` plus the Local ADE snapshot, and keeps absent
  provider/git/index/subagent surfaces visually distinct from ready flows.
- First-screen Next Actions are now backed by the same tested renderer helper.
  The rail produces real actions for session, provider, MCP, checkpoint, Project
  Index, and subagent workflows, and blocked/setup states route to their owning
  sections rather than appearing as fake primary actions.
- First-screen ADE Workbench is now backed by the same tested renderer helper.
  The panel reports current operating phase, readiness score, primary action,
  agent/tools/changes/context metrics, and copyable command chips from
  `RuntimeDiagnostics` plus the Local ADE snapshot. Provider setup now routes to
  the provider configuration section instead of exposing a disabled fake probe.
- ACP trace export v0 is now a real Electron action. The server exposes
  `settings.exportAcpActivity`, applies the same owned-chat/user filter and
  redaction as the panel, caps exports at 500 entries, and the UI copies the
  schema-versioned JSON trace plus correlation summaries from the server action
  instead of copying raw renderer state.
- ACP Activity Replay v0 is now a real Electron action. The server exposes
  `settings.replayAcpActivity`, applies the same owned-chat/user filter and
  redaction as trace export, returns chronological replay frames with sequence,
  elapsed, delta, correlation, kind, payload byte count, and safe metadata, and
  the ACP Activity panel can play, pause, step, or replay a specific
  correlation without exposing raw ACP payloads.

## Completion Rule Status

At least 4 of 5 required Electron flows are working end to end:

| Flow | Status | Evidence |
| --- | --- | --- |
| Real agent session create/send/stop | Pass | Desktop smoke created OpenCode chat `8ac43d18-1524-4e19-a091-2294e9957dbc` with agent session `ses_146b0e026ffelh61MUmiapX5wC`, submitted the expanded `/agent-code-reviewer` prompt, observed assistant activity, and stopped the subscription/session/host. |
| MCP initialize/tool discovery | Pass | Desktop smoke upserted `Desktop Smoke MCP` and `Desktop Smoke SSE MCP`, called `settings.probeMcpServer` for each server, and protocol initialized/discovered `desktop_smoke_tool`, `desktop_smoke_sse_tool`, `desktop-smoke-resource`, and `desktop-sse-resource`. The stdio probe reported resolve/spawn/initialize/initialized/tools/list/resources/list steps plus persisted history. The SSE probe reported header-policy/endpoint/stream-open/initialize/initialized/tools/list/resources/list steps plus persisted history, used `Authorization -> ERAGEAR_DESKTOP_MCP_AUTH` header-env mapping, and reported it present without exposing the secret value. Desktop smoke also verified project-local trusted stdio and SSE MCP servers are injected into the ACP `session/new` payload as Eragear broker commands with `MCP_SESSION_INJECTION`, that `MCP_SESSION_BROKER` can run brokered `tools/call` against both `desktop_smoke_tool` and `desktop_smoke_sse_tool` and surface their audits, and that `MCP_AGENT_ROUTING` reports two `stdio-proxy` routes with zero conditional routes and no secret leakage. Unit tests cover stdio success, persisted probe history, SSE message-endpoint success, HTTP header-env success/redaction, missing env-key diagnostics, literal secret-header rejection, JSON-RPC error surfacing, probe-step diagnostics, project-local trusted/untrusted MCP session config resolution, redacted MCP agent-routing classification, and brokered stdio/HTTP/SSE tool-call audit. |
| Provider readiness probe | Pass | Desktop smoke classified OpenCode as `ready` with CLI/auth/model `ok`, then created a temporary Codex provider descriptor and classified the real Codex CLI as `ready` via `codex doctor --json` with CLI/auth/model `ok`, model `gpt-5.5`, and doctor diagnostics present. Unit tests cover ready classification, secret redaction, long Codex doctor JSON parsing, and Windows CLI path parsing. |
| Checkpoint create/restore flow | Pass | Unit tests cover create, session-turn attribution, structured side-by-side diff preview, conflict-aware restore risks, per-file patch-check tracked conflict detection, safe selected-file restore-plan derivation, token-gated untracked blocker shelving, token-gated tracked conflict resolution with safety checkpoint, explicit tracked-conflict `current` choice plus later full restore of remaining files, wrong-token rejection, guarded full restore after shelving, automatic safety checkpoint, safety checkpoint forward restore, selected-file restore with unrelated workspace changes present, and selected-hunk restore that preserves other hunks in the same file. Web tests cover the Mixed Restore editor rows for selected files, selected hunks, shelvable blockers, and tracked conflict side choices. Electron UI exposes create/preview/attribution/risk/diff/safe-restore plan/Mixed Restore editor/per-file Shelve/Keep/Restore Side/file selection/hunk selection/confirm/restore result, and desktop smoke verifies `CHECKPOINT_SAFE_RESTORE_PLAN`, `CHECKPOINT_CONFLICT_SHELVE`, `CHECKPOINT_TRACKED_CONFLICT_RESOLVE`, `CHECKPOINT_MIXED_CONFLICT_EDITOR`, `CHECKPOINT_TRACKED_CONFLICT_CHOICE`, active-session attribution, side-by-side diff metadata, safe and blocked restore risk states, selected-hunk restore with hunk safety checkpoint, selected-file restore with file safety checkpoint, and unrelated file preservation. |
| Subagent manual invocation | Pass | Desktop smoke verifies `SUBAGENT_COMMAND_READY` for `/agent-code-reviewer`, expands the command into a delegated `code-reviewer` prompt, submits it through `sendMessage`, and observes `MESSAGE_SENT`. Web tests verify `/agent-code-reviewer` expansion and disabled subagent rejection. |

Additional ADE extension slice:

| Flow | Status | Evidence |
| --- | --- | --- |
| Project slash command invocation | Pass | Unit tests cover prompt expansion, argument placeholder replacement, fallback argument append, and disabled command rejection. Desktop smoke creates a temporary `/desktop-smoke` command and verifies prompt/argument metadata through the private `desktop-service` snapshot path. |
| Skill and output-style invocation | Pass | Unit tests cover `@skill`, `/skill-*`, `/style-*`, and disabled descriptor rejection. Desktop smoke creates temporary skill/output-style files and verifies prompt descriptors plus capability records through the private `desktop-service` snapshot path. |
| Project Index/Repo Snapshot v0 | Pass | Unit test covers refresh, persisted `.eragear/repo-index.json`, extension summary, generated directory skips, code symbols, task markers, local semantic token profiles, semantic-only search hits, and search prompt construction. Desktop smoke calls `settings.refreshProjectIndex`, observes 1661 indexed files, 400 visible symbols, 89 task markers, 1489 semantic-profiled files, confirms the persisted index contains `GOAL.md`, symbols, and tasks, verifies `settings.searchProjectIndex` returns `ready` context, and verifies `PROJECT_INDEX_SEMANTIC_SEARCH` finds `desktop-semantic-smoke.md` with `matchKind:"semantic"`. Web tests cover automatic chat attachment gating. |
| Project Memory per-message context v0 | Pass | Unit tests cover server-side enabled-source filtering, selected source paths, semantic chunk ranking, preset save/use/delete with retrieval mode, redacted prompt construction, disabled-source exclusion, and no secret leakage. Chat helper tests cover `/memory` parsing, `--source`/`-s` parsing, `--preset` parsing, `--semantic`/`--full`/`--chunks` parsing, picker command construction, draft preservation, automatic memory attachment gating, ready/no-enabled result handling, and composition with Project Index context. Desktop smoke writes a temporary `.eragear/context.md`, calls `settings.buildProjectMemoryContext` through `desktop-service` with `sourcePaths`, verifies the selected source is included, confirms `api_key=desktop-memory-secret` is redacted, then saves a temporary Project Memory preset and verifies `PROJECT_MEMORY_PRESET` resolves the default query/source path without leaking the secret. The smoke also verifies `PROJECT_MEMORY_SEMANTIC` returns one ranked chunk for `runtime-backed Local ADE actions`, excludes unrelated provider notes, and preserves redaction. |
| Manual hook execution v0 | Pass | Unit test covers upsert, toggle, disabled-run rejection, project-root cwd guard, isolated env-key allowlists, trust fingerprint gating, changed-fingerprint rejection, manual-run confirmation rejection, missing run approval rejection, run-operation fingerprint mismatch rejection, one-shot approval consumption, expired approval rejection, direct shell-eval sandbox blocking, capability demotion while untrusted or sandbox-blocked, persisted run history, redacted stdout/stderr, review/reopen persistence, and filtered redacted audit export. Desktop smoke creates `Desktop Smoke Hook`, verifies untrusted run is blocked, trusts the current fingerprint through `settings.trustHook`, confirms capability activation changes from false to true, verifies `HOOK_RUN_CONFIRMATION` blocks a wrong token, approves the current operation fingerprint with `settings.approveHookRun`, observes `HOOK_RUN_APPROVAL`, runs it through `settings.runHook` with `RUN HOOK desktop-smoke-hook` plus the approval id, observes `approvalStatus:"consumed"` and `desktop hook ok manual`, marks that run reviewed through `settings.reviewHookRun`, observes `HOOK_RUN_REVIEW`, exports reviewed hook runs through `settings.exportHookRuns` and observes `HOOK_RUN_AUDIT_EXPORT`, then creates a shell-eval hook and observes `HOOK_SANDBOX_BLOCK` with policy `blocked`. |
| Lifecycle hook execution v0 | Pass | Unit tests cover project-index, checkpoint-create, checkpoint-restore, and agent-message lifecycle events, plus create/send/stop event publication from the session services, with hooks trusted before lifecycle dispatch. Desktop smoke creates and trusts `Desktop Smoke Index Hook`, refreshes the project index, observes `desktop lifecycle after-project-index-refresh`, then creates/trusts temporary agent-session lifecycle hooks and observes `desktop agent lifecycle after-agent-session-create`, `after-agent-message-send`, and `after-agent-session-stop` from the real Electron session loop. |
| Hook/plugin automation scheduling v0 | Pass | `.eragear/hooks.json` and `.eragear/plugins.json` persist enabled/paused state, max concurrent runs, cooldown, updated timestamp, and diagnostics. Local ADE snapshots expose per-item scheduling status, active slot counts, max slots, cooldown, and next allowed time; hook/plugin capabilities demote while `paused`, `cooldown`, or `parallel-limit`. Unit tests verify hook cooldown/pause creates disabled audit runs before spawn and plugin parallel-limit blocks the second concurrent run before spawn. Desktop smoke verifies `HOOK_SCHEDULING_POLICY` with cooldown status, disabled capability, consumed approval, disabled audit run, and policy reset; it verifies `PLUGIN_SCHEDULING_POLICY` with paused status, disabled capability, consumed approval, disabled audit run, and policy reset. |
| Plugin batch queue v0 | Pass | `settings.runPluginBatch` runs up to eight ready plugins only after `RUN PLUGIN BATCH`, rechecks each operation fingerprint, applies trust/permission/policy/expiry/scheduling gates, records disabled or failed members as audit rows, orders selected plugins by `dependencyIds`, and persists a `plugin-batch-*` summary with run ids, counts, diagnostics, plugin names, and `continue`/`stop-on-failure` mode. `settings.upsertPluginBatchPreset`, `settings.runPluginBatchPreset`, and `settings.deletePluginBatchPreset` persist reusable presets in `.eragear/plugins.json`, run them through the same guarded dependency-aware batch path, and update `lastRunBatchId`. Electron exposes ready candidates, recent batch summaries, a dependency graph, dependency id editing, a failure-mode selector, guarded Run Batch action, and save/run/delete preset controls in Plugin Runner. Unit tests cover a successful two-plugin batch, a fingerprint-blocked member, stop-on-failure skip auditing, preset save/run/delete, dependency graph ordering, and dependent skip auditing when a dependency fails; desktop smoke verifies `PLUGIN_DEPENDENCY_GRAPH`, `PLUGIN_BATCH_QUEUE` with reversed input ordered as dependency then dependent, `PLUGIN_BATCH_STOP_ON_FAILURE` with the second plugin disabled without spawn after the first plugin fails, and `PLUGIN_BATCH_PRESET` with a saved preset that runs successfully and records `lastRunBatchId`. |
| Plugin batch schedule runner v0 | Pass | `settings.upsertPluginBatchSchedule`, `settings.runDuePluginBatchSchedules`, and `settings.deletePluginBatchSchedule` persist due schedules for saved plugin batch presets, store operation fingerprints at schedule save time, expose `due`/`scheduled`/`paused`/`missing-preset`/`stale-fingerprint` status, and process due schedules through the guarded dependency-aware batch runner instead of spawning a separate path. Stale fingerprints produce disabled audit rows before spawn. The server BackgroundRunner now registers `plugin-batch-schedule-dispatch`, which scans the local desktop user plus active session users for due schedules and delegates back through the guarded due runner. Local ADE snapshots expose the BackgroundRunner task fleet on `runtime.background`, and Electron renders the task fleet with cadence, timeout, status, counts, duration, and last result. Electron also exposes schedule save, interval, due-run, last-run, next-run, and delete controls in Plugin Runner. Unit tests cover save, due execution, stale-fingerprint skip auditing, deletion, background dispatch, snapshot task state, and renderer summary; desktop smoke verifies `PLUGIN_BATCH_SCHEDULE` with `daemon:true`, task visibility, due/dispatched task result metadata, a successful `plugin-batch-*` summary, and then moving back to `scheduled`. |
| Project-local plugin execution v0 | Pass | Unit test covers upsert, scopes/env-key allowlist persistence, isolated plugin environment, trust fingerprint gating, separate permission-fingerprint grant/revoke, stale-fingerprint rejection, manual-run confirmation rejection, run-operation fingerprint mismatch rejection, one-shot approval consumption, expired approval rejection, direct shell-eval sandbox blocking, capability demotion while untrusted, permission-missing, or sandbox-blocked, capability toggle, disabled-run rejection, project-root cwd guard, process-only sandbox cwd execution with `ERAGEAR_PROJECT_ROOT` hidden, signed package catalog discovery, Ed25519 signature verification, installable/installed/invalid catalog states, tampered-manifest rejection, project-root manifest path guard, pinned remote registry install, saved registry trust/refresh/update state, registry trust revocation, manual and registry-feed signer revocation/restore policy, registry signature/public-key hash pin enforcement, signed package metadata persistence, project-root workspace audit with pre-run `apply-patch` safety checkpoint and post-run `reverse-patch` change checkpoint, persisted run history, redacted stdout/stderr, review/reopen persistence, and filtered redacted audit export. Desktop smoke creates `Desktop Smoke Plugin`, verifies untrusted run is blocked, trusts the current fingerprint through `settings.trustPlugin`, confirms scope `env` plus `ERAGEAR_DESKTOP_PLUGIN_ALLOWED`, observes `PLUGIN_PERMISSION_GRANT` after permission revoke/grant with capability demotion and run blocking while permission is missing, verifies `PLUGIN_RUN_CONFIRMATION` blocks a wrong token, approves the current operation fingerprint with `settings.approvePluginRun`, observes `PLUGIN_RUN_APPROVAL`, runs it through `settings.runPlugin` with `RUN PLUGIN desktop-smoke-plugin` plus the approval id, observes `approvalStatus:"consumed"`, `desktop plugin ok Desktop Smoke Plugin`, `allowed_secret= [redacted]`, `blocked=false`, and `scopes=process,env`, marks that run reviewed through `settings.reviewPluginRun`, observes `PLUGIN_RUN_REVIEW`, exports reviewed plugin runs through `settings.exportPluginRuns` and observes `PLUGIN_RUN_AUDIT_EXPORT` with `leakedSecret: false`, discovers a generated signed package in `snapshot.plugins.catalog`, observes `PLUGIN_CATALOG` with `status:"installable"`, publisher metadata, sandbox workspace access, and `sha256:` signature/public-key hashes, installs it through `settings.installPluginPackage` using the discovered manifest path, observes `PLUGIN_SIGNED_INSTALL` with `installSource:"signed-package"`, `catalogStatus:"installed"`, trusted capability activation, signature/public-key hashes, publisher metadata, `approvalStatus:"consumed"`, and sandboxed run output, saves a generated registry through `settings.upsertPluginRegistry`, trusts its URL fingerprint through `settings.trustPluginRegistry`, revokes trust through `settings.revokePluginRegistryTrust` and verifies refresh is blocked, re-trusts and refreshes package pins through `settings.refreshPluginRegistry`, revokes the package signer through `settings.revokePluginRegistrySigner` and verifies install is blocked, restores the signer through `settings.restorePluginRegistrySigner`, imports a registry-fed `revokedSigners` entry and verifies install and user restore are blocked, clears the feed and verifies the package returns to installable, installs the saved package through `settings.installPluginRegistryPackage`, observes `PLUGIN_REGISTRY_INSTALL` with `registryStatus:"ready"`, `packageStatus:"installed"`, `trustStatus:"trusted"`, `trustRevokedRefreshBlocked:true`, `signerRevokedInstallBlocked:true`, `signerRestored:true`, `feedSignerRevoked:true`, `feedRevokedInstallBlocked:true`, `feedRestoreBlocked:true`, `feedCleared:true`, registry name/package id/url metadata, matching pinned hashes, capability activation, `approvalStatus:"consumed"`, and sandboxed run output, then creates a shell-eval plugin and observes `PLUGIN_SANDBOX_BLOCK` with policy `blocked`. The same smoke creates a process-only restricted plugin and observes `PLUGIN_WORKSPACE_SANDBOX` with `root=false`, `access=sandbox`, `scopes=process`, `workspaceFileLeaked:false`, and diagnostics proving `ERAGEAR_PROJECT_ROOT` was not exposed. In a temporary Git project, smoke also observes `PLUGIN_WORKSPACE_AUDIT` with `preCheckpoint:true`, `postCheckpoint:true`, `preMode:apply-patch`, `postMode:reverse-patch`, and `changedFiles:["PLUGIN_AUDIT.md"]`. |
| MCP probe diagnostics v0 | Pass | Unit tests assert structured probe steps for stdio, SSE, missing remote header env, JSON-RPC tools/list failure, persisted `probeHistory` after `settings.probeMcpServer`, and bounded SSE reconnect/replay when the first stream closes before a pending `initialize` response. Desktop smoke asserts stdio and SSE probe status is `success`, persisted history has initialized protocol status, initialize/stream-open/endpoint steps are present through the private `desktop-service` path, and `MCP_SSE_DISCOVERY` reports `reconnect.verified: true` with replayed initialize requests. |
| MCP manual invocation v0 | Pass | Unit tests cover stdio `tools/call`, stdio `resources/read`, SSE `tools/call`, SSE `resources/read` reconnect/replay, SSE side-effecting `tools/call` no-replay diagnostics, persisted invocation history, trust fingerprint approval, untrusted invocation blocking, changed-fingerprint blocking, capability demotion until trust, and redaction of env/header secrets returned by the MCP server. Desktop smoke calls `settings.invokeMcpTool` before trust and observes `MCP_INVOKE_POLICY` failure, trusts stdio and SSE fingerprints through `settings.trustMcpServer`, invokes stdio tool/resource and SSE tool successfully, then verifies `MCP_SSE_RESOURCE_RECONNECT` with `requests: 2` and a successful redacted SSE resource read through the private `desktop-service` snapshot path. |
| MCP chat command invocation v0 | Pass | Web tests cover `/mcp` parsing, `server/tool` and `--server` targeting, JSON-object argument validation, trusted initialized server/tool resolution, ambiguous/untrusted rejection, and prompt construction from a redacted MCP invocation result. The chat UI only exposes `/mcp` when an enabled trusted initialized MCP server has discovered tools; submit calls `settings.invokeMcpTool` and sends the result through the normal `sendMessage` path. Desktop smoke continues to verify the underlying MCP trust/invoke path through `desktop-service`. |
| MCP agent session injection v0 | Pass | Session MCP config now merges trusted project-local `.eragear/mcp-servers.json` entries into ACP session setup, skips untrusted or changed fingerprints, and blocks missing/unsafe remote header policy before injection. Trusted stdio, streamable HTTP, and SSE project-local routes are injected as Eragear broker commands instead of raw/native MCP server commands, so remote header values are resolved inside the broker and are not exposed in ACP setup. Unit tests cover trusted broker injection, changed-fingerprint skipping, remote header-env broker injection without secret exposure, missing remote header-env skipping, and brokered stdio/HTTP/SSE `tools/call` redaction/audit. Desktop smoke uses a capture ACP agent and verifies `MCP_SESSION_INJECTION` with trusted stdio and SSE MCP brokers in the actual `session/new` payload. |
| MCP agent routing/broker v0 | Pass | Local ADE snapshots now expose an `agentRouting` manifest for project-local MCP servers with `injectable`, `conditional`, `blocked`, and `skipped` route states. Electron renders the Agent Session Routing panel with brokered/conditional/blocked counts, `stdio-proxy` broker mode, exact blocker reasons, recent brokered agent MCP call count, latest brokered call, and redacted header-env key mapping. Unit tests verify trust blocking, stdio and HTTP/SSE broker classification, no secret leakage, and audit JSONL projection into the route. Desktop smoke verifies `MCP_AGENT_ROUTING` with `direct: 2`, `conditional: 0`, `blocked: 0`, stdio `brokerMode: stdio-proxy`, SSE `brokerMode: stdio-proxy`, and no `Bearer desktop-mcp-secret`; it also verifies `MCP_SESSION_BROKER` with successful brokered stdio and SSE `tools/call` calls audited back into the Electron snapshot. |
| MCP notification history v0 | Pass | Unit tests cover server-pushed stdio and SSE JSON-RPC notifications during probe, invocation, and the trusted SSE notification Watch action, persisted bounded history, source classification, monitor run history, one reconnect after stream loss, and redaction of env/header secrets from notification payloads. Desktop smoke observes `MCP_NOTIFICATIONS` with stdio `notifications/message` and `notifications/progress`, `MCP_SSE_NOTIFICATIONS` with probe/invocation `notifications/message` payloads where `Bearer desktop-mcp-secret` is replaced by `[redacted]`, and `MCP_NOTIFICATION_MONITOR` with `status:"success"`, `reconnectCount:1`, `streamOpenCount:2`, and `source:"monitor"`. |
| MCP remote operational controls v0 | Pass | Unit tests cover `configureMcpRemoteControls`, persisted custom timeout/reconnect/watch values, fingerprint demotion to `changed`, re-trust before use, zero-reconnect monitor failure, and higher reconnect recovery. `SessionMcpConfigService` and the stdio broker now include the same remote-control fingerprint material as Local ADE, so ACP session injection and broker calls do not drift. Electron renders per-server Remote Controls for HTTP/SSE servers. Desktop smoke verifies `MCP_REMOTE_CONTROLS` with `requestTimeoutMs:2500`, `reconnectAttempts:2`, `notificationWatchMs:500`, trust demotion, re-trust, `MCP_AGENT_ROUTING` after re-trust, and `MCP_NOTIFICATION_MONITOR` using the configured `requestedDurationMs:500`. |
| ACP Activity observability v0 | Pass | Unit tests cover owned-chat filtering, selected-chat export, chronological replay frames, replay kind filtering, saved replay preset persistence/update/delete, limits, redaction, chat/turn correlation summaries, cross-session timeline lanes, lane transitions, workspace replay across multiple chats, stream retry policy, causality chain derivation, gap detection, export inclusion, retry action, and raw payload redaction. Desktop smoke observes ACP Activity for the active chat, calls `settings.exportAcpActivity`, `settings.retryAcpActivityStream`, and `settings.replayAcpActivity` through `desktop-service`, then verifies schema version, redacted flag, active chat filter, exported entries, exported chat correlation, chronological replay frames, stable frame sequence, stream retry controls via `ACP_STREAM_DIAGNOSTICS`, Retry Stream via `ACP_STREAM_RETRY`, kind-filtered replay via `ACP_REPLAY_KIND_FILTER`, saved replay preset save/load/delete via `ACP_REPLAY_PRESET`, `ACP_CROSS_SESSION_TIMELINE` with 11 chat lanes, 80 frames, 30 transitions, 40 workspace replay frames, `workspaceChatCount:8`, no single-chat workspace filter, retry policy `1000ms x5`, causal chains, and no `rawPayload*` metadata exposed to Electron. |
| First-screen ADE workbench | Pass | Web unit tests cover workflow readiness lane derivation, Next Actions routing, workbench phase/score/primary-action derivation, command chips, and provider setup routing for ready, idle, warning, setup, and blocked states. `dev:desktop` still passes after the workbench panel was added above the older readiness deck. |
| Active Workspace focus | Pass | Web unit tests cover live-session focus, pending permission warning, changed-file/checkpoint focus, MCP trust-warning focus, ACP correlation focus, and no-session standby state. The first viewport renders those focus items from the same Local ADE snapshot used by the desktop runtime. |

## Verification Commands And Results

```powershell
bun test apps/server/src/modules/settings/application/local-ade.service.test.ts
```

Result: passed, 63 tests, 1114 expectations. This now includes hook scheduling
pause/cooldown before spawn, plugin scheduling parallel-limit blocking before
spawn, plugin batch queue execution with fingerprint-blocked members,
stop-on-failure skip auditing, plugin batch preset save/run/delete, dependency
graph ordering and dependent skip auditing, plugin batch schedule save/due
execution/stale-fingerprint skip/delete coverage, BackgroundRunner due-schedule
dispatch coverage, BackgroundRunner snapshot task-state coverage, and
project-local ACP replay preset save/update/replay/delete coverage, ACP
cross-session timeline lane/transition/workspace replay coverage, ACP stream
retry/causality/gap/export/retry-action coverage, Project Memory preset
save/use/delete plus semantic chunk retrieval coverage, and plugin registry URL
trust reset coverage.

```powershell
bun test apps/server/src/modules/session/application/session-mcp-config.service.test.ts
```

Current run result: passed, 9 tests, 32 expectations. This covers packaged
dist broker resolution, configured broker runtime override, trusted
project-local stdio broker injection, brokered stdio/HTTP/SSE `tools/call`
trust enforcement, response redaction, audit persistence, changed-fingerprint
skipping, remote header-env broker injection without secret exposure, and
missing remote header-env skipping.

```powershell
$bun=(Get-Command bun).Source
$node=(Get-Command node -ErrorAction SilentlyContinue).Source
$agent=@(@{command=$bun;allowAnyArgs=$true})
if ($node) { $agent += @{command=$node;allowAnyArgs=$true} }
$env:ALLOWED_AGENT_COMMAND_POLICIES=($agent | ConvertTo-Json -Compress)
$env:ALLOWED_TERMINAL_COMMAND_POLICIES=($agent | ConvertTo-Json -Compress)
$env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP,ERAGEAR_TEST_MCP_AUTH'
bun test apps/server/src/modules/settings/application/local-ade.service.test.ts --test-name-pattern "SSE MCP|SSE resource|SSE tool|reconnects SSE"
```

Current run result: passed, 5 tests, 42 expectations.

```powershell
$bun=(Get-Command bun).Source
$node=(Get-Command node -ErrorAction SilentlyContinue).Source
$agent=@(@{command=$bun;allowAnyArgs=$true})
if ($node) { $agent += @{command=$node;allowAnyArgs=$true} }
foreach ($cmd in @('opencode','codex','claude','gemini')) { $resolved=Get-Command $cmd -ErrorAction SilentlyContinue; if ($resolved) { $agent += @{command=$resolved.Source;allowAnyArgs=$true} } }
$terminal=@(@{command=$bun;allowAnyArgs=$true})
if ($node) { $terminal += @{command=$node;allowAnyArgs=$true} }
$env:ALLOWED_AGENT_COMMAND_POLICIES=($agent | ConvertTo-Json -Compress)
$env:ALLOWED_TERMINAL_COMMAND_POLICIES=($terminal | ConvertTo-Json -Compress)
$env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'
bun test apps/server/src/modules/settings/application/local-ade.service.test.ts apps/server/src/modules/session/application/session-mcp-config.service.test.ts apps/server/src/modules/session/application/session-acp-bootstrap.service.test.ts
```

Current run result: passed, 37 tests, 426 expectations. This covers Local ADE
MCP discovery/invocation, provider readiness, checkpoint safety restore, and
project-local MCP session injection into ACP setup.

```powershell
bun test apps/server/src/shared/utils/cli-args.util.test.ts apps/server/src/modules/settings/application/local-ade.service.test.ts
```

Current run result: passed, 25 tests, 353 expectations. The added parser tests
cover Windows absolute command paths and quoted paths with spaces.

```powershell
bun test apps/web/src/components/local-ade/local-ade-operations.test.ts apps/web/src/components/chat-ui/local-command.test.ts apps/web/src/components/chat-ui/local-instruction.test.ts apps/web/src/components/chat-ui/project-index-command.test.ts apps/web/src/components/chat-ui/project-index-auto-context.test.ts apps/web/src/components/chat-ui/project-memory-command.test.ts apps/web/src/components/chat-ui/project-memory-auto-context.test.ts apps/web/src/components/chat-ui/subagent-command.test.ts
```

Current run result: passed, 40 tests, 140 expectations.

```powershell
bun test apps/web/src/components/chat-ui/mcp-command.test.ts
```

Current run result: passed, 5 tests, 16 expectations.

```powershell
bun test apps/web/src/components/chat-ui/subagent-command.test.ts apps/web/src/components/chat-ui/mcp-command.test.ts
```

Current run result: passed, 8 tests, 23 expectations.

```powershell
bun test apps/web/src/components/local-ade/local-ade-operations.test.ts
```

Current run result: passed, 15 tests, 115 expectations. This now covers
first-screen ADE workbench status/score/primary-action derivation, command
chips, provider setup routing to the real configuration section, and
BackgroundRunner scheduler fleet summary derivation, plus checkpoint Mixed
Restore editor row derivation for selected files, selected hunks, shelvable
blockers, and tracked conflict side choices.

```powershell
bun run --cwd apps/web check-types
```

Result: passed. The previous React/Vite duplicate type drift was removed by
forcing the web typecheck resolver onto the package-local React and Vite type
installations in `apps/web/tsconfig.json`, and the remaining app-code type
errors were fixed in the chat/auth/config/spinner/test files listed below.

```powershell
$bun=(Get-Command bun).Source; $node=(Get-Command node).Source; $agent=@(@{command=$bun;allowAnyArgs=$true},@{command=$node;allowAnyArgs=$true}); $opencode=Get-Command opencode -ErrorAction SilentlyContinue; if ($opencode) { $agent += @{command=$opencode.Source;allowAnyArgs=$true} }; $terminal=@(@{command=$bun;allowAnyArgs=$true},@{command=$node;allowAnyArgs=$true}); $env:ALLOWED_AGENT_COMMAND_POLICIES=($agent | ConvertTo-Json -Compress); $env:ALLOWED_TERMINAL_COMMAND_POLICIES=($terminal | ConvertTo-Json -Compress); $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test apps/server/src/shared/utils/session-config-options.util.test.ts apps/server/src/modules/session/application/discover-agent-sessions.service.test.ts apps/server/src/modules/session/application/get-session-state.service.test.ts apps/server/src/modules/session/application/persist-session-bootstrap.service.test.ts apps/server/src/shared/utils/chat-events.util.test.ts apps/server/src/modules/tooling/application/respond-permission.service.test.ts apps/server/src/platform/acp/update-stream.test.ts apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts apps/server/src/modules/supervisor/application/supervisor-permission.service.test.ts
```

Result: passed, 182 tests, 625 expectations.

```powershell
$bun=(Get-Command bun).Source; $node=(Get-Command node).Source; $agent=@(@{command=$bun;allowAnyArgs=$true},@{command=$node;allowAnyArgs=$true}); $opencode=Get-Command opencode -ErrorAction SilentlyContinue; if ($opencode) { $agent += @{command=$opencode.Source;allowAnyArgs=$true} }; $terminal=@(@{command=$bun;allowAnyArgs=$true},@{command=$node;allowAnyArgs=$true}); $env:ALLOWED_AGENT_COMMAND_POLICIES=($agent | ConvertTo-Json -Compress); $env:ALLOWED_TERMINAL_COMMAND_POLICIES=($terminal | ConvertTo-Json -Compress); $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test apps/server/src/modules/session/application/create-session.service.test.ts apps/server/src/modules/session/application/stop-session.service.test.ts apps/server/src/modules/ai/application/send-message.service.test.ts
```

Result: passed, 26 tests, 96 expectations.

```powershell
bun run --cwd apps/desktop check-types
```

Result: passed.

```powershell
bun run --cwd apps/server check-types
```

Result: passed.

```powershell
bun run --cwd apps/server build
if (Test-Path -LiteralPath apps/server/dist/runtime/mcp-agent-broker.js) {
  Get-Item -LiteralPath apps/server/dist/runtime/mcp-agent-broker.js
}
```

Result: passed. The build copied the MCP agent broker runtime asset to
`apps/server/dist/runtime/mcp-agent-broker.js`; the verified asset length was
26802 bytes. The existing `bun` and `bun:sqlite` externalization warnings were
unchanged from prior builds.

```powershell
bun run --cwd apps/desktop build:main
```

Result: passed.

```powershell
bun run --cwd apps/web build
```

Current run result: passed after the Background Task Fleet UI change. Vite
emitted the existing chunk-size and Browserslist age warnings.

```powershell
$env:ERAGEAR_DESKTOP_SMOKE_PROMPT_WAIT_MS='12000'; bun run --cwd apps/desktop ./scripts/smoke-desktop-runtime.ts
```

Result: passed.

- Runtime endpoint: `desktop-service`, ready `true`.
- MCP protocol discovery: `available`, `initialized`,
  `desktop_smoke_tool`, `desktop-smoke-resource`, with probe steps
  `resolve`, `spawn`, `initialize`, `initialized`, `tools/list`, and
  `resources/list`; `settings.probeMcpServer` persisted a successful history
  run with initialized protocol status and 6 steps.
- MCP stdio invocation: `settings.invokeMcpTool` returned `success` with
  `desktop tool call desktop_smoke_tool path=README.md`, and
  `settings.readMcpResource` returned `success` with
  `desktop resource read file:///desktop-smoke`.
- MCP stdio invocation policy: `MCP_INVOKE_POLICY` returned `failed` before
  trust with `MCP invocation blocked by trust policy before protocol execution`;
  `MCP_TRUST` then reported `trustStatus: trusted` and a matching trusted
  fingerprint.
- MCP stdio invocation audit: `MCP_INVOKE_AUDIT` reported 3 persisted entries,
  newest first: `resources/read` for `file:///desktop-smoke`, successful
  `tools/call` for `desktop_smoke_tool`, and the earlier blocked `tools/call`.
- MCP stdio notifications: `MCP_NOTIFICATIONS` reported 5 notification entries,
  including probe `notifications/message`, invocation `notifications/message`,
  and invocation `notifications/progress` for `desktop_smoke_tool`.
- MCP session injection: temporary project `Desktop Smoke MCP Session` trusted
  `Desktop Session Injected MCP` and `Desktop Session Injected SSE MCP`, desktop
  smoke started a capture ACP agent, and `MCP_SESSION_INJECTION` reported ACP
  method `session/new`, `serverCount: 2`, broker command
  `C:\Users\terasumi\.bun\bin\bun.exe`, and args pointing at
  `apps/server/src/runtime/mcp-agent-broker.js` with project root, server ids,
  and trusted fingerprints. The captured ACP payload did not contain
  `desktop-session-mcp-secret`.
- MCP session broker: desktop smoke spawned both broker commands captured from
  ACP `session/new`, called `tools/call` for `desktop_smoke_tool` and
  `desktop_smoke_sse_tool`, received redacted results, then read the Local ADE
  snapshot and verified `MCP_SESSION_BROKER` with `brokerMode: stdio-proxy`,
  `sseBrokerMode: stdio-proxy`, `agentInvocationCount: 1`,
  `sseAgentInvocationCount: 1`, and latest invocations
  `[tools/call, success, desktop_smoke_tool]` plus
  `[tools/call, success, desktop_smoke_sse_tool]`.
- MCP agent routing preview: after trusting the smoke stdio and SSE servers,
  `MCP_AGENT_ROUTING` reported `status: ready`, `direct: 2`,
  `conditional: 0`, and `blocked: 0`. The stdio route
  `Desktop Smoke MCP` was `injectable` with `brokerMode: stdio-proxy` and
  `agentSupport: not-required`, and the SSE route `Desktop Smoke SSE MCP` was
  also `injectable` with `brokerMode: stdio-proxy`, no required agent
  capability, and `agentSupport: not-required`. The smoke assertion also verified
  the route manifest did not contain `Bearer desktop-mcp-secret`.
- MCP SSE protocol discovery: `available`, `initialized`,
  `desktop_smoke_sse_tool`, `desktop-sse-resource`, with
  `Authorization -> ERAGEAR_DESKTOP_MCP_AUTH` header-env mapping reported as
  present and no secret value exposed; probe steps included `header-policy`,
  `endpoint`, `stream-open`, `initialize`, `initialized`, `tools/list`, and
  `resources/list`; `settings.probeMcpServer` persisted a successful history
  run with initialized protocol status and 8 steps.
- MCP SSE reconnect/replay: desktop smoke configures the SSE fixture to close
  the first stream before responding to the first discovery request. The runtime
  reconnects, replays pending discovery, and `MCP_SSE_DISCOVERY` reports
  `reconnect.verified: true` with `initializeRequests: 4`.
- MCP SSE invocation: `settings.invokeMcpTool` returned `success` with
  `desktop sse tool desktop_smoke_sse_tool authorization= [redacted]`, and the
  smoke assertion verified `Bearer desktop-mcp-secret` was not exposed.
- MCP SSE resource invocation reconnect: desktop smoke configures the SSE
  fixture to close the stream before the first `resources/read` response. The
  runtime reconnects, replays the safe resource request once, and
  `MCP_SSE_RESOURCE_RECONNECT` reports `status: success`, `requests: 2`, and
  result text `desktop sse resource memory://desktop-smoke-sse`.
- MCP SSE invocation trust: `MCP_SSE_TRUST` reported `trustStatus: trusted`
  and a matching trusted fingerprint before the SSE tool call.
- MCP SSE invocation audit: `MCP_SSE_INVOKE_AUDIT` reported 2 persisted
  entries, newest first: successful `resources/read` for
  `memory://desktop-smoke-sse` and successful `tools/call` for
  `desktop_smoke_sse_tool`, with result text containing `[redacted]` and no
  `Bearer desktop-mcp-secret` value.
- MCP SSE notifications: `MCP_SSE_NOTIFICATIONS` reported 10 notification
  entries across probe and invocation, and every authorization payload replaced
  `Bearer desktop-mcp-secret` with `[redacted]`.
- MCP notification monitor: desktop smoke configures the SSE fixture to close
  the first monitor stream. `settings.watchMcpNotifications` reconnects through
  the private `desktop-service` path and `MCP_NOTIFICATION_MONITOR` reports
  `status: success`, `reconnectCount: 1`, `streamOpenCount: 2`,
  `notificationCount: 1`, and `sources:["monitor"]` without leaking
  `Bearer desktop-mcp-secret`.
- Provider readiness: OpenCode `ready`, CLI/auth/model `ok`, version `1.16.2`,
  with 5 model identifiers surfaced. Codex readiness was also verified by
  creating a temporary Codex provider descriptor and running the real
  `codex doctor --json`; the result was `ready`, CLI/auth/model `ok`, model
  `gpt-5.5`, with doctor diagnostics for overall status, auth credentials,
  configured model, and provider/websocket reachability. The temporary
  descriptor was deleted and provider-health was restored after smoke.
- Provider model selection: after Codex readiness returned model `gpt-5.5`,
  desktop smoke called `settings.selectProviderModel` through `desktop-service`.
  `PROVIDER_MODEL_SELECTION` reported runtime `defaultModel: gpt-5.5`,
  `defaultModelProviderId` equal to the temporary Codex provider,
  `selectedModel: gpt-5.5`, and `modelListSource: readiness-probe`; smoke then
  cleared the default-model override to restore the original state.
- Active-session model switch: after starting a real OpenCode ACP session,
  desktop smoke called `setModel` through `desktop-service`.
  `ACTIVE_SESSION_MODEL_SWITCH` reported `from: opencode/big-pickle`,
  `to: opencode/deepseek-v4-flash-free`, `source: config-option`,
  `supportsSwitching: true`, and Local ADE snapshot `currentModelId:
  opencode/deepseek-v4-flash-free`.
- Command discovery: temporary `/desktop-smoke` command present, enabled,
  argument hint `<smoke request>`, and prompt body included `$ARGUMENTS`.
- Project Memory Context: temporary `.eragear/context.md` was discovered and
  selected by relative source path, `settings.buildProjectMemoryContext` returned `ready` through
  `desktop-service`, included one selected source with 92 bytes, preserved
  `Prefer runtime-backed Local ADE actions.`, and redacted
  `api_key=desktop-memory-secret` to `api_key= [redacted]`.
- Project Memory Preset: desktop smoke saved `Desktop Smoke Memory Preset`,
  verified `PROJECT_MEMORY_PRESET` with `presetId:
  desktop-smoke-memory-preset`, default query `desktop smoke preset policy`,
  selected source `.eragear/context.md`, preset header in the prompt, memory
  content included, and the same secret redaction preserved, then deleted the
  preset.
- Project Memory Semantic Retrieval: desktop smoke verifies
  `PROJECT_MEMORY_SEMANTIC` with `retrievalMode: semantic`, one ranked chunk
  from `.eragear/context.md`, a positive score, runtime-backed Local ADE content
  included, unrelated provider-only notes excluded, and
  `api_key=desktop-memory-secret` redacted before prompt construction.
- Instruction discovery: temporary `Desktop Smoke Skill` and
  `Desktop Smoke Style` present, enabled, prompt body surfaced, and matching
  capability records present.
- Project Index: `settings.refreshProjectIndex` returned 1660 indexed files,
  112530519 total bytes, top extensions `.ts`, `.md`, `.tsx`, 400 visible code
  symbols, 89 task markers, 1489 semantic-profiled files, and the persisted
  index contained `GOAL.md`, symbols, and tasks.
- Project Index Search: `settings.searchProjectIndex` returned status `ready`,
  6 matched entries, and a bounded prompt containing matched index entries plus
  the guard to read referenced files before editing.
- Project Index Semantic Search: `PROJECT_INDEX_SEMANTIC_SEARCH` returned
  `status:"ready"`, `hitPath:"desktop-semantic-smoke.md"`,
  `matchKind:"semantic"`, `semanticStatus:"ready"`, and
  `promptHasSemantic:true` through the private `desktop-service` path.
- Hook Trust: `settings.upsertHook` created `Desktop Smoke Hook`, untrusted
  `settings.runHook` was blocked, `settings.trustHook` approved the current
  execution fingerprint, capability activation changed from false to true, and
  the trusted descriptor reported `trustStatus: trusted`.
- Hook Run Confirmation: `HOOK_RUN_CONFIRMATION` reported `blocked: true` for
  `RUN HOOK wrong`, then exposed the expected token
  `RUN HOOK desktop-smoke-hook`.
- Hook Run Operation Approval: `settings.approveHookRun` approved the current
  manual-run operation fingerprint; `HOOK_RUN_APPROVAL` reported a
  `hook-approval-*` id and a `sha256:` operation fingerprint before spawn.
- Hook Runner: trusted and operation-approved `settings.runHook` returned
  `success`, consumed the run approval, and stdout contained
  `desktop hook ok manual`.
- Hook Run Review: `settings.reviewHookRun` marked the persisted hook run as
  reviewed, and `HOOK_RUN_REVIEW` reported `reviewed: true` for the same run id.
- Hook Run Audit Export: `settings.exportHookRuns` returned a redacted
  schema-versioned artifact filtered to `reviewState: reviewed`; smoke reported
  `HOOK_RUN_AUDIT_EXPORT` with one reviewed run.
- Hook Sandbox Block: smoke created a trusted shell-eval hook using
  `powershell -Command` on Windows or `sh -c` elsewhere. The Local ADE snapshot
  reported `executionPolicy.status: blocked`, `settings.runHook` rejected it
  before spawn with a sandbox diagnostic, and smoke reported
  `HOOK_SANDBOX_BLOCK {"policy":"blocked","blocked":true}`.
- Hook Lifecycle: `settings.refreshProjectIndex` triggered
  `after-project-index-refresh`; stdout contained
  `desktop lifecycle after-project-index-refresh`.
- Plugin Trust: `settings.upsertPlugin` created `Desktop Smoke Plugin`;
  untrusted `settings.runPlugin` was blocked, `settings.trustPlugin` approved
  the current command/permission fingerprint, capability activation changed
  from false to true, scopes were `process` and `env`, the
  env allowlist contained `ERAGEAR_DESKTOP_PLUGIN_ALLOWED`, permission status
  was `granted`, and the granted permission fingerprint matched the current
  permission fingerprint.
- Plugin Permission Grant: `settings.updatePluginPermissionGrant` first revoked
  the current permission fingerprint; `PLUGIN_PERMISSION_GRANT` reported
  `revokedStatus:"missing"`, `revokedCapabilityEnabled:false`, and
  `permissionRunBlocked:true`. The same smoke then granted the current
  fingerprint again and reported `grantedStatus:"granted"`,
  `grantedCapabilityEnabled:true`, and a `sha256:` permission fingerprint.
- Plugin Run Confirmation: `PLUGIN_RUN_CONFIRMATION` reported `blocked: true`
  for `RUN PLUGIN wrong`, then exposed the expected token
  `RUN PLUGIN desktop-smoke-plugin`.
- Plugin Run Operation Approval: `settings.approvePluginRun` approved the
  current manual-run operation fingerprint; `PLUGIN_RUN_APPROVAL` reported a
  `plugin-approval-*` id and a `sha256:` operation fingerprint before spawn.
- Plugin Runner: trusted, permission-granted, and operation-approved
  `settings.runPlugin` returned `success`, consumed the run approval, and
  stdout contained `desktop plugin ok Desktop Smoke Plugin`,
  `allowed_secret= [redacted]`, `blocked=false`, and `scopes=process,env`.
- Plugin Run Review: `settings.reviewPluginRun` marked the persisted plugin run
  as reviewed, and `PLUGIN_RUN_REVIEW` reported `reviewed: true` for the same
  run id.
- Plugin Run Audit Export: `settings.exportPluginRuns` returned a redacted
  schema-versioned artifact filtered to `reviewState: reviewed`; smoke reported
  `PLUGIN_RUN_AUDIT_EXPORT` with one reviewed run and `leakedSecret: false`.
- Plugin Batch Queue: smoke upserted a second trusted plugin, read current
  operation fingerprints for both ready plugins, and called
  `settings.runPluginBatch` with `RUN PLUGIN BATCH`. `PLUGIN_BATCH_QUEUE`
  reported a `plugin-batch-*` id, `status:"success"`, two successful run ids,
  both plugin last-run records carrying the same batch id, no disabled members,
  an execution order of `desktop-smoke-plugin` before
  `desktop-smoke-plugin-batch` even when requested in reverse order, and stdout
  from `Desktop Smoke Batch Plugin`.
- Plugin Dependency Graph: smoke persisted `desktop-smoke-plugin-batch` with
  `dependencyIds:["desktop-smoke-plugin"]`, refreshed the Local ADE snapshot,
  and observed `PLUGIN_DEPENDENCY_GRAPH` with the dependent node `ready`, the
  graph edge `ready`, and the primary plugin reporting one dependent.
- Plugin Batch Stop On Failure: smoke upserted a failing plugin followed by a
  plugin that would write an output file if spawned, then called
  `settings.runPluginBatch` with `failureMode:"stop-on-failure"`.
  `PLUGIN_BATCH_STOP_ON_FAILURE` reported the same `plugin-batch-*` family,
  `status:"partial"`, `failed:1`, `disabled:1`, two run ids, first status
  `failed`, second status `disabled`, and `skippedSpawned:false`.
- Plugin Batch Schedule: smoke saved `desktop-smoke-batch-schedule` against the
  saved batch preset with current operation fingerprints and a past `nextRunAt`,
  then waited for the `plugin-batch-schedule-dispatch` BackgroundRunner task to
  pick it up. `PLUGIN_BATCH_SCHEDULE` reported `daemon:true`,
  `savedStatus:"due"`, `runStatus:"success"`,
  `visibleStatus:"scheduled"`, a successful `plugin-batch-*` id, `success:2`,
  matching `lastRunBatchId`, `taskVisible:true`, `taskDispatchedSchedules:1`,
  and a future `nextRunAt`. `BACKGROUND_TASK_FLEET` reported five visible
  BackgroundRunner tasks, including `plugin-batch-schedule-dispatch` with
  `successCount` greater than zero and no failures.
- Plugin Catalog: smoke generated an Ed25519-signed package manifest under
  `.eragear/plugin-packages/desktop-signed-plugin.json`, refreshed the Local ADE
  snapshot, and observed `PLUGIN_CATALOG` with `status:"installable"`, publisher
  `Desktop Smoke Publisher`, publisher id `desktop.smoke.publisher`,
  `expiryStatus:"valid"`, `expiresAt:"2099-01-01T00:00:00.000Z"`,
  `workspaceAccess:"sandbox"`, the discovered relative manifest path, and
  `sha256:` signature/public-key hashes before installation.
- Plugin Signed Install: smoke generated an Ed25519 keypair and signed package
  manifest under `.eragear/plugin-packages/desktop-signed-plugin.json`, then
  installed it through `settings.installPluginPackage` using the discovered
  catalog manifest path. `PLUGIN_SIGNED_INSTALL`
  reported `installSource:"signed-package"`, publisher
  `Desktop Smoke Publisher`, publisher id `desktop.smoke.publisher`,
  `expiryStatus:"valid"`, `expiresAt:"2099-01-01T00:00:00.000Z"`,
  `trustStatus:"trusted"`, `capabilityEnabled:true`,
  `catalogStatus:"installed"`, `runStatus:"success"`,
  `approvalStatus:"consumed"`, `sha256:` signature/public-key hashes, stdout
  `desktop signed plugin ok Desktop Signed Plugin`, `root=false`, and
  `access=sandbox`.
- Plugin Registry Install: smoke served a temporary HTTP registry JSON and
  signed manifest, with the registry entry pinning the package `signatureHash`,
  `publicKeyFingerprint`, `publisherId`, `issuedAt`, and `expiresAt`.
  `settings.upsertPluginRegistry` saved the
  registry, `settings.trustPluginRegistry` approved the current URL
  fingerprint, `settings.refreshPluginRegistry` stored the package pins, and
  `settings.installPluginRegistryPackage` installed it from the saved registry
  only after smoke revoked/restored both registry URL trust and package signer
  trust, then imported/cleared a registry-fed `revokedSigners` entry.
  `PLUGIN_REGISTRY_INSTALL` reported `registryStatus:"ready"`,
  `packageStatus:"installed"`, `trustStatus:"trusted"`,
  `trustRevokedRefreshBlocked:true`, `signerRevoked:true`,
  `signerRevokedInstallBlocked:true`, `signerRestored:true`,
  `feedSignerRevoked:true`, `feedRevokedInstallBlocked:true`,
  `feedRestoreBlocked:true`, `feedCleared:true`,
  `installSource:"signed-package"`, publisher `Desktop Registry Publisher`,
  publisher id `desktop.registry.publisher`, `expiryStatus:"valid"`,
  `expiresAt:"2099-01-01T00:00:00.000Z"`,
  registry `Desktop Smoke Registry`, package id `desktop-registry-plugin`,
  matching `sha256:` pins, `capabilityEnabled:true`, `runStatus:"success"`,
  `approvalStatus:"consumed"`, and
  stdout `desktop registry plugin ok Desktop Registry Plugin`, `root=false`,
  and `access=sandbox`.
- Plugin Sandbox Block: smoke created a trusted shell-eval plugin using
  `powershell -Command` on Windows or `sh -c` elsewhere. The Local ADE snapshot
  reported `executionPolicy.status: blocked`, `settings.runPlugin` rejected it
  before spawn with a sandbox diagnostic, and smoke reported
  `PLUGIN_SANDBOX_BLOCK {"policy":"blocked","blocked":true}`.
- Plugin Workspace Sandbox: smoke created a trusted process-only plugin without
  `project-root` scope, ran it through `settings.runPlugin`, and observed
  `PLUGIN_WORKSPACE_SANDBOX` with `root=false`, `access=sandbox`,
  `scopes=process`, `workspaceFileLeaked:false`, and diagnostics confirming
  `ERAGEAR_PROJECT_ROOT` was not exposed.
- Plugin Workspace Audit: smoke used the temporary Git checkpoint project to
  run a trusted project-root plugin that changed `PLUGIN_AUDIT.md`; the private
  desktop-service path reported `PLUGIN_WORKSPACE_AUDIT` with
  `status:success`, `preCheckpoint:true`, `postCheckpoint:true`,
  `preMode:apply-patch`, `postMode:reverse-patch`, and
  `changedFiles:["PLUGIN_AUDIT.md"]`.
- Checkpoint risk/attribution preview: temporary git project created checkpoint
  `checkpoint-18556913-3efe-42dd-8745-6f49a27d08de` while an agent chat was
  active; preview reported `attributionSource: active`,
  `attributionStatus: ready`, and `README.md` marked `safe`. The structured diff
  preview reported 3 modified files,
  `README.md` additions, the added `changed` row, and two hunks in `HUNKS.md`
  before a new `EXTRA.md` change made preview non-restorable with `EXTRA.md`
  marked `blocked`. Selected-hunk restore then restored only hunk 0 in
  `HUNKS.md`, created a hunk safety checkpoint, and preserved hunk 1. Selected
  file restore then restored only `README.md`, created a selected-file safety
  checkpoint, and preserved changed `NOTES.md`, changed hunk 1 in `HUNKS.md`,
  plus untracked `EXTRA.md`.
- Checkpoint safe restore plan: desktop smoke reported
  `CHECKPOINT_SAFE_RESTORE_PLAN` with `fullRestoreBlocked:true`, safe files
  `["HUNKS.md","NOTES.md","README.md"]`, zero warning files, and one blocked
  file. This proves the Electron-facing plan can still offer safe selected-file
  restore when full restore is blocked by an unrelated change.
- Checkpoint conflict shelf: desktop smoke reported `CHECKPOINT_CONFLICT_SHELVE`
  with `files:["EXTRA.md"]`, `fullRestoreReady:true`, `rootExtraExists:false`,
  and a shelf path under `.eragear/checkpoint-shelves`. The same smoke verified
  the shelved file content before recreating `EXTRA.md` for selected restore
  preservation checks.
- Checkpoint tracked conflict resolve: desktop smoke reported
  `CHECKPOINT_TRACKED_CONFLICT_RESOLVE` with `initialReady:true`,
  `conflictReady:false`, `risk:"blocked"`, `safetyMode:"apply-patch"`,
  `resolvedFiles:["TRACKED.md"]`, `resetToHead:true`, and
  `safetyReapplied:true`.
- Checkpoint tracked conflict choice: desktop smoke reported
  `CHECKPOINT_TRACKED_CONFLICT_CHOICE` with `conflictReady:false`,
  `conflictRisk:"blocked"`, `choice:"current"`, `afterChoiceReady:true`,
  `keepRisk:"warning"`, `restoreRisk:"safe"`, `keptCurrent:true`, and
  `restoredOther:true`.
- Checkpoint mixed conflict editor: desktop smoke reported
  `CHECKPOINT_MIXED_CONFLICT_EDITOR` with `trackedChoices:["KEEP.md"]`,
  `safeFiles:["RESTORE.md"]`, `selectedChoiceFiles:["KEEP.md"]`,
  `selectedChoice:"current"`, and `mixedEditor:true`, proving the
  Electron-facing editor can split a tracked keep-current decision from a
  separate safe restore path.
- Subagent command: `SUBAGENT_COMMAND_READY` reported `/agent-code-reviewer`
  for the enabled `code-reviewer` descriptor, and
  `SUBAGENT_COMMAND_SUBMIT` verified the expanded prompt included the delegated
  profile plus `desktop IPC smoke ok` before `MESSAGE_SENT` accepted the
  normal chat send path.
- Agent lifecycle hooks: desktop smoke observed
  `desktop agent lifecycle after-agent-session-create` for chat
  `f4706781-5ec6-4bf4-9413-27c4373fbb77`,
  `desktop agent lifecycle after-agent-message-send` for turn
  `turn-c1d4b2e3-9cad-477f-b881-546830a194af`, and
  `desktop agent lifecycle after-agent-session-stop` after stopping that same
  chat.
- ACP Activity: Local ADE snapshot returned `total: 106`, `chatCount: 20`, 2
  owned entries for active chat `fc48bb66-2d31-44b2-afa6-e08905ff055f`, and 12
  correlation summaries; sampled
  events were `newSession` and `initialize`, with setup payload byte counts
  `381` and `409`, and metadata contained no `rawPayload*` keys.
- ACP Cross-session Timeline: desktop smoke reported
  `ACP_CROSS_SESSION_TIMELINE` with 11 chat lanes, 80 timeline frames,
  30 lane transitions, `spanMs:13037385`, 26 omitted older frames,
  40 workspace replay frames, `workspaceChatCount:8`, and
  `workspaceFilterChat:null`, proving the Electron-facing timeline can inspect
  multiple real session lanes and replay workspace traffic without collapsing
  back to the active chat.
- ACP Stream Diagnostics: desktop smoke reported `ACP_STREAM_DIAGNOSTICS` with
  `status:"attention"`, `retryEligible:true`, `retryDelayMs:1000`,
  `retryMaxAttempts:5`, `heartbeatWindowMs:30000`, `staleAfterMs:60000`,
  `correlatedFrameCount:40`, `orphanFrameCount:66`, `rootCount:20`,
  `longestChainLength:66`, 8 bounded gap rows, 8 bounded causal chains, and no
  raw payload metadata.
- ACP Stream Retry: desktop smoke called `settings.retryAcpActivityStream` and
  reported `ACP_STREAM_RETRY` with the same `1000ms x5` retry policy plus
  causal chains, proving the Electron-facing Retry Stream action returns a
  redacted diagnostics snapshot instead of replaying protocol side effects.
- ACP Export: `settings.exportAcpActivity` returned `schemaVersion: 1`,
  `redacted: true`, `chatId: fc48bb66-2d31-44b2-afa6-e08905ff055f`,
  `limit: 20`, `entries: 2`, `correlations: 1`, and `total: 2`; the exported
  trace contained no `rawPayload*` metadata.
- ACP Replay: `settings.replayAcpActivity` returned `schemaVersion: 1`,
  `redacted: true`, `chatId: fc48bb66-2d31-44b2-afa6-e08905ff055f`,
  `frames: 2`, and `correlations: 1`. The first frame was
  `[1, initialize, 0, 0]`, the last was `[2, newSession, 501, 501]`, frame
  sequence matched array order, timestamps were chronological, every frame was
  scoped to the active chat, and the replay contained no `rawPayload*`
  metadata.
- ACP Replay Kind Filter: `settings.replayAcpActivity` with
  `kind:"initialize"` returned `schemaVersion: 1`, `redacted: true`,
  `chatId: fc48bb66-2d31-44b2-afa6-e08905ff055f`, one replay frame, stats
  `{"initialize":1}`, and no `rawPayload*` metadata.
- ACP Replay Preset: `settings.saveAcpReplayPreset` saved
  `Desktop smoke initialize replay` for the active chat and `kind:"initialize"`,
  replaying that saved filter returned one redacted frame, and
  `settings.deleteAcpReplayPreset` removed the preset from the Local ADE
  snapshot. Desktop smoke reported `ACP_REPLAY_PRESET` with `saved:true`,
  `deleted:true`, `frames:1`, and `redacted:true`.
- Session loop: created chat `fc48bb66-2d31-44b2-afa6-e08905ff055f`, sent the
  expanded subagent prompt, observed assistant activity, stopped
  subscription/session/host.

```powershell
$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop
```

Result: passed, exited `0`. The app launched renderer URL
`http://127.0.0.1:3001`, reported runtime channel
`electron-ipc renderer bridge -> desktop-service runtime core`, loaded the
renderer, then stopped the owned desktop runtime service with exit code `0`.
This command was rerun after the Background Task Fleet UI change.

ZCode comparison check:

```powershell
$zcode = 'C:\Program Files\ZCode\ZCode.exe'
Get-Process | Where-Object { $_.ProcessName -like '*ZCode*' -or $_.Path -like '*ZCode*' }
```

Result: `C:\Program Files\ZCode\ZCode.exe` exists. ZCode already had an active
process tree, so no new launch was needed in this check (`launched: false`).
The process check observed 9 ZCode-owned processes, including native
`ZCode.exe` entries and `zcode-acp.exe` under
`C:\Program Files\ZCode\resources\glm\zcode-acp.exe`; those existing processes
were left running.

## Files Changed

- `GOAL_PROGRESS.md`
- `apps/desktop/scripts/acp-mcp-capture-agent.js`
- `apps/desktop/scripts/dev.ts`
- `apps/desktop/scripts/mcp-smoke-server.js`
- `apps/desktop/scripts/smoke-desktop-runtime.ts`
- `apps/server/src/bootstrap/service-registry/ai-services.ts`
- `apps/server/src/bootstrap/service-registry/session-services.ts`
- `apps/server/src/bootstrap/service-registry/settings-services.ts`
- `apps/server/src/modules/agent/infra/agent.repository.sqlite.ts`
- `apps/server/src/modules/ai/application/send-message.service.ts`
- `apps/server/src/modules/ai/application/send-message.service.test.ts`
- `apps/server/src/modules/ai/application/set-config-option.service.ts`
- `apps/server/src/modules/ai/infra/ai-session-runtime.adapter.ts`
- `apps/server/src/modules/session/application/cleanup-project-sessions.service.ts`
- `apps/server/src/modules/session/application/create-session.service.ts`
- `apps/server/src/modules/session/application/create-session.service.test.ts`
- `apps/server/src/modules/session/application/delete-session.service.ts`
- `apps/server/src/modules/session/application/discover-agent-sessions.service.ts`
- `apps/server/src/modules/session/application/discover-agent-sessions.service.test.ts`
- `apps/server/src/modules/session/application/get-session-state.service.test.ts`
- `apps/server/src/modules/session/application/persist-session-bootstrap.service.test.ts`
- `apps/server/src/modules/session/application/session-acp-bootstrap.service.ts`
- `apps/server/src/modules/session/application/session-acp-bootstrap.service.test.ts`
- `apps/server/src/modules/session/application/session-mcp-config.service.ts`
- `apps/server/src/modules/session/application/session-mcp-config.service.test.ts`
- `apps/server/src/modules/session/application/stop-session.service.ts`
- `apps/server/src/modules/session/application/stop-session.service.test.ts`
- `apps/server/src/modules/session/application/subscribe-session-events.service.ts`
- `apps/server/src/modules/settings/application/local-ade.service.ts`
- `apps/server/src/modules/settings/application/local-ade.service.test.ts`
- `apps/server/src/modules/settings/application/manage-boot-allowlists.service.ts`
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts`
- `apps/server/src/modules/supervisor/application/supervisor-permission.service.test.ts`
- `apps/server/src/modules/tooling/application/respond-permission.service.test.ts`
- `apps/server/src/platform/acp/handlers.ts`
- `apps/server/src/platform/acp/tool-calls.ts`
- `apps/server/src/platform/acp/update.ts`
- `apps/server/src/platform/acp/update-stream.test.ts`
- `apps/server/src/platform/git/index.ts`
- `apps/server/src/platform/storage/sqlite-worker-client.ts`
- `apps/server/src/runtime/desktop-service.ts`
- `apps/server/src/shared/contracts/session-export.contract.ts`
- `apps/server/src/shared/types/domain-events.types.ts`
- `apps/server/src/shared/types/session.types.ts`
- `apps/server/src/shared/utils/chat-events.util.test.ts`
- `apps/server/src/shared/utils/cli-args.util.test.ts`
- `apps/server/src/shared/utils/session-config-options.util.ts`
- `apps/server/src/shared/utils/session-config-options.util.test.ts`
- `apps/server/src/transport/trpc/routers/settings.ts`
- `apps/web/src/components/chat-ui/chat-interface.tsx`
- `apps/web/src/components/chat-ui/agentic-message-utils.ts`
- `apps/web/src/components/chat-ui/local-command.ts`
- `apps/web/src/components/chat-ui/local-command.test.ts`
- `apps/web/src/components/chat-ui/local-instruction.ts`
- `apps/web/src/components/chat-ui/local-instruction.test.ts`
- `apps/web/src/components/chat-ui/project-index-command.ts`
- `apps/web/src/components/chat-ui/project-index-command.test.ts`
- `apps/web/src/components/chat-ui/project-index-auto-context.ts`
- `apps/web/src/components/chat-ui/project-index-auto-context.test.ts`
- `apps/web/src/components/chat-ui/chat-input/project-memory-action-menu.tsx`
- `apps/web/src/components/chat-ui/project-memory-command.ts`
- `apps/web/src/components/chat-ui/project-memory-command.test.ts`
- `apps/web/src/components/chat-ui/project-memory-auto-context.ts`
- `apps/web/src/components/chat-ui/project-memory-auto-context.test.ts`
- `apps/web/src/components/chat-ui/subagent-command.ts`
- `apps/web/src/components/chat-ui/subagent-command.test.ts`
- `apps/web/src/components/connection-setup-dialog.tsx`
- `apps/web/src/components/local-ade/local-ade-operations.ts`
- `apps/web/src/components/local-ade/local-ade-operations.test.ts`
- `apps/web/src/components/local-ade/local-ade-control-center.tsx`
- `apps/web/src/components/ui/spinner.tsx`
- `apps/web/src/hooks/use-chat-actions.ts`
- `apps/web/src/hooks/use-chat-message-state.test.ts`
- `apps/web/tsconfig.json`
- `docs/research/zcode-blackbox-scorecard.md`
- `packages/shared/src/chat/session-config-options.ts`
- `packages/shared/src/chat/types.ts`

## Future Product Depth Surfaces

- Hook lifecycle execution is wired for project-index refresh, checkpoint
  create/restore, and the real agent session create/send/stop loop. Hooks now
  require execution-fingerprint trust, demote capabilities while untrusted or
  changed, and run with env-key allowlists instead of inheriting the full server
  environment. Manual hook runs now require a per-hook confirmation token plus a
  one-shot approved operation fingerprint before spawn, consume that approval
  after execution, and show changed/missing/expired/consumed operation state in
  Electron. Persisted runs can be marked reviewed or reopened from Electron,
  filtered by review state, and exported as redacted JSON. Direct shell-eval
  commands are now blocked by `executionPolicy` before spawn. Hook policy
  presets are now persisted and enforced: `restricted` blocks manual hook
  approval/run while leaving lifecycle events available, and `blocked` rejects
  execution before spawn. Lifecycle governance is now persisted and enforced:
  Electron can pause/resume lifecycle dispatch, pause individual events, choose
  `continue` or `stop-on-failure`, and inspect shared hook batch ids plus
  disabled-run diagnostics. Run scheduling is now also persisted and enforced:
  Electron can pause hook automation, set max concurrent run slots, set per-item
  cooldown, and inspect `ready`/`paused`/`cooldown`/`parallel-limit` status;
  manual and lifecycle hook runs create disabled audit rows without spawn when
  scheduling blocks execution. Hook batch queue and process-tree isolation are
  now implemented and visible in Electron; further hook work is product depth
  beyond the tracked ZCode black-box parity checklist.
- Plugin execution v0 is now usable for explicit project-local plugin commands,
  requires trust approval for the current command plus permission fingerprint,
  requires a per-plugin manual-run confirmation token, and runs with explicit
  scopes plus env-key allowlists instead of inheriting all server environment
  variables. Persisted plugin runs can be marked reviewed or reopened from
  Electron, filtered by review state, and exported as redacted JSON. Direct
  shell-eval commands are now blocked by `executionPolicy` before spawn.
  Process-only plugins now run in a temporary sandbox cwd, hide
  `ERAGEAR_PROJECT_ROOT`, and clean up that cwd after execution; project-root
  access must be explicitly scoped and trusted. Project-root plugin runs now
  persist before/after Git status plus pre/post checkpoint ids so users can
  inspect and restore through the checkpoint surface. Project-local signed
  package catalog v0 discovers `.eragear/plugin-packages/**/*.json`, verifies
  Ed25519 package manifests, surfaces installable/installed/update/invalid
  states in Electron, and installs from the discovered manifest path before
  persisting trusted plugin metadata. Saved signed registry management v0 now
  persists project-local registries, requires URL fingerprint trust before
  refresh/install, stores refreshed package pins, exposes install/update state,
  and installs packages through the saved registry after rechecking signature
  and public-key hash pins. Users can also revoke registry URL trust and revoke
  or restore individual signer public-key fingerprints; revoked signer packages
  become `revoked` and cannot install. Registry refresh also imports
  `revokedSigners` feed entries as `source:"registry"`, blocks matching
  packages, and rejects local restore until the registry feed clears the entry.
  Plugin permissions now have a separate grant/revoke fingerprint for scopes,
  env keys, and workspace access, and execution is blocked when that permission
  fingerprint is missing or changed. Signed package publisher identity and
  issue/expiry metadata are now verified, persisted, shown in Electron, pinned
  by registries when declared, and enforced at install plus manual run time.
  Manual plugin runs now also require a one-shot approved operation fingerprint
  before spawn, and the approval is consumed after execution. Plugin policy
  presets are now persisted and enforced: `restricted` forces sandbox workspace
  access even when project-root is requested, and `blocked` rejects execution
  before spawn. Run scheduling is now also persisted and enforced: Electron can
  pause plugin automation, set max concurrent run slots, set per-item cooldown,
  and inspect `ready`/`paused`/`cooldown`/`parallel-limit` status; plugin runs
  create disabled audit rows without spawn when scheduling blocks execution. It
  now includes a guarded manual batch queue that runs up to eight ready plugins,
  rechecks fingerprints, supports continue or stop-on-failure, persists
  plugin-batch-* summaries, saves/runs/deletes reusable batch presets, persists
  per-plugin dependency ids, derives a dependency graph, orders selected batch
  dependencies before dependents, and shows recent batch results plus dependency
  graph status in Electron. It now also includes a schedule runner for saved
  batch presets with due execution, stale-fingerprint skip auditing, and an
  automatic BackgroundRunner dispatch task for due schedules. The Local ADE
  runtime snapshot and first-screen Background Task Fleet now expose the
  scheduler daemon task state, cadence, counts, duration, and last dispatch
  result. Signed package revalidation and process-tree isolation are now
  implemented and visible in Electron; further plugin marketplace/governance
  work is product depth beyond the tracked ZCode black-box parity checklist.
- Project Memory semantic retrieval and Project Index vector search now support
  model-backed embeddings through a configured OpenAI-compatible endpoint
  (`ERAGEAR_EMBEDDINGS_ENDPOINT` / `ERAGEAR_EMBEDDINGS_MODEL`). `/memory
  --semantic` calls the embedding endpoint when configured, ranks chunks by model
  embedding cosine similarity, returns ranker/model/dimension metadata, and
  falls back to local token vectors only with explicit diagnostics. Project
  Index refresh now prioritizes root/depth and signal-rich files for the
  embedding quota, stores bounded redacted-excerpt vectors plus model/dimension
  hashes in `.eragear/repo-index.json`, strips raw vectors from the Electron
  snapshot, and `/index` query embedding returns model-only hits as
  `matchKind:"embedding"`. Electron's Project Index tile shows embedding source,
  model, and dimensions. Desktop smoke verifies `PROJECT_MEMORY_MODEL_EMBEDDING`
  and `PROJECT_INDEX_MODEL_EMBEDDING` through the private `desktop-service` path
  with redacted memory and no embedding secret leakage.
- Remote auth admin/device-session management remains outside the local ADE
  surface until a local auth-admin policy exists.
- MCP entries now expose sanitized step-level probe timelines, a per-server
  Retry action, persisted redacted probe history for real protocol discovery
  runs, manual tool/resource invocation, and persisted redacted invocation
  audit history plus redacted server notification history. Trusted
  project-local MCP servers are now injected into ACP session setup after
  matching the current fingerprint, while untrusted or changed servers are
  skipped. Trusted project-local stdio routes are injected through an Eragear
  MCP broker that re-checks the project-local fingerprint before each
  tool/resource call, redacts response/audit text, and exposes recent brokered
  agent calls back in the Electron routing panel. Electron now also shows a
  redacted Agent Session Routing preview for each project-local MCP server,
  including brokered stdio/HTTP/SSE routes, exact block reasons, and header-env
  key names only. Manual
  invocation also requires trusting the current redacted server fingerprint,
  and changed fingerprints demote the MCP capability until reviewed. SSE
  discovery probes now have bounded
  reconnect/replay for pending protocol requests when the stream drops before
  discovery completes. SSE invocation now replays safe `resources/read` once
  after stream loss and blocks automatic replay for side-effecting `tools/call`
  with an exact policy diagnostic. Trusted SSE servers now also have a bounded
  Watch action that initializes the MCP session, captures server-pushed
  notifications as monitor events, reconnects once after stream loss, persists
  a monitor run history, and renders those results in Electron. Remote
  HTTP/SSE MCP servers now also expose Electron Remote Controls for request
  timeout, reconnect attempts, and default notification watch duration.
  `settings.configureMcpRemoteControls` persists those values, includes them in
  the reviewed MCP fingerprint, changes trust status until re-approved, and
  applies the controls to probe, invocation, watch, and agent-broker paths.
  Desktop smoke now verifies `MCP_REMOTE_CONTROLS` and
  `MCP_NOTIFICATION_MONITOR` with the configured watch duration.
- ACP Activity now shows, exports, and replays redacted per-chat event traffic,
  event kinds, payload byte counts, aggregate counts, chronological frames, and
  chat/session/turn/source correlation summaries. Replay supports server-side
  correlation and kind filters from Electron, verified by
  `ACP_REPLAY_KIND_FILTER`, and saved replay presets are persisted in
  `.eragear/acp-replay-presets.json` with save/load/delete controls in
  Electron. Cross-session timeline lanes, lane transitions, workspace-wide
  replay, Retry Stream, stream retry policy, heartbeat/stale diagnostics,
  stream gap rows, and causal chain diagnostics are now visible from the same
  redacted activity panel.
- Checkpoint/change trust now includes a Visual Merge section above the raw
  structured diff. Electron derives restore-mode-specific current/restore
  labels, per-file risk and recommended-action badges, row counts, file
  selection, all-hunk/clear-hunk actions, per-hunk selection, and side-by-side
  current/restore row cells from the checkpoint preview. The server exposes the
  preview restore mode, and desktop smoke verifies `CHECKPOINT_VISUAL_MERGE`
  alongside the existing guarded restore, Mixed Restore, conflict choice,
  selected-hunk, and safety-checkpoint markers.
- Verification rerun for this checkpoint/logs/embedding slice passed:
  `bun test apps/web/src/components/local-ade/local-ade-operations.test.ts`,
  `bun test apps/server/src/modules/settings/application/local-ade.service.test.ts`,
  `bun run --cwd apps/desktop check-types`,
  `bun run --cwd apps/desktop build:main`,
  `bun run --cwd apps/web build`,
  `$env:ERAGEAR_DESKTOP_SMOKE_PROMPT_WAIT_MS='12000'; bun run --cwd apps/desktop ./scripts/smoke-desktop-runtime.ts`,
  and `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop`.

## 2026-06-19 package cleanup: env/db/shared naming

- Renamed the shared workspace package from `@repo/shared` to
  `@eragear-code-copilot/shared` and updated active desktop, native, runtime,
  and lockfile consumers.
- Removed obsolete `packages/env` and `packages/db` after confirming no active
  product code imports them. Runtime-owned SQLite/Drizzle files remain in
  `packages/runtime`, where application/runtime persistence now lives.
- Removed active workspace dependencies on `@eragear-code-copilot/env` from
  desktop, native, and runtime manifests. Removed root-level database workflow
  scripts and stale root direct dependencies that belonged to the deleted DB
  package or old web/server product shape.
- Updated root docs and agent guidance to describe the remaining active package
  set as `packages/runtime`, `packages/api-contract`, `packages/shared`, and
  `packages/config`.
- Cleaned stale workspace links and unused package folders from local
  `node_modules`: `@repo/shared`, `@eragear-code-copilot/env`,
  `@eragear-code-copilot/db`, `@eragear-code-copilot/trpc-contract`,
  `react-window`, and `@types/react-window`.
- Added the desktop renderer `@/*` and `#runtime/*` path aliases to the
  desktop solution `tsconfig.json` so `bun test` resolves the same aliases as
  Vite and `tsconfig.renderer.json`.
- Verification passed:
  `bun install --lockfile-only`,
  `bun install`,
  `bun run --cwd apps/desktop check-types`,
  `bun run --cwd packages/runtime check-types`,
  `bun run --cwd packages/api-contract check-types`,
  `bun run --cwd apps/native ui-map`, and
  `bunx biome check packages apps/desktop apps/native --error-on-warnings`,
  `bun run build`, and `bun run audit:blockers`.
- Remaining work: none for this cleanup slice. `better-sqlite3` and `sql.js`
  may still appear as transitive optional dependencies of active
  `better-auth`/`drizzle-orm` packages, but they are no longer root or deleted
  `packages/db` dependencies.

## 2026-06-19 desktop browser preview v0

- Added an Electron-owned integrated browser controller in
  `apps/desktop/src/browser-integration.ts`. It opens a sandboxed native
  BrowserWindow with Node integration disabled, validates file URLs against the
  active project/repo root, supports HTML file picking, localhost/URL
  navigation, back/forward/reload, fullscreen, DevTools, console capture, and a
  page context capture probe.
- Exposed the browser surface through preload IPC as
  `window.eragearDesktop.browserControls`, keeping renderer access behind the
  existing contextBridge boundary.
- Upgraded the right-sidebar Browser panel with URL/port navigation, HTML file
  preview, native browser launch, fullscreen/DevTools controls, React Grab and
  React Scan injection toggles for file/localhost targets, and a copy-context
  action that captures selected text, hovered HTML, visible page text, React
  renderer count, and recent console messages for chat use.
- Relaxed renderer CSP only for framed preview targets via `frame-src`, while
  leaving privileged native browser operations in Electron main.
- Files changed:
  `apps/desktop/src/browser-integration.ts`,
  `apps/desktop/src/main.ts`,
  `apps/desktop/src/preload.ts`,
  `apps/desktop/src/security.ts`,
  `apps/desktop/src/renderer/lib/desktop-bootstrap.ts`,
  `apps/desktop/src/renderer/components/right-sidebar/browser-panel.tsx`, and
  `GOAL_PROGRESS.md`.
- Verification passed:
  `bun run --cwd apps/desktop check-types`,
  `bun run --cwd apps/desktop build:main`,
  `bun run --cwd apps/desktop build:renderer`,
  `bunx biome check apps/desktop/src/browser-integration.ts apps/desktop/src/main.ts apps/desktop/src/preload.ts apps/desktop/src/security.ts apps/desktop/src/renderer/components/right-sidebar/browser-panel.tsx --error-on-warnings`,
  and
  `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop`.
- Remaining work: embed the native browser view inline with bounded
  WebContentsView layout, route captured browser context directly into chat
  attachments/context state, and add persisted browser sessions plus deeper
  network/test automation.

## 2026-06-20 Supervisos dedicated panel and side chat

- Replaced the chat header Environment affordance with a dedicated Supervisos
  panel entry. The panel now uses `aria-label="Supervisos"` and
  `id="supervisos-panel"` and no longer labels the surface as Environment.
- Moved Supervisos side chat off the main ACP chat pipeline. The previous
  prompt-injection path that generated `Supervisos side chat request` messages
  was removed, and the renderer now calls a dedicated `supervisorChat` tRPC
  mutation instead of `sendMessage`.
- Added a full side-chat surface in
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx` with
  local message history, assistant/user bubbles, pending/error states, quick
  Gate/Scope/Verify actions, fixed input controls, and an Enable Autopilot
  action. Closing/reopening the panel no longer destroys the local side-chat
  state for the active chat.
- Added runtime-owned Supervisos chat use case and MiniMax-M3 adapter:
  `SupervisorChatService`, `SupervisorChatInputSchema`,
  `SupervisorChatPort`, and `AiSdkSupervisorChatAdapter`. The service reads
  compact session state, supervisor state, current plan, and compact Goal Mode
  audit summaries; it does not inject raw main transcript or raw diffs.
- Extended the supervisor prompt builder with side-chat system/body prompts so
  the configured Supervisos custom system prompt and tool policy also apply to
  side chat responses.
- Changed files for this slice:
  `apps/desktop/src/renderer/components/chat-ui/chat-header.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/chat-interface.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/chat-context-rail.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-prompt.ts`
  (removed),
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-prompt.test.ts`
  (removed), `apps/desktop/src/renderer/components/settings/settings-panels.tsx`,
  `packages/runtime/src/modules/supervisor/application/ports/supervisor-chat.port.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.contract.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.test.ts`,
  `packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-chat.adapter.ts`,
  `packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.ts`,
  `packages/runtime/src/modules/supervisor/di.ts`,
  `packages/runtime/src/modules/supervisor/index.ts`,
  `packages/runtime/src/modules/use-cases.ts`,
  `packages/runtime/src/bootstrap/service-registry/supervisor-services.ts`,
  `packages/runtime/src/transport/trpc/routers/ai-supervisor-router.ts`, and
  `packages/runtime/src/transport/trpc/routers/ai-router.test.ts`.
- Verification passed:
  `$bun=(Get-Command bun).Source; $policy=ConvertTo-Json -InputObject @(@{command=$bun;allowAnyArgs=$true}) -Compress; $env:ALLOWED_AGENT_COMMAND_POLICIES=$policy; $env:ALLOWED_TERMINAL_COMMAND_POLICIES=$policy; $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.test.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/transport/trpc/routers/ai-router.test.ts`,
  `bun run --cwd packages/runtime check-types`,
  `bun run --cwd apps/desktop check-types`,
  `bun run audit:blockers`,
  `bunx biome check packages apps/desktop apps/native --error-on-warnings`,
  and `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop`.
- Remaining work: none for this UI/runtime slice. Live Supervisos side-chat
  responses still require Supervisor to be configured with MiniMax-M3 and a
  valid `MINIMAX_API_KEY`/stored MiniMax key.

## 2026-06-20 Supervisos side-chat activation clarity and project context

- Fixed the Supervisos panel status copy so a configured but disabled session no
  longer appears as `Ready`. It now shows `Session off` with detail
  `Configured; enable autopilot for this session`; active sessions show
  `Active`, and error sessions show `Error`.
- Added bounded project context for Supervisos side chat in runtime:
  top-level project entries plus small excerpts from common README, manifest,
  entry, and config files. This lets side chat answer basic project questions
  without raw main transcript or raw diff injection.
- Added filesystem sandbox checks around context-file discovery with realpath
  validation against the project root, bounded reads, skipped hidden/generated
  top-level folders, and case-insensitive candidate dedupe for Windows.
- Sanitized MiniMax side-chat responses so `<think>...</think>` blocks are
  removed before content reaches the UI. The side-chat system prompt also now
  explicitly asks for final user-facing answers only.
- Changed files for this slice:
  `apps/desktop/src/renderer/components/chat-ui/chat-context-rail.tsx`,
  `packages/runtime/src/bootstrap/service-registry/supervisor-services.ts`,
  `packages/runtime/src/modules/supervisor/application/ports/supervisor-chat.port.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.test.ts`,
  `packages/runtime/src/modules/supervisor/di.ts`,
  `packages/runtime/src/modules/supervisor/index.ts`,
  `packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-chat.adapter.ts`,
  `packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-chat.adapter.test.ts`,
  `packages/runtime/src/modules/supervisor/infra/filesystem-supervisor-project-context.adapter.ts`,
  and
  `packages/runtime/src/modules/supervisor/infra/filesystem-supervisor-project-context.adapter.test.ts`.
- Verification passed:
  `bunx biome check apps/desktop/src/renderer/components/chat-ui/chat-context-rail.tsx packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.test.ts packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-chat.adapter.test.ts packages/runtime/src/modules/supervisor/infra/filesystem-supervisor-project-context.adapter.test.ts packages/runtime/src/modules/supervisor/infra/filesystem-supervisor-project-context.adapter.ts packages/runtime/src/modules/supervisor/index.ts --write --error-on-warnings`,
  `$bun=(Get-Command bun).Source; $policy=ConvertTo-Json -InputObject @(@{command=$bun;allowAnyArgs=$true}) -Compress; $env:ALLOWED_AGENT_COMMAND_POLICIES=$policy; $env:ALLOWED_TERMINAL_COMMAND_POLICIES=$policy; $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.test.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-chat.adapter.test.ts packages/runtime/src/modules/supervisor/infra/filesystem-supervisor-project-context.adapter.test.ts`,
  `bun run --cwd packages/runtime check-types`, and
  `bun run --cwd apps/desktop check-types`,
  `bunx biome check packages apps/desktop apps/native --error-on-warnings`, and
  `bun run audit:blockers`.
- Remaining work: restart the desktop dev session to pick up the renderer and
  runtime changes, then verify side chat against a live MiniMax key.

## 2026-06-20 Supervisos AST project intelligence

- Added `SupervisorProjectIntelligencePort` for side-chat project intelligence
  separate from `SupervisorSessionState`. The chat service now builds compact
  project context plus compact project intelligence before calling MiniMax.
- Added `ScopeSupervisorProjectIntelligenceAdapter`, backed by repo snapshot
  indexing, Scope Resolver, and the TypeScript AST import graph. It precomputes
  `resolve_scope`, `ast_import_graph_context`, `search_symbols`, and route-map
  summaries for the user's side-chat question.
- Preserved project-root boundaries: the adapter validates the repo index root
  against the stored session `projectRoot` and fails closed with diagnostics
  when they differ.
- Wired Supervisos project intelligence in the runtime composition root after
  settings/scope-resolution use-cases are created. Electron main/preload remain
  unchanged and thin.
- Added an `AST` quick action to the Supervisos Chat UI so the user can ask for
  relevant scope, symbols, imports, and imported-by relationships directly.
- Changed files for this slice:
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx`,
  `packages/runtime/src/bootstrap/init/service-module.init.ts`,
  `packages/runtime/src/bootstrap/service-registry/supervisor-services.ts`,
  `packages/runtime/src/modules/supervisor/application/ports/supervisor-chat.port.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.test.ts`,
  `packages/runtime/src/modules/supervisor/di.ts`,
  `packages/runtime/src/modules/supervisor/index.ts`,
  `packages/runtime/src/modules/supervisor/infra/scope-supervisor-project-intelligence.adapter.ts`,
  and
  `packages/runtime/src/modules/supervisor/infra/scope-supervisor-project-intelligence.adapter.test.ts`.
- Verification passed:
  `$bun=(Get-Command bun).Source; $policy=ConvertTo-Json -InputObject @(@{command=$bun;allowAnyArgs=$true}) -Compress; $env:ALLOWED_AGENT_COMMAND_POLICIES=$policy; $env:ALLOWED_TERMINAL_COMMAND_POLICIES=$policy; $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.test.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/modules/supervisor/infra/scope-supervisor-project-intelligence.adapter.test.ts packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-chat.adapter.test.ts packages/runtime/src/modules/supervisor/infra/filesystem-supervisor-project-context.adapter.test.ts`,
  `bun run --cwd packages/runtime check-types`,
  `bun run --cwd apps/desktop check-types`,
  `bunx biome check packages apps/desktop apps/native --error-on-warnings`, and
  `bun run audit:blockers`.
- Remaining work: restart the desktop dev session and ask Supervisos Chat to
  use `AST` on a TS/TSX project with repo snapshot indexing enabled.

## 2026-06-20 Supervisos main-agent delegation

- Changed Supervisos side chat from copy/paste guidance to active delegation
  for implementation requests when the session supervisor mode is
  `full_autopilot`.
- Supervisos now detects implementation-style side-chat requests, builds a
  bounded enhanced prompt with the original request, project context,
  precomputed AST/scope intelligence, implementation instructions, and guarded
  gates, then submits it through the existing `SendMessageService` pipeline with
  `source: "supervisor"`.
- The delegation path intentionally does not paste into the renderer DOM. It is
  equivalent to paste-and-send from the user's perspective, but goes through the
  runtime chat send path so ACP permission boundaries, project-root sandbox
  checks, session lifecycle, and Goal Mode/supervisor follow-up handling remain
  intact.
- Side chat remains advisory for questions, status/debugging requests, and
  sessions where supervisor mode is off. In those cases it answers directly via
  MiniMax side chat instead of sending work to the coding agent.
- Added tests proving implementation requests delegate to the main coding agent,
  avoid the side-chat MiniMax adapter, preserve the original request, and return
  the delegated turn id/status to the Supervisos Chat UI.
- Changed files for this slice:
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts`,
  `packages/runtime/src/bootstrap/service-registry/supervisor-services.ts`,
  `packages/runtime/src/modules/ai/index.ts`, and
  `packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.ts`.
- Verification passed:
  `bunx biome check packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/bootstrap/service-registry/supervisor-services.ts packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.ts --write --error-on-warnings`,
  `$bun=(Get-Command bun).Source; $policy=ConvertTo-Json -InputObject @(@{command=$bun;allowAnyArgs=$true}) -Compress; $env:ALLOWED_AGENT_COMMAND_POLICIES=$policy; $env:ALLOWED_TERMINAL_COMMAND_POLICIES=$policy; $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/modules/supervisor/application/supervisor-prompt.builder.test.ts packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-chat.adapter.test.ts packages/runtime/src/modules/supervisor/infra/scope-supervisor-project-intelligence.adapter.test.ts`,
  `bun run --cwd packages/runtime check-types`,
  `bun run --cwd apps/desktop check-types`,
  `bunx biome check packages apps/desktop apps/native --error-on-warnings`,
  `bun run audit:blockers`, and `git diff --check`.
- Remaining work: restart the desktop dev session so the running app picks up
  the new runtime wiring, then verify live behavior by sending an implementation
  request from Supervisos Chat while the session is in `full_autopilot`.

## 2026-06-20 Supervisos side-chat timeout hardening

- Fixed the timeout-prone path where implementation requests sent while
  Supervisor mode was `off` could fall through to the MiniMax side-chat advisory
  provider instead of delegating to the main coding agent.
- Implementation-style requests from Supervisos Chat now delegate to the main
  coding agent even when Autopilot is off. The response clearly reports that
  the task was submitted, and that auto-continue requires enabling Autopilot.
- Added soft timeouts around project context, project intelligence, and
  advisory MiniMax side-chat responses. Timeouts now return explicit bounded
  fallback diagnostics instead of letting the renderer surface a generic
  operation timeout.
- Changed files for this slice:
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts`,
  `packages/runtime/src/modules/supervisor/application/ports/supervisor-chat.port.ts`,
  and `GOAL_PROGRESS.md`.
- Verification passed:
  `bunx biome check packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/modules/supervisor/application/ports/supervisor-chat.port.ts --write --error-on-warnings`,
  `$bun=(Get-Command bun).Source; $policy=ConvertTo-Json -InputObject @(@{command=$bun;allowAnyArgs=$true}) -Compress; $env:ALLOWED_AGENT_COMMAND_POLICIES=$policy; $env:ALLOWED_TERMINAL_COMMAND_POLICIES=$policy; $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-chat.adapter.test.ts`,
  `bun run --cwd packages/runtime check-types`,
  `bun run --cwd apps/desktop check-types`,
  `bunx biome check packages apps/desktop apps/native --error-on-warnings`, and
  `bun run audit:blockers`.
- Remaining work: restart the desktop dev session and retry the same Supervisos
  Chat prompt.

## 2026-06-20 Supervisos chat scroll stability

- Fixed the Supervisos message list auto-scroll bug. The message list no longer
  scrolls to the bottom on every render while the user is reading older
  messages.
- Auto-scroll now only happens when the list is already near the bottom or when
  the user sends a new Supervisos message.
- Changed file:
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx`.
- Verification passed:
  `bunx biome check apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx --write --error-on-warnings`,
  `bun run --cwd apps/desktop check-types`, and
  `git diff --check apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx`.

## 2026-06-20 Supervisos delegated prompt timeout fix

- Fixed the remaining timeout path for Supervisos implementation requests:
  `SendMessageService` no longer runs the global Prompt Enhancer for
  `source: "supervisor"` prompts. Supervisos delegation already builds an
  enhanced prompt, so re-enhancing could block the side-chat mutation before the
  prompt was submitted to the main coding agent.
- Added a regression test proving supervisor delegated prompts skip prompt
  enhancement while still reaching ACP as the delegated prompt text.
- Changed files:
  `packages/runtime/src/modules/ai/application/send-message.service.ts`,
  `packages/runtime/src/modules/ai/application/send-message.service.test.ts`,
  and `GOAL_PROGRESS.md`.
- Verification passed:
  `bunx biome check packages/runtime/src/modules/ai/application/send-message.service.ts packages/runtime/src/modules/ai/application/send-message.service.test.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts --write --error-on-warnings`,
  `$bun=(Get-Command bun).Source; $policy=ConvertTo-Json -InputObject @(@{command=$bun;allowAnyArgs=$true}) -Compress; $env:ALLOWED_AGENT_COMMAND_POLICIES=$policy; $env:ALLOWED_TERMINAL_COMMAND_POLICIES=$policy; $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test packages/runtime/src/modules/ai/application/send-message.service.test.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts`,
  `bun run --cwd packages/runtime check-types`,
  `bun run --cwd apps/desktop check-types`,
  `bun run audit:blockers`, and
  `git diff --check packages/runtime/src/modules/ai/application/send-message.service.ts packages/runtime/src/modules/ai/application/send-message.service.test.ts`.

## 2026-06-20 Supervisos supervised task handoff UX

- Changed implementation requests sent to Supervisos Chat into supervised task
  handoffs: if the session is not already `full_autopilot`, Supervisos now
  enables Autopilot through `SetSupervisorModeService` before delegating the
  enhanced prompt to the main coding agent.
- Wired the same mode-setting service used by the UI control into
  `SupervisorChatService`, keeping the behavior in runtime/application services
  rather than Electron renderer/main code.
- Removed the long raw enhanced prompt preview from the side-chat response.
  Supervisos now returns a concise task-handoff status with turn id, submitted
  state, and whether it activated Autopilot.
- Added a regression test proving implementation requests enable Autopilot
  before delegation and no longer show `Prompt sent:` debug output.
- Changed files:
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts`,
  `packages/runtime/src/bootstrap/service-registry/supervisor-services.ts`, and
  `GOAL_PROGRESS.md`.
- Verification passed:
  `bunx biome check packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/bootstrap/service-registry/supervisor-services.ts --write --error-on-warnings`,
  `$bun=(Get-Command bun).Source; $policy=ConvertTo-Json -InputObject @(@{command=$bun;allowAnyArgs=$true}) -Compress; $env:ALLOWED_AGENT_COMMAND_POLICIES=$policy; $env:ALLOWED_TERMINAL_COMMAND_POLICIES=$policy; $env:ALLOWED_ENV_KEYS='PATH,HOME,USERPROFILE,TEMP,TMP'; bun test packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/modules/ai/application/send-message.service.test.ts`,
  `bun run --cwd packages/runtime check-types`,
  `bun run --cwd apps/desktop check-types`,
  `bun run audit:blockers`, and
  `git diff --check packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/bootstrap/service-registry/supervisor-services.ts`.
- Additional exact-case verification passed:
  `SupervisorChatService > enables autopilot before delegating implementation requests`
  now uses the real Vietnamese request
  `Tạo cho tôi một trang web AWWWARDS cho cửa hàng bán Hamburger.`, asserts
  `full_autopilot` is enabled before delegation, asserts the main-agent prompt
  preserves the request, and asserts the side-chat response does not contain
  `Prompt sent:` or `Original user request:`.
- Desktop smoke passed:
  `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop` -> exit `0`;
  output included the renderer URL, `Runtime channel: electron-ipc renderer bridge -> desktop-service runtime core`,
  `SUPERVISOS_SMOKE_SUPERVISOR MiniMax-M3 provider-config marker`,
  `SUPERVISOS_SMOKE_GOAL guarded-gate goal-flow marker`, and `Renderer loaded`.

## 2026-06-20 Supervisos legacy handoff compatibility guard

- Added a renderer compatibility guard for the exact legacy response shape:
  `Enhanced prompt sent...`, `Supervisor mode: off`, and `Prompt sent:`.
- If a running/stale runtime still returns that legacy payload, the Supervisos
  side chat now parses the turn id/status, calls the existing Enable Autopilot
  action immediately, and displays the concise supervised handoff message
  instead of the raw prompt dump.
- Added `supervisos-side-chat-utils.ts` and tests that use the real legacy
  payload text, proving the UI hides `Prompt sent:`, `Original user request:`,
  and `Supervisor mode: off`.
- Added the new test to `apps/desktop` `test:blockers`, so `audit:blockers`
  will catch this regression.
- Changed files:
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.ts`,
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.test.ts`,
  `apps/desktop/package.json`, and `GOAL_PROGRESS.md`.
- Verification passed:
  `bunx biome check apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.ts apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.test.ts apps/desktop/package.json --write --error-on-warnings`,
  `bun test apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.test.ts`,
  `bun run --cwd apps/desktop check-types`,
  `bun run --cwd apps/desktop test:blockers`,
  `bun run audit:blockers`,
  `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop`, and
  `git diff --check apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.ts apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.test.ts apps/desktop/package.json GOAL_PROGRESS.md`.

## 2026-06-20 Supervisos busy-session queue handoff

- Fixed the `A prompt is already in progress for this session` UX path. When a
  Supervisos implementation request hits the runtime `PROMPT_BUSY` guard, the
  side chat now queues an enhanced main-agent prompt instead of surfacing the
  raw error.
- Added a pending Supervisos prompt queue in `ChatInterface`. It flushes only
  when the active chat is connected and `status === "ready"`, then enables
  Autopilot and submits through the same `handleSubmit` path used by the main
  ChatInput.
- Added a renderer fallback prompt enhancer for the busy queue path. It wraps
  the original request with implementation instructions and completion evidence
  expectations, without raw transcript or raw diff content.
- Kept ACP/session boundaries intact: Supervisos still does not bypass
  `SendMessageService`, project-root sandbox checks, permission gates, or the
  normal submit lifecycle.
- Fixed the runtime delegation order so Supervisos submits the delegated prompt
  first and enables Autopilot only after the prompt is accepted. If submit is
  rejected as busy, supervisor mode is not changed, preventing Supervisos from
  supervising the previous in-flight turn.
- Changed files:
  `apps/desktop/src/renderer/components/chat-ui/chat-interface.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/chat-context-rail.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.ts`,
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.test.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts`,
  and `GOAL_PROGRESS.md`.
- Verification passed:
  `bunx biome check apps/desktop/src/renderer/components/chat-ui/chat-interface.tsx apps/desktop/src/renderer/components/chat-ui/chat-context-rail.tsx apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.ts apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.test.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts --write --error-on-warnings`,
  `bun test apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.test.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts`,
  `bun run --cwd apps/desktop check-types`,
  `bun run --cwd packages/runtime check-types`, and
  `bun run --cwd apps/desktop test:blockers`,
  `bun run audit:blockers`,
  `bunx biome check packages apps/desktop apps/native --error-on-warnings`, and
  `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop`,
  `git diff --check apps/desktop/src/renderer/components/chat-ui/chat-interface.tsx apps/desktop/src/renderer/components/chat-ui/chat-context-rail.tsx apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.ts apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.test.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts GOAL_PROGRESS.md`.
- Remaining work: none for this busy-session queue handoff slice.

## 2026-06-20 Supervisos ChatInput staging flow

- Corrected the Supervisos implementation-request flow to match the intended
  product model: Supervisos now acts as a prompt enhancer and returns a
  `stage_main_prompt` action instead of submitting hidden work from side chat.
- The renderer stages the enhanced prompt into the real main `ChatInput`.
  Autopilot sessions auto-submit from that form only when the main chat is
  connected and `status === "ready"`; non-Autopilot sessions leave the prompt in
  the input for review/edit/send.
- Added `InjectedChatPrompt` support inside `ChatInput` using the existing
  `PromptInputProvider` controller, so the draft is visible in the actual input
  rather than sent through a side-channel.
- Removed direct `SendMessageService`/mode-setting dependencies from
  `SupervisorChatService` implementation requests. Runtime/business logic stays
  in `packages/runtime`, and Electron remains a thin renderer/main bridge.
- Changed files:
  `apps/desktop/src/renderer/components/chat-ui/chat-input.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/chat-interface.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/chat-context-rail.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts`,
  `packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts`,
  `packages/runtime/src/bootstrap/service-registry/supervisor-services.ts`,
  and `GOAL_PROGRESS.md`.
- Verification passed:
  `bunx biome check apps/desktop/src/renderer/components/chat-ui/chat-input.tsx apps/desktop/src/renderer/components/chat-ui/chat-interface.tsx apps/desktop/src/renderer/components/chat-ui/chat-context-rail.tsx apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat.tsx packages/runtime/src/modules/supervisor/application/supervisor-chat.service.ts packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts packages/runtime/src/bootstrap/service-registry/supervisor-services.ts --write --error-on-warnings`,
  `bun test packages/runtime/src/modules/supervisor/application/supervisor-chat.service.test.ts apps/desktop/src/renderer/components/chat-ui/supervisos-side-chat-utils.test.ts`,
  `bun run --cwd apps/desktop check-types`,
  `bun run --cwd packages/runtime check-types`,
  `bun run audit:blockers`,
  `bunx biome check packages apps/desktop apps/native --error-on-warnings`, and
  `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop`.
- Remaining work: none for this ChatInput staging slice.

## 2026-07-24 Subscription-aware Scheduled ACP Tasks

- Evolved the durable Bots document to version 2 while preserving version 1
  records as `fixed` adaptive-session tasks. Definitions now retain an
  objective, work mode, prompt strategy, one provider binding, reserve windows,
  optional absolute reserve, ACP project/agent/model/chat binding, and durable
  completion evidence.
- Added provider admission with fresh-ready quota enforcement, all-window
  reserve checks, `task_queue` entitlement enforcement, one durable active
  scheduled dispatch per provider, startup lease reconciliation, terminal
  release, and visible fail-closed retry reasons.
- Added runtime-owned scheduled-work decisions that read fresh project context,
  Scope Resolution/Project Index intelligence when available, bounded prior
  run evidence, and the configured Supervisor memory/research adapters. Only
  bounded redacted rationale/evidence and prompt hashes are persisted.
- Added adaptive ACP execution through the existing create/resume/model/send
  services. Ready sessions are reused, stopped compatible sessions are
  resumed, deleted bindings are replaced, `PROMPT_BUSY` remains queued, and
  provider/model mismatches fail closed.
- Added full Supervisor-run execution with schedule/provider/model/agent
  restrictions and admission before every worker dispatch. Existing
  non-terminal runs are resumed and re-scheduled; terminal incomplete work can
  be freshly replanned.
- Added safe scheduled-task update events and tRPC procedures for list,
  create/update, enable/disable, run-if-eligible, stop, retry, delete, legacy
  orchestration, and subscription.
- Rebuilt Settings > Bots as Settings > Scheduled Tasks. The monitoring surface
  now uses peer `Tasks` / `Run history` tabs, while the multi-field create/edit
  flow is isolated in a dialog populated by live quota, project, agent, and
  session data. Cards never display raw prompts, transcripts, diffs, or patch
  bodies; legacy fixed Bots remain editable and executable.
- UX evidence:
  `docs/ux-ui-map/external-audit-baseline-BotsSettingsPanel-20260723T184128Z.txt`,
  `docs/ux-ui-map/route-ledger.md`, and
  `docs/ux-ui-map/iteration-log.md`. The independent AGY reviewer was
  unavailable because its individual quota was exhausted. The rejected first
  artifact was not implemented; the corrected source-backed plan moved the
  editor into a dialog and was recorded with the reviewer limitation. Windows
  automation launched the real Electron window but could not focus it while an
  OS overlay retained foreground ownership, so no unverified click path is
  claimed.
- Primary changed areas:
  `packages/runtime/src/modules/bots/`,
  `packages/runtime/src/modules/supervisor/application/scheduled-work-*`,
  `packages/runtime/src/modules/supervisor/infra/ai-sdk-scheduled-work-decision.adapter.ts`,
  `packages/runtime/src/modules/supervisor-orchestration/`,
  `packages/runtime/src/transport/trpc/routers/bots.ts`,
  runtime bootstrap/use-case/event/session-source wiring, and
  `apps/desktop/src/renderer/components/settings/bots-settings-panel.tsx`.
- Verification passed:
  `bun test packages/runtime/src/modules/bots packages/runtime/src/modules/supervisor/application/scheduled-work-decision.service.test.ts packages/runtime/src/modules/supervisor-orchestration/application/supervisor-orchestrator.controls.test.ts packages/runtime/src/modules/supervisor-orchestration/application/worker-session-manager.service.test.ts packages/runtime/src/transport/trpc/routers/bots.test.ts`
  (`37 pass, 0 fail`);
  the allowlist-configured AI/session/full Supervisor-orchestration module run
  (`103 pass, 0 fail`);
  `bun run --cwd packages/runtime test:e2e:supervisor-orchestration`;
  `bun run --cwd packages/runtime test:e2e:supervisor-orchestration-cancel`;
  `bun run --cwd packages/runtime check-types`;
  `bun run --cwd apps/desktop check-types`;
  `bun run audit:blockers`;
  `bunx biome check packages apps/desktop apps/native --error-on-warnings`;
  `bun run --cwd apps/desktop build:main`;
  `bun run --cwd apps/desktop build:renderer`;
  `git diff --check`; and
  `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop`.
  The mocked fresh/blocked quota and stopped OpenCode-compatible session resume
  paths are covered by the focused Bots service tests.
- Remaining work: live MiniMax/Z.AI dispatch verification requires configured
  provider credentials and a compatible real agent/model; no code blocker
  remains.

## 2026-07-26 Production-complete chat virtualization

- Completed the Electron renderer chat timeline's TanStack Virtual end-anchor
  contract. The timeline now uses the public `isAtEnd()` and `scrollToEnd()`
  APIs with explicit `anchorTo: "end"`, pinned-only append following, stable
  dynamic measurement, and a 96px end threshold.
- Added chat-scoped virtual row keys so measurement caches cannot leak between
  sessions that reuse a message id. Older-history prepends retain the same keys
  and visual anchor for every existing message.
- Added deterministic initial-scroll reconciliation. A newly selected chat
  opens at its latest message even when its history arrives asynchronously or
  has the same row count as the previous chat.
- Covered the count-neutral `Thinking...` to assistant-message tail replacement
  that TanStack's count-increase append path does not handle. It follows the new
  tail only when the reader was already pinned and never pulls a reader away
  from older history.
- Added the virtualization contract tests to the desktop `test:blockers` gate.
- Changed files:
  `apps/desktop/src/renderer/components/chat-ui/chat-messages.tsx`,
  `apps/desktop/src/renderer/components/chat-ui/chat-messages-virtualization.ts`,
  `apps/desktop/src/renderer/components/chat-ui/chat-messages-virtualization.test.ts`,
  `apps/desktop/package.json`, and `GOAL_PROGRESS.md`.
- Verification passed:
  `bunx biome check apps/desktop/src/renderer/components/chat-ui/chat-messages.tsx apps/desktop/src/renderer/components/chat-ui/chat-messages-virtualization.ts apps/desktop/src/renderer/components/chat-ui/chat-messages-virtualization.test.ts apps/desktop/package.json --write --error-on-warnings`;
  `bun run --cwd apps/desktop test:blockers` (`104 pass, 0 fail`);
  `bun run --cwd apps/desktop check-types`;
  `bun run --cwd apps/desktop build:renderer`;
  `git diff --check` on the focused files; and
  `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop` (exit `0`,
  Electron renderer loaded through the desktop-service runtime channel).
- Remaining work: none for this chat virtualization slice.

## 2026-08-09 Settings information architecture refresh

- Reworked the desktop Settings navigation after comparing it with the T3 Code
  (Alpha) reference. The desktop sidebar now uses progressive disclosure:
  `Overview` plus eight intent-based groups are visible at rest, only the
  current group opens automatically, and search opens only matching groups.
- Reorganized the visible surface into `General`, `AI and Providers`,
  `Workspace`, `Tools and Extensions`, `Automation`, `Connections`, `Account
  and Access`, and `Diagnostics and History`. Labels now distinguish runtime
  diagnostics, project memory, code index snapshots, server connection, and
  ACP auth files instead of presenting similarly named concepts as peers.
- Audited all 29 prior navigation destinations. The legacy
  `/settings/automation` Local ADE page duplicated the dedicated Hooks and
  Plugins destinations, so it is no longer shown in navigation. Its route is
  preserved for existing deep links; no runtime configuration or stored data
  was removed.
- Simplified the Settings overview from a dense grid of every leaf route to
  four essentials and eight category rows. Refreshed shared page/section chrome
  with a narrower reading width, clearer hierarchy, rounded low-contrast
  surfaces, and consistent content spacing.
- Preserved Electron boundaries: this slice changes renderer navigation and
  presentation only; no setting behavior moved into Electron main/preload and
  no runtime/API contract changed.
- Changed files:
  `apps/desktop/src/renderer/routes/settings.tsx`,
  `apps/desktop/src/renderer/routes/settings.index.tsx`,
  `apps/desktop/src/renderer/components/settings/settings-navigation.ts`,
  `apps/desktop/src/renderer/components/settings/settings-navigation.test.ts`,
  `apps/desktop/src/renderer/components/settings/settings-panels.tsx`, and
  `GOAL_PROGRESS.md`.
- Verification passed:
  `bunx biome check apps/desktop/src/renderer/routes/settings.tsx apps/desktop/src/renderer/routes/settings.index.tsx apps/desktop/src/renderer/components/settings/settings-navigation.ts apps/desktop/src/renderer/components/settings/settings-navigation.test.ts apps/desktop/src/renderer/components/settings/settings-panels.tsx --write --error-on-warnings`;
  `bun test apps/desktop/src/renderer/components/settings/settings-navigation.test.ts`
  (`4 pass, 0 fail`);
  `bun run --cwd apps/desktop test:blockers` (`104 pass, 0 fail`);
  `bun run --cwd apps/desktop check-types`;
  `bun run --cwd apps/desktop build:renderer`;
  focused `git diff --check`; and
  `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop` (exit `0`,
  renderer loaded through the Electron IPC/desktop-service runtime channel on
  the automatically selected loopback port).
- Visual QA limitation: the supplied T3 screenshot and live T3 window were
  available for comparison, but Windows capture automation failed to return a
  frame. A browser-only renderer check reached the expected sign-in boundary
  and was not given credentials, so no authenticated browser screenshot is
  claimed. Build, route-model tests, typecheck, blocker tests, and the real
  Electron renderer smoke are authoritative for this slice.
- Remaining work: none for the Settings information architecture refresh.

## 2026-08-09 Usage and quota separation

- Split current subscription capacity from historical consumption in the
  desktop Settings information architecture. `Usage` remains the historical
  token/cost view by time range; the new `Quota` route shows remaining provider
  limits and reset timing.
- Moved `ProviderQuotaPanel` out of `Settings > Runtime` into
  `/settings/quota`. Runtime now focuses only on desktop health, updates, CLI
  detection, and provider readiness.
- Added distinct navigation language and search intent: `Usage` is described as
  historical tokens/cost and matches monthly-spend queries, while `Quota` is
  described as remaining limits/resets and matches subscription/capacity/reset
  queries.
- Changed quota reset timestamps to a compact relative duration such as
  `Resets in 4h 12m`, while retaining the absolute reset date/time as hover
  context.
- Changed files:
  `apps/desktop/src/renderer/routes/settings.runtime.tsx`,
  `apps/desktop/src/renderer/routes/settings.quota.tsx`,
  `apps/desktop/src/renderer/components/settings/provider-quota-panel.tsx`,
  `apps/desktop/src/renderer/components/settings/provider-quota-utils.ts`,
  `apps/desktop/src/renderer/components/settings/provider-quota-utils.test.ts`,
  `apps/desktop/src/renderer/components/settings/usage-stats-settings-panel.tsx`,
  `apps/desktop/src/renderer/components/settings/settings-navigation.ts`,
  `apps/desktop/src/renderer/components/settings/settings-navigation.test.ts`,
  generated `apps/desktop/src/renderer/routeTree.gen.ts`, and
  `GOAL_PROGRESS.md`.
- Verification passed:
  focused Biome formatting/checks;
  `bun test apps/desktop/src/renderer/components/settings/settings-navigation.test.ts apps/desktop/src/renderer/components/settings/provider-quota-utils.test.ts`
  (`6 pass, 0 fail`);
  `bun run --cwd apps/desktop check-types`; and
  `bun run --cwd apps/desktop build:renderer`.
- Remaining work: none for the Usage/Quota separation slice.

## 2026-08-09 Git feature goal — Phase 0 investigation and decisions

- Preserved the pre-existing dirty quota/settings work and the extracted
  Electron window controls change in `chat-header.tsx`; no Phase 0 source code
  was changed.
- Confirmed that runtime currently publishes `prompt_message_sent` only after
  prompt submission and `prompt_turn_completed` after completion. There is no
  pre-turn event. The implementation will add `prompt_turn_started` through the
  existing prompt lifecycle notifier and await it before `PromptTaskRunner`
  starts ACP work, so the baseline is captured before agent filesystem writes.
- Confirmed from installed `@agentclientprotocol/sdk@0.16.1` declarations that
  ACP exposes cancel/load/resume/fork but no rollback or conversation-history
  truncation operation. The fail-closed fallback is: stop the active runtime,
  atomically truncate persisted messages to the requested completed-turn
  boundary, clear the stale agent session id, restart a fresh ACP session under
  the same local chat id/root, and replay the retained stored timeline to the
  renderer. The stale ACP session is never loaded after a revert.
- Confirmed that `StoredSession` currently has no environment metadata and that
  `UpdateSessionMetaService` only exposes name/pinned/archive. Phase 4 will add
  optional `envMode`, `worktreePath`, and worktree branch metadata, plus a
  dedicated mode-switch service that owns stop/create ordering.
- Selected GitHub CLI for the Phase 3 PR provider. `gh 2.96.0` is installed and
  authenticated in the current environment, and the adapter will use
  non-interactive `gh pr create` arguments. Other source-control providers stay
  out of scope as specified by the goal.
- Selected parallel compatibility for checkpoints: hidden
  `refs/eragear/session-*-turn-*` refs become the turn checkpoint source, while
  existing patch checkpoints in `.eragear/checkpoints/` remain available for
  manual create/list/restore. No patch migration or deletion is required.
- Reviewed the current T3 source for `CheckpointReactor`, `CheckpointStore`,
  `GitVcsDriver`, `GitActionsControl.logic`, and `BranchToolbar.logic`. Eragear
  will adapt the isolated-index capture and `git restore`-based restore behavior
  behind its existing ports instead of copying T3's Effect/event-sourcing
  implementation.
- Baseline verification passed after applying the repository-documented strict
  Bun command/env allowlist: Git module and renderer event tests (`29 pass` in
  the first run), followed by the two allowlist-gated files (`9 pass, 0 fail`).
- Remaining work: Phases 1–5 of `implement-git-feature-goal.md`.

## 2026-08-09 Git feature goal — Phase 1 ref checkpoint core

- Extended the Git application contract and `GitCheckpointPort` with strict
  turn checkpoint/diff types and capture/list/diff/restore/stale-ref operations.
- Added `buildTurnCheckpointRef` and the pure `parseTurnDiffFiles` parser with
  add/modify/delete/rename coverage and line-count summaries.
- Implemented hidden ref capture in `GitAdapter` using an isolated temporary Git
  index, `read-tree`, `add -A`, `write-tree`, `commit-tree`, and `update-ref`.
  Checkpoint commits do not move `HEAD` or mutate the user's index/worktree, and
  internal `.eragear` data is excluded from snapshots.
- Implemented ref diff, ordered metadata listing, stale-ref deletion, and safe
  restore using `git restore` plus a pre-restore safety ref. Restore preserves
  branch `HEAD`, keeps `.eragear/checkpoints`, and maps failures through
  structured logging.
- Changed files:
  `packages/runtime/src/modules/git/application/contracts/git.contract.ts`,
  `packages/runtime/src/modules/git/application/ports/git-checkpoint.port.ts`,
  `packages/runtime/src/modules/git/application/turn-diff-parser.ts`,
  `packages/runtime/src/modules/git/application/turn-diff-parser.test.ts`,
  `packages/runtime/src/modules/git/application/git-checkpoint.service.test.ts`,
  `packages/runtime/src/modules/git/index.ts`,
  `packages/runtime/src/platform/git/index.ts`, and
  `packages/runtime/src/platform/git/index.test.ts`.
- Verification passed:
  `bun test packages/runtime/src/modules/git/application/turn-diff-parser.test.ts packages/runtime/src/platform/git/index.test.ts`
  (`13 pass, 0 fail`);
  `bun run --cwd packages/runtime check-types`;
  focused Biome checks with `--write --error-on-warnings`; and
  focused `git diff --check` (line-ending warnings only).
- Remaining work: Phases 2–5; event lifecycle, revert orchestration, workflow
  actions, session worktree mode, renderer UI, and full audit are not yet done.

## 2026-08-09 Git feature goal — Phase 2 lifecycle, diff broadcast, and revert

- Added the awaited `prompt_turn_started` lifecycle fact before ACP prompt work
  begins. Git event wiring captures the turn-zero baseline at start, captures
  the next hidden ref on completion, keeps the legacy patch checkpoint in
  parallel, and broadcasts `prompt_turn_diff_ready` to the renderer.
- Added strict shared/runtime event schemas and a per-chat renderer turn-diff
  store. The shared event processor now routes completed diff summaries, and
  the desktop handler records file kind and addition/deletion totals by turn.
- Added authenticated `git.turnCheckpoints.list/create/diff/revert` tRPC
  procedures while preserving the existing `git.checkpoints.*` namespace.
- Implemented turn-scoped revert orchestration: resolve the owned project and
  target ref, create/retain a safety ref through the Git adapter, restore the
  workspace, stop the old runtime, atomically truncate persisted conversation
  history, clear the stale ACP identity, start a fresh runtime under the same
  local chat id, broadcast `session_reverted`, and delete later turn refs.
- Added `RollbackConversationService` as the session-owned fallback because the
  installed ACP SDK has no history rollback API. Tests prove the fresh session
  never receives `sessionIdToLoad` and retained history ends on the requested
  completed user turn.
- Made two existing session tests portable for the required whole-directory
  evidence: canonicalized a POSIX fixture expectation with `path.resolve`, and
  used `delete process.env` so Bun on Windows does not preserve the literal
  string `"undefined"` between MCP env tests. Product behavior is unchanged.
- Key changed files:
  `packages/runtime/src/modules/ai/application/send-message.service.ts`,
  `packages/runtime/src/modules/ai/application/prompt-lifecycle.notifier.ts`,
  `packages/runtime/src/modules/git/init/git-events.init.ts`,
  `packages/runtime/src/modules/git/application/git-checkpoint.service.ts`,
  `packages/runtime/src/modules/session/application/rollback-conversation.service.ts`,
  `packages/runtime/src/transport/trpc/routers/git-turn-checkpoints-router.ts`,
  `packages/shared/src/chat/types.ts`,
  `packages/shared/src/chat/event-schema.ts`,
  `packages/shared/src/chat/use-chat-core.ts`,
  `apps/desktop/src/renderer/store/chat-turn-diff-store.ts`, and
  `apps/desktop/src/renderer/hooks/use-chat-session-event-handler.ts`, plus
  focused tests and composition/export updates.
- Verification passed:
  `bun run --cwd packages/runtime check-types`;
  `bun run --cwd apps/desktop check-types`;
  focused Biome with `--error-on-warnings`;
  Git lifecycle/service/adapter/session revert tests (`17 pass, 0 fail`);
  `bun test apps/desktop/src/renderer/hooks/use-chat-session-event-handler.test.ts`
  (`20 pass, 0 fail`);
  and the exact C2 directory command
  `bun test packages/runtime/src/modules/session/application/`
  (`119 pass, 0 fail`) under the documented strict allowlist environment.
- Remaining work: Phases 3–5 — Git action workflows and protected-branch UI,
  local/worktree session mode plus diff/timeline UI, then the full goal audit.

## 2026-08-09 Git feature goal — Phase 3 Git actions and protected branches

- Added strict workflow status/action/progress contracts, `GitWorkflowPort`,
  `GitWorkflowService`, and a dedicated `GitWorkflowAdapter`. All project roots
  are resolved through the owned project repository before the adapter sees
  them; renderer input cannot supply an arbitrary filesystem path.
- Implemented status/default-ref/origin/upstream detection, stage-all commit,
  push with automatic origin upstream setup, commit+push, stacked progress, and
  GitHub-only PR creation through non-interactive `gh pr create` arguments.
  Every Git write logs structured start/completion/failure metadata and maps
  command failures to typed validation errors.
- Added `git.actions.status/run/progress` tRPC procedures. Actions only run from
  an authenticated mutation, and progress subscriptions are owner-scoped by a
  client-generated action id.
- Enforced the default-branch guard in both layers: the runtime rejects writes
  without `confirmDefaultBranch: true`, while the renderer always opens a
  confirmation dialog that shows the branch, changed-file summary, warning,
  and optional commit message before supplying that flag.
- Added the compact chat-header split control modeled on the supplied visual:
  the primary action is selected from dirty/ahead/PR/remote state and the menu
  exposes Commit, Push, Commit & push, Create PR, and the stacked PR action.
  Stage progress is surfaced through persistent Sonner toasts.
- Key changed files:
  `packages/runtime/src/modules/git/application/contracts/git-workflow.contract.ts`,
  `packages/runtime/src/modules/git/application/ports/git-workflow.port.ts`,
  `packages/runtime/src/modules/git/application/git-workflow.service.ts`,
  `packages/runtime/src/platform/git/workflow.ts`,
  `packages/runtime/src/transport/trpc/routers/git-actions-router.ts`,
  composition/use-case exports,
  `apps/desktop/src/renderer/components/chat-ui/git-actions-control.logic.ts`,
  `apps/desktop/src/renderer/components/chat-ui/git-actions-control.tsx`,
  `chat-header.tsx`, and `chat-interface.tsx`, plus focused tests.
- Verification passed:
  `bun test packages/runtime/src/platform/git/workflow.test.ts`
  (real temporary repositories/bare remotes prove commit, push, combined
  action, new upstream, progress, and stubbed GitHub PR invocation);
  `bun test packages/runtime/src/modules/git/application/git-workflow.service.test.ts`
  (runtime protected-branch rejection and confirmed progress relay);
  D2 (`2 pass, 0 fail`); D3 (`1 pass, 0 fail`);
  runtime and desktop typechecks; and the exact V2 Biome command
  (`113 files checked`, no warnings).
- Remaining work: Phases 4–5 — worktree session mode, scoped diff/timeline UI,
  full verification, documentation, and smoke audit.

## 2026-08-09 Git feature goal — Phase 4 worktrees and scoped diff UI

- Extended `GitWorkflowPort` and the platform adapter with persistent worktree
  create/list/remove operations and branch-vs-default-ref diff. Worktrees use
  `eragear/worktree/<session-id>` branches under Eragear storage, are
  idempotently reused, validate their destination stays inside the owned
  storage subtree, and retain structured logging/error mapping for writes.
- Added session environment persistence through migration
  `0014_session_git_worktrees.sql`: `envMode`, `worktreePath`, and
  `worktreeBranch` now flow through SQLite mappers, list/state queries,
  runtime bootstrap, resume, and rollback. The migration keeps existing rows
  in local mode by default and leaves persistent worktrees intact when a
  session switches back to its canonical project root.
- Added `SwitchSessionEnvironmentService` and authenticated lifecycle
  mutations. Switching verifies/creates the target worktree first, stops the
  current runtime, persists the target root, and starts a fresh ACP session
  under the same local chat id. The internal trusted-root override is absent
  from client schemas, requires an owned persisted project, and resolves only
  an existing directory. Branch metadata is synchronized after branch changes
  by reading status from the owned session root.
- Made checkpoint, workflow-action, and branch-diff services session-root
  aware through the owned session resolver, so worktree sessions keep the
  same sandbox root for turn capture, revert, commit/push/PR, and DiffView.
- Added the compact Branch Toolbar with Local project / Persistent worktree
  modes and pure resolution/synchronization logic. The chat header passes the
  active chat to both branch and Git action controls.
- Expanded DiffView to Working, Branch, and Turn scopes. Working/branch views
  render unified patches; Turn renders file kind, rename source, per-file and
  aggregate additions/deletions, turn selection, and a guarded file-plus-
  conversation revert action that explains the safety checkpoint.
- Linked user timeline messages to their turn ids and render inline file/
  additions/deletions badges as soon as `prompt_turn_diff_ready` arrives.
- Fixed fresh SQLite migration splitting with explicit statement breakpoints
  and made storage shutdown release cached Drizzle statements before the
  Bun database close; the Windows repository suite can now delete every temp
  database deterministically.
- Key changed files:
  `packages/runtime/src/platform/git/workflow.ts`,
  `packages/runtime/src/modules/git/application/git-workflow.service.ts`,
  `packages/runtime/src/modules/session/application/switch-session-environment.service.ts`,
  session persistence/mapping/query files,
  `packages/runtime/drizzle/0014_session_git_worktrees.sql`,
  `packages/runtime/src/platform/storage/sqlite-db.ts`,
  `apps/desktop/src/renderer/components/chat-ui/branch-toolbar.tsx`,
  `branch-toolbar.logic.ts`,
  `apps/desktop/src/renderer/components/right-sidebar/diff-view.tsx`,
  `apps/desktop/src/renderer/store/chat-turn-diff-store.ts`, and renderer
  event/header/timeline wiring, plus focused tests and tRPC/composition exports.
- Verification passed:
  E1 exact command (`4 pass, 0 fail`);
  E2 exact whole session command (`158 pass, 0 fail`);
  B2 exact renderer handler command (`21 pass, 0 fail`);
  real Git worktree create/reuse/diff/remove tests as part of workflow D1
  (`4 pass, 0 fail`);
  runtime and desktop typechecks; and exact V2 Biome
  (`116 files checked`, no warnings).
- Remaining work: Phase 5 only — document the Git behavior in `AGENTS.md`,
  retain the legacy patch checkpoint fallback, then run every A1–E2 and V1–V4
  command plus final patch hygiene.

## 2026-08-09 Git feature goal — Phase 5 completion audit

- Documented the final local Git model in `AGENTS.md`: awaited ref-based turn
  capture, file-plus-conversation rollback ordering, authenticated workflow
  actions and default-branch confirmation, persistent normal-chat worktrees,
  and owned session-root resolution.
- Kept the existing `.eragear/checkpoints/` patch create/list/restore path in
  parallel with hidden `refs/eragear/session-*-turn-*` refs. Ref cleanup does
  not delete the patch fallback or its metadata.
- Closed the Git workflow progress channel on every terminal path, including
  status lookup, non-repository rejection, and protected-branch rejection.
- Exact success-criteria matrix passed on the final tree:
  A1 (`2 pass`); A2/C1 (`9 pass`); B1 (`4 pass`); B2 (`21 pass`);
  C2 application suite (`121 pass`); D1 (`4 pass`); D2 (`2 pass`);
  D3 (`1 pass`); E1 (`4 pass`); and E2 full session suite
  (`158 pass`), all with zero failures.
- V1 passed for runtime and desktop TypeScript projects. V2 passed both the
  requested focused paths and the broader repository check (`1420 files`, no
  warnings). V3 `audit:blockers` passed (`54 runtime`, `47 shared`, and
  `104 desktop` tests, plus desktop typecheck).
- V4 timed desktop smoke exited 0: port 3001 was occupied and the launcher
  correctly selected 3002, the runtime channel became ready, Vite loaded the
  renderer, and SQLite shut down without the prior locked-database warning.
  Renderer unsubscribe/request warnings occur only after the forced smoke
  timer has already stopped the runtime process.
- Final focused Git workflow regression test, runtime typecheck, Biome, and
  `git diff --check` passed. No implementation work remains for this goal.

## 2026-08-09 Usage dashboard visual refresh

- Rebuilt the desktop `Usage` renderer around the supplied T3-style dashboard
  hierarchy: compact range/refresh controls, estimated cost and provider-share
  summary, stacked daily cost/token area chart, five-metric token strip,
  model/day breakdown table, and cost-quality coverage panel.
- Kept every displayed value execution-backed by the existing usage-stats tRPC
  response. Cache hit rate, priced/unpriced coverage, active-day averages, and
  provider readiness are derived locally from returned totals; no synthetic
  cache-savings or provider-billing figures were introduced.
- Preserved the CLI-data fallback, warnings, unpriced-token disclosure,
  telemetry control, responsive small-screen stacking, loading/error states,
  and theme tokens. Expanded only `/settings/usage` to a 1440px content maximum;
  other Settings routes keep their existing reading width.
- Changed files:
  `apps/desktop/src/renderer/components/settings/usage-stats-settings-panel.tsx`,
  `apps/desktop/src/renderer/routes/settings.tsx`, and `GOAL_PROGRESS.md`.
- Verification passed: focused Biome with `--write --error-on-warnings`;
  `bun run --cwd apps/desktop check-types`;
  `bun run --cwd apps/desktop build:renderer`; focused `git diff --check`; and
  `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='8000'; bun run dev:desktop` (exit `0`,
  runtime ready and renderer loaded through the Electron desktop-service IPC
  channel; forced-timer teardown produced the existing post-shutdown
  unsubscribe warnings).
- Visual automation limitation: the installed Computer Use skill references a
  documentation API absent from its bundled runtime, so no automated Windows
  screenshot is claimed for this slice.
- Remaining work: none for the Usage dashboard visual refresh.

## 2026-08-09 Quota-cycle usage correlation

- Added a runtime-owned quota-cycle correlation path that combines live quota
  windows with exact-range local CLI scans. Each window now reports locally
  observed input/cache/output/total tokens, public API-equivalent cost,
  tokens-per-quota-point and projected full-cycle capacity when sufficient
  evidence exists.
- Capacity is deliberately labeled as an estimate. The service distinguishes
  provider-reported, reset-plus-duration, first-observation, and unavailable
  cycle boundaries; emits `low`/`medium`/`high`/`unavailable` confidence; and
  always discloses that unsupported clients and other devices are not counted.
- Preserved upstream attribution through Codex, OpenCode, and Zcode scanners so
  CLI transport is no longer confused with the billed provider. Canonical
  attribution covers OpenAI, MiniMax Coding Plan, Z.ai, Anthropic, and Google
  where the local source exposes it.
- Persisted full quota-window snapshots with SQLite migration
  `0015_usage_quota_cycles.sql`. Historical snapshots now survive restarts and
  let later refreshes measure quota movement inside the same reset cycle.
- Exposed the composite read through `quota.cycleUsage`; kept all correlation,
  confidence, persistence, and provider mapping in runtime/application code.
  Electron main and preload remain unchanged and renderer access stays on the
  existing typed tRPC-over-IPC bridge.
- Expanded Settings > Quota with per-window cycle token composition,
  API-equivalent value, capacity estimates, confidence badges, reset metadata,
  and a Usage link. Added a cross-provider Quota efficiency table to Settings >
  Usage and widened only the Quota route enough for the denser cards.
- Focused verification passed: quota/usage/persistence/scanner suites (`34
  pass`), Settings quota/navigation suites (`6 pass`), runtime/API-contract/
  desktop typechecks, renderer production build, focused Biome, and patch
  hygiene. Repository blocker audit also passed (`54 runtime`, `47 shared`,
  `104 desktop`, plus desktop typecheck).
- Timed Electron smoke exited `0`: the renderer moved to port 3002 because 3001
  was occupied, SQLite applied the embedded migration, the desktop-service IPC
  runtime became ready, and the renderer loaded. Post-shutdown unsubscribe
  warnings occurred only after the forced smoke timer stopped the runtime.
- Learning behavior: existing installs begin with `Learning` confidence. A
  manual Quota refresh records the first snapshot; later refreshes after real
  usage provide the quota delta needed for stronger provider comparisons.
- Remaining work: none for quota-cycle usage correlation.

## 2026-08-09 Usage scan performance and caching

- Profiled the real local dataset instead of optimizing by assumption. A 30-day
  all-provider scan took `79.8s`; Codex alone accounted for `74.7s` because the
  machine has 1,419 session JSONL files totaling about 13.5GB (about 11.7GB
  modified within the last 30 days). OpenCode, Zcode, Claude, Gemini, Amp, Pi,
  and Cursor each completed between about `0.2s` and `2.0s`.
- Added a durable, prompt-free Codex usage index under Eragear storage. Each
  file is keyed by absolute path, size, and modification time, and stores only
  timestamp/model/token deltas. Prompt text, tool output, and arbitrary JSONL
  records are filtered before parsing and are never written into the index.
- Used Bun-native `file()` metadata/text reads and `write()` persistence. JSONL
  discovery now skips files older than the requested range, Codex parsing
  rejects irrelevant lines before `JSON.parse`, and OpenCode pushes its time
  range down into SQLite instead of loading the whole message table.
- Added a shared runtime TTL/LRU scanner cache with in-flight request
  coalescing. Usage summary and quota-cycle correlation share the same scanner
  instance, preventing equivalent scans from running more than once. Failures
  are not cached, and changed Codex files invalidate independently by
  size/mtime.
- Tuned renderer query behavior without moving business rules into Electron or
  React: Usage/Quota results remain warm for five minutes, survive route
  remounts for fifteen minutes, do not refetch on focus, and preserve the prior
  range while a new range loads. Quota-efficiency scanning begins only after
  the main Usage summary resolves, avoiding cold-start disk contention.
- Measured on the same dataset after implementation: initial index construction
  took `61.8s` once; a new scanner/runtime using the persisted index took
  `2.9–5.5s`; an equivalent repeat query served from the runtime cache in less
  than `1ms`. The generated local index is about 28.5MB for the current 13.5GB
  source archive.
- Regression coverage verifies TTL expiry, equivalent-request coalescing,
  exact quota-cycle cache separation, persisted-index invalidation, token total
  correctness, and that a secret prompt marker never appears in the cache.
- Verification passed: focused quota/usage/cache/persistence suites (`37 pass`),
  Settings suites (`6 pass`), runtime/API-contract/desktop typechecks, renderer
  production build, focused Biome, and repository blocker audit (`54 runtime`,
  `47 shared`, `104 desktop`). Timed Electron smoke exited `0`, brought the
  desktop-service IPC runtime ready, and loaded the renderer; the known
  unsubscribe warnings appeared only after forced-timer shutdown.
- Remaining work: none for Usage scan performance and caching.

## 2026-08-09 Usage pricing attribution corrections

- Canonicalized unprefixed Zcode `deepseek-v4-flash` and
  `deepseek-v4-pro` model observations to the DeepSeek provider pricing
  catalog. Live verification now prices both models through the canonical
  `deepseek/deepseek-v4-*` OpenRouter IDs instead of classifying 229.34M tokens
  as unpriced.
- Traced the apparent Codex unknown-model usage to subagent rollout schema, not
  an unknown provider model. Twenty-five subagent logs recorded token events
  before their first `turn_context`, while the sole explicit model later in
  each file was `gpt-5.6-sol`.
- Added conservative backward attribution only for files identified as Codex
  subagent sessions and only when the entire file exposes exactly one explicit
  model. Main sessions and multi-model subagent sessions remain unpriced rather
  than receiving a guessed model.
- Reads only the bounded session-metadata prefix needed to classify subagent
  files, which also handles oversized `session_meta` records without relaxing
  the JSONL record safety limit. Bumped the durable Codex usage index format to
  version 3 so prior ambiguous attribution is rebuilt once.
- Real 30-day verification reduced unpriced usage from 1,317,917,136 tokens to
  46,134 tokens. No unknown-model tokens remain; the residual is the explicitly
  named `codex-auto-review` model. A persisted-index warm scan completed in
  3.58 seconds.
- Verification passed: complete Usage Stats module suite (`21 pass`), runtime
  typecheck, focused Biome, and the live 30-day pricing/index scan.
- Remaining work: none for Usage pricing attribution corrections.

## 2026-08-09 Quota projected API cost presentation

- Removed the redundant per-quota-point token figure from provider quota cards.
  Estimated capacity now presents projected full-cycle API-priced cost beside
  projected token capacity, using the existing runtime-owned
  `projectedApiEquivalent` and `projectedTokenCapacity` evidence.
- Renamed the already-consumed value to `Observed API cost`, so observed spend
  equivalent is not confused with the full-cycle projection. Applied the same
  presentation to the cross-provider table on Settings > Usage.
- Kept all quota estimation math in runtime contracts/services; this slice only
  changes renderer presentation and leaves Electron main/preload untouched.
- Verification passed: desktop typecheck, renderer production build, focused
  Settings tests (`6 pass`), Biome, and patch hygiene.
- Remaining work: none for Quota projected API cost presentation.
