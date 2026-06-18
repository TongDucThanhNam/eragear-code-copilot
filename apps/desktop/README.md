# Eragear Desktop

Developer-runnable Electron host for the desktop-first Eragear app.

## Run

From the repository root:

```bash
bun run dev:desktop
```

The dev launcher starts `apps/web` as the Vite renderer on a loopback renderer
port, builds Electron main/preload, and launches Electron. If the requested
renderer port is busy, the launcher selects the next free loopback port.

Default `main-thread` runtime traffic does not use a browser-accessible local
HTTP server. The renderer calls preload over `electron-ipc`; Electron main then
routes those calls to a Bun `desktop-service` process over private stdio NDJSON.

```text
apps/web renderer
  -> preload eragearDesktop bridge
  -> Electron IPC
  -> apps/desktop/src/runtime-host.ts
  -> apps/server/src/runtime/desktop-service.ts
  -> apps/server/src/runtime/core.ts
  -> canonical AppUseCases/runtime rules
```

## Local Mode

- Default mode is `main-thread`.
- Bootstrap transport kind is `electron-ipc`.
- Runtime diagnostics endpoint kind is `desktop-service`.
- Local desktop mode bypasses Eragear app login only for trusted Electron
  bootstrap with a per-launch local token.
- Provider auth remains inside user-installed Agent CLIs.
- Missing `opencode`, `codex`, `claude`, or `gemini` commands are startup
  diagnostics, not fatal Electron startup errors.
- Closing Electron sends a graceful shutdown to the desktop service and then
  terminates the owned process tree if needed.

## Compatibility And Remote

`apps/server` remains the server/remote/compat host. It can still expose Hono,
tRPC, and WebSocket transports for non-desktop or remote use.

Desktop-first Remote Connect is owned by `apps/desktop`, not by the legacy
server host. Electron main can expose a loopback-only Remote Connect bridge and
optionally run `cloudflared` in front of it. The bridge forwards authenticated
runtime operations into the private `desktop-service` stdio/IPC channel, so the
canonical local runtime remains Electron-owned.

Full setup and security details: [`docs/remote-connect.md`](docs/remote-connect.md).

`client-only` desktop mode is reserved for connecting to another Eragear host:

```bash
ERAGEAR_DESKTOP_MODE=client-only ERAGEAR_REMOTE_SERVER_URL=wss://host.example.com ERAGEAR_REMOTE_API_KEY=... bun run dev:desktop
```

For the desktop-only Remote Connect bridge, use `ERAGEAR_REMOTE_CONNECT_TOKEN`
instead of the legacy remote API key:

```bash
ERAGEAR_DESKTOP_MODE=client-only ERAGEAR_REMOTE_SERVER_URL=https://host.example.com ERAGEAR_REMOTE_CONNECT_TOKEN=... bun run dev:desktop
```

Remote/server mode keeps normal auth/API-key boundaries. The local desktop auth
bypass is not used for remote transports.

## Fallback Status

No `local-http-fallback` API is used in the default `main-thread` desktop path.
The only loopback HTTP server in `bun run dev:desktop` is the Vite renderer dev
server.

If a future desktop API must temporarily use local HTTP, it must be represented
as transport kind `local-http-fallback`, bind only to `127.0.0.1`, and be
documented as a partial migration until removed from the default path.

## Diagnostics

The preload bridge exposes:

- `eragearDesktop.getBootstrap()`
- `eragearDesktop.getRuntimeDiagnostics()`
- `eragearDesktop.requestRuntime()`
- `eragearDesktop.subscribeRuntime()`
- `eragearDesktop.unsubscribeRuntime()`

Diagnostics include mode, channel kind, runtime health, child process status,
CLI availability/install guidance, and the capability registry foundation.

## Capability Registry Foundation

The first ZCode-inspired slice is a typed capability registry:

- shared contracts: `packages/shared/src/capability-registry.ts`
- runtime snapshot: `apps/server/src/runtime/capability-registry.ts`

The snapshot reports local Agent CLI capabilities and disabled foundation slots
for skills, commands, subagents, MCP servers, and plugins. Durable capability
records are explicitly directed to SQLite migrations under `apps/server/drizzle`;
no new JSON primary store is introduced.
