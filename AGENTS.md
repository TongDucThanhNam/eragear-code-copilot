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

# Desktop smoke run
$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop

# Type checks and builds
bun run --cwd apps/desktop check-types
bun run --cwd apps/native ui-map
bun run --cwd packages/runtime check-types
bun run --cwd packages/api-contract check-types
bun run build

# Focused blocker checks
bun run audit:blockers
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
