# Runtime Host/Core Boundary

Language: English.

## Developer Run

From the repository root:

```bash
bun run dev:desktop
```

This starts `apps/web` as the renderer, launches Electron from `apps/desktop`,
and lets Electron main own the local runtime lifecycle.

## Current Shape

The default desktop `main-thread` path is no longer the spawned `apps/server`
HTTP/tRPC/WebSocket bridge. It is:

```text
Renderer (`apps/web`)
  -> preload bridge (`window.eragearDesktop`)
  -> Electron IPC (`electron-ipc`)
  -> DesktopRuntimeHost (`apps/desktop/src/runtime-host.ts`)
  -> Bun desktop service over stdio NDJSON (`desktop-service`)
  -> RuntimeCore (`apps/server/src/runtime/core.ts`)
  -> AppComposition/AppUseCases
```

`RuntimeCore` wraps the canonical composition/use-case graph without starting
Hono routes. That keeps project/session/agent rules shared by desktop service
and server/remote hosts.

## Host Responsibilities

`apps/desktop/src/runtime-host.ts`

- start / stop / health / diagnostics / bootstrap
- owns the Bun desktop service child process
- exposes renderer-facing transport as `electron-ipc`
- bridges runtime operations and subscriptions to `desktop-service`
- checks Codex, Claude, Gemini, and OpenCode CLI availability
- cleans the owned service process tree on quit

`apps/server/src/runtime/desktop-service.ts`

- starts `RuntimeCore`
- reserves stdout for JSON protocol messages
- routes query/mutation/subscription calls into the existing tRPC router with a
  desktop-local authenticated context
- does not start Hono, HTTP, tRPC-over-WS, or a browser-accessible local server

`apps/server/src/bootstrap/server.ts`

- remains the server/remote/compat host
- attaches Hono/tRPC/WS transport around the same core rules
- keeps remote auth/API-key/Cloudflare Access behavior at transport boundaries

`packages/shared/src/runtime-host.ts`

- defines channel descriptors including `electron-ipc`, `desktop-service`,
  `local-http-fallback`, `ssh`, `relay`, and `remote-http`
- defines runtime diagnostics/bootstrap and desktop service protocol DTOs

## Local Auth Boundary

Desktop `main-thread` mode does not require Eragear app login. Electron main
generates a per-launch local token and passes it through preload/runtime
requests. The Bun desktop service accepts that token only over the private
service channel owned by Electron main.

Remote/server mode continues to use the normal auth/API-key/Cloudflare Access
path. The desktop-local auth context is not a remote credential.

## Diagnostics Contract

Runtime diagnostics are loggable through Electron startup logs and available to
the renderer through preload:

- mode and channel kind
- health/readiness
- runtime child process status/PID/exit signal
- CLI availability for Codex, Claude Code, Gemini CLI, and OpenCode
- clear install/configuration messages for missing CLIs
- capability registry foundation snapshot

The server host may also expose protected diagnostics through HTTP routes. That
is server/remote/compat behavior, not the default desktop local transport.

## Capability Foundation

The first ZCode-inspired foundation is a typed registry:

- `packages/shared/src/capability-registry.ts`
- `apps/server/src/runtime/capability-registry.ts`

It reports local Agent CLI capabilities and placeholder slots for skills,
commands, subagents, MCP servers, and plugins. Persistence direction is SQLite:
future durable capability rows should be owned by migrations under
`apps/server/drizzle` and accessed through repository ports. No new JSON primary
store is introduced.

## Fallback Status

No `local-http-fallback` API remains in the default desktop `main-thread` path.
The only local HTTP server used by `bun run dev:desktop` is Vite serving the
renderer on loopback.

If a future desktop call is forced back to local HTTP, it must:

- use transport kind `local-http-fallback`
- bind only to `127.0.0.1`
- name the exact API and blocker here
- make the migration status partial until removed from the default path

## Dashboard Parity Status

The Electron renderer now covers the local ADE path needed for normal project
and session work:

- project/session/agent tRPC calls go through Electron IPC and the private
  desktop service channel
- OpenCode/Codex CLI diagnostics are surfaced from desktop bootstrap
- desktop startup derives explicit absolute agent command policies from detected
  CLIs and boot config
- Settings exposes a runtime allowlist status panel and can sync detected CLIs
  into boot allowlists through `settings.getBootAllowlists` and
  `settings.updateBootAllowlists`
- real OpenCode session creation through `desktop-service` has been verified

Dashboard-only gaps that remain UI parity work, not local HTTP fallback in the
default desktop path:

- full dashboard boot allowlist editor is not ported; Electron Settings only has
  the minimum status/sync control for detected agent CLIs and ENV keys
- dashboard overview stats, observability snapshots, and live log tailing
  (`/api/dashboard/*`, `/api/logs*`) do not yet have Electron UI equivalents
- admin API key and device-session management remain server-dashboard operations
- rich dashboard project/session summary tables remain dashboard-only; the
  desktop app uses the normal local project tree and chat/session workflow

These gaps do not require `local-http-fallback`; they should be implemented as
IPC-backed tRPC/operation routes or kept explicitly server-only if they are
remote administration features.

## OpenCode Session Init Fix

The desktop host now generates `ALLOWED_AGENT_COMMAND_POLICIES` for detected
local CLIs such as `opencode.exe` and `codex.exe`. The process adapter trims
stored command strings and, on Windows, resolves extensionless aliases like
`opencode` to an explicitly allowed `opencode.exe` path. Session creation and
agent-session discovery trim the configured command before applying OpenCode's
default `acp` argument.

## Transitional Note

The runtime service remains a Bun child process because the current canonical
runtime depends on Bun-specific storage/runtime APIs. This is intentional for
the migration: the default product transport is Electron IPC plus a private
desktop service channel, not a spawned HTTP bridge. A later pass can move the
service in-process only after Bun/Node/Electron compatibility is resolved.
