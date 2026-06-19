# @eragear-code-copilot/runtime

Shared runtime package for Eragear Code Copilot.

This package owns runtime/application behavior that must stay outside Electron
main/preload:

- ACP connection handling
- session lifecycle and persistence
- permission request handling
- tool-call execution and sandbox checks
- process, filesystem, terminal, git, settings, plugin, hook, MCP, and
  background-task adapters
- tRPC router implementation for package-owned API contracts
- desktop-service entrypoints used by Electron through stdio NDJSON

## Entry Points

- `src/runtime/core.ts` creates the runtime core.
- `src/runtime/desktop-service.ts` runs the private desktop service process.
- `src/transport/trpc/router.ts` exports the package-owned tRPC router type.
- `src/package-api.ts` exposes the stable package API.

## Commands

```bash
bun run check-types
bun run check:quick
bun run test:blockers
bun run build
```

## Boundaries

Application and domain code should depend on ports and shared contracts.
Infrastructure implements IO and policy details. Electron main/preload should
call this package through the desktop-service boundary rather than duplicating
runtime rules.
