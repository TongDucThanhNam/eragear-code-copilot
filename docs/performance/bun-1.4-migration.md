# Bun 1.4 migration

Eragear requires Bun 1.4 or newer for development and for building the compiled
runtime sidecar. The migration follows the product's execution boundaries:

| Area | Runtime | Bun-native APIs |
| --- | --- | --- |
| `packages/runtime` and its compiled sidecar | Bun | Yes |
| build, staging, and repository scripts invoked by Bun | Bun | Yes |
| Electron main and preload | Electron's Node.js runtime | No |
| desktop renderer | Chromium browser runtime | No |
| Expo native client | React Native runtime | No |

This prevents renderer or Electron lifecycle code from importing APIs that only
exist in Bun while still moving the application runtime's hot paths.

## Adopted

- Pinned Bun and `@types/bun` to 1.4 and enabled Bun 1.4's isolated linker/global
  virtual store through the root `bunfig.toml`.
- Replaced `node-pty` with `Bun.Terminal`. The compatibility wrapper preserves
  the existing data, exit, resize, write, kill, and pause/resume contract. Since
  Bun 1.4 does not expose read-side PTY pause, paused output is bounded at 10
  MiB and a process that exceeds the bound is terminated instead of allowing
  unbounded memory growth.
- Added a shell-free, bounded `Bun.spawn` wrapper for Git checkpoints/workflows,
  Supervisor worker evidence and verification, Obsidian CLI calls, and agent
  CLI version probes. Failure objects retain the `code`, `stdout`, and `stderr`
  evidence expected by the existing adapters.
- Replaced repeated PATH directory scans and `where.exe`/`which` subprocesses
  with `Bun.which`.
- Replaced the ACP plan hot comparison with strict `Bun.deepEquals`.
- Replaced all 48 production SHA-1, SHA-256, and HMAC call sites in the Bun
  runtime with `Bun.CryptoHasher`. Static hashing avoids the compatibility
  wrapper and is byte-for-byte compatible with the previous hashes; incremental
  asset, skill-directory, credential-key, and Telegram HMAC hashing retains the
  exact update order and output encoding.
- Added selective `Bun.Glob` traversal for CLI usage-provider files, Local ADE
  capability discovery, and Codex transcript lookup. These roots do not require
  directory pruning, and the scans keep the previous hidden-file, symlink,
  maximum-result, timestamp, and best-effort behavior.
- Added a tolerant native `Bun.JSONL.parseChunk` path for Codex history and
  transcript imports and bounded CLI usage-log batches. Valid rows are parsed
  in native batches while malformed, partially-written, marker-irrelevant, or
  oversized rows retain their previous skip and warning behavior.
- Removed the Usage page's cold synchronous all-provider gate after profiling
  11.3 GiB of local 30-day history. Completed summaries are stored in a small
  dedicated `bun:sqlite` snapshot database and returned immediately after a
  runtime restart, while a serialized Bun Worker refreshes all provider indexes
  off the runtime request thread. The renderer keeps the previous result visible,
  shows an explicit background-refresh notice, and defers quota correlation
  until the fresh summary arrives. The in-memory cache now uses its full
  two-minute TTL instead of changing identity every 15 seconds.
- Removed avoidable child Bun processes from dashboard builds by calling
  `Bun.build` directly. Build/copy/staging scripts now use `Bun.file`,
  `Bun.write`, and `Bun.spawn` where the script already runs under Bun. The
  dashboard watcher also uses Bun subprocess/file APIs, and the compiled daemon
  uses `Bun.spawnSync` for its bounded Windows ACL command.
- Removed the production `node-pty` native dependency and its install/build
  surface.

