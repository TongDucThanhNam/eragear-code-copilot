# Eragear Desktop

Electron host for the desktop-first Eragear app.

## Run

From the repository root:

```bash
bun run dev:desktop
```

The dev launcher starts the renderer from this package on a loopback Vite port,
builds Electron main/preload, and launches Electron. If the requested renderer
port is busy, the launcher selects the next free loopback port.

## Package for Windows

From the repository root:

```powershell
bun run package:win
```

This creates an assisted per-user NSIS installer under `apps/desktop/release`.
The installer offers an installation-directory choice and creates Start Menu
and desktop shortcuts. For a faster unpacked package during release testing:

```powershell
bun run --cwd apps/desktop package:win:dir
```

The packaging preparation step stages only the bundled Electron app and a
compiled runtime sidecar. The SQLite worker and migration assets are shipped
beside that sidecar under `resources/runtime`; the installed app does not need
Bun or the source repository.

Default `main-thread` runtime traffic does not use a browser-accessible local
HTTP API. The renderer calls preload over `electron-ipc`; Electron main routes
those calls to a Bun `desktop-service` process from `packages/runtime` over
private stdio NDJSON.

```text
apps/desktop renderer
  -> preload eragearDesktop bridge
  -> Electron IPC
  -> apps/desktop/src/runtime-host.ts
  -> packages/runtime/src/runtime/desktop-service.ts
  -> packages/runtime/src/runtime/core.ts
  -> runtime use cases
```

## Local Mode

- Default mode is `main-thread`.
- Bootstrap transport kind is `electron-ipc`.
- Runtime diagnostics endpoint kind is `desktop-service`.
- Local desktop mode bypasses app login only for trusted Electron bootstrap
  with a per-launch local token.
- Provider auth remains inside user-installed Agent CLIs.
- Missing `opencode`, `codex`, `claude`, or `gemini` commands are startup
  diagnostics, not fatal Electron startup errors.
- Closing Electron sends a graceful shutdown to the desktop service and then
  terminates the owned process tree if needed.

## Remote Connect

Desktop-first Remote Connect is owned here. Electron main can expose a
loopback-only bridge and optionally run `cloudflared` in front of it. The bridge
forwards authenticated runtime operations into the private `desktop-service`
stdio/IPC channel, so local runtime behavior remains package-owned and
Electron-mediated.

Full setup and security details: [`docs/remote-connect.md`](docs/remote-connect.md).

`client-only` desktop mode is reserved for connecting to another Eragear host:

```bash
ERAGEAR_DESKTOP_MODE=client-only ERAGEAR_REMOTE_SERVER_URL=wss://host.example.com ERAGEAR_REMOTE_API_KEY=... bun run dev:desktop
```

For the desktop Remote Connect bridge, use `ERAGEAR_REMOTE_CONNECT_TOKEN`
instead of the legacy remote API key:

```bash
ERAGEAR_DESKTOP_MODE=client-only ERAGEAR_REMOTE_SERVER_URL=https://host.example.com ERAGEAR_REMOTE_CONNECT_TOKEN=... bun run dev:desktop
```

Remote mode keeps normal auth/API-key boundaries. The local desktop auth bypass
is not used for remote transports.

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

- shared contracts: `packages/shared/src/capability-registry.ts`
- runtime snapshot: `packages/runtime/src/runtime/capability-registry.ts`

Durable capability records are directed to SQLite migrations under
`packages/runtime/drizzle`; no new JSON primary store is introduced.
