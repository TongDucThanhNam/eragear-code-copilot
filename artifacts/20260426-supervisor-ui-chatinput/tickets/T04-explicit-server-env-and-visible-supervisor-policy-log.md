---
artifact_type: ticket
session_id: 20260426-supervisor-ui-chatinput
task_id: T04
producer: orchestrator
status: ACTIVE
created_at: 2026-04-26T04:30:00.000Z
source_commit: unknown
based_on:
  - artifacts/20260426-supervisor-ui-chatinput/validation/user-report-server-debug-missing.md
  - artifacts/20260426-supervisor-ui-chatinput/outputs/T03-builder-output-v2.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_server_dev_env_loading_or_logging_changes
---

# T04 - Explicitly load server .env in dev script and add visible Supervisor policy log

## Problem
User still sees `supervisorCapable=false` in browser, and server terminal does not show `[SupervisorDebug] getSessionState ...` lines. Diagnosis indicates:
- server `console.debug` is suppressed at default info log level;
- Bun implicit `.env` loading may not be reliable through `scripts/dev.ts` spawning `bun run --hot src/index.ts`;
- default `SUPERVISOR_ENABLED=false` silently produces the observed behavior.

## Scope
- Make server dev env loading explicit and reliable for `apps/server/.env`.
- Add an info-level startup log showing effective Supervisor policy values, without secrets.
- Preserve runtime behavior otherwise.

## Required changes
- In `apps/server/scripts/dev.ts`, explicitly load `.env` before spawning child processes. Use existing `dotenv` dependency if available.
- Add an info-level server startup log after runtime config/composition is available showing:
  - `supervisorEnabled`
  - whether supervisor model is configured (avoid logging full secret/API keys; model id is okay if already non-secret)
  - web search provider and memory provider if safe
- Prefer structured logger/info-level log so it appears in the same JSON terminal output as other server logs.

## Constraints
- Do not log API keys or secrets.
- Do not change Supervisor UI behavior.
- Keep changes minimal.

## Acceptance criteria
- Running `cd apps/server && bun run dev` reliably loads `apps/server/.env` into the server process.
- Server startup prints a visible info-level log with effective Supervisor policy/capability.
- User can determine if `SUPERVISOR_ENABLED=true` was loaded before opening web.
- Existing build/typecheck or targeted validation passes or unrelated failures are documented.