Bun 1.4's runtime-level startup, idle CPU, memory, stream, and Windows startup
improvements also apply to the Bun runtime and compiled sidecar without source
changes. See the [Bun 1.4 release notes](https://bun.com/blog/bun-v1.4).

## Evaluated but not adopted

- `Bun.serve`: the standalone server currently couples authenticated tRPC
  WebSocket upgrades to `ws` and `@trpc/server/adapters/ws`. Replacing only its
  HTTP listener would leave two server stacks; replacing both requires a custom
  WebSocket adapter and a separate auth/recovery migration. The current
  `node:http` compatibility path therefore stays in the Bun runtime.
- `Bun.cron`: the workflow kernel requires durable one-second reconciliation,
  persisted wakeups, retries, and recovery. A process-local minute scheduler
  cannot own those facts.
- `Bun.markdown`: chat Markdown is rendered inside Chromium through the existing
  browser-safe renderer. Runtime HTML generation would cross the transport/UI
  boundary and create a second sanitization path.
- `Bun.WebView` and `Bun.Image`: Electron already owns the desktop webview and
  there is no runtime image-transform hot path.
- Broad `Bun.Glob` conversion: Git project-tree, repository-context, and
  Obsidian-vault scans still prune ignored, sensitive, or plugin directories
  before descending. Traversing those directories and filtering afterward
  would be slower and could weaken sandbox behavior, so only unpruned discovery
  roots use native globbing.
- Broad `Bun.file` conversion: on the measured Windows workstation, repeated
  tiny-file text reads were slower than `node:fs/promises`, while repeated 1 MiB
  reads were effectively tied and varied between runs. Atomic filesystem,
  directory operations, and application file repositories therefore stay on
  Bun's compatible Node APIs.
- `Bun.randomUUIDv7`: sortable identifiers may improve a schema designed around
  them, but replacing existing UUIDv4 IDs would alter persisted/API semantics
  and generation itself was not faster in the local benchmark. It needs a
  separate storage-contract migration rather than a mechanical substitution.
- `bun test --parallel`: the full suite contains shared process/environment and
  temporary-Git fixtures. A 12-worker audit produced 1,669 passes but 8 races or
  timeouts, so parallel mode is not exposed as a green project command.
- Long-running ACP agent processes, Electron development children, and process
  tree termination stay on `node:child_process` because their callers consume
  Node stream/event interfaces and Windows tree-kill semantics. Replacing those
  is an interface migration, not a drop-in subprocess optimization.

## Reproducible local benchmark

Run:

```powershell
bun run --cwd packages/runtime bench:bun-1.4
```

The benchmark compares executable lookup, deep equality, hashing, JSONL parsing,
recursive discovery, subprocess startup, and file reads on the current machine.
It verifies that both recursive scanners return the same paths before timing.
It is a directional microbenchmark, not a production throughput claim; use it
to validate future replacements instead of assuming every Bun API is faster for
every workload.

Reference result on Bun 1.4.0, Windows x64 (lower is better):

| Workload | Compatible Node API | Bun API | Relative result |
| --- | ---: | ---: | ---: |
| 500 executable lookups | 3,618 ms | 754 ms | `Bun.which` 4.8x faster |
| 20,000 strict deep comparisons | 190 ms | 107 ms | `Bun.deepEquals` 1.8x faster |
| 200,000 small SHA-256 hashes | 258 ms | 114 ms | `Bun.CryptoHasher` 2.3x faster |
| 30 parses of 50,000 JSONL rows | 382 ms | 261 ms | `Bun.JSONL` 1.5x faster |
| 20 recursive scans of 1,191 TS files | 569 ms | 257 ms | `Bun.Glob` 2.2x faster |
| 30 subprocess starts | 946 ms | 981 ms | effectively tied in this run |
| 2,000 tiny text reads | 181 ms | 307 ms | `node:fs` 1.7x faster |
| 200 cached 1 MiB binary reads | 80 ms | 84 ms | effectively tied in this run |

### Usage fast-start result

The production Usage scanner was measured separately because it exercises real
provider histories rather than a synthetic microbenchmark. The measured
workstation had 1,199 Codex JSONL files modified in the preceding 30 days,
totalling 11.3 GiB, plus Claude, Pi, Antigravity, and Zcode histories.

| Usage path | Before | After |
| --- | ---: | ---: |
| Repeat open after a runtime restart | 4.4-14.6 s | 6.29 ms to cached data |
| Fresh all-provider background scan | 10.3 s reference run | 4.3-6.4 s after native JSONL batching |
| Runtime-thread responsiveness during refresh | coupled to scan work | 9.98 ms measured worst timer lag |

The very first scan on a new installation still has to index authoritative local
logs. It now runs in the worker and shows an accurate first-index message; every
completed scan seeds the durable fast-start path for subsequent launches.

## Verification

```powershell
bun install --frozen-lockfile
bun run --cwd packages/runtime check-types
bun run --cwd packages/runtime compile
bun run --cwd apps/desktop check-types
bun run --cwd apps/desktop build:main
bun test packages/runtime/src/platform/crypto/bun-crypto-compatibility.test.ts packages/runtime/src/shared/utils/json-lines.util.test.ts packages/runtime/src/modules/session/application/external-history-resolver.test.ts packages/runtime/src/modules/usage-stats/infra/local-cli-usage-scanner.adapter.test.ts packages/runtime/src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.test.ts
bun test packages/runtime/src/modules/usage-stats/infra/cached-usage-stats-scanner.adapter.test.ts packages/runtime/src/modules/usage-stats/infra/usage-stats-snapshot-cache.sqlite.test.ts packages/runtime/src/modules/usage-stats/infra/worker-usage-stats-scanner.adapter.test.ts
```

Git and terminal tests that execute commands on PowerShell should use the
allowlist setup documented in the repository `AGENTS.md`.
