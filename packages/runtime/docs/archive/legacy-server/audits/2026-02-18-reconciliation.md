# Architecture Audit Reconciliation (2026-02-18)

## Scope

This reconciliation compares the report snapshot with current `master` in `apps/server`.

## Current Status

- `001` Quality gate false green: **stale**. `bunx biome check src --error-on-warnings` and `bun run check` pass on current tree.
- `002` Process record retention risk: **active**. Remediated by bounded record retention and stronger shutdown handling in `src/platform/process/index.ts`.
- `003` Main-thread blocking SQLite lock: **active**. Remediated by async retry lock acquisition in `src/platform/storage/sqlite-process-lock.ts`.
- `004` Fragile file URI/path handling: **active**. Remediated by strict parsing and rejection rules in `src/shared/utils/path.util.ts`.
- `005` Termination drain gives up without final forceful attempt: **active**. Remediated with final kill pass and explicit lingering summaries.
- `006` Storage path complexity debt: **active (non-blocking)**. Refactor applied in canonical path resolution flow.
- `007` SQLite ORM singleton ambiguity: **active (non-blocking)**. Guardrail added to fail fast on unexpected client swaps.
- `008` Log pollution in expected flows: **active**. Reduced warning noise for expected retry and invariant paths.
- `009` Repeated regex compilation (Biome perf): **stale** on current `src` quality gate.
- `010` Import ordering debt: **stale** on current `src` quality gate.

## Canonical Quality Commands

- `bun run check:quick`
- `bun run check:ci`

These scripts are the source of truth for quality gate integrity.
