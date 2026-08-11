# Supervisos Manager Mode v2

## Objective

Turn Supervisos into the durable engineering-management control plane for the
complete development lifecycle:

```text
idea/spec -> sticky ACP manager plan -> one approval -> ACP workers
-> review/test/fix -> quota wait + exact resume -> aggregate verification
-> one scoped commit -> completion report
```

The user supplies the goal, constraints, and source material; approves the
initial plan; answers genuine exceptions; and reviews the final result. Every
AI judgment made by Supervisos (chat, planning, replanning, scheduled-work
decisions, and completion synthesis) must run through ACP. Provider quota APIs
are telemetry only and must never be an alternate prompt path.

Business rules remain in `packages/runtime`. Electron main/preload own only
native lifecycle, daemon control, credential integration, and a narrow
`contextBridge` surface with `contextIsolation: true` and renderer Node
integration disabled.

## Product contract

### Manager session and planning

- Every goal has one sticky ACP manager chat/session/agent binding.
- The manager process may stop while idle, but the ACP session must be resumed
  with `exactOnly`; creating a replacement session is forbidden.
- Manager sessions are read-only. Runtime application services alone dispatch
  workers, authorize transitions, integrate patches, and commit.
- Manager context is bounded and redacted, using Project Index, Scope
  Resolution, Memory, trusted MCP, and repository summaries.
- Structured manager turns use strict schemas for `plan`, `replan`,
  `question`, `continue`, and `complete`.
- Plans contain a DAG, file/command envelope, verification, risks, current
  branch/ref, delivery authorization, a monotonically increasing version, and
  a deterministic hash.
- Approval requires `planVersion`, `planHash`, and `expectedRevision`. It locks
  the execution envelope and authorizes exactly one final commit on the shown
  current branch, including the default branch when explicitly shown.
- Replans inside the approved goal, file/command envelope, permissions, success
  criteria, and delivery policy are automatic. Scope expansion, destructive
  action, or changed success criteria create a durable user decision.
- Side-chat implementation requests create Goal Drafts. They never stage a
  prompt into the main ChatInput.

### Agents, scheduling, and capacity

- `SupervisorAgentProfile` extends configured Agents with `enabled`, manager
  and worker roles, `maxConcurrentSessions` (default 1), optional quota
  telemetry/capacity-group binding, and readiness evidence.
- Initial classified profiles cover Codex, Claude, Gemini, and OpenCode.
  Custom agents use a generic classifier and fail closed if exact resume cannot
  be proven.
- Overnight dispatch requires a recent ACP handshake and exact-resume test.
- The global scheduler uses weighted fairness: urgent 8, high 4, normal 2,
  low 1. Every runnable run gets at most one dispatch per round before
  additional weight is consumed.
- Read-only work may run across projects. Write integration is serialized per
  project.
- Unstarted work may be rerouted. Once an attempt has an assignment, quota
  suspension preserves the same `agentId`, `chatId`, ACP session id,
  `attemptId`, and worktree.
- Quota signals reuse the existing snapshot/reset/cache/refresh/backoff/dedupe/
  cooldown/lease subsystem. They only advise dispatch admission.
- ACP errors, JSON-RPC metadata, bounded redacted stderr, and assistant failure
  output are classified as `quota_exhausted`, `transient_rate_limit`,
  `auth_required`, `transport`, `session_fatal`, or `unknown`.
- With an ETA, retry at `resetAt` plus bounded deterministic jitter. Without an
  ETA use 1, 5, 15, and 30 minutes, then at most hourly.
- Capacity exhaustion publishes a typed suspension event, stops the process,
  releases the agent slot, and leaves the same attempt/worktree resumable.
  Suspension does not consume an attempt.
- Resume is always `exactOnly`; failure creates a Manager Inbox decision and
  never falls back to a new ACP session.

### Durable run v2

- Terminal v1 runs remain readable. Non-terminal v1 runs migrate to
  `needs_user` and require ACP-manager replanning; they do not auto-resume.
- Run statuses add `awaiting_approval` and `waiting_capacity`; task and attempt
  statuses add `waiting_capacity`.
- State persists manager session reference, plan version/hash/envelope,
  priority, capacity waits, decision ids, target branch/ref, delivery
  authorization, and final commit SHA.
- There is no overall calendar/active run deadline. Per-turn timeouts,
  task/attempt/replan caps, and loop detection remain bounded.
- `SupervisorRunState` remains separate from per-session
  `SupervisorSessionState` and Goal Mode state.
- Goal Mode remains the source of deterministic gate/evidence behavior, not a
  competing run aggregate.

### Public API and inbox

`supervisorRuns` exposes:

- `createDraft` (`start` is a one-version compatibility alias)
- `approvePlan`, `requestPlanChanges`, `answerDecision`, `setPriority`
- `get`, `list`, `pause`, `resume`, `cancel`, `retryTask`, and update stream

Draft input accepts only `projectId`, intent, constraints, priority, and an
optional agent allowlist. Runtime resolves the owned project root.
`providerId` and `workerModelId` are not run authority.

Agent profile APIs expose `list`, `upsert`, and `testResume`. A durable Manager
Inbox exposes list/subscription and idempotent answers. Bots and Scheduled
Tasks call the Goal API. Quota refresh wakes existing capacity waits and never
creates duplicate runs.

### Git delivery and safety

After the full DAG and aggregate verification pass, create exactly one commit
on the approved current branch:

1. Revalidate branch, HEAD, approved fingerprints, dirty overlap, and union of
   run-owned files.
2. Create a safety ref.
3. Use an isolated Git index to stage only the run-owned union, excluding all
   pre-existing user staged/unstaged changes.
4. Run normal Git hooks; never pass `--no-verify`.
5. Record the final commit SHA.

If branch/HEAD changed after approval, integration becomes `needs_user`.
Supervisos never pushes, opens a PR, deploys, switches branch, resets, stashes,
or auto-reverts failed/cancelled work. Plan approval only grants the explicit
file/command/delivery envelope; project-root sandboxing, allowlists, and
permission gates remain authoritative and may still veto execution.

### Daemon, Telegram, power, and Mission Control

- Runtime operates as a loopback single-instance per-user daemon with an
  endpoint manifest and per-user token protected by OS ACLs. The renderer never
  receives that token.
- Windows installs a hidden Task Scheduler user job. Linux installs a
  `systemd --user` unit with optional linger. macOS `launchd` is deferred.
- Electron main/preload expose only daemon install/start/stop/status and the
  existing typed runtime bridge. Closing Desktop or locking the screen does not
  stop runs.
- Telegram uses outbound HTTPS long polling, encrypted credential storage,
  one-time pairing, opaque idempotent decision tokens, and replay protection.
  Free-form replies are accepted only for one open decision and are never shell
  commands.
- Blocker/completion messages are immediate. A changed/non-terminal portfolio
  digest is sent at 09:00 in the user's timezone.
- Power policy keeps the machine awake on AC while runnable prompt or
  verification work exists. If every run waits for capacity longer than 30
  minutes it releases the inhibitor and uses a wake timer where supported.
- Mission Control is the global portfolio UI for goals, approvals, capacity,
  decisions, readiness, DAG/evidence, and final commit. Chat Runs is a
  projection/deep link.

## Implementation order

1. Schema v2, migration, exact-only resume, plan hash/envelope, and typed
   capacity events.
2. ACP Manager Session Coordinator, approval/inbox flow, and removal of all
   active MiniMax/AI-SDK Supervisor model calls.
3. Agent Profiles, weighted global scheduler, and quota/Bots wake integration.
4. Windows/Linux daemon, Mission Control, Telegram, power lease, and final
   scoped commit.
5. Live ACP smoke, then delete compatibility adapters/settings after their
   compatibility window.

Update `GOAL_PROGRESS.md` after every major phase with changed files, exact
commands, results, and remaining work.

## Verification and acceptance

- Unit coverage: ACP error classification/redaction, ETA/backoff, deterministic
  plan hash/envelope, v1 migration, weighted fairness/capacity groups, Telegram
  replay protection, and path-scoped commit.
- Integration: quota between turns stops a process; restart restores the same
  session/attempt/worktree with exact resume and completes.
- Manager planning/replan quota waits never create a new manager session.
- Multiple projects/agents continue when one run is quota blocked; same-project
  write integration never overlaps.
- Final commit excludes every pre-existing dirty/staged change, allows an
  approved default branch, and fails closed on branch/HEAD/drift/conflict.
- Desktop closure does not stop the daemon; reconnect restores portfolio and
  subscriptions.
- Telegram E2E covers approve, changes, question answer, pause/resume/cancel,
  completion, and digest.
- Existing blocker, Goal Mode, orchestration, quota, session, and desktop tests
  remain green.
- Audit active Supervisor paths: no `generateText`, direct provider model call,
  or MiniMax model wiring remains.
- Final smoke: create in Desktop, approve via Telegram, close Desktop, hit
  quota, exact-resume the same ACP session after refresh, aggregate verification
  passes, one current-branch commit is created, and completion is reported.

## Fixed scope

- Windows and Linux in v1; macOS later.
- No native Manager UI in this phase.
- No push, PR, deploy, or branch switching.
- Goals live until completion, cancellation, or a genuine blocker.
- Existing user changes in a dirty worktree must be preserved.
