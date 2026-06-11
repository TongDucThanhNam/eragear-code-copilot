# GOAL Progress - Electron ADE Overnight Sprint

Updated: 2026-06-10 23:50 UTC / 2026-06-11 06:50 Asia/Saigon

## Current Result

This run converted the previously partial ADE parity work into working Electron
flows for the required core surfaces. The app still should not be described as a
finished clone of ZCode, but the core ADE acceptance set now passes from the
Electron/private desktop-service path.

## Implemented In This Run

- MCP probe now performs protocol `initialize`, sends
  `notifications/initialized`, and calls `tools/list` plus `resources/list` for
  stdio servers. Streamable HTTP has a JSON-RPC POST discovery path. Bare SSE is
  explicitly marked unsupported for discovery without a message endpoint.
- MCP UI now shows protocol status, discovered tool/resource counts, discovered
  tool/resource names, and exact JSON-RPC protocol errors in diagnostics.
- Provider test now stores separate `cliStatus`, `authStatus`, `modelStatus`,
  `readiness`, version, and discovered model identifiers. Secrets are redacted
  by value and only env key names are displayed.
- Checkpoint restore now creates an automatic pre-restore safety checkpoint
  before applying the guarded restore. Safety checkpoints use forward patch
  application so they can re-apply the pre-restore state when safe.
- Chat subagent invocation was factored into a tested helper. Enabled subagents
  appear as `/agent-*` commands, and `/agent-code-reviewer` expands into a real
  delegated prompt path before `sendMessage`.
- Hooks/plugins remain visibly unavailable/disabled rather than presented as
  executable features.
- Desktop smoke now verifies MCP protocol discovery through the private runtime
  service with a real stdio JSON-RPC fixture, verifies provider CLI readiness,
  verifies the `code-reviewer` subagent capability is present, starts a real
  session, sends a message, observes assistant activity, and stops cleanly.

## Completion Rule Status

At least 4 of 5 required Electron flows are working end to end:

| Flow | Status | Evidence |
| --- | --- | --- |
| Real agent session create/send/stop | Pass | Desktop smoke created OpenCode session `a39aa63a-548b-4926-97a5-e1ce91e7b358`, sent a prompt, observed assistant activity, and stopped the session/host. |
| MCP initialize/tool discovery | Pass | Desktop smoke upserted `Desktop Smoke MCP`; protocol initialized and discovered `desktop_smoke_tool` plus `desktop-smoke-resource`. Unit tests cover success and JSON-RPC error surfacing. |
| Provider readiness probe | Pass | Desktop smoke classified OpenCode as `ready` with CLI/auth/model `ok`; unit tests cover ready classification and secret redaction. |
| Checkpoint create/restore flow | Pass | Unit test covers create, diff preview, wrong-token rejection, guarded restore, automatic safety checkpoint, and safety checkpoint forward restore. Electron UI exposes create/preview/confirm/restore/result. |
| Subagent manual invocation | Pass | Desktop smoke verifies `code-reviewer` subagent capability is present; web test verifies `/agent-code-reviewer` expands into the delegated prompt and disabled subagents do not invoke. |

## Verification Commands And Results

```powershell
bun test apps/server/src/modules/settings/application/local-ade.service.test.ts
```

Result: passed, 7 tests, 52 expectations.

```powershell
bun test apps/web/src/components/chat-ui/subagent-command.test.ts
```

Result: passed, 3 tests, 7 expectations.

```powershell
bun run --cwd apps/desktop check-types
```

Result: passed.

```powershell
bun run --cwd apps/desktop build:main
```

Result: passed.

```powershell
bun run --cwd apps/web build
```

Result: passed. Vite emitted the existing chunk-size and Browserslist age
warnings.

```powershell
$env:ERAGEAR_DESKTOP_SMOKE_PROMPT_WAIT_MS='12000'; bun run --cwd apps/desktop ./scripts/smoke-desktop-runtime.ts
```

Result: passed.

- Runtime endpoint: `desktop-service`, ready `true`.
- MCP protocol discovery: `available`, `initialized`,
  `desktop_smoke_tool`, `desktop-smoke-resource`.
- Provider readiness: OpenCode `ready`, CLI/auth/model `ok`, version `1.16.2`.
- Subagent capability: enabled `code-reviewer`.
- Session loop: created chat `a39aa63a-548b-4926-97a5-e1ce91e7b358`, sent one
  prompt, observed assistant activity, stopped subscription/session/host.

```powershell
$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop
```

Result: passed, exited `0`.

Additional check:

```powershell
bun run --cwd apps/server check-types
```

Result: failed on existing repo-wide type errors outside
`local-ade.service.ts`, including agent repository strictness, ACP SDK type name
changes, session config option unions, storage worker typing, and shared test
stubs. A filtered rerun showed no `local-ade` errors after the final type fix.

## Files Changed

- `.eragear/provider-health.json`
- `GOAL_PROGRESS.md`
- `apps/desktop/scripts/mcp-smoke-server.js`
- `apps/desktop/scripts/smoke-desktop-runtime.ts`
- `apps/server/src/modules/settings/application/local-ade.service.ts`
- `apps/server/src/modules/settings/application/local-ade.service.test.ts`
- `apps/web/src/components/chat-ui/chat-interface.tsx`
- `apps/web/src/components/chat-ui/subagent-command.ts`
- `apps/web/src/components/chat-ui/subagent-command.test.ts`
- `apps/web/src/components/local-ade/local-ade-control-center.tsx`

## Deferred Non-Core Surfaces

- Hook/plugin execution remains disabled until there is a signed plugin policy
  and execution sandbox.
- Remote auth admin/device-session management remains outside the local ADE
  surface until a local auth-admin policy exists.
- Deeper ACP traffic inspection and conflict-aware checkpoint UX can still be
  improved, but the core checkpoint preview/guarded restore/safety flow is
  usable.
