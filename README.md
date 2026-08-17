# Eragear Code Copilot

Eragear Code Copilot is a desktop-first AI coding assistant built around
Electron, the Agent Client Protocol (ACP), and shared runtime packages.

## Product Shape

- `apps/desktop` is the primary desktop app. Electron owns lifecycle, native
  integration, preload/contextBridge IPC, Remote Connect, diagnostics, and
  process cleanup.
- `apps/native` is the mobile client. It imports API contracts from packages and
  connects to a configured runtime host.
- `packages/runtime` owns runtime/application behavior: ACP, session lifecycle,
  tool-call handling, permission boundaries, persistence, settings, background
  tasks, and tRPC procedure implementation.
- `packages/api-contract` owns client-visible API types such as `AppRouter`.
- `packages/shared` and `packages/config` contain cross-cutting contracts and
  workspace configuration.

Electron main and preload should stay thin. Runtime and business rules belong in
packages, with renderer access to privileged operations routed through
preload/contextBridge IPC.

## Development

Install dependencies:

```bash
bun install
```

Run the desktop app:

```bash
bun run dev:desktop
```

Run the mobile app:

```bash
bun run dev:native
```

Run product-relevant development targets:

```bash
bun run dev
```

## Build the Windows Installer

On Windows, install dependencies and build the NSIS installer from the
repository root:

```powershell
bun install
bun run package:win
```

The installer is written to
`apps/desktop/release/Eragear-Code-Copilot-Setup-<version>.exe`. It includes
Electron, the production renderer/main bundles, and the compiled runtime
sidecar, so Bun is not required on the destination computer.

For an unpacked build that can be launched without installing:

```powershell
bun run --cwd apps/desktop package:win:dir
./apps/desktop/release/win-unpacked/Eragear.exe
```

Local development builds are unsigned unless Windows code-signing credentials
are configured for Electron Builder.

## Verification

```bash
bun run --cwd apps/desktop check-types
bun run --cwd apps/native ui-map
bun run --cwd packages/runtime check-types
bun run --cwd packages/api-contract check-types
bun run build
```

Desktop smoke:

```powershell
$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop
```

Focused blocker checks:

```bash
bun run audit:blockers
```

## Architecture Notes

The default local desktop path is private:

```text
desktop renderer
  -> preload eragearDesktop bridge
  -> Electron IPC
  -> DesktopRuntimeHost
  -> packages/runtime desktop-service over stdio NDJSON
  -> runtime use cases
  -> ACP agent process
```

Remote/mobile access uses an explicitly configured runtime host or Desktop
Remote Connect. The default desktop main-thread mode does not expose a
browser-accessible local runtime API.

## Contributing

Keep app internals out of package consumers. Mobile and renderer code should
depend on package contracts, not on another app folder. Preserve ACP permission
and sandbox boundaries when touching runtime code.
